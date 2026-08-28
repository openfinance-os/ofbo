import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'
import { DEMO_BANK_ID, DEMO_TENANTS, DEMO_TPP_DIRECTORY, accrualByTpp } from '@ofbo/synthetic-data'
import { seedDemoDataset } from './seed.js'
import { PgAuditEmitter, SEED_ACTOR_SCOPE, SYSTEM_ACTOR_RESPONSE_STATUS } from './audit.js'
import { seedTenantConfiguration, seedTenantGroup } from './seed-tenants.js'
import { PgTppCounterpartyStore } from './tpp-counterparty-store.js'
import { PgLineageEmitter } from './lineage.js'
import { assertNonProdBulkMutation } from './reset.js'

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
/**
 * A deterministic, UUID-v4-SHAPED id derived from a stable key.
 *
 * The seed has to be idempotent, which rules out `randomUUID()` — a fresh id every run would insert
 * a second approval on every re-seed. But `approval_request_id` is declared `format: uuid` on the
 * contract's ApprovalRequest, and a readable id like `demo-approval-...` fails live response
 * validation on GET /approvals/pending. `verify:contract` caught exactly that.
 *
 * Hashing the key gives both: same key, same id, and a well-formed v4 shape (version nibble 4,
 * variant nibble 8..b) that AJV's uuid format accepts.
 */
function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex')
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const CH = 'internal_retail'
const DEFAULT_DEMO_TENANT = DEMO_TENANTS.find((tenant) => tenant.bank_id === DEMO_BANK_ID)!

/**
 * BILL-09/BILL-10 demo acceptance evidence. The hosted demo is single-tenant by default, so it
 * must provision Alpha even when the opt-in three-tenant seed is not run. A compact current-month
 * expected memo gives the profitability console and pure scenario/export actions persisted,
 * tenant-scoped evidence without inventing an insurance model or mutating production facts.
 */
async function seedBillingConsoleEvidence(pool: pg.Pool): Promise<void> {
  await seedTenantGroup(pool, DEFAULT_DEMO_TENANT)
  await seedTenantConfiguration(pool, DEFAULT_DEMO_TENANT)

  const period = new Date().toISOString().slice(0, 7)
  const inputHash = `sha256:demo-billing-console:${period}`
  // The expected memo IS the book, not a two-line stand-in.
  //
  // It used to be exactly two hardcoded lines — one of them `org-fictional-fintech-01`, a
  // counterparty that exists nowhere else in the repo — totalling AED 200. So the Billing Control
  // Plane reported a monthly profit of AED 200 while the registry next door showed a book of
  // AED 475,000, and its profitability ledger named an institution no other screen had heard of.
  // Two screens over the same month disagreeing by three orders of magnitude is not a demo, it is
  // a bug report waiting to happen.
  //
  // Priced from the same book as the registry accruals, so the two reconcile by construction.
  const book = [...accrualByTpp(period).values()].filter((entry) => entry.accrualMilliFils > 0)
  const lines = book.flatMap((entry) =>
    entry.breakdown.map((line, i) => ({
      lineRef: `${period}|${entry.organisationId}|${line.feeClass}`,
      tppId: entry.organisationId,
      feeClass: line.feeClass,
      units: line.units,
      events: 1,
      amountMilliFils: line.amountMilliFils,
      valueMilliFils: line.amountMilliFils,
      eventIds: [`demo-billing-${entry.organisationId}-${i}`],
      traceIds: [`demo-billing-trace-${entry.organisationId}-${i}`]
    }))
  )
  const memoTotalMilliFils = lines.reduce((sum, line) => sum + line.amountMilliFils, 0)
  const meter = await pool.query(
    `WITH inserted AS (
       INSERT INTO billing_meter_run
         (bank_id,channel,period,rate_card_version,input_hash,event_count,stats,evidence)
       VALUES ($1,$2,$3,'2026.06.02',$4,$7::int,$5::jsonb,$6::jsonb)
       ON CONFLICT (bank_id,period,rate_card_version,input_hash) DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id FROM billing_meter_run
      WHERE bank_id=$1 AND period=$3 AND rate_card_version='2026.06.02' AND input_hash=$4
     LIMIT 1`,
    [DEMO_BANK_ID, CH, period, inputHash,
      JSON.stringify({ demo: true, receivable_lines: lines.length }),
      JSON.stringify({ source: 'seed-demo-scenario', period }), lines.length]
  )
  const meterRunId = meter.rows[0].id as string
  const generatedAt = `${period}-01T00:00:00.000Z`
  const dueAt = `${period}-03T23:59:59.999Z`
  const statement = {
    period, rateCardVersion: '2026.06.02', generatedAt, dueAt, generatedOnTime: true,
    lines, totalMilliFils: memoTotalMilliFils
  }
  const memo = await pool.query(
    `WITH inserted AS (
       INSERT INTO billing_expected_memo
         (bank_id,channel,meter_run_id,meter_input_hash,period,rate_card_version,
          generated_at,due_at,generated_on_time,total_milli_fils,statement_payload)
       VALUES ($1,$2,$3,$4,$5,'2026.06.02',$6,$7,true,$9::bigint,$8::jsonb)
       ON CONFLICT (bank_id,meter_run_id,rate_card_version) DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id FROM billing_expected_memo
      WHERE bank_id=$1 AND meter_run_id=$3 AND rate_card_version='2026.06.02'
     LIMIT 1`,
    [DEMO_BANK_ID, CH, meterRunId, inputHash, period, generatedAt, dueAt, JSON.stringify(statement), memoTotalMilliFils]
  )
  const memoId = memo.rows[0].id as string
  for (const line of lines) {
    await pool.query(
      `INSERT INTO billing_expected_memo_line
         (bank_id,channel,expected_memo_id,line_ref,tpp_id,fee_class,units,event_count,
          amount_milli_fils,value_milli_fils,event_ids,fapi_interaction_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (bank_id,expected_memo_id,line_ref) DO NOTHING`,
      [DEMO_BANK_ID, CH, memoId, line.lineRef, line.tppId, line.feeClass, line.units,
        line.events, line.amountMilliFils, line.valueMilliFils, line.eventIds, line.traceIds]
    )
  }
}

/**
 * BILL-17 demo scenario — the TPP Cost Management (payable) side, deterministic and idempotent.
 *
 * Two periods, chosen so the console demonstrates the gate in BOTH directions, which one period
 * cannot do:
 *
 *   - the month before last is CLOSED under a real four-eyes approval, with its Nebras payable
 *     dispatched and accepted — the "authorised and settled" end state;
 *   - last month is BLOCKED by an unresolved material VAT-variance break, escalated to a real E1
 *     break so the "Investigate →" link resolves — the refusal an operator has to clear.
 *
 * Synthetic only, and PSU-free by construction: the payable ledger references event ids, never a
 * psu_id, so there is nothing here that could carry customer detail. Amounts are milli-fils in
 * storage (the console converts to Money at the wire boundary).
 */
