import type { AuditEventSummary } from '@ofbo/db'

/**
 * "Audit record emitted and visible" (M1 exit criterion). Renders recent
 * High-class events for the signed-in principal. Every field shown is non-PII —
 * redaction happens at emission, so these projections are safe to display.
 */
export function AuditPanel({ events }: { events: AuditEventSummary[] }) {
  return (
    <section
      aria-label="audit trail"
      data-testid="audit-panel"
      className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden"
    >
      <h2 className="px-container-padding py-3 border-b border-outline-variant text-sm font-bold uppercase tracking-wider text-on-surface">
        Audit trail (High-class, INSERT-only)
      </h2>
      {events.length === 0 ? (
        <p data-testid="audit-empty" className="px-container-padding py-4 text-sm text-on-surface-variant">
          No audit events visible for this session yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="audit-table" className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-outline-variant">
                {['Event', 'Persona', 'Scope', 'Status', 'Trace id', 'At'].map((h) => (
                  <th
                    key={h}
                    className="text-left font-bold text-on-surface-variant uppercase tracking-wider px-container-padding py-2 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  data-testid="audit-row"
                  data-event-type={e.event_type}
                  className="border-b border-outline-variant/40 last:border-0 hover:bg-surface-container"
                >
                  <td className="px-container-padding py-2 align-top text-on-surface whitespace-nowrap">{e.event_type}</td>
                  <td className="px-container-padding py-2 align-top text-on-surface-variant whitespace-nowrap">{e.acting_persona}</td>
                  <td className="px-container-padding py-2 align-top text-on-surface-variant whitespace-nowrap">{e.scope_used}</td>
                  <td className="px-container-padding py-2 align-top font-mono tabular-nums text-on-surface">{e.response_status}</td>
                  <td className="trace-id px-container-padding py-2 align-top font-mono text-on-surface-variant break-all">{e.request_trace_id}</td>
                  <td className="px-container-padding py-2 align-top font-mono text-on-surface-variant whitespace-nowrap">{e.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
