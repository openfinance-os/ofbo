import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'
import { DEMO_BANK_ID } from '@ofbo/synthetic-data'
import { seedDemoDataset } from './seed.js'

/**
 * Rich DEMO scenario layered ON TOP of the base seedDemoDataset — a believable
 * "operating back office" so every console has depth: a 30-day reconciliation history,
 * a full break queue, a dozen risk signals across types/severities/states, pending
 * four-eyes approvals, and disputes (incl. a cross-scheme double-compensation case).
 *
 * Deliberately SEPARATE from seedDemoDataset (which CI runs before the integration suite)
 * so this richer data NEVER collides with integration fixtures. Run via `pnpm db:seed:demo`
 * for local dev + the deployed demo; CI keeps using the minimal `pnpm db:seed`.
 *
 * Synthetic-only, idempotent (natural-key guards), and emits BCBS 239 lineage for every
 * table it touches (Q4.5 stays green). No PSU PII — class/party/ref data only.
 */
const CH = 'internal_retail'

export async function seedDemoScenario(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    // ── 1. 30-day reconciliation history → the SLO dashboard shows a trend, not one row.
    await pool.query(
      `INSERT INTO reconciliation_log
         (bank_id, channel, run_id, run_type, status, window_start, window_end,
          line_count_total, line_count_matched, line_count_unmatched, line_count_disputed, created_at)
       SELECT $1, $2, 'demo-recon-' || to_char(x.d, 'YYYY-MM-DD'), 'daily', 'completed',
              x.d::timestamptz, x.d + interval '1 day' - interval '1 second',
              x.t, x.t - x.u - x.dp, x.u, x.dp, x.d + interval '23 hours'
         FROM (
           SELECT d,
                  1180 + ((extract(doy from d)::int * 37) % 220) AS t,
                  ((extract(doy from d)::int * 13) % 14)        AS u,
                  ((extract(doy from d)::int * 7) % 6)          AS dp
             FROM generate_series(now()::date - 29, now()::date, interval '1 day') AS d
         ) x
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_log r WHERE r.run_id = 'demo-recon-' || to_char(x.d, 'YYYY-MM-DD'))`,
      [DEMO_BANK_ID, CH]
    )
    const TODAY_RUN = `demo-recon-today`
    await pool.query(
      `INSERT INTO reconciliation_log
         (bank_id, channel, run_id, run_type, status, window_start, window_end,
          line_count_total, line_count_matched, line_count_unmatched, line_count_disputed)
       SELECT $1, $2, $3, 'daily', 'completed', now()::date, now(), 1322, 1303, 13, 6
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_log WHERE run_id = $3)`,
      [DEMO_BANK_ID, CH, TODAY_RUN]
    )

    // ── 2. A full Break Queue: varied line types, ages, statuses, assignees.
    type Brk = [string, string, number, number, string, string | null, number]
    const breaks: Brk[] = [
      // line_type, status, variance_amount(fils), variance_count, ref_suffix, assigned_to, age_days
      ['nebras_fees', 'flagged', 1450, 3, '0001', null, 0],
      ['payment_settlement', 'flagged', 75000, 1, '0002', null, 0],
      ['tpp_aas_pass_through', 'flagged', 2300, 5, '0003', null, 1],
      ['nebras_fees', 'flagged', 999, 1, '0004', null, 1],
      ['consent_record', 'flagged', 0, 2, '0005', null, 2],
      ['lfi_access_log', 'flagged', 500, 1, '0006', null, 2],
      ['payment_settlement', 'assigned', 125000, 1, '0007', 'demo:finance-analyst', 1],
      ['nebras_fees', 'assigned', 3400, 4, '0008', 'demo:finance-analyst', 2],
      ['tpp_aas_pass_through', 'assigned', 1800, 2, '0009', 'demo:finance-analyst', 3],
      ['nebras_fees', 'resolved_matched', 600, 1, '0010', 'demo:finance-analyst', 5],
      ['payment_settlement', 'resolved_matched', 25000, 1, '0011', 'demo:finance-analyst', 6]
    ]
    for (const [lineType, status, va, vc, suffix, assignee, age] of breaks) {
      const resolved = status.startsWith('resolved')
      await pool.query(
        `INSERT INTO reconciliation_break
           (bank_id, channel, run_id, line_type, status, variance_amount, variance_currency, variance_count,
            source_a_ref, source_b_ref, source_c_ref, assigned_to, sla_clock_started_at, resolution_outcome,
            resolution_note, resolved_at, created_at)
         SELECT $1, $2, $3, $4, $5, $6, 'AED', $7, $8, $9, $10, $11,
                now() - ($12 || ' days')::interval,
                $13, $14, $15, now() - ($12 || ' days')::interval
          WHERE NOT EXISTS (SELECT 1 FROM reconciliation_break br WHERE br.source_a_ref = $8)`,
        [
          DEMO_BANK_ID, CH, TODAY_RUN, lineType, status, va, vc,
          `NBR-D-${suffix}`, `LFI-MTR-${suffix}`, `FT-BIL-${suffix}`, assignee, String(age),
          resolved ? 'matched_after_correction' : null,
          resolved ? 'Confirmed against the Nebras report after a metering correction; variance within tolerance.' : null,
          resolved ? new Date().toISOString() : null
        ]
      )
    }

    // ── 3. Risk signals across all types / severities / states → Risk view + triage have depth.
    type Sig = [string, string, string, string | null, string]
    const signals: Sig[] = [
      // signal_type, severity, status, nebras_liability_event_ref, demo_id
      ['nebras_liability_approach', 'high', 'open', 'fraud_prevention_failure|TPP|10000', 's01'],
      ['nebras_liability_approach', 'critical', 'investigating', 'lfi_breaking_change|LFI|5000', 's02'],
      ['consent_anomaly', 'medium', 'open', null, 's03'],
      ['consent_anomaly', 'low', 'acknowledged', null, 's04'],
      ['tpp_behaviour', 'high', 'open', null, 's05'],
      ['tpp_behaviour', 'medium', 'investigating', null, 's06'],
      ['cop_mismatch_spike', 'medium', 'open', null, 's07'],
      ['agent_anomaly', 'low', 'acknowledged', null, 's08'],
      ['predictive_liability_forecast', 'high', 'open', 'fraud_prevention_failure|TPP|forecast', 's09'],
      ['predictive_liability_forecast', 'medium', 'open', 'sla_execution_failure|LFI|350', 's10'],
      ['lfi_report_cadence_missed', 'medium', 'open', null, 's11'],
      ['consent_anomaly', 'high', 'closed_actioned', null, 's12']
    ]
    for (let i = 0; i < signals.length; i++) {
      const [type, severity, status, ref, demoId] = signals[i]!
      await pool.query(
        // spread the signals over the last ~36h deterministically (by ordinal) so the Risk
        // feed reads as a time-series, not a single timestamp.
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, nebras_liability_event_ref, created_at)
         SELECT $1, $2, $3, $4, $5, jsonb_build_object('source','demo-scenario','demo_id',$6::text), $7, now() - ($8 || ' hours')::interval
          WHERE NOT EXISTS (SELECT 1 FROM risk_signal WHERE signal_data->>'demo_id' = $6)`,
        [DEMO_BANK_ID, CH, type, severity, status, demoId, ref, String(i * 3)]
      )
    }

    // ── 4. Pending four-eyes approvals → the Approvals queue isn't empty; a second principal
    //      can approve/reject live (dual initiator/approver cards). Future expiry = actionable.
    // Initiator is a DISTINCT colleague subject (not the logged-in persona's `demo:<persona>`
    // subject) so the persona holding the approver scope can actually approve live in the demo
    // (no-self-approval still holds). approver_required_scope is each held by exactly one persona:
    // disputes:admin→customer-care-agent, billing:write→finance-analyst, compliance:reports:generate→compliance-officer.
    type Appr = [string, string, string, string, Record<string, unknown>]
    const approvals: Appr[] = [
      // approval_request_id, operation_type, initiator (a colleague), approver_required_scope, payload (PII-free)
      ['demo-appr-refund-01', 'disputes.refund', 'demo:care-agent-2', 'disputes:admin', { dispute_id: 'demo-dispute-02', refund_amount: { amount: 75000, currency: 'AED' } }],
      ['demo-appr-invoice-01', 'tpp.invoice_run', 'demo:finance-analyst-2', 'billing:write', { billing_period: '2026-05', record_set_id: 'demo-rs-2026-05', invoice_count: 3 }],
      ['demo-appr-report-01', 'reports.generate_cbuae', 'demo:compliance-officer-2', 'compliance:reports:generate', { report_type: 'cbuae_monthly_reconciliation', period: '2026-05' }]
    ]
    for (const [arid, opType, initiator, scope, payload] of approvals) {
      await pool.query(
        `INSERT INTO approval_request
           (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator, approver_required_scope, expires_at)
         SELECT $1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, now() + interval '2 hours'
          WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE approval_request_id = $3)`,
        [DEMO_BANK_ID, CH, arid, opType, JSON.stringify(payload), initiator, scope]
      )
    }

    // ── 5. Disputes across the lifecycle + a cross-scheme double-compensation case (the 409 guard).
    type Disp = [string, string, string, string, string | null, boolean, boolean]
    const disputes: Disp[] = [
      // marker(care_case_id), psu, dispute_type, state, nebras_case_id, refund_set, cross_scheme(compensation_blocked)
      ['demo-dispute-01', 'cust-0001', 'unauthorised_payment', 'open', 'NBR-CASE-0001', false, false],
      ['demo-dispute-02', 'cust-0002', 'unauthorised_payment', 'refund_initiated', 'NBR-CASE-0002', true, false],
      ['demo-dispute-03', 'cust-0003', 'consent_complaint', 'in_progress', 'NBR-CASE-0003', false, false],
      ['demo-dispute-04', 'cust-0004', 'unrecognised_tpp', 'escalated', 'NBR-CASE-0004', false, false],
      ['demo-dispute-05', 'cust-0005', 'unauthorised_payment', 'open', 'NBR-CASE-0005', false, true],
      ['demo-dispute-06', 'cust-0001', 'data_misuse_complaint', 'resolved', 'NBR-CASE-0006', false, false]
    ]
    for (const [marker, psu, type, state, nebrasCase, refund, blocked] of disputes) {
      await pool.query(
        `INSERT INTO dispute_case
           (bank_id, channel, psu_identifier, dispute_type, state, originating_payment_id, dispute_reason_code,
            sla_clock_started_at, refund_required_by, refund_initiated_at, refund_amount, refund_currency,
            nebras_case_id, care_case_id, settled_in_other_scheme, compensation_blocked, aani_case_id, created_at)
         SELECT $1, $2, $3, $4, $5, $6::uuid, 'UNAUTH_TXN', now() - interval '6 hours',
                CASE WHEN $7 THEN now() + interval '18 hours' ELSE NULL END,
                CASE WHEN $7 THEN now() - interval '1 hour' ELSE NULL END,
                CASE WHEN $7 THEN 75000 ELSE NULL END,
                CASE WHEN $7 THEN 'AED' ELSE NULL END,
                $8, $9, $10, $10, CASE WHEN $10 THEN 'AANI-CASE-9001' ELSE NULL END, now() - interval '4 hours'
          WHERE NOT EXISTS (SELECT 1 FROM dispute_case WHERE care_case_id = $9)`,
        [DEMO_BANK_ID, CH, psu, type, state, null, refund, nebrasCase, marker, blocked]
      )
    }

    // ── 6. A COHERENT LINKED INCIDENT — one thread a presenter can trace across every console.
    //   INC-2026-0042: an unauthorised payment by PSU cust-0001 via Fictional Fintech 01 →
    //   a dispute (Care) → a reconciliation break on the same payment (Finance) → a risk signal
    //   (Risk) → a pending four-eyes refund (Approvals). The shared token INC-2026-0042 appears on
    //   each surface so the audience sees it is ONE incident across the system, not separate rows.
    const INCIDENT = 'INC-2026-0042'
    const INCIDENT_PSU = 'cust-0001'
    const INCIDENT_TPP = 'Fictional Fintech 01'
    // (a) the dispute (Customer Care → cust-0001)
    await pool.query(
      `INSERT INTO dispute_case
         (bank_id, channel, psu_identifier, dispute_type, state, originating_payment_id, dispute_reason_code,
          sla_clock_started_at, nebras_case_id, care_case_id, settled_in_other_scheme, compensation_blocked, created_at)
       SELECT $1, $2, $3, 'unauthorised_payment', 'in_progress', NULL, 'UNAUTH_TXN',
              now() - interval '5 hours', $4, $5, false, false, now() - interval '5 hours'
        WHERE NOT EXISTS (SELECT 1 FROM dispute_case WHERE care_case_id = $5)`,
      [DEMO_BANK_ID, CH, INCIDENT_PSU, `NBR-CASE-${INCIDENT}`, `dispute-${INCIDENT}`]
    )
    // (b) the reconciliation break on the same payment (Finance) — token in the source refs
    await pool.query(
      `INSERT INTO reconciliation_break
         (bank_id, channel, run_id, line_type, status, variance_amount, variance_currency, variance_count,
          source_a_ref, source_b_ref, source_c_ref, sla_clock_started_at, created_at)
       SELECT $1, $2, $3, 'payment_settlement', 'flagged', 75000, 'AED', 1,
              $4, $5, $6, now() - interval '5 hours', now() - interval '5 hours'
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_break WHERE source_a_ref = $4)`,
      [DEMO_BANK_ID, CH, TODAY_RUN, `NBR-${INCIDENT}`, `LFI-MTR-${INCIDENT}`, `FT-BIL-${INCIDENT}`]
    )
    // (c) the risk signal (Risk) — incident/psu/tpp in signal_data so it reads as the same case
    await pool.query(
      `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, created_at)
       SELECT $1, $2, 'tpp_behaviour', 'high', 'investigating',
              jsonb_build_object('source','demo-scenario','demo_id','inc-0042','incident',$3::text,'psu',$4::text,'tpp',$5::text,
                                 'summary', 'Unauthorised-payment pattern flagged for ' || $5::text || ' (' || $3::text || ')'),
              now() - interval '5 hours'
        WHERE NOT EXISTS (SELECT 1 FROM risk_signal WHERE signal_data->>'demo_id' = 'inc-0042')`,
      [DEMO_BANK_ID, CH, INCIDENT, INCIDENT_PSU, INCIDENT_TPP]
    )
    // (d) the pending four-eyes refund (Approvals) — payload references the incident + dispute
    await pool.query(
      `INSERT INTO approval_request
         (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator, approver_required_scope, expires_at)
       SELECT $1, $2, 'demo-appr-incident-refund', 'disputes.refund', $3::jsonb, 'pending', 'demo:care-agent-2', 'disputes:admin', now() + interval '2 hours'
        WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE approval_request_id = 'demo-appr-incident-refund')`,
      [DEMO_BANK_ID, CH, JSON.stringify({ incident: INCIDENT, dispute_id: `dispute-${INCIDENT}`, psu: INCIDENT_PSU, tpp: INCIDENT_TPP, refund_amount: { amount: 75000, currency: 'AED' } })]
    )

    // ── BCBS 239 lineage for every table this scenario touches (Q4.5 stays green; idempotent).
    const lineage: [string, string[]][] = [
      ['reconciliation_log', ['bank_id', 'channel', 'run_id', 'status', 'line_count_total']],
      ['reconciliation_break', ['bank_id', 'channel', 'run_id', 'line_type', 'status', 'variance_amount']],
      ['risk_signal', ['bank_id', 'channel', 'signal_type', 'severity', 'status']],
      ['approval_request', ['bank_id', 'channel', 'approval_request_id', 'operation_type', 'state']],
      ['dispute_case', ['bank_id', 'channel', 'psu_identifier', 'dispute_type', 'state', 'compensation_blocked']]
    ]
    for (const [table, columns] of lineage) {
      await pool.query(
        `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
         SELECT $1, $2, $3, $4::text[], 'seed-demo-scenario', $5
          WHERE NOT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = $3 AND trace_id = $5)`,
        [DEMO_BANK_ID, CH, table, columns, `seed-demo-${table}`]
      )
    }
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
  await seedDemoScenario(url)
  console.log('rich demo scenario seeded (base dataset + operating-state depth)')
}
