import { createHash } from 'node:crypto'
import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { canonicalJson, toMinorUnitMoney, toWireMoneyTriple } from '@ofbo/billing'

/**
 * BILL-16 — the payable state of one cost period, as one read.
 *
 * The console needs close state, the payables the close authorises, and what is holding the period
 * open, and it needs them consistent with each other. Three separate endpoints would let a caller
 * render a period as closed beside a break that blocks it.
 *
 * `close_state` is DERIVED here rather than stored. There is no workflow column for it — the family
 * is INSERT-only with no UPDATE grant, so a mutable status could not exist even if it were wanted —
 * and deriving it from the two facts that do exist (is there a close row, are there open breaks)
 * means it cannot drift from them.
 */

export const PAYABLE_PERIOD_SCOPE = 'billing:read'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export class PayablePeriodError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation: string
  ) {
    super(message)
    this.name = 'PayablePeriodError'
  }
}

export interface StoredPeriodClose {
  closeId: string
  period: string
  initiatedBy: string
  approvedBy: string
  approvalRequestId: string
  feedsMonthlySignOff: boolean
  closedAt: string
}

export interface PeriodPayableRow {
  payableId: string
  period: string
  costRecipientType: 'nebras' | 'underlying_lfi'
  costRecipientId: string
  documentReference: string
  grossMilliFils: number
  netMilliFils: number
  vatMilliFils: number
  dispatchState: string | null
  dispatchedAt: string | null
  nettedAgainstMilliFils: number | null
}

export interface PayablePeriodStore {
  periodClose(period: string): Promise<StoredPeriodClose | null>
  /** BILL-17 — every payable artefact for the period, as one consistent snapshot. */
  evidencePack(period: string): Promise<TppCostEvidencePack>
  payablesForPeriod(period: string): Promise<PeriodPayableRow[]>
  openPayableBreaks(period: string): Promise<Array<{
    lineRef: string
    breakType: string
    costRecipientType: string
    costRecipientId: string
    varianceMilliFils: number
    reconciliationBreakId: string | null
  }>>
}

export interface TppCostEvidencePack {
  documents: unknown[]
  reconciliations: unknown[]
  diffLines: unknown[]
  closes: unknown[]
  dispatches: unknown[]
  /** Fields the store's read-boundary redactor scrubbed. Non-zero is worth investigating. */
  redactedPathCount?: number
}

export interface PayablePeriodDeps {
  store: PayablePeriodStore
  /**
   * Optional so the read model works without it. The EXPORT refuses rather than degrading when it
   * is absent — see `exportEvidence`.
   */
  audit?: HighClassAuditSink
  now?: () => Date
}

/** The pack's body, digest excluded. Shared by the issuer and by anyone recomputing it. */
export function tppCostEvidenceExportBody(input: {
  period: string
  generatedAt: string
  pack: TppCostEvidencePack
}): Record<string, unknown> {
  return {
    schema_version: '1',
    period: input.period,
    generated_at: input.generatedAt,
    record_counts: {
      documents: input.pack.documents.length,
      reconciliations: input.pack.reconciliations.length,
      diff_lines: input.pack.diffLines.length,
      closes: input.pack.closes.length,
      dispatches: input.pack.dispatches.length
    },
    documents: input.pack.documents,
    reconciliations: input.pack.reconciliations,
    diff_lines: input.pack.diffLines,
    closes: input.pack.closes,
    dispatches: input.pack.dispatches
  }
}

/**
 * Canonical digest over the body.
 *
 * `canonicalJson` sorts keys recursively, so two issues of the same period produce the same digest
 * regardless of column or property order — which is what makes a recipient's recomputation a real
 * check rather than a coin flip on serialisation order.
 */
