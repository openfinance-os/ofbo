// BILL-04 — Invoice run and PINT AE e-invoicing.
//
// Order is binding (BACKOFFICE-73): reconcile BEFORE invoice. Only reconciled-clean or
// resolved lines reach a TPP's invoice; lines under a break are withheld and carried, so
// the institution never invoices a figure it is simultaneously disputing.
//
// VAT: scheme fees are published VAT-INCLUSIVE, so tax is extracted at 5/105 rather than
// added. Non-resident TPPs are a zero-rated export of services — still e-invoiced, still
// reported to the FTA, just with no tax.
//
// The e-invoice is a Peppol PINT AE UBL 2.1 document exchanged through an Accredited
// Service Provider under the UAE 5-corner (DCTCE) model: supplier → its ASP → buyer's ASP
// → buyer, with a Tax Data Document reported to the FTA in parallel. Phase 1 (revenue
// ≥ AED 50m) requires an ASP appointed by 30 Oct 2026 and live issuance from 1 Jan 2027;
// until then the same documents can run in the penalty-free voluntary window.

import { divRound, MF_PER_AED, fmtAED } from './units.mjs';

const VAT_RATE = 5;

/** Extract VAT from a VAT-inclusive gross: net = gross × 100/105, vat = gross − net. */
export function extractVat(gross_mf) {
  const net = divRound(gross_mf * 100, 100 + VAT_RATE);
  return { net_mf: net, vat_mf: gross_mf - net, rate: VAT_RATE };
}

