import { describe, expect, it, vi } from 'vitest'
import { rateCardForTenant, SCHEME_RATE_CARD_2026_06_02, type FeeScenario, type ProfitabilityAmounts } from '@ofbo/billing'
import { getAdapter } from '@ofbo/ports'
import { buildResponseValidator } from '@ofbo/contracts/testing'
import { mintScopes, type Principal } from '../src/auth.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { BillingConsoleError, BillingConsoleService } from '../src/billing/console.js'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

const BANK_ID = '11111111-1111-4111-8111-111111111111'
const FINANCE: Principal = {
  subject: 'demo:finance-analyst',
  persona: 'finance-analyst',
  scopes: mintScopes('finance-analyst'),
  bankId: BANK_ID
}

const scenario: FeeScenario = {
  scenarioId: 'overage-rate-1',
  effectiveDate: '2026-10-01',
  receivableMultiplierBasisPoints: 10_500,
  retailOverage: { overageUnits: 10, currentRateMilliFils: 0, proposedRateMilliFils: 950_000 }
}
const scenarioWire = {
  scenario_id: scenario.scenarioId,
  effective_date: scenario.effectiveDate,
  receivable_multiplier_basis_points: scenario.receivableMultiplierBasisPoints,
  retail_overage: {
    overage_units: scenario.retailOverage.overageUnits,
    current_rate_milli_fils: scenario.retailOverage.currentRateMilliFils,
    proposed_rate_milli_fils: scenario.retailOverage.proposedRateMilliFils
  }
}
const zeroAmounts: ProfitabilityAmounts = {
  receivableMilliFils: 0,
  hubCostMilliFils: 0,
  liabilityProvisionMilliFils: 0,
  tppAasMarginMilliFils: 0,
  profitMilliFils: 0
}
const scenarioResult = {
  scenarioId: scenario.scenarioId,
  effectiveDate: scenario.effectiveDate,
  baseline: zeroAmounts,
  projected: zeroAmounts,
  deltaProfitMilliFils: 0,
  overage: { units: 10, silentDefaultRevenueMilliFils: 0, proposedRevenueMilliFils: 9_500_000, incrementalRevenueMilliFils: 9_500_000 }
}
const profitabilityReport = {
  period: '2026-07',
  currency: 'AED' as const,
  totals: zeroAmounts,
  byTpp: [],
  byProductFamily: [],
  reconciliation: { balanced: true, deltaMilliFils: 0 }
}

function harness() {
  const tenant = {
    profile: vi.fn(async () => ({
      bankId: BANK_ID,
      rateCard: rateCardForTenant(SCHEME_RATE_CARD_2026_06_02, { tenantId: BANK_ID, yearAnchorDate: '2025-10-01', retailOverageMilliFils: 0 }),
      invoice: { templateRef: 'pint-ae:default:v1', brandKey: 'demo' },
      aspRouteProfile: 'default',
      collectionRailPolicy: { preferred: 'scheme_net_settlement' as const, fallback: 'uaedds' as const }
    })),
    portableExport: vi.fn(async () => ({
      schemaVersion: 'ofbo.billing-export.v1' as const,
      bankId: BANK_ID,
      generatedAt: '2026-08-13T12:00:00.000Z',
      recordCounts: { billing_event: 3 },
      tables: { billing_event: [] },
      sha256: 'sha256:portable'
    }))
  }
  const profitability = {
    latestReport: vi.fn(async () => null),
    simulate: vi.fn(async () => scenarioResult),
    cbuaeAnnualReviewExport: vi.fn(async () => ({
      schemaVersion: 'ofbo.cbuae-fee-review.v1' as const,
      period: '2026-07',
      generatedAt: '2026-08-13T12:00:00.000Z',
      currency: 'AED' as const,
      profitability: profitabilityReport,
      scenarios: [scenarioResult],
      sha256: 'sha256:review'
    }))
  }
  const audit = new InMemoryHighClassAuditSink()
  const service = new BillingConsoleService({
    tenant,
    collections: { collectionSummary: vi.fn(async () => ({
      openInvoiceCount: 0,
      openMilliFils: 0,
      settlementBreakCount: 0,
      settlementExpectedNetMilliFils: 0,
      settlementReceivedMilliFils: 0,
      settlementResidueMilliFils: 0,
      dunningByState: {},
      dsoByTpp: []
    })) },
    accounting: { accountingClosePack: vi.fn(async () => null) },
    assurance: { latestReport: vi.fn(async () => null) },
    profitability,
    audit,
    now: () => new Date('2026-08-13T12:00:00.000Z')
  })
  return { service, tenant, profitability, audit }
}

