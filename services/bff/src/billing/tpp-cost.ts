import {
  UnpriceableOverageError,
  buildExpectedTppCostStatement,
  rateUsage,
  type DirectoryOverageSnapshot,
  type ExpectedTppCostStatement,
  type RateCard
} from '@ofbo/billing'
import { createHash } from 'node:crypto'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../high-class-audit.js'

/**
 * BILL-13 — generate and persist the expected TPP cost statement for a closed period.
 *
 * Rides the existing monthly billing trigger beside the receivable expected-memo projection; it
 * introduces no scheduler of its own. Idempotent by construction: the store keys a statement on
 * (meter run, rate card version, rate snapshot hash), so a resumed or replayed run re-reads the
 * statement already written instead of producing a second one.
 *
 * ## Why this skips rather than throws
 *
 * Retail data overage is priced from a directory snapshot, and rating FAILS CLOSED without one
 * (BILL-12) — deliberately, because guessing the rate or its unit would mis-state the payable. But
 * a period that cannot be priced must not take the regulated receivable projections down with it,
 * which is exactly the availability trap the BILL-12 review caught. So an unpriceable period is
 * reported as `skipped` with its reason and recorded as a High-class audit event; it is never
 * persisted half-priced, and never silently reported as generated. Routing that to P3/ITSM as an
 * operational alert is BILL-14's, once a directory source exists that can fail in the first place.
 */

export interface TppCostStatementStore {
  latestMeterRun(period: string): Promise<{ id: string; period: string; rateCardVersion: string } | null>
  meteredLinesForRun(meterRunId: string): Promise<Parameters<typeof rateUsage>[0]>
  saveStatement(
    input: { meterRunId: string; statement: ExpectedTppCostStatement },
    traceId: string
  ): Promise<{ record: { id: string }; created: boolean }>
}

/** Supplies the directory snapshot in force for a period, when one is available at all. */
export interface DirectoryOverageSource {
  snapshotForPeriod(period: string): Promise<DirectoryOverageSnapshot | null>
}

export interface TppCostStatementResult {
  status: 'generated' | 'skipped'
  statementId?: string
  created?: boolean
  reason?: string
}

export interface TppCostStatementDeps {
  store: TppCostStatementStore
  audit: HighClassAuditSink
  tenantId: string
  overage?: DirectoryOverageSource
}

/**
 * Chain the two pricing sources a statement was priced from into one recomputable digest: the rate
 * card version and the directory snapshot's own digest.
 *
 * It is an actual SHA-256 over a canonical pre-image, not a `sha256:`-prefixed concatenation of the
 * inputs — an evidence-chain identifier that merely looks like a digest is worse than one that does
 * not, because an auditor will try to recompute it. The pre-image is stable and documented here so
 * they can.
 */
export function rateSnapshotHash(rateCardVersion: string, directoryDigest: string | null): string {
  const preimage = [
    'ofbo.tpp-cost.rate-snapshot.v1',
    `rate-card:${rateCardVersion}`,
    `directory:${directoryDigest ?? 'none'}`
  ].join('\n')
  return `sha256:${createHash('sha256').update(preimage).digest('hex')}`
}

export class TppCostStatementService {
  constructor(private readonly deps: TppCostStatementDeps) {}

  async generateStatement(
    period: string,
    rateCard: RateCard,
    generatedAt: string,
    traceId: string
  ): Promise<TppCostStatementResult> {
    const run = await this.deps.store.latestMeterRun(period)
    if (!run) return { status: 'skipped', reason: `no metering run exists for ${period}` }
    if (run.rateCardVersion !== rateCard.version) {
      return {
        status: 'skipped',
        reason: `meter run ${run.id} was metered under rate card ${run.rateCardVersion}, not ${rateCard.version}`
      }
    }

    const meteredLines = await this.deps.store.meteredLinesForRun(run.id)
    const snapshot = (await this.deps.overage?.snapshotForPeriod(period)) ?? undefined

    let statement: ExpectedTppCostStatement
    try {
      const rating = rateUsage(meteredLines, rateCard, period, [], { overageSnapshot: snapshot })
      statement = buildExpectedTppCostStatement(rating, {
        tenantId: this.deps.tenantId,
        meterRunId: run.id,
        generatedAt,
        ratingRunAt: generatedAt,
        pricingEffectiveFrom: rateCard.effectiveFrom,
        rateSnapshotHash: rateSnapshotHash(rateCard.version, snapshot?.digest ?? null),
        ...(snapshot ? { directorySnapshotId: snapshot.snapshotId } : {})
      })
    } catch (error) {
      // Only the fail-closed pricing refusal is a skip, identified by type rather than by matching
      // message text — anything else is a genuine defect and must surface as one.
      if (!(error instanceof UnpriceableOverageError)) throw error
      const message = error.message
      await this.deps.audit.emit({
        event_type: 'billing_tpp_cost_statement_unpriceable',
        acting_principal: 'system:billing-rating-engine',
        acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE,
        request_trace_id: traceId,
        request_body: { period, meter_run_id: run.id, reason: message },
        response_status: SYSTEM_ACTOR_RESPONSE_STATUS
      })
      return { status: 'skipped', reason: message }
    }

    const saved = await this.deps.store.saveStatement({ meterRunId: run.id, statement }, traceId)
    if (saved.created) {
      await this.deps.audit.emit({
        event_type: 'billing_tpp_cost_statement_generated',
        acting_principal: 'system:billing-rating-engine',
        acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE,
        request_trace_id: traceId,
        response_status: SYSTEM_ACTOR_RESPONSE_STATUS,
        request_body: {
          period,
          meter_run_id: run.id,
          statement_id: saved.record.id,
          total_net_milli_fils: statement.totals.totalNetMilliFils,
          nebras_hub_net_milli_fils: statement.totals.nebrasHubNetMilliFils,
          underlying_lfi_payment_net_milli_fils: statement.totals.underlyingLfiPaymentNetMilliFils,
          underlying_lfi_data_net_milli_fils: statement.totals.underlyingLfiDataNetMilliFils,
          directory_snapshot_id: statement.evidence.directorySnapshotId
        }
      })
    }
    return { status: 'generated', statementId: saved.record.id, created: saved.created }
  }
}
