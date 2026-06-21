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

const safeStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

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
      // safe: billing_period (a YYYY-MM month). NOT: invoice_run_id, initiated_by, trace_id.
      const period = safeStr(payload.billing_period)
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
      // safe: reason_code (a controlled enum). NEVER: psu_identifier / psu_identifier_type.
      const reason = safeStr(payload.reason_code)
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
