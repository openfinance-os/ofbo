import { randomUUID } from 'node:crypto'
import { fils, type ExpectedTppCostStatement, type ReconcilableDocument } from '@ofbo/billing'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { TppCostReconcileStore } from '../src/billing/tpp-cost-reconcile.js'

/**
 * BILL-15 — the HTTP route, exercised through `createApp`.
 *
 * The service is tested directly elsewhere; what only this can establish is that the route is
 * REACHABLE at the contract's path — a `:reconcile` suffix on a path parameter is exactly the shape a
 * router silently fails to match — that it is scope-gated on the way in, and that the envelope and
 * snake_case wire shape reach the client. `pnpm verify:contract` cannot cover it: it probes only
 * parameter-less GETs.
 */

const PERIOD = '2026-06'
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'

const financeHeaders = {
  'x-fapi-interaction-id': randomUUID(),
  authorization: 'Bearer demo-token:finance-analyst@alpha-bank'
}
/** Holds consents/disputes scopes, never finance:reconciliation:write. */
const careHeaders = {
  'x-fapi-interaction-id': randomUUID(),
  authorization: 'Bearer demo-token:customer-care-agent@alpha-bank'
}

function statement(): ExpectedTppCostStatement {
  return {
    period: PERIOD,
    tenantId: '11111111-1111-4111-8111-111111111111',
    currency: 'AED',
    rateCardVersion: '2026.06.02',
    evidence: {
      meterRunId: 'run-1', generatedAt: '2026-07-03T02:00:00.000Z',
      ratingRunAt: '2026-07-03T01:59:00.000Z', pricingEffectiveFrom: '2026-06-02',
      rateSnapshotHash: 'sha256:x', directorySnapshotId: null
    },
    lines: [{
      costRecipientType: 'nebras', costRecipientId: 'NEBRAS', feeStream: 'hub', feeClass: 'hub.standard',
      productFamily: 'payments', apiFamily: 'payments', customerSegment: 'unclassified',
      units: 1000, events: 1000, vatTreatment: 'exclusive',
      expectedNetMilliFils: fils(2500), vatMilliFils: fils(125), expectedGrossMilliFils: fils(2625),
      eventIds: ['evt-1'], fapiInteractionIds: ['fapi-1']
    }],
    totals: {
      nebrasHubNetMilliFils: fils(2500), underlyingLfiPaymentNetMilliFils: 0,
      underlyingLfiDataNetMilliFils: 0, totalNetMilliFils: fils(2500),
      totalVatMilliFils: fils(125), totalGrossMilliFils: fils(2625)
    }
  }
}

function overchargedDocument(): ReconcilableDocument {
  return {
    documentId: DOCUMENT_ID, documentType: 'nebras_tax_invoice', issuerId: 'NEBRAS',
    documentReference: 'NEB-1', billingPeriod: PERIOD,
    issuedAt: '2026-07-03T00:00:00.000Z', receivedAt: '2026-07-03T09:00:00.000Z',
    lines: [{
      lineRef: 'SI-1', sourceCategory: 'Payment Initiation', feeClass: 'hub.standard', mapped: true,
      costRecipientType: 'nebras', costRecipientId: 'NEBRAS', units: 1000,
      unitPriceMilliFils: fils(3), actualNetMilliFils: fils(3000),
      vatMilliFils: fils(150), actualGrossMilliFils: fils(3150)
    }]
  }
}

function appWith(overrides: Partial<TppCostReconcileStore> = {}) {
  const store: TppCostReconcileStore = {
    documentPeriod: async (id) => (id === DOCUMENT_ID ? PERIOD : null),
    reconcilableDocumentsForPeriod: async () => [overchargedDocument()],
    latestStatement: async () => ({ id: 'stmt-1', statement: statement() }),
    saveReconciliation: async () => ({ reconciliationIds: ['rec-1'], created: true }),
    ...overrides
  }
  return createApp({
    highClassAudit: new InMemoryHighClassAuditSink(),
    tppCostReconcileStore: store
  })
}

const PATH = `/back-office/billing/tpp-cost-documents/${DOCUMENT_ID}:reconcile`

describe('POST /back-office/billing/tpp-cost-documents/{document_id}:reconcile', () => {
  it('is reachable at the contract path and returns the reconciliation envelope', async () => {
    const app = appWith()
    const response = await app.request(PATH, {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() }
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    expect(body.meta).toHaveProperty('request_id')
    expect(body.data).toMatchObject({
      period: PERIOD,
      // Milli-fils is an unratified sub-minor unit, which is a reason to publish the currency beside
      // the amounts rather than to omit it — a bare integer with neither unit nor currency is what
      // would make BILL-17's conversion to Money expensive. The sibling TppCostDocument requires it.
      currency: 'AED',
      query_window_status: 'open',
      break_count: 1,
      response_clocks: { first_response_minutes: 10, final_response_days: 10, escalation_review_days: 15 }
    })
    const breaks = body.data.breaks as Array<Record<string, unknown>>
    expect(breaks[0]).toMatchObject({
      break_type: 'rate_variance', line_type: 'nebras_fees', presence: 'both',
      variance_milli_fils: fils(500)
    })
  })

  it('refuses a persona without finance:reconciliation:write', async () => {
    const app = appWith()
    const response = await app.request(PATH, {
      method: 'POST',
      headers: { ...careHeaders, 'idempotency-key': randomUUID() }
    })
    expect(response.status).toBe(403)
  })

  it('answers 404 for a document that is not this tenant\'s', async () => {
    const app = appWith()
    const response = await app.request(
      '/back-office/billing/tpp-cost-documents/44444444-4444-4444-8444-444444444444:reconcile',
      { method: 'POST', headers: { ...financeHeaders, 'idempotency-key': randomUUID() } }
    )
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string; remediation: string } }
    expect(body.error.code).toBe('BACKOFFICE.NOT_FOUND')
    // The remediation must fit THIS error. Asserting only that the field exists is what let a single
    // hardcoded string — "ingest the expected statement" — be returned for a bad document id, sending
    // the caller to fix something that was not broken.
    expect(body.error.remediation).toMatch(/document id/i)
    expect(body.error.remediation).not.toMatch(/expected cost statement/i)
  })

  it('answers 409 with the error envelope when the period has no expected statement', async () => {
    const app = appWith({ latestStatement: async () => null })
    const response = await app.request(PATH, {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() }
    })
    expect(response.status).toBe(409)
    const body = await response.json() as {
      error: { code: string; message: string; docs_url: string; remediation: string }
    }
    expect(body.error.code).toBe('BACKOFFICE.NO_EXPECTED_STATEMENT')
    expect(body.error).toHaveProperty('docs_url')
    // This is the one error the statement remediation actually fits, and it names the period.
    expect(body.error.remediation).toMatch(/expected cost statement for 2026-06/i)
  })

  it('fails closed when no reconciliation store is configured', async () => {
    // An unconfigured deployment must refuse, not report a clean period — a reconciliation over no
    // evidence would read as "nothing owed" on a payable the bank has not actually checked.
    const app = createApp({ highClassAudit: new InMemoryHighClassAuditSink() })
    const response = await app.request(PATH, {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() }
    })
    expect(response.status).toBeGreaterThanOrEqual(500)
  })
})
