# ADR 0011 — Consent-revoke SLA enforcement (queue / retry / ITSM on breach)

- Status: **Proposed** — awaiting human decision (enforce now vs defer; mechanism)
- Date: 2026-06-20
- Related: BACKOFFICE-17 (single revoke + `sla_met`), P6 egress, P3 ITSM, PRD §4.3 / NFR-18, the OF-UAE dual-role gap analysis (2026-06-20)

> Note: this is the lightest item of the dual-role set — it is closer to an
> acceptance-criteria *completion* than an architectural decision (the PRD already
> prescribes the approach). Captured as an ADR for parity with the others; it could
> equally be a backlog item. The genuine decision is **enforce now vs defer to
> enterprise**, plus the retry mechanism.

## Context

BACKOFFICE-17 revokes a consent via the P6 egress to Nebras and **records**
`nebras_propagation_ms` + `sla_met` (`< 5s`, NFR-18) in the audit — but **takes no
action on breach**. PRD §4.3's acceptance criterion is stronger: on a `> 5s` propagation
it requires **queue + retry, and a P1 ITSM ticket**. Today there is no queue, no retry,
and no ITSM escalation — the SLA is *measured, not enforced*. The CBUAE LFI live-proving
cert track demonstrates SLA *recovery*, not just measurement, so this is a real gap (and,
unlike most remaining items, **buildable now against the simulator** — the `revoke_delay`
fault already produces a breach to test against).

## Requirements & regulatory basis

- **NFR-18 / PRD §4.3.** Revoke propagation `< 5s p99`; on breach, retry + P1 ITSM.
- **Liability.** Consent-revocation failure carries AED 350; a recovery loop (retry +
  escalation) is the control that bounds it.
- **Cert.** Live-proving expects demonstrable SLA breach handling, not just a logged flag.

## Options

1. **Async retry queue + ITSM escalation on breach (recommended).** On a `> 5s` (or
   failed) propagation, enqueue a bounded retry (idempotent — reuse the Idempotency-Key
   so retries don't double-revoke), and raise a **P1 ITSM ticket via the P3 port** when
   retries are exhausted or the breach threshold is crossed. Surface the breach as a risk
   signal for the Ops/SLO console. **Pros:** matches PRD §4.3; composes P3 ITSM +
   idempotency + risk-signal primitives; the user-facing revoke still returns promptly.
   **Cons:** needs a small durable retry queue (resumable/idempotent per the demo rule).
2. **Synchronous in-request retry + ITSM, no queue.** Retry inline before responding.
   Simpler, but couples the caller to retry latency and doesn't survive process death —
   weaker for the `<5s p99` posture.
3. **Defer enforcement to the enterprise profile** (keep measure-only in demo). Honest if
   the bank treats the demo as sleep-tolerant — but the escalation is buildable now and
   the cert gate wants it; **only acceptable as an explicit, recorded deferral.**

## Recommendation

**Option 1** — an idempotent async retry queue with P3 ITSM escalation on breach, plus a
risk signal for the SLO console. It satisfies PRD §4.3 with existing primitives and is
demonstrable via the simulator's `revoke_delay` fault.

## Decision

_Pending._ Choose enforce-now (Option 1) vs explicit deferral (Option 3). If enforce:
raise a BACKOFFICE requirement (or reopen -17's acceptance), implement the retry queue +
ITSM escalation + SLO signal, tests-first (drive the breach via `revoke_delay`).

## Consequences

- Adds a bounded, idempotent retry queue + P3 ITSM escalation + a risk signal on
  revoke-SLA breach; reuses Idempotency-Key, P3, risk_signal, audit. No new
  approval/gateway/auth primitive.
- Bank decision: enforce now vs record a deferral; retry bounds + ITSM severity.
- Until built, the `<5s` revoke SLA is observed but not enforced — a cert-relevant gap.