function routeHarness() {
  const { tenant, profitability, audit } = harness()
  return {
    app: createApp({
      idp: getAdapter('p2-identity-provider', 'demo'),
      billingTenant: tenant as never,
      billingProfitability: profitability as never,
      highClassAudit: audit
    }),
    audit
  }
}

const financeHeaders = {
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:finance-analyst@alpha-bank'
}

describe('BILL production billing console', () => {
  it('composes a tenant-scoped read model and keeps insurance explicitly deferred', async () => {
    const { service, tenant } = harness()
    const result = await service.overview(FINANCE, '2026-07')

    expect(tenant.profile).toHaveBeenCalledWith(BANK_ID, SCHEME_RATE_CARD_2026_06_02)
    expect(result.data).toMatchObject({
      bank_id: BANK_ID,
      period: '2026-07',
      insurance: { status: 'deferred', dependency: 'approved insurance commercial model' }
    })
    expect(result.freshness.stale).toBe(false)
  })

  it('rejects reads without the verified tenant claim', async () => {
    const { service } = harness()
    await expect(service.overview({ ...FINANCE, bankId: undefined }, '2026-07')).rejects.toMatchObject({
      code: 'BACKOFFICE.BILLING_TENANT_REQUIRED',
      status: 403
    } satisfies Partial<BillingConsoleError>)
  })

  it('runs profitability scenarios without an idempotency write', async () => {
    const { service, profitability } = harness()
    const result = await service.simulate(FINANCE, { period: '2026-07', scenario })
    expect(result).toMatchObject({ scenarioId: 'overage-rate-1' })
    expect(profitability.simulate).toHaveBeenCalledWith('2026-07', scenario)
  })

  it('attributes tenant portability and CBUAE exports to the requesting principal', async () => {
    const { service, tenant, profitability, audit } = harness()
    await service.portableExport(FINANCE, 'trace-portable')
    await service.cbuaeFeeReviewExport(FINANCE, { period: '2026-07', scenarios: [scenario] }, 'trace-cbuae')

    expect(tenant.portableExport).toHaveBeenCalledWith(BANK_ID, '2026-08-13T12:00:00.000Z')
    expect(profitability.cbuaeAnnualReviewExport).toHaveBeenCalledWith('2026-07', [scenario], 'trace-cbuae')
    expect(audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'billing_tenant_exported', acting_principal: FINANCE.subject, request_trace_id: 'trace-portable' }),
      expect.objectContaining({ event_type: 'billing_cbuae_fee_review_requested', acting_principal: FINANCE.subject, request_trace_id: 'trace-cbuae' })
    ]))
  })

  it('serves the OpenAPI console and pure simulation routes', async () => {
    const { app } = routeHarness()
    const consoleResponse = await app.request('/back-office/billing/console?period=2026-07', { headers: financeHeaders })
    expect(consoleResponse.status).toBe(200)
    const consoleBody = await consoleResponse.json()
    expect(consoleBody).toMatchObject({ data: { bank_id: BANK_ID, period: '2026-07' } })
    expect(buildResponseValidator().validate('get', '/back-office/billing/console', 200, consoleBody)).toMatchObject({ ok: true })

    const simulation = await app.request('/back-office/billing/profitability:simulate', {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ period: '2026-07', scenario: scenarioWire })
    })
    expect(simulation.status).toBe(200)
    await expect(simulation.json()).resolves.toMatchObject({ data: { scenario_id: scenario.scenarioId } })
  })

  it('requires a verified tenant and idempotency for the audited regulator export', async () => {
    const { app, audit } = routeHarness()
    const noTenant = await app.request('/back-office/billing/console', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(noTenant.status).toBe(403)

    const request = {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ period: '2026-07', scenarios: [scenarioWire] })
    }
    expect((await app.request('/back-office/billing/exports:cbuae-fee-review', request)).status).toBe(400)

    const withKey = { ...request, headers: { ...request.headers, 'idempotency-key': 'annual-review-1' } }
    expect((await app.request('/back-office/billing/exports:cbuae-fee-review', withKey)).status).toBe(200)
    expect((await app.request('/back-office/billing/exports:cbuae-fee-review', withKey)).status).toBe(200)
    expect(audit.events.filter((event) => event.event_type === 'billing_cbuae_fee_review_requested')).toHaveLength(1)
  })
})
