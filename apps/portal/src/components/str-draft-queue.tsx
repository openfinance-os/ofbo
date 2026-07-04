import type { StrDraft } from '../lib/str-drafts'
import { ErrorBanner, StatusBadge, LoadMore } from './ui'

/**
 * BACKOFFICE-63 — STR draft queue, the Compliance surface for Suspicious Transaction Report
 * drafts (ADR 0022). Translated against the Stitch "Regulated Institutional Interface" design
 * system (project 8050269076066130289) with the shared token-only primitives. Server-rendered,
 * OpenAPI-bound: lists STR drafts (compliance:reports:read). Read-only here — handing a draft to
 * the bank's STR workflow is FOUR-EYES and initiated from the approvals surface, never inline;
 * the Back Office never submits to the CBUAE AML GO portal directly. NO PSU PII — a draft shows
 * an internal consent ref + case context only.
 */
export interface StrDraftQueueProps {
  drafts?: StrDraft[]
  moreHref?: string | null
  error?: string | null
}

const th = 'px-4 py-2 text-left font-semibold text-on-surface-variant'
const td = 'px-4 py-3 align-top'

export function StrDraftQueue({ drafts = [], moreHref = null, error }: StrDraftQueueProps) {
  return (
    <section className="space-y-4" aria-labelledby="str-drafts-heading" data-testid="str-draft-queue">
      <header className="space-y-1">
        <h2 id="str-drafts-heading" className="text-lg font-bold text-on-surface">
          STR drafts
        </h2>
        <p className="text-sm text-on-surface-variant">
          Suspicious Transaction Report drafts raised by a fraud-suspected revocation, held for Compliance review. Handing a draft to the
          bank&rsquo;s STR workflow is four-eyes — initiated from the approvals queue, never inline. The Back Office never files with AML GO
          directly. No PSU personal data is shown.
        </p>
      </header>

      {error ? (
        <ErrorBanner testid="str-drafts-error">{error}</ErrorBanner>
      ) : (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
          {drafts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-on-surface-variant" data-testid="str-drafts-empty">
              No STR drafts in the queue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-outline-variant text-xs uppercase tracking-wider">
                  <tr>
                    <th scope="col" className={th}>Consent ref</th>
                    <th scope="col" className={th}>Case context</th>
                    <th scope="col" className={th}>Status</th>
                    <th scope="col" className={th}>Raised by</th>
                    <th scope="col" className={th}>Raised</th>
                    <th scope="col" className={th}>Workflow ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {drafts.map((d) => (
                    <tr key={d.str_draft_id} data-testid={`str-draft-row-${d.str_draft_id}`}>
                      <td className={td}>
                        <span className="font-mono text-xs text-on-surface-variant">{d.source_consent_id}</span>
                      </td>
                      <td className={`${td} max-w-md text-on-surface`}>{d.case_context}</td>
                      <td className={td}>
                        <StatusBadge status={d.status} />
                      </td>
                      <td className={`${td} text-on-surface-variant`}>{d.created_by}</td>
                      <td className={`${td} whitespace-nowrap text-on-surface-variant`}>{d.created_at.slice(0, 10)}</td>
                      <td className={td}>
                        {d.workflow_ref ? (
                          <span className="font-mono text-xs text-on-surface-variant">{d.workflow_ref}</span>
                        ) : (
                          <span className="text-on-surface-variant">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore moreHref={moreHref} shown={drafts.length} noun="drafts" />
        </div>
      )}
    </section>
  )
}
