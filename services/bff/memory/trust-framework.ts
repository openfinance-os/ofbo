// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/trust-framework/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { TrustFrameworkParticipantStore } from '../src/trust-framework/service.js'
import type {
  StoredTrustFrameworkParticipant,
  TrustFrameworkParticipantCreateInput,
  TrustFrameworkParticipantUpdate,
  TrustFrameworkParticipantListQuery,
  TrustFrameworkParticipantPage
} from '@ofbo/db'

export class InMemoryTrustFrameworkParticipantStore implements TrustFrameworkParticipantStore {
  private readonly rows: StoredTrustFrameworkParticipant[] = []
  async create(input: TrustFrameworkParticipantCreateInput): Promise<StoredTrustFrameworkParticipant> {
    const now = new Date().toISOString()
    const record: StoredTrustFrameworkParticipant = {
      id: crypto.randomUUID(),
      role: input.role,
      organisation_id: input.organisation_id,
      holder_ref: input.holder_ref,
      holder_display_name: input.holder_display_name,
      onboarding_stage: input.onboarding_stage ?? null,
      individual_tnc_status: 'not_started',
      organisational_tnc_status: 'not_started',
      onboarding_stage_due_at: input.onboarding_stage_due_at ?? null,
      status: 'active',
      nominated_replacement_ref: null,
      created_at: now,
      updated_at: now
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredTrustFrameworkParticipant | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: TrustFrameworkParticipantListQuery): Promise<TrustFrameworkParticipantPage> {
    let rows = this.rows
    if (query.role) rows = rows.filter((r) => r.role === query.role)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: TrustFrameworkParticipantUpdate): Promise<StoredTrustFrameworkParticipant | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.nominated_replacement_ref !== undefined && patch.nominated_replacement_ref !== null) r.nominated_replacement_ref = patch.nominated_replacement_ref
    if (patch.individual_tnc_status !== undefined) r.individual_tnc_status = patch.individual_tnc_status
    if (patch.organisational_tnc_status !== undefined) r.organisational_tnc_status = patch.organisational_tnc_status
    if (patch.onboarding_stage !== undefined && patch.onboarding_stage !== null) r.onboarding_stage = patch.onboarding_stage
    r.updated_at = new Date().toISOString()
    return r
  }
}
