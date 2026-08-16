import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalJson, rateCardForTenant, SCHEME_RATE_CARD_2026_06_02, type FeeScenario, type ProfitabilityAmounts } from '@ofbo/billing'
import { getAdapter } from '@ofbo/ports'
import { buildResponseValidator } from '@ofbo/contracts/testing'
import { mintScopes, type Principal } from '../src/auth.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  BillingConsoleError,
  BillingConsoleService,
  type BillingConsoleProfitabilityPort,
  type BillingConsoleTenantPort
} from '../src/billing/console.js'
import { TenantNotProvisionedError } from '../src/billing/tenant-service.js'
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

function digestDelivered(data: Record<string, unknown>): string {
  const body = { ...data }
  delete body.sha256
  return `sha256:${createHash('sha256').update(canonicalJson(body)).digest('hex')}`
}

async function suppressExpectedServerError<T>(operation: () => T | Promise<T>): Promise<T> {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    return await operation()
  } finally {
    errorLog.mockRestore()
  }
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
      tables: {
        billing_event: [{
          bank_id: BANK_ID,
          event_payload: {
            AED: 125,
            GLCode: 'GL-100',
            cloudEventExtension: { TPPCode: 'TPP-A' }
          }
        }]
      },
      sha256: 'sha256:portable'
    }))
  } satisfies BillingConsoleTenantPort
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
  } satisfies BillingConsoleProfitabilityPort
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

