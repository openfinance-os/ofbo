import type { NebrasEgressPort } from '@ofbo/ports'
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
export const OPS_WRITE_SCOPE = 'platform:operations:write'

export interface TppCounterpartyStore {
  syncDirectory(
    participants: { organisation_id: string; legal_name: string; registration_number?: string | null; directory_contacts?: unknown[] }[],
    traceId: string
  ): Promise<DirectorySyncResult>
  get(organisationId: string): Promise<StoredTppCounterparty | null>
  list(query?: TppCounterpartyListQuery): Promise<TppCounterpartyPage>
}

export class TppRegistryService {
  constructor(
    private readonly store: TppCounterpartyStore,
    private readonly egress: Pick<NebrasEgressPort, 'syncDirectory'>,
    private readonly audit: HighClassAuditSink
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
