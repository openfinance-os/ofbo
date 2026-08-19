import pg from 'pg'
import type { BillingProductFamily, ProfitabilityInput } from '@ofbo/billing'
import { MF_PER_FIL } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'

function family(feeClass: string): BillingProductFamily {
  if (feeClass.startsWith('payment.')) return 'payments'
  if (feeClass.startsWith('data.')) return 'data'
  if (feeClass === 'hub.paired') return 'confirmation_of_payee'
  if (feeClass.startsWith('hub.')) return 'tpp_aas'
  return 'other'
}

/** BILL-09 persisted-evidence reader. It never writes or re-rates facts. */
export class PgBillingProfitabilityStore {
  private readonly pool: pg.Pool

  constructor(databaseUrl: string, private readonly config: { bankId: string; channel: string }) {
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

  async inputForPeriod(period: string): Promise<ProfitabilityInput | null> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new RangeError('period must be YYYY-MM')
    return this.asApp(async (client) => {
      const memo = await client.query(
        `SELECT id FROM billing_expected_memo WHERE period=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
        [period]
      )
      const memoId = memo.rows[0]?.id as string | undefined
      const receivables = memoId ? await client.query(
        `SELECT line_ref,tpp_id,fee_class,amount_milli_fils,event_ids
           FROM billing_expected_memo_line WHERE expected_memo_id=$1 ORDER BY tpp_id,fee_class,line_ref`,
        [memoId]
      ) : { rows: [] as Record<string, unknown>[] }
      const costs = await client.query(
        `SELECT i.source_id,l.fee_class,l.amount_fils,l.source_refs
           FROM billing_journal_instruction i
           JOIN billing_accounting_batch b ON b.bank_id=i.bank_id AND b.id=i.accounting_batch_id
           JOIN billing_journal_line l ON l.bank_id=i.bank_id AND l.journal_instruction_id=i.id
          WHERE b.billing_period=$1 AND i.source_type='hub_payable' AND l.entry_side='debit'
          ORDER BY i.source_id,l.line_no`,
        [period]
      )
      if (!memoId && costs.rows.length === 0) return null
      return {
        period,
        receivables: receivables.rows.map((row) => ({
          tppId: String(row.tpp_id), productFamily: family(String(row.fee_class)),
          amountMilliFils: Number(row.amount_milli_fils),
          sourceRefs: [String(row.line_ref), ...(row.event_ids as string[])]
        })),
        hubCosts: costs.rows.map((row) => ({
          tppId: 'TPP_OF_RECORD', productFamily: family(String(row.fee_class)),
          amountMilliFils: Number(row.amount_fils) * MF_PER_FIL,
          sourceRefs: [String(row.source_id), ...(row.source_refs as string[])]
        })),
        // Underlying-LFI cost has no persisted accounting evidence yet: the journal source types
        // that carry it (lfi_payment_fee_payable / lfi_data_fee_payable) arrive with BILL-16, and
        // 0036's source_type CHECK still admits only the hub_payable side. Until then this reader
        // reports no LFI cost rather than inventing one; BILL-16 extends the constraint and this query.
        lfiCosts: [],
        liabilityProvisions: [],
        tppAasMargins: []
      }
    })
  }

  async close(): Promise<void> { await this.pool.end() }
}
