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
 */
export const NEBRAS_SLA_MS = 5000

/** The same threshold in seconds, for anything that reports it to a human. */
export const NEBRAS_SLA_SECONDS = NEBRAS_SLA_MS / 1000
