import { createHash } from 'node:crypto'
import pg from 'pg'
import {
  redactProviderPayload,
  type ExpectedTppCostStatement,
  type ExpectedTppCostStatementLine,
  type MeteredLine,
  type ParsedTppCostDocument
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

export interface BillingTppCostDocumentInput {
  document: ParsedTppCostDocument
  /** Integrity hash of the raw artifact, `sha256:<64 hex>`. */
  documentSha256: string
  /** Pointer to the retained original, which lives outside this ledger. */
  rawDocumentRef: string
  receivedAt: string
  /** Second person who verified the upload. Bound to a P2 claim by the service, never to input. */
  verifiedBy: string
  verifiedAt: string
  idempotencyKey: string
}

export interface StoredBillingTppCostDocument {
  id: string
  documentReference: string
  evidenceHash: string
  payload: unknown
  /**
   * The upload evidence as STORED, which on a replay is not what the current request supplied.
   *
   * Dedupe keys on `evidence_hash`, computed over commercial substance (reference, issuer, period,
   * totals, lines) and deliberately NOT over the raw bytes — two byte-different files stating the same
   * charges are the same document. So a replay's `document_sha256` legitimately differs from the
   * stored one, and reporting the request's own hash would hand the caller a value matching no row.
   */
  documentSha256: string
  receivedAt: string
  verifiedBy: string
  verifiedAt: string
}

/**
 * The same issuer + reference arriving with different content. Typed, because the ingest endpoint
 * answers it with 409 and must not classify it by matching message text.
 */
export class BillingTppCostDocumentConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingTppCostDocumentConflictError'
  }
}

/**
 * Last line of defence before an unremovable write: the parser redacts, but this is the boundary that
 * makes a payload permanent, so it refuses one still carrying an identifier shape. Structural only —
 * it re-uses the parser's own shapes rather than inventing a second, weaker notion of PII.
 */
function assertRedactedPayload(payload: unknown): void {
  const { removedPaths } = redactProviderPayload(payload)
  if (removedPaths.length > 0) {
    throw new Error(
      'refusing to persist an unredacted provider payload: '
      + `${removedPaths.length} field(s) still match a customer-detail shape. Parse via the document `
      + 'parser, which redacts before returning. Paths (names only, no values): '
      + removedPaths.join(', ')
    )
  }
}

const DOCUMENT_LINEAGE = [
  'bank_id', 'channel', 'document_type', 'issuer_id', 'recipient_id', 'document_reference',
  'billing_period', 'currency', 'gross_milli_fils', 'vat_milli_fils', 'net_milli_fils',
  'document_sha256', 'raw_document_ref', 'issued_at', 'received_at', 'verified_by', 'verified_at',
  'idempotency_key', 'parsed_payload', 'evidence_hash'
]
const DOCUMENT_LINE_LINEAGE = [
  'bank_id', 'channel', 'document_id', 'line_ref', 'source_category', 'fee_class', 'mapped',
  'cost_recipient_type', 'cost_recipient_id', 'units', 'unit_price_milli_fils',
  'actual_net_milli_fils', 'vat_milli_fils', 'actual_gross_milli_fils'
]
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
 * The wall-clock fields on a statement's evidence: WHEN it was generated and rated, as distinct from
 * WHAT was computed. The monthly worker sets both from its own run clock, so they legitimately differ
 * between a first run and a resumed or replayed one.
 */
const CLOCK_EVIDENCE_FIELDS = ['generatedAt', 'ratingRunAt'] as const

function withoutClockReadings(statement: unknown): unknown {
  if (statement === null || typeof statement !== 'object') return statement
  const { evidence, ...rest } = statement as Record<string, unknown>
  if (evidence === null || typeof evidence !== 'object') return statement
  const trimmed = { ...(evidence as Record<string, unknown>) }
  for (const field of CLOCK_EVIDENCE_FIELDS) delete trimmed[field]
  return { ...rest, evidence: trimmed }
}

