---
artifact: problem-statement
stage: define
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Problem statement — fee-variance-reconciliation

> Define (converge). The single problem worth solving. Names the problem, not the build.

## The problem (falsifiable)

For a **reconciliation analyst (synthetic persona)** who **must ensure invoiced TPP fees match
the contracted tariffs**, today **fee variances are invisible until the month-end close and
inconsistent across the ledger, the Hub invoice, and the contract**, which causes **financial
leakage that compounds for weeks, manual end-user-spreadsheet rework, and no lineage to evidence
fee accuracy**. We know this from S-001, S-002, S-003, S-004, S-005.

## Target user

- Persona (synthetic): reconciliation analyst; secondary: finance controller, data governance lead.
- Context / trigger: a TPP fee invoice line is posted that diverges from the contracted tariff.

## Success measures

| Measure | Baseline (today) | Target | How measured |
|---|---|---|---|
| Time to detect a fee variance | month-end + 2 days | within a day of the invoice line | variance-detection signal |
| Consistency of the variance figure across systems | 0 of 3 agree | one reconciled figure | cross-system reconciliation check |
| Fee-accuracy lineage available | manual reconstruction | available on demand | lineage completeness check |

## Constraints (boundaries, not solutions)

- Regulatory / governance: BCBS 239 accuracy & reconciliation; CPS fee-transparency expectations;
  data residency; zero PII (commercial counterparty data only).
- Operational: the reconciliation engine is a headless scheduled job; all Hub-bound reads via P6 egress.
- Out of scope (explicit): changing the invoicing or tariff contracts; the Hub's fee calculation;
  the dispute-resolution flow.

## Stakeholders & scope (D3)

| Stakeholder | In/out of scope | Why |
|---|---|---|
| Reconciliation analyst | in | Primary owner of fee reconciliation |
| Finance controller | in | Owns the leakage and the close |
| Data governance lead | in | Needs the accuracy lineage |
| TPP counterparty | out | Not a back-office surface |

> **Not here (D4):** no endpoints, schemas, tech choices, or delivery stories. Solution ideas
> are parked for the prototype as a *direction* and for delivery to author.
