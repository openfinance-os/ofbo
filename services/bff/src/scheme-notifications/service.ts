import type {
  StoredSchemeNotification,
  SchemeNotificationCreateInput,
  SchemeNotificationUpdate,
  SchemeNotificationListQuery,
  SchemeNotificationPage
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-78 — outbound downtime/change notifications to Nebras. Raising a
 * notification (platform:operations:write) starts the notice clock: 10 days for
 * planned maintenance / version releases, 30 days for breaking changes (which also
 * require a dual-running checklist). notice_compliant records whether the notice was
 * given with sufficient lead time. Acknowledgment is tracked; the list
 * (platform:operations:read) feeds the Ops Console. Both scopes enforced at the BFF
 * middleware AND re-checked here. One High-class audit per raise/acknowledge; the
 * store emits BCBS 239 lineage. No PSU PII (title/description are change text).
 */

export const NOTIFICATION_READ_SCOPE = 'platform:operations:read'
export const NOTIFICATION_WRITE_SCOPE = 'platform:operations:write'

export const NOTIFICATION_TYPES = ['planned_maintenance', 'version_release', 'breaking_change'] as const

const DAY_MS = 24 * 60 * 60 * 1000
const BREAKING_CHANGE_NOTICE_DAYS = 30
const STANDARD_NOTICE_DAYS = 10

/** Breaking changes need 30 days' notice; planned maintenance / version releases 10. */
export function noticeRequiredDays(notificationType: string): number {
  return notificationType === 'breaking_change' ? BREAKING_CHANGE_NOTICE_DAYS : STANDARD_NOTICE_DAYS
}

/** Latest compliant notice time = scheduled_start − notice_required_days (calendar). */
export function noticeDeadline(scheduledStart: Date, days: number): Date {
  return new Date(scheduledStart.getTime() - days * DAY_MS)
}

export class SchemeNotificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface SchemeNotificationStore {
  create(input: SchemeNotificationCreateInput, traceId: string): Promise<StoredSchemeNotification>
  get(id: string): Promise<StoredSchemeNotification | null>
  list(query: SchemeNotificationListQuery): Promise<SchemeNotificationPage>
  update(id: string, patch: SchemeNotificationUpdate, traceId: string): Promise<StoredSchemeNotification | null>
}

/** No-database default (tests / local dev). The worker wires PgSchemeNotificationStore. */
export class InMemorySchemeNotificationStore implements SchemeNotificationStore {
  private readonly rows: StoredSchemeNotification[] = []
  async create(input: SchemeNotificationCreateInput): Promise<StoredSchemeNotification> {
    const record: StoredSchemeNotification = {
      id: crypto.randomUUID(),
      notification_type: input.notification_type,
      title: input.title,
      description: input.description ?? null,
      scheduled_start: input.scheduled_start,
      scheduled_end: input.scheduled_end,
      notice_required_days: input.notice_required_days,
      notified_at: input.notified_at ?? null,
      notice_deadline: input.notice_deadline,
      notice_compliant: input.notice_compliant,
      dual_running_required: input.dual_running_required,
      dual_running_complete: false,
      acknowledged: false,
      acknowledged_at: null,
      nebras_ack_reference: null,
      propagate_to_tpp: input.propagate_to_tpp,
      status: input.status,
      created_by: input.created_by,
      created_at: new Date().toISOString()
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredSchemeNotification | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: SchemeNotificationListQuery): Promise<SchemeNotificationPage> {
    let rows = this.rows
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.notification_type) rows = rows.filter((r) => r.notification_type === query.notification_type)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: SchemeNotificationUpdate): Promise<StoredSchemeNotification | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.acknowledged !== undefined) r.acknowledged = patch.acknowledged
    if (patch.acknowledged_at !== undefined) r.acknowledged_at = patch.acknowledged_at
    if (patch.nebras_ack_reference !== undefined) r.nebras_ack_reference = patch.nebras_ack_reference
    if (patch.dual_running_complete !== undefined) r.dual_running_complete = patch.dual_running_complete
    return r
  }
}

export interface SchemeNotificationServiceDeps {
  store: SchemeNotificationStore
  audit: HighClassAuditSink
  now?: () => Date
}