/**
 * Digest of a statement's SUBSTANCE — every field except the two clock readings above.
 *
 * This is what divergence is compared on, and it is deliberately NOT `evidence_hash`. Scheduled jobs
 * in this repo must be resumable and idempotent (CLAUDE.md, demo profile), and the monthly worker
 * stamps `generatedAt`/`ratingRunAt` from `billingRunAt`. Comparing the full evidence hash therefore
 * made a perfectly correct re-run — same meter run, same rate card, same totals, later clock — look
 * like divergent evidence and throw, taking the whole billing projection down with it. Substance
 * decides: different totals or lines are a genuine conflict, a different run time is not.
 *
 * `evidence_hash` still stores the complete digest, timestamps included: that column is the
 * provenance record of what was actually written, and the first write's clock is part of it.
 */
export function tppCostContentHash(statement: unknown): string {
  return tppCostEvidenceHash(withoutClockReadings(statement))
}

/**
 * The same substance-only digest over a re-rating's `{ previous, corrected }` replay payload, which
 * nests two statements and so carries two pairs of clock readings.
 */
export function tppCostReplayContentHash(replay: unknown): string {
  if (replay === null || typeof replay !== 'object') return tppCostEvidenceHash(replay)
  const { previous, corrected } = replay as Record<string, unknown>
  return tppCostEvidenceHash({
    previous: withoutClockReadings(previous),
    corrected: withoutClockReadings(corrected)
  })
}

/**
 * Stable identity for a statement line: its cost dimensions, which is exactly what BILL-15 will
 * match a provider document line against. Derived rather than generated so the same traffic always
 * produces the same ref.
 *
 * These dimensions MUST mirror buildExpectedTppCostStatement's aggregation key exactly, in the same
 * order. The domain produces one line per distinct key, and the ledger enforces
 * UNIQUE (bank_id, statement_id, line_ref) — so any dimension the domain separates on but the ref
 * omits is two distinct lines colliding on insert and failing the whole statement. `productFamily`
 * happens to be functionally determined by feeStream + apiFamily today, which makes such a collision
 * currently unreachable; that is an invariant of classify(), not of this identity, so it is not
 * relied on here.
 */
