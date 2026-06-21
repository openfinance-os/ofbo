import { describe, expect, it } from 'vitest'
import { summariseOperation } from '../src/approvals/operation-summary.js'

/**
 * UX-03c / ADR 0014 — the load-bearing PII-redaction contract for the four-eyes approval
 * surface. For EVERY gated operation type, we feed a payload deliberately stuffed with PSU PII
 * + free text + internal ids, and assert NONE of it appears in the composed operation_summary.
 * The allowlist (summariseOperation) is what keeps the second-approver surface PII-free.
 */

// Sentinels that must NEVER appear in any summary. Synthetic — Emirates-ID uses the 999 test
// prefix and the IBAN uses bank code 000, per the CLAUDE.md no-PII hard stop.
const PII = {
  psuId: 'cust-LEAK-9001',
  emiratesId: '999-1990-7654321-0',
  iban: 'AE070001234567890123456',
  caseContext: 'PSU complained their account was drained',
  justification: 'reopened after the customer called about a missing payment',
  consentId: 'consent-LEAK',
  disputeId: 'dispute-LEAK',
  breakId: 'break-LEAK',
  invoiceRunId: 'run-LEAK',
  reportId: 'report-LEAK',
  originatingConsentId: 'oc-LEAK',
  initiatedBy: 'demo:operator-LEAK'
}
const ALL_PII = Object.values(PII)

function assertNoPii(summary: unknown) {
  const json = JSON.stringify(summary ?? {})
  for (const leak of ALL_PII) {
    expect(json, `summary must not contain "${leak}"`).not.toContain(leak)
  }
}

// Per-type payloads built to MIRROR the real BFF create-calls, plus injected PII.
const PAYLOADS: Record<string, Record<string, unknown>> = {
  'tpp.invoice_run': { invoice_run_id: PII.invoiceRunId, billing_period: '2026-05', initiated_by: PII.initiatedBy, trace_id: 't' },
  'compliance.report_generation': { report_id: PII.reportId, trace_id: 't' },
  'disputes.initiate_refund': { dispute_id: PII.disputeId, refund_amount: { amount: 145000, currency: 'AED' }, originating_consent_id: PII.originatingConsentId, initiated_by: PII.initiatedBy },
  'consents.bulk_revoke': { psu_identifier_type: 'bank_customer_id', psu_identifier: PII.psuId, reason_code: 'CLIENT_INSTRUCTION', initiated_by: PII.initiatedBy, emirates_id: PII.emiratesId, iban: PII.iban },
  'consents.fraud_revoke': { consent_id: PII.consentId, case_context: PII.caseContext, initiated_by: PII.initiatedBy },
  'reconciliation.break_reopen': { break_id: PII.breakId, justification: PII.justification, initiated_by: PII.initiatedBy }
}

describe('summariseOperation — per-type PII redaction (ADR 0014)', () => {
  for (const [type, payload] of Object.entries(PAYLOADS)) {
    it(`${type}: surfaces a non-PII summary and leaks none of the payload PII`, () => {
      const summary = summariseOperation(type, payload)
      expect(summary, `${type} should produce a summary`).not.toBeNull()
      expect(summary?.descriptor, `${type} should carry a descriptor`).toBeTruthy()
      assertNoPii(summary)
    })
  }

  it('surfaces the refund amount (Money) — a non-PII money value is allowed', () => {
    const s = summariseOperation('disputes.initiate_refund', PAYLOADS['disputes.initiate_refund']!)
    expect(s?.amount).toEqual({ amount: 145000, currency: 'AED' })
  })

  it('surfaces the billing period (a month) but not the run id', () => {
    const s = summariseOperation('tpp.invoice_run', PAYLOADS['tpp.invoice_run']!)
    expect(s?.descriptor).toContain('2026-05')
    expect(JSON.stringify(s)).not.toContain(PII.invoiceRunId)
  })

  it('surfaces the bulk-revoke reason enum but NEVER the psu_identifier', () => {
    const s = summariseOperation('consents.bulk_revoke', PAYLOADS['consents.bulk_revoke']!)
    expect(s?.descriptor).toContain('CLIENT_INSTRUCTION')
    assertNoPii(s)
  })

  it('returns null (no summary) for an unknown/unmodelled operation type — fail safe', () => {
    expect(summariseOperation('some.future_operation', { psu_identifier: PII.psuId, secret: PII.iban })).toBeNull()
  })

  // Hardening (security review): the generic POST /approvals route accepts an arbitrary payload,
  // so the echoed values (reason_code, billing_period) must be FORMAT-validated at the summary
  // boundary — not just type-checked — or a caller could smuggle PSU free-text onto the four-eyes surface.
  it('DROPS a bulk-revoke reason_code that is not the controlled enum (no free-text echo)', () => {
    const s = summariseOperation('consents.bulk_revoke', { psu_identifier: PII.psuId, reason_code: 'PSU Jane Doe asked, IBAN AE000...' })
    expect(s?.descriptor).toBe('Emergency PSU-wide consent revocation')
    expect(s?.descriptor).not.toContain('Jane')
    assertNoPii(s)
  })

  it('DROPS a malformed billing_period (only a real YYYY-MM is echoed)', () => {
    const junk = summariseOperation('tpp.invoice_run', { billing_period: 'PSU 999-1990-7654321-0 special run' })
    expect(junk?.descriptor).toBe('Invoice run')
    const valid = summariseOperation('tpp.invoice_run', { billing_period: '2026-05' })
    expect(valid?.descriptor).toBe('Invoice run · period 2026-05')
    // also reject an out-of-range month
    expect(summariseOperation('tpp.invoice_run', { billing_period: '2026-13' })?.descriptor).toBe('Invoice run')
  })
})
