import { createHash } from 'node:crypto'
import pg from 'pg'
import type { CollectionMemoDiff, MeteredLine, MeteringResult, RevenueAssuranceReport, RevenueRecovery, ClosedPeriodRerating } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

const RECOVERY_COLUMNS = ['bank_id','channel','recovery_id','billing_period','finding_code','amount_milli_fils','recovered_at','source_ref','content_sha256','fapi_interaction_id']
const REPORT_COLUMNS = ['bank_id','channel','billing_period','generated_at','metering_coverage_bps','gross_receivable_milli_fils','leakage_milli_fils','leakage_ppm','counterfactual_milli_fils','recoverable_milli_fils','recovered_milli_fils','outstanding_milli_fils','dispute_raised_count','dispute_missed_count','target_met','input_sha256','report_payload','fapi_interaction_id']
const FINDING_COLUMNS = ['bank_id','channel','report_id','finding_code','title','amount_milli_fils','counterfactual_milli_fils','recoverable','finding_status','owner','source_refs']

function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(norm) : Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((key) => [key, norm((v as Record<string, unknown>)[key])]))
  return JSON.stringify(norm(value))
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export class PgBillingRevenueAssuranceStore {
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
    } finally { client.release() }
  }

  private async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try { await this.lineage?.emitLineage({ table, columns, source: 'billing-revenue-assurance-store', trace_id: traceId }) } catch { /* catalogue outage cannot roll back immutable evidence */ }
  }

  async appendRecovery(recovery: RevenueRecovery, traceId: string): Promise<{ id: string; created: boolean }> {
    const contentSha256 = digest(recovery)
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_revenue_recovery
           (bank_id,channel,recovery_id,billing_period,finding_code,amount_milli_fils,recovered_at,source_ref,content_sha256,fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (bank_id,recovery_id) DO NOTHING RETURNING id`,
        [this.config.bankId,this.config.channel,recovery.recoveryId,recovery.period,recovery.findingCode,recovery.amountMilliFils,recovery.recoveredAt,recovery.sourceRef,contentSha256,traceId]
      )
      if (inserted.rows[0]) return { id: inserted.rows[0].id as string, created: true }
      const existing = await client.query(`SELECT id,content_sha256 FROM billing_revenue_recovery WHERE recovery_id=$1`, [recovery.recoveryId])
      const row = existing.rows[0] as { id?: string; content_sha256?: string } | undefined
      if (!row?.id) throw new Error(`recovery ${recovery.recoveryId} could not be read after insert`)
      if (row.content_sha256 !== contentSha256) throw new Error(`conflicting immutable recovery ${recovery.recoveryId}`)
      return { id: row.id, created: false }
    })
    if (result.created) await this.emit('billing_revenue_recovery', RECOVERY_COLUMNS, traceId)
    return result
  }

  async recoveriesForPeriod(period: string): Promise<RevenueRecovery[]> {
    return this.asApp(async (client) => {
      const result = await client.query(
        `SELECT recovery_id,billing_period,finding_code,amount_milli_fils,recovered_at,source_ref
           FROM billing_revenue_recovery WHERE billing_period=$1 ORDER BY recovered_at,recovery_id`, [period]
      )
      return result.rows.map((row) => ({
        recoveryId: row.recovery_id as string, period: row.billing_period as string,
        findingCode: row.finding_code as RevenueRecovery['findingCode'], amountMilliFils: Number(row.amount_milli_fils),
        recoveredAt: row.recovered_at instanceof Date ? row.recovered_at.toISOString() : String(row.recovered_at), sourceRef: row.source_ref as string
      }))
    })
  }

  async saveReport(report: RevenueAssuranceReport, traceId: string): Promise<{ id: string; created: boolean }> {
    const inputSha256 = digest(report)
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_revenue_assurance_report
           (bank_id,channel,billing_period,generated_at,metering_coverage_bps,gross_receivable_milli_fils,
            leakage_milli_fils,leakage_ppm,counterfactual_milli_fils,recoverable_milli_fils,recovered_milli_fils,
            outstanding_milli_fils,dispute_raised_count,dispute_missed_count,target_met,input_sha256,report_payload,fapi_interaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
         ON CONFLICT (bank_id,billing_period,input_sha256) DO NOTHING RETURNING id`,
        [this.config.bankId,this.config.channel,report.period,report.generatedAt,Math.round(report.meteringCoveragePercent*100),
          report.grossReceivableMilliFils,report.leakageMilliFils,Math.round(report.leakagePercent*10_000),
          report.counterfactualOpportunityMilliFils,report.recoverableMilliFils,report.recoveredRevenueMilliFils,
          report.outstandingRecoverableMilliFils,report.disputeWindow.raised,report.disputeWindow.missed,report.target.met,
          inputSha256,JSON.stringify(report),traceId]
      )
      let id = inserted.rows[0]?.id as string | undefined
      const created = Boolean(id)
      if (!id) id = (await client.query(`SELECT id FROM billing_revenue_assurance_report WHERE billing_period=$1 AND input_sha256=$2`, [report.period,inputSha256])).rows[0]?.id as string | undefined
      if (!id) throw new Error(`revenue assurance report ${report.period} could not be read after insert`)
      if (created) {
        for (const item of report.findings) {
          await client.query(
            `INSERT INTO billing_revenue_assurance_finding
               (bank_id,channel,report_id,finding_code,title,amount_milli_fils,counterfactual_milli_fils,recoverable,finding_status,owner,source_refs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [this.config.bankId,this.config.channel,id,item.code,item.title,item.amountMilliFils,item.counterfactualMilliFils,item.recoverable,item.status,item.owner,item.sourceRefs]
          )
        }
      }
      return { id, created }
    })
    if (result.created) await Promise.all([this.emit('billing_revenue_assurance_report', REPORT_COLUMNS, traceId), this.emit('billing_revenue_assurance_finding', FINDING_COLUMNS, traceId)])
    return result
  }

  async latestReport(period: string): Promise<RevenueAssuranceReport | null> {
    return this.asApp(async (client) => {
      const result = await client.query(`SELECT report_payload FROM billing_revenue_assurance_report WHERE billing_period=$1 ORDER BY generated_at DESC,created_at DESC,id DESC LIMIT 1`, [period])
      return (result.rows[0]?.report_payload as RevenueAssuranceReport | undefined) ?? null
    })
  }

  /** Resolve the existing immutable BILL-02/-03 evidence used by the monthly job. */
  async evidenceForPeriod(period: string): Promise<{
    metering: MeteringResult
    memoDiffs: CollectionMemoDiff[]
    reratings: ClosedPeriodRerating[]
    registeredTppIds: string[]
  } | null> {
    return this.asApp(async (client) => {
      const run = (await client.query(
        `SELECT id,event_count,stats,evidence FROM billing_meter_run WHERE period=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [period]
      )).rows[0] as { id?: string; event_count?: number | string; stats?: MeteringResult['stats']; evidence?: MeteringResult['evidence'] } | undefined
      if (!run?.id || !run.stats || !run.evidence) return null
      const [lineRows, diffRows, reratingRows, tppRows] = await Promise.all([
        client.query(`SELECT line_payload FROM billing_metered_line WHERE meter_run_id=$1 ORDER BY occurred_at,event_id,side`, [run.id]),
        client.query(`SELECT diff_payload FROM billing_collection_memo_reconciliation WHERE period=$1 ORDER BY received_at,memo_reference`, [period]),
        client.query(`SELECT replay_payload FROM billing_period_rerating WHERE period=$1 ORDER BY rerated_at,correction_reference`, [period]),
        client.query(`SELECT organisation_id FROM tpp_counterparty WHERE registration_state='registered' AND financial_system_ref IS NOT NULL ORDER BY organisation_id`)
      ])
      const eventCount = Number(run.event_count)
      return {
        metering: {
          lines: lineRows.rows.map((row) => row.line_payload as MeteredLine),
          delivery: { received: eventCount, accepted: eventCount, duplicates: 0 },
          stats: run.stats,
          evidence: run.evidence
        },
        memoDiffs: diffRows.rows.map((row) => row.diff_payload as CollectionMemoDiff),
        reratings: reratingRows.rows.map((row) => row.replay_payload as ClosedPeriodRerating),
        registeredTppIds: tppRows.rows.map((row) => row.organisation_id as string)
      }
    })
  }

  async close(): Promise<void> { await this.pool.end() }
}
