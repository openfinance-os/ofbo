// BILL-05 — Collections, dunning and net-settlement decomposition.
//
// Interaction Guide v5.0 §10.16 ("LFI Payment Settlement"): Nebras collects amounts due
// from TPPs and facilitates onward transfer to the LFI under a documented LFI–TPP
// Agreement, with NETTING where the institution also operates as a TPP. One figure arrives
// between the 30th and the 5th. Everything here exists to decompose that figure —
// invoice by invoice, role by role — because an unexplained residue is a break, not a
// rounding curiosity.
//
// The other channel is direct collection, where the Agreement provides for it: the invoice
// carries a payment request on an Open Finance rail (Invoice Collection above AED 5,000),
// Aani Request to Pay below the AED 50,000 rail limit, or a UAEDDS mandate as the
// recurring pull. Dunning mirrors the scheme's own late-payment ladder.

import { MF_PER_AED } from './units.mjs';

export const DUNNING_LADDER = ['current', 'reminded', 'overdue', 'escalated', 'suspension_risk'];

export function settle(run, opts = {}) {
  const { invoiceRun: ir, rated, recon } = run;
  const issued = ir.invoices.filter((i) => i.status === 'ISSUED');

  // ── Channel assignment per counterparty (BD-18) ───────────────────────────────
  const scheme = new Set(opts.scheme_settled ?? ['TPP-0001', 'TPP-0002']);
  const receivables = issued.map((i) => ({
    invoice: i.id, tpp: i.tpp, tpp_name: i.tpp_name, gross_mf: i.gross_mf,
    channel: scheme.has(i.tpp) ? 'scheme_net_settlement' : 'direct_collection',
    rail: scheme.has(i.tpp) ? 'Nebras sponsoring bank' : i.collection.rail,
  }));

  const schemeReceivable = receivables.filter((r) => r.channel === 'scheme_net_settlement');
  const directReceivable = receivables.filter((r) => r.channel === 'direct_collection');

  // ── The payable leg: hub fees the institution owes in its TPP-of-record role ───
  const payable_hub_mf = rated.payable_hub_total_mf;

  const expected_net_mf = schemeReceivable.reduce((n, r) => n + r.gross_mf, 0) - payable_hub_mf;

  // ── The remittance that actually lands ────────────────────────────────────────
  // Simulated with a genuine residue: the scheme withholds one invoice's worth of a
  // disputed line, and a small unexplained difference remains after netting.
  const withheldFromRemittance = recon.breaks
    .filter((b) => b.side === 'receivable' && b.direction === 'MEMO_LOWER')
    .reduce((n, b) => n + Math.abs(b.variance_mf), 0);
  const unexplained_mf = opts.unexplained_mf ?? 21_400; // ~AED 0.21
  const received_mf = expected_net_mf - withheldFromRemittance - unexplained_mf;

  const decomposition = [
    { label: 'Scheme-collected receivables (F2)', sign: '+', amount_mf: schemeReceivable.reduce((n, r) => n + r.gross_mf, 0), refs: schemeReceivable.map((r) => r.invoice), explained: true },
    { label: 'API Hub fees payable, TPP-of-record role (F1)', sign: '−', amount_mf: payable_hub_mf, refs: ['hub.standard', 'hub.paired'], explained: true, note: 'Netted per LFI–TPP Agreement (IG v5.0 §10.16)' },
    { label: 'Withheld — memo under-collection under query', sign: '−', amount_mf: withheldFromRemittance, refs: recon.breaks.filter((b) => b.direction === 'MEMO_LOWER').map((b) => b.id), explained: true, note: 'Carried to next cycle or credit-noted on resolution' },
    { label: 'Unexplained residue', sign: '−', amount_mf: unexplained_mf, refs: [], explained: false, note: 'Above tolerance → break raised automatically' },
  ];

  const residueBreak = unexplained_mf > 1000 ? {
    id: 'BRK-2026-06-SET1', type: 'settlement_residue', amount_mf: unexplained_mf,
    detail: 'Remittance does not fully decompose to invoice + netting lines. Raised inside the 30-day billing-query window.',
    action: 'Nebras billing query — request line-level settlement breakdown',
  } : null;

  // ── Direct-collection ledger with the dunning ladder ──────────────────────────
  const today = opts.today ?? '2026-08-04';
  // Largest exposure left unpaid — the case the dunning ladder exists for.
  const byExposure = directReceivable.slice().sort((a, b) => b.gross_mf - a.gross_mf);
  const collections = byExposure.map((r, i) => {
    const paid = i !== 0;
    const days_overdue = paid ? 0 : 9;
    return {
      ...r, status: paid ? 'PAID' : 'OVERDUE',
      paid_at: paid ? '2026-07-24' : null,
      due: '2026-07-28', days_overdue,
      dunning: paid ? 'current' : days_overdue > 5 ? 'overdue' : 'reminded',
      next_action: paid ? '—' : 'Reminder 2 sent; escalation at +14d per the scheme late-payment ladder',
    };
  });

  // Blocked invoices: traffic billed but the counterparty is not an invoiceable party in
  // the financial system (P9). This is the unbilled-traffic control from BACKOFFICE-72,
  // seen from the money side.
  const blocked = ir.invoices.filter((i) => i.status !== 'ISSUED').map((i) => ({
    invoice: i.id, tpp: i.tpp, tpp_name: i.tpp_name, gross_mf: i.gross_mf,
    reason: 'No financial-system (P9) counterparty registration — cannot invoice',
    action: 'Onboarding task raised to Finance Ops; ITSM ticket + Finance View signal',
  }));

  const dso = collections.length
    ? Math.round(collections.reduce((n, c) => n + (c.status === 'PAID' ? 11 : 21), 0) / collections.length)
    : 0;

  return {
    calendar: {
      '3rd': 'Own metering closed at the Hub extraction boundary; expected memo drafted',
      '5th': 'Collection Memo + Tax Invoice received by email; auto-diff run',
      '5th–12th': 'Three-way reconciliation; breaks worked; billing queries filed inside 30 days',
      '13th': 'Four-eyes invoice run; PINT AE issuance via ASP',
      '10th–30th': 'Direct debit funded (TPP-of-record); collections and dunning',
      '30th–5th': 'Net settlement received and decomposed; GL posted; VAT position closed',
    },
    receivables, decomposition, residueBreak, collections, blocked,
    expected_net_mf, received_mf, unexplained_mf, payable_hub_mf,
    scheme_receivable_mf: schemeReceivable.reduce((n, r) => n + r.gross_mf, 0),
    direct_receivable_mf: directReceivable.reduce((n, r) => n + r.gross_mf, 0),
    blocked_mf: blocked.reduce((n, b) => n + b.gross_mf, 0),
    dso_days: dso,
    reconciles: Math.abs(
      decomposition.reduce((n, d) => n + (d.sign === '+' ? d.amount_mf : -d.amount_mf), 0) - received_mf,
    ) < 2, // integer tolerance — the decomposition must tie to the cash exactly
  };
}
