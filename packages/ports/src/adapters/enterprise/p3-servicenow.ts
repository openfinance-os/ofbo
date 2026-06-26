import type { ItsmPort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P3 enterprise adapter — ServiceNow ITSM. The second reference enterprise adapter, following the
 * pattern set by P2 Entra (ADR 0023): the OFBO-specific logic (severity → ServiceNow urgency/impact,
 * the BD-04 team → assignment-group routing map, x-fapi-interaction-id correlation) lives HERE and is
 * fully unit-tested; the HTTP transport to the ServiceNow Table API is an injected seam (production
 * wires a `fetch`-backed client with the instance's auth; tests inject a fake, so no network).
 *
 * Behaviourally identical to the simulator — `createTicket` returns a ticket id — so it binds the
 * SAME contract (unlike P2, whose human-login leg necessarily differs). No PSU PII: OFBO ticket
 * summaries are PII-free by convention, and only the summary/type/severity/team cross the wire.
 */

type Severity = 'low' | 'medium' | 'high' | 'critical'

// ServiceNow urgency/impact are 1 (high) .. 3 (low); priority is derived from them by the platform.
const SEVERITY_TO_URGENCY: Record<Severity, number> = { critical: 1, high: 2, medium: 2, low: 3 }
const SEVERITY_TO_IMPACT: Record<Severity, number> = { critical: 1, high: 2, medium: 3, low: 3 }

/** HTTP transport seam. Production: POST to `<instance>/api/now/table/<table>` with the instance's
 *  Authorization header. Tests inject a fake. MUST surface the HTTP status so non-2xx fails closed. */
export interface ServiceNowHttp {
  post(path: string, body: Record<string, unknown>, trace: TraceContext): Promise<{ status: number; json: unknown }>
}

export interface ServiceNowConfig {
  instanceUrl: string
  /** Target Table API table (default 'incident'). */
  table?: string
  /** OFBO team → ServiceNow assignment_group (sys_id or name) — the BD-04 routing map. */
  assignmentGroupMap: Record<string, string>
  /** Fallback assignment group when a team isn't mapped (optional; absent → unmapped team is an error). */
  defaultAssignmentGroup?: string
  http: ServiceNowHttp
}

interface IncidentResponse {
  result?: { sys_id?: string; number?: string }
}

function lookup(map: Record<string, string>, key: string): string | undefined {
  // Own-property + string check — a team value must not resolve to an inherited Object.prototype
  // member (consistent with the P2 review hardening).
  const v = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
  return typeof v === 'string' && v ? v : undefined
}

export class ServiceNowItsmAdapter implements ItsmPort {
  constructor(private readonly cfg: ServiceNowConfig) {}

  async createTicket(
    input: { type: string; severity: Severity; team: string; summary: string },
    trace: TraceContext
  ): Promise<{ ticket_id: string }> {
    const group = lookup(this.cfg.assignmentGroupMap, input.team) ?? this.cfg.defaultAssignmentGroup
    if (!group) throw new Error(`P3: no ServiceNow assignment group mapped for team "${input.team}"`)

    const table = this.cfg.table ?? 'incident'
    const body: Record<string, unknown> = {
      short_description: input.summary, // PII-free by OFBO convention
      category: input.type,
      urgency: SEVERITY_TO_URGENCY[input.severity],
      impact: SEVERITY_TO_IMPACT[input.severity],
      assignment_group: group,
      // Correlate the ServiceNow record back to the OFBO trace (x-fapi-interaction-id).
      correlation_id: trace.trace_id
    }

    const res = await this.cfg.http.post(`/api/now/table/${table}`, body, trace)
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`P3: ServiceNow ${table} create failed (HTTP ${res.status})`)
    }
    const result = (res.json as IncidentResponse).result
    const ticket_id = result?.number ?? result?.sys_id
    if (!ticket_id) throw new Error('P3: ServiceNow response missing incident number / sys_id')
    return { ticket_id }
  }
}

// ─── fetch-backed transport (the production default) ─────────────────────────────────────────────

/** A `fetch`-backed ServiceNow Table API client. `authHeader` is the full Authorization value
 *  (e.g. `Basic <base64>` or `Bearer <token>`). No new dependency — uses the platform `fetch`. */
export function fetchServiceNowHttp(instanceUrl: string, authHeader: string): ServiceNowHttp {
  const base = instanceUrl.replace(/\/$/, '')
  return {
    async post(path, body, trace) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          authorization: authHeader,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-fapi-interaction-id': trace.trace_id
        },
        body: JSON.stringify(body)
      })
      const json = await res.json().catch(() => ({}))
      return { status: res.status, json }
    }
  }
}

// ─── Env factory ─────────────────────────────────────────────────────────────────────────────

export class ServiceNowConfigError extends Error {
  constructor(message: string) {
    super(`P3 ServiceNow adapter misconfigured: ${message}`)
    this.name = 'ServiceNowConfigError'
  }
}

/** Construct from configuration (the registry calls this for DEPLOY_PROFILE=enterprise). Required:
 *  P3_SERVICENOW_INSTANCE_URL, P3_SERVICENOW_AUTH (full Authorization header), P3_ASSIGNMENT_GROUP_MAP
 *  (JSON team→group). Optional: P3_SERVICENOW_TABLE (default 'incident'), P3_DEFAULT_ASSIGNMENT_GROUP. */
export function serviceNowItsmFromEnv(env: Record<string, string | undefined>): ServiceNowItsmAdapter {
  const instanceUrl = env.P3_SERVICENOW_INSTANCE_URL
  if (!instanceUrl) throw new ServiceNowConfigError('P3_SERVICENOW_INSTANCE_URL is required (https://<instance>.service-now.com)')
  const auth = env.P3_SERVICENOW_AUTH
  if (!auth) throw new ServiceNowConfigError('P3_SERVICENOW_AUTH is required (a full Authorization header — "Basic <b64>" or "Bearer <token>")')

  let parsed: unknown
  try {
    parsed = JSON.parse(env.P3_ASSIGNMENT_GROUP_MAP ?? '')
  } catch {
    throw new ServiceNowConfigError('P3_ASSIGNMENT_GROUP_MAP must be a JSON object mapping OFBO team → ServiceNow assignment group')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceNowConfigError('P3_ASSIGNMENT_GROUP_MAP must be a JSON object mapping OFBO team → ServiceNow assignment group')
  }
  const assignmentGroupMap: Record<string, string> = Object.create(null) // no prototype-pollution surface
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v) throw new ServiceNowConfigError('P3_ASSIGNMENT_GROUP_MAP values must be non-empty assignment-group identifiers')
    assignmentGroupMap[k] = v
  }
  if (Object.keys(assignmentGroupMap).length === 0 && !env.P3_DEFAULT_ASSIGNMENT_GROUP) {
    throw new ServiceNowConfigError('P3_ASSIGNMENT_GROUP_MAP needs at least one entry (or set P3_DEFAULT_ASSIGNMENT_GROUP)')
  }

  return new ServiceNowItsmAdapter({
    instanceUrl,
    table: env.P3_SERVICENOW_TABLE ?? 'incident',
    assignmentGroupMap,
    ...(env.P3_DEFAULT_ASSIGNMENT_GROUP ? { defaultAssignmentGroup: env.P3_DEFAULT_ASSIGNMENT_GROUP } : {}),
    http: fetchServiceNowHttp(instanceUrl, auth)
  })
}
