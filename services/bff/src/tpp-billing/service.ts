import type { FinancialSystemPort, ItsmPort, NebrasEgressPort } from '@ofbo/ports'
import type { StoredTppCounterparty, TppCounterpartyListQuery, TppCounterpartyPage, DirectorySyncResult } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-71 — consuming-TPP registry + Trust Framework Directory sync. The
 * registry is the bank-side master list of TPPs consuming the bank's LFI APIs.
 * Reads are billing:read; the directory sync (via the P6 egress gateway, mTLS
 * directory token) is platform:operations:write and flags new / changed /
 * decommissioned TPPs for the Ops Console. tpp_counterparty writes emit BCBS 239
 * lineage at the store layer.
 */

export const BILLING_READ_SCOPE = 'billing:read'
export const BILLING_WRITE_SCOPE = 'billing:write'
export const OPS_WRITE_SCOPE = 'platform:operations:write'

export class TppRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface TppCounterpartyStore {
  syncDirectory(
    participants: { organisation_id: string; legal_name: string; registration_number?: string | null; directory_contacts?: unknown[] }[],
    traceId: string
  ): Promise<DirectorySyncResult>
  registerFinancialSystem(organisationId: string, financialSystemRef: string, traceId: string): Promise<StoredTppCounterparty | null>
  observeTraffic(organisationId: string, traceId: string): Promise<StoredTppCounterparty | null>
  get(organisationId: string): Promise<StoredTppCounterparty | null>
  list(query?: TppCounterpartyListQuery): Promise<TppCounterpartyPage>
}

export class TppRegistryService {
  constructor(
    private readonly store: TppCounterpartyStore,
    private readonly egress: Pick<NebrasEgressPort, 'syncDirectory'>,
    private readonly audit: HighClassAuditSink,
    private readonly financialSystem?: Pick<FinancialSystemPort, 'registerCounterparty'>,
    private readonly itsm?: Pick<ItsmPort, 'createTicket'>
  ) {}

  async list(principal: Principal, query: TppCounterpartyListQuery = {}): Promise<TppCounterpartyPage> {
    assertScope(principal, BILLING_READ_SCOPE)
    return this.store.list(query)
  }

  async get(principal: Principal, organisationId: string): Promise<StoredTppCounterparty | null> {
    assertScope(principal, BILLING_READ_SCOPE)
    return this.store.get(organisationId)
  }

