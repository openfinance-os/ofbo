# ADR 0007 — TPP-of-record fee payables + net settlement

- Status: **Proposed** — awaiting human decision (new commercial surface; fee-schedule + settlement-ownership decisions)
- Date: 2026-06-20
- Related: ADR 0006 (LFI↔TPP data segregation — payables are TPP-domain); BACKOFFICE-71/-72/-73 (consuming-TPP registry + invoicing, receivables); E1 reconciliation (-01/-02/-12 break detection + thresholds, -06 monthly sign-off); BACKOFFICE-76 (`net_settlement_offset`, cross-scheme guard); P9 financial-management port; the OF-UAE dual-role gap analysis (2026-06-20)

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

_Pending._ Once chosen: (a) capture the counterparty/API-Hub **fee schedules** as a
BD-style decision; (b) decide **settlement ownership** (OFBO instruction → P9 execution);
(c) raise a BACKOFFICE requirement + PRD addition; (d) implement payables ingest +
three-way recon + net-settlement view + Finance sign-off + lineage, tests-first.

## Consequences

- New **payables data class** + Nebras TPP-invoice ingest (P6/P9) + counterparty fee
  schedules; reuses break detection (-02/-12), monthly sign-off (-06), and lineage.
- **Soft-depends on ADR 0006** — payables are TPP-role-domain data, so the role-domain
  taxonomy should tag them; sequence 0006's classification first for a clean wall.
- **Bank decisions required:** fee schedules and settlement ownership.
- **Until built, the bank's dual-role commercial position is half-visible** (receivables
  only) and payables carry no over-billing control — a known gap.
- Composes existing primitives only — **no new approval mechanism, gateway, or auth path**
  (settlement execution rides the existing P9 port).
