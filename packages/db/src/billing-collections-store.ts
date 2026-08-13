import { createHash } from 'node:crypto'
import pg from 'pg'
import type {
  DirectCollectionRail,
  DunningActionType,
  DunningState,
  SettlementDecomposition,
  SettlementDecompositionLine,
  SettlementResidueBreak
} from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface StoredDirectCollectionInvoice {
  invoiceId: string
  tppId: string
  issuedAt: string
  dueAt: string
  amountMilliFils: number
  settledAt: string | null
  eligibleRails: DirectCollectionRail[]
  selectedRail: DirectCollectionRail
  policyRef: string
}

export interface StoredBillingCollectionAction {
  invoiceId: string
  fromState: DunningState
  toState: DunningState
  actionType: 'collection_requested' | Exclude<DunningActionType, 'none'>
  policyRef: string
  occurredAt: string
  traceId: string
}

const RUN_COLUMNS = ['bank_id', 'channel', 'settlement_reference', 'billing_period', 'received_milli_fils', 'expected_net_milli_fils', 'residue_milli_fils', 'residue_tolerance_milli_fils', 'status', 'decomposition_sha256', 'fapi_interaction_id']
const LINE_COLUMNS = ['bank_id', 'channel', 'settlement_run_id', 'role', 'source_id', 'counterparty_id', 'signed_milli_fils', 'ledger_ref']
const BREAK_COLUMNS = ['bank_id', 'channel', 'settlement_run_id', 'break_type', 'amount_milli_fils', 'receivable_ledger_refs', 'payable_ledger_refs', 'fapi_interaction_id']
const INVOICE_COLUMNS = ['bank_id', 'channel', 'invoice_id', 'tpp_id', 'issued_at', 'due_at', 'amount_milli_fils', 'settled_at', 'eligible_rails', 'selected_rail', 'policy_ref', 'invoice_sha256', 'fapi_interaction_id']
const ACTION_COLUMNS = ['bank_id', 'channel', 'collection_invoice_id', 'invoice_id', 'from_state', 'to_state', 'action_type', 'policy_ref', 'occurred_at', 'fapi_interaction_id']

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

function isoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