export class SchemeNotificationService {
  private readonly now: () => Date
  constructor(private readonly deps: SchemeNotificationServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async raise(
    principal: Principal,
    input: {
      notification_type?: string
      title?: string
      description?: string | null
      scheduled_start?: string
      scheduled_end?: string
      propagate_to_tpp?: boolean
    },
    traceId: string
  ): Promise<StoredSchemeNotification> {
    assertScope(principal, NOTIFICATION_WRITE_SCOPE)
    if (!input.notification_type || !input.title || !input.scheduled_start || !input.scheduled_end) {
      throw new SchemeNotificationError('BACKOFFICE.INVALID_BODY', 'notification_type, title, scheduled_start and scheduled_end are required.', 400)
    }
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(input.notification_type)) {
      throw new SchemeNotificationError('BACKOFFICE.INVALID_NOTIFICATION_TYPE', `notification_type must be one of: ${NOTIFICATION_TYPES.join(', ')}.`, 400)
    }
    const start = new Date(input.scheduled_start)
    const end = new Date(input.scheduled_end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new SchemeNotificationError('BACKOFFICE.INVALID_BODY', 'scheduled_start and scheduled_end must be ISO 8601 timestamps.', 400)
    }
    if (end.getTime() < start.getTime()) {
      throw new SchemeNotificationError('BACKOFFICE.INVALID_BODY', 'scheduled_end must not be before scheduled_start.', 400)
    }

    const days = noticeRequiredDays(input.notification_type)
    const deadline = noticeDeadline(start, days)
    const now = this.now()
    const record = await this.deps.store.create(
      {
        notification_type: input.notification_type,
        title: input.title,
        description: input.description ?? null,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        notice_required_days: days,
        notified_at: now.toISOString(),
        notice_deadline: deadline.toISOString(),
        // Compliant when the notice is given on/before the latest compliant notice time.
        notice_compliant: now.getTime() <= deadline.getTime(),
        dual_running_required: input.notification_type === 'breaking_change',
        propagate_to_tpp: input.propagate_to_tpp ?? true,
        status: 'notified',
        created_by: principal.subject
      },
      traceId
    )

    await this.deps.audit.emit({
      event_type: 'scheme_notification_raised',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: NOTIFICATION_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: {
        notification_id: record.id,
        notification_type: input.notification_type,
        scheduled_start: record.scheduled_start,
        notice_required_days: days,
        notice_deadline: record.notice_deadline,
        notice_compliant: record.notice_compliant,
        propagate_to_tpp: record.propagate_to_tpp
      },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return record
  }

  async list(
    principal: Principal,
    query: { cursor?: string; limit?: number; status?: string; notification_type?: string }
  ): Promise<SchemeNotificationPage> {
    assertScope(principal, NOTIFICATION_READ_SCOPE)
    return this.deps.store.list({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.notification_type ? { notification_type: query.notification_type } : {})
    })
  }

  async acknowledge(
    principal: Principal,
    id: string,
    input: { nebras_ack_reference?: string },
    traceId: string
  ): Promise<StoredSchemeNotification> {
    assertScope(principal, NOTIFICATION_WRITE_SCOPE)
    if (!input.nebras_ack_reference || input.nebras_ack_reference.trim().length === 0) {
      throw new SchemeNotificationError('BACKOFFICE.INVALID_BODY', 'nebras_ack_reference is required.', 400)
    }
    const existing = await this.deps.store.get(id)
    if (!existing) throw new SchemeNotificationError('BACKOFFICE.SCHEME_NOTIFICATION_NOT_FOUND', 'No scheme notification matches that id.', 404)

    const updated = await this.deps.store.update(
      id,
      { status: 'acknowledged', acknowledged: true, acknowledged_at: this.now().toISOString(), nebras_ack_reference: input.nebras_ack_reference },
      traceId
    )
    if (!updated) throw new SchemeNotificationError('BACKOFFICE.SCHEME_NOTIFICATION_NOT_FOUND', 'No scheme notification matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'scheme_notification_acknowledged',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: NOTIFICATION_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { notification_id: id, nebras_ack_reference: input.nebras_ack_reference },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return updated
  }
}
