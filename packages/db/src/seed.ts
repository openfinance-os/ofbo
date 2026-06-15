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