export function invoiceRun(rated, recon, tpps, opts = {}) {
  const period = rated.period;
  const issue_date = opts.issue_date ?? '2026-07-13';
  const due_date = opts.due_date ?? '2026-07-28';
  const withheldByTpp = new Map();
  for (const b of recon.breaks) {
    if (b.side !== 'receivable') continue;
    if (!withheldByTpp.has(b.tpp)) withheldByTpp.set(b.tpp, []);
    withheldByTpp.get(b.tpp).push(b);
  }

  const invoices = [];
  let seq = 0;
  for (const s of rated.statements) {
    const meta = tpps.find((t) => t.id === s.tpp);
    if (!s.receivable.length) continue;
    const withheld = withheldByTpp.get(s.tpp) ?? [];
    const byClass = new Map(withheld.map((w) => [w.fee_class, w]));

    // Withhold the DISPUTED AMOUNT, not the whole fee class. Suppressing an entire class
    // because one variance touched it would hold back thousands of undisputed dirhams (and
    // in this dataset would produce a zero-value invoice). The undisputed remainder is
    // invoiced now; the delta carries to the next cycle or is credit-noted on resolution.
    const lines = [];
    const withheld_lines = [];
    for (const l of s.receivable) {
      const b = byClass.get(l.fee_class);
      const hold = b ? Math.min(Math.abs(b.variance_mf), l.amount_mf) : 0;
      const billable = l.amount_mf - hold;
      if (billable > 0) lines.push({ no: lines.length + 1, fee_class: l.fee_class, units: l.units, gross_mf: billable, partially_withheld: hold > 0 });
      if (hold > 0) {
        withheld_lines.push({
          fee_class: l.fee_class, units: l.units, gross_mf: hold, of_class_total_mf: l.amount_mf,
          break_id: b.id, cause: b.cause,
          carry: b.direction === 'MEMO_LOWER'
            ? 'Scheme statement is lower than our records — amount at risk until the query resolves'
            : 'Scheme statement is higher than our records — invoiced at our rated figure, excess queried',
        });
      }
    }

    const gross_mf = lines.reduce((n, l) => n + l.gross_mf, 0);
    // Zero-rated export: no UAE VAT on a supply to a non-resident TPP (Art 31 conditions).
    const zeroRated = !meta.resident;
    const { net_mf, vat_mf } = zeroRated ? { net_mf: gross_mf, vat_mf: 0 } : extractVat(gross_mf);

    invoices.push({
      id: `INV-2026-06-${String(++seq).padStart(4, '0')}`,
      tpp: s.tpp, tpp_name: meta.name, period, issue_date, due_date,
      buyer: { trn: meta.trn, endpoint_scheme: '0235', endpoint_id: meta.trn ? meta.trn.slice(0, 10) : null, resident: meta.resident, residence: meta.residence },
      lines, withheld_lines,
      gross_mf, net_mf, vat_mf, vat_rate: zeroRated ? 0 : VAT_RATE,
      tax_category: zeroRated ? 'Z' : 'S',
      transaction_type: zeroRated ? ['EXPORTS'] : [],
      doc_type: '380',
      pint_ae: { customization: 'urn:peppol:pint:billing-1@ae-1', profile: 'urn:peppol:bis:billing', version: 'PINT AE v1.0.3' },
      // Where the invoice is presented for payment. The institution can collect its own
      // Open Finance receivables over Open Finance: invoices above AED 5,000 ride the
      // Large Value / Invoice Collection category at a capped AED 4.
      collection: gross_mf > 5000 * MF_PER_AED
        ? { rail: 'OF Invoice Collection (pay-by-bank)', fee: 'AED 4 capped', note: 'Embedded payment link on the e-invoice' }
        : gross_mf > 0 && !meta.resident
          ? { rail: 'Cross-border transfer', fee: '—', note: 'Non-resident TPP; scheme settlement preferred' }
          : { rail: 'Aani Request to Pay', fee: '—', note: 'Below the AED 50,000 rail limit' },
      p9_registered: meta.p9_registered,
      status: meta.p9_registered ? 'ISSUED' : 'BLOCKED_NO_P9_COUNTERPARTY',
    });
  }

  return {
    period, issue_date, due_date,
    invoices,
    four_eyes: { required: true, initiator: 'finance.analyst', approver: 'finance.controller', approved_at: '2026-07-13T09:14:00Z', note: 'Invoice runs are four-eyes gated; a run over unreconciled lines returns 409.' },
    total_gross_mf: invoices.filter((i) => i.status === 'ISSUED').reduce((n, i) => n + i.gross_mf, 0),
    total_vat_mf: invoices.filter((i) => i.status === 'ISSUED').reduce((n, i) => n + i.vat_mf, 0),
    total_withheld_mf: invoices.reduce((n, i) => n + i.withheld_lines.reduce((m, l) => m + l.gross_mf, 0), 0),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const amt = (mf) => (mf / MF_PER_AED).toFixed(2);

const CLASS_LABEL = {
  'payment.merchant_collection': 'Open Finance merchant collections — payment initiation fees',
  'payment.p2p_sme': 'Open Finance P2P / SME payment initiation fees',
  'payment.me_to_me': 'Open Finance me-to-me payment initiation fees',
  'payment.sme_bulk': 'Open Finance SME bulk payment initiation fees',
  'payment.large_value': 'Open Finance large value / invoice collection fees',
  'payment.corporate': 'Open Finance corporate payment initiation fees',
  'data.corporate_page': 'Open Finance corporate data sharing (per page of 100 lines)',
  'data.retail_page': 'Open Finance retail data sharing above free tier (per page)',
};

/** Render a PINT AE Billing invoice (UBL 2.1). Structure per PINT AE v1.0.3. */
export function toPintAE(inv, supplier) {
  const taxable = inv.net_mf, tax = inv.vat_mf;
  const lines = inv.lines.map((l) => {
    const { net_mf } = inv.vat_rate === 0 ? { net_mf: l.gross_mf } : extractVat(l.gross_mf);
    return `  <cac:InvoiceLine>
    <cbc:ID>${l.no}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${l.units}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="AED">${amt(net_mf)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(CLASS_LABEL[l.fee_class] ?? l.fee_class)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${inv.tax_category}</cbc:ID>
        <cbc:Percent>${inv.vat_rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="AED">${(net_mf / MF_PER_AED / Math.max(1, l.units)).toFixed(5)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- PINT AE Billing — exchanged supplier → ASP → buyer's ASP → buyer (5-corner DCTCE);
     the Tax Data Document is reported to the FTA platform by each ASP in parallel. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${inv.pint_ae.customization}</cbc:CustomizationID>
  <cbc:ProfileID>${inv.pint_ae.profile}</cbc:ProfileID>
  <cbc:ID>${inv.id}</cbc:ID>
  <cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>
  <cbc:DueDate>${inv.due_date}</cbc:DueDate>
  <cbc:InvoiceTypeCode>${inv.doc_type}</cbc:InvoiceTypeCode>
  <cbc:Note>Open Finance scheme fees, billing period ${inv.period}. Amounts derive from VAT-inclusive scheme rates (tax extracted at 5/105).</cbc:Note>
${inv.transaction_type.length ? `  <!-- UAE Invoice Transaction Type flag(s). Bind against the ASP's PINT AE conformance
       suite before production: the code list is fixed, the carrying element is not
       something to guess at. -->
  <cbc:Note>AE-TRANSACTION-TYPE: ${inv.transaction_type.join(' ')}</cbc:Note>\n` : ''}  <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>
  <cac:InvoicePeriod>
    <cbc:StartDate>2026-06-01</cbc:StartDate><cbc:EndDate>2026-06-30</cbc:EndDate>
  </cac:InvoicePeriod>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0235">${supplier.tin}</cbc:EndpointID>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(supplier.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${supplier.trn}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>AE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
${inv.buyer.endpoint_id ? `      <cbc:EndpointID schemeID="0235">${inv.buyer.endpoint_id}</cbc:EndpointID>` : '      <!-- non-resident buyer: no UAE TIN; delivered by agreed means, still TDD-reported -->'}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.tpp_name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>${inv.buyer.resident ? 'AE' : 'SG'}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="AED">${amt(tax)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="AED">${amt(taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="AED">${amt(tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${inv.tax_category}</cbc:ID>
        <cbc:Percent>${inv.vat_rate.toFixed(2)}</cbc:Percent>
${inv.tax_category === 'Z' ? '        <cbc:TaxExemptionReason>Export of services — zero-rated</cbc:TaxExemptionReason>\n' : ''}        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="AED">${amt(taxable)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="AED">${amt(taxable)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="AED">${amt(inv.gross_mf)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="AED">${amt(inv.gross_mf)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

export const SUPPLIER = { name: 'Tier 2 Licensed Financial Institution (demo)', trn: '100200300400003', tin: '1002003004' };
