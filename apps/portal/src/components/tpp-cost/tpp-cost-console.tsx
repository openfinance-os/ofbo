import Link from 'next/link'
import {
  blockedVariance,
  dispatchSummary,
  formatMoney,
  humanizeCost,
  totalsByRecipient,
  type TppCostPeriod
} from '../../lib/tpp-cost'
import type { TppCostWriteResult } from '../../lib/tpp-cost-actions'
import { ContributionBar, ErrorBanner, KpiStat, SectionCard, StatStrip, StatusBadge } from '../ui'
import { DispatchPayableForm, RequestCloseForm } from './forms'

/**
 * BILL-17 — TPP Cost Management: the payable side of the billing console.
 *
 * The IA decision (one pass, per the story): this is a SECTION of the existing billing console
 * rather than a new top-level module. Receivables and payables are two halves of one commercial
 * position, and splitting them across modules would make "what is the bank's net position with the
 * scheme this month" a question you answer by opening two screens and doing arithmetic.
 *
 * Token-only, OpenAPI-bound, zero PII — the payable ledger carries no PSU identifiers by
 * construction (lines reference event ids; psu_id stays confined to billing_event), so there is
 * nothing to redact at this layer and nothing that could leak through it.
 *
 * Four-eyes is `202` + `approval_request`, never inline: the close control REQUESTS, and the
 * period shuts only when a second finance principal approves on the shared queue.
 */

type CostAction = (prev: TppCostWriteResult, fd: FormData) => Promise<TppCostWriteResult>

const CLOSE_TONE = {
  open: 'neutral',
  blocked: 'break',
  closed: 'reconciled'
} as const

function closeSummary(view: TppCostPeriod): string {
  if (view.close_state === 'closed') {
    return `Closed on a second principal's approval. Feeds the monthly sign-off.`
  }
  if (view.close_state === 'blocked') {
    return `${view.open_break_count} unresolved material break${view.open_break_count === 1 ? '' : 's'} must be `
      + 'resolved or escalated before the period can close.'
  }
  return 'No unresolved breaks. The period is ready for a four-eyes close.'
}

