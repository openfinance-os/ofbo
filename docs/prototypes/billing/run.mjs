#!/usr/bin/env node
// Orchestrates one billing cycle end-to-end and writes out/run.json.
//
//   node run.mjs                 # run the June 2026 cycle
//   node run.mjs --seed 12345    # a different synthetic month
//
// The output of this file is the sole data source for the clickable console — every figure
// on every screen is computed here. Nothing in the UI is typed by hand.

import { mkdirSync, writeFileSync } from 'node:fs';
import { RATE_CARD, changeWatch, yearStep } from './engine/rate-card.mjs';
import { syntheticMonth } from './engine/synthetic.mjs';
import { meter } from './engine/meter.mjs';
import { rate } from './engine/rating.mjs';
import { buildMemo, reconcile, VARIANCE_PLAYBOOK } from './engine/memo.mjs';
import { invoiceRun, toPintAE, SUPPLIER } from './engine/invoice.mjs';
import { settle } from './engine/settlement.mjs';
import { assure } from './engine/assurance.mjs';
import { fmtAED, MF_PER_AED } from './engine/units.mjs';

const seedArg = process.argv.indexOf('--seed');
const seed = seedArg > -1 ? Number(process.argv[seedArg + 1]) : 20260601;

const month = syntheticMonth(seed);
const metered = meter(month, RATE_CARD);
const rated = rate(metered, RATE_CARD, month.period, month.clients);
const memo = buildMemo(rated, metered, RATE_CARD);
const recon = reconcile(rated, memo);
const ir = invoiceRun(rated, recon, month.tpps);
const run = { metered, rated, recon, invoiceRun: ir };
const settlement = settle({ ...run, recon, rated });
run.settlement = settlement;
const ra = assure(run, RATE_CARD);

const pint = ir.invoices.filter((i) => i.status === 'ISSUED').map((i) => ({ id: i.id, tpp: i.tpp_name, xml: toPintAE(i, SUPPLIER) }));

const out = {
  generated_for: month.period,
  seed,
  supplier: SUPPLIER,
  rate_card: RATE_CARD,
  change_watch: changeWatch,
  year_step: yearStep(RATE_CARD, `${month.period}-15`),
  tpps: month.tpps,
  clients: month.clients,
  metering: {
    stats: metered.stats, evidence: metered.evidence, batches: metered.batches,
    sample: metered.lines.slice(0, 14).map((l) => ({ ...l })),
    by_class: Object.entries(
      metered.lines.reduce((acc, l) => {
        acc[l.fee_class] = acc[l.fee_class] || { fee_class: l.fee_class, side: l.side, events: 0, units: 0 };
        acc[l.fee_class].events++; acc[l.fee_class].units += l.units ?? 1;
        return acc;
      }, {}),
    ).map(([, v]) => v).sort((a, b) => b.events - a.events),
  },
  rating: {
    card_version: rated.card_version, year_step: rated.year_step,
    statements: rated.statements, tppaas: rated.tppaas, cap_adjustments: rated.capAdjustments,
    receivable_total_mf: rated.receivable_total_mf, payable_hub_total_mf: rated.payable_hub_total_mf,
    payable_lfi_total_mf: rated.payable_lfi_total_mf, tppaas_rebill_mf: rated.tppaas_rebill_mf,
    tppaas_margin_mf: rated.tppaas_margin_mf, free_to_lfi_events: rated.free_to_lfi_events,
    capped_count: rated.priced.filter((p) => p.rate_detail?.capped).length,
    no_mid_count: rated.priced.filter((p) => p.flag === 'NO_MERCHANT_ID_NO_EXEMPTION').length,
  },
  memo: { ...memo, playbook: VARIANCE_PLAYBOOK },
  reconciliation: recon,
  invoicing: { ...ir, pint },
  settlement,
  assurance: ra,
};

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/run.json', import.meta.url), JSON.stringify(out, null, 2));
for (const p of pint) writeFileSync(new URL(`./out/${p.id}.pint-ae.xml`, import.meta.url), p.xml);

const A = (mf) => `AED ${fmtAED(mf)}`;
console.log(`
OFBO Billing Module — cycle ${month.period}  (seed ${seed}, rate card ${RATE_CARD.version}, year step ${out.year_step})
${'─'.repeat(78)}
Metering    ${metered.stats.events_total.toLocaleString()} events · ${metered.stats.chargeable.toLocaleString()} chargeable · coverage ${metered.stats.coverage_pct}% · ${metered.stats.excluded_unsuccessful} unsuccessful excluded
Rating      receivable ${A(rated.receivable_total_mf)} · TPP-aaS cost ${A(rated.payable_hub_total_mf + rated.payable_lfi_total_mf)} → margin ${A(rated.tppaas_margin_mf)} · ${out.rating.capped_count} capped · ${out.rating.no_mid_count} without Merchant ID
Memo diff   ${recon.matched} matched / ${recon.unmatched} breaks · match rate ${recon.match_rate_pct}% · net variance ${A(recon.net_variance_mf)}
Invoicing   ${ir.invoices.filter((i) => i.status === 'ISSUED').length} issued ${A(ir.total_gross_mf)} (VAT ${A(ir.total_vat_mf)}) · withheld ${A(ir.total_withheld_mf)} · ${ir.invoices.length - ir.invoices.filter((i) => i.status === 'ISSUED').length} blocked
Settlement  expected net ${A(settlement.expected_net_mf)} · received ${A(settlement.received_mf)} · decomposition ties: ${settlement.reconciles ? 'YES' : 'NO'}
Assurance   leakage ${ra.kpi_pct}% (target <${ra.target_pct}%) · recoverable ${A(ra.recoverable_mf)}
${'─'.repeat(78)}
out/run.json + ${pint.length} PINT AE invoices written.
`);
