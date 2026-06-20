# ADR 0008 — Confirmation of Payee (CoP) operational oversight

- Status: **Proposed** — awaiting human decision (new back-office surface)
- Date: 2026-06-20
- Related: BACKOFFICE-37 (consent-pattern anomaly), -38 (TPP behavioural), disputes (E2), the OF-UAE dual-role gap analysis (2026-06-20)

## Context

Confirmation of Payee (CoP) is **mandatory before payments** in UAE Open Finance (R1):
the payer's name is checked against the payee account, returning match / close-match /
no-match, with the name object (`fullName` mandatory for personal accounts). It is a
primary **APP-fraud** control.

The bank touches CoP in **both roles** — as an LFI *responding* to CoP queries on its
accounts, and as a TPP *issuing* CoP before initiating a payment. CoP itself is a
runtime API (not OFBO's job), but the **operational oversight** of it is: OFBO has **no
CoP surface at all** — no match-rate monitoring, no close-match / no-match exception
queue, no name-matching configuration oversight, and no linkage from a CoP mismatch to a
downstream fraud/dispute case. A regulator reviewing APP-fraud controls expects this
operational layer.

Per CLAUDE.md rule 6 this is a genuinely uncovered operational capability → humans-decide ADR.

## Requirements & regulatory basis

- **APP-fraud / consumer protection (CBUAE).** CoP outcomes are the front line against
  misdirected/authorised-push-payment fraud; the bank must monitor and act on them.
- **Name-object correctness.** `fullName` mandatory for personal accounts; mismatch
  patterns and config drift need oversight.
- **Liability.** CoP-mismatch-then-proceed feeds the dispute/liability chain (consumer
  protection AED 1,000; ties to the Risk Information Block).

## Options

1. **CoP operations view + mismatch exception queue (recommended).** An analytics view
   of match / close-match / no-match rates (per channel, both roles) reusing the
   existing free-form AnalyticsView + freshness pattern, plus a mismatch **exception
   queue** that can escalate to a dispute/fraud case (reuse E2 dispute + -37/-38 signals).
   **Pros:** composes existing analytics/dispute primitives; gives the fraud team the
   operational lens. **Cons:** needs a CoP outcome feed (from the API platform via a
   port) and a name-object classification.
2. **Metrics-only dashboard** (rates, no exception workflow). Lighter; no actioning.
3. **Out of scope** — handle entirely at the runtime API layer. Rejected: the *oversight*
   (trends, exceptions, fraud linkage) is a back-office function, not a per-call concern.

## Recommendation

**Option 1.** Surface CoP outcomes as an analytics view and route mismatches through an
exception queue into the existing dispute/fraud machinery — the back-office control the
fraud team needs, built from primitives OFBO already has. Requires a CoP outcome feed
(new read port or an extension of an existing ingestion path).

## Decision

_Pending._ Once chosen: define the CoP outcome feed/port, raise a BACKOFFICE requirement
+ PRD addition, implement the view + exception queue + fraud-case linkage, tests-first.

## Consequences

- New CoP outcome ingestion (port) + an analytics view + exception workflow; reuses
  AnalyticsView, freshness (-40), dispute (E2), and risk signals (-37/-38).
- No new approval/gateway/auth primitive. Bank decision: the CoP outcome data source.
- Until built, CoP fraud-control oversight is absent from the back office.
