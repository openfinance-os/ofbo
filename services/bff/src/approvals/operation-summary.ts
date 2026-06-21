/**
 * UX-03c / ADR 0014 — compose the NON-PII `operation_summary` surfaced to the SECOND four-eyes
 * approver, from the stored (full) `operation_payload`. This is the load-bearing PII control:
 *
 *   ALLOWLIST BY DESIGN. Each known operation_type picks ONLY explicitly-named, known-safe
 *   fields. Nothing else is ever copied — not psu_identifier, not free-text (case_context,
 *   justification), not account numbers / IBANs / Emirates IDs, not internal record ids.
 *   An unknown operation_type returns null (no summary) rather than risk leaking.
 *
 * The spec's `additionalProperties: false` (ADR 0014) closes the *shape*; this closes the
 * *source*. The per-type redaction contract test asserts that PII present in the payload never
 * appears in the summary.
 */

export interface Money {
  amount: number
  currency: string
}

export interface ApprovalOperationSummary {
  amount?: Money
  counterparty_label?: string
  descriptor?: string
}

// Format-validate the few payload VALUES we echo into the descriptor. The generic POST /approvals
// route accepts an arbitrary operation_payload, so a caller could put PSU free-text in these
// fields; re-validating here (not just type+non-empty) keeps the descriptor PII-safe regardless
// of how the approval was created — defense in depth at the summary boundary.
const BULK_REVOKE_REASONS = new Set(['CLIENT_INSTRUCTION']) // the sole valid bulk-revoke reason (consents/bulk-revoke VALID_REASON_CODES)
const BILLING_PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/ // YYYY-MM only
const safeEnum = (v: unknown, allowed: Set<string>): string | undefined => (typeof v === 'string' && allowed.has(v) ? v : undefined)
const safeMatch = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v) ? v : undefined)

function safeMoney(v: unknown): Money | undefined {
  if (v && typeof v === 'object') {
    const m = v as { amount?: unknown; currency?: unknown }
    // Money is integer minor units (CLAUDE.md) — reject any non-integer so a float can never
    // slip onto the wire even if a future payload carried one.
    if (typeof m.amount === 'number' && Number.isInteger(m.amount) && typeof m.currency === 'string') {
      return { amount: m.amount, currency: m.currency }
    }
  }
  return undefined
}

export function summariseOperation(operationType: string, payload: Record<string, unknown>): ApprovalOperationSummary | null {
  switch (operationType) {
    case 'tpp.invoice_run': {
      // safe: billing_period — but only if it's a real YYYY-MM (format-validated, never raw text).
      const period = safeMatch(payload.billing_period, BILLING_PERIOD)
      return { descriptor: period ? `Invoice run · period ${period}` : 'Invoice run' }
    }
    case 'compliance.report_generation':
      // safe: nothing PSU-linked to surface; report_id is an internal id.
      return { descriptor: 'Compliance report submission' }
    case 'disputes.initiate_refund': {
      // safe: refund_amount (Money — money value, not PII). NOT: dispute_id, originating_consent_id.
      const amount = safeMoney(payload.refund_amount)
      return { ...(amount ? { amount } : {}), descriptor: 'Dispute refund' }
    }
    case 'consents.bulk_revoke': {
      // safe: reason_code — but only if it's in the controlled enum (never raw text).
      // NEVER: psu_identifier / psu_identifier_type.
      const reason = safeEnum(payload.reason_code, BULK_REVOKE_REASONS)
      return { descriptor: reason ? `Emergency PSU-wide consent revocation · ${reason}` : 'Emergency PSU-wide consent revocation' }
    }
    case 'consents.fraud_revoke':
      // NEVER: consent_id, case_context (operator free text). Label only.
      return { descriptor: 'Fraud-suspected consent revoke' }
    case 'reconciliation.break_reopen':
      // NEVER: break_id, justification (operator free text). Label only.
      return { descriptor: 'Reopen reconciliation break' }
    default:
      // Unknown operation → no summary (fail safe; never echo an unmodelled payload).
      return null
  }
}
