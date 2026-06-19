import type {
  StoredServiceDeskCase,
  ServiceDeskCaseCreateInput,
  ServiceDeskCaseUpdate,
  ServiceDeskCaseListQuery,
  ServiceDeskCasePage
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-79 — Nebras service-desk case tracking. Any case raised with the Nebras
 * service desk (incident, billing query, onboarding, general), tracked by Nebras case
 * reference with type, priority, and the Interaction-Guide SLA, optionally linked to the
 * originating break / dispute / risk signal. platform:operations:read (list/detail) /
 * platform:operations:write (track / update), enforced at the BFF middleware AND
 * re-checked here. One High-class audit per track/update. No PSU PII.
 */

export const SD_READ_SCOPE = 'platform:operations:read'
export const SD_WRITE_SCOPE = 'platform:operations:write'

export const SD_CASE_TYPES = ['incident', 'billing_query', 'onboarding', 'general'] as const
export const SD_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const
export const SD_STATUSES = ['open', 'in_progress', 'awaiting_nebras', 'resolved', 'closed'] as const

const HOUR_MS = 60 * 60 * 1000
/** Interaction-Guide SLA targets by priority (adopting-bank default until overridden). */
const SLA_MS_BY_PRIORITY: Record<string, number> = { P1: 4 * HOUR_MS, P2: 24 * HOUR_MS, P3: 3 * 24 * HOUR_MS, P4: 5 * 24 * HOUR_MS }
const TERMINAL_STATUSES = new Set(['resolved', 'closed'])
const MIN_NOTE = 20

export class ServiceDeskError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ServiceDeskCaseWire extends StoredServiceDeskCase {
  sla_overdue: boolean
}

function toWire(r: StoredServiceDeskCase, now: Date): ServiceDeskCaseWire {
  const overdue = !TERMINAL_STATUSES.has(r.status) && now.getTime() > new Date(r.sla_due_at).getTime()
  return { ...r, sla_overdue: overdue }
}

export interface ServiceDeskCaseStore {
  create(input: ServiceDeskCaseCreateInput, traceId: string): Promise<StoredServiceDeskCase>
  get(id: string): Promise<StoredServiceDeskCase | null>
  list(query: ServiceDeskCaseListQuery): Promise<ServiceDeskCasePage>
  update(id: string, patch: ServiceDeskCaseUpdate, traceId: string): Promise<StoredServiceDeskCase | null>
}

/** No-database default (tests / local dev). The worker wires PgServiceDeskCaseStore. */
export class InMemoryServiceDeskCaseStore implements ServiceDeskCaseStore {
  private readonly rows: StoredServiceDeskCase[] = []
  async create(input: ServiceDeskCaseCreateInput): Promise<StoredServiceDeskCase> {
    const now = new Date().toISOString()
    const record: StoredServiceDeskCase = {
      id: crypto.randomUUID(),
      nebras_case_reference: input.nebras_case_reference,
      case_type: input.case_type,
      priority: input.priority,
      status: input.status,
      summary: input.summary,
      sla_due_at: input.sla_due_at,
      linked_break_id: input.linked_break_id ?? null,
      linked_dispute_id: input.linked_dispute_id ?? null,
      linked_signal_id: input.linked_signal_id ?? null,
      opened_by: input.opened_by,
      opened_at: now,
      resolved_at: null,
      created_at: now
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredServiceDeskCase | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: ServiceDeskCaseListQuery): Promise<ServiceDeskCasePage> {
    let rows = this.rows
    if (query.case_type) rows = rows.filter((r) => r.case_type === query.case_type)
    if (query.priority) rows = rows.filter((r) => r.priority === query.priority)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: ServiceDeskCaseUpdate): Promise<StoredServiceDeskCase | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.priority !== undefined) r.priority = patch.priority
    if (patch.resolved_at !== undefined && patch.resolved_at !== null) r.resolved_at = patch.resolved_at
    return r
  }
}

export interface ServiceDeskServiceDeps {
  store: ServiceDeskCaseStore
  audit: HighClassAuditSink
  now?: () => Date
}

