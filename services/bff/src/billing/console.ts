import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  SCHEME_RATE_CARD_2026_06_02,
  canonicalJson,
  type AccountingClosePack,
  type FeeScenario,
  type FeeScenarioResult,
  type ProfitabilityReport,
  type RevenueAssuranceReport
} from '@ofbo/billing'
import type { TenantPortableBillingExport } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { liveFreshness, type FreshnessEnvelope } from '../analytics/freshness.js'
import { missingIdempotencyKey, replayCached, type IdempotencyStore } from '../idempotency.js'
import type { CollectionsFinanceSummary } from './collections.js'
import type { CbuaeFeeReviewExport } from './profitability.js'
import { TenantNotProvisionedError, type TenantBillingProfile } from './tenant-service.js'
import {
  billingConsoleOverviewWire,
  cbuaeFeeReviewWire,
  cbuaeFeeReviewWireBody,
  feeScenarioResultWire,
  portableBillingExportWire,
  portableBillingExportWireBody,
  type BillingConsoleOverview
} from './wire.js'

export const BILLING_CONSOLE_SCOPE = 'billing:read'
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export interface BillingConsoleTenantPort {
  profile(bankId: string, baseRateCard: typeof SCHEME_RATE_CARD_2026_06_02): Promise<TenantBillingProfile>
  portableExport(bankId: string, generatedAt?: string): Promise<TenantPortableBillingExport>
}

export interface BillingConsoleProfitabilityPort {
  latestReport(period: string): Promise<ProfitabilityReport | null>
  simulate(period: string, scenario: FeeScenario): Promise<FeeScenarioResult>
  cbuaeAnnualReviewExport(period: string, scenarios: readonly FeeScenario[], traceId: string): Promise<CbuaeFeeReviewExport>
}

export interface BillingConsoleDeps {
  tenant: BillingConsoleTenantPort
  collections?: { collectionSummary(period: string, asOf: string): Promise<CollectionsFinanceSummary> }
  accounting?: { accountingClosePack(period: string): Promise<AccountingClosePack | null> }
  assurance?: { latestReport(period: string): Promise<RevenueAssuranceReport | null> }
  profitability?: BillingConsoleProfitabilityPort
  audit: HighClassAuditSink
  now?: () => Date
}

export class BillingConsoleError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

function periodOrThrow(period: string): string {
  if (!PERIOD.test(period)) throw new BillingConsoleError('BACKOFFICE.INVALID_PERIOD', 'period must be a calendar month YYYY-MM.', 400)
  return period
}

function tenantId(principal: Principal): string {
  if (!principal.bankId) {
    throw new BillingConsoleError(
      'BACKOFFICE.BILLING_TENANT_REQUIRED',
      'A verified bank tenant claim is required for billing access.',
      403
    )
  }
  return principal.bankId
}

function requireProfitability(port: BillingConsoleProfitabilityPort | undefined): BillingConsoleProfitabilityPort {
  if (!port) throw new BillingConsoleError('BACKOFFICE.BILLING_DATA_UNAVAILABLE', 'Profitability evidence is not configured.', 503)
  return port
}

/**
 * Internal LFI billing facade. Scheduled jobs own every fact mutation; this service
 * only composes tenant-scoped reads and pure/reporting actions for the console.
 */
export class BillingConsoleService {
  private readonly now: () => Date

