---
artifact: evidence
design_profile: discovery/brand/design.md
run: fee-variance-reconciliation
backs: [S-002, S-003]
---

# Synthetic manual-rework trace (S-002, S-003)

Source: reconciliation desk timeline, injected fee-variance fault. **Synthetic.**

| Step | When | Who | Tooling |
|---|---|---|---|
| Variance exists in invoice line | invoice posted | — | none fires |
| Noticed | month-end + 2 days | analyst | manual review |
| Root-caused | month-end + 4 days | analyst | end-user spreadsheet (EUC) |
| Corrected | month-end + 6 days | analyst + finance | manual journal |

No automated signal during the window; the trigger is the month-end close, not the event.
