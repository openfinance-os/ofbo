import { createHash } from 'node:crypto'
import {
  buildProfitabilityReport,
  simulateFeeScenario,
  type FeeScenario,
  type FeeScenarioResult,
  type ProfitabilityInput,
  type ProfitabilityReport
} from '@ofbo/billing'
import type { HighClassAuditSink } from '../high-class-audit.js'

export interface BillingProfitabilitySource {
  inputForPeriod(period: string): Promise<ProfitabilityInput | null>
}

export class InMemoryBillingProfitabilitySource implements BillingProfitabilitySource {
  private readonly inputs = new Map<string, ProfitabilityInput>()
  /** Scenarios are deliberately pure; this counter makes accidental persistence test-visible. */
  writeCount = 0

  constructor(inputs: readonly ProfitabilityInput[] = []) {
    for (const input of inputs) this.inputs.set(input.period, structuredClone(input))
  }

  async inputForPeriod(period: string): Promise<ProfitabilityInput | null> {
    const input = this.inputs.get(period)
    return input ? structuredClone(input) : null
  }
}

export interface CbuaeFeeReviewExport {
  schemaVersion: 'ofbo.cbuae-fee-review.v1'
  period: string
  generatedAt: string
  currency: 'AED'
  profitability: ProfitabilityReport
  scenarios: FeeScenarioResult[]
  sha256: string
}

function canonical(value: unknown): string {
  const norm = (item: unknown): unknown => item === null || typeof item !== 'object'
    ? item
    : Array.isArray(item)
      ? item.map(norm)
      : Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, norm((item as Record<string, unknown>)[key])]))
  return JSON.stringify(norm(value))
}

export class BillingProfitabilityService {
  private readonly now: () => Date

  constructor(private readonly deps: { source: BillingProfitabilitySource; audit: HighClassAuditSink; now?: () => Date }) {
    this.now = deps.now ?? (() => new Date())
  }

  private async evidence(period: string): Promise<ProfitabilityInput> {
    const input = await this.deps.source.inputForPeriod(period)
    if (!input) throw new Error(`no profitability evidence for ${period}`)
    return input
  }

  async report(period: string): Promise<ProfitabilityReport> {
    return buildProfitabilityReport(await this.evidence(period))
  }

  async latestReport(period: string): Promise<ProfitabilityReport | null> {
    const input = await this.deps.source.inputForPeriod(period)
    return input ? buildProfitabilityReport(input) : null
  }

  async simulate(period: string, scenario: FeeScenario): Promise<FeeScenarioResult> {
    return simulateFeeScenario(await this.evidence(period), scenario)
  }

  async cbuaeAnnualReviewExport(period: string, scenarios: readonly FeeScenario[], traceId: string): Promise<CbuaeFeeReviewExport> {
    const input = await this.evidence(period)
    const profitability = buildProfitabilityReport(input)
    const body = {
      schemaVersion: 'ofbo.cbuae-fee-review.v1' as const,
      period,
      generatedAt: this.now().toISOString(),
      currency: 'AED' as const,
      profitability,
      scenarios: scenarios.map((scenario) => simulateFeeScenario(input, scenario))
    }
    const result = { ...body, sha256: `sha256:${createHash('sha256').update(canonical(body)).digest('hex')}` }
    await this.deps.audit.emit({
      event_type: 'billing_cbuae_fee_review_exported',
      acting_principal: 'system:billing-profitability',
      acting_persona: 'system',
      scope_used: 'billing:read',
      request_trace_id: traceId,
      request_body: { period, scenario_ids: scenarios.map((scenario) => scenario.scenarioId), sha256: result.sha256 },
      response_status: 200
    })
    return result
  }
}
