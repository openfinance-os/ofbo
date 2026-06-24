---
artifact: evidence
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
backs: [S-003, S-005]
---

# Synthetic lifecycle-drift trace (S-003, S-005)

Source: Nebras simulator Consent Manager with injected consent-drift fault. **Synthetic.**

| t (mm:ss) | Hub state | LFI mirror state | Operator signal |
|---|---|---|---|
| 00:00 | authorised | authorised | — |
| 00:01 | revoked | authorised | none |
| 07:30 | revoked | authorised | none |
| 14:10 | revoked | revoked (reconciled) | none |

The mirror reconciled after ~14 minutes. No operator alert fired during the drift window;
the only trigger in production-like conditions was an inbound customer complaint.
