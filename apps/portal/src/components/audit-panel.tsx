import type { AuditEventSummary } from '@ofbo/db'

/**
 * "Audit record emitted and visible" (M1 exit criterion). Renders recent
 * High-class events for the signed-in principal. Every field shown is non-PII —
 * redaction happens at emission, so these projections are safe to display.
 */
export function AuditPanel({ events }: { events: AuditEventSummary[] }) {
  return (
    <section aria-label="audit trail" data-testid="audit-panel">
      <h2>Audit trail (High-class, INSERT-only)</h2>
      {events.length === 0 ? (
        <p data-testid="audit-empty">No audit events visible for this session yet.</p>
      ) : (
        <table data-testid="audit-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Persona</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Trace id</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} data-testid="audit-row" data-event-type={e.event_type}>
                <td>{e.event_type}</td>
                <td>{e.acting_persona}</td>
                <td>{e.scope_used}</td>
                <td>{e.response_status}</td>
                <td className="trace-id">{e.request_trace_id}</td>
                <td>{e.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
