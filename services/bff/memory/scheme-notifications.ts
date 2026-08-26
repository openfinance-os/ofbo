// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/scheme-notifications/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { SchemeNotificationStore } from '../src/scheme-notifications/service.js'
import type {
  StoredSchemeNotification,
  SchemeNotificationCreateInput,
  SchemeNotificationUpdate,
  SchemeNotificationListQuery,
  SchemeNotificationPage
} from '@ofbo/db'

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
