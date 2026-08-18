import {
  buildBillingQueryBundle,
  toMinorUnitMoney,
  reconcilePayable,
  type BillingQueryBundle,
  type ExpectedTppCostStatement,
  type LatePaymentRecord,
  type PayableBreak,
  type PayableReconciliation,
  type ReconcilableDocument
} from '@ofbo/billing'
import type { ItsmPort } from '@ofbo/ports'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../high-class-audit.js'

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

/**
 * BILL-15 — reconcile a provider cost document against our own metering (ADR 0007, IG v5.0 §10.13).
 *
 * The comparison itself is pure and lives in `@ofbo/billing`; this service supplies the evidence,
 * persists the outcome, and owns the two things a pure function cannot: the scope check, and the
 * decision to REFUSE rather than produce a misleading result.
 *
 * That refusal is the substance here. With no expected statement for the period, running anyway would
 * classify every provider line as an unexpected charge — a result that reads as a provider fault
 * when it is a missing projection on our side, and one an operator would reasonably raise a billing
 * query from. It is a 409, not an empty reconciliation.
 *
 * Reconciling is not approving. This endpoint records what was found; withholding a disputed period
 * from payable approval is BILL-16's gate, reading `openPayableBreaks`.
 */

/**
 * Mirrors the receivable `billing-records:reconcile` scope. Judging a counterparty's figures against
 * our own is one capability regardless of which way the money flows, and splitting it would put the
 * payable side outside the persona matrix that already governs reconciliation.
 */
export const RECONCILIATION_WRITE_SCOPE = 'finance:reconciliation:write'

/**
 * Carries its OWN remediation.
 *
 * The contract defines `remediation` as what the caller can do to resolve the error, so one string
 * shared across every failure is wrong by construction: telling someone whose document id does not
 * exist to ingest an expected statement sends them to fix something that is not broken. The route had
 * exactly that bug, and the route test only asserted the field was PRESENT — which is the difference
 * between claiming a control and evidencing it.
 */
export class TppCostReconcileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation: string
  ) {
    super(message)
    this.name = 'TppCostReconcileError'
  }
}

export interface TppCostReconcileStore {
  /** The period a document bills, or null when it is not this tenant's document. */
  documentPeriod(documentId: string): Promise<string | null>
  reconcilableDocumentsForPeriod(period: string): Promise<ReconcilableDocument[]>
  latestStatement(period: string): Promise<{ id: string; statement: ExpectedTppCostStatement } | null>
  saveReconciliation(
    input: {
      statementId: string
      reconciliationRunId: string
      result: Omit<PayableReconciliation, 'breaks'> & {
        breaks: ReadonlyArray<PayableBreak & { reconciliationBreakId?: string }>
      }
    },
    traceId: string
  ): Promise<{ reconciliationIds: string[]; created: boolean }>
}

/** Periods we actually paid late, which is what makes an IG §10.17 penalty legitimate. */
export interface LatePaymentSource {
  latePaymentsForPeriod(period: string): Promise<LatePaymentRecord[]>
}

export interface TppCostReconcileDeps {
  store: TppCostReconcileStore
  audit: HighClassAuditSink
  latePayments?: LatePaymentSource
  /** BD-21: the scheme default until the bank's agreement says otherwise. */
  queryWindowDays?: number
  toleranceMilliFils?: number
}

export interface TppCostReconcileResult {
  reconciliationIds: string[]
  created: boolean
  reconciliation: PayableReconciliation
}

export class TppCostReconcileService {
  constructor(private readonly deps: TppCostReconcileDeps) {}

