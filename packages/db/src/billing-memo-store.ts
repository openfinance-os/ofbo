import { createHash } from 'node:crypto'
import pg from 'pg'
import type {
  ClosedPeriodRerating,
  CollectionMemo,
  CollectionMemoDiff,
  ExpectedCollectionMemo,
  MeteredLine
} from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface StoredBillingMemoMeterRun {
  id: string
  period: string
  rateCardVersion: string
  inputHash: string
}

export interface BillingExpectedMemoInput {
  meterRunId: string
  meterInputHash: string
  statement: ExpectedCollectionMemo
}

export interface StoredBillingExpectedMemo extends BillingExpectedMemoInput {
  id: string
}

export interface BillingMemoReconciliationInput {
  expectedMemoId: string
  memo: CollectionMemo
  diff: CollectionMemoDiff
  reconciliationRunId: string
}

export interface BillingReratingInput {
  meterRunId: string
  replay: ClosedPeriodRerating
}

const EXPECTED_LINEAGE = [
  'bank_id', 'channel', 'meter_run_id', 'meter_input_hash', 'period', 'rate_card_version',
  'generated_at', 'due_at', 'generated_on_time', 'total_milli_fils', 'statement_payload'
]
const EXPECTED_LINE_LINEAGE = [
  'bank_id', 'channel', 'expected_memo_id', 'line_ref', 'tpp_id', 'fee_class', 'units',
  'event_count', 'amount_milli_fils', 'value_milli_fils', 'event_ids', 'fapi_interaction_ids'
]
const RECON_LINEAGE = [
  'bank_id', 'channel', 'expected_memo_id', 'memo_reference', 'period', 'memo_content_hash',
  'issued_at', 'received_at', 'threshold_milli_fils', 'query_deadline', 'query_window_status',
  'reconciliation_run_id', 'material_break_count', 'expected_total_milli_fils',
  'memo_total_milli_fils', 'net_variance_milli_fils', 'gross_variance_milli_fils'
]
const DIFF_LINE_LINEAGE = [
  'bank_id', 'channel', 'memo_reconciliation_id', 'line_ref', 'tpp_id', 'fee_class',
  'expected_milli_fils', 'memo_milli_fils', 'variance_milli_fils', 'material_variance',
  'presence', 'event_ids', 'fapi_interaction_ids'
]
const RERATING_LINEAGE = [
  'bank_id', 'channel', 'meter_run_id', 'period', 'correction_reference',
  'previous_rate_card_version', 'corrected_rate_card_version', 'metered_facts_fingerprint',
  'facts_unchanged', 'previous_total_milli_fils', 'corrected_total_milli_fils',
  'total_delta_milli_fils', 'rerated_at', 'replay_payload'
]

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function toExpected(row: Record<string, unknown>): StoredBillingExpectedMemo {
  return {
    id: row.id as string,
    meterRunId: row.meter_run_id as string,
    meterInputHash: row.meter_input_hash as string,
    statement: row.statement_payload as ExpectedCollectionMemo
  }
}

export class PgBillingMemoStore {
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