export function tppCostEvidenceExportDigest(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

export class PayablePeriodService {
  constructor(private readonly deps: PayablePeriodDeps) {}

  async read(principal: Principal | undefined, period: string): Promise<Record<string, unknown>> {
    if (!principal) {
      throw new PayablePeriodError('BACKOFFICE.UNAUTHENTICATED', 'Authentication required.', 401,
        'Present a valid bearer token from the enterprise identity provider (P2).')
    }
    assertScope(principal, PAYABLE_PERIOD_SCOPE)
    if (!PERIOD.test(period)) {
      throw new PayablePeriodError('BACKOFFICE.INVALID_PERIOD', `Period ${period} is not YYYY-MM.`, 400,
        'Supply the cost period as YYYY-MM, e.g. 2026-06.')
    }

    const [close, payables, open] = await Promise.all([
      this.deps.store.periodClose(period),
      this.deps.store.payablesForPeriod(period),
      this.deps.store.openPayableBreaks(period)
    ])

    // Order matters: a closed period with open breaks reports `closed`, because the close is a fact
    // that happened and `blocked` would misreport history as a live refusal. Breaks raised after a
    // close are real and stay visible in `blockers` — they simply cannot un-close the period. The
    // re-check inside executeClose is what stops a break raised BEFORE approval slipping through.
    const closeState = close ? 'closed' : (open.length > 0 ? 'blocked' : 'open')

    return {
      period,
      close_state: closeState,
      closed_at: close?.closedAt ?? null,
      initiated_by: close?.initiatedBy ?? null,
      approved_by: close?.approvedBy ?? null,
      approval_request_id: close?.approvalRequestId ?? null,
      feeds_monthly_signoff: close?.feedsMonthlySignOff ?? true,
      open_break_count: open.length,
      blockers: open.map((entry) => ({
        line_ref: entry.lineRef,
        break_type: entry.breakType,
        cost_recipient_type: entry.costRecipientType,
        cost_recipient_id: entry.costRecipientId,
        // Money at the wire boundary, per the CODE-03 ruling: milli-fils is a storage and rating
        // precision, and everything the contract shows is integer minor units.
        variance: toMinorUnitMoney(entry.varianceMilliFils, 'AED'),
        reconciliation_break_id: entry.reconciliationBreakId
      })),
      payables: payables.map((row) => {
        // Gross is derived from the ROUNDED parts, never rounded independently. The source row's
        // CHECK guarantees net + VAT = gross in MILLI-fils; three separate half-up divisions break
        // that on the wire (2500 -> 3, 1500 -> 2, 4000 -> 4, and 3 + 2 is not 4), publishing a
        // contract violation over perfectly good evidence. toWireMoneyTriple is the repo's helper
        // for exactly this, and the sibling BILL-14 document route already uses it.
        const money = toWireMoneyTriple({
          netMilliFils: row.netMilliFils,
          vatMilliFils: row.vatMilliFils,
          grossMilliFils: row.grossMilliFils
        }, 'AED')
        return {
          payable_id: row.payableId,
          period: row.period,
          cost_recipient_type: row.costRecipientType,
          cost_recipient_id: row.costRecipientId,
          document_reference: row.documentReference,
          gross_amount: money.gross,
          net_amount: money.net,
          vat_amount: money.vat,
        // Null until the period closes. The payable exists as soon as a document reconciles; what
        // the close adds is the AUTHORITY to honour the debit, which is why this reads from the
        // close rather than from the payable's own row.
          approval_request_id: close?.approvalRequestId ?? null,
          dispatch_state: row.dispatchState,
          dispatched_at: row.dispatchedAt,
          netted_against: row.nettedAgainstMilliFils === null
            ? null
            : toMinorUnitMoney(row.nettedAgainstMilliFils, 'AED')
        }
      })
    }
  }

  /**
   * Issue the period's evidence pack (BILL-17).
   *
   * Audited on EVERY call, not only on anomalies: reading the whole evidence base for a period is a
   * disclosure event regardless of what it contains, and an export that leaves no trace is exactly
   * the one an investigator later cannot account for.
   *
   * The audit sink is REQUIRED here and optional for the read model above. A governed export whose
   * governance silently disappears when nobody wired a sink is not a governed export — so this
   * refuses rather than exporting unaudited.
   */
  async exportEvidence(
    principal: Principal | undefined,
    period: string,
    traceId: string
  ): Promise<Record<string, unknown>> {
    if (!principal) {
      throw new PayablePeriodError('BACKOFFICE.UNAUTHENTICATED', 'Authentication required.', 401,
        'Present a valid bearer token from the enterprise identity provider (P2).')
    }
    assertScope(principal, PAYABLE_PERIOD_SCOPE)
    if (!PERIOD.test(period)) {
      throw new PayablePeriodError('BACKOFFICE.INVALID_PERIOD', `Period ${period} is not YYYY-MM.`, 400,
        'Supply the cost period as YYYY-MM, e.g. 2026-06.')
    }
    const audit = this.deps.audit
    if (!audit) {
      throw new PayablePeriodError(
        'BACKOFFICE.EXPORT_NOT_GOVERNED',
        'The TPP cost evidence export is not configured with an audit sink, and an unaudited '
        + 'governed export is a contradiction.',
        503,
        'Configure the High-class audit sink before enabling the evidence export.'
      )
    }

    const pack = await this.deps.store.evidencePack(period)
    const generatedAt = (this.deps.now ?? (() => new Date()))().toISOString()
    const body = tppCostEvidenceExportBody({ period, generatedAt, pack })
    const sha256 = tppCostEvidenceExportDigest(body)

    await audit.emit({
      event_type: 'billing_tpp_cost_evidence_exported',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: PAYABLE_PERIOD_SCOPE,
      superadmin_marker: principal.scopes.includes('platform:superadmin'),
      request_trace_id: traceId,
      response_status: 200,
      // The digest and the counts, never the pack. The audit trail records WHAT was disclosed and
      // that it can be identified later; copying the evidence into the audit table would duplicate
      // the whole ledger into a second INSERT-only store on every download.
      // The scrub count rides the audit row: if the read-boundary redactor had to remove anything,
      // that means unredacted provider content had reached the ledger, and the investigation starts
      // from this record rather than from someone noticing the file looked odd.
      request_body: {
        period,
        sha256,
        record_counts: body.record_counts,
        redacted_path_count: pack.redactedPathCount ?? 0
      }
    })

    return { ...body, sha256 }
  }
}