  async reconcile(
    principal: Principal | undefined,
    documentId: string,
    idempotencyKey: string,
    traceId: string
  ): Promise<TppCostReconcileResult> {
    // Defence in depth: the auth middleware already guarantees a principal on this route, so this is
    // unreachable through HTTP. It stays because the service is callable from a scheduled job too.
    if (!principal) {
      throw new TppCostReconcileError(
        'BACKOFFICE.UNAUTHENTICATED', 'Authentication required.', 401,
        'Present a valid bearer token from the enterprise identity provider (P2).'
      )
    }
    assertScope(principal, RECONCILIATION_WRITE_SCOPE)

    // The document identifies the period; the period is what is actually reconciled. A Nebras invoice
    // reconciles BOTH cost components (IG §10.2), so judging it in isolation from the period's other
    // documents is what would let a charge on an LFI self-invoice be counted twice.
    const period = await this.periodFor(documentId)
    const documents = await this.deps.store.reconcilableDocumentsForPeriod(period)

    const statement = await this.deps.store.latestStatement(period)
    if (!statement) {
      throw new TppCostReconcileError(
        'BACKOFFICE.NO_EXPECTED_STATEMENT',
        `No expected cost statement exists for ${period}, so there is nothing to reconcile against. `
        + 'Running anyway would classify every provider line as an unexpected charge, which reads as a '
        + 'provider fault when it is a missing projection on our side.',
        409,
        `Generate the expected cost statement for ${period} (BILL-12) before reconciling its documents.`
      )
    }

    const latePayments = (await this.deps.latePayments?.latePaymentsForPeriod(period)) ?? []
    const result = reconcilePayable({
      expected: statement.statement,
      documents,
      latePayments,
      ...(this.deps.queryWindowDays === undefined ? {} : { queryWindowDays: this.deps.queryWindowDays }),
      ...(this.deps.toleranceMilliFils === undefined ? {} : { toleranceMilliFils: this.deps.toleranceMilliFils })
    })

    // The run id keys idempotency, so it must be derived from the request rather than generated: a
    // retried scheduled job would otherwise write a second copy into an INSERT-only ledger.
    const reconciliationRunId = `recon:${period}:${idempotencyKey || traceId}`
    const saved = await this.deps.store.saveReconciliation(
      { statementId: statement.id, reconciliationRunId, result }, traceId
    )

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_reconciled',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RECONCILIATION_WRITE_SCOPE,
      request_trace_id: traceId,
      response_status: 200,
      request_body: {
        period,
        document_id: documentId,
        reconciliation_run_id: reconciliationRunId,
        matched_line_count: result.matchedLineCount,
        break_count: result.breakCount,
        net_variance_milli_fils: result.netVarianceMilliFils,
        query_window_status: result.queryWindowStatus
      }
    })

    return { reconciliationIds: saved.reconciliationIds, created: saved.created, reconciliation: result }
  }

  private async periodFor(documentId: string): Promise<string> {
    const period = await this.deps.store.documentPeriod(documentId)
    if (!period) {
      // Tenant-scoped by the store's own RLS session, so another tenant's document is a 404 here
      // rather than a 403 — the existence of their document is not ours to disclose.
      throw new TppCostReconcileError(
        'BACKOFFICE.NOT_FOUND', `No cost document ${documentId} for this tenant.`, 404,
        'Check the document id against POST /back-office/billing/tpp-cost-documents, which returns it on ingest.'
      )
    }
    return period
  }
}

/**
 * Alert Finance and Ops while an unresolved break can still be queried.
 *
 * Fires on the approach to the deadline, not at it: a query raised on the last day still has to be
 * assembled, and IG §10.13 gives Nebras 10 days to respond after that. An alarm at expiry would only
 * report a right already lost.
 */
export interface BreakExpiryAlarmDeps {
  store: { openPayableBreaks(period: string): Promise<Array<{ lineRef: string; breakType: string }>> }
  itsm: ItsmPort
  audit: HighClassAuditSink
  now?: () => Date
  /** How many days before the deadline to alert. Config, like the window itself. */
  warnDaysBefore?: number
}

export interface BreakExpiryAlarmResult {
  status: 'clear' | 'not_due' | 'raised'
  openBreakCount: number
  daysRemaining: number
  ticketId?: string
}

export class PayableBreakExpiryAlarm {
  private readonly now: () => Date
  private readonly warnDaysBefore: number

  constructor(private readonly deps: BreakExpiryAlarmDeps) {
    this.now = deps.now ?? (() => new Date())
    this.warnDaysBefore = deps.warnDaysBefore ?? 7
  }

  async check(period: string, queryDeadline: string, traceId: string): Promise<BreakExpiryAlarmResult> {
    const open = await this.deps.store.openPayableBreaks(period)
    const daysRemaining = Math.ceil(
      (Date.parse(queryDeadline) - this.now().getTime()) / (24 * 60 * 60 * 1_000)
    )
    // No open break means nothing to lose, so the alarm stays quiet however close the deadline is.
    if (open.length === 0) return { status: 'clear', openBreakCount: 0, daysRemaining }
    if (daysRemaining > this.warnDaysBefore) {
      return { status: 'not_due', openBreakCount: open.length, daysRemaining }
    }

    const ticket = await this.deps.itsm.createTicket({
      type: 'billing.tpp_cost.query_window_closing',
      severity: daysRemaining < 0 ? 'high' : 'medium',
      team: 'finance-operations',
      summary: `${open.length} unresolved payable break(s) for ${period}; the IG §10.13 billing-query `
        + `window closes ${queryDeadline} (${daysRemaining} day(s) remaining). An unqueried break `
        + 'becomes an accepted charge once the window shuts.'
    }, { trace_id: traceId })

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_query_window_closing',
      acting_principal: 'system:payable-break-expiry-alarm',
      acting_persona: 'system',
      scope_used: SYSTEM_ACTOR_SCOPE,
      request_trace_id: traceId,
      response_status: SYSTEM_ACTOR_RESPONSE_STATUS,
      request_body: {
        period,
        query_deadline: queryDeadline,
        days_remaining: daysRemaining,
        open_break_count: open.length,
        ticket_id: ticket.ticket_id
      }
    })

    return {
      status: 'raised', openBreakCount: open.length, daysRemaining, ticketId: ticket.ticket_id
    }
  }
}

