// Deterministic synthetic month — the demo dataset the whole run is computed from.
//
// Hard rules inherited from the OFBO demo profile: synthetic PSUs only (zero real PII),
// deterministic seed so a demo is repeatable, and shapes that mirror production without
// copying it. PSU ids are 999-prefixed and TPP names are invented.

import { aed } from './units.mjs';

/** mulberry32 — small, fast, seeded. No Math.random anywhere in the engine. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Consuming TPPs — inbound traffic against the institution's LFI APIs. These generate the
// institution's receivable (F2).
export const TPPS = [
  { id: 'TPP-0001', org_id: 'ORG-77120', name: 'Falcon Pay',          role: 'PISP',       resident: true,  trn: '100412778900003', p9_registered: true,  segment: 'merchant' },
  { id: 'TPP-0002', org_id: 'ORG-77304', name: 'Marid Financial',     role: 'AISP+PISP',  resident: true,  trn: '100558991200003', p9_registered: true,  segment: 'retail' },
  { id: 'TPP-0003', org_id: 'ORG-77415', name: 'Nomad Wallet',        role: 'PISP',       resident: false, trn: null,              p9_registered: true,  segment: 'p2p',      residence: 'Singapore' },
  { id: 'TPP-0004', org_id: 'ORG-77502', name: 'Sirocco Data',        role: 'AISP',       resident: true,  trn: '100774310500003', p9_registered: true,  segment: 'corporate' },
  { id: 'TPP-0005', org_id: 'ORG-77661', name: 'Qasr Collections',    role: 'PISP',       resident: true,  trn: '100889223100003', p9_registered: false, segment: 'invoice' },
];

// TPP-as-a-Service clients — downstream fintechs consuming OTHER LFIs' APIs under the
// institution's own TPP licence. Their traffic makes the institution the payer: API Hub
// fees to Nebras plus usage fees to the counterparty LFI, re-billed onward with margin.
// This is the other half of the dual-role premise, and the half that shows up on the
// institution's own Nebras Tax Invoice.
export const CLIENTS = [
  { id: 'FIN-0001', name: 'Dhow Lending',   markup_pct: 18 },
  { id: 'FIN-0002', name: 'Souq Analytics', markup_pct: 12 },
];
const COUNTERPARTY_LFIS = ['LFI-TIER1-A', 'LFI-TIER1-B', 'LFI-TIER2-C'];

const DAYS = 30;               // June 2026
export const PERIOD = '2026-06';
const PSU_COUNT = 420;

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const iso = (day, hour, min) =>
  `2026-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;

/**
 * Emits billable-event candidates: raw gateway/Ozone-Connect observations, not yet
 * classified or priced. Shape mirrors what BILL-02 would derive from the API gateway:
 * one row per API call with the FAPI interaction id that makes it traceable end-to-end.
 */
