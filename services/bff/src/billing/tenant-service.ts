import { rateCardForTenant, type RateCard, type TenantRateCard } from '@ofbo/billing'
import type {
  CrossTenantBillingBenchmark,
  TenantCollectionRailPolicy,
  TenantConfiguration,
  TenantPortableBillingExport
} from '@ofbo/db'

export interface TenantConfigurationReader {
  configuration(bankId: string): Promise<TenantConfiguration | null>
}

export interface TenantBillingDataPort {
  portableExport(bankId: string, generatedAt: string): Promise<TenantPortableBillingExport>
  crossTenantBenchmark(input: {
    authorizingBankId: string
    purposeCode: string
    period: string
    actingPrincipal: string
    actingPersona: string
    /** The calling principal's own scope — this read is human-initiated, not headless (CODE-03). */
    scopeUsed: string
    traceId: string
  }): Promise<CrossTenantBillingBenchmark>
}

export class InMemoryTenantConfigurationReader implements TenantConfigurationReader {
  private readonly rows = new Map<string, TenantConfiguration>()
  constructor(configurations: readonly TenantConfiguration[] = []) {
    for (const config of configurations) this.rows.set(config.bankId, structuredClone(config))
  }
  async configuration(bankId: string): Promise<TenantConfiguration | null> {
    return structuredClone(this.rows.get(bankId) ?? null)
  }
}

export interface TenantBillingProfile {
  bankId: string
  rateCard: TenantRateCard
  invoice: { templateRef: string; brandKey: string }
  aspRouteProfile: string
  collectionRailPolicy: TenantCollectionRailPolicy
}

export class TenantNotProvisionedError extends Error {
  constructor(readonly bankId: string) {
    super(`tenant ${bankId} is not provisioned for billing`)
    this.name = 'TenantNotProvisionedError'
  }
}

/** BILL-10: the only application seam that turns tenant config into billing runtime policy. */
export class BillingTenantService {
  constructor(private readonly deps: { configurations: TenantConfigurationReader; data?: TenantBillingDataPort; now?: () => Date }) {}

  async profile(bankId: string, baseRateCard: RateCard): Promise<TenantBillingProfile> {
    const config = await this.deps.configurations.configuration(bankId)
    if (!config) throw new TenantNotProvisionedError(bankId)
    const rateCard = rateCardForTenant(baseRateCard, {
      tenantId: bankId,
      yearAnchorDate: config.yearAnchorDate,
      // No directory publication means the deliberate silent default is zero.
      retailOverageMilliFils: config.retailOverageMilliFils ?? 0
    })
    return {
      bankId,
      rateCard,
      invoice: { templateRef: config.invoiceTemplateRef, brandKey: config.invoiceBrandKey },
      aspRouteProfile: config.aspRouteProfile,
      collectionRailPolicy: structuredClone(config.collectionRailPolicy)
    }
  }

  async portableExport(bankId: string, generatedAt = (this.deps.now ?? (() => new Date()))().toISOString()): Promise<TenantPortableBillingExport> {
    if (!(await this.deps.configurations.configuration(bankId))) throw new TenantNotProvisionedError(bankId)
    if (!this.deps.data) throw new Error('tenant billing export store is not configured')
    return this.deps.data.portableExport(bankId, generatedAt)
  }

  async benchmark(input: Parameters<NonNullable<TenantBillingDataPort['crossTenantBenchmark']>>[0]): Promise<CrossTenantBillingBenchmark> {
    if (!(await this.deps.configurations.configuration(input.authorizingBankId))) throw new TenantNotProvisionedError(input.authorizingBankId)
    if (!this.deps.data) throw new Error('tenant billing benchmark store is not configured')
    return this.deps.data.crossTenantBenchmark(input)
  }
}
