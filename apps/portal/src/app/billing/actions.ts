'use server'

import { idempotencyKey } from '../../lib/idempotency'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import {
  BillingConsoleApiError,
  simulateProfitability,
  type BillingScenario,
  type BillingWriteResult
} from '../../lib/billing-console'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function finite(formData: FormData, name: string, fallback: number): number {
  const value = Number(formData.get(name))
  return Number.isFinite(value) ? value : fallback
}

function failure(error: unknown, values: Record<string, string>): BillingWriteResult {
  if (error instanceof BillingConsoleApiError) {
    return {
      ok: false,
      error: error.message,
      remediation: error.remediation ?? null,
      docsUrl: error.docsUrl ?? null,
      values
    }
  }
  return { ok: false, error: error instanceof Error ? error.message : 'The scenario could not be calculated.', values }
}

/** Pure BILL-09 what-if action. Session/scope are rechecked here and again by the BFF. */
export async function simulateBillingAction(
  _previous: BillingWriteResult,
  formData: FormData
): Promise<BillingWriteResult> {
  const { token } = await requireSession({ scope: SCOPES.billingRead, module: 'Billing Control Plane' })
  const period = String(formData.get('period') ?? '')
  const scenarioId = String(formData.get('scenario_id') ?? '')
  const effectiveDate = String(formData.get('effective_date') ?? '')
  const values: Record<string, string> = {
    period,
    scenario_id: scenarioId,
    effective_date: effectiveDate,
    receivable_multiplier_percent: String(formData.get('receivable_multiplier_percent') ?? ''),
    overage_units: String(formData.get('overage_units') ?? ''),
    current_rate_fils: String(formData.get('current_rate_fils') ?? ''),
    proposed_rate_fils: String(formData.get('proposed_rate_fils') ?? '')
  }

  try {
    if (!PERIOD.test(period)) throw new RangeError('Period must be YYYY-MM.')
    if (!DATE.test(effectiveDate)) throw new RangeError('Effective date must be YYYY-MM-DD.')
    const multiplierPercent = finite(formData, 'receivable_multiplier_percent', 100)
    const overageUnits = finite(formData, 'overage_units', 0)
    const currentRateFils = finite(formData, 'current_rate_fils', 0)
    const proposedRateFils = finite(formData, 'proposed_rate_fils', 0)
    if (multiplierPercent < 0 || overageUnits < 0 || currentRateFils < 0 || proposedRateFils < 0) {
      throw new RangeError('Scenario values must be non-negative.')
    }
    const scenario: BillingScenario = {
      scenario_id: scenarioId.trim() || 'portal-scenario',
      effective_date: effectiveDate,
      receivable_multiplier_basis_points: Math.round(multiplierPercent * 100),
      retail_overage: {
        overage_units: Math.round(overageUnits),
        current_rate_milli_fils: Math.round(currentRateFils * 1_000),
        proposed_rate_milli_fils: Math.round(proposedRateFils * 1_000)
      }
    }
    const simulation = await simulateProfitability(
      token,
      { period, scenario },
      idempotencyKey(formData)
    )
    return { ok: true, simulation, values }
  } catch (error) {
    return failure(error, values)
  }
}
