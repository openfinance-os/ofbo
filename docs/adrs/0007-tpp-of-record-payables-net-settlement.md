# ADR 0007 — TPP-of-record fee payables + net settlement

- Status: **Accepted — Option 1** (user decision, 2026-08-17, recorded via BILL-11; product name **TPP Cost Management**)
- Date: 2026-06-20 (proposed) · 2026-08-17 (accepted)
- Related: ADR 0006 (LFI↔TPP data segregation — payables are TPP-domain; accepted the same day); BACKOFFICE-71/-72/-73 (consuming-TPP registry + invoicing, receivables); E1 reconciliation (-01/-02/-12 break detection + thresholds, -06 monthly sign-off); BACKOFFICE-76 (`net_settlement_offset`, cross-scheme guard); P9 financial-management port; the OF-UAE dual-role gap analysis (2026-06-20); delivery backlog BILL-11..BILL-17; BD-15, BD-20..BD-22 (PRD §10)

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
   execution, and cash disbursement. Settlement execution rides the existing P9 port,
   **extended** with an AP-dispatch method + status surface — interface + sim adapter +
   fail-closed enterprise adapter + port contract tests binding both (the M6 gate).
2. **Gross ledgers; netting only at settlement.** TPP payables remain distinct from LFI
   receivables end-to-end; settlement decomposition preserves both gross views, and any
   unexplained residue posts to suspense **and** raises an E1 break.
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
4. **VAT posture (payable side).** TPP↔LFI fees are scheme-defined **VAT-inclusive** →
   5/105 extraction, mirroring the receivable posture. The Nebras **Hub-fee** posture is
   *not* covered by that rule — verified from the first real Nebras TPP tax invoice
   (**BD-20**). Accrue **net of VAT**; recognise input VAT only on a valid tax invoice
   (the acceptance journal gains a `Dr Input VAT receivable` leg).
5. **Primary actuals document.** Nebras calculates and collects *both* TPP→LFI and LFI→TPP
   fees (Pricing Model, Billing & Settlement; DD/VOD collection consents) — so the **Nebras
   invoice / settlement statement is the primary actuals source for both cost components**;
   direct underlying-LFI invoices exist only under bilateral self-invoicing and reconcile
   as the secondary path. BD-15 remains the bank-confirmation hook.
6. **Query window.** The 30-day billing-query window is a **configurable default** — a house
   convention, not a published scheme rule (**BD-21** verifies it against Nebras collection
   requirements / the LFI–TPP agreement).
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

Scheme evidence backing these decisions (verified Jun–Jul 2026; re-verify before BILL-12):
fees accrue only on **technically successful** calls; the paired discount is exactly **one
Balance + one CoP per payment within 2 hours**; insurance policy reads are Hub-chargeable
but LFI-free; quote fees tier 5–12.5 fils by provider count; corporate data is 40 fils/page
with **no** free tier; the refund-account `GET` is chargeable.

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
- **Open verification items tracked here until closed:** directory `OverLimitFees` unit
  (per call vs per page — BILL-12 pre-task) · Nebras Hub-fee VAT posture (BD-20, first
  real invoice at BILL-14) · query-window provenance (BD-21) · Pricing Model version watch
  (a v2.0 invalidates every figure — BILL-01 watcher) · CAAP pricing (future ADR when
  Nebras publishes terms).
