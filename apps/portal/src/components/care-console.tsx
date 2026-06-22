import { IDENTIFIER_TYPES, type CareConsent, type CareTimeline, type ConsentSearchResult, type IdentifierType, type CareWriteResult } from '../lib/care'
import { Notice, ErrorBanner, AuditNote } from './ui'
import { EventTimeline } from './care/event-timeline'
import { RevokeForm } from './care/revoke-form'
import { DisputeForm } from './care/dispute-form'

/**
 * UI-02 — Customer Care Console, translated from the Stitch "OFBO - Customer Care
 * Console (Hardened)" screen (project 8050269076066130289). Presentational + server-
 * rendered: a PSU Identity Lookup (native GET form → the page re-renders with results),
 * the consent inventory (per-consent admin revoke), the 24-month event history, and the
 * investigation module (one-click dispute). Token-only (no raw hex/px). DATA comes from
 * the OpenAPI contract via lib/care (no PSU PII beyond the searched identifier) — the
 * Stitch screen's masked name/accounts are appearance only; we render only what the
 * contract returns. Mutations are server actions, injected so the unit renders without Next.
 */

export interface CareConsoleProps {
  query?: { identifier_type?: string; identifier?: string }
  result?: ConsentSearchResult | null
  timeline?: CareTimeline | null
  timelineMoreHref?: string | null
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  notice?: string | null
  revokeAction?: (prevState: CareWriteResult, formData: FormData) => Promise<CareWriteResult>
  disputeAction?: (prevState: CareWriteResult, formData: FormData) => Promise<CareWriteResult>
}

/** Maps the 7 consent states to the OFBO status palette (PRD §7 triad + neutral). */
const STATUS_TONE: Record<string, string> = {
  Authorized: 'bg-reconciled/10 text-reconciled',
  AwaitingAuthorization: 'bg-break/10 text-break',
  Suspended: 'bg-break/10 text-break',
  Rejected: 'bg-breach/10 text-breach',
  Revoked: 'bg-breach/10 text-breach',
  Consumed: 'bg-surface-container-high text-on-surface-variant',
  Expired: 'bg-surface-container-high text-on-surface-variant'
}
const REVOCABLE = new Set(['Authorized', 'AwaitingAuthorization', 'Suspended'])

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-surface-container-high text-on-surface-variant'
  return (
    <span data-testid={`status-${status}`} className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  )
}

