---
artifact: synthesis
stage: discover
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Synthesis — fee-variance-reconciliation

> Discover (converge). Themes trace to logged signals; prioritisation method stated.

## Themes

| Theme id | Theme | Traces to signals | So-what |
|---|---|---|---|
| T-1 | Fee variances are invisible until month-end (timeliness) | S-001, S-003 | Leakage accrues for weeks before anyone sees it |
| T-2 | No single consistent variance figure across systems (consistency/accuracy) | S-002, S-004 | Three systems, three numbers; manual EUC fills the gap |
| T-3 | No lineage proving fee accuracy to source | S-005 | BCBS 239 accuracy can't be evidenced on demand |

## Prioritisation

- **Method:** impact (financial leakage + governance) × reach (all invoiced fee lines) ÷ effort to make observable.
- **Result:**

| Theme | Impact | Reach | Effort | Score | Rank |
|---|---|---|---|---|---|
| T-1 | 5 | 5 | 2 | 12.5 | 1 |
| T-2 | 4 | 5 | 3 | 6.7 | 2 |
| T-3 | 4 | 4 | 3 | 5.3 | 3 |

## Candidate problem (leading theme)

T-1 leads: leakage compounds for the whole period before the month-end close surfaces it, and
it touches every invoiced fee line. T-2 and T-3 are the same root — fee data quality
(timeliness, consistency, accuracy) is not observable or evidenced. The single problem worth
solving is **making fee-variance against contracted tariffs observable and reconciled in near
real time**, with T-1 as the entry point.
