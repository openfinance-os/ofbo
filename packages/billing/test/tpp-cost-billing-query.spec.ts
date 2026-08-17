import { describe, expect, it } from 'vitest'
import {
  IG_BILLING_QUERY_REQUIRED_FIELDS,
  buildBillingQueryBundle,
  fils,
  type BillingQueryBundleInput
} from '../src/index.js'

/**
 * BILL-15 criterion 5 — the billing-query evidence bundle (IG v5.0 §10.11.3).
 *
 * This is the artefact that leaves the bank. It goes to Nebras through P6, so two things matter beyond
 * "it has the fields": it must be REFUSED rather than truncated when a required field is missing (a
 * half-formed query burns one of the 30 days and gets rejected), and it must carry no customer detail,
 * because §10.11.3 asks for "payment/transaction detail" and the obvious way to satisfy that is to
 * paste the payment — which would export PSU data to the scheme.
 */

function input(overrides: Partial<BillingQueryBundleInput> = {}): BillingQueryBundleInput {
  return {
    queryReference: 'QRY-2026-06-001',
    raisedAt: '2026-07-10T08:00:00.000Z',
    billingPeriod: '2026-06',
    invoiceNumber: 'NEB-INV-2026-06-0001',
    interactionId: '8f1c1d5e-6b2a-4a1e-9f3c-2b7d4e5a6c8d',
    occurredAt: '2026-07-03T00:00:00.000Z',
    lfiName: 'Adopting Bank PJSC',
    tppName: 'Adopting Bank PJSC (TPP of record)',
    transactionDetail: {
      feeClass: 'hub.standard',
      sourceCategory: 'Payment Initiation',
      units: 1000,
      expectedNetMilliFils: fils(2500),
      actualNetMilliFils: fils(3000)
    },
    breakType: 'rate_variance',
    reasonCode: 'expected 2500000, billed 3000000 milli-fils at unchanged volume',
    varianceMilliFils: fils(500),
    queryDeadline: '2026-08-02T00:00:00.000Z',
    daysRemaining: 23,
    ...overrides
  }
}

describe('BILL-15 billing-query bundle (IG v5.0 §10.11.3)', () => {
  it('carries every field the guide requires', () => {
    const bundle = buildBillingQueryBundle(input())
    for (const field of IG_BILLING_QUERY_REQUIRED_FIELDS) {
      expect(bundle[field], `§10.11.3 field ${field}`).toBeTruthy()
    }
    // The list is the control, so it must actually name the five §10.11.3 items rather than be empty.
    expect(IG_BILLING_QUERY_REQUIRED_FIELDS).toEqual(
      expect.arrayContaining(['invoiceNumber', 'interactionId', 'occurredAt', 'lfiName', 'tppName', 'transactionDetail'])
    )
  })

  it('carries the response clocks so the query states what Nebras owes and by when', () => {
    const bundle = buildBillingQueryBundle(input())
    expect(bundle.responseClocks).toMatchObject({
      firstResponseMinutes: 10, finalResponseDays: 10, escalationReviewDays: 15
    })
    expect(bundle.queryDeadline).toBe('2026-08-02T00:00:00.000Z')
  })

  it('REFUSES to build a bundle missing a required field rather than sending a partial one', () => {
    // A query rejected for incompleteness still consumes days from a window that does not reopen.
    expect(() => buildBillingQueryBundle(input({ invoiceNumber: '' })))
      .toThrow(/invoiceNumber/)
    expect(() => buildBillingQueryBundle(input({ interactionId: undefined as unknown as string })))
      .toThrow(/interactionId/)
  })

  it('REFUSES to build a bundle once the query window has closed', () => {
    // Submitting after the deadline is not a lesser outcome than not submitting: it asserts a claim we
    // no longer hold, and the bundle is the thing that would be sent.
    expect(() => buildBillingQueryBundle(input({ daysRemaining: -1 })))
      .toThrow(/window/i)
  })

  it('REFUSES customer detail in the transaction detail rather than exporting it to the scheme', () => {
    // §10.11.3 asks for payment/transaction detail and the tempting way to satisfy it is to paste the
    // payment. This bundle crosses the bank boundary, so an identifier-shaped value is refused.
    expect(() => buildBillingQueryBundle(input({
      transactionDetail: { feeClass: 'hub.standard', debtorAccount: 'AE000000000000000000000' }
    }))).toThrow(/iban/i)
    expect(() => buildBillingQueryBundle(input({
      transactionDetail: { feeClass: 'hub.standard', contact: 'someone@example.com' }
    }))).toThrow(/email/i)
  })

  it('keeps the scheme-shaped references a query is useless without', () => {
    // The refusal above must not eat the very identifiers §10.11.3 requires: an invoice number and an
    // interaction id are long opaque strings too, and a guard that ate them would make every query
    // unbuildable.
    const bundle = buildBillingQueryBundle(input())
    expect(bundle.invoiceNumber).toBe('NEB-INV-2026-06-0001')
    expect(bundle.interactionId).toBe('8f1c1d5e-6b2a-4a1e-9f3c-2b7d4e5a6c8d')
  })
})
