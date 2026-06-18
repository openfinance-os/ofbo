import type {
  StoredRespondentDispute,
  RespondentDisputeCreateInput,
  RespondentDisputeUpdate,
  RespondentDisputeListQuery,
  RespondentDisputePage
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { endOfNthBusinessDay } from '../business-hours.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-75 — respondent-side Nebras dispute scheme clocks. The bank is the
 * RESPONDENT in a dispute Nebras raised against it (distinct from the PSU-raised
 * dispute_case of BACKOFFICE-20/-21/-24). Clocks (BD-16 defaults): response 3 bd
 * and formal resolution 15 bd start from raised_at; appeal 3 bd starts at the
 * verdict; implementation 3 bd starts at the final verdict. Owned by Finance
 * (finance:disputes:write), enforced at the BFF middleware AND re-checked here.
 * Each amber/red breach risk is queryable (the breach_status list filter) so the
 * Compliance View surfaces supervisory-action exposure. No PSU PII.
 */

export const RESPONDENT_DISPUTE_SCOPE = 'finance:disputes:write'

export const RESPONDENT_CATEGORIES = ['billing', 'consent', 'data_sharing', 'liability', 'conduct', 'other'] as const
export const VERDICT_OUTCOMES = ['upheld', 'partially_upheld', 'rejected'] as const
export const RESPONDENT_ACTIONS = ['respond', 'record_verdict', 'appeal', 'record_final_verdict', 'implement'] as const
export type RespondentAction = (typeof RESPONDENT_ACTIONS)[number]

const RESPONSE_BD = 3
const RESOLUTION_BD = 15
const APPEAL_BD = 3
const IMPLEMENTATION_BD = 3
const MIN_NOTE = 20
/** Amber window before a due date (BD default; configurable at enterprise adoption). */
export const AMBER_WINDOW_MS = 24 * 60 * 60 * 1000

export type SchemeClockStatus = 'on_track' | 'amber' | 'red'

/**
 * One clock's status. A not-yet-started clock (no due date) is on_track; a stopped
 * clock is on_track when met on/before due, red when met late; an active clock is
 * red past due, amber within the warning window, else on_track.
 */
export function clockStatus(dueAt: string | null, stoppedAt: string | null, now: Date): SchemeClockStatus {
  if (!dueAt) return 'on_track'
  const due = new Date(dueAt).getTime()
  if (stoppedAt) return new Date(stoppedAt).getTime() <= due ? 'on_track' : 'red'
  const t = now.getTime()
  if (t > due) return 'red'
  if (t >= due - AMBER_WINDOW_MS) return 'amber'
  return 'on_track'
}

export function overallStatus(statuses: SchemeClockStatus[]): SchemeClockStatus {
  if (statuses.includes('red')) return 'red'
  if (statuses.includes('amber')) return 'amber'
  return 'on_track'
}

export interface RespondentDisputeWire extends StoredRespondentDispute {
  response_clock_status: SchemeClockStatus
  resolution_clock_status: SchemeClockStatus
  appeal_clock_status: SchemeClockStatus
  implementation_clock_status: SchemeClockStatus
  overall_breach_status: SchemeClockStatus
}

/** Decorate a stored record with the now-relative clock statuses (the wire shape). */
export function toWire(r: StoredRespondentDispute, now: Date): RespondentDisputeWire {
  const response = clockStatus(r.response_due_at, r.responded_at, now)
  const resolution = clockStatus(r.resolution_due_at, r.resolved_at, now)
  const appeal = clockStatus(r.appeal_due_at, r.appealed_at, now)
  const implementation = clockStatus(r.implementation_due_at, r.implemented_at, now)
  return {
    ...r,
    response_clock_status: response,
    resolution_clock_status: resolution,
    appeal_clock_status: appeal,
    implementation_clock_status: implementation,
    overall_breach_status: overallStatus([response, resolution, appeal, implementation])
  }
}

export class RespondentDisputeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface RespondentDisputeStore {
  create(input: RespondentDisputeCreateInput, traceId: string): Promise<StoredRespondentDispute>
  get(id: string): Promise<StoredRespondentDispute | null>
  list(query: RespondentDisputeListQuery): Promise<RespondentDisputePage>
  update(id: string, patch: RespondentDisputeUpdate, traceId: string): Promise<StoredRespondentDispute | null>
}

/** No-database default (tests / local dev). Not isolate-safe — the worker wires the
 *  durable PgRespondentDisputeStore. */
export class InMemoryRespondentDisputeStore implements RespondentDisputeStore {
  private readonly rows: StoredRespondentDispute[] = []
  async create(input: RespondentDisputeCreateInput): Promise<StoredRespondentDispute> {
    const record: StoredRespondentDispute = {
      id: crypto.randomUUID(),
      nebras_dispute_ref: input.nebras_dispute_ref,
      category: input.category,
      subject_summary: input.subject_summary ?? null,
      raised_at: input.raised_at,
      originating_break_id: input.originating_break_id ?? null,
      state: 'received',
      response_due_at: input.response_due_at,
      responded_at: null,
      resolution_due_at: input.resolution_due_at,
      resolved_at: null,
      appeal_due_at: null,
      appealed_at: null,
      implementation_due_at: null,
      implemented_at: null,
      verdict_outcome: null,
      created_at: new Date().toISOString()
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredRespondentDispute | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: RespondentDisputeListQuery): Promise<RespondentDisputePage> {
    let rows = this.rows
    if (query.state) rows = rows.filter((r) => r.state === query.state)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: RespondentDisputeUpdate): Promise<StoredRespondentDispute | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.state !== undefined) r.state = patch.state
    if (patch.responded_at !== undefined && patch.responded_at !== null) r.responded_at = patch.responded_at
    if (patch.resolved_at !== undefined && patch.resolved_at !== null) r.resolved_at = patch.resolved_at
    if (patch.appeal_due_at !== undefined && patch.appeal_due_at !== null) r.appeal_due_at = patch.appeal_due_at
    if (patch.appealed_at !== undefined && patch.appealed_at !== null) r.appealed_at = patch.appealed_at
    if (patch.implementation_due_at !== undefined && patch.implementation_due_at !== null) r.implementation_due_at = patch.implementation_due_at
    if (patch.implemented_at !== undefined && patch.implemented_at !== null) r.implemented_at = patch.implemented_at
    if (patch.verdict_outcome !== undefined && patch.verdict_outcome !== null) r.verdict_outcome = patch.verdict_outcome
    return r
  }
}

