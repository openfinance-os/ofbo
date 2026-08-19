import {
  canonicalBillingCloudEvent,
  meterBillableEvents,
  meteringInputPreimage,
  parseBillingCloudEvent,
  type MeteredLine,
  type MeteringResult,
  type RateCard
} from '@ofbo/billing'

export interface EventWrite {
  eventId: string
  source: string
  type: 'com.ofbo.billing.gateway-call.v1'
  occurredAt: string
  eventHash: string
  eventPayload: unknown
  fapiInteractionId: string
  endpoint: string
  outcome: number
  direction: 'inbound' | 'outbound'
  tppId: string
  psuId: string | null
}

export interface MeterRunWrite {
  period: string
  rateCardVersion: string
  inputHash: string
  eventCount: number
  stats: MeteringResult['stats']
  evidence: MeteringResult['evidence']
  lines: MeteredLine[]
}

export interface StoredMeterRun extends MeterRunWrite {
  id: string
  createdAt: string
}

export interface StoredMeterRunIdentity {
  id: string
  period: string
  rateCardVersion: string
  inputHash: string
  eventCount: number
  createdAt: string
}

export interface BillingMeteringStore {
  ingestEvents(inputs: readonly EventWrite[], traceId: string): Promise<{ received: number; inserted: number; duplicates: number }>
  eventsForPeriod(period: string): Promise<unknown[]>
  saveMeterRun(input: MeterRunWrite, traceId: string): Promise<{ run: StoredMeterRunIdentity; created: boolean }>
}

export interface MeteringIngestResult {
  ingest: { received: number; inserted: number; duplicates: number }
  runs: Array<StoredMeterRun & { created: boolean }>
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Durable BILL-02 boundary: validate + fingerprint each delivery, insert raw facts
 * exactly once, then persist an immutable deterministic projection for every affected
 * month. Re-delivery resolves to the same run; late facts produce a new run.
 */
export class BillingMeteringIngestService {
  constructor(
    private readonly store: BillingMeteringStore,
    private readonly card: RateCard
  ) {}

  async ingest(deliveries: readonly unknown[], traceId: string): Promise<MeteringIngestResult> {
    const unique = new Map<string, { canonical: string; event: ReturnType<typeof parseBillingCloudEvent> }>()
    for (const delivery of deliveries) {
      const event = parseBillingCloudEvent(delivery)
      const canonical = canonicalBillingCloudEvent(event)
      const existing = unique.get(event.id)
      if (existing && existing.canonical !== canonical) throw new Error(`Conflicting duplicate billing CloudEvent id ${event.id}`)
      if (!existing) unique.set(event.id, { canonical, event })
    }

    const writes: EventWrite[] = []
    for (const { event, canonical } of unique.values()) {
      writes.push({
        eventId: event.id,
        source: event.source,
        type: event.type,
        occurredAt: event.time,
        eventHash: await sha256(canonical),
        eventPayload: event,
        fapiInteractionId: event.fapiinteractionid,
        endpoint: event.data.endpoint,
        outcome: event.data.outcome,
        direction: event.data.direction,
        tppId: event.data.tppId,
        psuId: event.data.psuId
      })
    }
    const stored = writes.length === 0
      ? { received: 0, inserted: 0, duplicates: 0 }
      : await this.store.ingestEvents(writes, traceId)

    const periods = [...new Set([...unique.values()].map(({ event }) => event.time.slice(0, 7)))].sort()
    const runs: MeteringIngestResult['runs'] = []
    for (const period of periods) {
      const periodEvents = await this.store.eventsForPeriod(period)
      const metered = meterBillableEvents(periodEvents, this.card)
      // The hash covers the projection version as well as the events, so a change to the metering
      // rules creates a new immutable run instead of colliding with a stale one (BILL-12).
      const canonicalInputs = periodEvents.map(canonicalBillingCloudEvent)
      const inputHash = await sha256(meteringInputPreimage(canonicalInputs))
      const runInput: MeterRunWrite = {
        period,
        rateCardVersion: this.card.version,
        inputHash,
        eventCount: metered.stats.eventsTotal,
        stats: metered.stats,
        evidence: metered.evidence,
        lines: metered.lines
      }
      const saved = await this.store.saveMeterRun(runInput, traceId)
      runs.push({ ...runInput, ...saved.run, created: saved.created })
    }

    return {
      ingest: {
        received: deliveries.length,
        inserted: stored.inserted,
        duplicates: deliveries.length - stored.inserted
      },
      runs
    }
  }
}