async function seedTppCostEvidence(pool: pg.Pool): Promise<void> {
  const now = new Date()
  const month = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    return d.toISOString().slice(0, 7)
  }
  const closedPeriod = month(2)
  const blockedPeriod = month(1)

  // Hub fees are VAT-EXCLUSIVE per ADR 0007 D4: VAT is 5% ON TOP of the stated net.
  const NET = 4_500_000            // AED 45.00 in milli-fils
  const VAT = Math.round(NET * 0.05)
  const LFI_NET = 1_200_000        // AED 12.00
  const LFI_VAT = Math.round(LFI_NET * 0.05)

  async function seedPeriod(period: string, opts: { withLfi: boolean }): Promise<{
    statementId: string
    nebrasReconciliationId: string
  }> {
    const meter = await pool.query(
      `WITH inserted AS (
         INSERT INTO billing_meter_run
           (bank_id,channel,period,rate_card_version,input_hash,event_count,stats,evidence)
         VALUES ($1,$2,$3,'2026.06.02',$4,12,$5::jsonb,$6::jsonb)
         ON CONFLICT (bank_id,period,rate_card_version,input_hash) DO NOTHING
         RETURNING id
       )
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM billing_meter_run
        WHERE bank_id=$1 AND period=$3 AND rate_card_version='2026.06.02' AND input_hash=$4
       LIMIT 1`,
      [DEMO_BANK_ID, CH, period, `sha256:demo-tpp-cost:${period}`,
        JSON.stringify({ demo: true, payable_lines: 1 }),
        JSON.stringify({ source: 'seed-demo-tpp-cost', period })]
    )
    const meterRunId = meter.rows[0].id as string
    const lfiPayment = opts.withLfi ? LFI_NET : 0
    const totalNet = NET + lfiPayment
    const totalVat = VAT + (opts.withLfi ? LFI_VAT : 0)

    const statement = await pool.query(
      `WITH inserted AS (
         INSERT INTO billing_tpp_cost_statement
           (bank_id,channel,meter_run_id,period,currency,rate_card_version,rate_snapshot_hash,
            pricing_effective_from,generated_at,rating_run_at,nebras_hub_net_milli_fils,
            underlying_lfi_payment_net_milli_fils,underlying_lfi_data_net_milli_fils,
            total_net_milli_fils,total_vat_milli_fils,total_gross_milli_fils,statement_payload,evidence_hash)
         VALUES ($1,$2,$3,$4,'AED','2026.06.02',$5,'2026-06-02',now(),now(),$6,$7,0,$8,$9,$10,
                 jsonb_build_object('period',$4::text,'demo',true),$11)
         ON CONFLICT (bank_id, meter_run_id, rate_card_version, rate_snapshot_hash) DO NOTHING
         RETURNING id
       )
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM billing_tpp_cost_statement WHERE bank_id=$1::uuid AND meter_run_id=$3::uuid LIMIT 1`,
      [DEMO_BANK_ID, CH, meterRunId, period, `sha256:demo-rate-snapshot:${period}`,
        NET, lfiPayment, totalNet, totalVat, totalNet + totalVat, `sha256:demo-statement:${period}`]
    )
    const statementId = statement.rows[0].id as string

    async function seedDocument(
      reference: string, type: string, issuer: string, net: number, vat: number
    ): Promise<string> {
      const doc = await pool.query(
        `WITH inserted AS (
           INSERT INTO billing_tpp_cost_document
             (bank_id,channel,document_type,issuer_id,recipient_id,document_reference,billing_period,
              currency,gross_milli_fils,vat_milli_fils,net_milli_fils,document_sha256,raw_document_ref,
              issued_at,received_at,verified_by,verified_at,idempotency_key,parsed_payload,evidence_hash)
           VALUES ($1,$2,$3,$4,'bank-as-tpp',$5,$6,'AED',$7,$8,$9,$10,$11,
                   now() - interval '20 days', now() - interval '19 days','demo.verifier',
                   now() - interval '19 days',$12,
                   jsonb_build_object('reference',$5::text,'demo',true),$13)
           ON CONFLICT (bank_id, issuer_id, document_reference) DO NOTHING
           RETURNING id
         )
         SELECT id FROM inserted
         UNION ALL
         SELECT id FROM billing_tpp_cost_document
          WHERE bank_id=$1::uuid AND issuer_id=$4::text AND document_reference=$5::text LIMIT 1`,
        [DEMO_BANK_ID, CH, type, issuer, reference, period, net + vat, vat, net,
          `sha256:demo-doc:${reference}`, `s3://demo-retained/${reference}`,
          `demo-idem:${reference}`, `sha256:demo-doc-evidence:${reference}`]
      )
      return doc.rows[0].id as string
    }

    async function seedReconciliation(
      documentId: string, expectedNet: number, actualNet: number, breakCount: number
    ): Promise<string> {
      const runId = `demo-tpp-cost-recon:${period}:${documentId.slice(0, 8)}`
      const variance = actualNet - expectedNet
      const recon = await pool.query(
        `WITH inserted AS (
           INSERT INTO billing_tpp_cost_reconciliation
             (bank_id,channel,statement_id,document_id,billing_period,tolerance_milli_fils,
              query_deadline,query_window_status,reconciliation_run_id,matched_line_count,break_count,
              expected_total_net_milli_fils,actual_total_net_milli_fils,net_variance_milli_fils,
              gross_variance_milli_fils,evidence_hash)
           VALUES ($1,$2,$3,$4,$5,1000, now() + interval '10 days','open',$6,1,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (bank_id, statement_id, document_id, reconciliation_run_id) DO NOTHING
           RETURNING id
         )
         SELECT id FROM inserted
         UNION ALL
         SELECT id FROM billing_tpp_cost_reconciliation
          WHERE bank_id=$1::uuid AND reconciliation_run_id=$6::text LIMIT 1`,
        [DEMO_BANK_ID, CH, statementId, documentId, period, runId, breakCount,
          expectedNet, actualNet, variance, Math.abs(variance), `sha256:demo-recon:${runId}`]
      )
      return recon.rows[0].id as string
    }

    const nebrasDoc = await seedDocument(`NEB-INV-${period}`, 'nebras_tax_invoice', 'NEBRAS', NET, VAT)
    const nebrasRecon = await seedReconciliation(nebrasDoc, NET, NET, 0)
    if (opts.withLfi) {
      const lfiDoc = await seedDocument(`LFI-SELF-${period}`, 'lfi_self_invoice', 'LFI-ALPHA', LFI_NET, LFI_VAT)
      await seedReconciliation(lfiDoc, LFI_NET, LFI_NET, 0)
    }
    return { statementId, nebrasReconciliationId: nebrasRecon }
  }

  // ── The CLOSED period: a real four-eyes approval, a close row citing it, and a dispatch.
  const closed = await seedPeriod(closedPeriod, { withLfi: true })
  const closeApprovalId = deterministicUuid(`demo-approval-tpp-cost-close:${closedPeriod}`)
  await pool.query(
    `INSERT INTO approval_request
       (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator,
        approver, approver_required_scope, expires_at, approved_at)
     SELECT $1,$2,$3,'billing.tpp_cost.period_close',jsonb_build_object('period',$4::text),'approved',
            'demo:finance-analyst@bank','demo:platform-super-admin@bank','finance:reconciliation:write',
            now() - interval '13 days', now() - interval '14 days'
      WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE approval_request_id = $3)`,
    [DEMO_BANK_ID, CH, closeApprovalId, closedPeriod]
  )
  await pool.query(
    `INSERT INTO billing_tpp_cost_period_close
       (bank_id,channel,billing_period,initiated_by,approved_by,approval_request_id,
        feeds_monthly_signoff,closed_at,evidence_hash)
     SELECT $1,$2,$3,'demo:finance-analyst@bank','demo:platform-super-admin@bank',$4,true,
            now() - interval '13 days', $5
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_tpp_cost_period_close WHERE bank_id=$1 AND billing_period=$3)`,
    [DEMO_BANK_ID, CH, closedPeriod, closeApprovalId, `sha256:demo-close:${closedPeriod}`]
  )
  // Dispatched, then accepted — two rows, because the table is an append-only state log.
  for (const [state, ago] of [['dispatched', '12 days'], ['accepted', '3 days']] as const) {
    await pool.query(
      `INSERT INTO billing_tpp_cost_ap_dispatch
         (bank_id,channel,statement_id,reconciliation_id,approval_request_id,initiated_by,approved_by,
          approved_at,dispatch_state,financial_system_ref,idempotency_key,dispatched_at,
          payable_net_milli_fils,response_payload,evidence_hash)
       SELECT $1,$2,$3,$4,$5,'demo:finance-analyst@bank','demo:platform-super-admin@bank',
              now() - interval '14 days', $6, $7, $8, now() - interval '${ago}', $9,
              jsonb_build_object('payable_status',$6::text,'demo',true), $10
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_tpp_cost_ap_dispatch
           WHERE bank_id=$1 AND idempotency_key=$8 AND dispatch_state=$6)`,
      [DEMO_BANK_ID, CH, closed.statementId, closed.nebrasReconciliationId, closeApprovalId,
        state, `P9-DEMO-${closedPeriod}`, `demo-idem-dispatch:${closedPeriod}`, NET,
        `sha256:demo-dispatch:${closedPeriod}:${state}`]
    )
  }

  // ── The BLOCKED period: a material RATE-variance break, escalated so "Investigate →" resolves.
  //
  // Seeded as `rate_variance`, not `vat_variance`, and the distinction is the point. A review found
  // the earlier version wrote a row `reconcilePayable` can NEVER produce: classifyVariance only
  // returns `vat_variance` once the NET variance is inside tolerance, so a genuine VAT break carries
  // a net variance of ~0 — while this row carried 225,000 milli-fils of it. The demo was asserting
  // against a shape the engine does not emit, which is worse than a thin demo because it looks like
  // coverage. A 225,000 milli-fil net overcharge IS a rate_variance, so this is now the same money
  // with the classification the engine would actually give it.
  //
  // Known limitation this exposed, recorded rather than papered over: billing_tpp_cost_diff_line has
  // no VAT columns and persists `variance_milli_fils` as the NET variance for every break type
  // (tpp-cost-reconciliation.ts:660), so a persisted vat_variance shows a variance of ~0 and the
  // console understates a VAT dispute to zero. The close GATE is unaffected — materiality is judged
  // in memory, where the VAT figures still exist — but the reporting weakness is real.
  const blocked = await seedPeriod(blockedPeriod, { withLfi: false })
  const breakRunId = `demo-tpp-cost-break-${blockedPeriod}`
  const e1 = await pool.query(
    `WITH inserted AS (
       INSERT INTO reconciliation_break
         (bank_id,channel,run_id,client_id,line_type,status,variance_amount,variance_currency,
          source_a_ref,source_b_ref)
       VALUES ($1,$2,$3,NULL,'nebras_fees','flagged',225,'AED',$4,$5)
       ON CONFLICT DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id FROM reconciliation_break WHERE bank_id=$1::uuid AND run_id=$3::text LIMIT 1`,
    [DEMO_BANK_ID, CH, breakRunId, `NEB-INV-${blockedPeriod}|SI-CORP-PAY`, 'evt-demo-corp-pay-1']
  )
  await pool.query(
    `INSERT INTO billing_tpp_cost_diff_line
       (bank_id,channel,reconciliation_id,line_ref,break_type,cost_recipient_type,cost_recipient_id,
        fee_class,expected_milli_fils,actual_milli_fils,variance_milli_fils,variance_basis_points,
        material,presence,reason_code,reconciliation_break_id)
     SELECT $1,$2,$3,$4,'rate_variance','nebras','NEBRAS','hub.standard',$5,$6,$7,50,true,'both',
            'applied_rate_above_schedule',$8
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_tpp_cost_diff_line WHERE bank_id=$1 AND reconciliation_id=$3 AND line_ref=$4)`,
    [DEMO_BANK_ID, CH, blocked.nebrasReconciliationId, `NEB-INV-${blockedPeriod}|SI-CORP-PAY`,
      NET, NET + 225_000, 225_000, e1.rows[0].id]
  )
}