/** Assemble the IG §10.11.3 evidence bundle for one break. Refusals come from the domain builder. */
export function billingQueryFor(
  reconciliation: PayableReconciliation,
  entry: PayableBreak,
  parties: { lfiName: string; tppName: string; invoiceNumber: string; interactionId: string; occurredAt: string }
): BillingQueryBundle {
  return buildBillingQueryBundle({
    queryReference: `QRY-${reconciliation.period}-${entry.lineRef}`,
    raisedAt: reconciliation.queryDeadline,
    billingPeriod: reconciliation.period,
    invoiceNumber: parties.invoiceNumber,
    interactionId: parties.interactionId,
    occurredAt: parties.occurredAt,
    lfiName: parties.lfiName,
    tppName: parties.tppName,
    transactionDetail: {
      feeClass: entry.feeClass ?? 'unmapped',
      sourceCategory: entry.sourceCategory ?? 'n/a',
      units: entry.actualUnits,
      expectedNetMilliFils: entry.expectedNetMilliFils,
      actualNetMilliFils: entry.actualNetMilliFils
    },
    breakType: entry.breakType,
    reasonCode: entry.reasonCode,
    varianceMilliFils: entry.varianceMilliFils,
    queryDeadline: reconciliation.queryDeadline,
    daysRemaining: reconciliation.daysRemainingAtIngest
  })
}

/** Local shorthand; the currency is carried on the reconciliation, never assumed. */
function money(milliFils: number, currency: string) {
  return toMinorUnitMoney(milliFils, currency as 'AED')
}

export function tppCostReconciliationWire(result: PayableReconciliation): Record<string, unknown> {
  return {
    period: result.period,
    currency: result.currency,
    // A matching THRESHOLD, not an amount: its whole purpose is sub-fil resolution (documents state
    // fils, expectations are milli-fils), so expressing it in minor units would round it to nothing.
    tolerance_milli_fils: result.toleranceMilliFils,
    query_window_days: result.queryWindowDays,
    query_deadline: result.queryDeadline,
    query_window_status: result.queryWindowStatus,
    days_remaining_at_ingest: result.daysRemainingAtIngest,
    response_clocks: {
      first_response_minutes: result.responseClocks.firstResponseMinutes,
      final_response_days: result.responseClocks.finalResponseDays,
      escalation_review_days: result.responseClocks.escalationReviewDays
    },
    matched_line_count: result.matchedLineCount,
    break_count: result.breakCount,
    // Amounts cross to Money. These are independent totals rather than a net/VAT/gross triple, so
    // there is no tie-out to preserve between them and each rounds on its own.
    expected_total_net: money(result.expectedTotalNetMilliFils, result.currency),
    actual_total_net: money(result.actualTotalNetMilliFils, result.currency),
    net_variance: money(result.netVarianceMilliFils, result.currency),
    gross_variance: money(result.grossVarianceMilliFils, result.currency),
    penalty_lines_accepted: result.penaltyLinesAccepted,
    breaks: result.breaks.map((entry) => ({
      line_ref: entry.lineRef,
      break_type: entry.breakType,
      line_type: entry.lineType,
      presence: entry.presence,
      cost_recipient_type: entry.costRecipientType,
      cost_recipient_id: entry.costRecipientId,
      fee_class: entry.feeClass,
      source_category: entry.sourceCategory,
      expected_net: money(entry.expectedNetMilliFils, result.currency),
      actual_net: money(entry.actualNetMilliFils, result.currency),
      // Signed, and toMinorUnitMoney rounds symmetrically, so a credit is not biased against us.
      variance: money(entry.varianceMilliFils, result.currency),
      variance_basis_points: entry.varianceBasisPoints,
      material: entry.material,
      reason_code: entry.reasonCode,
      reconciliation_break_id: entry.reconciliationBreakId ?? null
    }))
  }
}

export function tppCostReconcileRoutes(
  service: TppCostReconcileService,
  idempotency: IdempotencyStore
): Record<string, Handler> {
  return {
    'post /back-office/billing/tpp-cost-documents/{document_id}:reconcile': replayable(
      idempotency,
      (params, subject, key) => `billing:tpp-cost-reconcile|${params.document_id}|${subject}|${key}`,
      async (c, params) => {
        const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
        const idempotencyKey = c.req.header('idempotency-key') ?? ''
        try {
          const result = await service.reconcile(
            c.get('principal'), params.document_id ?? '', idempotencyKey, traceId
          )
          return c.json(dataEnvelope(tppCostReconciliationWire(result.reconciliation)), 200)
        } catch (error) {
          if (error instanceof TppCostReconcileError) {
            return c.json(
              errorEnvelope(error.code, error.message, error.remediation, DOCS_BASE),
              error.status as ContentfulStatusCode
            )
          }
          const denied = scopeDenied(c, error)
          if (denied) return denied
          throw error
        }
      }
    )
  }
}