/** action → the from-states it is legal from, and the state it moves to. */
const ACTION_TRANSITIONS: Record<RespondentAction, { from: string[]; to: string }> = {
  respond: { from: ['received'], to: 'responded' },
  record_verdict: { from: ['responded', 'under_resolution'], to: 'resolved' },
  appeal: { from: ['resolved'], to: 'appealed' },
  record_final_verdict: { from: ['appealed', 'resolved'], to: 'awaiting_implementation' },
  implement: { from: ['awaiting_implementation'], to: 'implemented' }
}

export interface RespondentDisputeServiceDeps {
  store: RespondentDisputeStore
  audit: HighClassAuditSink
  now?: () => Date
}

export class RespondentDisputeService {
  private readonly now: () => Date
  constructor(private readonly deps: RespondentDisputeServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async register(
    principal: Principal,
    input: {
      nebras_dispute_ref?: string
      category?: string
      subject_summary?: string | null
      raised_at?: string
      originating_break_id?: string | null
    },
    traceId: string
  ): Promise<RespondentDisputeWire> {
    assertScope(principal, RESPONDENT_DISPUTE_SCOPE)
    if (!input.nebras_dispute_ref || !input.category || !input.raised_at) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_BODY', 'nebras_dispute_ref, category and raised_at are required.', 400)
    }
    if (!(RESPONDENT_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_CATEGORY', `category must be one of: ${RESPONDENT_CATEGORIES.join(', ')}.`, 400)
    }
    const raised = new Date(input.raised_at)
    if (Number.isNaN(raised.getTime())) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_BODY', 'raised_at must be an ISO 8601 timestamp.', 400)
    }

    const record = await this.deps.store.create(
      {
        nebras_dispute_ref: input.nebras_dispute_ref,
        category: input.category,
        subject_summary: input.subject_summary ?? null,
        raised_at: raised.toISOString(),
        originating_break_id: input.originating_break_id ?? null,
        response_due_at: endOfNthBusinessDay(raised, RESPONSE_BD).toISOString(),
        resolution_due_at: endOfNthBusinessDay(raised, RESOLUTION_BD).toISOString()
      },
      traceId
    )

    await this.deps.audit.emit({
      event_type: 'respondent_dispute_registered',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RESPONDENT_DISPUTE_SCOPE,
      target_dispute_id: record.id,
      request_trace_id: traceId,
      request_body: {
        nebras_dispute_ref: input.nebras_dispute_ref,
        category: input.category,
        raised_at: record.raised_at,
        originating_break_id: input.originating_break_id ?? null
      },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return toWire(record, this.now())
  }

  async list(
    principal: Principal,
    query: { cursor?: string; limit?: number; state?: string; breach_status?: string }
  ): Promise<{ rows: RespondentDisputeWire[]; next_cursor: string | null }> {
    assertScope(principal, RESPONDENT_DISPUTE_SCOPE)
    const page = await this.deps.store.list({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.state ? { state: query.state } : {})
    })
    const now = this.now()
    let rows = page.rows.map((r) => toWire(r, now))
    // breach_status is a derived, now-relative status, so it is filtered after the
    // clocks are computed (over the fetched page).
    if (query.breach_status) rows = rows.filter((r) => r.overall_breach_status === query.breach_status)
    return { rows, next_cursor: page.next_cursor }
  }

  async get(principal: Principal, id: string): Promise<RespondentDisputeWire> {
    assertScope(principal, RESPONDENT_DISPUTE_SCOPE)
    const record = await this.deps.store.get(id)
    if (!record) throw new RespondentDisputeError('BACKOFFICE.RESPONDENT_DISPUTE_NOT_FOUND', 'No respondent dispute matches that id.', 404)
    return toWire(record, this.now())
  }

  /**
   * Record a respondent-side lifecycle action that stops / starts a scheme clock.
   * respond → stops the response clock; record_verdict → resolution met, starts the
   * appeal clock (3 bd); appeal → records the bank's appeal; record_final_verdict →
   * starts the implementation clock (3 bd); implement → stops implementation. Each
   * action requires a note (≥20 chars) and writes one immutable High-class audit.
   */
  async advance(
    principal: Principal,
    id: string,
    input: { action?: string; note?: string; verdict_outcome?: string | null },
    traceId: string
  ): Promise<RespondentDisputeWire> {
    assertScope(principal, RESPONDENT_DISPUTE_SCOPE)
    const action = input.action
    if (!action || !(RESPONDENT_ACTIONS as readonly string[]).includes(action)) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_ACTION', `action must be one of: ${RESPONDENT_ACTIONS.join(', ')}.`, 400)
    }
    if (!input.note || input.note.trim().length < MIN_NOTE) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_BODY', `note is required and must be at least ${MIN_NOTE} characters.`, 400)
    }
    const verdictActions = action === 'record_verdict' || action === 'record_final_verdict'
    if (verdictActions) {
      if (!input.verdict_outcome || !(VERDICT_OUTCOMES as readonly string[]).includes(input.verdict_outcome)) {
        throw new RespondentDisputeError('BACKOFFICE.INVALID_BODY', `verdict_outcome (${VERDICT_OUTCOMES.join(', ')}) is required for ${action}.`, 400)
      }
    }

