import type { LineagePort } from '../../interfaces.js'

/**
 * P7 enterprise adapter — enterprise data catalogue (Microsoft Purview / Collibra / Alation /
 * Informatica). Follows the ADR 0023 pattern. Emits the OFBO column-level lineage event to the
 * bank's catalogue at write time (BCBS 239). On a transport failure it THROWS — the write-path
 * stores already wrap emitLineage in try/catch ("the regulated write stands; Q4.5 surfaces
 * persistent gaps"), so surfacing the failure to that catch is the correct, honest behaviour (a
 * silent swallow would hide a lineage outage from the Q4.5 gate).
 *
 * The HTTP transport is an injected seam (fetchCatalogueHttp default; tests inject a fake — no
 * network, no new dependency). The exact vendor lineage schema is version-specific and lives in the
 * transport / vendor path selection, so a catalogue migration is a wiring change, not a core one.
 */

export type CatalogueVendor = 'purview' | 'collibra' | 'generic'

export interface CatalogueHttp {
  post(path: string, body: Record<string, unknown>): Promise<{ status: number }>
}

export interface CatalogueConfig {
  vendor: CatalogueVendor
  http: CatalogueHttp
}

// Representative lineage endpoints per vendor (override via the transport for a specific version).
const LINEAGE_PATH: Record<CatalogueVendor, string> = {
  purview: '/catalog/api/atlas/v2/lineage', // Purview is Apache Atlas-based
  collibra: '/rest/2.0/lineage',
  generic: '/lineage'
}

export class CatalogueLineageAdapter implements LineagePort {
  constructor(private readonly cfg: CatalogueConfig) {}

  async emitLineage(event: { table: string; columns: string[]; source: string; trace_id: string }): Promise<void> {
    // A normalized column-level lineage record: source → table, with the columns produced and the
    // OFBO trace (x-fapi-interaction-id) for end-to-end correlation. Production maps this to the
    // exact vendor lineage schema (Atlas process entity / Collibra lineage import).
    const body: Record<string, unknown> = {
      target_table: event.table,
      columns: event.columns,
      source: event.source,
      trace_id: event.trace_id
    }
    const res = await this.cfg.http.post(LINEAGE_PATH[this.cfg.vendor], body)
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`P7: catalogue lineage emit failed (HTTP ${res.status})`)
    }
  }
}

// ── fetch-backed transport (production default) ──────────────────────────────────────────────

export function fetchCatalogueHttp(baseUrl: string, authHeader: string): CatalogueHttp {
  const base = baseUrl.replace(/\/$/, '')
  return {
    async post(path, body) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: authHeader, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      })
      return { status: res.status }
    }
  }
}

// ── Env factory ──────────────────────────────────────────────────────────────────────────────

export class CatalogueConfigError extends Error {
  constructor(message: string) {
    super(`P7 data-catalogue adapter misconfigured: ${message}`)
    this.name = 'CatalogueConfigError'
  }
}

/** Construct from configuration. Required: P7_CATALOGUE_BASE_URL, P7_CATALOGUE_AUTH (full
 *  Authorization header). Optional: P7_CATALOGUE_VENDOR (purview|collibra|generic, default generic). */
export function catalogueLineageFromEnv(env: Record<string, string | undefined>): CatalogueLineageAdapter {
  const baseUrl = env.P7_CATALOGUE_BASE_URL
  if (!baseUrl) throw new CatalogueConfigError('P7_CATALOGUE_BASE_URL is required (the catalogue API base URL)')
  const auth = env.P7_CATALOGUE_AUTH
  if (!auth) throw new CatalogueConfigError('P7_CATALOGUE_AUTH is required (a full Authorization header)')

  const vendorRaw = (env.P7_CATALOGUE_VENDOR ?? 'generic').toLowerCase()
  if (vendorRaw !== 'purview' && vendorRaw !== 'collibra' && vendorRaw !== 'generic') {
    throw new CatalogueConfigError('P7_CATALOGUE_VENDOR must be "purview", "collibra" or "generic"')
  }

  return new CatalogueLineageAdapter({ vendor: vendorRaw, http: fetchCatalogueHttp(baseUrl, auth) })
}
