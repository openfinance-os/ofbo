import { createHash } from 'node:crypto'
import type { ItsmPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { toWire, type ReportStore } from '../reports/generation.js'

/**
 * BACKOFFICE-67 — manual cadence ingest of the 16 login-only Nebras LFI reports.
 * The reports are downloaded from the Nebras portal (no API) and uploaded here:
 * the upload computes an integrity hash, writes a compliance_report record, and emits
 * BCBS 239 lineage (the same verified-ingest pattern as the billing-record upload,
 * BACKOFFICE-73). The cadence dashboard surfaces, per report type, the latest verified
 * ingest and whether it is overdue against its defined cadence. A headless monitor
 * raises an ITSM ticket + Risk signal (lfi_report_cadence_missed) on a missed cadence.
 */

export const LFI_READ_SCOPE = 'compliance:reports:read'
export const LFI_INGEST_SCOPE = 'compliance:reports:generate'
/** compliance_report.report_type prefix that namespaces LFI ingests. */
export const LFI_REPORT_PREFIX = 'lfi_report:'

export type LfiCadence = 'daily' | 'weekly' | 'monthly'

/**
 * The 16 login-only Nebras LFI report types + their ingest cadence (PRD §7: daily
 * availability/performance, weekly consent, monthly billing; the rest assigned to the
 * data class until the bank overrides). Adopting-bank-configurable.
 */
export const LFI_REPORT_TYPES: ReadonlyArray<{ report_type: string; cadence: LfiCadence }> = [
  { report_type: 'availability', cadence: 'daily' },
  { report_type: 'performance', cadence: 'daily' },
  { report_type: 'api_response_times', cadence: 'daily' },
  { report_type: 'error_rates', cadence: 'daily' },
  { report_type: 'consent', cadence: 'weekly' },
  { report_type: 'active_consents', cadence: 'weekly' },
  { report_type: 'revoked_consents', cadence: 'weekly' },
  { report_type: 'billing', cadence: 'monthly' },
  { report_type: 'payments', cadence: 'monthly' },
  { report_type: 'confirmation_of_payee', cadence: 'monthly' },
  { report_type: 'data_sharing_volumes', cadence: 'monthly' },
  { report_type: 'service_initiation', cadence: 'monthly' },
  { report_type: 'dispute_summary', cadence: 'monthly' },
  { report_type: 'fraud_summary', cadence: 'monthly' },
  { report_type: 'tpp_activity', cadence: 'monthly' },
  { report_type: 'sla_adherence', cadence: 'monthly' }
]
const CADENCE_BY_TYPE = new Map(LFI_REPORT_TYPES.map((t) => [t.report_type, t.cadence]))

const DAY_MS = 24 * 60 * 60 * 1000
const INTERVAL_MS: Record<LfiCadence, number> = { daily: DAY_MS, weekly: 7 * DAY_MS, monthly: 31 * DAY_MS }

export interface LfiReportCadenceStatus {
  report_type: string
  cadence: LfiCadence
  last_ingested_at: string | null
  last_period: string | null
  last_report_id: string | null
  next_due_at: string
  overdue: boolean
}

export class LfiReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Reporting-period bounds derived from the operator-supplied period label + cadence. */
function periodBounds(reportPeriod: string, cadence: LfiCadence, now: Date): { start: string; end: string } {
  const base = reportPeriod.length === 7 ? `${reportPeriod}-01` : reportPeriod // YYYY-MM -> first of month
  const parsed = new Date(base)
  const start = Number.isNaN(parsed.getTime()) ? now : parsed
  return { start: start.toISOString(), end: new Date(start.getTime() + INTERVAL_MS[cadence]).toISOString() }
}

function formatPeriod(startIso: string, cadence: LfiCadence): string {
  return cadence === 'monthly' ? startIso.slice(0, 7) : startIso.slice(0, 10)
}

/** Latest verified ingest per LFI report type + overdue computation. Shared by the
 *  scoped GET endpoint and the headless monitor. */
export async function computeCadence(reports: Pick<ReportStore, 'list'>, now: Date): Promise<LfiReportCadenceStatus[]> {
  const nowMs = now.getTime()
  const out: LfiReportCadenceStatus[] = []
  for (const { report_type, cadence } of LFI_REPORT_TYPES) {
    const page = await reports.list({ report_type: `${LFI_REPORT_PREFIX}${report_type}`, limit: 1 })
    const latest = page.rows[0] ?? null
    const lastIngestedAt = latest ? (latest.generated_at ?? latest.created_at) : null
    const nextDueAt = lastIngestedAt ? new Date(new Date(lastIngestedAt).getTime() + INTERVAL_MS[cadence]) : now
    out.push({
      report_type,
      cadence,
      last_ingested_at: lastIngestedAt,
      last_period: latest ? formatPeriod(latest.reporting_period_start, cadence) : null,
      last_report_id: latest?.id ?? null,
      next_due_at: nextDueAt.toISOString(),
      overdue: lastIngestedAt === null ? true : nowMs > nextDueAt.getTime()
    })
  }
  return out
}

export interface LfiReportServiceDeps {
  reports: Pick<ReportStore, 'create' | 'list'>
  audit: HighClassAuditSink
  now?: () => Date
}

export class LfiReportService {
  private readonly now: () => Date
  constructor(private readonly deps: LfiReportServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async cadenceStatus(principal: Principal): Promise<LfiReportCadenceStatus[]> {
    assertScope(principal, LFI_READ_SCOPE)
    return computeCadence(this.deps.reports, this.now())
  }

  async ingest(
    principal: Principal,
    input: { report_type?: string; report_period?: string; source_note?: string | null; fileBytes?: Uint8Array },
    traceId: string
  ): Promise<ReturnType<typeof toWire>> {
    assertScope(principal, LFI_INGEST_SCOPE)
    if (!input.report_type || !input.report_period) {
      throw new LfiReportError('BACKOFFICE.INVALID_BODY', 'report_type and report_period are required.', 400)
    }
    const cadence = CADENCE_BY_TYPE.get(input.report_type)
    if (!cadence) {
      throw new LfiReportError('BACKOFFICE.INVALID_REPORT_TYPE', `report_type must be one of the 16 LFI report types: ${LFI_REPORT_TYPES.map((t) => t.report_type).join(', ')}.`, 400)
    }
    if (!input.fileBytes || input.fileBytes.byteLength === 0) {
      throw new LfiReportError('BACKOFFICE.INVALID_BODY', 'A non-empty file is required (multipart/form-data).', 400)
    }

    const integrity_hash = createHash('sha256').update(Buffer.from(input.fileBytes)).digest('hex')
    const nowIso = this.now().toISOString()
    const { start, end } = periodBounds(input.report_period, cadence, this.now())
    const report = await this.deps.reports.create(
      {
        report_type: `${LFI_REPORT_PREFIX}${input.report_type}`,
        status: 'archived', // verified, immutable evidence record (retained; no further workflow)
        reporting_period_start: start,
        reporting_period_end: end,
        classification: 'internal-confidential',
        requested_by: principal.subject,
        integrity_hash,
        generated_at: nowIso,
        content: {
          lfi_report_type: input.report_type,
          report_period: input.report_period,
          source_note: input.source_note ?? null,
          file_sha256: integrity_hash,
          byte_length: input.fileBytes.byteLength
        }
      },
      traceId
    )

    await this.deps.audit.emit({
      event_type: 'lfi_report_ingested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: LFI_INGEST_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: report.id, report_type: input.report_type, report_period: input.report_period, integrity_hash, byte_length: input.fileBytes.byteLength },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return toWire(report)
  }
}

/** Risk-signal sink the cadence monitor emits to (satisfied by PgRiskSignalEmitter). */
export interface LfiRiskSignalSink {
  record(event: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; dedup_key?: string; context?: Record<string, unknown> }): Promise<void>
}

export interface LfiCadenceMonitorDeps {
  reports: Pick<ReportStore, 'list'>
  itsm?: Pick<ItsmPort, 'createTicket'>
  riskSignals?: LfiRiskSignalSink
  now?: () => Date
}

const RUN_PRINCIPAL = 'system:lfi-cadence-monitor'

export interface LfiCadenceMonitorResult extends LfiReportCadenceStatus {
  ticketed: boolean
  signalled: boolean
}

/**
 * BACKOFFICE-67 — headless monitor: any LFI report overdue against its cadence raises
 * a P3 ITSM ticket (Compliance team) + a Risk signal (lfi_report_cadence_missed), so a
 * missed manual ingest is not silently dropped. Wired into the worker's scheduled run.
 */
export class LfiCadenceMonitor {
  private readonly now: () => Date
  constructor(private readonly deps: LfiCadenceMonitorDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async check(traceId: string): Promise<LfiCadenceMonitorResult[]> {
    const statuses = await computeCadence(this.deps.reports, this.now())
    const out: LfiCadenceMonitorResult[] = []
    for (const s of statuses) {
      let ticketed = false
      let signalled = false
      if (s.overdue) {
        const summary = `LFI report '${s.report_type}' (${s.cadence}) ingest is overdue — last ingested ${s.last_ingested_at ?? 'never'}, due by ${s.next_due_at}.`
        if (this.deps.itsm) {
          await this.deps.itsm.createTicket({ type: 'lfi_report_cadence_missed', severity: 'high', team: 'compliance', summary }, { trace_id: traceId })
          ticketed = true
        }
        if (this.deps.riskSignals) {
          await this.deps.riskSignals.record({
            signal_type: 'lfi_report_cadence_missed',
            severity: 'medium',
            acting_principal: RUN_PRINCIPAL,
            summary,
            trace_id: traceId,
            dedup_key: `lfi-cadence:${s.report_type}`,
            context: { report_type: s.report_type, cadence: s.cadence, last_ingested_at: s.last_ingested_at, next_due_at: s.next_due_at }
          })
          signalled = true
        }
      }
      out.push({ ...s, ticketed, signalled })
    }
    return out
  }
}
