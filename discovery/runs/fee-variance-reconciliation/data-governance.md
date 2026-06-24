---
artifact: data-governance
stage: define
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Data-governance feasibility — fee-variance-reconciliation

> Define (converge). Mapped against `docs/governance/data-risk-register/`. This direction sits
> in the **Data Quality** domain (DR-1), not privacy — a different part of the register from the
> consent run. Data is **commercial counterparty/fee data, synthetic, zero PII**.

## Data the direction would touch

| Data element (synthetic) | Classification | Subject | Purpose |
|---|---|---|---|
| Invoiced fee line items | Commercial (non-PII) | TPP counterparty | Compare to contracted tariff |
| Contracted tariff schedule | Commercial (non-PII) | TPP counterparty | Source of truth for the fee |
| LFI ledger postings | Commercial (non-PII) | Bank | Cross-system reconciliation |
| No PSU account/transaction content | — | — | Out of scope by design |

## Risk mapping (→ register)

| Data element | DR-* category | Inherent rating | Regulatory driver(s) | Mitigating CTRL-* |
|---|---|---|---|---|
| Fee variance vs tariff (timeliness) | DR-1.3-001 | High | CPS-2.1.2.2 | CTRL-DQ-003, CTRL-DQ-008 |
| Variance figure across systems (consistency) | DR-1.4-001 | Medium | MMS-4.9.1 | CTRL-DQ-003, CTRL-DQ-006 |
| Fee data accuracy (BCBS 239) | DR-1.1-003 | High | BCBS239-P3-002, BCBS239-P3-003 | CTRL-DQ-012, CTRL-DQ-003 |

Cited categories resolve in the register: **DR-1.1-003**, **DR-1.3-001**, **DR-1.4-001**.
Cited controls resolve: **CTRL-DQ-003** (Data Quality Dashboard & Monitoring), **CTRL-DQ-006**
(Cross-System Data Reconciliation), **CTRL-DQ-008** (Data Refresh & Currency Monitoring),
**CTRL-DQ-012** (Risk Data-to-Source Reconciliation).

## Residual-risk verdict (D6)

- **Residual rating after controls:** Very Low (the register computes DR-1.1-003 High→Very Low,
  DR-1.3-001 High→Very Low, DR-1.4-001 Medium→Very Low).
- **Acceptable for delivery?** Yes — this direction is *read-only observability + reconciliation*
  over commercial fee metadata; it adds no new processing purpose and carries no PSU PII, so it
  sits squarely within CTRL-DQ-006's reconciliation remit.
- **Conditions / watch-items carried into hand-off:** commercial data only (no PSU PII);
  INSERT-only audit of the reconciliation evidence; BCBS 239 lineage emission to source; Hub-bound
  reads via P6 egress.

## Uncovered risks

None left uncovered: the High inherent risks (DR-1.1-003, DR-1.3-001) and the Medium (DR-1.4-001)
all have mitigating controls cited above; this direction observes and reconciles their existing
operation rather than introducing new processing.
