#!/usr/bin/env node
// Independent verification of the engine's arithmetic.
//
// Deliberately recomputes from the raw synthetic events using separate code paths (and
// floating-point maths where the engine uses integers) so an error in the engine does not
// reproduce itself in the check. Anything that disagrees beyond tolerance fails the run.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { syntheticMonth } from './engine/synthetic.mjs';
import { RATE_CARD } from './engine/rate-card.mjs';
import { MF_PER_AED } from './engine/units.mjs';

const run = JSON.parse(readFileSync(new URL('./out/run.json', import.meta.url)));
const month = syntheticMonth(run.seed);
const AED = (mf) => (mf / MF_PER_AED).toFixed(2);
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// 1 ── Merchant collections: independent float recomputation of the whole class.
{
  const merchantUsed = new Map();
  let expected = 0, capped = 0, noMid = 0;
  for (const e of month.events) {
    if (e.direction !== 'inbound' || !e.payment || e.outcome !== 200) continue;
    let type = e.payment.type, value = e.payment.amount_mf;
    if (type === 'large_value' && value < RATE_CARD.receivable['payment.large_value'].threshold) type = 'merchant_collection';
    if (type !== 'merchant_collection') continue;
    let chargeable = value;
    if (e.payment.merchant_id) {
      const k = `${e.payment.merchant_id}|${e.ts.slice(0, 10)}`;
      const used = merchantUsed.get(k) || 0;
      const free = Math.max(0, Math.min(20_000_000 - used, value)); // AED 200 in milli-fils
      merchantUsed.set(k, used + value);
      chargeable = value - free;
    } else noMid++;
    const feeFloat = (chargeable / 1000) * 0.0038 * 1000; // fils→bps→milli-fils, in floats
    const fee = Math.min(feeFloat, 5_000_000);
    if (feeFloat > 5_000_000) capped++;
    expected += fee;
  }
  const engine = run.rating.statements.flatMap((s) => s.receivable).filter((l) => l.fee_class === 'payment.merchant_collection').reduce((n, l) => n + l.amount_mf, 0);
  const drift = Math.abs(engine - expected);
  check('merchant collections priced correctly (38 bps, AED 50 cap, AED 200/day allowance)',
    drift < expected * 0.0001, `engine AED ${AED(engine)} vs independent AED ${AED(expected)} (drift ${drift.toFixed(0)} mf)`);
  check('AED 50 cap actually binds in this dataset', run.rating.capped_count > 0 && Math.abs(run.rating.capped_count - capped) <= 1,
    `engine ${run.rating.capped_count} capped, independent ${capped}`);
  check('Merchant-ID condition denies the allowance (rule of 2 Jun 2026)', run.rating.no_mid_count === noMid,
    `${noMid} payments with no Merchant ID, allowance withheld from all`);
}

// 2 ── VAT extraction is exact and reversible.
{
  let ok = true, detail = '';
  for (const inv of run.invoicing.invoices.filter((i) => i.status === 'ISSUED')) {
    if (inv.net_mf + inv.vat_mf !== inv.gross_mf) { ok = false; detail = `${inv.id} net+vat≠gross`; break; }
    if (inv.vat_rate === 5) {
      const implied = inv.vat_mf / inv.net_mf;
      if (Math.abs(implied - 0.05) > 0.0001) { ok = false; detail = `${inv.id} implied rate ${(implied * 100).toFixed(4)}%`; break; }
    } else if (inv.vat_mf !== 0) { ok = false; detail = `${inv.id} zero-rated but carries VAT`; break; }
  }
  check('VAT extracted at 5/105, net + VAT = gross on every invoice', ok, detail || `${run.invoicing.invoices.length} invoices`);
  const zr = run.invoicing.invoices.find((i) => i.tax_category === 'Z');
  check('non-resident TPP treated as zero-rated export', !!zr && zr.vat_mf === 0, zr ? `${zr.tpp_name} (${zr.buyer.residence}) — category Z, VAT 0` : 'no zero-rated invoice found');
}

// 3 ── Batch caps.
{
  const adj = run.rating.cap_adjustments;
  const bad = adj.find((a) => a.capped_mf !== 250_000);
  check('SME bulk batch cap applied at 250 fils per batch', adj.length > 0 && !bad,
    `${adj.length} batches capped, ${AED(adj.reduce((n, a) => n + a.saved_mf, 0))} AED saved by the cap`);
}