export function TppCostConsole({
  view,
  period,
  canWrite,
  approvalRequestId,
  error,
  errorRemediation,
  errorDocsUrl,
  closeAction,
  dispatchAction
}: {
  view: TppCostPeriod | null
  period: string
  canWrite: boolean
  approvalRequestId?: string | null
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  closeAction: CostAction
  dispatchAction: CostAction
}) {
  if (error) {
    return (
      <SectionCard title="TPP Cost Management" testid="tpp-cost-console">
        <ErrorBanner testid="tpp-cost-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>
          {error}
        </ErrorBanner>
      </SectionCard>
    )
  }
  if (!view) {
    return (
      <SectionCard title="TPP Cost Management" testid="tpp-cost-console">
        <p className="text-sm text-on-surface-variant" data-testid="tpp-cost-empty">
          No TPP cost data for {period}.
        </p>
      </SectionCard>
    )
  }

  const totals = totalsByRecipient(view.payables)
  const disputed = blockedVariance(view.blockers)
  const dispatch = dispatchSummary(view.payables)
  const closed = view.close_state === 'closed'

  return (
    <SectionCard
      title="TPP Cost Management"
      testid="tpp-cost-console"
      meta={
        <span data-testid="close-state">
          <StatusBadge status={CLOSE_TONE[view.close_state]} />
        </span>
      }
      action={
        <div className="flex items-center gap-3">
          {/* Governed export. Not gated on canWrite: reading the evidence base is a billing:read
              capability, and the people who most need to hand it to an auditor are usually the ones
              without write. The href points at the portal's own proxy, never the BFF — the httpOnly
              Bearer stays inside the Worker and the pack never lands in browser storage. */}
          <a
            href={`/api/billing/tpp-cost-export?period=${encodeURIComponent(period)}`}
            className="text-sm underline text-primary"
            data-testid="tpp-cost-export-link"
          >
            Export evidence
          </a>
          {canWrite ? (
            <RequestCloseForm
              period={period}
              action={closeAction}
              disabled={closed || view.close_state === 'blocked'}
              disabledReason={
                closed
                  ? 'This period is already closed. Correct it by re-rating, which appends an immutable delta.'
                  : `Blocked by ${view.open_break_count} unresolved material break(s).`
              }
            />
          ) : null}
        </div>
      }
    >
      {approvalRequestId ? (
        <p data-testid="close-approval-notice" className="text-sm text-on-surface-variant">
          Close requested — approval <code className="font-mono">{approvalRequestId}</code> is awaiting a second
          finance principal.{' '}
          <Link href="/approvals" className="underline text-primary">Open the approvals queue</Link>.
        </p>
      ) : null}

      {/* ADR 0007 keeps the three cost totals apart; one blended number would hide the only
          distinction the payable side is organised around. */}
      <StatStrip aria-label={`TPP cost position for ${period}`}>
        <KpiStat
          label="Total TPP cost"
          value={formatMoney(totals.total)}
          valueTestid="cost-total"
          sublabel={`${view.payables.length} payable${view.payables.length === 1 ? '' : 's'} · ${period}`}
        />
        <KpiStat label="Nebras Hub" value={formatMoney(totals.nebras)} valueTestid="cost-nebras" />
        <KpiStat label="Underlying LFIs" value={formatMoney(totals.underlyingLfi)} valueTestid="cost-lfi" />
        <KpiStat
          label="In dispute"
          value={formatMoney(disputed)}
          valueTestid="cost-disputed"
          sublabel={`${view.open_break_count} unresolved break${view.open_break_count === 1 ? '' : 's'}`}
          {...(view.open_break_count > 0 ? { trend: { label: 'blocking close', tone: 'break' as const } } : {})}
        />
        <KpiStat
          label="AP settled"
          value={`${dispatch.settled}/${view.payables.length}`}
          valueTestid="cost-dispatch"
          sublabel={`${dispatch.inFlight} in flight · ${dispatch.outstanding} outstanding`}
        />
      </StatStrip>

      <p data-testid="close-summary" className="text-sm text-on-surface-variant">{closeSummary(view)}</p>

      {view.payables.length > 0 ? (
        <ContributionBar
          label="Cost by recipient"
          segments={[
            { label: 'Nebras Hub', value: totals.nebras.amount },
            { label: 'Underlying LFIs', value: totals.underlyingLfi.amount }
          ]}
        />
      ) : null}

      {closed ? (
        <p data-testid="close-evidence" className="text-xs text-on-surface-variant">
          Closed {view.closed_at} · initiated by <code className="font-mono">{view.initiated_by}</code> · approved by{' '}
          <code className="font-mono">{view.approved_by}</code> · approval{' '}
          <code className="font-mono">{view.approval_request_id}</code>
        </p>
      ) : null}

      {/* Blockers first: the reason a period cannot close is more urgent than the payables it
          would authorise. */}
      {view.blockers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="cost-blockers">
            <caption className="sr-only">Unresolved material payable breaks holding {period} open</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-on-surface-variant">
                <th scope="col" className="py-2">Line</th>
                <th scope="col">Break</th>
                <th scope="col">Recipient</th>
                <th scope="col">Variance</th>
                <th scope="col">E1 break</th>
              </tr>
            </thead>
            <tbody>
              {view.blockers.map((blocker) => (
                <tr key={blocker.line_ref} className="border-t border-outline-variant">
                  <td className="py-2 font-mono text-xs">{blocker.line_ref}</td>
                  <td>{humanizeCost(blocker.break_type)}</td>
                  <td>{blocker.cost_recipient_id}</td>
                  <td className="font-mono tabular-nums">{formatMoney(blocker.variance)}</td>
                  <td>
                    {blocker.reconciliation_break_id ? (
                      <Link
                        href={`/reconciliation/breaks/${blocker.reconciliation_break_id}`}
                        className="underline text-primary font-mono text-xs"
                      >
                        Investigate →
                      </Link>
                    ) : (
                      // A null id means raised but not yet escalated. Saying so beats an empty cell,
                      // which reads as "nothing to do".
                      <span className="text-xs text-on-surface-variant">not yet escalated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="cost-payables">
          <caption className="sr-only">Payables established for {period}</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-on-surface-variant">
              <th scope="col" className="py-2">Document</th>
              <th scope="col">Recipient</th>
              <th scope="col">Net</th>
              <th scope="col">VAT</th>
              <th scope="col">Gross (debited)</th>
              <th scope="col">AP status</th>
              {canWrite ? <th scope="col">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {view.payables.map((payable) => (
              <tr key={payable.payable_id} className="border-t border-outline-variant">
                <td className="py-2 font-mono text-xs">{payable.document_reference}</td>
                <td>
                  {payable.cost_recipient_id}
                  <span className="ml-1 text-xs text-on-surface-variant">
                    ({humanizeCost(payable.cost_recipient_type)})
                  </span>
                </td>
                <td className="font-mono tabular-nums" data-testid={`net-${payable.payable_id}`}>
                  {formatMoney(payable.net_amount)}
                </td>
                <td className="font-mono tabular-nums">{formatMoney(payable.vat_amount)}</td>
                <td className="font-mono tabular-nums">{formatMoney(payable.gross_amount)}</td>
                <td>
                  <StatusBadge status={payable.dispatch_state ?? 'none'} />
                </td>
                {canWrite ? (
                  <td>
                    <DispatchPayableForm
                      payableId={payable.payable_id}
                      action={dispatchAction}
                      // Authority to honour a debit belongs to the PERIOD, so an unclosed period
                      // leaves every payable under it unauthorised.
                      disabled={!payable.approval_request_id || payable.dispatch_state === 'accepted'}
                      disabledReason={
                        payable.approval_request_id
                          ? 'This debit has already been honoured.'
                          : 'The cost period has not closed, so no four-eyes approval authorises this debit.'
                      }
                    />
                  </td>
                ) : null}
              </tr>
            ))}
            {view.payables.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 7 : 6} className="py-3 text-on-surface-variant" data-testid="payables-empty">
                  No payables reconciled for {period} yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
