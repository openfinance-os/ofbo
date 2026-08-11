// BILL-03 — Rating: metered facts × rate card → money.
//
// Produces the "expected Collection Memo": what the institution believes each consuming
// TPP owes, ready by the 3rd, before the scheme's own statement arrives on the 5th. That
// inverts the operating posture from "verify what arrived" to "compare against expected".
//
// Re-rating is a replay: same events, different card version, new amounts. Facts never
// change — which is what makes a corrected period auditable.

import { bpsOfFils, divRound, MF_PER_FIL } from './units.mjs';
import { yearStep, steppedValue } from './rate-card.mjs';

export function rate(metered, card, period, clients) {
  const step = yearStep(card, `${period}-15`);
  const priced = [];
  const batchTotals = new Map();

  for (const l of metered.lines) {
    if (l.side === 'free_to_lfi') { priced.push({ ...l, amount_mf: 0, rate_detail: { reason: 'Hub-side fee, borne by the consuming TPP — the institution charges nothing' } }); continue; }
    const spec = (card.receivable[l.fee_class] || card.payable_hub[l.fee_class]);
    if (!spec) continue;
    let amount = 0;
    let detail = null;

    switch (spec.basis) {
      case 'bps_of_value': {
        const bps = steppedValue(spec.schedule_bps, step);
        // Only the value above the merchant's daily free allowance is chargeable, and the
        // allowance itself only exists when Merchant ID was populated (rule of 2 Jun 2026).
        const chargeable = l.chargeable_value_mf ?? l.value_mf;
        const uncapped = bpsOfFils(divRound(chargeable, MF_PER_FIL), bps); // → milli-fils
        amount = Math.min(uncapped, spec.cap);
        detail = { bps, capped: uncapped > spec.cap, uncapped, free_value_mf: l.free_value_mf || 0 };
        break;
      }
      case 'flat': amount = spec.flat * (l.units ?? 1); break;
      case 'flat_stepped': amount = steppedValue(spec.schedule, step) * (l.units ?? 1); detail = { step }; break;
      case 'per_page': amount = spec.flat * l.units; break;
      case 'per_page_over_free_tier': amount = spec.overage * l.units; break; // units = billable pages only
      case 'tiered_by_providers': {
        // Quote fee scales with how many LFIs returned a quote: ≤4, ≤10, ≤25, >25.
        const p = l.providers ?? 1;
        const tier = spec.tiers.find(([max]) => p <= max);
        amount = tier[1];
        detail = { providers: p, tier: tier[0] === Infinity ? '>25' : `≤${tier[0]}` };
        break;
      }
      default: amount = 0;
    }

    const p = { ...l, amount_mf: amount, rate_detail: detail };
    if (l.batch_id) {
      // SME bulk: 25 fils per tx capped at 250 fils per batch. Applied as a batch-level
      // adjustment so every line keeps its own gross rate for evidence.
      const t = batchTotals.get(l.batch_id) || { gross: 0, lines: [] };
      t.gross += amount; t.lines.push(p);
      batchTotals.set(l.batch_id, t);
    }
    priced.push(p);
  }

  // Apply batch caps: proportionally reduce lines in a batch that breached the cap.
  const capAdjustments = [];
  const bulkSpec = card.receivable['payment.sme_bulk'];
  for (const [batch, t] of batchTotals) {
    if (t.gross > bulkSpec.batch_cap) {
      const capped = bulkSpec.batch_cap;
      let allocated = 0;
      t.lines.forEach((line, i) => {
        const share = i === t.lines.length - 1 ? capped - allocated : divRound(line.amount_mf * capped, t.gross);
        allocated += share;
        line.batch_capped_from = line.amount_mf;
        line.amount_mf = share;
      });
      capAdjustments.push({ batch, tx: t.lines.length, gross_mf: t.gross, capped_mf: capped, saved_mf: t.gross - capped });
    }
  }

  const roll = (map, p) => {
    const cur = map.get(p.fee_class) || { fee_class: p.fee_class, units: 0, events: 0, amount_mf: 0, value_mf: 0 };
    cur.units += p.units ?? 1;
    cur.events += 1;
    cur.amount_mf += p.amount_mf;
    cur.value_mf += p.value_mf || 0;
    map.set(p.fee_class, cur);
  };

  // ── LFI role: statement per consuming TPP × fee class (the receivable) ────────
  const byTpp = new Map();
  // ── TPP-of-record role: cost per TPP-aaS client, re-billed with margin ────────
  const byClient = new Map();
  let freeToLfi = 0;

  for (const p of priced) {
    if (p.side === 'receivable') {
      if (!byTpp.has(p.tpp)) byTpp.set(p.tpp, { tpp: p.tpp, receivable: new Map() });
      roll(byTpp.get(p.tpp).receivable, p);
    } else if (p.side === 'payable_hub' || p.side === 'payable_lfi') {
      const c = p.client ?? 'UNATTRIBUTED';
      if (!byClient.has(c)) byClient.set(c, { client: c, payable_hub: new Map(), payable_lfi: new Map() });
      roll(byClient.get(c)[p.side], p);
    } else if (p.side === 'free_to_lfi') freeToLfi++;
  }

  const statements = [...byTpp.values()].map((s) => {
    const receivable = [...s.receivable.values()].sort((a, b) => b.amount_mf - a.amount_mf);
    return { tpp: s.tpp, receivable, receivable_total_mf: receivable.reduce((n, l) => n + l.amount_mf, 0) };
  }).sort((a, b) => b.receivable_total_mf - a.receivable_total_mf);

  // BACKOFFICE-07: pass-through billing with margin. Scheme cost is a pass-through; the
  // institution's own margin sits on top and is the number the Commercial Desk manages.
  const tppaas = [...byClient.values()].map((c) => {
    const hub = [...c.payable_hub.values()].sort((a, b) => b.amount_mf - a.amount_mf);
    const lfi = [...c.payable_lfi.values()].sort((a, b) => b.amount_mf - a.amount_mf);
    const hub_mf = hub.reduce((n, l) => n + l.amount_mf, 0);
    const lfi_mf = lfi.reduce((n, l) => n + l.amount_mf, 0);
    const meta = (clients ?? []).find((x) => x.id === c.client);
    const markup = meta?.markup_pct ?? 15;
    const cost = hub_mf + lfi_mf;
    const rebill = Math.round(cost * (100 + markup) / 100);
    return {
      client: c.client, name: meta?.name ?? c.client, payable_hub: hub, payable_lfi: lfi,
      hub_mf, lfi_mf, cost_mf: cost, markup_pct: markup, rebill_mf: rebill, margin_mf: rebill - cost,
    };
  }).sort((a, b) => b.cost_mf - a.cost_mf);

  return {
    period, card_version: card.version, year_step: step, priced, statements, tppaas, capAdjustments,
    free_to_lfi_events: freeToLfi,
    receivable_total_mf: statements.reduce((n, s) => n + s.receivable_total_mf, 0),
    payable_hub_total_mf: tppaas.reduce((n, c) => n + c.hub_mf, 0),
    payable_lfi_total_mf: tppaas.reduce((n, c) => n + c.lfi_mf, 0),
    tppaas_rebill_mf: tppaas.reduce((n, c) => n + c.rebill_mf, 0),
    tppaas_margin_mf: tppaas.reduce((n, c) => n + c.margin_mf, 0),
  };
}
