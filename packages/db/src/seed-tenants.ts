import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'
import { generateDemoDataset, DEMO_TENANTS, DEMO_BANK_ID, tppDisplayName, type DemoTenant } from '@ofbo/synthetic-data'
import { SEED_ACTOR_SCOPE, SYSTEM_ACTOR_RESPONSE_STATUS } from './audit.js'
import { SEED_QUERY_PURPOSES } from './governed-aggregate.js'
import { normalizeTenantConfiguration } from './tenant-configuration.js'

/**
 * HOST-01 / BILL-10 (ADR 0028 / docs/proposals/multitenant-platform-blueprint.md §6) — the flagged
 * THREE-TENANT demo. Additive and OPT-IN: run AFTER the normal `db:seed:demo` (which seeds the
 * Alpha Bank reference tenant). This:
 *   1. enrols every demo tenant into its own single-member tenant group (HOST-02, migration 0030)
 *      so the `bank_internal_view` governed-aggregate bypass is scoped per customer — proving
 *      cross-customer isolation; and
 *   2. seeds a COMPACT, bank-scoped, PII-safe, deterministic dataset for the two NEW tenants
 *      (Beta Bank, Gamma Takaful) so their consoles are populated when the demo switches tenant.
 *
 * It deliberately does NOT introduce insurance line types / policy shapes (that is INS-01 — spec-first):
 * the insurer tenant reuses the bank data model for the scaffold. Every write is keyed to the
 * tenant's own bank_id with tenant-distinct natural keys, so it never collides with Alpha's seed or
 * the integration fixtures. Idempotent. Synthetic-only (999/000 invariants hold per tenant).
 */

const CH = 'internal_retail'