export class ServiceDeskService {
  private readonly now: () => Date
  constructor(private readonly deps: ServiceDeskServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async track(
    principal: Principal,
    input: {
      nebras_case_reference?: string
      case_type?: string
      priority?: string
      summary?: string
      linked_break_id?: string | null
      linked_dispute_id?: string | null
      linked_signal_id?: string | null
    },
    traceId: string
  ): Promise<ServiceDeskCaseWire> {
    assertScope(principal, SD_WRITE_SCOPE)
    if (!input.nebras_case_reference || !input.case_type || !input.priority || !input.summary) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_BODY', 'nebras_case_reference, case_type, priority and summary are required.', 400)
    }
    if (!(SD_CASE_TYPES as readonly string[]).includes(input.case_type)) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_CASE_TYPE', `case_type must be one of: ${SD_CASE_TYPES.join(', ')}.`, 400)
    }
    if (!(SD_PRIORITIES as readonly string[]).includes(input.priority)) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_PRIORITY', `priority must be one of: ${SD_PRIORITIES.join(', ')}.`, 400)
    }
    const now = this.now()
    const slaDueAt = new Date(now.getTime() + (SLA_MS_BY_PRIORITY[input.priority] ?? SLA_MS_BY_PRIORITY.P3!)).toISOString()
    const record = await this.deps.store.create(
      {
        nebras_case_reference: input.nebras_case_reference,
        case_type: input.case_type,
        priority: input.priority,
        status: 'open',
        summary: input.summary,
        sla_due_at: slaDueAt,
        linked_break_id: input.linked_break_id ?? null,
        linked_dispute_id: input.linked_dispute_id ?? null,
        linked_signal_id: input.linked_signal_id ?? null,
        opened_by: principal.subject
      },
      traceId
    )
    await this.deps.audit.emit({
      event_type: 'service_desk_case_tracked',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: SD_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: {
        case_id: record.id,
        nebras_case_reference: input.nebras_case_reference,
        case_type: input.case_type,
        priority: input.priority,
        linked_break_id: input.linked_break_id ?? null,
        linked_dispute_id: input.linked_dispute_id ?? null,
        linked_signal_id: input.linked_signal_id ?? null
      },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return toWire(record, this.now())
  }

  async list(
    principal: Principal,
    query: { cursor?: string; limit?: number; case_type?: string; priority?: string; status?: string }
  ): Promise<{ rows: ServiceDeskCaseWire[]; next_cursor: string | null }> {
    assertScope(principal, SD_READ_SCOPE)
    const page = await this.deps.store.list({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.case_type ? { case_type: query.case_type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.status ? { status: query.status } : {})
    })
    const now = this.now()
    return { rows: page.rows.map((r) => toWire(r, now)), next_cursor: page.next_cursor }
  }

  async get(principal: Principal, id: string): Promise<ServiceDeskCaseWire> {
    assertScope(principal, SD_READ_SCOPE)
    const record = await this.deps.store.get(id)
    if (!record) throw new ServiceDeskError('BACKOFFICE.SERVICE_DESK_CASE_NOT_FOUND', 'No service-desk case matches that id.', 404)
    return toWire(record, this.now())
  }

  async update(
    principal: Principal,
    id: string,
    input: { status?: string; priority?: string; note?: string },
    traceId: string
  ): Promise<ServiceDeskCaseWire> {
    assertScope(principal, SD_WRITE_SCOPE)
    if (!input.note || input.note.trim().length < MIN_NOTE) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_BODY', `note is required and must be at least ${MIN_NOTE} characters.`, 400)
    }
    if (input.status && !(SD_STATUSES as readonly string[]).includes(input.status)) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_STATUS', `status must be one of: ${SD_STATUSES.join(', ')}.`, 400)
    }
    if (input.priority && !(SD_PRIORITIES as readonly string[]).includes(input.priority)) {
      throw new ServiceDeskError('BACKOFFICE.INVALID_PRIORITY', `priority must be one of: ${SD_PRIORITIES.join(', ')}.`, 400)
    }
    const existing = await this.deps.store.get(id)
    if (!existing) throw new ServiceDeskError('BACKOFFICE.SERVICE_DESK_CASE_NOT_FOUND', 'No service-desk case matches that id.', 404)

    const patch: ServiceDeskCaseUpdate = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.status && TERMINAL_STATUSES.has(input.status) ? { resolved_at: this.now().toISOString() } : {})
    }
    const updated = await this.deps.store.update(id, patch, traceId)
    if (!updated) throw new ServiceDeskError('BACKOFFICE.SERVICE_DESK_CASE_NOT_FOUND', 'No service-desk case matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'service_desk_case_updated',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: SD_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { case_id: id, status: input.status ?? null, priority: input.priority ?? null, note: input.note },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return toWire(updated, this.now())
  }
}
