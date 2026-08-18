# ADR 0007 — TPP-of-record fee payables + net settlement

- Status: **Accepted — Option 1** (user decision, 2026-08-17, recorded via BILL-11; product name **TPP Cost Management**)
- Date: 2026-06-20 (proposed) · 2026-08-17 (accepted)
- Related: ADR 0006 (LFI↔TPP data segregation — payables are TPP-domain; accepted the same day); BACKOFFICE-71/-72/-73 (consuming-TPP registry + invoicing, receivables); E1 reconciliation (-01/-02/-12 break detection + thresholds, -06 monthly sign-off); BACKOFFICE-76 (`net_settlement_offset`, cross-scheme guard); P9 financial-management port; the OF-UAE dual-role gap analysis (2026-06-20); delivery backlog BILL-11..BILL-17; BD-15, BD-20..BD-22 (PRD §10); Nebras Interaction Guide for LFIs & TPPs **v5.0** §10 (billing, collection, settlement — verified 2026-08-17)

### Amendments after acceptance

The decision below is unchanged since acceptance. These are corrections to statements of *fact*.
Recorded per ADR 0030; this table is a BACKFILL, added on 2026-08-18 by the change that
introduced that convention, because this ADR is the case that motivated it — it was corrected in
place on the day it was accepted with nothing on the document saying so.

| date | amendment |
| --- | --- |
| 2026-08-17 | Verified against the Nebras Interaction Guide v5.0 and corrected: VAT posture on the payable side, the query window, and collection mechanics (commit `0f0a79a`, 65 insertions / 22 deletions). |
| 2026-08-17 | Payable rate-model corrections landed with BILL-12 (expected TPP cost statement). |
| 2026-08-18 | This amendments table added retrospectively, per ADR 0030. |


## Context

The bank runs **both** UAE Open Finance roles. OFBO's commercial surface is almost
entirely **receivables** — the LFI side:

- BACKOFFICE-71/-72/-73: consuming-TPP registry, P9 registration, and **invoice runs**
  for fees the bank *charges* TPPs.
- E1 reconciliation: the three-way fee recon of what the bank *meters / is owed*.

As a **TPP-of-record**, the bank also incurs **payables** it cannot currently track,
verify, or settle in the back office:

- **API-Hub fees to Nebras** on calls the bank-as-TPP makes (payment initiation
  2.5 fils, balance/CoP-with-payment 0.5 fils, data sharing 2.5 fils/100 lines,
  quotes 5–12.5 fils).
- **Payment fees to counterparty LFIs** on payments the bank-as-TPP initiates
  (merchant collections 38→25 bps Y1→Y5, P2P/SME 25 fils, corporate 250 fils).

There is **no payables ledger, no payables reconciliation, and no net-settlement view.**
BACKOFFICE-76 added a single `net_settlement_offset` field on invoice runs and a
cross-scheme double-compensation guard, but that is narrow — it is not a general
payables capability. So the back office can bill and reconcile what the bank is *owed*
but is blind to what it *owes* — exactly half the commercial picture for a dual-role
participant, and the half with no control against the Hub or counterparties
**over-billing** the bank.

Per CLAUDE.md rule 6 this is a genuinely uncovered commercial control (no PRD
requirement for the payables side), so it is a humans-decide ADR.

## Requirements & regulatory / commercial basis

- **OF-UAE commercial model.** The fee schedules above are scheme-defined; as a TPP the
  bank pays them, and must be able to reconcile and settle them accurately.
- **Financial control / fee-variance.** The LFI receivables recon exists precisely to
  catch fee variances; **payables deserve the same three-way discipline** — the bank's
  own call/payment metering ↔ Nebras's TPP-side invoice ↔ counterparty terms — to detect
  over-billing by the Hub or LFIs (a billing-dispute / liability angle).
- **Settlement integrity.** The bank needs its **net scheme position** (receivables −
  payables), must avoid double-paying, and must honour cross-scheme recall windows
  (Aani 2-hour) already partially handled in -76.
- **Audit / finance governance.** Payables need the same **monthly Finance four-eyes
  sign-off (-06) + BCBS 239 lineage** the receivables already have.

## Options

