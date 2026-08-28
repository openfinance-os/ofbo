// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/tpp-billing/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { TppCounterpartyStore } from '../src/tpp-billing/service.js'
import type { StoredTppCounterparty, TppCounterpartyListQuery, TppCounterpartyPage, DirectorySyncResult } from '@ofbo/db'

export class InMemoryTppCounterpartyStore implements TppCounterpartyStore {
  private readonly rows = new Map<string, StoredTppCounterparty>()

  /**
   * The channel a sync-created row is stamped with — configurable for the same reason the Postgres
   * sibling takes it from `config.channel` rather than hardcoding it.
   *
   * This store hardcoded `'external_tpp_aas'` while the Pg store wrote whatever its tenancy config
   * said (the worker sets `internal_retail`), so one endpoint returned a different `TppCounterparty.
   * channel` depending on which store was mounted. Both values are enum members, so nothing was
   * schema-invalid — it is the same store-parity divergence this class was just edited to close for
   * `registration_number` and `directory_contacts`, four lines below them, and the comment there
   * states the rule it did not follow.
   *
   * The default preserves today's behaviour for every existing caller; a caller that knows its
   * tenancy passes it, exactly as the Pg store is constructed.
   */
  constructor(private readonly channel: string = 'external_tpp_aas') {}
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
          channel: this.channel,
          created_at: new Date().toISOString()
        })
      } else {
        if (existing.legal_name !== p.legal_name) changed.push(p.organisation_id)
        existing.legal_name = p.legal_name
        // PRESERVE what the participant does not carry, exactly as the Postgres store does. The P6
        // participant shape is { organisation_id, legal_name }, so assigning `?? null` / `?? []`
        // emptied two spec-defined TppCounterparty fields on every sync. The Pg store was fixed and
        // this one was not, which put the two implementations behind one endpoint into
        // disagreement — the port-parity rule is that an adapter passes the tests its sibling
        // passes, and this is the store a BFF without a database falls back to.
        if (p.registration_number != null) existing.registration_number = p.registration_number
        if (p.directory_contacts && p.directory_contacts.length > 0) existing.directory_contacts = p.directory_contacts
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