  constructor(private readonly deps: BillingConsoleDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async overview(principal: Principal, period = this.now().toISOString().slice(0, 7)): Promise<{
    data: BillingConsoleOverview
    freshness: FreshnessEnvelope
  }> {
    assertScope(principal, BILLING_CONSOLE_SCOPE)
    const bankId = tenantId(principal)
    const p = periodOrThrow(period)
    const now = this.now()

    let profile: TenantBillingProfile
    try {
      profile = await this.deps.tenant.profile(bankId, SCHEME_RATE_CARD_2026_06_02)
    } catch (error) {
      if (error instanceof TenantNotProvisionedError) {
        throw new BillingConsoleError(
          'BACKOFFICE.BILLING_TENANT_NOT_PROVISIONED',
          'The verified tenant is not provisioned for billing.',
          503
        )
      }
      throw error
    }

    const [collections, accounting, assurance, profitability] = await Promise.all([
      this.deps.collections?.collectionSummary(p, now.toISOString().slice(0, 10)) ?? Promise.resolve(null),
      this.deps.accounting?.accountingClosePack(p) ?? Promise.resolve(null),
      this.deps.assurance?.latestReport(p) ?? Promise.resolve(null),
      this.deps.profitability?.latestReport(p) ?? Promise.resolve(null)
    ])

    return {
      data: {
        bankId,
        period: p,
        profile,
        collections,
        accountingClosePack: accounting,
        revenueAssurance: assurance,
        profitability,
        insurance: {
          status: 'deferred',
          dependency: 'approved insurance commercial model',
          story: 'BILL-06'
        }
      },
      freshness: liveFreshness(now)
    }
  }

  async simulate(principal: Principal, input: { period: string; scenario: FeeScenario }): Promise<FeeScenarioResult> {
    assertScope(principal, BILLING_CONSOLE_SCOPE)
    tenantId(principal)
    return requireProfitability(this.deps.profitability).simulate(periodOrThrow(input.period), input.scenario)
  }

  async portableExport(principal: Principal, traceId: string): Promise<TenantPortableBillingExport> {
    assertScope(principal, BILLING_CONSOLE_SCOPE)
    const bankId = tenantId(principal)
    const generatedAt = this.now().toISOString()
    const result = await this.deps.tenant.portableExport(bankId, generatedAt)
    const normalized = { ...result, sha256: digest(portableBillingExportWireBody(result)) }
    await this.deps.audit.emit({
      event_type: 'billing_tenant_exported',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: BILLING_CONSOLE_SCOPE,
      request_trace_id: traceId,
      request_body: { bank_id: bankId, sha256: normalized.sha256, record_counts: normalized.recordCounts },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return normalized
  }

  async cbuaeFeeReviewExport(
    principal: Principal,
    input: { period: string; scenarios: FeeScenario[] },
    traceId: string
  ): Promise<CbuaeFeeReviewExport> {
    assertScope(principal, BILLING_CONSOLE_SCOPE)
    const bankId = tenantId(principal)
    const period = periodOrThrow(input.period)
    const result = await requireProfitability(this.deps.profitability).cbuaeAnnualReviewExport(period, input.scenarios, traceId)
    const normalized = { ...result, sha256: digest(cbuaeFeeReviewWireBody(result)) }
    await this.deps.audit.emit({
      event_type: 'billing_cbuae_fee_review_requested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: BILLING_CONSOLE_SCOPE,
      request_trace_id: traceId,
      request_body: { bank_id: bankId, period, scenario_ids: input.scenarios.map((item) => item.scenarioId), sha256: normalized.sha256 },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return normalized
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

interface FeeScenarioWire {
  scenario_id: string
  effective_date: string
  receivable_multiplier_basis_points: number
  retail_overage: {
    overage_units: number
    current_rate_milli_fils: number
    proposed_rate_milli_fils: number
  }
}

function toFeeScenario(input: FeeScenarioWire): FeeScenario {
  return {
    scenarioId: input.scenario_id,
    effectiveDate: input.effective_date,
    receivableMultiplierBasisPoints: input.receivable_multiplier_basis_points,
    retailOverage: {
      overageUnits: input.retail_overage.overage_units,
      currentRateMilliFils: input.retail_overage.current_rate_milli_fils,
      proposedRateMilliFils: input.retail_overage.proposed_rate_milli_fils
    }
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function billingError(c: Context, error: unknown): Response | null {
  const denied = scopeDenied(c, error)
  if (denied) return denied
  if (error instanceof BillingConsoleError) {
    return c.json(
      errorEnvelope(error.code, error.message, 'Use a provisioned billing tenant and a YYYY-MM period.', DOCS_BASE),
      error.status as ContentfulStatusCode
    )
  }
  if (error instanceof RangeError || error instanceof TypeError) {
    return c.json(errorEnvelope('BACKOFFICE.INVALID_BILLING_INPUT', error.message, 'Correct the request using the billing OpenAPI schema.', DOCS_BASE), 400)
  }
  return null
}

export function billingConsoleRoutes(service: BillingConsoleService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/billing/console': async (c) => {
      try {
        const { data, freshness } = await service.overview(c.get('principal'), c.req.query('period'))
        return c.json({ ...dataEnvelope(billingConsoleOverviewWire(data)), freshness }, 200)
      } catch (error) {
        const response = billingError(c, error)
        if (response) return response
        throw error
      }
    },
    'post /back-office/billing/profitability:simulate': async (c) => {
      let body: { period: string; scenario: FeeScenarioWire }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A valid profitability scenario body is required.', 'Send the BillingProfitabilityScenarioRequest schema.', DOCS_BASE), 400)
      }
      try {
        const principal = c.get('principal')
        return c.json({
          ...dataEnvelope(feeScenarioResultWire(await service.simulate(principal, { period: body.period, scenario: toFeeScenario(body.scenario) }))),
          freshness: liveFreshness(new Date())
        }, 200)
      } catch (error) {
        const response = billingError(c, error)
        if (response) return response
        throw error
      }
    },
    'post /back-office/billing/exports:cbuae-fee-review': async (c) => {
      const key = c.req.header('idempotency-key')
      if (!key) return c.json(missingIdempotencyKey(), 400)
      let body: { period: string; scenarios: FeeScenarioWire[] }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A valid CBUAE fee-review export body is required.', 'Send period and scenarios.', DOCS_BASE), 400)
      }
      if (!body || !Array.isArray(body.scenarios)) {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A scenarios array is required.', 'Send period and no more than 20 scenarios.', DOCS_BASE), 400)
      }
      if (body.scenarios.length > 20) {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'At most 20 fee-review scenarios are allowed.', 'Reduce scenarios to 20 or fewer.', DOCS_BASE), 400)
      }
      const principal = c.get('principal')
      const requestDigest = digest(body)
      const cacheKey = `billing:cbuae-review|${principal.bankId ?? 'missing'}|${principal.subject}|${requestDigest}|${key}`
      return replayCached(c, idempotency, cacheKey, async () => {
        try {
          const result = await service.cbuaeFeeReviewExport(principal, {
            period: body.period,
            scenarios: body.scenarios.map(toFeeScenario)
          }, c.req.header('x-fapi-interaction-id') ?? 'unknown')
          return c.json(dataEnvelope(cbuaeFeeReviewWire(result)), 200)
        } catch (error) {
          const response = billingError(c, error)
          if (response) return response
          throw error
        }
      })
    },
    'get /back-office/billing/export': async (c) => {
      try {
        const result = await service.portableExport(c.get('principal'), c.req.header('x-fapi-interaction-id') ?? 'unknown')
        return c.json(dataEnvelope(portableBillingExportWire(result)), 200)
      } catch (error) {
        const response = billingError(c, error)
        if (response) return response
        throw error
      }
    }
  }
}
