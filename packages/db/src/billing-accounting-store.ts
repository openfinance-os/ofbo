import { createHash } from 'node:crypto'
import pg from 'pg'
import type { AccountingBatch, AccountingClosePack } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface BillingAccountingDispatchInput {
  batchArtifactId: string
  adapterProfile: 'demo' | 'enterprise'
  traceId: string
  accepted: boolean
  journalBatchRef?: string
  status: 'accepted' | 'rejected' | 'transport_error'
  errorDetail?: string
}

const BATCH_COLUMNS = ['bank_id','channel','batch_id','billing_period','posting_date','account_profile_ref','debit_fils','credit_fils','balanced','input_sha256','close_pack','fapi_interaction_id']
const JOURNAL_COLUMNS = ['bank_id','channel','accounting_batch_id','journal_id','source_type','source_id','debit_fils','credit_fils']
const LINE_COLUMNS = ['bank_id','channel','journal_instruction_id','line_no','account','entry_side','amount_fils','fee_class','source_refs']
const DISPATCH_COLUMNS = ['bank_id','channel','accounting_batch_id','attempt_no','adapter_profile','fapi_interaction_id','accepted','journal_batch_ref','status','error_detail']

function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(norm) : Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((key) => [key, norm((v as Record<string, unknown>)[key])]))
  return JSON.stringify(norm(value))
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export class PgBillingAccountingStore {
  private readonly pool: pg.Pool

  constructor(databaseUrl: string, private readonly config: { bankId: string; channel: string }, private readonly lineage?: LineageSink) {
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
    try { await this.lineage?.emitLineage({ table, columns, source: 'billing-accounting-store', trace_id: traceId }) } catch { /* catalogue outage cannot roll back accounting evidence */ }
  }

  async saveBatch(batch: AccountingBatch, closePack: AccountingClosePack, traceId: string): Promise<{ id: string; created: boolean }> {
    const inputSha256 = digest({ batch, closePack })
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_accounting_batch
           (bank_id,channel,batch_id,billing_period,posting_date,account_profile_ref,debit_fils,credit_fils,balanced,input_sha256,close_pack,fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
         ON CONFLICT (bank_id,batch_id) DO NOTHING RETURNING id`,
        [this.config.bankId,this.config.channel,batch.batchId,batch.period,batch.postingDate,batch.accountProfileRef,batch.debitFils,batch.creditFils,batch.balanced,inputSha256,JSON.stringify(closePack),traceId]
      )
      if (!inserted.rows[0]) {
        const existing = await client.query(`SELECT id,input_sha256 FROM billing_accounting_batch WHERE batch_id=$1`, [batch.batchId])
        const row = existing.rows[0] as { id?: string; input_sha256?: string } | undefined
        if (!row?.id) throw new Error(`accounting batch ${batch.batchId} could not be read after insert`)
        if (row.input_sha256 !== inputSha256) throw new Error(`conflicting immutable accounting batch ${batch.batchId}`)
        return { id: row.id, created: false }
      }
      const batchArtifactId = inserted.rows[0].id as string
      for (const item of batch.journals) {
        const journal = await client.query(
          `INSERT INTO billing_journal_instruction
             (bank_id,channel,accounting_batch_id,journal_id,source_type,source_id,debit_fils,credit_fils)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [this.config.bankId,this.config.channel,batchArtifactId,item.journalId,item.sourceType,item.sourceId,item.debitFils,item.creditFils]
        )
        const journalId = journal.rows[0].id as string
        for (const [index, line] of item.lines.entries()) {
          await client.query(
            `INSERT INTO billing_journal_line
               (bank_id,channel,journal_instruction_id,line_no,account,entry_side,amount_fils,fee_class,source_refs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [this.config.bankId,this.config.channel,journalId,index + 1,line.account,line.side,line.amountFils,line.feeClass,line.sourceRefs]
          )
        }
      }
      return { id: batchArtifactId, created: true }
    })
    if (result.created) {
      await Promise.all([
        this.emit('billing_accounting_batch', BATCH_COLUMNS, traceId),
        this.emit('billing_journal_instruction', JOURNAL_COLUMNS, traceId),
        this.emit('billing_journal_line', LINE_COLUMNS, traceId)
      ])
    }
    return result
  }

  async appendDispatch(input: BillingAccountingDispatchInput): Promise<{ id: string; attemptNo: number }> {
    const result = await this.asApp(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))`, [input.batchArtifactId])
      const batch = await client.query(`SELECT id FROM billing_accounting_batch WHERE id=$1`, [input.batchArtifactId])
      if (!batch.rows[0]) throw new Error(`unknown accounting batch ${input.batchArtifactId}`)
      const next = await client.query(`SELECT COALESCE(MAX(attempt_no),0)+1 AS attempt_no FROM billing_journal_dispatch WHERE accounting_batch_id=$1`, [input.batchArtifactId])
      const attemptNo = Number(next.rows[0].attempt_no)
      const inserted = await client.query(
        `INSERT INTO billing_journal_dispatch
           (bank_id,channel,accounting_batch_id,attempt_no,adapter_profile,fapi_interaction_id,accepted,journal_batch_ref,status,error_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [this.config.bankId,this.config.channel,input.batchArtifactId,attemptNo,input.adapterProfile,input.traceId,input.accepted,input.journalBatchRef ?? null,input.status,input.errorDetail ?? null]
      )
      return { id: inserted.rows[0].id as string, attemptNo }
    })
    await this.emit('billing_journal_dispatch', DISPATCH_COLUMNS, input.traceId)
    return result
  }

  async accountingClosePack(period: string): Promise<AccountingClosePack | null> {
    return this.asApp(async (client) => {
      const result = await client.query(`SELECT close_pack FROM billing_accounting_batch WHERE billing_period=$1 ORDER BY created_at DESC LIMIT 1`, [period])
      return (result.rows[0]?.close_pack as AccountingClosePack | undefined) ?? null
    })
  }

  async close(): Promise<void> { await this.pool.end() }
}
