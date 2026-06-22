import { SectionCard, LoadMore } from '../ui'
import type { CareTimeline, CareTimelineEvent } from '../../lib/care'

/**
 * UIF-09 — the care console's 24-month consent event history as a connected, type-coloured
 * timeline (ADR 0016, Stitch 39ce3cee), built on the UIF-01 SectionCard. Each event's dot is
 * coloured by the event_type enum. PII discipline (unchanged): the psu_identifier and event_data
 * are NEVER projected — only created_at / event_type / event_subtype / consent_id. Token-only.
 */

const DOT_TONE: Record<CareTimelineEvent['event_type'], string> = {
  granted: 'bg-reconciled',
  accessed: 'bg-secondary',
  modified: 'bg-break',
  revoked: 'bg-breach'
}

export function EventTimeline({ timeline, moreHref }: { timeline: CareTimeline; moreHref?: string | null }) {
  return (
    <SectionCard title="24-Month Event History" testid="event-history">
      {timeline.events.length === 0 ? (
        <p className="p-4 text-xs text-on-surface-variant" data-testid="timeline-empty">
          No consent lifecycle events in the 24-month window.
        </p>
      ) : (
        <ol className="p-4">
          {timeline.events.map((e, i) => {
            const last = i === timeline.events.length - 1
            return (
              <li key={e.id} className="flex gap-3" data-testid={`event-${e.id}`}>
                <div className="flex flex-col items-center" aria-hidden>
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_TONE[e.event_type]}`} data-testid={`event-dot-${e.id}`} />
                  {last ? null : <span className="w-px flex-1 bg-outline-variant" />}
                </div>
                <div className={last ? '' : 'pb-4'}>
                  <p className="font-mono text-xs text-on-surface-variant">{e.created_at}</p>
                  <p className="text-xs text-primary">
                    <span className="font-bold uppercase">{e.event_type}</span>
                    {e.event_subtype ? ` · ${e.event_subtype}` : ''}
                    {e.consent_id ? ` · ${e.consent_id}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <LoadMore moreHref={moreHref ?? null} shown={timeline.events.length} noun="events" />
    </SectionCard>
  )
}
