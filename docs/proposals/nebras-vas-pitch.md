# Al Tareq Operations Console — a Value-Added Service proposal for Nebras

*One page. Companion decision record: ADR 0026.*

## The problem you own

The mandate covers every licensed bank, insurer, and broker — but the scheme's liability
apparatus, SLA clocks, and reporting cadences only work if participants can actually operate
them. Today the long tail cannot: they miss revoke-acknowledgment SLAs, raise malformed
disputes, let billing-query windows lapse, and leave the 16 login-only LFI reports unread.
Every one of those failures lands on Nebras as support load, certification delay, and scheme
risk. You solved this class of problem once already: **CAAP** — where the tail could not build
FAPI-grade authentication, the scheme hosted it ("consent management via CAAP or LFI"), and
extended it segment by segment (Banking → Insurance → Exchange Houses, Dec 2025).

**Operations is the next CAAP.**

## The offer

An OEM licence of a production-ready, participant-side operations console — white-labelled as
the **Al Tareq Operations Console** — bundled to participants the way CAAP is:

- **Consent operations + customer care** — search, revoke (fraud path four-eyes-gated),
  <5s-revoke SLA instrumentation, full consent audit trail.
- **Dispute case management** — the participant-side mirror of your hub Case & Dispute
  service, with every scheme clock (response → resolution → appeal → implementation) tracked.
- **Mandatory reporting** — CBUAE-bound reports generated, four-eyes-approved, submitted with
  integrity hashes; ingestion + cadence tracking for the 16 login-only LFI reports.
- **AML basics** — fraud-suspected revocation to STR draft to the bank's own STR workflow
  (never direct to AML GO), fully audited.
- **Regulated posture built in** — INSERT-only audit, 24-month/5-year retention, BCBS 239
  column-level lineage, row-level security per participant, zero PII in telemetry.

## Why this is good business for Nebras

1. **Scheme health**: tail participants become operationally competent in weeks — SLA
   compliance, dispute discipline, and reporting cadence rise across exactly the segment that
   drags them today.
2. **Your support cost falls**: properly-formed disputes, self-served report ingestion, and
   SLA-instrumented participants generate fewer service-desk cases.
3. **Certification throughput**: live-proving needs functioning participants on both sides;
   an operationally-ready tail accelerates your activation calendar (R4+ Apr 2026, Corporate
   R5 Sep 2026).
4. **Zero distribution cost**: you already invoice every participant monthly — the console is
   a VAS line on existing rails, or bundled into scheme fees the way CAAP is.
5. **It exists now.** Multi-tenant by construction (per-participant row-level security from
   day one), serverless (near-zero marginal cost per participant), UAE-resident by
   configuration. A live seeded demo — Alpha Bank, real ecosystem TPP names, a single fraud
   incident traceable across every console — is available today, and our own Nebras simulator
   means we integrate against your surfaces without touching your systems until you choose.

## What stays outside this proposal (and why that protects you)

Reconciliation of participant records **against Nebras invoices**, liability-exposure
monitoring, and scheme-SLA measurement are deliberately **not** part of the console: an
examiner would rightly object to the invoice-issuer operating the invoice-verifier. Those
remain an independent, participant-paid product. The boundary keeps the console tier clean for
you — no conflict-of-interest finding can attach to a Nebras-distributed tool.

## Suggested next step

A 45-minute working demo (Alpha Bank walkthrough: consent revoke → dispute → report → STR),
followed by a scoped pilot with 2–3 exchange-house or insurer participants alongside the
Dec 2025 CAAP extension — the segment already on your onboarding calendar.

---
*Contact: [owner to insert]. All demo data is synthetic; institution names appear only in
healthy states; no PSU PII exists anywhere in the system.*
