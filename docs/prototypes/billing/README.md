# Billing module — working prototype

A runnable billing engine for the LFI side of the UAE Open Finance scheme, plus a clickable
console rendered entirely from its output. Prototype, not production: it lives outside
`apps/` and `services/`, has no database, no auth and no ports — it exists to make the
BILLING backlog items concrete before they are built for real.

Research basis: [`docs/research/lfi-billing-system-tier2.md`](../../research/lfi-billing-system-tier2.md).
Backlog: **BILL-01..10** in [`docs/backlog.yaml`](../../backlog.yaml).

```bash
node run.mjs            # run the cycle → out/run.json + PINT AE invoices
node verify.mjs         # 15 independent arithmetic checks (recomputes, doesn't trust)
node build-console.mjs  # → ofbo-billing-console.html (self-contained, open in a browser)
```

No dependencies. Node 18+. Deterministic: same seed → byte-identical output, so the console
is reproducible from source rather than a saved artefact. `node run.mjs --seed 12345` gives a
different synthetic month.

## What it covers

| Item | Where | What is real in the prototype |
|---|---|---|
| **BILL-01** rate-card-as-code | `engine/rate-card.mjs` | The full scheme rate card as effective-dated config: bps schedules with the AED 50 cap, the AED 200/day merchant allowance **conditional on Merchant ID** (rule of 2 Jun 2026), batch caps, per-page data fees, free tiers, directory-published overage, hub fees with the paired-discount and quote tiers. Plus the upstream-change watcher and the **undefined year-step anchor** carried as an explicit assumption |
| **BILL-02** independent metering | `engine/meter.mjs` | Chargeability classification, technically-successful-only, page aggregation (100 lines), attended/unattended free tiers per PSU per day, the 2-hour payment↔balance/CoP pairing (one of each, greedy nearest, no double-spend), merchant daily allowance, and a **blind-spot counter** for endpoints the classifier does not know |
| **BILL-03** rating + memo diff | `engine/rating.mjs`, `engine/memo.mjs` | Rates own metering into an "expected Collection Memo" ready on the 3rd; simulates the scheme statement with four realistic variance classes injected; three-way diff (own / memo / P9) with breaks carrying every contributing cause, signed contributions and the 30-day query clock |
| **BILL-04** e-invoicing | `engine/invoice.mjs` | Invoice run with **partial withholding** (the disputed amount is held, the undisputed remainder billed), VAT extracted 5/105 from VAT-inclusive scheme fees, zero-rated export for the non-resident TPP, and real **PINT AE UBL 2.1** documents written to `out/*.pint-ae.xml` |
| **BILL-05** settlement | `engine/settlement.mjs` | Net-settlement decomposition that ties to the cash exactly, cross-role netting (LFI receivable vs TPP-of-record payable), an unexplained residue that raises its own break, direct-collection rails and a dunning ladder |
| **BILL-08** revenue assurance | `engine/assurance.mjs` | Five leakage classes priced in AED, a leakage KPI against a <1% target, and the counterfactual cost of leaving the directory overage rate unpublished |
| **BILL-09** profitability | `engine/assurance.mjs` | Per-TPP P&L with liability provision and uncollectable amounts; TPP-aaS pass-through cost, markup and margin; fee simulation re-rated line by line (the cap applies per transaction) |

Not modelled: **BILL-06** commissions and clawbacks (needs INS-01), **BILL-07** GL posting,
**BILL-10** multi-tenant overlays.

## The dual role

The institution is metered on both sides, because it is both:

- **inbound** — consuming TPPs call its APIs → its receivable (F2);
- **outbound** — it calls other LFIs as TPP-of-record for its TPP-aaS clients → API Hub fees
  and counterparty-LFI fees payable (F1), re-billed onward with margin.

Inbound balance and CoP calls are metered **at zero** on purpose: the consuming TPP pays the
Hub for those, the institution charges nothing. Counting them anyway is what makes "we are not
billing for this" a demonstrable statement rather than an assumption.

## What the seeded month demonstrates

Deliberately seeded so each mechanism fires at least once — the numbers below come from
`node run.mjs` at the default seed:

- the **AED 50 cap** binds on 31 merchant collections, and **52 payments arrive with no
  Merchant ID** and so correctly lose the daily allowance;
- one statement line nets **two opposing errors** (a cap not applied, +AED 510.99; an
  exemption wrongly granted, −AED 38.05) — gross error is 1.6× the net, which is exactly how
  a variance stays small enough to wave through;
- retail data overage is **65% of the receivable**, priced by one directory field that most
  LFIs leave empty;
- one TPP trades in production with **no financial-system counterparty**, so 92% of the
  month's leakage is a missing onboarding form rather than a pricing failure;
- the net settlement decomposes to the fil, leaving an **AED 0.21 residue** that raises a
  break on its own.

## Honest limits

Synthetic data throughout — invented counterparties, 999-prefixed PSUs, zero real records.
The scheme's memo format is simulated (there is no billing API to integrate against, and only
aggregated supporting data is shared). The PINT AE documents are well-formed and structurally
correct but have not been through an ASP conformance suite — the transaction-type flag in
particular is carried as a `cbc:Note` pending that check. Volumes are plausible for an
early-live institution, not a forecast.