  /** Trigger a directory sync: pull participants via P6, upsert the registry, flag
   *  the change set, and High-class audit the registration-state changes. */
  async syncDirectory(principal: Principal, traceId: string): Promise<DirectorySyncResult> {
    assertScope(principal, OPS_WRITE_SCOPE)
    const { participants } = await this.egress.syncDirectory({ trace_id: traceId })
    const result = await this.store.syncDirectory(participants, traceId)
    await this.audit.emit({
      event_type: 'tpp_directory_synced',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: OPS_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { synced: result.synced, added: result.added, changed: result.changed, decommissioned: result.decommissioned },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return result
  }

  /**
   * BACKOFFICE-72 — register a counterparty as invoiceable in the financial
   * management system (P9), seeded with directory org details; tracks
   * registration_state on tpp_counterparty and clears any unbilled-traffic alert.
   * billing:write.
   */
  async registerFinancialSystem(principal: Principal, organisationId: string, traceId: string): Promise<StoredTppCounterparty> {
    assertScope(principal, BILLING_WRITE_SCOPE)
    if (!this.financialSystem) throw new TppRegistryError('BACKOFFICE.REGISTER_UNAVAILABLE', 'Financial-system registration is not configured.', 404)
    const existing = await this.store.get(organisationId)
    if (!existing) throw new TppRegistryError('BACKOFFICE.COUNTERPARTY_NOT_FOUND', `No counterparty ${organisationId}.`, 404)

    const { financial_system_ref } = await this.financialSystem.registerCounterparty({ organisation_id: organisationId, legal_name: existing.legal_name }, { trace_id: traceId })
    const updated = await this.store.registerFinancialSystem(organisationId, financial_system_ref, traceId)
    if (!updated) throw new TppRegistryError('BACKOFFICE.COUNTERPARTY_NOT_FOUND', `No counterparty ${organisationId}.`, 404)

    await this.audit.emit({
      event_type: 'tpp_financial_system_registered',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: BILLING_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { organisation_id: organisationId, financial_system_ref, registration_state: updated.registration_state },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return updated
  }

  /**
   * BACKOFFICE-72 — observe production traffic for a set of TPPs (from the bank's
   * API logs). An unregistered TPP with observed traffic is the unbilled-traffic
   * alert condition: raise an ITSM ticket + a Finance View signal (High-class
   * audit). Returns the org ids newly in the unbilled-traffic state.
   */
  async recordTraffic(organisationIds: string[], traceId: string): Promise<{ unbilled: string[] }> {
    const unbilled: string[] = []
    for (const org of organisationIds) {
      const row = await this.store.observeTraffic(org, traceId)
      if (row?.unbilled_traffic) unbilled.push(org)
    }
    if (unbilled.length > 0) {
      await this.itsm?.createTicket(
        { type: 'tpp_unbilled_traffic', severity: 'high', team: 'finance', summary: `${unbilled.length} TPP(s) with traffic but no completed financial-system registration: ${unbilled.join(', ')}` },
        { trace_id: traceId }
      )
      // Finance View signal (BACKOFFICE-31 reads it from the High-class trail).
      await this.audit.emit({
        event_type: 'tpp_unbilled_traffic_alert',
        acting_principal: 'system:tpp-traffic-monitor',
        acting_persona: 'system',
        scope_used: 'billing:read',
        request_trace_id: traceId,
        request_body: { unbilled_count: unbilled.length, organisation_ids: unbilled },
        response_status: 200
      })
    }
    return { unbilled }
  }
}

/** No-database default (tests / local dev). Mirrors the store's sync classification. */
export class InMemoryTppCounterpartyStore implements TppCounterpartyStore {
  private readonly rows = new Map<string, StoredTppCounterparty>()
  async syncDirectory(
    participants: { organisation_id: string; legal_name: string; registration_number?: string | null; directory_contacts?: unknown[] }[],
    _traceId: string
  ): Promise<DirectorySyncResult> {
    const added: string[] = []
    const changed: string[] = []
    const present = new Set(participants.map((p) => p.organisation_id))
    for (const p of participants) {
      const existing = this.rows.get(p.organisation_id)
      if (!existing) {
        added.push(p.organisation_id)
        this.rows.set(p.organisation_id, {
          organisation_id: p.organisation_id,
          legal_name: p.legal_name,
          registration_number: p.registration_number ?? null,
          directory_contacts: p.directory_contacts ?? [],
          directory_synced_at: new Date().toISOString(),
          production_status: 'directory_only',
          first_traffic_at: null,
          registration_state: 'unregistered',
          financial_system_ref: null,
          unbilled_traffic: false,
          mtd_fee_accrual: null,
          channel: 'external_tpp_aas',
          created_at: new Date().toISOString()
        })
      } else {
        if (existing.legal_name !== p.legal_name) changed.push(p.organisation_id)
        existing.legal_name = p.legal_name
        existing.registration_number = p.registration_number ?? null
        existing.directory_contacts = p.directory_contacts ?? []
        existing.directory_synced_at = new Date().toISOString()
        if (existing.production_status === 'decommissioned') existing.production_status = 'directory_only'
      }
    }
    const decommissioned: string[] = []
    for (const row of this.rows.values()) {
      if (!present.has(row.organisation_id) && row.production_status !== 'decommissioned') {
        row.production_status = 'decommissioned'
        decommissioned.push(row.organisation_id)
      }
    }
    return { synced: participants.length, added, changed, decommissioned }
  }
  async registerFinancialSystem(organisationId: string, financialSystemRef: string): Promise<StoredTppCounterparty | null> {
    const row = this.rows.get(organisationId)
    if (!row) return null
    row.registration_state = 'registered'
    row.financial_system_ref = financialSystemRef
    row.unbilled_traffic = false
    return row
  }
  async observeTraffic(organisationId: string): Promise<StoredTppCounterparty | null> {
    const row = this.rows.get(organisationId)
    if (!row) return null
    row.production_status = 'active_traffic'
    row.first_traffic_at = row.first_traffic_at ?? new Date().toISOString()
    row.unbilled_traffic = row.registration_state !== 'registered'
    return row
  }
  async get(organisationId: string): Promise<StoredTppCounterparty | null> {
    return this.rows.get(organisationId) ?? null
  }
  async list(query: TppCounterpartyListQuery = {}): Promise<TppCounterpartyPage> {
    let rows = [...this.rows.values()]
    if (query.production_status) rows = rows.filter((r) => r.production_status === query.production_status)
    if (query.registration_state) rows = rows.filter((r) => r.registration_state === query.registration_state)
    if (query.unbilled_traffic !== undefined) rows = rows.filter((r) => r.unbilled_traffic === query.unbilled_traffic)
    rows.sort((a, b) => a.organisation_id.localeCompare(b.organisation_id))
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}