1. **Symmetric payables ledger + payables reconciliation + net-settlement view (recommended).**
   - Ingest **Nebras's TPP-side invoices** (what the Hub / counterparty LFIs bill the
     bank) via the P6 egress / P9 financial-system port.
   - **Reconcile three-way** against the bank-as-TPP's own metering, reusing the existing
     break-detection (-02) + configurable thresholds (-12) — variances become breaks on
     the *payables* side.
   - Add a **net-settlement view** (receivables − payables) with the monthly Finance
     **four-eyes sign-off** (-06) and lineage; hand the resulting settlement instruction
     to the **P9** financial-management system for execution.
   - **Pros:** composes the existing reconciliation/billing/audit primitives; gives the
     same fee-variance control on payables that the LFI side already has; one coherent
     dual-role commercial picture. **Cons:** a new payables data class + a Nebras
     TPP-invoice ingest + counterparty fee schedules; non-trivial but additive.

2. **Payables tracking only (no reconciliation).** Record what's owed from Nebras
   invoices and pay it; no three-way verification.
   - **Pros:** light. **Cons:** no control against Hub/counterparty over-billing — which
     is the entire reason the LFI fee recon exists. Asymmetric and weak; **not recommended.**

3. **Out of scope — handle payables entirely in the core FMS (P9).**
   - **Pros:** AP may already live there. **Cons:** the FMS has neither the OF call/payment
     metering nor the Nebras-invoice line detail, so it cannot do the OF-specific three-way
     recon. **The reconciliation belongs in OFBO; only settlement execution hands off to
     P9.** Rejected as a complete answer (but its settlement-handoff is folded into Option 1).

## Recommendation (for the human to confirm)

**Option 1**, with settlement *execution* delegated to P9. It extends the commercial
domain symmetrically — the bank reconciles and governs what it owes with the same rigour
as what it's owed — using primitives OFBO already has, and closes the dual-role
commercial blind spot.

## Decision

**Accepted — Option 1** (user decision, 2026-08-17). Product name: **TPP Cost Management** —
the payable side of the existing billing control plane, delivered as backlog items
BILL-11..BILL-17 (spec-first per story). The ratified decisions:

1. **Boundary.** OFBO owns metering, rate application, expected-cost statements,
   provider-document ingestion, three-way reconciliation, dispute evidence + query-window
   tracking, approval workflow, settlement decomposition, closed-period corrections, and
   audit/regulatory evidence. **P9 owns** final AP posting, supplier master, payment
   settlement, and cash accounting. Settlement execution rides the existing P9 port,
   **extended** with an AP-dispatch method + status surface — interface + sim adapter +
   fail-closed enterprise adapter + port contract tests binding both (the M6 gate).
   **Collection is a direct-debit pull, not a push payment** (IG v5.0 §10.14.1: TPPs are
   required to pay by direct debit; the DDA is presented to the Nebras sponsoring bank on
   the 10th, the collection window runs to the 30th) — so P9's "payment execution" means
   DD mandate management plus matching the pulled debit to the approved payable, and the
   four-eyes AP approval is what authorises honouring the debit. Late payments accrue
   penalty fees on a subsequent invoice after reminders (§10.17) — reconciliation treats
   a penalty line as a distinct charge class, expected only when a late payment actually
   occurred (otherwise it is an unexpected-charge break).
2. **Gross ledgers; netting only at settlement.** TPP payables remain distinct from LFI
   receivables end-to-end; settlement decomposition preserves both gross views, and any
   unexplained residue posts to suspense **and** raises an E1 break. Scheme-confirmed for
   the dual-role case verbatim — IG v5.0 §10.16: *"amounts payable to LFIs are netted
   against any fees owed to Nebras where the LFI also operates as a TPP"* (net settlement
   via the Nebras sponsoring bank; detail in the LFI–TPP Agreement). The settlement
   calendar is §10.12.3: LFI-side fund transfers run the 30th to the 5th of the next month.
3. **Fee-schedule source of truth.** The scheme **Commercial & Pricing Model** (versioned
   document — currently v1.0, 4 Oct 2024, reviewed annually by CBUAE/Nebras board) for
   scheme-uniform fees, **plus per-LFI directory-published data-overage rates**
   (`GET /participants` → `ApiResources[].ApiMetadata.OverLimitFees`; absent/empty = that
   LFI charges nothing above the free thresholds). Rate cards are effective-dated; each
   statement's rate-snapshot hash chains to the pricing-doc version and the directory
   snapshot; the BILL-01 watcher covers both sources. Mirror-pricing off the bank's own
   receivable card is retained **only** for scheme-uniform fees — never data overage.
   **Unit check (BILL-12 pre-task, blocking):** the directory publishes overage per *call*;
   the house model prices per *page* (100 lines) — confirm against a live snapshot before
   the statement model lands.