export function syntheticMonth(seed = 20260601) {
  const r = prng(seed);
  const events = [];
  let n = 0;
  const eid = (day) => `evt-${PERIOD}-${String(++n).padStart(6, '0')}`;
  const trace = () => `${Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0')}-fapi`;
  const psu = () => `PSU-999${String(Math.floor(r() * PSU_COUNT)).padStart(4, '0')}`;

  for (let day = 1; day <= DAYS; day++) {
    const weekend = [6, 7, 13, 14, 20, 21, 27, 28].includes(day);
    const load = weekend ? 0.45 : 1;

    // ── Merchant collections (Falcon Pay, Qasr Collections) ──────────────────────
    for (let i = 0; i < Math.round(38 * load); i++) {
      const tpp = r() < 0.75 ? 'TPP-0001' : 'TPP-0005';
      const merchant = `MER-${String(1 + Math.floor(r() * 14)).padStart(3, '0')}`;
      // ~6% of requests omit Merchant ID. Since 2 Jun 2026 those forfeit the AED 200/day
      // free allowance — the single most valuable classification in the whole meter.
      const has_mid = r() > 0.06;
      // A thin tail of high-value collections (vehicle deposits, electronics, B2B goods)
      // crosses AED 13,158, where 38 bps meets the AED 50 cap.
      const amount = r() < 0.04 ? aed(14000 + Math.floor(r() * 46000)) : aed(35 + Math.floor(r() * 900));
      const hour = 8 + Math.floor(r() * 12);
      events.push({
        id: eid(day), ts: iso(day, hour, Math.floor(r() * 60)), tpp, psu: psu(), trace_id: trace(),
        endpoint: 'POST /payments', outcome: r() > 0.03 ? 200 : 502,
        payment: { type: 'merchant_collection', amount_mf: amount, merchant_id: has_mid ? merchant : null },
      });
    }
    // A handful of large-value invoice collections (> AED 5,000 ⇒ AED 4 flat)
    for (let i = 0; i < Math.round(4 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, 10 + Math.floor(r() * 8), Math.floor(r() * 60)), tpp: 'TPP-0005',
        psu: psu(), trace_id: trace(), endpoint: 'POST /payments', outcome: r() > 0.02 ? 200 : 400,
        payment: { type: 'large_value', amount_mf: aed(5200 + Math.floor(r() * 60000)), merchant_id: `MER-${String(1 + Math.floor(r() * 6)).padStart(3, '0')}` },
      });
    }
    // P2P and me-to-me (Nomad Wallet, Marid)
    for (let i = 0; i < Math.round(26 * load); i++) {
      const meToMe = r() < 0.35;
      events.push({
        id: eid(day), ts: iso(day, 7 + Math.floor(r() * 15), Math.floor(r() * 60)),
        tpp: r() < 0.6 ? 'TPP-0003' : 'TPP-0002', psu: psu(), trace_id: trace(),
        endpoint: 'POST /payments', outcome: r() > 0.04 ? 200 : 422,
        payment: { type: meToMe ? 'me_to_me' : 'p2p_sme', amount_mf: aed(50 + Math.floor(r() * 2400)) },
      });
    }
    // SME bulk batches — the batch cap (250 fils) only bites on large batches
    if (day % 3 === 0) {
      const batches = 2 + Math.floor(r() * 2);
      for (let b = 0; b < batches; b++) {
        const batch = `BATCH-${PERIOD}-${day}-${b}`;
        const size = 4 + Math.floor(r() * 22); // 4–25 payments; >10 crosses the cap
        for (let k = 0; k < size; k++) {
          events.push({
            id: eid(day), ts: iso(day, 9, Math.floor(r() * 60)), tpp: 'TPP-0002', psu: psu(), trace_id: trace(),
            endpoint: 'POST /payments', outcome: 200,
            payment: { type: 'sme_bulk', amount_mf: aed(120 + Math.floor(r() * 3000)), batch_id: batch },
          });
        }
      }
    }
    // Corporate payments (Sirocco's corporate clients)
    for (let i = 0; i < Math.round(9 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, 9 + Math.floor(r() * 8), Math.floor(r() * 60)), tpp: 'TPP-0004',
        psu: psu(), trace_id: trace(), endpoint: 'POST /payments', outcome: r() > 0.02 ? 200 : 500,
        payment: { type: 'corporate', amount_mf: aed(4000 + Math.floor(r() * 180000)) },
      });
    }

    // ── Balance + CoP around payments (pairing candidates) ───────────────────────
    const todaysPayments = events.filter((e) => e.ts.startsWith(`2026-06-${String(day).padStart(2, '0')}`) && e.payment && e.outcome === 200);
    for (const p of todaysPayments) {
      if (r() < 0.82) { // CoP is mandatory before payment; a few arrive outside the 2h window
        const drift = r() < 0.9 ? -1 : -4; // hours before the payment
        const h = Math.max(0, Number(p.ts.slice(11, 13)) + drift);
        events.push({ id: eid(day), ts: iso(day, h, Math.floor(r() * 60)), tpp: p.tpp, psu: p.psu, trace_id: trace(), endpoint: 'POST /confirmation', outcome: 200 });
      }
      if (r() < 0.55) {
        const h = Math.max(0, Number(p.ts.slice(11, 13)) - 1);
        events.push({ id: eid(day), ts: iso(day, h, Math.floor(r() * 60)), tpp: p.tpp, psu: p.psu, trace_id: trace(), endpoint: 'GET /accounts/{id}/balances', outcome: 200 });
      }
    }

    // ── Data sharing ─────────────────────────────────────────────────────────────
    // Retail: attended (PSU present) and unattended (background refresh) — free tiers are
    // per PSU per DAY, so the same PSU polled repeatedly is what generates overage.
    for (let i = 0; i < Math.round(150 * load); i++) {
      const attended = r() < 0.6;
      const p = psu();
      // Attended calls are a person looking at their data: one pull, possibly deep.
      // Unattended is a background refresher: frequent, mostly small deltas, with the
      // occasional full backfill. The unattended free tier is only 5 pages/PSU/day, so
      // the refreshers are what generate overage.
      const repeats = attended ? 1 : 1 + Math.floor(r() * 3);
      for (let k = 0; k < repeats; k++) {
        const lines = attended
          ? 20 + Math.floor(r() * 480)
          : r() < 0.12 ? 200 + Math.floor(r() * 700) : 20 + Math.floor(r() * 130);
        events.push({
          id: eid(day), ts: iso(day, Math.floor(r() * 24), Math.floor(r() * 60)),
          tpp: r() < 0.7 ? 'TPP-0002' : 'TPP-0004', psu: p, trace_id: trace(),
          endpoint: 'GET /accounts/{id}/transactions', outcome: r() > 0.02 ? 200 : 503,
          data: { segment: 'retail', attended, lines },
        });
      }
    }
    // Corporate: every page is chargeable at 40 fils, no free tier
    for (let i = 0; i < Math.round(22 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, 6 + Math.floor(r() * 14), Math.floor(r() * 60)), tpp: 'TPP-0004',
        psu: psu(), trace_id: trace(), endpoint: 'GET /accounts/{id}/transactions', outcome: 200,
        data: { segment: 'corporate', attended: r() < 0.3, lines: 100 + Math.floor(r() * 1500) },
      });
    }

    // ── Free traffic: consent, auth, discovery, payment status ───────────────────
    for (let i = 0; i < Math.round(210 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, Math.floor(r() * 24), Math.floor(r() * 60)),
        tpp: pick(r, TPPS).id, psu: psu(), trace_id: trace(),
        endpoint: pick(r, ['POST /par', 'POST /token', 'GET /payments/{id}', 'GET /account-access-consents/{id}', 'POST /discovery']),
        outcome: 200,
      });
    }
    // A newly-enabled endpoint the classifier has never been taught. Realistic blind spot:
    // the scheme adds a chargeable endpoint (as it did with /tpp-reports on 13 May 2026)
    // and the meter silently ignores it until someone notices.
    for (let i = 0; i < Math.round(3 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, 11, Math.floor(r() * 60)), tpp: 'TPP-0004', psu: psu(),
        trace_id: trace(), endpoint: 'GET /accounts/{id}/direct-debits', outcome: 200,
      });
    }

    // ── Outbound: the institution as TPP-of-record for its TPP-aaS clients ───────
    // Calls to OTHER LFIs. The institution pays the API Hub fee (2.5 fils, or 0.5 when a
    // balance/CoP pairs with a payment within 2h) and the counterparty LFI's usage fee,
    // then re-bills its fintech client with margin.
    for (let i = 0; i < Math.round(34 * load); i++) {
      const client = r() < 0.6 ? 'FIN-0001' : 'FIN-0002';
      const lfi = pick(r, COUNTERPARTY_LFIS);
      const isPayment = r() < 0.3;
      const hour = 8 + Math.floor(r() * 11);
      const base = {
        direction: 'outbound', client, counterparty_lfi: lfi, tpp: 'SELF',
        psu: psu(), trace_id: trace(), outcome: r() > 0.03 ? 200 : 504,
      };
      if (isPayment) {
        const pay = { ...base, id: eid(day), ts: iso(day, hour, Math.floor(r() * 60)), endpoint: 'POST /payments',
          payment: { type: 'p2p_sme', amount_mf: aed(80 + Math.floor(r() * 1800)) } };
        events.push(pay);
        // The paired balance/CoP calls that earn the 0.5-fil discount on the hub invoice.
        if (r() < 0.8) events.push({ ...base, id: eid(day), ts: iso(day, Math.max(0, hour - 1), Math.floor(r() * 60)), endpoint: 'POST /confirmation', outcome: 200 });
        if (r() < 0.6) events.push({ ...base, id: eid(day), ts: iso(day, Math.max(0, hour - 1), Math.floor(r() * 60)), endpoint: 'GET /accounts/{id}/balances', outcome: 200 });
      } else {
        events.push({ ...base, id: eid(day), ts: iso(day, hour, Math.floor(r() * 60)), endpoint: 'GET /accounts/{id}/transactions',
          data: { segment: 'retail', attended: r() < 0.5, lines: 30 + Math.floor(r() * 300) } });
      }
    }
    // Insurance quote fan-out on behalf of a client — the tiered 5–12.5 fils hub fee.
    for (let i = 0; i < Math.round(5 * load); i++) {
      events.push({
        id: eid(day), ts: iso(day, 12 + Math.floor(r() * 6), Math.floor(r() * 60)),
        direction: 'outbound', client: 'FIN-0002', counterparty_lfi: 'MULTI', tpp: 'SELF',
        psu: psu(), trace_id: trace(), endpoint: 'POST /motor-insurance-quotes', outcome: 200,
        quote: { providers: 3 + Math.floor(r() * 24) },
      });
    }

    // Reporting API polling — free until 13 May 2026, chargeable since.
    for (let i = 0; i < 6; i++) {
      events.push({ id: eid(day), ts: iso(day, i * 4, 5), direction: 'outbound', client: 'FIN-0001', counterparty_lfi: 'LFI-TIER1-A', tpp: 'SELF', psu: null, trace_id: trace(), endpoint: 'GET /tpp-reports', outcome: 200 });
    }
  }

  for (const e of events) if (!e.direction) e.direction = 'inbound';
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { period: PERIOD, seed, events, tpps: TPPS, clients: CLIENTS };
}
