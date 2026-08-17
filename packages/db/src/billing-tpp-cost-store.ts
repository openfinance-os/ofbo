import { createHash } from 'node:crypto'
import pg from 'pg'
import type {
  ExpectedTppCostStatement,
  ExpectedTppCostStatementLine,
  MeteredLine
} from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BILL-13 — durable store for the TPP Cost Management payable ledger (ADR 0007).
 *
 * Writes only the three tables this story owns: the expected cost statement, its lines, and a
 * closed-period re-rating delta. Documents, reconciliations, diff lines and AP dispatch are created
 * by migration 0039 but are written by BILL-14/15/16.
 *
 * Immutability is enforced by the database, not here: ofbo_app holds SELECT + INSERT only. This
 * store therefore never attempts an update — a correction is a new statement plus a re-rating row
 * linking the two, so the original remains exactly as written.
 */

export interface BillingTppCostStatementInput {
  meterRunId: string
  statement: ExpectedTppCostStatement
}

export interface StoredBillingTppCostStatement {
  id: string
  meterRunId: string
  evidenceHash: string
  statement: ExpectedTppCostStatement
}

export interface BillingTppCostReratingInput {
  meterRunId: string
  previousStatementId: string
  correctedStatementId: string
  correctionReference: string
  /** Canonical fingerprint of the metered facts both statements were priced from. */
  meteredFactsFingerprint: string
  reratedAt: string
  previous: ExpectedTppCostStatement
  corrected: ExpectedTppCostStatement
}

const STATEMENT_LINEAGE = [
  'bank_id', 'channel', 'meter_run_id', 'period', 'currency', 'rate_card_version',
  'rate_snapshot_hash', 'directory_snapshot_id', 'pricing_effective_from', 'generated_at',
  'rating_run_at', 'nebras_hub_net_milli_fils', 'underlying_lfi_payment_net_milli_fils',
  'underlying_lfi_data_net_milli_fils', 'total_net_milli_fils', 'total_vat_milli_fils',
  'total_gross_milli_fils', 'statement_payload', 'evidence_hash'
]
const STATEMENT_LINE_LINEAGE = [
  'bank_id', 'channel', 'statement_id', 'line_ref', 'cost_recipient_type', 'cost_recipient_id',
  'fee_stream', 'fee_class', 'product_family', 'api_family', 'customer_segment', 'internal_product',
  'cost_centre_ref', 'units', 'event_count', 'vat_treatment', 'expected_net_milli_fils',
  'vat_milli_fils', 'expected_gross_milli_fils', 'event_ids', 'fapi_interaction_ids'
]
const RERATING_LINEAGE = [
  'bank_id', 'channel', 'meter_run_id', 'previous_statement_id', 'corrected_statement_id', 'period',
  'correction_reference', 'previous_rate_snapshot_hash', 'corrected_rate_snapshot_hash',
  'metered_facts_fingerprint', 'facts_unchanged', 'previous_total_net_milli_fils',
  'corrected_total_net_milli_fils', 'total_delta_net_milli_fils', 'rerated_at', 'replay_payload'
]

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

/** Canonical SHA-256 over the statement, so an export digest can be recomputed independently. */
export function tppCostEvidenceHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

/**
 * Stable identity for a statement line: its cost dimensions, which is exactly what BILL-15 will
 * match a provider document line against. Derived rather than generated so the same traffic always
 * produces the same ref.
 */
export function tppCostLineRef(line: ExpectedTppCostStatementLine): string {
  return [
    line.costRecipientType,
    line.costRecipientId,
    line.feeStream,
    line.feeClass,
    line.apiFamily,
    line.customerSegment,
    line.internalProduct ?? '',
    line.costCentreRef ?? ''
  ].join('|')
}

function toStatement(row: Record<string, unknown>): StoredBillingTppCostStatement {
  return {
    id: row.id as string,
    meterRunId: row.meter_run_id as string,
    evidenceHash: row.evidence_hash as string,
    statement: row.statement_payload as ExpectedTppCostStatement
  }
}

