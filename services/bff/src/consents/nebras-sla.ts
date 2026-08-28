/**
 * The Nebras consent-revoke propagation SLA — ONE definition (NFR-18, STD-09).
 *
 * PRD NFR-18 requires a revoke to reach Nebras in under 5 seconds. That threshold used to be
 * declared three times: `consents/revoke.ts` and `consents/bulk-revoke.ts` each carried their own
 * `NEBRAS_SLA_MS = 5000`, and `analytics/slo.ts` restated it a third time in a DIFFERENT UNIT, as
 * the prose "< 5s" inside an SLO description string.
 *
 * Three copies of one regulatory threshold is three chances to change two of them. A scheme
 * amendment to 3s would leave whichever copy the editor did not grep for still enforcing 5s —
 * silently, in production, on a control the regulator asks about. And the unit difference is what
 * made it hard to catch: a grep for `5000` never finds the SLO row, which is the one an operator
 * reads when asking what the target actually is.
 *
 * Every consumer imports from here, and the SLO description is DERIVED rather than written, so the
 * number a screen displays cannot drift from the number the code enforces.
 *
 * THE CONTRACT AGREES, and a test holds it there (BACKOFFICE-91). An earlier version of this
 * docblock said the spec still carried an underived prose copy — true when written, false the
 * moment that story shipped, and left in place it would have sent the next reader to re-file work
 * already done. A comment whose whole subject is the state of the contract, drifting from the
 * contract, is this module's own defect one artifact over.
 *
 * `specs/backoffice-openapi.yaml` now carries the bound on `nebras_propagation_ms` as
 * `x-nfr18-p99-exclusive-max-ms`, and `services/bff/test/nebras-sla.spec.ts` fails if it and this
 * constant disagree — in magnitude, in comparator, or by a third unbound copy appearing in the file.
 *
 * WHAT THAT DOES NOT BUY, stated so nobody over-reads it: `openapi-typescript` drops `x-`
 * extensions and the response validator strips them, so every consumer downstream of codegen — the
 * portal client, `verify:contract`, an external SDK — still reads the bound as prose. The extension
 * buys an in-repo regression guard, not machine-readability for downstream consumers.
 *
 * The prose copies in `revoke.ts` and `bulk-revoke.ts` are narrative rather than enforcement, and
 * `services/nebras-sim/src/app.ts` states the threshold independently on purpose — it EMULATES the
 * counterparty rather than consuming the constant, and a simulator that imported the bound it is
 * meant to test against would be checking the code against itself.
 */
export const NEBRAS_SLA_MS = 5000

/** The same threshold in seconds, for anything that reports it to a human. */
export const NEBRAS_SLA_SECONDS = NEBRAS_SLA_MS / 1000