    const record = await this.deps.store.get(id)
    if (!record) throw new RespondentDisputeError('BACKOFFICE.RESPONDENT_DISPUTE_NOT_FOUND', 'No respondent dispute matches that id.', 404)

    const transition = ACTION_TRANSITIONS[action as RespondentAction]
    if (!transition.from.includes(record.state)) {
      throw new RespondentDisputeError('BACKOFFICE.INVALID_TRANSITION', `cannot ${action} a respondent dispute in state ${record.state}.`, 409)
    }

    const nowIso = this.now().toISOString()
    const patch: RespondentDisputeUpdate = { state: transition.to }
    switch (action) {
      case 'respond':
        patch.responded_at = nowIso
        break
      case 'record_verdict':
        patch.resolved_at = nowIso
        patch.verdict_outcome = input.verdict_outcome!
        patch.appeal_due_at = endOfNthBusinessDay(this.now(), APPEAL_BD).toISOString()
        break
      case 'appeal':
        patch.appealed_at = nowIso
        break
      case 'record_final_verdict':
        patch.verdict_outcome = input.verdict_outcome!
        patch.implementation_due_at = endOfNthBusinessDay(this.now(), IMPLEMENTATION_BD).toISOString()
        break
      case 'implement':
        patch.implemented_at = nowIso
        break
    }

    const updated = await this.deps.store.update(id, patch, traceId)
    if (!updated) throw new RespondentDisputeError('BACKOFFICE.RESPONDENT_DISPUTE_NOT_FOUND', 'No respondent dispute matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'respondent_dispute_advanced',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RESPONDENT_DISPUTE_SCOPE,
      target_dispute_id: id,
      request_trace_id: traceId,
      request_body: {
        action,
        note: input.note,
        verdict_outcome: input.verdict_outcome ?? null,
        from_state: record.state,
        to_state: updated.state
      },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return toWire(updated, this.now())
  }
}
