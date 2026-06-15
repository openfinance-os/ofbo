import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ComplianceReportCreateInput, StoredComplianceReport, ComplianceReportListQuery, ComplianceReportPage } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { ApprovalsService, ApprovalError } from '../approvals/service.js'
import type { GatedOperation } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-35 — self-service CBUAE periodic report generation. Compliance
 * parameterises ENGINEERING-defined, pre-registered templates (period, scope,
 * classification, format). Generation builds deterministic content + a SHA-256
 * integrity hash and persists a compliance_report (5-yr archived, RLS + lineage).
 * CBUAE-bound reports are four-eyes-gated: generation lands awaiting_approval and a
 * Programme Manager (programme:read) resolves it via :approve through the approvals
 * service (initiator ≠ approver). :submit marks it submitted after the manual upload.
 * Aggregate / synthetic content only — PII redacted at persistence.
 */

export const REPORT_GENERATE_SCOPE = 'compliance:reports:generate'
export const REPORT_READ_SCOPE = 'compliance:reports:read'
export const REPORT_APPROVER_SCOPE = 'programme:read'
export const REPORT_GENERATION_OPERATION = 'compliance.report_generation'

export class ReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** A pre-registered report template — defined by engineering, parameterised by Compliance. */
interface ReportTemplate {
  cbuae_bound: boolean
  classification: string
  title: string
  build(params: { period_start: string; period_end: string; target_psu_identifier?: string; target_client_id?: string }): Record<string, unknown>
}

/** Engineering-defined templates (the only place report shapes are authored). */
export const REPORT_TEMPLATES: Record<string, ReportTemplate> = {
  cbuae_monthly: {
    cbuae_bound: true,
    classification: 'restricted',
    title: 'CBUAE Monthly Open Finance Return',
    build: (p) => ({ template: 'cbuae_monthly', title: 'CBUAE Monthly Open Finance Return', period_start: p.period_start, period_end: p.period_end, sections: ['consent_volumes', 'reconciliation_summary', 'liability_events'] })
  },
  cbuae_quarterly: {
    cbuae_bound: true,
    classification: 'restricted',
    title: 'CBUAE Quarterly Conduct Return',
    build: (p) => ({ template: 'cbuae_quarterly', title: 'CBUAE Quarterly Conduct Return', period_start: p.period_start, period_end: p.period_end, sections: ['disputes', 'fraud_signals', 'sla_posture'] })
  },
  internal_consent_volume: {
    cbuae_bound: false,
    classification: 'internal-confidential',
    title: 'Internal Consent Volume Report',
    build: (p) => ({ template: 'internal_consent_volume', title: 'Internal Consent Volume Report', period_start: p.period_start, period_end: p.period_end, sections: ['consent_volumes'] })
  }
}

function canonical(value: unknown): string {
  const norm = (v: unknown): unknown =>
    v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(norm) : Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
  return JSON.stringify(norm(value))
}
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface ReportStore {
  create(input: ComplianceReportCreateInput, traceId: string): Promise<StoredComplianceReport>
  get(id: string): Promise<StoredComplianceReport | null>
  getContent(id: string): Promise<unknown | null>
  markStatus(id: string, status: string, patch: { approved_by?: string | null; submitted_at?: string | null; approval_id?: string | null }, traceId?: string): Promise<StoredComplianceReport | null>
  list(query: ComplianceReportListQuery): Promise<ComplianceReportPage>
}

export interface GenerateInput {
  report_type?: string
  period_start?: string
  period_end?: string
  target_psu_identifier?: string
  target_client_id?: string
  output_formats?: string[]
}

export interface ReportGenerationDeps {
  store: ReportStore
  approvals: Pick<ApprovalsService, 'requestApproval' | 'approve'>
  audit: HighClassAuditSink
  now?: () => Date
}

/** The four-eyes executor for a CBUAE-bound report: on approval, the report is
 *  finalized to `approved`. Registered in the approvals registry. */
export function makeReportGenerationOperation(deps: { store: Pick<ReportStore, 'markStatus'> }): GatedOperation {
  return {
    initiatorScope: REPORT_GENERATE_SCOPE,
    approverScope: REPORT_APPROVER_SCOPE,
    execute: async (payload) => {
      const reportId = String(payload.report_id)
      const traceId = String(payload.trace_id ?? 'unknown')
      await deps.store.markStatus(reportId, 'approved', {}, traceId)
      return { report_id: reportId, status: 'approved' }
    }
  }
}

export function toWire(r: StoredComplianceReport) {
  return {
    id: r.id,
    report_type: r.report_type,
    status: r.status,
    reporting_period_start: r.reporting_period_start,
    reporting_period_end: r.reporting_period_end,
    requested_by: r.requested_by,
    approved_by: r.approved_by,
    integrity_hash: r.integrity_hash,
    generated_at: r.generated_at,
    submitted_at: r.submitted_at
  }
}

