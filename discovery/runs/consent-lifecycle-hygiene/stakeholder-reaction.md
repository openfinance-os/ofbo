---
artifact: stakeholder-reaction
stage: define
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Stakeholder reaction — consent-lifecycle-hygiene

> **Make-tangible closes here (D9).** The consent-lifecycle hygiene monitor wireframe was
> shown to the roles the problem statement names; each reaction is recorded against a framing
> hypothesis and logged as a new signal (`S-006`–`S-008`) so it feeds D2. Synthetic
> stakeholders — `[synthetic]`. Zero real PII.

## Session

- **Prototype shown:** `wireframe.html` (+ `prototype.md`)
- **Stakeholders:** consent operations analyst, care team lead, compliance officer (all `[synthetic]`)
- **Format / date:** facilitated think-aloud walkthrough, 2026-06-13

## Reactions

| Hypothesis | Stakeholder | Verdict | Reaction (what they said/did) | New signal |
|---|---|---|---|---|
| H1 — revoke timeliness made visible | consent ops analyst `[synthetic]` | confirmed | Called the revoke-acknowledgement tile "the number I chase today, blind"; fixated on the 5s line | S-006 |
| H2 — drift indicator pre-empts complaints | care team lead `[synthetic]` | confirmed | Pointed at the amber drift window unprompted as "the thing to catch before the customer calls" | S-007 |
| H3 — on-demand SLA evidence | compliance officer `[synthetic]` | partially | Asked "can I export this slice for an audit?" — wants a *dated* evidence export, not just an on-screen view | S-008 |

## Outcome

- **Framing:** held. All three hypotheses drew the predicted positive reaction; the problem
  statement stands.
- **Carried to Develop:** the evidence affordance must produce a **dated, exportable** SLA
  artifact (H3 was only *partially* satisfied by an on-screen view); and the timeliness window
  beyond the 5s default the bank tolerates is still open (also noted in `handoff.md`).
