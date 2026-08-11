// The scheme's monthly statement, and the diff against ours.
//
// Nebras emails a Tax Invoice (hub fees the institution owes as TPP-of-record) and a
// Collection Memo (amounts being collected from TPPs on the institution's behalf) by the
// 5th. There is no billing API, and only aggregated supporting data is shared — so the
// memo arrives as a set of totals to be believed or challenged. This module simulates that
// statement from the same events, with realistic variances injected, and diffs it against
// the rated expectation (BILL-03 step 2–3).
//
// Variance classes are drawn from what actually goes wrong in scheme billing: a cap not
// applied, an exemption granted where the new Merchant-ID condition denies it, a missing
// day of data lines, and a paired discount not honoured.

import { divRound } from './units.mjs';

export const VARIANCE_PLAYBOOK = [
  { code: 'V1', title: 'AED 50 cap not applied', direction: 'memo_high', fee_class: 'payment.merchant_collection',
    detail: 'Memo prices 3 high-value merchant collections at full bps with no cap applied.' },
  { code: 'V2', title: 'Missing corporate data lines', direction: 'memo_low', fee_class: 'data.corporate_page',
    detail: 'Memo omits one day of corporate data pages — under-collection, i.e. revenue leakage if accepted silently.' },
  { code: 'V3', title: 'Merchant exemption granted without Merchant ID', direction: 'memo_low', fee_class: 'payment.merchant_collection',
    detail: 'Memo applies the AED 200/day free allowance to requests with no Merchant ID, contrary to the 2 Jun 2026 condition.' },
  { code: 'V4', title: 'Paired discount not honoured', direction: 'memo_high', fee_class: 'hub.paired',
    detail: 'Memo bills paired balance/CoP calls at the standard 2.5 fils instead of the 0.5 fils paired rate.' },
];

export function buildMemo(rated, metered, card) {
  // Start from our own figures, then perturb — a memo that disagrees everywhere would be a
  // systems failure, not a billing variance. Real memos tie on most lines.
  const memo = { issued: '2026-07-05', channel: 'email (billing@nebrasopenfinance.ae)', ref: `NEB-CM-2026-06`, lines: [], applied: [] };

  const perTpp = new Map();
  for (const s of rated.statements) {
    for (const l of s.receivable) perTpp.set(`${s.tpp}|${l.fee_class}`, { tpp: s.tpp, fee_class: l.fee_class, side: 'receivable', units: l.units, amount_mf: l.amount_mf });
  }
  // The institution's own Nebras Tax Invoice: hub fees for its TPP-of-record traffic.
  for (const c of rated.tppaas) {
    for (const l of c.payable_hub) perTpp.set(`${c.client}|${l.fee_class}`, { tpp: c.client, fee_class: l.fee_class, side: 'payable_hub', units: l.units, amount_mf: l.amount_mf });
  }

  // V1 — cap not applied on the three largest capped merchant collections.
  const cappedLines = rated.priced
    .filter((p) => p.fee_class === 'payment.merchant_collection' && p.rate_detail?.capped)
    .sort((a, b) => b.rate_detail.uncapped - a.rate_detail.uncapped)
    .slice(0, 3);
  let v1 = 0;
  for (const c of cappedLines) v1 += c.rate_detail.uncapped - c.amount_mf;
  if (v1 > 0) {
    const k = `${cappedLines[0].tpp}|payment.merchant_collection`;
    perTpp.get(k).amount_mf += v1;
    memo.applied.push({ ...VARIANCE_PLAYBOOK[0], tpp: cappedLines[0].tpp, delta_mf: v1, evidence_events: cappedLines.map((c) => c.event_id) });
  }

  // V2 — one day of corporate data pages dropped from the memo.
  const dropDay = '2026-06-17';
  const dropped = rated.priced.filter((p) => p.fee_class === 'data.corporate_page' && p.ts.startsWith(dropDay));
  const v2 = dropped.reduce((n, p) => n + p.amount_mf, 0);
  if (v2 > 0) {
    const k = `${dropped[0].tpp}|data.corporate_page`;
    perTpp.get(k).amount_mf -= v2;
    perTpp.get(k).units -= dropped.reduce((n, p) => n + p.units, 0);
    memo.applied.push({ ...VARIANCE_PLAYBOOK[1], tpp: dropped[0].tpp, delta_mf: -v2, evidence_events: dropped.slice(0, 4).map((p) => p.event_id), day: dropDay });
  }

  // V3 — exemption wrongly granted on no-Merchant-ID requests.
  const noMid = rated.priced.filter((p) => p.flag === 'NO_MERCHANT_ID_NO_EXEMPTION');
  // What the memo would charge if it granted the allowance: assume the first AED 200 of
  // each such payment is exempted.
  const allowance = card.receivable['payment.merchant_collection'].free_allowance.value;
  let v3 = 0;
  const v3ev = [];
  for (const p of noMid) {
    const bps = p.rate_detail.bps;
    const exemptValue = Math.min(allowance, p.value_mf);
    const forgone = divRound(divRound(exemptValue, 1000) * bps, 10);
    v3 += forgone;
    if (v3ev.length < 4) v3ev.push(p.event_id);
  }
  if (v3 > 0) {
    const k = `${noMid[0].tpp}|payment.merchant_collection`;
    perTpp.get(k).amount_mf -= v3;
    memo.applied.push({ ...VARIANCE_PLAYBOOK[2], tpp: noMid[0].tpp, delta_mf: -v3, evidence_events: v3ev, affected_events: noMid.length });
  }

  // V4 — paired discount not honoured on the hub-fee side.
  const pairedLines = rated.priced.filter((p) => p.fee_class === 'hub.paired');
  const std = card.payable_hub['hub.standard'].flat, pr = card.payable_hub['hub.paired'].flat;
  const sample = pairedLines.filter((p) => p.client === rated.tppaas[0]?.client).slice(0, 140);
  const v4 = sample.length * (std - pr);
  if (v4 > 0) {
    const k = `${sample[0].client}|hub.paired`;
    if (perTpp.has(k)) perTpp.get(k).amount_mf += v4;
    memo.applied.push({ ...VARIANCE_PLAYBOOK[3], tpp: sample[0].client, delta_mf: v4, evidence_events: sample.slice(0, 4).map((p) => p.event_id), affected_events: sample.length });
  }

  memo.lines = [...perTpp.values()];
  return memo;
}

