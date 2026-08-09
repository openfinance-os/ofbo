import type { StoredRiskSignal, RiskSignalListQuery, RiskSignalPage } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-30 / -42 — risk-signal list + triage surface. The risk monitors
 * (liability, consent-anomaly, TPP-profiling, predictive-forecast, …) WRITE signals;
 * this is the read + lifecycle-transition surface for Risk analysts. GET is risk:read;
 * the PATCH triage transition is risk:investigations:write, Idempotency-Key, with one
 * High-class audit per transition. The row already matches the RiskSignal wire schema.
 */

export const RISK_SIGNALS_READ_SCOPE = 'risk:read'
export const RISK_SIGNALS_WRITE_SCOPE = 'risk:investigations:write'
/** Statuses an operator may transition TO (open is the system-set initial state). */
export const RISK_SIGNAL_PATCH_STATUSES = ['acknowledged', 'investigating', 'closed_actioned', 'closed_no_action', 'false_positive'] as const

export class RiskSignalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface RiskSignalStore {
  listSignals(query: RiskSignalListQuery): Promise<RiskSignalPage>
  getSignal(id: string): Promise<StoredRiskSignal | null>
  updateSignalStatus(id: string, status: string): Promise<StoredRiskSignal | null>
}

/** No-database default (tests / local dev). The worker wires PgRiskMetricsStore. */

export interface RiskSignalServiceDeps {
  store: RiskSignalStore
  audit: HighClassAuditSink
}

export class RiskSignalService {
  constructor(private readonly deps: RiskSignalServiceDeps) {}

  async list(principal: Principal, query: { cursor?: string; limit?: number; signal_type?: string; severity?: string; status?: string }): Promise<RiskSignalPage> {
    assertScope(principal, RISK_SIGNALS_READ_SCOPE)
    return this.deps.store.listSignals({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.signal_type ? { signal_type: query.signal_type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.status ? { status: query.status } : {})
    })
  }

  async updateStatus(principal: Principal, id: string, input: { status?: string }, traceId: string): Promise<StoredRiskSignal> {
    assertScope(principal, RISK_SIGNALS_WRITE_SCOPE)
    if (!input.status || !(RISK_SIGNAL_PATCH_STATUSES as readonly string[]).includes(input.status)) {
      throw new RiskSignalError('BACKOFFICE.INVALID_STATUS', `status must be one of: ${RISK_SIGNAL_PATCH_STATUSES.join(', ')}.`, 400)
    }
    const existing = await this.deps.store.getSignal(id)
    if (!existing) throw new RiskSignalError('BACKOFFICE.RISK_SIGNAL_NOT_FOUND', 'No risk signal matches that id.', 404)

    const updated = await this.deps.store.updateSignalStatus(id, input.status)
    if (!updated) throw new RiskSignalError('BACKOFFICE.RISK_SIGNAL_NOT_FOUND', 'No risk signal matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'risk_signal_status_changed',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RISK_SIGNALS_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { signal_id: id, signal_type: updated.signal_type, from_status: existing.status, to_status: input.status },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return updated
  }
}

// CODE-02 — in-memory store(s) moved to services/bff/memory/risk-signals.ts (demo-profile production
// defaults, not test fixtures). Re-exported so every existing import is unchanged.
export {
  InMemoryRiskSignalStore
} from '../../memory/risk-signals.js'
