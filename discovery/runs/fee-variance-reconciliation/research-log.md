---
artifact: research-log
stage: discover
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Research log — fee-variance-reconciliation

> Discover (diverge). All signals synthetic — Nebras simulator + seeded reconciliation desk.
> Data here is **commercial counterparty/fee data, not PSU PII**; still synthetic, zero PII.

## Stakeholders consulted

| Stakeholder (role, synthetic) | Scope of input | Date |
|---|---|---|
| Reconciliation analyst | Where invoiced fees diverge from contracted tariffs | 2026-06-15 |
| Finance controller (P9) | Month-end leakage and manual rework | 2026-06-16 |
| Data governance lead (BCBS 239) | Lineage/accuracy evidence for fee data | 2026-06-17 |

## Signals

| Signal id | Source | Observation | Type | Confidence |
|---|---|---|---|---|
| S-001 | sim TPP Reports `[synthetic]` | 3.8% of invoiced fee line items diverge from the contracted tariff; only visible at month-end | pain | high |
| S-002 | reconciliation desk `[synthetic]` | Analysts rebuild variance by hand in an end-user spreadsheet (EUC); root cause unknown until then | pain | high |
| S-003 | sim fee-variance fault `[synthetic]` | Under injected fee-variance fault, no operator signal fires until the invoice is posted | constraint | medium |
| S-004 | finance interview `[synthetic]` | Three systems (LFI ledger, Hub invoice, contract tariff) report three different variance figures | pain | high |
| S-005 | governance review `[synthetic]` | No lineage proving the fee figures are accurate to source for a BCBS 239 review | need | high |

## Evidence index

| File | Backs signal(s) | Notes |
|---|---|---|
| evidence/variance-sample.md | S-001, S-004 | Synthetic line-item variance distribution |
| evidence/euc-rework-trace.md | S-002, S-003 | Synthetic manual-rework timeline |
