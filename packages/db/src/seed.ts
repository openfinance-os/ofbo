import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'
import { generateDemoDataset, DEMO_BANK_ID } from '@ofbo/synthetic-data'

/**
 * Seeds the deterministic demo dataset (PRD §3.1). Idempotent: natural keys +
 * ON CONFLICT DO NOTHING, audit rows keyed by a deterministic trace id per event.
 * Synthetic data only — generators are PII-safe by construction.
 */
export async function seedDemoDataset(databaseUrl: string): Promise<void> {
  const ds = generateDemoDataset()
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const tpps = [...new Set(ds.billing_lines.map((l) => l.tpp_organisation_id))]
    for (const org of tpps) {
      await pool.query(
        `INSERT INTO tpp_counterparty (bank_id, channel, organisation_id, legal_name, directory_synced_at)
         VALUES ($1, 'external_tpp_aas', $2, $3, now())
         ON CONFLICT (bank_id, organisation_id) DO NOTHING`,
        [DEMO_BANK_ID, org, `Fictional ${org.replace('org-fictional-', '').replace(/-/g, ' ')}`]
      )
    }
    // BACKOFFICE-71: the consuming-TPP registry's write path emits BCBS 239 lineage.
    // Emit it for the seeded rows too so a freshly-seeded DB has tpp_counterparty
    // covered (closes the formerly-allowlisted Q4.5 gap). Idempotent on trace_id.
    await pool.query(
      `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
       SELECT $1, 'external_tpp_aas', 'tpp_counterparty', $2::text[], 'seed-tpp-registry', 'seed-tpp-counterparty'
        WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = 'tpp_counterparty' AND trace_id = 'seed-tpp-counterparty')`,
      [DEMO_BANK_ID, ['bank_id', 'channel', 'organisation_id', 'legal_name', 'directory_synced_at']]
    )

    // BACKOFFICE-28 — Operations Console substrate: certification status per role
    // (the verbatim scheme tracks) + a resolved historical outage (zero active =
    // "all operational"). Idempotent; the seed emits BCBS 239 lineage for both.
    const certifications: [string, string, string, string, number, number, string][] = [
      ['LFI', 'Demo Bank (LFI)', 'Sandbox -> Pre-Prod CX -> Prod -> Live-Proving', 'Live-Proving (>=2 TPPs)', 4, 3, 'live_proving'],
      ['TPP', 'org-fictional-fintech-01', 'FAPI RP cert -> Functional -> CX -> Live-Proving', 'Live (>=1 LFI)', 4, 4, 'live'],
      ['TPP', 'org-fictional-fintech-02', 'FAPI RP cert -> Functional -> CX -> Live-Proving', 'Functional', 4, 2, 'in_progress']
    ]
    for (const [role, subject, track, stage, total, done, status] of certifications) {
      await pool.query(
        `INSERT INTO platform_certification (bank_id, channel, role, subject, track, current_stage, stages_total, stages_completed, status)
         VALUES ($1, 'internal_retail', $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bank_id, role, subject) DO NOTHING`,
        [DEMO_BANK_ID, role, subject, track, stage, total, done, status]
      )
    }
    await pool.query(
      `INSERT INTO platform_outage (bank_id, channel, title, component, severity, status, started_at, resolved_at)
       SELECT $1, 'internal_retail', 'Nebras Dataset API elevated latency', 'nebras-dataset', 'minor', 'resolved',
              '2026-06-10T08:00:00Z', '2026-06-10T09:15:00Z'
        WHERE NOT EXISTS (SELECT 1 FROM platform_outage WHERE bank_id = $1 AND title = 'Nebras Dataset API elevated latency')`,
      [DEMO_BANK_ID]
    )
    await pool.query(
      `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
       SELECT $1, 'internal_retail', 'platform_certification', $2::text[], 'seed-operations', 'seed-platform-certification'
        WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = 'platform_certification' AND trace_id = 'seed-platform-certification')`,
      [DEMO_BANK_ID, ['bank_id', 'channel', 'role', 'subject', 'track', 'current_stage', 'status']]
    )
    await pool.query(
      `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
       SELECT $1, 'internal_retail', 'platform_outage', $2::text[], 'seed-operations', 'seed-platform-outage'
        WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = 'platform_outage' AND trace_id = 'seed-platform-outage')`,
      [DEMO_BANK_ID, ['bank_id', 'channel', 'title', 'component', 'severity', 'status']]
    )

    for (const psu of ds.psus) {
      for (const consent of psu.consents) {
        const eventType =
          consent.status === 'Revoked' ? 'consent_revoked' : consent.status === 'Consumed' ? 'consent_accessed' : 'consent_granted'
        const traceId = `seed-${consent.consent_id}`
        await pool.query(
          `INSERT INTO audit_high_sensitivity
             (bank_id, channel, event_type, acting_principal, acting_persona, scope_used,
              target_psu_identifier, target_consent_id, request_trace_id, request_body_redacted, response_status)
           SELECT $1, 'internal_retail', $2, 'seed', 'system', 'seed',
                  $3, $4, $5, '{}'::jsonb, 200
           WHERE NOT EXISTS (SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $5)`,
          [DEMO_BANK_ID, eventType, psu.bank_customer_id, consent.consent_id, traceId]
        )
      }
    }

    // ── Derived analytical data (normally produced by the headless worker jobs, which a
    //    seed-only local DB never runs) — so the Reconciliation, Analytics and Risk consoles
    //    show populated tables instead of empty states. Idempotent + lineage-emitting (Q4.5).
    const RUN_ID = 'seed-recon-2026-06-18'
    await pool.query(
      `INSERT INTO reconciliation_log
         (bank_id, channel, run_id, run_type, status, window_start, window_end,
          line_count_total, line_count_matched, line_count_unmatched, line_count_disputed)
       SELECT $1, 'internal_retail', $2, 'daily', 'completed',
              '2026-06-18T00:00:00Z', '2026-06-18T23:59:59Z', 1280, 1268, 9, 3
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_log WHERE run_id = $2)`,
      [DEMO_BANK_ID, RUN_ID]
    )
    // two open breaks for the Break Queue (variance amount+currency both set or both null)
    const breaks: [string, string, number, number, string, string, string][] = [
      ['nebras_fees', 'flagged', 999, 1, 'NBR-2026-06-18-0042', 'LFI-METER-0042', 'FT-BILL-0042'],
      ['payment_settlement', 'assigned', 25000, 1, 'NBR-2026-06-18-0117', 'LFI-METER-0117', 'FT-BILL-0117']
    ]
    for (const [lineType, status, vAmt, vCount, refA, refB, refC] of breaks) {
      await pool.query(
        `INSERT INTO reconciliation_break
           (bank_id, channel, run_id, line_type, status, variance_amount, variance_currency,
            variance_count, source_a_ref, source_b_ref, source_c_ref, sla_clock_started_at)
         SELECT $1, 'internal_retail', $2, $3, $4, $5, 'AED', $6, $7, $8, $9, now()
          WHERE NOT EXISTS (SELECT 1 FROM reconciliation_break WHERE source_a_ref = $7)`,
        [DEMO_BANK_ID, RUN_ID, lineType, status, vAmt, vCount, refA, refB, refC]
      )
    }

    // Nebras report aggregates for the CURRENT period → Analytics finance-view is fresh,
    // not "STALE · NO_INGESTED_AGGREGATES_FOR_PERIOD". UNIQUE(bank_id,period,channel,line_type).
    const aggregates: [string, number, number][] = [
      ['nebras_fees', 4_812_500, 1268],
      ['tpp_aas_pass_through', 1_240_000, 642],
      ['payment_settlement', 9_500_000, 311]
    ]
    for (const [lineType, feeMinor, lineCount] of aggregates) {
      await pool.query(
        `INSERT INTO nebras_report_aggregate
           (bank_id, channel, period, line_type, total_fee_minor, line_count, currency, source_published_at, refreshed_at, freshness)
         VALUES ($1, 'external_tpp_aas', to_char(now(),'YYYY-MM'), $2, $3, $4, 'AED', now(), now(), 'fresh')
         ON CONFLICT (bank_id, period, channel, line_type) DO NOTHING`,
        [DEMO_BANK_ID, lineType, feeMinor, lineCount]
      )
    }

    // A few Risk signals (varied type/severity/status) → Risk View + the risk-signals list.
    const signals: [string, string, string, string | null][] = [
      ['nebras_liability_approach', 'high', 'open', 'sla_execution_failure|LFI|350'],
      ['consent_anomaly', 'medium', 'open', null],
      ['tpp_behaviour', 'low', 'acknowledged', null],
      ['predictive_liability_forecast', 'medium', 'open', 'fraud_prevention_failure|TPP|forecast']
    ]
    for (const [type, severity, status, ref] of signals) {
      await pool.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, nebras_liability_event_ref)
         SELECT $1, 'internal_retail', $2, $3, $4, '{"source":"seed"}'::jsonb, $5
          WHERE NOT EXISTS (SELECT 1 FROM risk_signal WHERE signal_type = $2 AND severity = $3 AND status = $4 AND signal_data->>'source' = 'seed')`,
        [DEMO_BANK_ID, type, severity, status, ref]
      )
    }

    // BCBS 239 lineage for each seeded derived table (keeps the Q4.5 gate green on a
    // seed-only DB; idempotent on trace_id).
    const derivedLineage: [string, string[]][] = [
      ['reconciliation_log', ['bank_id', 'channel', 'run_id', 'status', 'line_count_total']],
      ['reconciliation_break', ['bank_id', 'channel', 'run_id', 'line_type', 'status', 'variance_amount']],
      ['nebras_report_aggregate', ['bank_id', 'channel', 'period', 'line_type', 'total_fee_minor']],
      ['risk_signal', ['bank_id', 'channel', 'signal_type', 'severity', 'status']]
    ]
    for (const [table, columns] of derivedLineage) {
      await pool.query(
        `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
         SELECT $1, 'internal_retail', $2, $3::text[], 'seed-derived', $4
          WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = $2 AND trace_id = $4)`,
        [DEMO_BANK_ID, table, columns, `seed-${table}`]
      )
    }

    // The seed writes audit_high_sensitivity rows directly (above); emit their BCBS 239
    // lineage so a freshly-seeded DB is Q4.5-green standalone (normally the running BFF /
    // integration suite emits this via PgAuditEmitter; on a bare seed it would be missing).
    await pool.query(
      `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
       SELECT $1, 'internal_retail', 'audit_high_sensitivity', $2::text[], 'seed-audit', 'seed-audit-high-sensitivity'
        WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = 'audit_high_sensitivity' AND trace_id = 'seed-audit-high-sensitivity')`,
      [DEMO_BANK_ID, ['bank_id', 'channel', 'event_type', 'acting_principal', 'request_trace_id']]
    )

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
  await seedDemoDataset(url)
  console.log('demo dataset seeded')
}