export function tppCostLineRef(line: ExpectedTppCostStatementLine): string {
  return [
    line.costRecipientType,
    line.costRecipientId,
    line.feeStream,
    line.feeClass,
    line.productFamily,
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

  /** Latest meter run for a period: the immutable facts a statement projects. */
  async latestMeterRun(period: string): Promise<{ id: string; period: string; rateCardVersion: string } | null> {
    const row = await this.asApp(async (client) => (await client.query(
      `SELECT id, period, rate_card_version FROM billing_meter_run
        WHERE period = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [period]
    )).rows[0] as Record<string, unknown> | undefined)
    return row
      ? { id: row.id as string, period: row.period as string, rateCardVersion: row.rate_card_version as string }
      : null
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
      // A regeneration that produces DIFFERENT content under the same key is a conflict, not a
      // no-op. Returning the stored row silently would hide divergent evidence on an immutable
      // regulated record — the same posture as the tenant-configuration conflict check.
      //
      // Compared on the CONTENT hash, recomputed from the stored payload rather than read from
      // evidence_hash: a resumed run re-derives the same statement under a later clock, and that is
      // idempotence, not divergence. See tppCostContentHash.
      const storedContentHash = tppCostContentHash(row.statement_payload)
      const contentHash = tppCostContentHash(statement)
      if (storedContentHash !== contentHash) {
        throw new Error(
          `conflicting expected TPP cost statement for meter run ${input.meterRunId}: stored content `
          + `${storedContentHash} does not match regenerated ${contentHash}`
        )
      }
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
    // Substance, not clock — a replayed re-rating carries the same two statements under a later run
    // time. Same reasoning as saveStatement; see tppCostContentHash.
    const replayHash = tppCostReplayContentHash({ previous: input.previous, corrected: input.corrected })
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_tpp_cost_rerating
           (bank_id, channel, meter_run_id, previous_statement_id, corrected_statement_id, period,
            correction_reference, previous_rate_snapshot_hash, corrected_rate_snapshot_hash,
            metered_facts_fingerprint, facts_unchanged, previous_total_net_milli_fils,
            corrected_total_net_milli_fils, total_delta_net_milli_fils, rerated_at, replay_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13,$14,$15::jsonb)
         ON CONFLICT (bank_id, previous_statement_id, correction_reference) DO NOTHING
         RETURNING id, replay_payload`,
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
          `SELECT id, replay_payload FROM billing_tpp_cost_rerating
            WHERE previous_statement_id = $1 AND correction_reference = $2`,
          [input.previousStatementId, input.correctionReference]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error('TPP cost re-rating could not be read after insert')
      // Same correction reference, different replay: a conflict rather than a silent no-op.
      if (tppCostReplayContentHash(row.replay_payload) !== replayHash) {
        throw new Error(
          `conflicting TPP cost re-rating for reference ${input.correctionReference}: the stored replay `
          + 'does not match the one supplied'
        )
      }
      return { id: row.id as string, created }
    })
    if (result.created) await this.emit('billing_tpp_cost_rerating', RERATING_LINEAGE, traceId)
    return result
  }

  /**
   * BILL-14 — persist a parsed provider document and its lines.
   *
   * The table carries TWO unique keys and both must be honoured, which an earlier version of this
   * method got wrong: it declared itself "idempotent on (bank_id, idempotency_key)" while handling
   * conflicts only on (issuer_id, document_reference), so a reused key raised a bare 23505 and
   * surfaced as a 500.
   *
   * - `(bank_id, idempotency_key)` — a replayed key carrying the SAME document returns the stored row.
   *   A replayed key carrying a DIFFERENT document is a conflict: the caller reused a key, and
   *   answering with either document would be wrong.
   * - `(bank_id, issuer_id, document_reference)` — the same document under a new key is a no-op
   *   replay; the same reference with a different body is a provider restatement and conflicts.
   *
   * The payload written here is already redacted — the parser has no accessor for the raw one — so
   * this method cannot be the place customer detail leaks in. It re-checks anyway, because this is the
   * boundary that makes a payload permanent.
   */
  async saveDocument(
    input: BillingTppCostDocumentInput,
    traceId: string
  ): Promise<{ record: StoredBillingTppCostDocument; created: boolean }> {
    const { document } = input
    assertRedactedPayload(document.payload)
    const evidenceHash = tppCostEvidenceHash({
      reference: document.documentReference,
      issuer: document.issuerId,
      period: document.billingPeriod,
      totals: [document.netMilliFils, document.vatMilliFils, document.grossMilliFils],
      lines: document.lines
    })

    const result = await this.asApp(async (client) => {
      // Idempotency key first: it is the caller's own replay token, so a mismatch under it is a
      // client error rather than a provider restatement, and the two deserve different answers.
      const byKey = (await client.query(
        `SELECT id, document_reference, evidence_hash, parsed_payload,
                document_sha256, received_at, verified_by, verified_at
           FROM billing_tpp_cost_document WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      )).rows[0] as Record<string, unknown> | undefined
      if (byKey) {
        if (byKey.evidence_hash !== evidenceHash) {
          throw new BillingTppCostDocumentConflictError(
            `idempotency key ${input.idempotencyKey} was already used for a different document `
            + `(stored evidence ${String(byKey.evidence_hash)}, supplied ${evidenceHash})`
          )
        }
        return { row: byKey, created: false }
      }

      const inserted = await client.query(
        `INSERT INTO billing_tpp_cost_document
           (bank_id, channel, document_type, issuer_id, recipient_id, document_reference,
            billing_period, currency, gross_milli_fils, vat_milli_fils, net_milli_fils,
            document_sha256, raw_document_ref, issued_at, received_at, verified_by, verified_at,
            idempotency_key, parsed_payload, evidence_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)
         ON CONFLICT (bank_id, issuer_id, document_reference) DO NOTHING
         RETURNING id, document_reference, evidence_hash, parsed_payload,
                   document_sha256, received_at, verified_by, verified_at`,
        [this.config.bankId, this.config.channel, document.documentType, document.issuerId,
          document.recipientId, document.documentReference, document.billingPeriod, document.currency,
          document.grossMilliFils, document.vatMilliFils, document.netMilliFils,
          input.documentSha256, input.rawDocumentRef, document.issuedAt, input.receivedAt,
          input.verifiedBy, input.verifiedAt, input.idempotencyKey,
          JSON.stringify(document.payload), evidenceHash]
      )
      let row = inserted.rows[0] as Record<string, unknown> | undefined
      const created = Boolean(row)
      if (!row) {
        row = (await client.query(
          `SELECT id, document_reference, evidence_hash, parsed_payload,
                  document_sha256, received_at, verified_by, verified_at
             FROM billing_tpp_cost_document
            WHERE issuer_id = $1 AND document_reference = $2`,
          [document.issuerId, document.documentReference]
        )).rows[0] as Record<string, unknown> | undefined
      }
      if (!row) throw new Error('provider cost document could not be read after insert')

      // Same issuer + reference, different content: a restatement masquerading as a replay.
      if (row.evidence_hash !== evidenceHash) {
        throw new BillingTppCostDocumentConflictError(
          `conflicting provider document ${document.issuerId}/${document.documentReference}: stored `
          + `evidence ${String(row.evidence_hash)} does not match ${evidenceHash}`
        )
      }

      if (created) {
        for (const line of document.lines) {
          await client.query(
            `INSERT INTO billing_tpp_cost_document_line
               (bank_id, channel, document_id, line_ref, source_category, fee_class, mapped,
                cost_recipient_type, cost_recipient_id, units, unit_price_milli_fils,
                actual_net_milli_fils, vat_milli_fils, actual_gross_milli_fils)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [this.config.bankId, this.config.channel, row.id, line.lineRef, line.sourceCategory,
              line.feeClass, line.mapped, line.costRecipientType, line.costRecipientId, line.units,
              line.unitPriceMilliFils, line.actualNetMilliFils, line.vatMilliFils,
              line.actualGrossMilliFils]
          )
        }
      }
      return { row, created }
    })

    if (result.created) {
      await this.emit('billing_tpp_cost_document', DOCUMENT_LINEAGE, traceId)
      if (document.lines.length) {
        await this.emit('billing_tpp_cost_document_line', DOCUMENT_LINE_LINEAGE, traceId)
      }
    }
    const asIso = (value: unknown): string =>
      value instanceof Date ? value.toISOString() : String(value)
    return {
      record: {
        id: result.row.id as string,
        documentReference: result.row.document_reference as string,
        evidenceHash: result.row.evidence_hash as string,
        payload: result.row.parsed_payload,
        documentSha256: result.row.document_sha256 as string,
        receivedAt: asIso(result.row.received_at),
        verifiedBy: result.row.verified_by as string,
        verifiedAt: asIso(result.row.verified_at)
      },
      created: result.created
    }
  }

  /** Documents ingested for a period — BILL-15 reconciles against these; the alarm counts them. */
  async documentsForPeriod(period: string): Promise<Array<{ id: string; documentType: string; documentReference: string }>> {
    const rows = await this.asApp(async (client) => (await client.query(
      `SELECT id, document_type, document_reference FROM billing_tpp_cost_document
        WHERE billing_period = $1 ORDER BY created_at ASC`,
      [period]
    )).rows as Array<Record<string, unknown>>)
    return rows.map((row) => ({
      id: row.id as string,
      documentType: row.document_type as string,
      documentReference: row.document_reference as string
    }))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
