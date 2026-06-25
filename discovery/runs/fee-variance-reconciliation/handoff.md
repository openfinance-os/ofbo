---
artifact: handoff
stage: handoff
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Delivery hand-off — fee-variance-reconciliation

> The boundary object. Problem + governance position + tangible direction. No delivery design.

## Problem (from `problem-statement.md`)

- **Problem:** invoiced TPP fee variances against contracted tariffs are invisible until the
  month-end close and inconsistent across the ledger, the Hub invoice, and the contract — causing
  compounding leakage, manual EUC rework, and no fee-accuracy lineage.
- **Target user:** reconciliation analyst (primary); finance controller; data governance lead.
- **Success measures:** variance detected within a day of the invoice line; one reconciled figure
  across systems; accuracy lineage available on demand.
- **Explicitly out of scope:** invoicing/tariff contracts; the Hub's fee calculation; dispute resolution.

## Data-governance position (from `data-governance.md`, D6)

- **Residual-risk verdict:** Very Low — Conditional on read-only observability + reconciliation
  over commercial fee metadata (DR-1.1-003 / DR-1.3-001 / DR-1.4-001; CTRL-DQ-003 / 006 / 012).
- **Conditions delivery inherits:** commercial data only (no PSU PII); INSERT-only audit of
  reconciliation evidence; BCBS 239 lineage emission to source; Hub-bound reads via P6 egress.

## Direction, made tangible (from `prototype.md`)

- **Prototype:** `prototype.md` + `wireframe.html` — a fee-variance reconciliation monitor.
  *Direction, not specification.*
- **Validated framing hypotheses:** variance per invoice line (H1); one reconciled figure (H2);
  accuracy lineage on demand (H3) — to confirm in a stakeholder review.
- **Open questions for Develop:** what variance tolerance the bank accepts before signalling; how
  reconciliation evidence routes into the close.

## Gate status

| Gate | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 |
|---|---|---|---|---|---|---|---|---|
| Pass? | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## What delivery owns now

The right diamond authors the solution from scratch against the delivery contract. This brief
informs; it does not design.
