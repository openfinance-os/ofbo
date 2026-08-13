// BILL-02 — Independent billable-event metering.
//
// The institution's own count, derived from its own gateway/Ozone-Connect observations —
// never from the scheme's statement. This is the interconnect posture: rate your own
// records, then reconcile against the counterparty. Nebras shares only aggregated
// supporting data, so this is the only line-level evidence available in a dispute.
//
// Metering produces FACTS (what happened, how many units). Pricing happens in rating.mjs.
// Facts are immutable and replayable: re-rating a corrected rate card replays these events
// and never mutates them.
//
// Direction is load-bearing. The institution plays both roles:
//   inbound  — a consuming TPP calls its APIs      → RECEIVABLE (F2)
//   outbound — it calls other LFIs as TPP-of-record → PAYABLE: API Hub fee (F1) + the
//              counterparty LFI's usage fee, both re-billed to the TPP-aaS client
// Inbound balance and CoP calls are deliberately metered at zero: the consuming TPP pays
// the Hub for those, the institution charges nothing. Counting them anyway is what makes
// "we are not billing for this" a demonstrable statement rather than an assumption.

const day = (ts) => ts.slice(0, 10);
const hoursBetween = (a, b) => Math.abs(new Date(a) - new Date(b)) / 3600000;

export function meter(month, card) {
  const lines = [];
  const stats = {
    events_total: month.events.length, classified: 0, chargeable: 0, free: 0,
    free_to_lfi: 0, excluded_unsuccessful: 0, unknown_endpoint: 0,
    inbound: 0, outbound: 0,
  };
  const evidence = { pairing: [], free_tier: [], merchant_allowance: [], blind_spot: [] };

  // ── Pass 1: pairing windows (per direction) ────────────────────────────────────
  // A payment discounts ONE balance call AND ONE CoP call to 0.5 fils, within 2 hours.
  // Greedy nearest-match; a call already consumed cannot discount a second payment.
  const pairableEndpoints = ['GET /accounts/{id}/balances', 'POST /confirmation'];
  const buckets = new Map();
  for (const e of month.events) {
    if (pairableEndpoints.includes(e.endpoint) && e.outcome === 200) {
      const k = `${e.direction}|${e.endpoint}|${e.tpp}|${e.client ?? ''}|${e.psu}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(e);
    }
  }
  const paired = new Set();
  const windowH = card.payable_hub['hub.paired'].window_hours;
  for (const p of month.events.filter((e) => e.payment && e.outcome === 200)) {
    for (const ep of pairableEndpoints) {
      const k = `${p.direction}|${ep}|${p.tpp}|${p.client ?? ''}|${p.psu}`;
      const cands = (buckets.get(k) || [])
        .filter((c) => !paired.has(c.id) && hoursBetween(c.ts, p.ts) <= windowH)
        .sort((a, b) => hoursBetween(a.ts, p.ts) - hoursBetween(b.ts, p.ts));
      if (cands.length) {
        paired.add(cands[0].id);
        if (p.direction === 'outbound' && evidence.pairing.length < 6) {
          evidence.pairing.push({
            payment: p.id, paired_call: cands[0].id, endpoint: ep,
            gap_h: Number(hoursBetween(cands[0].ts, p.ts).toFixed(2)),
            effect: '2.5 fils → 0.5 fils on the institution\'s Hub invoice',
          });
        }
      }
    }
  }

  // ── Pass 2: classify, count units, apply free tiers and allowances ────────────
  const tierUsed = new Map();      // psu|day|mode → pages consumed
  const merchantUsed = new Map();  // merchant|day → value consumed (mf)

  for (const e of month.events) {
    e.direction === 'outbound' ? stats.outbound++ : stats.inbound++;
    const kind = card.chargeable_endpoints[e.endpoint];
    if (!kind) {
      if (card.free_endpoints.includes(e.endpoint)) { stats.free++; stats.classified++; }
      else {
        // Blind spot: an endpoint neither list knows. Never silently dropped — it is
        // counted, surfaced in the RA report, and priced as an upper bound.
        stats.unknown_endpoint++;
        if (evidence.blind_spot.length < 3) evidence.blind_spot.push({ event: e.id, endpoint: e.endpoint, ts: e.ts, tpp: e.tpp });
      }
      continue;
    }
    stats.classified++;
    // Scheme rule: fees apply to technically successful calls only. A 5xx is the LFI's
    // problem, not the TPP's bill.
    if (e.outcome < 200 || e.outcome >= 300) { stats.excluded_unsuccessful++; continue; }

    const base = {
      event_id: e.id, ts: e.ts, tpp: e.tpp, psu: e.psu, trace_id: e.trace_id,
      endpoint: e.endpoint, direction: e.direction, client: e.client, counterparty_lfi: e.counterparty_lfi,
    };

    // ── OUTBOUND: the institution pays ──────────────────────────────────────────
    if (e.direction === 'outbound') {
      const isPaired = paired.has(e.id);
      lines.push({
        ...base, side: 'payable_hub', units: 1, paired: isPaired,
        fee_class: kind === 'quote' ? 'hub.quote' : isPaired ? 'hub.paired' : 'hub.standard',
        providers: e.quote?.providers,
        note: kind === 'reporting' ? 'chargeable since 13 May 2026' : undefined,
      });
      stats.chargeable++;
      // The counterparty LFI's usage fee, priced off the same scheme card.
      if (kind === 'payment') {
        lines.push({ ...base, side: 'payable_lfi', fee_class: `payment.${e.payment.type}`, units: 1, value_mf: e.payment.amount_mf, chargeable_value_mf: e.payment.amount_mf, free_value_mf: 0 });
      } else if (kind === 'data') {
        const pages = Math.ceil(e.data.lines / 100);
        const mode = e.data.attended ? 'attended' : 'unattended';
        const k = `OUT|${e.psu}|${day(e.ts)}|${mode}`;
        const allow = card.receivable['data.retail_page'].free_tier[mode];
        const used = tierUsed.get(k) || 0;
        const freePages = Math.max(0, Math.min(allow - used, pages));
        tierUsed.set(k, used + pages);
        lines.push({ ...base, side: 'payable_lfi', fee_class: 'data.retail_page', units: pages - freePages, free_units: freePages, mode });
      }
      continue;
    }

    // ── INBOUND: the institution earns (or explicitly does not) ────────────────
    if (kind === 'payment') {
      const t = e.payment.type;
      const line = { ...base, side: 'receivable', fee_class: `payment.${t}`, units: 1, value_mf: e.payment.amount_mf };
      if (t === 'merchant_collection') {
        const rule = card.receivable['payment.merchant_collection'].free_allowance;
        // The 2 Jun 2026 condition: no Merchant ID ⇒ no free allowance, full value charged.
        if (e.payment.merchant_id) {
          const k = `${e.payment.merchant_id}|${day(e.ts)}`;
          const used = merchantUsed.get(k) || 0;
          const free = Math.max(0, Math.min(rule.value - used, e.payment.amount_mf));
          merchantUsed.set(k, used + e.payment.amount_mf);
          line.free_value_mf = free;
          line.chargeable_value_mf = e.payment.amount_mf - free;
          line.merchant_id = e.payment.merchant_id;
          if (free > 0 && evidence.merchant_allowance.length < 5) {
            evidence.merchant_allowance.push({ event: e.id, merchant: e.payment.merchant_id, day: day(e.ts), free_mf: free, charged_mf: line.chargeable_value_mf });
          }
        } else {
          line.free_value_mf = 0;
          line.chargeable_value_mf = e.payment.amount_mf;
          line.merchant_id = null;
          line.flag = 'NO_MERCHANT_ID_NO_EXEMPTION';
        }
      }
      if (t === 'large_value' && e.payment.amount_mf < card.receivable['payment.large_value'].threshold) {
        line.fee_class = 'payment.merchant_collection';
        line.chargeable_value_mf = e.payment.amount_mf;
        line.free_value_mf = 0;
        line.reclassified_from = 'payment.large_value';
      }
      if (t === 'sme_bulk') line.batch_id = e.payment.batch_id;
      lines.push(line);
      stats.chargeable++;
    } else if (kind === 'data') {
      const pages = Math.ceil(e.data.lines / 100); // page = 100 lines, partial rounds up
      if (e.data.segment === 'corporate') {
        lines.push({ ...base, side: 'receivable', fee_class: 'data.corporate_page', units: pages, lines: e.data.lines });
      } else {
        const mode = e.data.attended ? 'attended' : 'unattended';
        const allow = card.receivable['data.retail_page'].free_tier[mode];
        const k = `IN|${e.psu}|${day(e.ts)}|${mode}`;
        const used = tierUsed.get(k) || 0;
        const freePages = Math.max(0, Math.min(allow - used, pages));
        const billable = pages - freePages;
        tierUsed.set(k, used + pages);
        lines.push({ ...base, side: 'receivable', fee_class: 'data.retail_page', units: billable, free_units: freePages, mode, lines: e.data.lines });
        if (billable > 0 && evidence.free_tier.length < 5) {
          evidence.free_tier.push({ event: e.id, psu: e.psu, day: day(e.ts), mode, pages, free_pages: freePages, billable_pages: billable, tier: allow });
        }
      }
      stats.chargeable++;
    } else {
      // Inbound balance / CoP / reporting: the consuming TPP pays the Hub for these; the
      // institution charges nothing. Metered at zero so the console can show it.
      lines.push({ ...base, side: 'free_to_lfi', fee_class: 'no_lfi_charge', units: 1, paired: paired.has(e.id) });
      stats.free_to_lfi++;
    }
  }

  stats.coverage_pct = Number(((stats.classified / stats.events_total) * 100).toFixed(2));
  const batches = new Set(lines.filter((l) => l.batch_id).map((l) => l.batch_id)).size;
  return { lines, stats, evidence, batches };
}
