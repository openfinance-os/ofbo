import { createHash } from 'node:crypto'
import { redactPii } from '@ofbo/redaction'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ComplianceReportCreateInput, StoredComplianceReport } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'
import type { ConsentDirectory, IdentifierType } from '../consents/directory.js'
import type { ConsentEventSource } from '../consents/audit-trail.js'
import type { DisputeStore } from '../disputes/service.js'
import type { PaymentSource } from '../disputes/payments.js'

/**
 * BACKOFFICE-23 — per-PSU CBUAE inquiry bundle. Aggregates the PSU's 24-month
 * consent trail, payment records + CoP outcomes, and disputes, computes a
 * line-level integrity hash for every record plus an overall bundle hash, and
 * persists a compliance_report (202 + Report). compliance:reports:generate at
 * both layers; the bundle content is PII-redacted at persistence.
 */

export const INQUIRY_SCOPE = 'compliance:reports:generate'
export const INQUIRY_REPORT_TYPE = 'cbuae_psu_inquiry'
const VALID_IDENTIFIER_TYPES: IdentifierType[] = ['bank_customer_id', 'iban', 'emirates_id']
const MAX_PERIOD_MONTHS = 24

export class InquiryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ComplianceReportStore {
  create(input: ComplianceReportCreateInput, traceId: string): Promise<StoredComplianceReport>
  get(id: string): Promise<StoredComplianceReport | null>
}

export interface InquiryBundleDeps {
  consents: ConsentDirectory
  payments: PaymentSource
  disputes: DisputeStore
  events: ConsentEventSource
  reports: ComplianceReportStore
  audit: HighClassAuditSink
  now?: () => Date
}

function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(norm)
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, norm((v as Record<string, unknown>)[k])])
    )
  }
  return JSON.stringify(norm(value))
}
const lineHash = (line: unknown): string => createHash('sha256').update(canonical(line)).digest('hex')

export class InquiryBundleService {
  private readonly now: () => Date
  constructor(private readonly deps: InquiryBundleDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async generate(
    principal: Principal,
    input: { psu_identifier_type?: string; psu_identifier?: string; period_months?: number },
    traceId: string
  ): Promise<StoredComplianceReport> {
    assertScope(principal, INQUIRY_SCOPE)
    if (!input.psu_identifier_type || !input.psu_identifier) {
      throw new InquiryError('BACKOFFICE.INVALID_BODY', 'psu_identifier_type and psu_identifier are required.', 400)
    }
    if (!VALID_IDENTIFIER_TYPES.includes(input.psu_identifier_type as IdentifierType)) {
      throw new InquiryError('BACKOFFICE.INVALID_IDENTIFIER_TYPE', 'psu_identifier_type must be bank_customer_id, iban, or emirates_id.', 400)
    }
    const periodMonths = Math.min(Math.max(input.period_months ?? MAX_PERIOD_MONTHS, 1), MAX_PERIOD_MONTHS)

    const psu = this.deps.consents.search(input.psu_identifier_type as IdentifierType, input.psu_identifier)
    if (!psu) throw new InquiryError('BACKOFFICE.PSU_NOT_FOUND', 'No PSU matches that identifier.', 404)
    const psuId = psu.psu.bank_customer_id

    // Aggregate the four sections from the M2 data sources (internal id — no raw PII).
    const payments = this.deps.payments.byPsu(psuId)
    const disputes = (await this.deps.disputes.list({ psu_identifier: psuId, limit: MAX_PERIOD_MONTHS * 50 })).rows
    const consentTrail = (await this.deps.events.byPsu(psuId, { limit: 200 })).events
    // Redact BEFORE hashing so the line-level hashes are computed over exactly
    // what is persisted — the store's redaction is idempotent, so a verifier can
    // re-hash the stored bundle and reproduce these hashes (evidence-grade).
    const sections = redactPii({
      consents: psu.consents,
      payments: payments.map((p) => ({
        payment_id: p.payment_id,
        ipp_status: p.ipp_status,
        cop_outcome: p.cop_outcome,
        consent_at_time_of_payment: p.consent_at_time_of_payment
      })),
      disputes,
      consent_trail: consentTrail
    }) as { consents: unknown[]; payments: unknown[]; disputes: unknown[]; consent_trail: unknown[] }

    // Line-level integrity hashes (one sha256 per record) + an overall bundle hash.
    const line_hashes = Object.fromEntries(
      Object.entries(sections).map(([name, lines]) => [name, (lines as unknown[]).map(lineHash)])
    )
    const lineCount = Object.values(line_hashes).reduce((n, hs) => n + hs.length, 0)
    const end = this.now()
    const start = new Date(end)
    start.setUTCMonth(start.getUTCMonth() - periodMonths)
    const content = { psu: { bank_customer_id: psuId }, period_months: periodMonths, sections, line_hashes }
    const integrity_hash = createHash('sha256').update(canonical({ content_line_hashes: line_hashes, psu: psuId })).digest('hex')
    const generatedAt = end.toISOString()

    const report = await this.deps.reports.create(
      {
        report_type: INQUIRY_REPORT_TYPE,
        // Generated synchronously; awaiting the four-eyes CBUAE-submission approval (-35).
        status: 'awaiting_approval',
        reporting_period_start: start.toISOString(),
        reporting_period_end: generatedAt,
        classification: 'restricted',
        requested_by: principal.subject,
        integrity_hash,
        generated_at: generatedAt,
        content
      },
      traceId
    )

    await this.deps.audit.emit({
      event_type: 'inquiry_bundle_generated',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: INQUIRY_SCOPE,
      target_psu_identifier: psuId,
      request_trace_id: traceId,
      request_body: { report_id: report.id, integrity_hash, line_count: lineCount, period_months: periodMonths },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return report
  }
}

/** No-database default (tests / local dev). */
export class InMemoryComplianceReportStore implements ComplianceReportStore {
  private readonly rows: StoredComplianceReport[] = []
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
    return record
  }
  async get(id: string): Promise<StoredComplianceReport | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function inquiryRoutes(service: InquiryBundleService, idempotency: IdempotencyStore): Record<string, Handler> {
  const handler: Handler = async (c) => {
    let body: { psu_identifier_type?: string; psu_identifier?: string; period_months?: number }
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { psu_identifier_type, psu_identifier, period_months? }.', DOCS_BASE), 400)
    }
    const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
    try {
      const report = await service.generate(c.get('principal'), body, traceId)
      return c.json(dataEnvelope(report), 202)
    } catch (e) {
      const denied = scopeDenied(c, e)
      if (denied) return denied
      if (e instanceof InquiryError) {
        return c.json(errorEnvelope(e.code, e.message, 'See the CBUAE inquiry bundle contract (BACKOFFICE-23).', DOCS_BASE), e.status as ContentfulStatusCode)
      }
      throw e
    }
  }

  const withIdempotency: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(
        errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
        400
      )
    }
    const cacheKey = `inquiries:psu|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await handler(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }

  return { 'post /back-office/inquiries/psu': withIdempotency }
}
