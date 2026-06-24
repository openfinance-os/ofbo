---
artifact: handoff
stage: handoff
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Delivery hand-off — consent-lifecycle-hygiene

> The boundary object. Problem + governance position + tangible direction. No delivery design.

## Problem (from `problem-statement.md`)

- **Problem:** consent-withdrawal acknowledgement latency and lifecycle-state drift are
  invisible until a customer complains — causing silent SLA breaches, stale-state care
  errors, and no audit-ready proof of timely withdrawal.
- **Target user:** consent operations analyst (primary); care team lead; compliance officer.
- **Success measures:** revoke acknowledgements observable and within the 5s default; drift
  detected before the customer notices; SLA evidence available on demand.
- **Explicitly out of scope:** the withdrawal flow itself; the PSU banking app; bulk consent
  migration.

## Data-governance position (from `data-governance.md`, D6)

- **Residual-risk verdict:** Low — Conditional on the direction being *read-only
  observability over consent metadata* (DR-2.1 / DR-2.1-001 Critical→Low, DR-2.1-002
  High→Very Low; CTRL-DP-001/002/003).
- **Conditions delivery inherits:** no consent content beyond lifecycle state/timestamps;
  INSERT-only audit of evidence; Hub-bound reads via P6 egress; PII redaction at emission.

## Direction, made tangible (from `prototype.md`)

- **Prototype:** `prototype.md` + `wireframe.html` — a consent-lifecycle hygiene monitor.
  *Direction, not specification.*
- **Validated framing hypotheses:** timeliness made visible (H1); drift indicator (H2);
  on-demand SLA evidence (H3) — to confirm in a stakeholder review.
- **Open questions for Develop:** what timeliness window the bank tolerates beyond the 5s
  default; how drift signals route to operators.

## Gate status

| Gate | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 |
|---|---|---|---|---|---|---|---|---|
| Pass? | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## What delivery owns now

The right diamond authors the solution from scratch against the delivery contract. This brief
informs; it does not design.