export async function seedDemoScenario(databaseUrl: string): Promise<void> {
  // FIRST STATEMENT, before a pool is opened — the same position `db:reset` puts it in.
  //
  // The first cut of this guard sat ~420 lines down, immediately above the directory sync, and its
  // comment claimed parity with `db:reset` (which "refuses before touching anything"). It did not
  // have it: everything above ran unguarded — reconciliation runs and breaks, risk signals,
  // approvals, disputes, STR drafts, fraud incidents, the billing tables, the counterparty INSERT,
  // and a bulk UPDATE of counterparty rows the seed did not write. Those tables have no deletion
  // path (0003_rls.sql grants DELETE to no role), so synthetic rows landed in a non-demo database
  // are unremovable through the application — which is the outcome "synthetic data only in BOTH
  // profiles' non-prod" exists to prevent.
  //
  // A guard that runs after the writes it advertises is worse than none: it reads as protection in
  // review while protecting nothing.
  assertNonProdBulkMutation('db:seed:demo')

  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    await seedBillingConsoleEvidence(pool)
    await seedTppCostEvidence(pool)

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
    // approval_request_id is a UUID in the contract (real approvals use crypto.randomUUID) — use
    // stable UUID literals here (not readable slugs, which drift from the spec's uuid format), and
    // carry a `demo_marker` in the payload for the scenario's own natural-key scoping.
    type Appr = [string, string, string, string, string, Record<string, unknown>]
    const approvals: Appr[] = [
      // approval_request_id (uuid), demo_marker, operation_type, initiator (a colleague), approver_required_scope, payload (PII-free)
      ['a0000000-0000-4000-8000-000000000001', 'demo-appr-refund-01', 'disputes.refund', 'demo:care-agent-2', 'disputes:admin', { dispute_id: 'demo-dispute-02', refund_amount: { amount: 75000, currency: 'AED' } }],
      ['a0000000-0000-4000-8000-000000000002', 'demo-appr-invoice-01', 'tpp.invoice_run', 'demo:finance-analyst-2', 'billing:write', { billing_period: '2026-05', record_set_id: 'demo-rs-2026-05', invoice_count: 3 }],
      ['a0000000-0000-4000-8000-000000000003', 'demo-appr-report-01', 'reports.generate_cbuae', 'demo:compliance-officer-2', 'compliance:reports:generate', { report_type: 'cbuae_monthly_reconciliation', period: '2026-05' }]
    ]
    for (const [arid, marker, opType, initiator, scope, payload] of approvals) {
      await pool.query(
        `INSERT INTO approval_request
           (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator, approver_required_scope, expires_at)
         SELECT $1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, now() + interval '2 hours'
          WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE approval_request_id = $3)`,
        [DEMO_BANK_ID, CH, arid, opType, JSON.stringify({ ...payload, demo_marker: marker }), initiator, scope]
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
    //   INC-2026-0042: an unauthorised payment by PSU cust-0001 via Kanz Money (a FICTIONAL TPP —
    //   this thread carries a fraud signal + STR draft, so it is never attributed to a real brand) →
    //   a dispute (Care) → a reconciliation break on the same payment (Finance) → a risk signal
    //   (Risk) → a pending four-eyes refund (Approvals). The shared token INC-2026-0042 appears on
    //   each surface so the audience sees it is ONE incident across the system, not separate rows.
    const INCIDENT = 'INC-2026-0042'
    const INCIDENT_PSU = 'cust-0001'
    const INCIDENT_TPP = 'Kanz Money FZ-LLC'
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
    // (d) the pending four-eyes refund (Approvals) — payload references the incident + dispute.
    //     approval_request_id is a stable UUID literal (contract requires uuid format).
    await pool.query(
      `INSERT INTO approval_request
         (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator, approver_required_scope, expires_at)
       SELECT $1, $2, 'a0000000-0000-4000-8000-000000000042', 'disputes.refund', $3::jsonb, 'pending', 'demo:care-agent-2', 'disputes:admin', now() + interval '2 hours'
        WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE approval_request_id = 'a0000000-0000-4000-8000-000000000042')`,
      [DEMO_BANK_ID, CH, JSON.stringify({ incident: INCIDENT, dispute_id: `dispute-${INCIDENT}`, psu: INCIDENT_PSU, tpp: INCIDENT_TPP, refund_amount: { amount: 75000, currency: 'AED' }, demo_marker: 'demo-appr-incident-refund' })]
    )

    // ── 7. Nebras service-desk cases (BACKOFFICE-79) → the service-desk surface has depth.
    //      One case is the INC-2026-0042 thread continued: it links the same break, dispute, and
    //      risk-signal rows, so the incident is traceable into Ops too (linked_* FKs resolved by
    //      natural key from the rows seeded in section 6).
    type Sdc = [string, string, string, string, string, number, number]
    const serviceDeskCases: Sdc[] = [
      // nebras_case_reference, case_type, priority, status, summary, age_hours, sla_hours_from_now
      ['NBR-SD-0001', 'billing_query', 'P3', 'open', 'Nebras invoice line mismatch for the 2026-05 metering window — awaiting Hub confirmation.', 6, 42],
      ['NBR-SD-0002', 'incident', 'P2', 'in_progress', 'Intermittent TPP-report polling 429s during the morning peak; back-off holding.', 3, 9],
      ['NBR-SD-0003', 'onboarding', 'P4', 'awaiting_nebras', 'New TPP counterparty directory sync pending Nebras activation.', 30, 90],
      ['NBR-SD-0004', 'general', 'P4', 'resolved', 'Clarification on consent-revoke acknowledgment SLA reporting — answered by the Hub.', 50, 0]
    ]
    for (const [ref, type, priority, status, summary, ageH, slaH] of serviceDeskCases) {
      await pool.query(
        `INSERT INTO service_desk_case
           (bank_id, channel, nebras_case_reference, case_type, priority, status, summary, sla_due_at, opened_by, opened_at, resolved_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval, 'demo:operations-engineer',
                now() - ($9 || ' hours')::interval,
                CASE WHEN $6 IN ('resolved', 'closed') THEN now() - interval '1 hour' ELSE NULL END
          WHERE NOT EXISTS (SELECT 1 FROM service_desk_case WHERE nebras_case_reference = $3)`,
        [DEMO_BANK_ID, CH, ref, type, priority, status, summary, String(slaH), String(ageH)]
      )
    }
    // The incident-linked case — resolves the break / dispute / signal ids by their natural keys.
    await pool.query(
      `INSERT INTO service_desk_case
         (bank_id, channel, nebras_case_reference, case_type, priority, status, summary, sla_due_at,
          linked_break_id, linked_dispute_id, linked_signal_id, opened_by, opened_at)
       SELECT $1, $2, $3, 'incident', 'P2', 'in_progress',
              'Unauthorised-payment incident ' || $4 || ' raised with the Nebras service desk; links the recon break, the PSU dispute, and the risk signal.',
              now() + interval '6 hours',
              (SELECT id FROM reconciliation_break WHERE source_a_ref = $5 LIMIT 1),
              (SELECT id FROM dispute_case WHERE care_case_id = $6 LIMIT 1),
              (SELECT id FROM risk_signal WHERE signal_data->>'demo_id' = 'inc-0042' LIMIT 1),
              'demo:operations-engineer', now() - interval '4 hours'
        WHERE NOT EXISTS (SELECT 1 FROM service_desk_case WHERE nebras_case_reference = $3)`,
      [DEMO_BANK_ID, CH, `NBR-SD-${INCIDENT}`, INCIDENT, `NBR-${INCIDENT}`, `dispute-${INCIDENT}`]
    )

    // ── 8. Fraud incidents (BACKOFFICE-77) → the fraud-reporting surface + scheme holds have depth.
    //      Severity P1→critical … P4→low (the Nebras→ITSM mapping). One P1 carries a scheme-imposed
    //      hold; one P2 is the INC-2026-0042 thread reported to the Nebras helpdesk.
    type Fi = [string, string, string, string, boolean, boolean, string, number]
    const fraudIncidents: Fi[] = [
      // nebras_case_reference, nebras_severity, itsm_priority, status, operational_pause, scheme_imposed_hold, summary, age_hours
      ['NBR-FR-0001', 'P3', 'medium', 'open', true, false, 'Suspected unauthorised AISP access; customer operations paused pending review.', 5],
      ['NBR-FR-0002', 'P1', 'critical', 'reported', true, true, 'Systemic-fraud event — scheme-imposed hold active across the affected cohort.', 8],
      ['NBR-FR-0003', 'P4', 'low', 'resolved', false, false, 'Low-severity card-testing signal; resolved with no customer impact.', 40],
      [`NBR-FR-${INCIDENT}`, 'P2', 'high', 'reported', true, false, `Unauthorised-payment incident ${INCIDENT} reported to the Nebras helpdesk; payments paused pending refund.`, 5]
    ]
    for (const [ref, severity, itsm, status, pause, hold, summary, ageH] of fraudIncidents) {
      await pool.query(
        `INSERT INTO fraud_incident
           (bank_id, channel, nebras_severity, itsm_priority, nebras_case_reference, status,
            operational_pause, scheme_imposed_hold, summary, opened_by, opened_at, reported_at, resolved_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'demo:risk-analyst',
                now() - ($10 || ' hours')::interval,
                CASE WHEN $6 IN ('reported', 'resolved') THEN now() - ($10 || ' hours')::interval + interval '30 minutes' ELSE NULL END,
                CASE WHEN $6 = 'resolved' THEN now() - interval '1 hour' ELSE NULL END
          WHERE NOT EXISTS (SELECT 1 FROM fraud_incident WHERE nebras_case_reference = $5)`,
        [DEMO_BANK_ID, CH, severity, itsm, ref, status, pause, hold, summary, String(ageH)]
      )
    }

    // ── 9. STR (Suspicious Transaction Report) drafts (BACKOFFICE-63) → the Compliance STR queue
    //      has depth across the lifecycle. The INC-2026-0042 fraud thread CONTINUES here: the
    //      fraud-suspected revoke on the incident PSU raised an STR draft held for Compliance
    //      handoff to the bank's STR workflow (P10). No PSU PII — an internal consent ref +
    //      synthetic case context only.
    type Str = [string, string, string, string | null, string | null, number]
    const strDrafts: Str[] = [
      // source_consent_id, case_context, status, workflow_ref, approved_by, age_hours
      [`consent-${INCIDENT}`, `Unauthorised-payment incident ${INCIDENT}: a fraud-suspected consent revoke raised this STR draft for Compliance review.`, 'draft', null, null, 5],
      ['consent-demo-7741', 'Velocity anomaly: 6 revoke+re-grant cycles in 24h against one AISP (synthetic).', 'draft', null, null, 20],
      ['consent-demo-8852', 'CoP-mismatch cluster across 3 fintechs sharing a beneficiary (synthetic).', 'awaiting_handoff', null, null, 8],
      ['consent-demo-9963', 'Structuring pattern — repeated payments just below the reporting threshold (synthetic).', 'handed_off', 'str-wf-demo-9963', 'demo:risk-analyst', 30]
    ]
    for (const [consentRef, ctx, status, workflowRef, approvedBy, ageH] of strDrafts) {
      await pool.query(
        `INSERT INTO str_draft
           (bank_id, channel, source_consent_id, case_context, status, created_by, workflow_ref, approved_by, handed_off_at, created_at)
         SELECT $1, $2, $3, $4, $5, 'demo:risk-analyst', $6::text, $7::text,
                CASE WHEN $5 = 'handed_off' THEN now() - interval '1 hour' ELSE NULL END,
                now() - ($8 || ' hours')::interval
          WHERE NOT EXISTS (SELECT 1 FROM str_draft WHERE source_consent_id = $3)`,
        [DEMO_BANK_ID, CH, consentRef, ctx, status, workflowRef, approvedBy, String(ageH)]
      )
    }

    // ── 10. TPP counterparties (BACKOFFICE-07/73) → the TPP Billing & Registry surface reads like
    //       a real book of business: a spread of production status, registration state, MTD fee
    //       accruals, and one carrying UNBILLED traffic (a flag the Finance desk chases). Healthy
    //       counterparties carry real UAE Open Finance provider names; entries in a NEGATIVE state
    //       (unbilled alert / suspended) use fictional names so no real brand is shown adversely.
    //       Contacts are role labels only (no PSU/person PII). The base three (Tarabut/Lean/Tabby)
    //       are seeded by seedDemoDataset — these add further registry depth.
    const CONTACTS = JSON.stringify([{ role: 'technical', label: 'Integration Desk' }, { role: 'commercial', label: 'Partnerships' }])

    // Accruals come from the demo book of business (@ofbo/synthetic-data/billing-book): declared
    // monthly volumes priced by `rateUsage` against the published scheme card. They used to be
    // hand-written round numbers, which meant no volume explained any figure — and because only
    // the institutions seeded HERE were given one, the recognisable UAE names (Lean, Tabby,
    // Tarabut, all seeded by the base dataset) showed a dash while the invented ones carried every
    // dirham of revenue. The registry's credible half looked inert. The book covers all nine.
    const currentPeriod = new Date().toISOString().slice(0, 7)
    const book = accrualByTpp(currentPeriod)
    /** Month-to-date receivable in FILS — the column's unit; the book works in milli-fils. */
    const mtdFils = (orgId: string): number | null => {
      const milliFils = book.get(orgId)?.accrualMilliFils ?? 0
      return milliFils > 0 ? Math.round(milliFils / 1_000) : null
    }

    type Tpp = [string, string, string, string, string, boolean, number | null]
    const tpps: Tpp[] = [
      // organisation_id, legal_name, registration_number, production_status, registration_state, unbilled_traffic, mtd_fee_accrual (fils)
      ['org-yap', 'YAP Digital Ltd', 'CN-1005537', 'active_traffic', 'registered', false, mtdFils('org-yap')],
      ['org-sarwa', 'Sarwa Digital Wealth Ltd', 'CN-1006644', 'active_traffic', 'registered', false, mtdFils('org-sarwa')],
      ['org-mamo', 'Mamo Pay FZ-LLC', 'CN-1008899', 'active_traffic', 'registered', false, mtdFils('org-mamo')],
      ['org-baraka', 'Baraka Financial Ltd', 'CN-1009912', 'directory_only', 'onboarding', false, mtdFils('org-baraka')],
      ['org-meydan-pay', 'Meydan Pay Technologies FZ-LLC', 'CN-1004120', 'active_traffic', 'registered', true, mtdFils('org-meydan-pay')], // FICTIONAL — unbilled alert
      ['org-falaj-money', 'Falaj Money Ltd', 'CN-1007788', 'dormant', 'suspended', false, mtdFils('org-falaj-money')]                     // FICTIONAL — suspended
    ]
    for (const [orgId, legalName, regNum, prodStatus, regState, unbilled, mtd] of tpps) {
      await pool.query(
        `INSERT INTO tpp_counterparty
           (bank_id, channel, organisation_id, legal_name, registration_number, directory_contacts,
            directory_synced_at, production_status, first_traffic_at, registration_state, financial_system_ref,
            unbilled_traffic, mtd_fee_accrual_amount, mtd_fee_accrual_currency)
         SELECT $1, $2, $3, $4, $5, $6::jsonb, now() - interval '6 hours', $7,
                CASE WHEN $7 = 'active_traffic' THEN now() - interval '40 days' ELSE NULL END,
                $8,
                CASE WHEN $8 = 'registered' THEN 'fms-' || $3 ELSE NULL END,
                $9, $10::bigint, CASE WHEN $10::bigint IS NULL THEN NULL ELSE 'AED' END
          WHERE NOT EXISTS (SELECT 1 FROM tpp_counterparty WHERE organisation_id = $3 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, orgId, legalName, regNum, CONTACTS, prodStatus, regState, unbilled, mtd]
      )
    }

    // The base dataset (seed.ts) inserts Lean, Tabby and Tarabut from the billing lines, with no
    // production status and no accrual — so the three most recognisable names in the registry
    // rendered as a dash next to invented institutions showing real money. They are the bank's
    // largest counterparties in the book, so give them their standing and their revenue.
    // UPDATE rather than INSERT: those rows already exist by the time this runs.
    type BookRow = [string, string, string, string]
    const bookRows: BookRow[] = [
      // organisation_id, registration_number, production_status, registration_state
      ['org-lean-technologies', 'CN-1002210', 'active_traffic', 'registered'],
      ['org-tabby', 'CN-1003318', 'active_traffic', 'registered'],
      ['org-tarabut-gateway', 'CN-1001104', 'active_traffic', 'registered']
    ]
    for (const [orgId, regNum, prodStatus, regState] of bookRows) {
      await pool.query(
        `UPDATE tpp_counterparty
            SET registration_number = COALESCE(registration_number, $3),
                directory_contacts = CASE WHEN directory_contacts = '[]'::jsonb THEN $4::jsonb ELSE directory_contacts END,
                production_status = $5,
                registration_state = $6,
                first_traffic_at = COALESCE(first_traffic_at, now() - interval '11 months'),
                financial_system_ref = COALESCE(financial_system_ref, 'fms-' || $2),
                mtd_fee_accrual_amount = $7::bigint,
                mtd_fee_accrual_currency = CASE WHEN $7::bigint IS NULL THEN NULL ELSE 'AED' END
          WHERE bank_id = $1 AND organisation_id = $2`,
        [DEMO_BANK_ID, orgId, regNum, CONTACTS, prodStatus, regState, mtdFils(orgId)]
      )
    }

    // ORPHANS ARE DECOMMISSIONED, NOT DELETED — through the application's own directory sync.
    //
    // The hosted demo carried three `Fictional fintech 0N` counterparties that exist nowhere in
    // this repository: orphans of a seed replaced months earlier, leading the TPP registry (it
    // orders by `created_at`, and they were created first) above Lean, Tabby and Tarabut. An
    // earlier draft of this comment said "sorts by directory sync time", which nothing does — the
    // list query orders by `date_trunc('milliseconds', created_at), organisation_id`. Both seeds
    // are additive — every
    // insert is `ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS` — so re-seeding could never remove
    // them, and the deploy runs `db:apply && db:seed:demo`.
    //
    // The first attempt at this added a DELETE. That was wrong on the schema's own terms:
    // `tpp_counterparty` is registered in `retention_policy` under `CHECK (deletion_allowed =
    // false)`, carries no DELETE policy, and grants `ofbo_app` only INSERT/SELECT/UPDATE — a DELETE
    // as the application role is refused outright. It ran only because the seed connects as a
    // superuser, i.e. the one principal that could equally empty `audit_high_sensitivity`.
    //
    // There was never anything to invent. `syncDirectory` IS the sanctioned write path for exactly
    // this question — it upserts the participants a directory reports and marks every registry org
    // absent from that set `decommissioned`, which is precisely what an orphan is. It runs under
    // `SET LOCAL ROLE ofbo_app`, so it is bounded by the same RLS and grants that refused the
    // DELETE, and — given a lineage sink — it emits BCBS 239 lineage like every other write here.
    //
    // The sink is passed EXPLICITLY. `PgTppCounterpartyStore` takes it as an optional third
    // argument and `emitLineage` is `this.lineage?.emitLineage(...)`, so constructing the store
    // with two arguments makes the lineage emission a silent no-op — and this comment claimed the
    // emission as part of why `syncDirectory` is the right mechanism. CI could not have caught it:
    // `seed.ts` writes its own `seed-tpp-registry` lineage row for this table, so Q4.5 stays green
    // either way.
    //
    // The regulated row is retained and its lifecycle state moves, which is what "no deletion path
    // for regulated records" asks for: a wrong record is closed, not erased.
    //
    // Contacts are passed because this seed HAS them; the store now also preserves what a caller
    // omits, so the P6 operator path (whose participant shape carries neither contacts nor a
    // registration number) no longer empties those columns either. Fixing this only at the seed's
    // call site would have left the operator button doing the erasing — and this diff widened that
    // path from three rows to nine, so fixing one half and widening the other was the actual defect.
    // THE SAME participant set the P6 adapter answers with — `DEMO_TPP_DIRECTORY`, not a local
    // list. Building it here from the seed's own literals made the seed a second directory
    // authority: it declared nine while the adapter listed three, with different legal names for
    // the overlap, so the two disagreed about both who is present and what they are called.
    const directoryContacts = JSON.parse(CONTACTS) as unknown[]
    const directory = DEMO_TPP_DIRECTORY.map((p) => ({ ...p, directory_contacts: directoryContacts }))
    // AUDITED, using the sentinel actor this repository already established for seed writes.
    //
    // An earlier version of this comment argued the opposite — that emitting would mean "inventing"
    // a principal, and a fabricated actor in an INSERT-only trail is worse than the absence. The
    // codebase falsifies the premise: `seed-tenants.ts` and `seed.ts` already emit
    // `audit_high_sensitivity` rows from seeds as `acting_principal='seed'`,
    // `acting_persona='system'`, `SEED_ACTOR_SCOPE`, with `SYSTEM_ACTOR_RESPONSE_STATUS` (0) for
    // exactly the "a seed row issues no HTTP response" case. There was a sanctioned answer and I
    // reasoned past it.
    //
    // It matters because this is the same state transition the operator path audits as
    // `tpp_directory_synced` (tpp-billing/service.ts), on the same regulated rows. Audited when an
    // operator does it and unaudited when the deploy does it is the asymmetry, not the actor.
    const counterpartyStore = new PgTppCounterpartyStore(
      databaseUrl,
      { bankId: DEMO_BANK_ID, channel: CH },
      new PgLineageEmitter(databaseUrl, { bankId: DEMO_BANK_ID, channel: CH })
    )
    const syncLineage = new PgLineageEmitter(databaseUrl, { bankId: DEMO_BANK_ID, channel: CH })
    const syncAudit = new PgAuditEmitter(databaseUrl, { bankId: DEMO_BANK_ID, channel: CH }, syncLineage)
    let sync
    try {
      sync = await counterpartyStore.syncDirectory(directory, 'seed-demo-directory-sync')

      // AUDITED THROUGH THE EMITTER, not hand-rolled SQL over the seed's superuser pool.
      //
      // The previous cut wrote this INSERT by hand and had to be added to the closed
      // `RAW_SQL_AUDIT_WRITERS` set — the set whose members are, by definition, the writes the
      // `scope_used` scanner cannot see. It also ran on the superuser pool, which the backlog note
      // for this very change calls out as "the one principal that can also empty
      // audit_high_sensitivity". `PgAuditEmitter` was in the same package the whole time: it runs
      // every insert as `ofbo_app` inside `beginAppTx`, so the schema's `REVOKE UPDATE, DELETE` and
      // the tenancy policies bind, and it redacts the body at emission.
      //
      // The only reason the hand-rolled version existed was a `WHERE NOT EXISTS` dedupe the emitter
      // has no form for — and that dedupe was itself the defect below, so removing it is what let
      // the sanctioned path back in.
      //
      // EMITTED ON ANY CHANGE, matching the operator path, which audits `synced/added/changed/
      // decommissioned` on every invocation. Gating on decommissions alone left reinstatements and
      // additions — the same regulated transition, through the same upsert — unrecorded when the
      // deploy performed them, which is the exact asymmetry this emission exists to close.
      //
      // NO DEDUPE. Keying on a constant id audited only the first run ever; keying on the
      // decommissioned SET then suppressed a genuine second closure of the same organisations
      // (close X, reinstate X, close X again writes one row for two events). Neither was needed:
      // the store only reports what it actually changed, so a steady-state re-seed reports nothing
      // and writes nothing. Idempotency comes from the store's own `WHERE production_status <>
      // 'decommissioned'`, not from a key.
      const changed = sync.added.length + sync.changed.length + sync.decommissioned.length
      if (changed > 0) {
        if (sync.decommissioned.length > 0) {
          // Announced as well as recorded — a state change the seed makes to rows it did not write.
          console.log(`  directory sync — decommissioned ${sync.decommissioned.length} counterpart(ies) the seed no longer declares: ${sync.decommissioned.join(', ')}`)
        }
        await syncAudit.emit({
          event_type: 'tpp_directory_synced',
          acting_principal: 'seed',
          acting_persona: 'system',
          scope_used: SEED_ACTOR_SCOPE,
          request_trace_id: `seed-demo-directory-sync-${sync.added.length}-${sync.changed.length}-${sync.decommissioned.length}`,
          request_body: { synced: sync.synced, added: sync.added, changed: sync.changed, decommissioned: sync.decommissioned },
          response_status: SYSTEM_ACTOR_RESPONSE_STATUS
        })
      }
    } finally {
      // Every pool this block opened, including the lineage emitter's own — the previous cut closed
      // the store and left that one holding an idle client, which is precisely what its comment
      // claimed to prevent.
      await counterpartyStore.close().catch(() => undefined)
      await syncAudit.close().catch(() => undefined)
      await syncLineage.close().catch(() => undefined)
    }

    // ── 11. Invoice runs (BACKOFFICE-73) → the invoicing surface shows a settled history plus the
    //       current period awaiting four-eyes approval (coherent with the billing:write approval in
    //       section 4, period 2026-05). invoices carry per-TPP amounts (money values, no PII).
    // Periods are RELATIVE to now. They used to be hard-coded 2026-03/04/05, so the invoicing
    // surface silently aged: by August the "current" run awaiting approval was three months old
    // and the two consoles disagreed about which month the demo was in.
    const invoiceNow = new Date()
    const invMonth = (back: number) => {
      const d = new Date(Date.UTC(invoiceNow.getUTCFullYear(), invoiceNow.getUTCMonth() - back, 1))
      return d.toISOString().slice(0, 7)
    }
    type Inv = [string, string, number, number, number]
    const invoiceRuns: Inv[] = [
      // billing_period, status, invoice_count, withheld_line_count, age_days
      [invMonth(3), 'settled', 7, 0, 95],
      [invMonth(2), 'settled', 7, 1, 64],
      [invMonth(1), 'pending_approval', 7, 2, 3]
    ]
    for (const [period, status, count, withheld, ageD] of invoiceRuns) {
      // Invoice amounts are that period's priced book, not a synthetic ramp — so the invoice a
      // Finance Analyst opens reconciles against the accrual shown on the registry, which is the
      // whole point of the screen. Only counterparties that actually billed get an invoice.
      const periodBook = [...accrualByTpp(period, currentPeriod).values()]
        .filter((entry) => entry.accrualMilliFils > 0)
        .sort((a, b) => b.accrualMilliFils - a.accrualMilliFils)
        .slice(0, count)
      const invoices = JSON.stringify(
        periodBook.map((entry) => ({
          organisation_id: entry.organisationId,
          // Money at the wire is integer minor units (fils) + ISO 4217, per CLAUDE.md.
          amount: { amount: Math.round(entry.accrualMilliFils / 1_000), currency: 'AED' }
        }))
      )
      await pool.query(
        `INSERT INTO invoice_run
           (bank_id, channel, billing_period, record_set_id, status, invoices, withheld_line_count, created_at)
         SELECT $1, $2, $3, gen_random_uuid(), $4, $5::jsonb, $6, now() - ($7 || ' days')::interval
          WHERE NOT EXISTS (SELECT 1 FROM invoice_run WHERE billing_period = $3 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, period, status, invoices, withheld, String(ageD)]
      )
    }

    // ── 12. Scheme notifications (BACKOFFICE-78) → outbound downtime/change notices surface has
    //       depth: a compliant maintenance notice, a point release, and a breaking change with the
    //       30-day dual-running clock running. notice_compliant + the deadline are computed.
    type Notif = [string, string, string, number, number, number, number, boolean, boolean, string]
    const notifs: Notif[] = [
      // type, title, description, start_in_days, duration_h, notice_required_days, notified_days_ago, dual_running, acknowledged, status
      ['planned_maintenance', 'Nebras Hub maintenance — TPP Reports API', 'Scheduled Hub maintenance; TPP Reports polling paused during the window.', 7, 4, 10, 14, false, true, 'acknowledged'],
      ['version_release', 'Al Tareq API v2.1.3 point release', 'Non-breaking point release; no client action required.', 14, 2, 10, 20, false, true, 'acknowledged'],
      ['breaking_change', 'Consent schema v3 — breaking payload change', 'Breaking change to the consent payload; 30-day dual-running required before cutover.', 40, 6, 30, 8, true, false, 'notified']
    ]
    for (const [type, title, desc, startD, durH, noticeReq, notifiedAgo, dual, ack, status] of notifs) {
      await pool.query(
        `INSERT INTO scheme_notification
           (bank_id, channel, notification_type, title, description, scheduled_start, scheduled_end,
            notice_required_days, notified_at, notice_deadline, notice_compliant, dual_running_required,
            dual_running_complete, acknowledged, acknowledged_at, propagate_to_tpp, status, created_by)
         SELECT $1, $2, $3, $4, $5,
                now() + ($6 || ' days')::interval,
                now() + ($6 || ' days')::interval + ($7 || ' hours')::interval,
                $8::int, now() - ($9 || ' days')::interval,
                now() + ($6 || ' days')::interval - ($8 || ' days')::interval,
                (now() - ($9 || ' days')::interval) <= (now() + ($6 || ' days')::interval - ($8 || ' days')::interval),
                $10, false, $11,
                CASE WHEN $11 THEN now() - interval '2 days' ELSE NULL END,
                true, $12, 'demo:operations-analyst'
          WHERE NOT EXISTS (SELECT 1 FROM scheme_notification WHERE title = $4 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, type, title, desc, String(startD), String(durH), String(noticeReq), String(notifiedAgo), dual, ack, status]
      )
    }

    // ── 13. Compliance reports (BACKOFFICE-06/08) → the Reports surface shows a submitted history
    //       plus the current period moving through generate → approve → submit. No PSU PII.
    type Rpt = [string, string, string, number, string | null, number]
    const reports: Rpt[] = [
      // report_type, status, classification, period_months_ago, approved_by, age_days
      ['cbuae_monthly_reconciliation', 'submitted', 'confidential-restricted', 3, 'demo:programme-manager', 70],
      ['cbuae_monthly_reconciliation', 'submitted', 'confidential-restricted', 2, 'demo:programme-manager', 40],
      ['cbuae_monthly_reconciliation', 'approved', 'confidential-restricted', 1, 'demo:programme-manager', 8],
      ['nebras_quarterly_liability', 'awaiting_approval', 'restricted', 1, null, 3],
      ['consent_activity_summary', 'generating', 'internal-confidential', 0, null, 0]
    ]
    for (const [rtype, status, cls, pMonths, approver, ageD] of reports) {
      await pool.query(
        `INSERT INTO compliance_report
           (bank_id, channel, report_type, status, reporting_period_start, reporting_period_end,
            classification, requested_by, approved_by, storage_path, integrity_hash, generated_at, submitted_at, created_at)
         SELECT $1, $2, $3, $4,
                date_trunc('month', now()) - ($5 || ' months')::interval,
                date_trunc('month', now()) - ($5 || ' months')::interval + interval '1 month' - interval '1 second',
                $6, 'demo:compliance-officer', $7::text,
                CASE WHEN $4 IN ('approved','submitted','archived') THEN 'demo/reports/' || $3 || '-' || $5 ELSE NULL END,
                CASE WHEN $4 IN ('approved','submitted','archived') THEN 'sha256:demo-' || $3 || '-' || $5 ELSE NULL END,
                CASE WHEN $4 = 'generating' THEN NULL ELSE now() - ($8 || ' days')::interval END,
                CASE WHEN $4 = 'submitted' THEN now() - ($8 || ' days')::interval + interval '2 hours' ELSE NULL END,
                now() - ($8 || ' days')::interval
          WHERE NOT EXISTS (SELECT 1 FROM compliance_report c
                             WHERE c.report_type = $3
                               AND c.reporting_period_start = date_trunc('month', now()) - ($5 || ' months')::interval)`,
        [DEMO_BANK_ID, CH, rtype, status, String(pMonths), cls, approver, String(ageD)]
      )
    }

    // ── 14. Trust Framework participants (BACKOFFICE-74) → the directory of the bank's own
    //       role-holders (Org Admin / PBC / PTC / STC) with T&C + onboarding-stage status and a
    //       turnover in flight. Holder names are INTERNAL role-holder labels (synthetic), no PSU PII.
    type Tfp = [string, string, string, string, string, string | null, string, string | null, number | null]
    const participants: Tfp[] = [
      // role, holder_ref, holder_display_name, individual_tnc, organisational_tnc, onboarding_stage, status, nominated_replacement_ref, stage_due_days
      ['org_admin', 'holder-oa-1', 'Org Admin Holder (synthetic)', 'signed', 'signed', 'live', 'active', null, null],
      ['pbc', 'holder-pbc-1', 'PBC Holder (synthetic)', 'signed', 'signed', 'live', 'active', null, null],
      ['ptc', 'holder-ptc-1', 'PTC Holder (synthetic)', 'sent', 'signed', 'tnc_pending', 'active', null, 5],
      ['stc', 'holder-stc-1', 'STC Holder (synthetic)', 'signed', 'signed', 'live', 'departing', 'holder-stc-2', null],
      ['stc', 'holder-stc-2', 'STC Nominee (synthetic)', 'not_started', 'signed', 'onboarding', 'vacant', null, 10]
    ]
    for (const [role, ref, name, indTnc, orgTnc, stage, status, replacement, dueD] of participants) {
      await pool.query(
        `INSERT INTO trust_framework_participant
           (bank_id, channel, role, organisation_id, holder_ref, holder_display_name, onboarding_stage,
            individual_tnc_status, organisational_tnc_status, onboarding_stage_due_at, status, nominated_replacement_ref)
         SELECT $1, $2, $3, 'org-self-bank', $4, $5, $6, $7, $8,
                CASE WHEN $9::text IS NULL THEN NULL ELSE now() + ($9::text || ' days')::interval END,
                $10, $11::text
          WHERE NOT EXISTS (SELECT 1 FROM trust_framework_participant WHERE holder_ref = $4 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, role, ref, name, stage, indTnc, orgTnc, dueD === null ? null : String(dueD), status, replacement]
      )
    }

    // ── 15. Respondent-side Nebras disputes (BACKOFFICE-75) → the respondent-dispute surface has
    //       depth across the scheme clocks (response → resolution → appeal → implementation), incl.
    //       one overdue and one resolved with a partial-upheld verdict. No PSU PII.
    type Rd = [string, string, string, string, number, number, string | null, number]
    const respondent: Rd[] = [
      // nebras_dispute_ref, category, subject_summary, state, response_due_hours, resolution_due_hours, verdict, age_hours
      ['NBR-RD-0001', 'billing', 'Nebras billing-line variance raised against the bank as respondent.', 'received', 20, 240, null, 4],
      ['NBR-RD-0002', 'consent', 'Consent-handling complaint routed to the bank for response.', 'responded', -2, 200, null, 30],
      ['NBR-RD-0003', 'liability', 'Liability-apportionment dispute under resolution.', 'under_resolution', -48, 120, null, 60],
      ['NBR-RD-0004', 'data_sharing', 'Data-sharing SLA dispute — resolved, upheld in part.', 'resolved', -100, -10, 'partially_upheld', 120]
    ]
    for (const [ref, category, summary, state, respDueH, resolDueH, verdict, ageH] of respondent) {
      await pool.query(
        `INSERT INTO respondent_dispute
           (bank_id, channel, nebras_dispute_ref, category, subject_summary, raised_at,
            state, response_due_at, responded_at, resolution_due_at, resolved_at, verdict_outcome, created_at)
         SELECT $1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval,
                $7, now() + ($8 || ' hours')::interval,
                CASE WHEN $7 IN ('responded','under_resolution','resolved','appealed','awaiting_implementation','implemented','closed') THEN now() - ($6 || ' hours')::interval + interval '2 hours' ELSE NULL END,
                now() + ($9 || ' hours')::interval,
                CASE WHEN $7 IN ('resolved','implemented','closed') THEN now() - interval '2 hours' ELSE NULL END,
                $10::text, now() - ($6 || ' hours')::interval
          WHERE NOT EXISTS (SELECT 1 FROM respondent_dispute WHERE nebras_dispute_ref = $3 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, ref, category, summary, String(ageH), state, String(respDueH), String(resolDueH), verdict]
      )
    }

    // ── 16. Automation agent registry (BACKOFFICE-60) → the Agents surface has depth: a set of
    //       least-privilege read-only automations under human-derived personas, one revoked. Agents
    //       carry no PSU PII — service-account metadata only.
    type Ag = [string, string, string, string, string[], string, number, number]
    const agents: Ag[] = [
      // client_id, display_name, persona, derived_from, scopes, status, spend_budget, age_days
      ['agent-recon-ro', 'Reconciliation read-only bot', 'reconciliation-readonly-agent', 'finance-analyst', ['reconciliation:read', 'billing:read'], 'active', 0, 20],
      ['agent-care-ro', 'Care read-only assistant', 'care-readonly-agent', 'customer-care-agent', ['consents:read', 'disputes:read'], 'active', 0, 12],
      ['agent-analytics-ro', 'Analytics export bot', 'analytics-readonly-agent', 'programme-manager', ['analytics:read'], 'active', 0, 5],
      ['agent-compliance-ro', 'Compliance read-only bot', 'compliance-readonly-agent', 'compliance-officer', ['compliance:reports:read'], 'revoked', 0, 40]
    ]
    for (const [clientId, name, persona, from, scopes, status, budget, ageD] of agents) {
      await pool.query(
        `INSERT INTO agent_registry
           (bank_id, channel, client_id, display_name, persona, derived_from, scopes, status,
            allow_mutations, spend_budget, registered_by, approved_by, created_at, revoked_at, revoke_reason)
         SELECT $1, $2, $3, $4, $5, $6, $7::text[], $8, false, $9, 'demo:platform-admin', 'demo:platform-super-admin',
                now() - ($10 || ' days')::interval,
                CASE WHEN $8 = 'revoked' THEN now() - interval '2 days' ELSE NULL END,
                CASE WHEN $8 = 'revoked' THEN 'Rotated out of the demo automation set (synthetic).' ELSE NULL END
          WHERE NOT EXISTS (SELECT 1 FROM agent_registry WHERE client_id = $3 AND bank_id = $1)`,
        [DEMO_BANK_ID, CH, clientId, name, persona, from, scopes, status, budget, String(ageD)]
      )
    }

    // ── BCBS 239 lineage for every table this scenario touches (Q4.5 stays green; idempotent).
    const lineage: [string, string[]][] = [
      ['reconciliation_log', ['bank_id', 'channel', 'run_id', 'status', 'line_count_total']],
      ['reconciliation_break', ['bank_id', 'channel', 'run_id', 'line_type', 'status', 'variance_amount']],
      ['risk_signal', ['bank_id', 'channel', 'signal_type', 'severity', 'status']],
      ['approval_request', ['bank_id', 'channel', 'approval_request_id', 'operation_type', 'state']],
      ['dispute_case', ['bank_id', 'channel', 'psu_identifier', 'dispute_type', 'state', 'compensation_blocked']],
      ['service_desk_case', ['bank_id', 'channel', 'nebras_case_reference', 'case_type', 'priority', 'status']],
      ['fraud_incident', ['bank_id', 'channel', 'nebras_severity', 'itsm_priority', 'status', 'scheme_imposed_hold']],
      ['str_draft', ['bank_id', 'channel', 'source_consent_id', 'status', 'created_by']],
      ['tpp_counterparty', ['bank_id', 'channel', 'organisation_id', 'legal_name', 'production_status', 'registration_state']],
      ['invoice_run', ['bank_id', 'channel', 'billing_period', 'status']],
      ['scheme_notification', ['bank_id', 'channel', 'notification_type', 'status', 'notice_compliant']],
      ['compliance_report', ['bank_id', 'channel', 'report_type', 'status', 'classification']],
      ['trust_framework_participant', ['bank_id', 'channel', 'role', 'organisation_id', 'status']],
      ['respondent_dispute', ['bank_id', 'channel', 'nebras_dispute_ref', 'category', 'state']],
      ['agent_registry', ['bank_id', 'channel', 'client_id', 'persona', 'status']],
      ['tenant_group_member', ['bank_id', 'tenant_group_id', 'group_slug', 'display_name', 'tier']],
      ['tenant_configuration', ['bank_id', 'year_anchor_date', 'retail_overage_milli_fils', 'invoice_template_ref', 'invoice_brand_key', 'asp_route_profile', 'collection_rail_policy']],
      ['billing_meter_run', ['bank_id', 'channel', 'period', 'rate_card_version', 'input_hash']],
      ['billing_expected_memo', ['bank_id', 'channel', 'meter_run_id', 'period', 'rate_card_version', 'total_milli_fils']],
      ['billing_expected_memo_line', ['bank_id', 'channel', 'expected_memo_id', 'line_ref', 'tpp_id', 'fee_class', 'amount_milli_fils']],
      ['billing_tpp_cost_statement', ['bank_id', 'channel', 'meter_run_id', 'period', 'rate_card_version', 'total_net_milli_fils']],
      ['billing_tpp_cost_document', ['bank_id', 'channel', 'document_type', 'issuer_id', 'document_reference', 'net_milli_fils']],
      ['billing_tpp_cost_reconciliation', ['bank_id', 'channel', 'statement_id', 'document_id', 'billing_period', 'net_variance_milli_fils']],
      ['billing_tpp_cost_diff_line', ['bank_id', 'channel', 'reconciliation_id', 'line_ref', 'break_type', 'variance_milli_fils']],
      ['billing_tpp_cost_period_close', ['bank_id', 'channel', 'billing_period', 'initiated_by', 'approved_by', 'approval_request_id']],
      ['billing_tpp_cost_ap_dispatch', ['bank_id', 'channel', 'reconciliation_id', 'approval_request_id', 'dispatch_state', 'payable_net_milli_fils']]
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
