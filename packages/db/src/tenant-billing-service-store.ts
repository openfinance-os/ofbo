import { createHash } from 'node:crypto'
import pg from 'pg'
import { canonicalJson, type ProfitabilityReport, type RevenueAssuranceReport } from '@ofbo/billing'
import { beginAppTx } from './tenant-tx.js'
import { isPurposeApproved, type GovernedAuditSink } from './governed-aggregate.js'
import type { LineageSink } from './lineage.js'
import {
  normalizeTenantConfiguration,
  type TenantConfiguration,
  type TenantConfigurationInput
} from './tenant-configuration.js'

export interface TenantProvisioningInput extends TenantConfigurationInput {
  tenantGroupId: string
  groupSlug: string
  displayName: string
  tier: 'tier1' | 'tier2' | 'insurer' | 'longtail'
}

export interface TenantPortableBillingExport {
  schemaVersion: 'ofbo.billing-export.v1'
  bankId: string
  generatedAt: string
  recordCounts: Record<string, number>
  tables: Record<string, Record<string, unknown>[]>
  sha256: string
}

export interface BillingBenchmarkSnapshotInput {
  period: string
  profitability: ProfitabilityReport
  assurance: RevenueAssuranceReport
}

export interface CrossTenantBillingBenchmark {
  period: string
  tenantCount: number
  currency: 'AED'
  averages: {
    receivableMilliFils: number
    hubCostMilliFils: number
    liabilityMilliFils: number
    profitMilliFils: number
    meteringCoveragePercent: number
    leakagePercent: number
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXPORT_TABLES = [
  'tenant_configuration',
  'billing_rate_card_version', 'billing_source_snapshot', 'billing_rate_card_review',
  'billing_record_set', 'invoice_run',
  'billing_event', 'billing_meter_run', 'billing_metered_line',
  'billing_expected_memo', 'billing_expected_memo_line',
  'billing_collection_memo_reconciliation', 'billing_memo_diff_line', 'billing_period_rerating',
  'billing_einvoice_document', 'billing_asp_submission',
  'billing_settlement_run', 'billing_settlement_line', 'billing_settlement_break',
  'billing_collection_invoice', 'billing_collection_action',
  'billing_accounting_batch', 'billing_journal_instruction', 'billing_journal_line', 'billing_journal_dispatch',
  'billing_revenue_recovery', 'billing_revenue_assurance_report', 'billing_revenue_assurance_finding',
  'billing_benchmark_snapshot'
] as const

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function mapConfiguration(row: Record<string, unknown>): TenantConfiguration {
  return normalizeTenantConfiguration({
    bankId: row.bank_id as string,
    approvalExpiryBusinessHours: Number(row.approval_expiry_business_hours),
    slaWeekendPause: Boolean(row.sla_weekend_pause),
    fraudRevokeFourEyes: Boolean(row.fraud_revoke_four_eyes),
    careSurfaceResidency: row.care_surface_residency as 'portal' | 'enterprise',
    yearAnchorDate: row.year_anchor_date instanceof Date ? row.year_anchor_date.toISOString().slice(0, 10) : String(row.year_anchor_date).slice(0, 10),
    retailOverageMilliFils: row.retail_overage_milli_fils === null ? null : Number(row.retail_overage_milli_fils),
    invoiceTemplateRef: row.invoice_template_ref as string,
    invoiceBrandKey: row.invoice_brand_key as string,
    aspRouteProfile: row.asp_route_profile as string,
    collectionRailPolicy: row.collection_rail_policy as TenantConfiguration['collectionRailPolicy']
  })
}

export class PgTenantBillingServiceStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly lineage?: LineageSink | ((bankId: string) => LineageSink),
    private readonly audit?: GovernedAuditSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private lineageFor(bankId: string): LineageSink | undefined {
    return typeof this.lineage === 'function' ? this.lineage(bankId) : this.lineage
  }

  private async asApp<T>(bankId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query(beginAppTx(bankId))
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

  /** Operator-owned idempotent provisioning path. No tenant application role can call these writes. */
  async provisionTenant(input: TenantProvisioningInput, traceId: string): Promise<{ configuration: TenantConfiguration; created: boolean }> {
    if (!UUID.test(input.tenantGroupId)) throw new RangeError('tenantGroupId must be a UUID')
    if (!input.groupSlug.trim() || !input.displayName.trim()) throw new RangeError('groupSlug and displayName are required')
    const config = normalizeTenantConfiguration(input)
    const client = await this.pool.connect()
    let created = false
    try {
      await client.query('BEGIN')
      const member = await client.query(
        `INSERT INTO tenant_group_member (bank_id,tenant_group_id,group_slug,display_name,tier)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bank_id) DO NOTHING RETURNING bank_id`,
        [input.bankId,input.tenantGroupId,input.groupSlug,input.displayName,input.tier]
      )
      if (!member.rows[0]) {
        const existing = await client.query(`SELECT tenant_group_id,group_slug,display_name,tier FROM tenant_group_member WHERE bank_id=$1`, [input.bankId])
        const row = existing.rows[0]
        if (!row || row.tenant_group_id !== input.tenantGroupId || row.group_slug !== input.groupSlug || row.display_name !== input.displayName || row.tier !== input.tier) {
          throw new Error(`conflicting tenant provisioning for ${input.bankId}`)
        }
      }
      const inserted = await client.query(
        `INSERT INTO tenant_configuration
           (bank_id,approval_expiry_business_hours,sla_weekend_pause,fraud_revoke_four_eyes,care_surface_residency,
            year_anchor_date,retail_overage_milli_fils,invoice_template_ref,invoice_brand_key,asp_route_profile,collection_rail_policy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (bank_id) DO NOTHING RETURNING bank_id`,
        [config.bankId,config.approvalExpiryBusinessHours,config.slaWeekendPause,config.fraudRevokeFourEyes,
          config.careSurfaceResidency,config.yearAnchorDate,config.retailOverageMilliFils,config.invoiceTemplateRef,
          config.invoiceBrandKey,config.aspRouteProfile,JSON.stringify(config.collectionRailPolicy)]
      )
      created = Boolean(inserted.rows[0])
      const saved = await client.query(`SELECT * FROM tenant_configuration WHERE bank_id=$1`, [input.bankId])
      const savedConfig = mapConfiguration(saved.rows[0] as Record<string, unknown>)
      if (canonicalJson(savedConfig) !== canonicalJson(config)) throw new Error(`conflicting tenant configuration for ${input.bankId}`)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    if (created) {
      await this.lineageFor(input.bankId)?.emitLineage({ table: 'tenant_configuration', columns: ['bank_id','year_anchor_date','retail_overage_milli_fils','invoice_template_ref','invoice_brand_key','asp_route_profile','collection_rail_policy'], source: 'tenant-provisioning', trace_id: traceId })
    }
    return { configuration: config, created }
  }

  async configuration(bankId: string): Promise<TenantConfiguration | null> {
    return this.asApp(bankId, async (client) => {
      const result = await client.query(`SELECT * FROM tenant_configuration WHERE bank_id=$1`, [bankId])
      return result.rows[0] ? mapConfiguration(result.rows[0] as Record<string, unknown>) : null
    })
  }

  async activeTenantBankIds(): Promise<string[]> {
    const result = await this.pool.query(`SELECT bank_id FROM tenant_configuration WHERE active=true ORDER BY bank_id`)
    return result.rows.map((row) => row.bank_id as string)
  }

  async portableExport(bankId: string, generatedAt: string): Promise<TenantPortableBillingExport> {
    const tables = await this.asApp(bankId, async (client) => {
      const result: Record<string, Record<string, unknown>[]> = {}
      for (const table of EXPORT_TABLES) {
        const rows = await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
        result[table] = rows.rows.map((item) => item.row as Record<string, unknown>)
      }
      return result
    })
    const recordCounts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))
    const body = { schemaVersion: 'ofbo.billing-export.v1' as const, bankId, generatedAt, recordCounts, tables }
    const wireBody = {
      schema_version: body.schemaVersion,
      bank_id: body.bankId,
      generated_at: body.generatedAt,
      record_counts: body.recordCounts,
      // Database rows, including nested jsonb payloads, are opaque export data.
      // Their keys must remain byte-stable for a portability round trip.
      tables: body.tables
    }
    return { ...body, sha256: hash(wireBody) }
  }

  async publishBenchmark(bankId: string, input: BillingBenchmarkSnapshotInput, traceId: string): Promise<{ created: boolean }> {
    if (input.profitability.period !== input.period || input.assurance.period !== input.period) throw new Error('benchmark evidence periods must match')
    const payload = {
      period: input.period,
      profitability: input.profitability.totals,
      meteringCoveragePercent: input.assurance.meteringCoveragePercent,
      leakagePercent: input.assurance.leakagePercent
    }
    const created = await this.asApp(bankId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_benchmark_snapshot
           (bank_id,channel,period,receivable_milli_fils,hub_cost_milli_fils,liability_milli_fils,profit_milli_fils,
            metering_coverage_percent,leakage_percent,source_hash)
         VALUES ($1,'internal_retail',$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (bank_id,period,source_hash) DO NOTHING RETURNING id`,
        [bankId,input.period,input.profitability.totals.receivableMilliFils,input.profitability.totals.hubCostMilliFils,
          input.profitability.totals.liabilityProvisionMilliFils,input.profitability.totals.profitMilliFils,
          input.assurance.meteringCoveragePercent,input.assurance.leakagePercent,hash(payload)]
      )
      return Boolean(inserted.rows[0])
    })
    if (created) await this.lineageFor(bankId)?.emitLineage({ table: 'billing_benchmark_snapshot', columns: ['bank_id','period','receivable_milli_fils','hub_cost_milli_fils','liability_milli_fils','profit_milli_fils','metering_coverage_percent','leakage_percent','source_hash'], source: 'billing-benchmark', trace_id: traceId })
    return { created }
  }

  /** Aggregate-only operator read: approved purpose + k>=3 + High-class audit, never tenant rows. */
  async crossTenantBenchmark(input: {
    authorizingBankId: string
    purposeCode: string
    period: string
    actingPrincipal: string
    actingPersona: string
    traceId: string
  }): Promise<CrossTenantBillingBenchmark> {
    if (!this.audit) throw new Error('cross-tenant benchmark audit sink is required')
    if (!(await isPurposeApproved(this.pool, input.authorizingBankId, input.purposeCode))) {
      throw new Error(`cross-tenant billing benchmark purpose '${input.purposeCode}' is not registered+approved`)
    }
    const result = await this.pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (bank_id) bank_id,receivable_milli_fils,hub_cost_milli_fils,liability_milli_fils,
                profit_milli_fils,metering_coverage_percent,leakage_percent
           FROM billing_benchmark_snapshot WHERE period=$1 ORDER BY bank_id,created_at DESC,id DESC
       )
       SELECT count(*)::int AS tenant_count,
              round(avg(receivable_milli_fils))::bigint AS receivable,
              round(avg(hub_cost_milli_fils))::bigint AS hub_cost,
              round(avg(liability_milli_fils))::bigint AS liability,
              round(avg(profit_milli_fils))::bigint AS profit,
              avg(metering_coverage_percent)::float8 AS coverage,
              avg(leakage_percent)::float8 AS leakage
         FROM latest`,
      [input.period]
    )
    const row = result.rows[0]
    const tenantCount = Number(row.tenant_count)
    if (tenantCount < 3) throw new Error('cross-tenant billing benchmark requires at least 3 tenants')
    await this.audit.emit({ event_type: 'cross_tenant_billing_benchmark', acting_principal: input.actingPrincipal, acting_persona: input.actingPersona, scope_used: input.purposeCode, request_trace_id: input.traceId, request_body: { purpose_code: input.purposeCode, period: input.period, tenant_count: tenantCount }, response_status: 200 })
    return {
      period: input.period, tenantCount, currency: 'AED',
      averages: {
        receivableMilliFils: Number(row.receivable), hubCostMilliFils: Number(row.hub_cost),
        liabilityMilliFils: Number(row.liability), profitMilliFils: Number(row.profit),
        meteringCoveragePercent: Number(row.coverage), leakagePercent: Number(row.leakage)
      }
    }
  }

  async close(): Promise<void> { await this.pool.end() }
}
