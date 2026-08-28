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
 * `x-nfr18-exclusive-max-ms`, and `services/bff/test/nebras-sla.spec.ts` fails if it and this
 * constant disagree — in magnitude, in comparator, by a third unbound copy, or by a STALE one: a
 * previous bound left in the prose when the constant moves. That last check was missing, and its
 * absence was the whole defect one artifact over. Every other assertion is parameterised on the
 * current value, so each asks "is the new number here?" and none asked "is any other number here?" —
 * which let the published contract keep telling integrators the old bound while the services
 * enforced the new one.
 *
 * All of it is scoped to that field's own schema NODE, not the file: scanning all 3,900 lines for
 * the bare number made it fire on any unrelated `5000` (a rate limit, a `maxLength`, money in minor
 * units where 5000 is AED 50.00) and accuse its author of NFR-18 drift.
 *
 * WHAT THAT DOES NOT BUY, stated so nobody over-reads it: `openapi-typescript` drops `x-`
 * extensions and the response validator strips them, so every consumer downstream of codegen — the
 * portal client, `verify:contract`, an external SDK — still reads the bound as prose. The extension
 * buys an in-repo regression guard, not machine-readability for downstream consumers. Whether this
 * mechanism should become a convention is raised in ADR 0034 and is not settled here.
 *
 * The prose copies in `revoke.ts` and `bulk-revoke.ts` are narrative rather than enforcement. The
 * simulator is deliberately NOT wired to this constant — a simulator that imported the bound it is
 * meant to test against would be checking the code against itself. Stated precisely, because an
 * earlier version of this line said `services/nebras-sim/src/app.ts` "states the threshold
 * independently on purpose", which overstates what is there: the sim has no numeric threshold and
 * no comparator anywhere in its source, only the prose "<5s revoke ack" in a file-header comment.
 * The reasoning is sound; the claim about the file was not, in the docblock of the module whose
 * subject is claims about other files drifting.
 */
export const NEBRAS_SLA_MS = 5000

/** The same threshold in seconds, for anything that reports it to a human. */
export const NEBRAS_SLA_SECONDS = NEBRAS_SLA_MS / 1000
