import { formatSummaryMoney, type ApprovalOperationSummary } from '../lib/approvals'

/**
 * UX-03c / ADR 0014 — render the NON-PII operation summary on the four-eyes surface so the
 * second approver can exercise a real judgment. Display-only: the BFF already redacted to
 * non-PII institutional facts (amount, masked counterparty, descriptor). Renders nothing when
 * the summary is absent (older requests / unmodelled operation types).
 */
export function OperationSummary({ summary, testid }: { summary?: ApprovalOperationSummary | null; testid?: string }) {
  if (!summary) return null
  const money = formatSummaryMoney(summary.amount)
  if (!summary.descriptor && !money && !summary.counterparty_label) return null
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3 space-y-1" data-testid={testid ?? 'operation-summary'}>
      <p className="text-xs text-on-surface-variant uppercase tracking-wider">What you’re approving</p>
      {summary.descriptor ? <p className="text-sm text-on-surface">{summary.descriptor}</p> : null}
      {money ? (
        <p className="text-sm font-mono text-on-surface" data-testid="operation-summary-amount">
          {money}
        </p>
      ) : null}
      {summary.counterparty_label ? (
        <p className="text-xs text-on-surface-variant">Counterparty: {summary.counterparty_label}</p>
      ) : null}
    </div>
  )
}