export function SearchForm({ query }: { query?: CareConsoleProps['query'] }) {
  const selected = (query?.identifier_type as IdentifierType) ?? 'bank_customer_id'
  return (
    <section className="bg-surface-container-lowest border border-outline-variant p-6 rounded-xl shadow-sm" data-testid="psu-lookup">
      <h2 className="font-bold text-primary flex items-center gap-2 mb-4">
        <span className="font-symbols text-base" aria-hidden>
          person_search
        </span>
        PSU Identity Lookup
        <span className="ml-auto text-xs font-mono bg-surface-container-high px-2 py-1 rounded text-on-surface-variant">Audited (high-sensitivity)</span>
      </h2>
      <form method="get" className="flex flex-wrap items-end gap-4" data-testid="search-form">
        <label className="flex-1 min-w-48">
          <span className="block text-xs font-bold text-on-primary-fixed-variant mb-1 uppercase tracking-wider">Identifier Type</span>
          <select
            name="identifier_type"
            defaultValue={selected}
            className="w-full bg-surface-container text-sm border border-outline-variant rounded-lg px-3 py-2 focus:border-secondary focus:ring-secondary"
          >
            {IDENTIFIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-[2] min-w-64">
          <span className="block text-xs font-bold text-on-primary-fixed-variant mb-1 uppercase tracking-wider">Search Value</span>
          <input
            name="identifier"
            defaultValue={query?.identifier ?? ''}
            placeholder="Enter identifier to fetch profile…"
            className="w-full bg-surface-container-lowest text-sm border border-outline-variant rounded-lg px-3 py-2 focus:ring-secondary focus:border-secondary"
          />
        </label>
        <button type="submit" className="bg-secondary text-on-secondary px-4 py-2 rounded-lg text-xs font-bold hover:bg-secondary-container transition-colors">
          Fetch profile
        </button>
        <a href="/care" className="border border-outline-variant text-on-surface-variant px-4 py-2 rounded-lg text-xs font-medium hover:bg-surface-container-low transition-colors">
          Clear
        </a>
      </form>
    </section>
  )
}

function ProfileCard({ psu }: { psu: ConsentSearchResult['psu'] }) {
  const initials = psu.bank_customer_id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '··'
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden" data-testid="profile-card">
      <div className="bg-surface-container px-4 py-3 border-b border-outline-variant flex justify-between items-center">
        <span className="font-bold text-xs text-primary uppercase tracking-widest">Customer Profile</span>
        <span className="text-xs px-2 py-0.5 bg-reconciled/10 text-reconciled font-bold rounded-full">Resolved</span>
      </div>
      <div className="p-4 flex items-center gap-4">
        <div className="w-12 h-12 bg-primary-container rounded-full flex items-center justify-center text-on-primary-container font-bold" aria-hidden>
          {initials}
        </div>
        <div>
          <p className="text-xs text-on-surface-variant uppercase tracking-wider">Internal customer id</p>
          <p className="font-mono text-sm text-primary" data-testid="psu-id">
            {psu.bank_customer_id}
          </p>
          <p className="text-xs text-on-surface-variant">
            {psu.account_count} linked account{psu.account_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  )
}

function ConsentRow({ consent, psu, identifierType, revokeAction }: { consent: CareConsent; psu: string; identifierType: string; revokeAction?: CareConsoleProps['revokeAction'] }) {
  return (
    <div className="p-4 flex items-center justify-between gap-4 hover:bg-surface-container-low transition-colors" data-testid={`consent-${consent.consent_id}`}>
      <div className="min-w-0">
        <p className="text-sm font-bold text-primary truncate">{consent.tpp.display_name}</p>
        <p className="text-xs text-on-surface-variant uppercase">{consent.purpose}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {consent.scope.map((s) => (
            <span key={s} className="text-xs bg-secondary-fixed text-on-secondary-fixed px-2 py-0.5 rounded">
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <StatusPill status={consent.status} />
        {REVOCABLE.has(consent.status) && revokeAction ? (
          <RevokeForm consent={consent} psu={psu} identifierType={identifierType} action={revokeAction} />
        ) : null}
      </div>
    </div>
  )
}

function InvestigationModule({ psu, identifierType, disputeAction }: { psu: string; identifierType: string; disputeAction?: CareConsoleProps['disputeAction'] }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-breach rounded-xl shadow-sm" data-testid="investigation-module">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-outline-variant">
        <span className="font-symbols text-breach text-lg" aria-hidden>
          warning
        </span>
        <span className="font-bold text-xs text-primary uppercase tracking-widest">Investigation Module</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-on-surface-variant leading-relaxed">Raise an unauthorized-payment dispute for this PSU. Refund initiation is four-eyes-gated downstream (BACKOFFICE-21).</p>
        {disputeAction ? <DisputeForm psu={psu} identifierType={identifierType} action={disputeAction} /> : null}
      </div>
    </div>
  )
}

export function CareConsole({ query, result, timeline, timelineMoreHref, error, errorRemediation, errorDocsUrl, notice, revokeAction, disputeAction }: CareConsoleProps) {
  const identifierType = query?.identifier_type ?? 'bank_customer_id'
  const identifier = result?.psu.bank_customer_id ?? query?.identifier ?? ''
  return (
    <div className="space-y-6" data-testid="care-console">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Customer Care Console</h1>
        <AuditNote />
      </div>
      <SearchForm query={query} />

      {notice ? <Notice testid="care-notice">{notice}</Notice> : null}

      {error ? <ErrorBanner testid="care-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>{error}</ErrorBanner> : null}

      {result ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <ProfileCard psu={result.psu} />
            <InvestigationModule psu={identifier} identifierType={identifierType} disputeAction={disputeAction} />
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm" data-testid="consents-panel">
              <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
                <h2 className="font-bold text-sm text-primary uppercase tracking-widest">Active TPP Consents</h2>
                <span className="bg-secondary-fixed text-on-secondary-fixed px-2 py-0.5 rounded text-xs font-bold">{result.consents.length} total</span>
              </div>
              <div className="divide-y divide-outline-variant">
                {result.consents.length === 0 ? (
                  <p className="p-4 text-xs text-on-surface-variant" data-testid="consents-empty">
                    No consents for this PSU.
                  </p>
                ) : (
                  result.consents.map((c) => <ConsentRow key={c.consent_id} consent={c} psu={identifier} identifierType={identifierType} revokeAction={revokeAction} />)
                )}
              </div>
            </div>
            {timeline ? <EventTimeline timeline={timeline} moreHref={timelineMoreHref} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