/** Insert the tenant→group mapping (control-plane; owner/superuser write, RLS is ENABLE-not-FORCE). */
export async function seedTenantGroup(pool: pg.Pool, t: DemoTenant): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_group_member (bank_id, tenant_group_id, group_slug, display_name, tier)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bank_id) DO UPDATE
       SET tenant_group_id = EXCLUDED.tenant_group_id, group_slug = EXCLUDED.group_slug,
           display_name = EXCLUDED.display_name, tier = EXCLUDED.tier`,
    [t.bank_id, t.tenant_group_id, t.slug, t.display_name, t.tier]
  )
}

export async function seedTenantConfiguration(pool: pg.Pool, t: DemoTenant): Promise<void> {
  const config = normalizeTenantConfiguration({
    bankId: t.bank_id,
    yearAnchorDate: t.slug === 'beta-bank' ? '2026-01-01' : '2025-10-01',
    retailOverageMilliFils: t.slug === 'beta-bank' ? 800_000 : t.slug === 'alpha-bank' ? 950_000 : null,
    invoiceTemplateRef: `pint-ae:${t.slug}:v1`,
    invoiceBrandKey: t.brand,
    aspRouteProfile: `asp-${t.slug}`,
    collectionRailPolicy: t.slug === 'beta-bank'
      ? { preferred: 'aani_request_to_pay', fallback: 'uaedds' }
      : { preferred: 'scheme_net_settlement', fallback: 'uaedds' }
  })
  await pool.query(
    `INSERT INTO tenant_configuration
       (bank_id,approval_expiry_business_hours,sla_weekend_pause,fraud_revoke_four_eyes,care_surface_residency,
        year_anchor_date,retail_overage_milli_fils,invoice_template_ref,invoice_brand_key,asp_route_profile,collection_rail_policy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (bank_id) DO UPDATE SET
       year_anchor_date=EXCLUDED.year_anchor_date, retail_overage_milli_fils=EXCLUDED.retail_overage_milli_fils,
       invoice_template_ref=EXCLUDED.invoice_template_ref, invoice_brand_key=EXCLUDED.invoice_brand_key,
       asp_route_profile=EXCLUDED.asp_route_profile, collection_rail_policy=EXCLUDED.collection_rail_policy,
       updated_at=now()`,
    [config.bankId,config.approvalExpiryBusinessHours,config.slaWeekendPause,config.fraudRevokeFourEyes,
      config.careSurfaceResidency,config.yearAnchorDate,config.retailOverageMilliFils,config.invoiceTemplateRef,
      config.invoiceBrandKey,config.aspRouteProfile,JSON.stringify(config.collectionRailPolicy)]
  )
}

/** Compact, bank-scoped, deterministic data for one non-default tenant. */
async function seedTenantData(pool: pg.Pool, t: DemoTenant): Promise<void> {
  const ds = generateDemoDataset(t.seed)
  const bankId = t.bank_id

  // TPP counterparties (registry / billing consoles). bank-scoped ON CONFLICT.
  const orgs = [...new Set(ds.billing_lines.map((l) => l.tpp_organisation_id))].slice(0, 3)
  for (const org of orgs) {
    await pool.query(
      `INSERT INTO tpp_counterparty
         (bank_id, channel, organisation_id, legal_name, directory_synced_at,
          production_status, registration_state, first_traffic_at, financial_system_ref)
       VALUES ($1, 'external_tpp_aas', $2, $3, now(), 'active_traffic', 'registered', now() - interval '60 days', 'fms-' || $2)
       ON CONFLICT (bank_id, organisation_id) DO NOTHING`,
      [bankId, org, tppDisplayName(org)]
    )
  }

  // Consent-lifecycle audit rows (care + audit consoles). Trace id is tenant-distinct.
  for (const psu of ds.psus) {
    for (const consent of psu.consents) {
      const eventType =
        consent.status === 'Revoked' ? 'consent_revoked' : consent.status === 'Consumed' ? 'consent_accessed' : 'consent_granted'
      const traceId = `seed-${t.slug}-${consent.consent_id}`
      await pool.query(
        `INSERT INTO audit_high_sensitivity
           (bank_id, channel, event_type, acting_principal, acting_persona, scope_used,
            target_psu_identifier, target_consent_id, request_trace_id, request_body_redacted, response_status)
         SELECT $1, $2, $3, 'seed', 'system', $7, $4, $5, $6, '{}'::jsonb, $8
          WHERE NOT EXISTS (SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $6)`,
        // Status sentinel as well as scope — see the same insert in seed.ts. A raw-SQL seed row
        // issues no HTTP response, so a literal 200 fabricated one.
        [bankId, CH, eventType, psu.bank_customer_id, consent.consent_id, traceId,
          SEED_ACTOR_SCOPE, SYSTEM_ACTOR_RESPONSE_STATUS]
      )
    }
  }

  // A daily reconciliation run + two open breaks (finance console). run_id is globally UNIQUE,
  // so it MUST be tenant-distinct; break refs are tenant-prefixed.
  const runId = `seed-recon-${t.slug}-2026-06-18`
  await pool.query(
    `INSERT INTO reconciliation_log
       (bank_id, channel, run_id, run_type, status, window_start, window_end,
        line_count_total, line_count_matched, line_count_unmatched, line_count_disputed)
     SELECT $1, $2, $3, 'daily', 'completed', '2026-06-18T00:00:00Z', '2026-06-18T23:59:59Z', 940, 931, 7, 2
      WHERE NOT EXISTS (SELECT 1 FROM reconciliation_log WHERE run_id = $3)`,
    [bankId, CH, runId]
  )
  const breaks: [string, string, number, string][] = [
    ['nebras_fees', 'flagged', 999, `NBR-${t.slug}-0042`],
    ['payment_settlement', 'assigned', 18000, `NBR-${t.slug}-0117`]
  ]
  for (const [lineType, status, vAmt, refA] of breaks) {
    await pool.query(
      `INSERT INTO reconciliation_break
         (bank_id, channel, run_id, line_type, status, variance_amount, variance_currency,
          variance_count, source_a_ref, source_b_ref, source_c_ref, sla_clock_started_at)
       SELECT $1, $2, $3, $4, $5, $6, 'AED', 1, $7, $7 || '-B', $7 || '-C', now()
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_break WHERE source_a_ref = $7)`,
      [bankId, CH, runId, lineType, status, vAmt, refA]
    )
  }

  // Current-period Nebras aggregates (analytics fresh, not STALE). bank-scoped ON CONFLICT.
  const aggregates: [string, number, number][] = [
    ['nebras_fees', 3_100_000, 931],
    ['tpp_aas_pass_through', 820_000, 401]
  ]
  for (const [lineType, feeMinor, lineCount] of aggregates) {
    await pool.query(
      `INSERT INTO nebras_report_aggregate
         (bank_id, channel, period, line_type, total_fee_minor, line_count, currency, source_published_at, refreshed_at, freshness)
       VALUES ($1, 'external_tpp_aas', to_char(now(),'YYYY-MM'), $2, $3, $4, 'AED', now(), now(), 'fresh')
       ON CONFLICT (bank_id, period, channel, line_type) DO NOTHING`,
      [bankId, lineType, feeMinor, lineCount]
    )
  }

  // Two Risk signals. Guarded per-tenant (source carries the slug + bank_id differs).
  const src = `seed-${t.slug}`
  const signals: [string, string, string, string | null][] = [
    ['nebras_liability_approach', 'high', 'open', 'sla_execution_failure|LFI|350'],
    ['consent_anomaly', 'medium', 'open', null]
  ]
  for (const [type, severity, status, ref] of signals) {
    await pool.query(
      `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, nebras_liability_event_ref)
       SELECT $1, $2, $3, $4, $5, jsonb_build_object('source', $6::text), $7
        WHERE NOT EXISTS (SELECT 1 FROM risk_signal WHERE bank_id = $1 AND signal_type = $3 AND signal_data->>'source' = $6)`,
      [bankId, CH, type, severity, status, src, ref]
    )
  }

  // BD-13 cross-fintech query purposes (pre-approved) so this tenant's governed reads pass the gate.
  for (const p of SEED_QUERY_PURPOSES) {
    await pool.query(
      `INSERT INTO query_purpose_registry (bank_id, channel, purpose_code, description, registered_by, approved_by)
       VALUES ($1, $2, $3, $4, 'system:bd-13-seed', 'system:bd-13-seed')
       ON CONFLICT (bank_id, purpose_code) DO NOTHING`,
      [bankId, CH, p.purpose_code, p.description]
    )
  }

  // BCBS 239 lineage for every table this seed touched (Q4.5-green standalone; tenant-distinct trace ids).
  const lineage: [string, string, string[]][] = [
    ['external_tpp_aas', 'tpp_counterparty', ['bank_id', 'channel', 'organisation_id', 'legal_name']],
    [CH, 'audit_high_sensitivity', ['bank_id', 'channel', 'event_type', 'acting_principal', 'request_trace_id']],
    [CH, 'reconciliation_log', ['bank_id', 'channel', 'run_id', 'status', 'line_count_total']],
    [CH, 'reconciliation_break', ['bank_id', 'channel', 'run_id', 'line_type', 'status', 'variance_amount']],
    ['external_tpp_aas', 'nebras_report_aggregate', ['bank_id', 'channel', 'period', 'line_type', 'total_fee_minor']],
    [CH, 'risk_signal', ['bank_id', 'channel', 'signal_type', 'severity', 'status']],
    [CH, 'query_purpose_registry', ['bank_id', 'channel', 'purpose_code', 'registered_by', 'approved_by']]
  ]
  for (const [channel, table, columns] of lineage) {
    const traceId = `seed-tenant-${t.slug}-${table}`
    await pool.query(
      `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
       SELECT $1, $2, $3, $4::text[], 'seed-tenant', $5
        WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = $3 AND trace_id = $5)`,
      [bankId, channel, table, columns, traceId]
    )
  }
}

/**
 * Seed the flagged multi-tenant demo: group mappings for ALL demo tenants (so even Alpha's governed
 * aggregates are group-scoped) + compact data for the non-default tenants.
 */
export async function seedDemoTenants(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    for (const t of DEMO_TENANTS) {
      await seedTenantGroup(pool, t)
      await seedTenantConfiguration(pool, t)
      // Alpha Bank keeps its existing rich seed (db:seed / db:seed:demo); only its group mapping is added here.
      if (t.bank_id !== DEMO_BANK_ID) await seedTenantData(pool, t)
      const traceId = `seed-tenant-${t.slug}-tenant_configuration`
      await pool.query(
        `INSERT INTO lineage_events (bank_id,channel,table_name,columns,source,trace_id)
         SELECT $1,$2,'tenant_configuration',$3::text[],'seed-tenant',$4
          WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name='tenant_configuration' AND trace_id=$4)`,
        [t.bank_id,CH,['bank_id','year_anchor_date','retail_overage_milli_fils','invoice_template_ref','invoice_brand_key','asp_route_profile','collection_rail_policy'],traceId]
      )
    }
    await pool.query(`REFRESH MATERIALIZED VIEW consent_admin_event`)
  } finally {
    await pool.end()
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  await seedDemoTenants(url)
  console.log(`multi-tenant demo seeded (${DEMO_TENANTS.length} tenants)`)
}
