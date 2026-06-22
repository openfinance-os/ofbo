import Link from 'next/link'
import { SectionCard, Gauge } from './ui'
import { formatExpiry } from './approvals-portal'
import { formatSummaryMoney, type ApprovalRequest } from '../lib/approvals'

/**
 * UIF-06 — bespoke "Executive Command" dashboard panels (ADR 0016, Stitch d8515d63), built
 * on the UIF-01/01b primitives and bound to live data (no Stitch mock values):
 *  - SystemHealthPanel: a radial Gauge of the reconciliation pass rate (the headline health
 *    signal — Stitch's "System Heartbeat" dial), from the latest completed run.
 *  - FourEyesQueuePanel: the pending-approvals queue as deep-links to /approvals/{id} with the
 *    NON-PII operation summary. It NEVER renders inline approve/reject — four-eyes is 202 +
 *    approval, executed BFF-side by a second, differently-authorised principal.
 * Token-only (no raw hex/px).
 */

export function SystemHealthPanel({ passRate }: { passRate: number }) {
  return (
    <SectionCard title="System Health" testid="system-health-panel">
      <div className="flex items-center gap-5 p-4">
        <Gauge value={passRate} max={100} unit="%" label="Reconciliation pass rate" />
        <div className="min-w-0 text-sm">
          <p className="font-bold text-on-surface">Reconciliation pass rate</p>
          <p className="mt-1 text-on-surface-variant">
            Matched lines on the latest completed reconciliation run — the back office&apos;s
            headline health signal.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

const humanizeOp = (op: string) => op.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function FourEyesQueuePanel({ approvals, now = Date.now() }: { approvals: ApprovalRequest[]; now?: number }) {
  const meta =
    approvals.length > 0 ? (
      <span className="rounded-full bg-secondary-fixed px-2 py-0.5 text-xs font-bold text-on-secondary-fixed">{approvals.length}</span>
    ) : undefined
  return (
    <SectionCard title="Four-Eyes Queue" testid="four-eyes-queue-panel" meta={meta}>
      {approvals.length === 0 ? (
        <p className="p-4 text-sm text-on-surface-variant">No pending four-eyes approvals for your scope.</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {approvals.map((a) => {
            const expiry = formatExpiry(a.expires_at, now)
            const money = formatSummaryMoney(a.operation_summary?.amount)
            const bits = [a.operation_summary?.descriptor, money, a.operation_summary?.counterparty_label].filter(Boolean)
            return (
              <li key={a.approval_request_id}>
                <Link
                  href={`/approvals/${a.approval_request_id}`}
                  data-testid={`queue-row-${a.approval_request_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{humanizeOp(a.operation_type)}</p>
                    {bits.length ? <p className="truncate text-xs text-on-surface-variant">{bits.join(' · ')}</p> : null}
                  </div>
                  <span className={`shrink-0 font-mono text-xs ${expiry.urgent ? 'text-breach' : 'text-on-surface-variant'}`}>
                    {expiry.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
