# ADR 0009 — VRP / FRP recurring-mandate lifecycle oversight

- Status: **Proposed** — awaiting human decision (consent-model extension)
- Date: 2026-06-20
- Related: BACKOFFICE-16/-17/-19/-61 (consent admin), -36/-37 (liability + anomaly), worker monitors; the OF-UAE dual-role gap analysis (2026-06-20)

## Context

Variable Recurring Payments (VRP) and Future-dated Recurring Payments (FRP) arrive in
R2. Unlike a single-use or generic long-lived consent, a VRP/FRP **mandate carries
control parameters** — per-payment and per-period **amount caps**, a period/frequency,
a validity window, and a running total — and the LFI must enforce them on every
sweep/execution. The bank touches these in **both roles** (honouring VRP mandates on its
accounts as LFI; holding VRP mandates against other LFIs as TPP).

OFBO's consent model (BACKOFFICE-16/-19/-61) is **generic** — it surfaces consent
identity, scope, 7-state status and multi-auth, but **does not model VRP/FRP mandate
parameters**, and there is **no limit-breach detection** or sweeping oversight. So the
back office cannot answer "is this recurring mandate within its caps?" or alert when a
sweep would breach the cap — a control with direct unauthorised-payment liability.

Per CLAUDE.md rule 6 this is an uncovered modelling/control decision → humans-decide ADR.

## Requirements & regulatory basis

- **Scheme (R2).** VRP/FRP mandates have mandatory caps/period semantics the LFI must
  enforce; the back office must be able to oversee and reconcile them.
- **Liability.** A payment beyond the mandate cap is an unauthorised payment (consumer
  protection AED 1,000; SCA/auth AED 500); cap-breach detection is the control.
- **Auditability.** Mandate parameters + breach events need the same High-class audit +
  lineage as other consent operations.

## Options

1. **Extend the consent model with VRP/FRP mandate parameters + a limit-breach monitor (recommended).**
   Add a mandate sub-type (caps, period, window, running total) to the consent admin
   view, and a headless **limit-breach monitor** (reuse the worker monitor pattern +
   risk_signal emission, like -36/-37) that flags mandates approaching/exceeding caps.
   **Pros:** composes the consent admin + risk-signal + monitor primitives. **Cons:**
   needs the mandate-parameter feed and a running-total source.
2. **Read-only mandate visibility** (show caps, no breach monitoring). Lighter; no control.
3. **Defer to the runtime payment engine.** Rejected — the engine enforces per-payment,
   but cross-payment *oversight, trend, and reconciliation of cap usage* is a back-office
   function.

## Recommendation

**Option 1** — model VRP/FRP mandates in consent admin and run a cap-breach monitor
emitting risk signals, reusing existing primitives.

## Decision

_Pending._ Once chosen: define the mandate-parameter + running-total feed, raise a
BACKOFFICE requirement + PRD addition, implement the model extension + breach monitor +
audit, tests-first.

## Consequences

- Extends consent admin (-16/-19/-61) + adds a worker monitor + risk_signal type; reuses
  audit + lineage. No new approval/gateway/auth primitive.
- Bank decision: the mandate-parameter / running-total data source.
- Until built, recurring-mandate cap oversight is absent — a liability-relevant gap.