/**
 * Three-way diff. Source A = our metering (rated), source B = the scheme memo,
 * source C = the financial system (P9) posting. Breaks carry all three refs plus the FAPI
 * trace of a representative event, and a scheme clock: a billing query must be raised
 * within 30 days of occurrence.
 */
export function reconcile(rated, memo, opts = {}) {
  const threshold = opts.threshold_mf ?? 1000; // 1 fil — the PRD default break threshold
  const breaks = [];
  const rows = [];
  const memoIdx = new Map(memo.lines.map((l) => [`${l.tpp}|${l.fee_class}`, l]));

  const sources = [
    ...rated.statements.map((s) => ({ party: s.tpp, sides: { receivable: s.receivable } })),
    ...rated.tppaas.map((c) => ({ party: c.client, sides: { payable_hub: c.payable_hub } })),
  ];
  for (const s of sources.map((x) => ({ tpp: x.party, ...x.sides }))) {
    for (const side of ['receivable', 'payable_hub']) {
      for (const l of s[side] ?? []) {
        const k = `${s.tpp}|${l.fee_class}`;
        const m = memoIdx.get(k);
        const memo_mf = m ? m.amount_mf : 0;
        const variance = memo_mf - l.amount_mf;
        // P9 (ERP) posts from our own rated figures, so it agrees with source A by
        // construction — the third source proves the posting happened, not the price.
        const p9_mf = l.amount_mf;
        const row = {
          tpp: s.tpp, side, fee_class: l.fee_class, units: l.units,
          own_mf: l.amount_mf, memo_mf, p9_mf, variance_mf: variance,
          status: Math.abs(variance) > threshold ? 'BREAK' : 'MATCHED',
        };
        if (row.status === 'BREAK') {
          // A statement line can net MORE THAN ONE error, and opposing errors partly
          // cancel — which is exactly how a variance stays small enough to wave through.
          // Every contributing cause is carried, with its own signed contribution.
          const causes = memo.applied.filter((a) => a.tpp === s.tpp && a.fee_class === l.fee_class);
          const cause = causes[0];
          const brk = {
            id: `BRK-2026-06-${String(breaks.length + 1).padStart(3, '0')}`,
            ...row,
            direction: variance > 0 ? 'MEMO_HIGHER' : 'MEMO_LOWER',
            cause_code: causes.length ? causes.map((c) => c.code).join('+') : 'UNEXPLAINED',
            cause: causes.length ? causes.map((c) => c.title).join(' · ') : 'Unexplained variance — investigate',
            detail: causes.map((c) => c.detail).join(' '),
            contributions: causes.map((c) => ({ code: c.code, title: c.title, delta_mf: c.delta_mf, events: c.affected_events ?? c.evidence_events?.length })),
            gross_error_mf: causes.reduce((n, c) => n + Math.abs(c.delta_mf), 0),
            evidence_events: causes.flatMap((c) => c.evidence_events ?? []),
            affected_events: cause?.affected_events,
            // Direction decides the action: memo higher ⇒ we are being over-billed or
            // over-collected against; memo lower ⇒ silent under-collection (leakage).
            action: variance > 0 ? 'Raise Nebras billing query (30-day window)' : 'Raise Nebras billing query + withhold line from TPP invoice',
            query_deadline: '2026-07-31',
            sla_days_remaining: 26,
          };
          breaks.push(brk);
          row.break_id = brk.id;
        }
        rows.push(row);
      }
    }
  }

  const matched = rows.filter((r) => r.status === 'MATCHED').length;
  return {
    rows, breaks, threshold_mf: threshold,
    matched, unmatched: breaks.length,
    match_rate_pct: Number(((matched / rows.length) * 100).toFixed(1)),
    net_variance_mf: rows.reduce((n, r) => n + r.variance_mf, 0),
    abs_variance_mf: rows.reduce((n, r) => n + Math.abs(r.variance_mf), 0),
  };
}
