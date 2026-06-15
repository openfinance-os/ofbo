import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { FeeAccrual } from '@ofbo/db'
import type { MarginSummary } from '../reconciliation/margin.js'
import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'

/**
 * BACKOFFICE-31 — Finance View. A read-only analytics view (reconciliation:read,
 * enforced at the BFF middleware AND re-checked here) that composes already-persisted
 * data: MTD Nebras fee accrual (the BACKOFFICE-32 materialized aggregates), TPP-aaS
 * margin by fintech + product family (BACKOFFICE-07, re-derived per period), the open
 * Nebras dispute queue, and the unbilled-traffic signal (BACKOFFICE-72) — all under
 * the Finance View's single scope, with the mandatory freshness envelope (BACKOFFICE-40).
 * No new data, no mutation, no PSU PII.
 */

export const FINANCE_VIEW_SCOPE = 'reconciliation:read'
const RECON_CONSOLE_DEEPLINK = '/back-office/reconciliation/runs'

export interface FinanceFeeAccrualReader {
  feeAccrualForPeriod(period: string): Promise<FeeAccrual | null>
}
export interface FinanceMarginReader {
  marginForPeriod(principal: Principal, period: string): Promise<MarginSummary>
}
export interface FinanceDisputeReader {
  openNebrasDisputeCount(principal: Principal, period: string): Promise<number>
}
export interface FinanceUnbilledReader {
  unbilledTrafficCount(): Promise<number>
}

export interface FinanceViewDeps {
  feeAccrual: FinanceFeeAccrualReader
  margin: FinanceMarginReader
  disputes: FinanceDisputeReader
  unbilled: FinanceUnbilledReader
  now?: () => Date
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export class FinanceViewError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class FinanceViewService {
  constructor(private readonly deps: FinanceViewDeps) {}

  async view(principal: Principal, period?: string): Promise<{ data: Record<string, unknown>; freshness: Record<string, unknown> }> {
    assertScope(principal, FINANCE_VIEW_SCOPE)
    const p = period ?? (this.deps.now ?? (() => new Date()))().toISOString().slice(0, 7)
    if (!MONTH.test(p)) throw new FinanceViewError('BACKOFFICE.INVALID_PERIOD', 'period must be a calendar month YYYY-MM.', 400)

    const [accrual, margin, openDisputes, unbilled] = await Promise.all([
      this.deps.feeAccrual.feeAccrualForPeriod(p),
      this.deps.margin.marginForPeriod(principal, p),
      this.deps.disputes.openNebrasDisputeCount(principal, p),
      this.deps.unbilled.unbilledTrafficCount()
    ])

    const refreshedAt = (this.deps.now ?? (() => new Date()))().toISOString()
    const data = {
      period: p,
      mtd_nebras_fee_accrual: { amount: accrual?.total_fee_minor ?? 0, currency: accrual?.currency ?? 'AED' },
      fee_accrual_by_line_type: (accrual?.by_line_type ?? []).map((l) => ({ line_type: l.line_type, amount: { amount: l.total_fee_minor, currency: accrual!.currency }, line_count: l.line_count })),
      tpp_aas_margin: margin,
      open_nebras_dispute_count: openDisputes,
      unbilled_traffic_alert_count: unbilled,
      reconciliation_console_deeplink: RECON_CONSOLE_DEEPLINK
    }
    const freshness = {
      source_published_at: accrual?.source_published_at ?? null,
      view_refreshed_at: refreshedAt,
      stale: accrual === null ? true : accrual.stale,
      stale_cause: accrual === null ? 'no_ingested_aggregates_for_period' : accrual.stale ? 'last_ingestion_failed' : null
    }
    return { data, freshness }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function financeViewRoutes(service: FinanceViewService): Record<string, Handler> {
  return {
    'get /back-office/analytics/finance-view': async (c) => {
      try {
        const period = c.req.query('period')
        const { data, freshness } = await service.view(c.get('principal'), period)
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
        if (e instanceof FinanceViewError) {
          return c.json(errorEnvelope(e.code, e.message, 'Pass ?period=YYYY-MM or omit for the current month.', DOCS_BASE), e.status as ContentfulStatusCode)
        }
        throw e
      }
    }
  }
}
