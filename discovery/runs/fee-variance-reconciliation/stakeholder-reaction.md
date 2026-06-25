---
artifact: stakeholder-reaction
stage: define
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
---

# Stakeholder reaction — fee-variance-reconciliation

> **Make-tangible closes here (D9).** The fee-variance reconciliation monitor wireframe was
> shown to the roles the problem statement names; each reaction is recorded against a framing
> hypothesis and logged as a new signal (`S-006`–`S-008`) so it feeds D2. Synthetic
> stakeholders — `[synthetic]`. Commercial data only, zero PSU PII.

## Session

- **Prototype shown:** `wireframe.html` (+ `prototype.md`)
- **Stakeholders:** reconciliation analyst, finance controller, data governance lead (all `[synthetic]`)
- **Format / date:** facilitated think-aloud walkthrough, 2026-06-18

## Reactions

| Hypothesis | Stakeholder | Verdict | Reaction (what they said/did) | New signal |
|---|---|---|---|---|
| H1 — variance surfaced per invoice line, not month-end | reconciliation analyst `[synthetic]` | confirmed | Called the open-variance tile "the leakage I find late today"; wanted to drill into a line immediately | S-006 |
| H2 — one reconciled figure retires the EUC spreadsheet | reconciliation analyst `[synthetic]` | confirmed | Said a single cross-system figure "means I'd stop reaching for my spreadsheet" | S-007 |
| H3 — accuracy lineage on demand | data governance lead `[synthetic]` | uncertain | Asked "can I evidence this to source for BCBS 239?" — reacted well but couldn't tell from the wireframe how deep the lineage goes | S-008 |

## Outcome

- **Framing:** held. H1/H2 confirmed strongly; H3 is the right direction but the lineage
  depth a BCBS 239 review needs is unresolved at wireframe fidelity.
- **Carried to Develop:** define how far back the lineage affordance must trace (figure →
  source) to satisfy governance; confirm the three-system reconciliation set is complete.
