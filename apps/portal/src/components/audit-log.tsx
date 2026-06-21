import { AUDIT_EVENT_TYPES, type AuditLogEvent } from '../lib/audit-log'
import { ErrorBanner } from './ui/feedback'

/**
 * DEMO-01 — global High-class audit log. A GET filter form (event type + optional acting
 * principal) so an auditor can answer "who revoked consent / did X" across all reps — the
 * Dashboard panel only shows your OWN actions. Read-only, non-PII (redacted at emission),
 * token-only styling. The form is a plain GET so the URL carries the filter (shareable,
 * server-rendered, no client JS).
 */
export function AuditLog({
  events,
  filters,
  error
}: {
  events: AuditLogEvent[]
  filters: { event_type: string; acting_principal: string }
  error: string | null
}) {
  return (
    <section aria-label="audit log" data-testid="audit-log" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-on-surface">Audit Log</h1>
        <p className="text-on-surface-variant text-sm">
          High-class, INSERT-only record of every regulated action — across all operators.
        </p>
      </header>

      <form method="GET" role="search" aria-label="filter audit events" className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
          Event type
          <select
            name="event_type"
            defaultValue={filters.event_type}
            data-testid="audit-filter-event-type"
            className="bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-on-surface"
          >
            {AUDIT_EVENT_TYPES.map((t) => (
              <option key={t || 'all'} value={t}>
                {t === '' ? 'All events' : t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
          Acting principal (optional)
          <input
            type="text"
            name="acting_principal"
            defaultValue={filters.acting_principal}
            placeholder="demo:customer-care-agent"
            data-testid="audit-filter-principal"
            className="bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-on-surface"
          />
        </label>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-primary text-on-primary font-medium cursor-pointer"
        >
          Filter
        </button>
      </form>

      {error ? (
        <ErrorBanner testid="audit-log-error">{error}</ErrorBanner>
      ) : events.length === 0 ? (
        <p data-testid="audit-log-empty" className="text-on-surface-variant text-sm">
          No audit events match this filter.
        </p>
      ) : (
        <table data-testid="audit-log-table" className="w-full text-sm text-left">
          <thead className="text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-2 pr-4">Event</th>
              <th className="py-2 pr-4">Acting principal</th>
              <th className="py-2 pr-4">Persona</th>
              <th className="py-2 pr-4">Scope</th>
              <th className="py-2 pr-4">PSU</th>
              <th className="py-2 pr-4">Consent</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">At</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} data-testid="audit-log-row" data-event-type={e.event_type} className="border-b border-outline-variant">
                <td className="py-2 pr-4 text-on-surface">{e.event_type}</td>
                <td className="py-2 pr-4 font-mono text-on-surface">{e.acting_principal ?? '—'}</td>
                <td className="py-2 pr-4 text-on-surface-variant">{e.acting_persona ?? '—'}</td>
                <td className="py-2 pr-4 text-on-surface-variant">{e.scope_used ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-on-surface-variant">{e.target_psu_identifier ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-on-surface-variant">{e.target_consent_id ? `${e.target_consent_id.slice(0, 8)}…` : '—'}</td>
                <td className="py-2 pr-4 text-on-surface-variant">{e.response_status ?? '—'}</td>
                <td className="py-2 pr-4 text-on-surface-variant">{e.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
