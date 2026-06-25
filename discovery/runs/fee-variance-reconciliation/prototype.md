---
artifact: prototype
stage: define
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
fidelity: low
wireframe: wireframe.html
---

# Prototype brief — fee-variance-reconciliation

> Define (*make tangible*). A disposable low-fidelity wireframe of a **fee-variance
> reconciliation monitor**, to test the framing before delivery. Brand-real via `design.md`,
> behaviour-hollow (synthetic data, no live reads).

## What this prototype tests

| Hypothesis | Screen/region that tests it | What a positive reaction looks like |
|---|---|---|
| H1 — analysts want variance surfaced per invoice line, not at month-end | "Open variances" tile | Analyst says "this is the leakage I find late today" |
| H2 — a single reconciled figure across systems would replace the EUC spreadsheet | "Source comparison" row | Analyst stops reaching for their spreadsheet |
| H3 — governance wants accuracy lineage on demand | "Lineage" affordance | Governance asks "can I evidence this for BCBS 239?" |

## Scope of the wireframe

- **Screens included:** one — a single monitor (open-variance tile, source comparison, lineage affordance).
- **Deliberately excluded:** invoicing/tariff contracts, the Hub's fee calculation, dispute handling.
- **Data shown:** synthetic commercial data only (no PSU PII, no live API).

## Fidelity guardrails (D4 / canon §4)

- [ ] Low-fidelity (layout & flow, not pixels)
- [ ] No endpoints, schemas, or component contracts
- [ ] Brand-real via `design.md` tokens only (no raw hex/px/font)
- [ ] Disposable — informs delivery, does not bind it

## Stakeholder reactions (evidence → D2)

Captured after the walkthrough in `stakeholder-reaction.md` (D9) — H1/H2 confirmed, H3
uncertain (lineage depth); reactions logged as signals `S-006`–`S-008`.

## Wireframe

Generated asset: `wireframe.html` (carries the brand marker; rendered against `design.md`).