export class PgBillingCollectionsStore {
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
      await this.lineage?.emitLineage({ table, columns, source: 'billing-collections-store', trace_id: traceId })
    } catch {
      /* Catalogue availability does not roll back immutable billing evidence. */
    }
  }

  async saveSettlement(result: SettlementDecomposition, traceId: string): Promise<{ created: boolean }> {
    const contentHash = digest(result)
    const saved = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_settlement_run
           (bank_id, channel, settlement_reference, billing_period, received_milli_fils,
            expected_net_milli_fils, residue_milli_fils, residue_tolerance_milli_fils,
            status, decomposition_sha256, fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (bank_id, settlement_reference) DO NOTHING RETURNING id`,
        [this.config.bankId, this.config.channel, result.settlementReference, result.period,
          result.receivedMilliFils, result.expectedNetMilliFils, result.residueMilliFils,
          result.residueToleranceMilliFils, result.break ? 'break' : 'matched', contentHash, traceId]
      )
      const insertedId = inserted.rows[0]?.id as string | undefined
      if (!insertedId) {
        const existing = await client.query(
          `SELECT decomposition_sha256 FROM billing_settlement_run WHERE settlement_reference = $1`,
          [result.settlementReference]
        )
        if (existing.rows[0]?.decomposition_sha256 !== contentHash) {
          throw new Error(`conflicting immutable settlement ${result.settlementReference}`)
        }
        return { created: false, hasBreak: false }
      }
      for (const line of result.lines) {
        await client.query(
          `INSERT INTO billing_settlement_line
             (bank_id, channel, settlement_run_id, role, source_id, counterparty_id, signed_milli_fils, ledger_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [this.config.bankId, this.config.channel, insertedId, line.role, line.sourceId,
            line.counterpartyId, line.signedMilliFils, line.ledgerRef]
        )
      }
      if (result.break) {
        await client.query(
          `INSERT INTO billing_settlement_break
             (bank_id, channel, settlement_run_id, break_type, amount_milli_fils,
              receivable_ledger_refs, payable_ledger_refs, fapi_interaction_id)
           VALUES ($1,$2,$3,'settlement_residue',$4,$5,$6,$7)`,
          [this.config.bankId, this.config.channel, insertedId, result.break.amountMilliFils,
            result.break.receivableLedgerRefs, result.break.payableLedgerRefs, traceId]
        )
      }
      return { created: true, hasBreak: result.break !== null }
    })
    if (saved.created) {
      await this.emit('billing_settlement_run', RUN_COLUMNS, traceId)
      await this.emit('billing_settlement_line', LINE_COLUMNS, traceId)
      if (saved.hasBreak) await this.emit('billing_settlement_break', BREAK_COLUMNS, traceId)
    }
    return { created: saved.created }
  }

  async saveCollectionInvoice(invoice: StoredDirectCollectionInvoice, traceId: string): Promise<{ created: boolean }> {
    const contentHash = digest(invoice)
    const saved = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_collection_invoice
           (bank_id, channel, invoice_id, tpp_id, issued_at, due_at, amount_milli_fils, settled_at,
            eligible_rails, selected_rail, policy_ref, invoice_sha256, fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (bank_id, invoice_id) DO NOTHING RETURNING id`,
        [this.config.bankId, this.config.channel, invoice.invoiceId, invoice.tppId, invoice.issuedAt,
          invoice.dueAt, invoice.amountMilliFils, invoice.settledAt, invoice.eligibleRails,
          invoice.selectedRail, invoice.policyRef, contentHash, traceId]
      )
      if (inserted.rows[0]) return { created: true }
      const existing = await client.query(`SELECT invoice_sha256 FROM billing_collection_invoice WHERE invoice_id = $1`, [invoice.invoiceId])
      if (existing.rows[0]?.invoice_sha256 !== contentHash) throw new Error(`conflicting immutable collection invoice ${invoice.invoiceId}`)
      return { created: false }
    })
    if (saved.created) await this.emit('billing_collection_invoice', INVOICE_COLUMNS, traceId)
    return saved
  }

  async collectionInvoice(invoiceId: string): Promise<StoredDirectCollectionInvoice | null> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT invoice_id, tpp_id, issued_at, due_at, amount_milli_fils, settled_at,
                eligible_rails, selected_rail, policy_ref
           FROM billing_collection_invoice WHERE invoice_id = $1`,
        [invoiceId]
      )
      const row = result.rows[0]
      return row ? this.mapInvoice(row) : null
    })
  }

  async appendCollectionAction(action: StoredBillingCollectionAction): Promise<{ created: boolean }> {
    const created = await this.asApp(async (client) => {
      const invoice = await client.query(`SELECT id FROM billing_collection_invoice WHERE invoice_id = $1`, [action.invoiceId])
      if (!invoice.rows[0]) throw new Error(`unknown collection invoice ${action.invoiceId}`)
      const inserted = await client.query(
        `INSERT INTO billing_collection_action
           (bank_id, channel, collection_invoice_id, invoice_id, from_state, to_state,
            action_type, policy_ref, occurred_at, fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (bank_id, collection_invoice_id, to_state) DO NOTHING RETURNING id`,
        [this.config.bankId, this.config.channel, invoice.rows[0].id, action.invoiceId,
          action.fromState, action.toState, action.actionType, action.policyRef, action.occurredAt, action.traceId]
      )
      return inserted.rows[0] !== undefined
    })
    if (created) await this.emit('billing_collection_action', ACTION_COLUMNS, action.traceId)
    return { created }
  }

  async latestCollectionState(invoiceId: string): Promise<DunningState | null> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT to_state FROM billing_collection_action WHERE invoice_id = $1
         ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
        [invoiceId]
      )
      return (result.rows[0]?.to_state as DunningState | undefined) ?? null
    })
  }

  async listCollectionInvoices(): Promise<StoredDirectCollectionInvoice[]> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT invoice_id, tpp_id, issued_at, due_at, amount_milli_fils, settled_at,
                eligible_rails, selected_rail, policy_ref
           FROM billing_collection_invoice ORDER BY invoice_id`
      )
      return result.rows.map((row) => this.mapInvoice(row))
    })
  }

  async listCollectionActions(): Promise<StoredBillingCollectionAction[]> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT invoice_id, from_state, to_state, action_type, policy_ref, occurred_at, fapi_interaction_id
           FROM billing_collection_action ORDER BY occurred_at, created_at`
      )
      return result.rows.map((row) => ({
        invoiceId: row.invoice_id as string,
        fromState: row.from_state as DunningState,
        toState: row.to_state as DunningState,
        actionType: row.action_type as 'collection_requested' | Exclude<DunningActionType, 'none'>,
        policyRef: row.policy_ref as string,
        occurredAt: isoDate(row.occurred_at),
        traceId: row.fapi_interaction_id as string
      }))
    })
  }

  async listSettlements(period: string): Promise<SettlementDecomposition[]> {
    return this.asApp(async (client) => {
      const runs = await client.query(
        `SELECT id, settlement_reference, billing_period, received_milli_fils, expected_net_milli_fils,
                residue_milli_fils, residue_tolerance_milli_fils
           FROM billing_settlement_run WHERE billing_period = $1 ORDER BY settlement_reference`,
        [period]
      )
      const output: SettlementDecomposition[] = []
      for (const row of runs.rows) {
        const [lines, breaks] = await Promise.all([
          client.query(
            `SELECT role, source_id, counterparty_id, signed_milli_fils, ledger_ref
               FROM billing_settlement_line WHERE settlement_run_id = $1 ORDER BY created_at, id`,
            [row.id]
          ),
          client.query(
            `SELECT amount_milli_fils, receivable_ledger_refs, payable_ledger_refs
               FROM billing_settlement_break WHERE settlement_run_id = $1`,
            [row.id]
          )
        ])
        const settlementReference = row.settlement_reference as string
        const billingPeriod = row.billing_period as string
        const breakRow = breaks.rows[0]
        const residueBreak: SettlementResidueBreak | null = breakRow ? {
          type: 'settlement_residue',
          settlementReference,
          period: billingPeriod,
          amountMilliFils: Number(breakRow.amount_milli_fils),
          receivableLedgerRefs: breakRow.receivable_ledger_refs as string[],
          payableLedgerRefs: breakRow.payable_ledger_refs as string[]
        } : null
        output.push({
          settlementReference,
          period: billingPeriod,
          receivedMilliFils: Number(row.received_milli_fils),
          expectedNetMilliFils: Number(row.expected_net_milli_fils),
          residueMilliFils: Number(row.residue_milli_fils),
          residueToleranceMilliFils: Number(row.residue_tolerance_milli_fils),
          lines: lines.rows.map((line): SettlementDecompositionLine => ({
            role: line.role,
            sourceId: line.source_id,
            counterpartyId: line.counterparty_id,
            signedMilliFils: Number(line.signed_milli_fils),
            ledgerRef: line.ledger_ref
          })),
          break: residueBreak
        })
      }
      return output
    })
  }

  private mapInvoice(row: Record<string, unknown>): StoredDirectCollectionInvoice {
    return {
      invoiceId: row.invoice_id as string,
      tppId: row.tpp_id as string,
      issuedAt: isoDate(row.issued_at),
      dueAt: isoDate(row.due_at),
      amountMilliFils: Number(row.amount_milli_fils),
      settledAt: row.settled_at ? isoDate(row.settled_at) : null,
      eligibleRails: row.eligible_rails as DirectCollectionRail[],
      selectedRail: row.selected_rail as DirectCollectionRail,
      policyRef: row.policy_ref as string
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
