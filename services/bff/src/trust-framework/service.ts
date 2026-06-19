import type {
  StoredTrustFrameworkParticipant,
  TrustFrameworkParticipantCreateInput,
  TrustFrameworkParticipantUpdate,
  TrustFrameworkParticipantListQuery,
  TrustFrameworkParticipantPage
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { endOfNthBusinessDay } from '../business-hours.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-74 — Trust Framework participant administration. The bank's own directory
 * role-holders (Org Admin / PBC / PTC / STC), with individual + organisational
 * T&C/DocuSign status, a turnover workflow (departure → replacement nomination), and
 * per-onboarding-stage SLA tracking. platform:operations:read (list/detail) /
 * platform:operations:write (register / nominate-replacement), enforced at the BFF
 * middleware AND re-checked here. One High-class audit per register/nominate. No PSU PII
 * (holder_display_name is an internal role-holder name).
 */

export const TF_READ_SCOPE = 'platform:operations:read'
export const TF_WRITE_SCOPE = 'platform:operations:write'

export const TF_ROLES = ['org_admin', 'pbc', 'ptc', 'stc'] as const
/** Default onboarding-stage SLA (business days) until the bank overrides (Interaction Guide). */
const STAGE_SLA_BD = 5

export class TrustFrameworkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface TrustFrameworkParticipantWire extends StoredTrustFrameworkParticipant {
  onboarding_stage_overdue: boolean
}

function toWire(r: StoredTrustFrameworkParticipant, now: Date): TrustFrameworkParticipantWire {
  return {
    ...r,
    onboarding_stage_overdue: r.onboarding_stage_due_at ? now.getTime() > new Date(r.onboarding_stage_due_at).getTime() : false
  }
}

export interface TrustFrameworkParticipantStore {
  create(input: TrustFrameworkParticipantCreateInput, traceId: string): Promise<StoredTrustFrameworkParticipant>
  get(id: string): Promise<StoredTrustFrameworkParticipant | null>
  list(query: TrustFrameworkParticipantListQuery): Promise<TrustFrameworkParticipantPage>
  update(id: string, patch: TrustFrameworkParticipantUpdate, traceId: string): Promise<StoredTrustFrameworkParticipant | null>
}

/** No-database default (tests / local dev). The worker wires PgTrustFrameworkParticipantStore. */
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

export interface TrustFrameworkServiceDeps {
  store: TrustFrameworkParticipantStore
  audit: HighClassAuditSink
  now?: () => Date
}

export class TrustFrameworkService {
  private readonly now: () => Date
  constructor(private readonly deps: TrustFrameworkServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async register(
    principal: Principal,
    input: { role?: string; organisation_id?: string; holder_ref?: string; holder_display_name?: string; onboarding_stage?: string | null },
    traceId: string
  ): Promise<TrustFrameworkParticipantWire> {
    assertScope(principal, TF_WRITE_SCOPE)
    if (!input.role || !input.organisation_id || !input.holder_ref || !input.holder_display_name) {
      throw new TrustFrameworkError('BACKOFFICE.INVALID_BODY', 'role, organisation_id, holder_ref and holder_display_name are required.', 400)
    }
    if (!(TF_ROLES as readonly string[]).includes(input.role)) {
      throw new TrustFrameworkError('BACKOFFICE.INVALID_ROLE', `role must be one of: ${TF_ROLES.join(', ')}.`, 400)
    }
    const record = await this.deps.store.create(
      {
        role: input.role,
        organisation_id: input.organisation_id,
        holder_ref: input.holder_ref,
        holder_display_name: input.holder_display_name,
        onboarding_stage: input.onboarding_stage ?? null,
        // SLA clock for the current onboarding stage (only when a stage is given).
        onboarding_stage_due_at: input.onboarding_stage ? endOfNthBusinessDay(this.now(), STAGE_SLA_BD).toISOString() : null
      },
      traceId
    )
    await this.deps.audit.emit({
      event_type: 'trust_framework_participant_registered',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: TF_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { participant_id: record.id, role: input.role, organisation_id: input.organisation_id, holder_ref: input.holder_ref, onboarding_stage: input.onboarding_stage ?? null },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return toWire(record, this.now())
  }

  async list(
    principal: Principal,
    query: { cursor?: string; limit?: number; role?: string; status?: string }
  ): Promise<{ rows: TrustFrameworkParticipantWire[]; next_cursor: string | null }> {
    assertScope(principal, TF_READ_SCOPE)
    const page = await this.deps.store.list({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {})
    })
    const now = this.now()
    return { rows: page.rows.map((r) => toWire(r, now)), next_cursor: page.next_cursor }
  }

  async get(principal: Principal, id: string): Promise<TrustFrameworkParticipantWire> {
    assertScope(principal, TF_READ_SCOPE)
    const record = await this.deps.store.get(id)
    if (!record) throw new TrustFrameworkError('BACKOFFICE.PARTICIPANT_NOT_FOUND', 'No Trust Framework participant matches that id.', 404)
    return toWire(record, this.now())
  }

  async nominateReplacement(
    principal: Principal,
    id: string,
    input: { replacement_holder_ref?: string; replacement_display_name?: string; note?: string },
    traceId: string
  ): Promise<TrustFrameworkParticipantWire> {
    assertScope(principal, TF_WRITE_SCOPE)
    if (!input.replacement_holder_ref || !input.replacement_display_name || !input.note || input.note.trim().length < 20) {
      throw new TrustFrameworkError('BACKOFFICE.INVALID_BODY', 'replacement_holder_ref, replacement_display_name and a note (≥20 chars) are required.', 400)
    }
    const existing = await this.deps.store.get(id)
    if (!existing) throw new TrustFrameworkError('BACKOFFICE.PARTICIPANT_NOT_FOUND', 'No Trust Framework participant matches that id.', 404)

    const updated = await this.deps.store.update(id, { status: 'departing', nominated_replacement_ref: input.replacement_holder_ref }, traceId)
    if (!updated) throw new TrustFrameworkError('BACKOFFICE.PARTICIPANT_NOT_FOUND', 'No Trust Framework participant matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'trust_framework_replacement_nominated',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: TF_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { participant_id: id, replacement_holder_ref: input.replacement_holder_ref, replacement_display_name: input.replacement_display_name, note: input.note },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return toWire(updated, this.now())
  }
}