function routeHarness(overrides: {
  tenant?: BillingConsoleTenantPort
  profitability?: BillingConsoleProfitabilityPort
} = {}) {
  const base = harness()
  const tenant = overrides.tenant ?? base.tenant
  const profitability = overrides.profitability ?? base.profitability
  return {
    app: createApp({
      idp: getAdapter('p2-identity-provider', 'demo'),
      billingTenant: tenant,
      billingProfitability: profitability,
      highClassAudit: base.audit
    }),
    audit: base.audit,
    tenant,
    profitability
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
      bankId: BANK_ID,
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

    const simulationRequest = {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ period: '2026-07', scenario: scenarioWire })
    }
    const simulation = await app.request('/back-office/billing/profitability:simulate', simulationRequest)
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
    const response = await app.request('/back-office/billing/exports:cbuae-fee-review', withKey)
    expect(response.status).toBe(200)
    const artifact = (await response.json() as { data: Record<string, unknown> }).data
    expect(artifact.sha256).toBe(digestDelivered(artifact))
    expect((await app.request('/back-office/billing/exports:cbuae-fee-review', withKey)).status).toBe(200)
    expect(audit.events.filter((event) => event.event_type === 'billing_cbuae_fee_review_requested')).toHaveLength(1)
  })

  it('ships a verifiable portability export without rewriting opaque jsonb keys', async () => {
    const { app } = routeHarness()
    const response = await app.request('/back-office/billing/export', { headers: financeHeaders })

    expect(response.status).toBe(200)
    const artifact = (await response.json() as { data: Record<string, unknown> }).data
    expect(artifact.sha256).toBe(digestDelivered(artifact))
    expect(artifact).toMatchObject({
      schema_version: 'ofbo.billing-export.v1',
      bank_id: BANK_ID,
      tables: {
        billing_event: [{
          event_payload: {
            AED: 125,
            GLCode: 'GL-100',
            cloudEventExtension: { TPPCode: 'TPP-A' }
          }
        }]
      }
    })
  })

  it('does not replay a regulator artifact when the same key is reused with a different body', async () => {
    const base = harness()
    const { app } = routeHarness({ tenant: base.tenant, profitability: base.profitability })
    const send = (proposedRate: number) => app.request('/back-office/billing/exports:cbuae-fee-review', {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json', 'idempotency-key': 'annual-review-reused' },
      body: JSON.stringify({
        period: '2026-07',
        scenarios: [{
          ...scenarioWire,
          retail_overage: { ...scenarioWire.retail_overage, proposed_rate_milli_fils: proposedRate }
        }]
      })
    })

    expect((await send(950_000)).status).toBe(200)
    expect((await send(975_000)).status).toBe(200)
    expect(base.profitability.cbuaeAnnualReviewExport).toHaveBeenCalledTimes(2)
  })

  it('enforces the declared maximum of 20 regulator scenarios', async () => {
    const base = harness()
    const { app } = routeHarness({ tenant: base.tenant, profitability: base.profitability })
    const response = await app.request('/back-office/billing/exports:cbuae-fee-review', {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json', 'idempotency-key': 'too-many' },
      body: JSON.stringify({
        period: '2026-07',
        scenarios: Array.from({ length: 21 }, (_, index) => ({ ...scenarioWire, scenario_id: `scenario-${index}` }))
      })
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'BACKOFFICE.INVALID_BODY' } })
    expect(base.profitability.cbuaeAnnualReviewExport).not.toHaveBeenCalled()
  })

  it('keeps JSON parse failures at 400 and lets simulation service failures surface as 500', async () => {
    const malformed = await routeHarness().app.request('/back-office/billing/profitability:simulate', {
      method: 'POST',
      headers: { ...financeHeaders, 'content-type': 'application/json' },
      body: '{'
    })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: 'BACKOFFICE.INVALID_BODY' } })

    const base = harness()
    const failing = {
      ...base.profitability,
      simulate: vi.fn(async () => { throw new Error('database connection failed') })
    } satisfies BillingConsoleProfitabilityPort
    const failed = await suppressExpectedServerError(() =>
      routeHarness({ tenant: base.tenant, profitability: failing }).app.request(
        '/back-office/billing/profitability:simulate', {
        method: 'POST',
        headers: { ...financeHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ period: '2026-07', scenario: scenarioWire })
        }
      )
    )
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('BACKOFFICE.INVALID_BODY')
  })

  it('distinguishes an unprovisioned tenant from an internal profile-store failure', async () => {
    const base = harness()
    const unprovisioned = {
      ...base.tenant,
      profile: vi.fn(async () => { throw new TenantNotProvisionedError(BANK_ID) })
    } satisfies BillingConsoleTenantPort
    const missing = await routeHarness({ tenant: unprovisioned }).app.request(
      '/back-office/billing/console?period=2026-07',
      { headers: financeHeaders }
    )
    expect(missing.status).toBe(503)
    const missingBody = await missing.text()
    expect(missingBody).toContain('BACKOFFICE.BILLING_TENANT_NOT_PROVISIONED')
    expect(missingBody).not.toContain(BANK_ID)

    const broken = {
      ...base.tenant,
      profile: vi.fn(async () => { throw new Error('postgres password=internal-secret') })
    } satisfies BillingConsoleTenantPort
    const failed = await suppressExpectedServerError(() =>
      routeHarness({ tenant: broken }).app.request(
        '/back-office/billing/console?period=2026-07',
        { headers: financeHeaders }
      )
    )
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('internal-secret')
  })

  it('rejects invalid periods and personas without billing scope', async () => {
    const { app } = routeHarness()
    const invalidPeriod = await app.request('/back-office/billing/console?period=2026-13', { headers: financeHeaders })
    expect(invalidPeriod.status).toBe(400)
    await expect(invalidPeriod.json()).resolves.toMatchObject({ error: { code: 'BACKOFFICE.INVALID_PERIOD' } })

    const deniedHeaders = {
      ...FAPI_HEADERS,
      authorization: 'Bearer demo-token:compliance-officer@alpha-bank'
    }
    for (const request of [
      app.request('/back-office/billing/console', { headers: deniedHeaders }),
      app.request('/back-office/billing/export', { headers: deniedHeaders }),
      app.request('/back-office/billing/profitability:simulate', {
        method: 'POST',
        headers: { ...deniedHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ period: '2026-07', scenario: scenarioWire })
      }),
      app.request('/back-office/billing/exports:cbuae-fee-review', {
        method: 'POST',
        headers: { ...deniedHeaders, 'content-type': 'application/json', 'idempotency-key': 'denied' },
        body: JSON.stringify({ period: '2026-07', scenarios: [scenarioWire] })
      })
    ]) {
      const response = await request
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'BACKOFFICE.SCOPE_DENIED' } })
    }
  })
})