export class ReportGenerationService {
  private readonly now: () => Date
  constructor(private readonly deps: ReportGenerationDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async generate(principal: Principal, input: GenerateInput, traceId: string): Promise<StoredComplianceReport> {
    assertScope(principal, REPORT_GENERATE_SCOPE)
    if (!input.report_type || !input.period_start || !input.period_end) {
      throw new ReportError('BACKOFFICE.INVALID_REPORT_REQUEST', 'report_type, period_start and period_end are required.', 400)
    }
    const template = REPORT_TEMPLATES[input.report_type]
    if (!template) throw new ReportError('BACKOFFICE.UNKNOWN_TEMPLATE', `${input.report_type} is not a pre-registered report template.`, 400)
    if (!DATE.test(input.period_start) || !DATE.test(input.period_end) || input.period_start > input.period_end) {
      throw new ReportError('BACKOFFICE.INVALID_PERIOD', 'period_start/period_end must be ISO dates with start <= end.', 400)
    }
    const content = template.build({ period_start: input.period_start, period_end: input.period_end, ...(input.target_psu_identifier ? { target_psu_identifier: input.target_psu_identifier } : {}), ...(input.target_client_id ? { target_client_id: input.target_client_id } : {}) })
    const integrity_hash = sha256(canonical(content))
    const generated_at = this.now().toISOString()
    const start = `${input.period_start}T00:00:00.000Z`
    const end = `${input.period_end}T00:00:00.000Z`

    // CBUAE-bound → four-eyes: land awaiting_approval + an approval; a Programme
    // Manager resolves it via :approve. Non-CBUAE → ready immediately (approved).
    const report = await this.deps.store.create(
      { report_type: input.report_type, status: template.cbuae_bound ? 'awaiting_approval' : 'approved', reporting_period_start: start, reporting_period_end: end, classification: template.classification, requested_by: principal.subject, integrity_hash, generated_at, content },
      traceId
    )
    let finalReport = report
    if (template.cbuae_bound) {
      const approval = await this.deps.approvals.requestApproval(principal, { operation_type: REPORT_GENERATION_OPERATION, operation_payload: { report_id: report.id, trace_id: traceId } }, traceId)
      finalReport = (await this.deps.store.markStatus(report.id, 'awaiting_approval', { approval_id: approval.approval_request_id }, traceId)) ?? report
    }
    await this.deps.audit.emit({
      event_type: 'report_generation_requested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: REPORT_GENERATE_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: report.id, report_type: input.report_type, cbuae_bound: template.cbuae_bound, integrity_hash },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return finalReport
  }

  async list(principal: Principal, query: ComplianceReportListQuery): Promise<ComplianceReportPage> {
    assertScope(principal, REPORT_READ_SCOPE)
    return this.deps.store.list(query)
  }

  async get(principal: Principal, id: string): Promise<StoredComplianceReport> {
    assertScope(principal, REPORT_READ_SCOPE)
    const r = await this.deps.store.get(id)
    if (!r) throw new ReportError('BACKOFFICE.REPORT_NOT_FOUND', `No report ${id}.`, 404)
    return r
  }

  /** The download bytes + the integrity hash of those bytes. Real PDF/XLSX
   *  rendering is the downstream/enterprise concern (same posture as -06/-23);
   *  the demo serves a deterministic canonical serialization per format. */
  async download(principal: Principal, id: string, format: string): Promise<{ bytes: Uint8Array; sha256: string; content_type: string }> {
    assertScope(principal, REPORT_READ_SCOPE)
    if (format !== 'pdf' && format !== 'xlsx') throw new ReportError('BACKOFFICE.INVALID_FORMAT', 'format must be pdf or xlsx.', 400)
    const report = await this.deps.store.get(id)
    if (!report) throw new ReportError('BACKOFFICE.REPORT_NOT_FOUND', `No report ${id}.`, 404)
    const content = await this.deps.store.getContent(id)
    const serialized = canonical({ format, report_id: id, report_type: report.report_type, content })
    const bytes = new TextEncoder().encode(serialized)
    return { bytes, sha256: sha256(serialized), content_type: 'application/octet-stream' }
  }

  async approve(principal: Principal, id: string, traceId: string): Promise<StoredComplianceReport> {
    // The approver scope (programme:read) is enforced by the approvals service;
    // this endpoint is the four-eyes resolution, not itself a gated operation.
    const report = await this.deps.store.get(id)
    if (!report) throw new ReportError('BACKOFFICE.REPORT_NOT_FOUND', `No report ${id}.`, 404)
    if (!report.approval_id || report.status !== 'awaiting_approval') {
      throw new ReportError('BACKOFFICE.NOT_AWAITING_APPROVAL', 'Only a CBUAE-bound report awaiting approval can be approved.', 409)
    }
    await this.deps.approvals.approve(principal, report.approval_id, traceId) // enforces initiator ≠ approver + programme:read; executes the status flip
    const approved = (await this.deps.store.markStatus(id, 'approved', { approved_by: principal.subject }, traceId)) ?? report
    await this.deps.audit.emit({
      event_type: 'report_approved',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: REPORT_APPROVER_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: id, four_eyes_approved: true },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return approved
  }

  async submit(principal: Principal, id: string, traceId: string): Promise<StoredComplianceReport> {
    assertScope(principal, REPORT_GENERATE_SCOPE)
    const report = await this.deps.store.get(id)
    if (!report) throw new ReportError('BACKOFFICE.REPORT_NOT_FOUND', `No report ${id}.`, 404)
    if (report.status !== 'approved') throw new ReportError('BACKOFFICE.REPORT_NOT_APPROVED', 'Only an approved report can be marked submitted.', 409)
    const submitted = (await this.deps.store.markStatus(id, 'submitted', { submitted_at: this.now().toISOString() }, traceId)) ?? report
    await this.deps.audit.emit({
      event_type: 'report_submitted',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: REPORT_GENERATE_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: id },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return submitted
  }
}

/** No-database default (tests / local dev). */
export class InMemoryReportStore implements ReportStore {
  private readonly rows: StoredComplianceReport[] = []
  private readonly contents = new Map<string, unknown>()
  async create(input: ComplianceReportCreateInput): Promise<StoredComplianceReport> {
    const now = new Date().toISOString()
    const record: StoredComplianceReport = {
      id: crypto.randomUUID(),
      report_type: input.report_type,
      status: input.status,
      reporting_period_start: input.reporting_period_start,
      reporting_period_end: input.reporting_period_end,
      classification: input.classification ?? 'restricted',
      requested_by: input.requested_by,
      approved_by: input.approved_by ?? null,
      integrity_hash: input.integrity_hash ?? null,
      generated_at: input.generated_at ?? null,
      submitted_at: null,
      approval_id: input.approval_id ?? null,
      created_at: now
    }
    this.rows.push(record)
    this.contents.set(record.id, input.content ?? null)
    return record
  }
  async get(id: string): Promise<StoredComplianceReport | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async getContent(id: string): Promise<unknown | null> {
    return this.contents.get(id) ?? null
  }
  async markStatus(id: string, status: string, patch: { approved_by?: string | null; submitted_at?: string | null; approval_id?: string | null }): Promise<StoredComplianceReport | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    r.status = status
    if (patch.approved_by != null) r.approved_by = patch.approved_by
    if (patch.submitted_at != null) r.submitted_at = patch.submitted_at
    if (patch.approval_id != null) r.approval_id = patch.approval_id
    return r
  }
  async list(query: ComplianceReportListQuery = {}): Promise<ComplianceReportPage> {
    let rows = [...this.rows].reverse()
    if (query.report_type) rows = rows.filter((r) => r.report_type === query.report_type)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof ReportError) return c.json(errorEnvelope(e.code, e.message, 'See the report-generation contract (BACKOFFICE-35).', DOCS_BASE), e.status as ContentfulStatusCode)
  if (e instanceof ApprovalError) return c.json(errorEnvelope(e.code, e.message, 'CBUAE-bound report approval is four-eyes (a different programme:read principal approves).', DOCS_BASE), e.status as ContentfulStatusCode)
  throw e
}

function withIdempotency(idempotency: IdempotencyStore, routeKey: string, run: (c: Context, params: Record<string, string>) => Promise<Response>): Handler {
  return async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE), 400)
    }
    const cacheKey = `${routeKey}|${params.report_id ?? ''}|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await run(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }
}

export function reportRoutes(service: ReportGenerationService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'post /back-office/reports:generate': withIdempotency(idempotency, 'reports:generate', async (c) => {
      let body: GenerateInput
      try {
        body = (await c.req.json()) as GenerateInput
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send report_type, period_start, period_end.', DOCS_BASE), 400)
      }
      try {
        const report = await service.generate(c.get('principal'), body, c.req.header('x-fapi-interaction-id') ?? crypto.randomUUID())
        return c.json(dataEnvelope(toWire(report)), 202)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'get /back-office/reports': async (c) => {
      const q: ComplianceReportListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
        ...(c.req.query('report_type') ? { report_type: c.req.query('report_type') } : {}),
        ...(c.req.query('status') ? { status: c.req.query('status') } : {})
      }
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), q)
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/reports/{report_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.get(c.get('principal'), params.report_id!))), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/reports/{report_id}/download': async (c, params) => {
      try {
        const { bytes, sha256: hash, content_type } = await service.download(c.get('principal'), params.report_id!, c.req.query('format') ?? '')
        return new Response(bytes, { status: 200, headers: { 'content-type': content_type, 'x-content-sha256': hash } })
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/reports/{report_id}:approve': withIdempotency(idempotency, 'reports:approve', async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.approve(c.get('principal'), params.report_id!, c.req.header('x-fapi-interaction-id') ?? crypto.randomUUID()))), 200)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'post /back-office/reports/{report_id}:submit': withIdempotency(idempotency, 'reports:submit', async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.submit(c.get('principal'), params.report_id!, c.req.header('x-fapi-interaction-id') ?? crypto.randomUUID()))), 200)
      } catch (e) {
        return fail(c, e)
      }
    })
  }
}