4. **VAT posture (payable side), split by stream** (verified against IG v5.0 §10.9/§10.10):
   TPP↔LFI fees are scheme-defined **VAT-inclusive** → 5/105 extraction, mirroring the
   receivable posture (the sample Collection Memo shows amounts with no VAT columns).
   Nebras **Hub fees are VAT-exclusive**: the sample Nebras Tax Invoice prices lines at the
   net scheme rate (e.g. 0.025 AED) with Taxable Amount / VAT 5% / VAT Amount / Gross
   columns — VAT is **added on top**, not extracted. **BD-20** narrows to confirming this on
   the first *real* invoice (the sample carries one internal inconsistency — a
   CoP-discounted unit of 0.25 vs the scheme's 0.005 — so it is strong evidence, not final).
   Accrue **net of VAT**; recognise input VAT only on a valid tax invoice (the acceptance
   journal gains a `Dr Input VAT receivable` leg).
5. **Primary actuals document.** Per IG v5.0 §10.2–10.3, the monthly **Nebras Tax Invoice
   to the TPP may carry both cost components** — API Hub fees *and* LFI charges (fees
   payable by TPPs to LFIs) — with summarized supporting data alongside (§10.3.4; more
   available on request, §10.18). The sample invoice (§10.9) demonstrates only the Hub-fee
   sections, so ingestion must accept **both layouts** (Hub-only invoice + LFI-charges
   component wherever it arrives). Direct underlying-LFI invoices exist only under
   bilateral self-invoicing and reconcile as the secondary path. BD-15 remains the
   bank-confirmation hook. **Reconciliation grain:** the invoice aggregates by its own
   line categories (Service Initiation: Corporate Payment / Payment Initiation / Payment
   Data; Data Sharing: Bank Data Sharing / Corporate Data / Balance (Discounted) / CoP
   (Discounted) / Setup and Consent / Insurance Data Sharing / Insurance Quote Sharing) —
   matching runs at that category grain via a maintained **category → fee-class mapping**,
   with our line-level evidence beneath it.
6. **Query window — scheme-published** (corrects the earlier "house convention" reading,
   which pre-dated IG v5.0): §10.13 sets billing-query timeframes — submit **within 30
   calendar days of occurrence**, first response 10 minutes, final response 10 days,
   respondent review & escalation 15 days; §10.12.2 obliges prompt reporting. The window
   stays configuration (default 30 calendar days), and **BD-21** narrows to confirming the
   anchor semantics ("occurrence" — charge date vs invoice receipt) in the LFI–TPP
   Agreement. The payable dispute workflow also tracks **Nebras's response clocks**
   (10-day final response, 15-day escalation).
7. **Close composes -06.** Cost-period close is a gated precondition feeding the *existing*
   monthly Finance four-eyes sign-off (BACKOFFICE-06) — no parallel close mechanism. The
   2-business-hour approval-expiry default applies to all new four-eyes actions.
8. **Corrections.** Closed cost periods are corrected by re-rating replay producing immutable
   delta statements (mirror of `billing_period_rerating`) — never mutation.
9. **Insurance.** API-consumption costs are **in scope** (metered external cost; insurance
   data sharing is LFI-side free, so it produces Nebras cost only — no `payable_lfi`).
   Insurance commissions/clawbacks stay **deferred** until an approved commercial model
   exists (scheme defaults: 30-day cool-off before commission, 2-year life clawback).
10. **Storage.** PostgreSQL remains the governed operational ledger (Parquet archive tier
    unchanged); no ClickHouse.
11. **Sequencing with ADR 0006.** Accepted alongside: the new payable tables
    (`billing_tpp_cost_*`) are tagged **TPP-domain** from day one; the platform-wide
    role-domain taxonomy is BD-22 / SEG-01.
12. **Future stream.** CAAP pricing is a commercial placeholder at Nebras — reserved here as
    a named future cost stream so the model has a place for it; no build now.
13. **No PSU identifiers** in any cost table: statement lines reference `event_ids` for
    drill-down (`psu_id` stays confined to `billing_event`); no per-customer buckets are
    persisted, so no derived customer key exists.

Scheme evidence backing these decisions (pricing verified Jun–Jul 2026; billing mechanics
verified against **IG v5.0**, uploaded 2026-08-17; re-verify pricing before BILL-12):
fees accrue only on **technically successful** calls; the paired discount is exactly **one
Balance + one CoP per payment within 2 hours**; insurance policy reads are Hub-chargeable
but LFI-free; quote fees tier 5–12.5 fils by provider count; corporate data is 40 fils/page
with **no** free tier (confirmed on the sample Collection Memo at 0.4 AED/page); the
refund-account `GET` is chargeable. **Billing calendar (IG v5.0 §10.12.3):** usage
extracted the 3rd → invoice + collection memo to the designated PBCs on/before the **5th**
(next business day if weekend/holiday) → DDA presented the **10th** → collection window to
the **30th** → LFI settlements 30th–5th. §10.12.2 makes it the *participant's obligation*
to raise non-receipt of the invoice/memo by the 5th — the missing-document alarm is a
compliance control, not just hygiene. The sample Collection Memo also shows per-LFI
retail-overage pricing as an LFI-set rate ("Customer Data" at the issuing LFI's own
price), reinforcing the per-LFI overage decision and the BILL-12 unit check.

## Consequences

- New **payables data class** + Nebras TPP-invoice ingest (P6/P9) + counterparty fee
  schedules; reuses break detection (-02/-12), monthly sign-off (-06), and lineage.
- **Soft-depends on ADR 0006** — resolved: 0006 accepted the same day; payable tables are
  TPP-domain-tagged from day one (0006 Decision).
- **Bank decisions:** settlement ownership and fee-schedule source decided above; still
  open as PRD §10 checklist items — BD-20 (Hub-fee VAT posture), BD-21 (query window),
  BD-22 (platform-wide role-domain taxonomy), BD-15 (collection-model confirmation).
- **Until built, the bank's dual-role commercial position is half-visible** (receivables
  only) and payables carry no over-billing control — the gap BILL-12..17 closes.
