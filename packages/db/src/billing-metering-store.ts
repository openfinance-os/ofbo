import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface BillingEventInput {
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

export interface BillingEventIngestResult {
  received: number
  inserted: number
  duplicates: number
}

export interface BillingMeterLineInput {
  eventId: string
  occurredAt: string
  traceId?: string
  side: 'receivable' | 'payable_hub' | 'payable_lfi' | 'free_to_lfi'
  feeClass: string
  units: number
  freeUnits?: number
}

export interface BillingMeterRunInput {
  period: string
  rateCardVersion: string
  inputHash: string
  eventCount: number
  stats: unknown
  evidence: unknown
  lines: BillingMeterLineInput[]
}

export interface StoredBillingMeterRun {
  id: string
  period: string
  rateCardVersion: string
  inputHash: string
  eventCount: number
  stats: unknown
  evidence: unknown
  createdAt: string
}

const EVENT_LINEAGE = ['bank_id', 'channel', 'event_id', 'occurred_at', 'event_hash', 'fapi_interaction_id', 'endpoint', 'outcome', 'direction', 'tpp_id', 'psu_id']
const RUN_LINEAGE = ['bank_id', 'channel', 'period', 'rate_card_version', 'input_hash', 'event_count', 'stats', 'evidence']
const LINE_LINEAGE = ['bank_id', 'channel', 'meter_run_id', 'event_id', 'occurred_at', 'fapi_interaction_id', 'side', 'fee_class', 'units', 'free_units']

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value)

function toRun(row: Record<string, unknown>): StoredBillingMeterRun {
  return {
    id: row.id as string,
    period: row.period as string,
    rateCardVersion: row.rate_card_version as string,
    inputHash: row.input_hash as string,
    eventCount: Number(row.event_count),
    stats: row.stats,
    evidence: row.evidence,
    createdAt: iso(row.created_at)
  }
}

export class PgBillingMeteringStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async asApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query(beginAppTx(this.config.bankId))
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async emitLineage(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'bff-billing-metering-store', trace_id: traceId })
    } catch {
      /* Catalogue availability never rolls back regulated billing evidence. */
    }
  }

  async ingestEvents(inputs: readonly BillingEventInput[], traceId: string): Promise<BillingEventIngestResult> {
    const inserted = await this.asApp(async (client) => {
      let count = 0
      for (const input of inputs) {
        const result = await client.query(
          `INSERT INTO billing_event
             (bank_id, channel, event_id, event_source, event_type, occurred_at, event_hash,
              event_payload, fapi_interaction_id, endpoint, outcome, direction, tpp_id, psu_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (bank_id, event_id) DO NOTHING
           RETURNING event_id`,
          [this.config.bankId, this.config.channel, input.eventId, input.source, input.type, input.occurredAt,
            input.eventHash, JSON.stringify(input.eventPayload), input.fapiInteractionId, input.endpoint,
            input.outcome, input.direction, input.tppId, input.psuId]
        )
        if (result.rows[0]) {
          count += 1
          continue
        }
        const existing = await client.query('SELECT event_hash FROM billing_event WHERE event_id = $1', [input.eventId])
        const existingHash = existing.rows[0]?.event_hash as string | undefined
        if (!existingHash) throw new Error(`billing event ${input.eventId} could not be read after insert`)
        if (existingHash !== input.eventHash) throw new Error(`Conflicting duplicate billing CloudEvent id ${input.eventId}`)
      }
      return count
    })
    if (inserted > 0) await this.emitLineage('billing_event', EVENT_LINEAGE, traceId)
    return { received: inputs.length, inserted, duplicates: inputs.length - inserted }
  }

  async eventsForPeriod(period: string): Promise<unknown[]> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new RangeError('period must be YYYY-MM')
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT event_payload FROM billing_event
          WHERE occurred_at >= ($1 || '-01')::date
            AND occurred_at < (($1 || '-01')::date + interval '1 month')
          ORDER BY occurred_at, event_id`,
        [period]
      )
      return result.rows.map((row) => row.event_payload)
    })
  }

  async saveMeterRun(input: BillingMeterRunInput, traceId: string): Promise<{ run: StoredBillingMeterRun; created: boolean }> {
    for (const line of input.lines) {
      if (!line.traceId) throw new Error(`metered line ${line.eventId} is missing x-fapi-interaction-id`)
    }
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_meter_run
           (bank_id, channel, period, rate_card_version, input_hash, event_count, stats, evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         ON CONFLICT (bank_id, period, rate_card_version, input_hash) DO NOTHING
         RETURNING id, period, rate_card_version, input_hash, event_count, stats, evidence, created_at`,
        [this.config.bankId, this.config.channel, input.period, input.rateCardVersion, input.inputHash,
          input.eventCount, JSON.stringify(input.stats), JSON.stringify(input.evidence)]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        const existing = await client.query(
          `SELECT id, period, rate_card_version, input_hash, event_count, stats, evidence, created_at
             FROM billing_meter_run
            WHERE period = $1 AND rate_card_version = $2 AND input_hash = $3`,
          [input.period, input.rateCardVersion, input.inputHash]
        )
        row = existing.rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error(`billing meter run ${input.inputHash} could not be read after insert`)
      if (created) {
        for (const line of input.lines) {
          await client.query(
            `INSERT INTO billing_metered_line
               (bank_id, channel, meter_run_id, event_id, occurred_at, fapi_interaction_id,
                side, fee_class, units, free_units, line_payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
            [this.config.bankId, this.config.channel, row.id, line.eventId, line.occurredAt, line.traceId,
              line.side, line.feeClass, line.units, line.freeUnits ?? null, JSON.stringify(line)]
          )
        }
      }
      return { row, created }
    })
    if (result.created) {
      await this.emitLineage('billing_meter_run', RUN_LINEAGE, traceId)
      if (input.lines.length > 0) await this.emitLineage('billing_metered_line', LINE_LINEAGE, traceId)
    }
    return { run: toRun(result.row), created: result.created }
  }

  async latestMeterRun(period: string): Promise<StoredBillingMeterRun | null> {
    const row = await this.asApp(async (client) => {
      const result = await client.query(
        `SELECT id, period, rate_card_version, input_hash, event_count, stats, evidence, created_at
           FROM billing_meter_run WHERE period = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [period]
      )
      return result.rows[0] as Record<string, unknown> | undefined
    })
    return row ? toRun(row) : null
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
