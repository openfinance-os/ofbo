---
artifact: evidence
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
backs: [S-001, S-004]
---

# Synthetic fee-variance sample (S-001, S-004)

Source: Nebras simulator TPP Reports + seeded contract tariffs. **Synthetic — commercial data,
no PII.** 1,000 invoiced fee line items.

| Measure | Value |
|---|---|
| Line items diverging from contracted tariff | 3.8% (38 of 1,000) |
| Median absolute variance per diverging line | 1,250 AED (minor units: 125000) |
| Detected before invoice posting | 0% |
| Systems agreeing on the period variance total | 0 of 3 (ledger vs Hub invoice vs contract) |

Variance is reconstructed after the fact; the three systems each compute it differently.
