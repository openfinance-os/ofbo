// BILL-01 — Scheme rate-card-as-code.
//
// The CBUAE Commercial & Pricing Model expressed as versioned, effective-dated
// configuration rather than constants scattered through the rating path. Every entry
// cites the scheme source so a reviewer can trace a charged fil to a published rule.
//
// Why versioned: the Confluence page is still labelled "Version 1.0 (4 Oct 2024)" but was
// substantively edited four times between Nov 2025 and Jun 2026 (merchant-exemption
// condition, chargeable /tpp-reports, life clawback 5y, FX commissions). The upstream
// document mutates without a version bump, so the local card carries its own version and a
// watcher diffs the source — see `changeWatch` below.

import { aed, fils } from './units.mjs';

export const RATE_CARD = {
  version: '2026.06.02',
  label: 'CBUAE Commercial & Pricing Model — page state 2 Jun 2026',
  effective_from: '2026-06-02',
  source: 'https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/124846096/Commercial+and+Pricing+Model',
  currency: 'AED',

  // The multi-year schedules step from "Year 1 of Nebras's operations", which the scheme
  // has never defined publicly. Configurable per tenant; surfaced as an open risk.
  year_anchor: { date: '2025-10-01', status: 'ASSUMED', note: 'Scheme has not published the Year-1 anchor. Tenant-configurable; every stepped fee below depends on it.' },

  // ── F2: TPP → LFI. The institution's receivable. ────────────────────────────────
  receivable: {
    'payment.merchant_collection': {
      label: 'Merchant collections',
      basis: 'bps_of_value',
      schedule_bps: [38, 35, 32, 29, 25], // Y1…Y5
      cap: aed(50),
      free_allowance: {
        per: 'merchant_per_day',
        value: aed(200),
        // Added to the scheme page 2 Jun 2026: the exemption applies ONLY when the
        // request carries a Merchant ID. Missing Merchant ID ⇒ no free allowance.
        requires: 'merchant_id_present',
        since: '2026-06-02',
      },
      cite: 'C&P §Open Banking — Service Initiation (Retail & SME)',
    },
    'payment.p2p_sme': { label: 'P2P / SME-to-SME', basis: 'flat', flat: fils(25), cite: 'C&P §Service Initiation' },
    'payment.me_to_me': { label: 'Me-to-me', basis: 'flat_stepped', schedule: [fils(20), fils(18), fils(17)], cite: 'C&P §Service Initiation' },
    'payment.sme_bulk': { label: 'SME bulk / batch', basis: 'flat', flat: fils(25), batch_cap: fils(250), cite: 'C&P §Service Initiation — no limit on tx per batch' },
    'payment.large_value': { label: 'Large value / rent / invoice collection', basis: 'flat', flat: aed(4), threshold: aed(5000), cite: 'C&P §Service Initiation — embedded payment link > AED 5,000' },
    'payment.corporate': { label: 'Corporate payments (incl. bulk)', basis: 'flat', flat: fils(250), cite: 'C&P §Service Initiation (Corporate)' },
    'data.corporate_page': { label: 'Corporate data sharing', basis: 'per_page', flat: fils(40), cite: 'C&P §Data Sharing (Corporate) — page = 100 lines' },
    'data.retail_page': {
      label: 'Retail data sharing (overage)',
      basis: 'per_page_over_free_tier',
      free_tier: { attended: 15, unattended: 5, per: 'psu_per_day' },
      // Above the free tier each LFI sets and publishes its OWN rate in the directory
      // (ApiMetadata.OverLimitFees). Only two LFIs publish one at all; an unset value means
      // the institution gives overage away free. This tenant publishes 9.50/page.
      overage: fils(950),
      overage_source: 'directory ApiMetadata.OverLimitFees (tenant-published)',
      cite: 'C&P §Data Sharing (Retail & SME)',
    },
  },

  // ── F1: TPP → Nebras. Payable by the institution in its TPP-of-record role. ─────
  payable_hub: {
    'hub.standard': { label: 'API Hub call', basis: 'flat', flat: fils(2.5), cite: 'C&P §API Hub Fees' },
    'hub.paired': { label: 'API Hub call — balance/CoP paired with a payment', basis: 'flat', flat: fils(0.5), window_hours: 2, cite: 'C&P §API Hub Fees — one balance AND one CoP per payment' },
    'hub.quote': { label: 'API Hub quote creation (tiered)', basis: 'tiered_by_providers', tiers: [[4, fils(5)], [10, fils(7.5)], [25, fils(10)], [Infinity, fils(12.5)]], cite: 'C&P §Quotes API Fees' },
  },

  // Chargeability classification. Only endpoints that pull LFI data or instruct a payment
  // attract a fee; consent, auth, discovery and status are free. `GET /tpp-reports` became
  // chargeable on 13 May 2026 — polling the reporting API now costs money.
  chargeable_endpoints: {
    'POST /payments': 'payment', 'GET /accounts': 'data', 'GET /accounts/{id}/transactions': 'data',
    'GET /accounts/{id}/balances': 'data_pairable', 'POST /confirmation': 'cop_pairable',
    'GET /accounts/{id}/statements': 'data', 'GET /parties': 'data',
    'POST /motor-insurance-quotes': 'quote', 'GET /tpp-reports': 'reporting',
  },
  free_endpoints: ['POST /par', 'POST /token', 'GET /payments/{id}', 'PATCH /account-access-consents/{id}',
    'GET /account-access-consents/{id}', 'POST /discovery', 'GET /participants', 'GET /products', 'GET /atms'],
};

/** Which year step is in force at `date`, given the (assumed) anchor. 1-based. */
export function yearStep(card, date) {
  const anchor = new Date(card.year_anchor.date);
  const d = new Date(date);
  const years = (d - anchor) / (365.25 * 24 * 3600 * 1000);
  return Math.max(1, Math.floor(years) + 1);
}

export function steppedValue(schedule, step) {
  return schedule[Math.min(step, schedule.length) - 1];
}

/**
 * The upstream-change watcher (BILL-01, second half). In production this fetches the
 * scheme pages and diffs them; here it replays the observed edit history so the prototype
 * can demonstrate a real detection. Any diff raises a review task — never an auto-update:
 * a rate change must be a human-approved, effective-dated card version.
 */
export const changeWatch = {
  watched: [
    'Commercial and Pricing Model (Confluence)',
    'nebras-open-finance.com/pricing/endpoints/',
    'nebras-open-finance.com/pricing/lfi-rates/',
  ],
  observed: [
    { date: '2025-11-27', change: 'Page restructured; CBUAE TPP licence fees added; insurance + FX commission defaults published', absorbed: true },
    { date: '2026-01-10', change: 'Life-assurance clawback window extended 2y → 5y', absorbed: true },
    { date: '2026-05-13', change: 'Chargeable-endpoint tables enumerated; GET /tpp-reports became chargeable', absorbed: true },
    { date: '2026-06-02', change: 'Merchant AED 200/day exemption made conditional on Merchant ID being populated', absorbed: true },
  ],
  pending: [
    { date: '2026-08-03', change: 'Upstream page edit detected — quote-tier wording changed; no numeric delta parsed', absorbed: false, action: 'Review task raised to Finance + Compliance; card version unchanged pending human confirmation' },
  ],
};
