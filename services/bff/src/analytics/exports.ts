import { createHash, randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-41 — analytics exports (PDF / XLSX / CSV). Exports an aggregate
 * analytics view to a downloadable artifact, computes a SHA-256 integrity hash, and
 * logs the requester identity (High-class audit). The exports route's
 * x-required-scope is "(scope of the exported view)" — a dynamic scope the BFF
 * middleware defers; the per-view scope is enforced here (and again when the view
 * service is invoked). Synchronous in the demo (well under the <30s p95 target).
 * Aggregate / synthetic data only — the views carry no PSU PII.
 */

/** view → the scope required to read it (mirrors the analytics route table). */
export const EXPORT_VIEW_SCOPE: Record<string, string> = {
  'executive-dashboard': 'platform:analytics:read',
  'operations-console': 'platform:operations:read',
  'compliance-view': 'compliance:reports:read',
  'risk-view': 'risk:read',
  'finance-view': 'reconciliation:read',
  'onboarding-funnel': 'pipeline:read',
  'nebras-liability-monitor': 'risk:read'
}
export const EXPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export class ExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ViewDataSource {
  /** Fetch the named view's data for this principal (the view service also asserts its own scope). */
  getViewData(view: string, principal: Principal): Promise<Record<string, unknown>>
}

/** Renders aggregate view data to export bytes. Demo profile: real CSV; pdf/xlsx are
 *  deterministic export documents — enterprise adapters render real binaries (M6). */
export interface ExportRenderer {
  render(view: string, format: ExportFormat, data: Record<string, unknown>): Uint8Array
}

/** The 202 body — ComplianceReport-shaped (the contract's Report response). The
 *  format is encoded in report_type; byte length + format also ride the audit. */
export interface ExportReceipt {
  id: string
  report_type: string
  status: string
  reporting_period_start: string
  reporting_period_end: string
  requested_by: string
  approved_by: string | null
  integrity_hash: string
  generated_at: string
  submitted_at: string | null
}

function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown =>
    v === null || typeof v !== 'object'
      ? v
      : Array.isArray(v)
        ? v.map(norm)
        : Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
  return JSON.stringify(norm(value))
}

function csvCell(v: unknown): string {
  const s = typeof v === 'object' && v !== null ? canonicalJson(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Demo renderer: CSV is a real key/value sheet; pdf/xlsx are deterministic export
 *  documents (a labelled header + canonical JSON) — viewer-grade binaries are an
 *  enterprise-adapter concern (M6). All three are stable bytes for the integrity hash. */
export class DemoExportRenderer implements ExportRenderer {
  render(view: string, format: ExportFormat, data: Record<string, unknown>): Uint8Array {
    if (format === 'csv') {
      const rows = ['key,value', ...Object.keys(data).sort().map((k) => `${csvCell(k)},${csvCell(data[k])}`)]
      return new TextEncoder().encode(rows.join('\n') + '\n')
    }
    const header = `OFBO Analytics Export (demo ${format})\nview: ${view}\n\n`
    return new TextEncoder().encode(header + canonicalJson({ view, data }))
  }
}

export interface AnalyticsExportDeps {
  views: ViewDataSource
  audit: HighClassAuditSink
  renderer?: ExportRenderer
  now?: () => Date
}

export class AnalyticsExportService {
  private readonly renderer: ExportRenderer
  private readonly now: () => Date
  constructor(private readonly deps: AnalyticsExportDeps) {
    this.renderer = deps.renderer ?? new DemoExportRenderer()
    this.now = deps.now ?? (() => new Date())
  }

  async export(principal: Principal, input: { view?: string; format?: string }, traceId: string): Promise<ExportReceipt> {
    const view = input.view ?? ''
    const format = input.format ?? ''
    const scope = EXPORT_VIEW_SCOPE[view]
    if (!scope) throw new ExportError('BACKOFFICE.INVALID_VIEW', `Unknown view "${view}". One of: ${Object.keys(EXPORT_VIEW_SCOPE).join(', ')}.`, 400)
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new ExportError('BACKOFFICE.INVALID_FORMAT', 'format must be one of: pdf, xlsx, csv.', 400)
    // Service-layer enforcement of the dynamic "(scope of the exported view)".
    assertScope(principal, scope)
    // The view service re-asserts its own scope and returns the aggregate data.
    const data = await this.deps.views.getViewData(view, principal)
    const bytes = this.renderer.render(view, format as ExportFormat, data)
    const integrity_hash = createHash('sha256').update(bytes).digest('hex')
    const now = this.now().toISOString()

    await this.deps.audit.emit({
      event_type: 'analytics_export',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: scope,
      request_trace_id: traceId,
      request_body: { view, format, integrity_hash, byte_length: bytes.length },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return {
      id: randomUUID(),
      report_type: `analytics_export:${view}:${format}`,
      status: 'archived',
      reporting_period_start: now,
      reporting_period_end: now,
      requested_by: principal.subject,
      approved_by: null,
      integrity_hash,
      generated_at: now,
      submitted_at: null
    }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function analyticsExportRoutes(service: AnalyticsExportService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'post /back-office/analytics/exports': async (c) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
          400
        )
      }
      let body: { view?: string; format?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { view, format }.', DOCS_BASE), 400)
      }
      const cacheKey = `analytics:export|${body.view ?? ''}|${body.format ?? ''}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const receipt = await service.export(c.get('principal'), body, traceId)
        const res = c.json(dataEnvelope(receipt), 202)
        await idempotency.set(cacheKey, 202, await res.clone().json())
        return res
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        if (e instanceof ExportError) return c.json(errorEnvelope(e.code, e.message, 'See the analytics exports contract (BACKOFFICE-41).', DOCS_BASE), e.status as ContentfulStatusCode)
        throw e
      }
    }
  }
}