export class PgBillingTppCostStore {
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
      await this.lineage?.emitLineage({ table, columns, source: 'billing-tpp-cost-store', trace_id: traceId })
    } catch {
      /* Catalogue availability never rolls back immutable billing evidence. */
    }
  }

  /** The metered facts a statement was priced from, for a re-rating replay. */
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

  /**
   * Persist an expected cost statement and its lines.
   *
   * Idempotent on (meter run, rate card version, rate snapshot hash): re-running the projection over
   * unchanged inputs returns the statement already written rather than a duplicate. A DIFFERENT rate
   * snapshot is a different statement, which is how a corrected directory rate becomes a new
   * immutable row instead of an overwrite.
   */
  async saveStatement(
    input: BillingTppCostStatementInput,
    traceId: string
  ): Promise<{ record: StoredBillingTppCostStatement; created: boolean }> {
    const { statement } = input
    const evidenceHash = tppCostEvidenceHash(statement)
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_tpp_cost_statement
           (bank_id, channel, meter_run_id, period, currency, rate_card_version, rate_snapshot_hash,
            directory_snapshot_id, pricing_effective_from, generated_at, rating_run_at,
            nebras_hub_net_milli_fils, underlying_lfi_payment_net_milli_fils,
            underlying_lfi_data_net_milli_fils, total_net_milli_fils, total_vat_milli_fils,
            total_gross_milli_fils, statement_payload, evidence_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
         ON CONFLICT (bank_id, meter_run_id, rate_card_version, rate_snapshot_hash) DO NOTHING
         RETURNING id, meter_run_id, evidence_hash, statement_payload`,
        [this.config.bankId, this.config.channel, input.meterRunId, statement.period,
          statement.currency, statement.rateCardVersion, statement.evidence.rateSnapshotHash,
          statement.evidence.directorySnapshotId, statement.evidence.pricingEffectiveFrom,
          statement.evidence.generatedAt, statement.evidence.ratingRunAt,
          statement.totals.nebrasHubNetMilliFils, statement.totals.underlyingLfiPaymentNetMilliFils,
          statement.totals.underlyingLfiDataNetMilliFils, statement.totals.totalNetMilliFils,
          statement.totals.totalVatMilliFils, statement.totals.totalGrossMilliFils,
          JSON.stringify(statement), evidenceHash]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        row = (await client.query(
          `SELECT id, meter_run_id, evidence_hash, statement_payload
             FROM billing_tpp_cost_statement
            WHERE meter_run_id = $1 AND rate_card_version = $2 AND rate_snapshot_hash = $3`,
          [input.meterRunId, statement.rateCardVersion, statement.evidence.rateSnapshotHash]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error('expected TPP cost statement could not be read after insert')
      if (created) {
        for (const line of statement.lines) {
          await client.query(
            `INSERT INTO billing_tpp_cost_statement_line
               (bank_id, channel, statement_id, line_ref, cost_recipient_type, cost_recipient_id,
                fee_stream, fee_class, product_family, api_family, customer_segment,
                internal_product, cost_centre_ref, units, event_count, vat_treatment,
                expected_net_milli_fils, vat_milli_fils, expected_gross_milli_fils,
                event_ids, fapi_interaction_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
            [this.config.bankId, this.config.channel, row.id, tppCostLineRef(line),
              line.costRecipientType, line.costRecipientId, line.feeStream, line.feeClass,
              line.productFamily, line.apiFamily, line.customerSegment,
              line.internalProduct ?? null, line.costCentreRef ?? null, line.units, line.events,
              line.vatTreatment, line.expectedNetMilliFils, line.vatMilliFils,
              line.expectedGrossMilliFils, line.eventIds, line.fapiInteractionIds]
          )
        }
      }
      return { row, created }
    })
    if (result.created) {
      await this.emit('billing_tpp_cost_statement', STATEMENT_LINEAGE, traceId)
      if (statement.lines.length) await this.emit('billing_tpp_cost_statement_line', STATEMENT_LINE_LINEAGE, traceId)
    }
    return { record: toStatement(result.row), created: result.created }
  }

  async statementById(statementId: string): Promise<StoredBillingTppCostStatement | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, meter_run_id, evidence_hash, statement_payload
         FROM billing_tpp_cost_statement WHERE id = $1`,
      [statementId]
    )).rows[0] as Record<string, unknown> | undefined)
    return row ? toStatement(row) : null
  }

  async latestStatement(period: string): Promise<StoredBillingTppCostStatement | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, meter_run_id, evidence_hash, statement_payload
         FROM billing_tpp_cost_statement WHERE period = $1
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    return row ? toStatement(row) : null
  }

  async statementLines(statementId: string): Promise<ExpectedTppCostStatementLine[]> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT cost_recipient_type, cost_recipient_id, fee_stream, fee_class, product_family,
                api_family, customer_segment, internal_product, cost_centre_ref, units, event_count,
                vat_treatment, expected_net_milli_fils, vat_milli_fils, expected_gross_milli_fils,
                event_ids, fapi_interaction_ids
           FROM billing_tpp_cost_statement_line
          WHERE statement_id = $1 ORDER BY line_ref`,
        [statementId]
      )
      return result.rows.map((row) => ({
        costRecipientType: row.cost_recipient_type,
        costRecipientId: row.cost_recipient_id,
        feeStream: row.fee_stream,
        feeClass: row.fee_class,
        productFamily: row.product_family,
        apiFamily: row.api_family,
        customerSegment: row.customer_segment,
        ...(row.internal_product ? { internalProduct: row.internal_product } : {}),
        ...(row.cost_centre_ref ? { costCentreRef: row.cost_centre_ref } : {}),
        units: Number(row.units),
        events: Number(row.event_count),
        vatTreatment: row.vat_treatment,
        expectedNetMilliFils: Number(row.expected_net_milli_fils),
        vatMilliFils: Number(row.vat_milli_fils),
        expectedGrossMilliFils: Number(row.expected_gross_milli_fils),
        eventIds: row.event_ids as string[],
        fapiInteractionIds: row.fapi_interaction_ids as string[]
      })) as ExpectedTppCostStatementLine[]
    })
  }

  /**
   * Record a closed-period correction as a delta between two statements.
   *
   * Both statements must project the SAME meter run: a meter run is immutable, so sharing one is
   * what proves the correction re-priced unchanged facts rather than changing them. Re-pricing a
   * different run is a re-meter, and is refused here rather than recorded as a rate correction.
   */
  async saveRerating(
    input: BillingTppCostReratingInput,
    traceId: string
  ): Promise<{ id: string; created: boolean }> {
    if (input.previous.evidence.meterRunId !== input.corrected.evidence.meterRunId) {
      throw new Error(
        'a re-rating must correct the same meter run on both sides — re-pricing a different run is a re-meter, not a re-rate'
      )
    }
    if (input.previous.evidence.meterRunId !== input.meterRunId) {
      throw new Error('re-rating meterRunId does not match the statements it corrects')
    }
    const previousNet = input.previous.totals.totalNetMilliFils
    const correctedNet = input.corrected.totals.totalNetMilliFils
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_tpp_cost_rerating
           (bank_id, channel, meter_run_id, previous_statement_id, corrected_statement_id, period,
            correction_reference, previous_rate_snapshot_hash, corrected_rate_snapshot_hash,
            metered_facts_fingerprint, facts_unchanged, previous_total_net_milli_fils,
            corrected_total_net_milli_fils, total_delta_net_milli_fils, rerated_at, replay_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13,$14,$15::jsonb)
         ON CONFLICT (bank_id, previous_statement_id, correction_reference) DO NOTHING
         RETURNING id`,
        [this.config.bankId, this.config.channel, input.meterRunId, input.previousStatementId,
          input.correctedStatementId, input.previous.period, input.correctionReference,
          input.previous.evidence.rateSnapshotHash, input.corrected.evidence.rateSnapshotHash,
          input.meteredFactsFingerprint, previousNet, correctedNet, correctedNet - previousNet,
          input.reratedAt, JSON.stringify({ previous: input.previous, corrected: input.corrected })]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        row = (await client.query(
          `SELECT id FROM billing_tpp_cost_rerating
            WHERE previous_statement_id = $1 AND correction_reference = $2`,
          [input.previousStatementId, input.correctionReference]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error('TPP cost re-rating could not be read after insert')
      return { id: row.id as string, created }
    })
    if (result.created) await this.emit('billing_tpp_cost_rerating', RERATING_LINEAGE, traceId)
    return result
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