  private async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'billing-memo-store', trace_id: traceId })
    } catch {
      /* Catalogue availability never rolls back immutable billing evidence. */
    }
  }

  async latestMeterRun(period: string): Promise<StoredBillingMemoMeterRun | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, period, rate_card_version, input_hash
         FROM billing_meter_run WHERE period = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    return row ? {
      id: row.id as string,
      period: row.period as string,
      rateCardVersion: row.rate_card_version as string,
      inputHash: row.input_hash as string
    } : null
  }

  async meteredLinesForRun(meterRunId: string): Promise<MeteredLine[]> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT line_payload FROM billing_metered_line
          WHERE meter_run_id = $1 ORDER BY occurred_at, event_id, side`,
        [meterRunId]
      )
      return result.rows.map((row) => row.line_payload as MeteredLine)
    })
  }

  async saveExpectedMemo(
    input: BillingExpectedMemoInput,
    traceId: string
  ): Promise<{ record: StoredBillingExpectedMemo; created: boolean }> {
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_expected_memo
           (bank_id, channel, meter_run_id, meter_input_hash, period, rate_card_version,
            generated_at, due_at, generated_on_time, total_milli_fils, statement_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (bank_id, meter_run_id, rate_card_version) DO NOTHING
         RETURNING id, meter_run_id, meter_input_hash, statement_payload`,
        [this.config.bankId, this.config.channel, input.meterRunId, input.meterInputHash,
          input.statement.period, input.statement.rateCardVersion, input.statement.generatedAt,
          input.statement.dueAt, input.statement.generatedOnTime, input.statement.totalMilliFils,
          JSON.stringify(input.statement)]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        row = (await client.query(
          `SELECT id, meter_run_id, meter_input_hash, statement_payload
             FROM billing_expected_memo WHERE meter_run_id = $1 AND rate_card_version = $2`,
          [input.meterRunId, input.statement.rateCardVersion]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error('expected Collection Memo could not be read after insert')
      if (created) {
        for (const line of input.statement.lines) {
          await client.query(
            `INSERT INTO billing_expected_memo_line
               (bank_id, channel, expected_memo_id, line_ref, tpp_id, fee_class, units,
                event_count, amount_milli_fils, value_milli_fils, event_ids, fapi_interaction_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [this.config.bankId, this.config.channel, row.id, line.lineRef, line.tppId,
              line.feeClass, line.units, line.events, line.amountMilliFils, line.valueMilliFils,
              line.eventIds, line.traceIds]
          )
        }
      }
      return { row, created }
    })
    if (result.created) {
      await this.emit('billing_expected_memo', EXPECTED_LINEAGE, traceId)
      if (input.statement.lines.length) await this.emit('billing_expected_memo_line', EXPECTED_LINE_LINEAGE, traceId)
    }
    return { record: toExpected(result.row), created: result.created }
  }

  async latestExpectedMemo(period: string): Promise<StoredBillingExpectedMemo | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, meter_run_id, meter_input_hash, statement_payload
         FROM billing_expected_memo WHERE period = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    return row ? toExpected(row) : null
  }

  async saveMemoReconciliation(
    input: BillingMemoReconciliationInput,
    traceId: string
  ): Promise<{ id: string; created: boolean }> {
    const hash = contentHash(input.memo)
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_collection_memo_reconciliation
           (bank_id, channel, expected_memo_id, memo_reference, period, memo_content_hash,
            issued_at, received_at, threshold_milli_fils, query_deadline, query_window_status,
            reconciliation_run_id, material_break_count, expected_total_milli_fils,
            memo_total_milli_fils, net_variance_milli_fils, gross_variance_milli_fils,
            memo_payload, diff_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb)
         ON CONFLICT (bank_id, memo_reference) DO NOTHING
         RETURNING id, memo_content_hash`,
        [this.config.bankId, this.config.channel, input.expectedMemoId, input.memo.reference,
          input.memo.period, hash, input.memo.issuedAt, input.memo.receivedAt,
          input.diff.thresholdMilliFils, input.diff.queryDeadline, input.diff.queryWindowStatus,
          input.reconciliationRunId, input.diff.materialBreaks, input.diff.expectedTotalMilliFils,
          input.diff.memoTotalMilliFils, input.diff.netVarianceMilliFils,
          input.diff.grossVarianceMilliFils, JSON.stringify(input.memo), JSON.stringify(input.diff)]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        row = (await client.query(
          `SELECT id, memo_content_hash FROM billing_collection_memo_reconciliation WHERE memo_reference = $1`,
          [input.memo.reference]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error(`Collection Memo ${input.memo.reference} could not be read after insert`)
      if (row.memo_content_hash !== hash) throw new Error(`Conflicting Collection Memo reference ${input.memo.reference}`)
      if (created) {
        for (const line of input.diff.lines) {
          await client.query(
            `INSERT INTO billing_memo_diff_line
               (bank_id, channel, memo_reconciliation_id, line_ref, tpp_id, fee_class,
                expected_milli_fils, memo_milli_fils, variance_milli_fils, material_variance,
                presence, event_ids, fapi_interaction_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [this.config.bankId, this.config.channel, row.id, line.lineRef, line.tppId,
              line.feeClass, line.expectedMilliFils, line.memoMilliFils, line.varianceMilliFils,
              line.materialVariance, line.presence, line.eventIds, line.traceIds]
          )
        }
      }
      return { id: row.id as string, created }
    })
    if (result.created) {
      await this.emit('billing_collection_memo_reconciliation', RECON_LINEAGE, traceId)
      if (input.diff.lines.length) await this.emit('billing_memo_diff_line', DIFF_LINE_LINEAGE, traceId)
    }
    return result
  }

  async saveRerating(input: BillingReratingInput, traceId: string): Promise<{ id: string; created: boolean }> {
    const replay = input.replay
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_period_rerating
           (bank_id, channel, meter_run_id, period, correction_reference,
            previous_rate_card_version, corrected_rate_card_version, metered_facts_fingerprint,
            facts_unchanged, previous_total_milli_fils, corrected_total_milli_fils,
            total_delta_milli_fils, rerated_at, replay_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         ON CONFLICT (bank_id, meter_run_id, corrected_rate_card_version, correction_reference) DO NOTHING
         RETURNING id`,
        [this.config.bankId, this.config.channel, input.meterRunId, replay.period,
          replay.correctionReference, replay.previousRateCardVersion, replay.correctedRateCardVersion,
          replay.meteredFactsFingerprint, replay.factsUnchanged, replay.previousTotalMilliFils,
          replay.correctedTotalMilliFils, replay.totalDeltaMilliFils, replay.reratedAt,
          JSON.stringify(replay)]
      )
      if (inserted.rows[0]) return { id: inserted.rows[0].id as string, created: true }
      const existing = await client.query(
        `SELECT id FROM billing_period_rerating
          WHERE meter_run_id = $1 AND corrected_rate_card_version = $2 AND correction_reference = $3`,
        [input.meterRunId, replay.correctedRateCardVersion, replay.correctionReference]
      )
      const id = existing.rows[0]?.id as string | undefined
      if (!id) throw new Error('billing rerating could not be read after insert')
      return { id, created: false }
    })
    if (result.created) await this.emit('billing_period_rerating', RERATING_LINEAGE, traceId)
    return result
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