- Composes existing primitives only — **no new approval mechanism, gateway, or auth path**
  (the P9 port is extended, not bypassed; close feeds the existing -06 sign-off).
- **BILL-12 outcome (2026-08-17).** The expected-cost domain, per-LFI rate resolution and both
  projection corrections landed. Three things the story could NOT close, recorded rather than
  assumed: (a) the **live directory is unreachable** from the build environment (egress policy
  denies `data.directory.openfinance.ae`), so no snapshot has been observed and the `unit` is a
  required, never-defaulted field on every snapshot — rating **fails closed** on a chargeable
  overage line with no snapshot rather than mirroring the receivable card; (b) the **retail
  free-tier granularity** is a new open question (below); (c) **existing meter runs are not
  backfilled** — runs dedupe on `(bank_id, period, rate_card_version, input_hash)`, so the
  corrected projection is bound into the hash via `METERING_PROJECTION_VERSION`, meaning a
  corrected period yields a NEW immutable run; already-processed periods keep their original run
  until re-ingested, which is a deliberate append-only choice, not a silent no-op.
- **Open verification items tracked here until closed:** directory `OverLimitFees` unit
  (per call vs per page — BILL-12 pre-task, BLOCKED on directory reachability; the sample
  Collection Memo's LFI-set "Customer Data" rate confirms per-LFI pricing but not the unit) ·
  **retail free-tier granularity** — the C&P model says "15 pages/customer/day" without stating
  whether each serving LFI grants its own allowance; per-serving-LFI is the likelier reading but
  grants MORE free pages and so understates the payable, so the conservative `psu_per_day` is the
  rate-card default and the alternative is an explicit, tenant-selectable value · Nebras Hub-fee VAT
  posture (**narrowed by IG v5.0 §10.9**: the sample invoice shows VAT-exclusive + 5% —
  BD-20 now only confirms this on the first *real* invoice, which also resolves the
  sample's CoP-discounted unit anomaly, 0.25 vs 0.005) · query-window **anchor semantics**
  (BD-21 — the window itself is published: §10.13, 30 calendar days) · Pricing Model
  version watch (a v2.0 invalidates every figure — BILL-01 watcher) · CAAP pricing
  (future ADR when Nebras publishes terms).