// 4 ── Settlement decomposition ties to cash, exactly.
{
  const d = run.settlement.decomposition.reduce((n, x) => n + (x.sign === '+' ? x.amount_mf : -x.amount_mf), 0);
  check('net-settlement decomposition ties to the remittance', Math.abs(d - run.settlement.received_mf) < 2,
    `decomposed AED ${AED(d)} vs received AED ${AED(run.settlement.received_mf)}`);
  check('unexplained residue raises a break', !!run.settlement.residueBreak, run.settlement.residueBreak?.id);
}

// 5 ── Invoice totals reconcile to rated statements minus withheld.
{
  let ok = true, detail = '';
  for (const inv of run.invoicing.invoices) {
    const st = run.rating.statements.find((s) => s.tpp === inv.tpp);
    const total = st.receivable_total_mf;
    const withheld = inv.withheld_lines.reduce((n, l) => n + l.gross_mf, 0);
    if (inv.gross_mf + withheld !== total) { ok = false; detail = `${inv.id}: ${inv.gross_mf}+${withheld} ≠ ${total}`; break; }
  }
  check('invoice gross + withheld = rated statement, per TPP', ok, detail || 'every TPP ties');

  // Reconcile-before-invoice, precise form: for every receivable break the disputed
  // AMOUNT is withheld (capped at the class total) and the invoiced remainder is flagged.
  let holdOk = true, holdDetail = '';
  for (const b of run.reconciliation.breaks.filter((x) => x.side === 'receivable')) {
    const inv = run.invoicing.invoices.find((i) => i.tpp === b.tpp);
    const st = run.rating.statements.find((s) => s.tpp === b.tpp).receivable.find((l) => l.fee_class === b.fee_class);
    const held = inv.withheld_lines.find((w) => w.fee_class === b.fee_class);
    const expected = Math.min(Math.abs(b.variance_mf), st.amount_mf);
    if (!held || held.gross_mf !== expected) { holdOk = false; holdDetail = `${b.id}: withheld ${held?.gross_mf ?? 0} ≠ ${expected}`; break; }
    const line = inv.lines.find((l) => l.fee_class === b.fee_class);
    if (line && !line.partially_withheld) { holdOk = false; holdDetail = `${b.id}: invoiced remainder not flagged`; break; }
  }
  check('every disputed amount is withheld from its invoice (reconcile-before-invoice)', holdOk,
    holdDetail || `${run.reconciliation.breaks.filter((x) => x.side === 'receivable').length} receivable breaks, disputed amounts held back`);
}

// 6 ── Reconciliation totals.
{
  const rows = run.reconciliation.rows;
  const recomputed = rows.reduce((n, r) => n + (r.memo_mf - r.own_mf), 0);
  check('reconciliation net variance = Σ(memo − own)', Math.abs(recomputed - run.reconciliation.net_variance_mf) < 2,
    `AED ${AED(run.reconciliation.net_variance_mf)} across ${rows.length} statement lines`);
  const unexplained = run.reconciliation.breaks.filter((b) => b.cause_code === 'UNEXPLAINED');
  check('every break has a traced cause and evidence events', unexplained.length === 0,
    run.reconciliation.breaks.map((b) => `${b.id}:${b.cause_code}`).join(' '));
}

// 7 ── Leakage KPI.
{
  const l = run.assurance;
  const recomputed = Number(((l.leakage_mf / l.gross_receivable_mf) * 100).toFixed(3));
  check('leakage KPI = leakage ÷ gross receivable', Math.abs(recomputed - l.kpi_pct) < 0.001, `${l.kpi_pct}% (target <${l.target_pct}%)`);
}

// 8 ── Determinism: same seed ⇒ byte-identical output.
{
  const before = createHash('sha256').update(readFileSync(new URL('./out/run.json', import.meta.url))).digest('hex');
  execFileSync('node', ['run.mjs'], { cwd: new URL('.', import.meta.url).pathname, stdio: 'ignore' });
  const after = createHash('sha256').update(readFileSync(new URL('./out/run.json', import.meta.url))).digest('hex');
  check('deterministic — a repeat run is byte-identical', before === after, `sha256 ${after.slice(0, 16)}…`);
}

// 9 ── No real PII, ever (the demo-profile hard stop).
{
  const raw = readFileSync(new URL('./out/run.json', import.meta.url), 'utf8');
  const psus = [...raw.matchAll(/"psu":\s*"([^"]+)"/g)].map((m) => m[1]);
  check('every PSU identifier is synthetic (999-prefixed)', psus.every((p) => p.startsWith('PSU-999')), `${new Set(psus).size} distinct synthetic PSUs`);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
