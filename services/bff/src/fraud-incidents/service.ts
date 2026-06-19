import type { ItsmPort } from '@ofbo/ports'
import type {
  StoredFraudIncident,
  FraudIncidentCreateInput,
  FraudIncidentUpdate,
  FraudIncidentListQuery,
  FraudIncidentPage
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-77 — Nebras fraud-incident reporting + scheme-imposed holds. The
 * report step (risk:investigations:write) maps the Nebras P1–P4 severity to the
 * ITSM (P3) priority scheme, raises a P3 ticket, opens the customer operational
 * pause, and flags scheme-imposed holds for systemic P1 events. Read (risk:read)
 * lists incidents for the Ops + Risk Views. Both scopes enforced at the BFF
 * middleware AND re-checked here. One High-class audit per report/resolve; the
 * store emits BCBS 239 lineage. No PSU PII (summary is synthetic operator text).
 */

export const FRAUD_READ_SCOPE = 'risk:read'
export const FRAUD_WRITE_SCOPE = 'risk:investigations:write'

export const NEBRAS_SEVERITIES = ['P1', 'P2', 'P3', 'P4'] as const
export const FRAUD_STATUSES = ['open', 'reported', 'resolved'] as const

/** Nebras P1–P4 severity taxonomy → ITSM (P3) priority scheme (PRD §7 BACKOFFICE-77). */
const SEVERITY_TO_PRIORITY: Record<string, string> = { P1: 'critical', P2: 'high', P3: 'medium', P4: 'low' }
export function itsmPriorityFor(severity: string): string {
  return SEVERITY_TO_PRIORITY[severity] ?? 'medium'
}
/** ITSM port accepts low|medium|high|critical, which is exactly the mapped set. */
type ItsmSeverity = 'low' | 'medium' | 'high' | 'critical'

export class FraudIncidentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface FraudIncidentStore {
  create(input: FraudIncidentCreateInput, traceId: string): Promise<StoredFraudIncident>
  get(id: string): Promise<StoredFraudIncident | null>
  list(query: FraudIncidentListQuery): Promise<FraudIncidentPage>
  update(id: string, patch: FraudIncidentUpdate, traceId: string): Promise<StoredFraudIncident | null>
}

/** No-database default (tests / local dev). The worker wires PgFraudIncidentStore. */
export class InMemoryFraudIncidentStore implements FraudIncidentStore {
  private readonly rows: StoredFraudIncident[] = []
  async create(input: FraudIncidentCreateInput): Promise<StoredFraudIncident> {
    const now = new Date().toISOString()
    const record: StoredFraudIncident = {
      id: crypto.randomUUID(),
      consent_id: input.consent_id ?? null,
      client_id: input.client_id ?? null,
      nebras_severity: input.nebras_severity,
      itsm_priority: input.itsm_priority,
      nebras_case_reference: input.nebras_case_reference ?? null,
      status: input.status,
      operational_pause: input.operational_pause,
      scheme_imposed_hold: input.scheme_imposed_hold,
      summary: input.summary,
      opened_by: input.opened_by,
      opened_at: now,
      reported_at: input.reported_at ?? null,
      resolved_at: null
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredFraudIncident | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: FraudIncidentListQuery): Promise<FraudIncidentPage> {
    let rows = this.rows
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.nebras_severity) rows = rows.filter((r) => r.nebras_severity === query.nebras_severity)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: FraudIncidentUpdate): Promise<StoredFraudIncident | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.operational_pause !== undefined) r.operational_pause = patch.operational_pause
    if (patch.resolved_at !== undefined) r.resolved_at = patch.resolved_at
    return r
  }
}

export interface FraudIncidentServiceDeps {
  store: FraudIncidentStore
  itsm: Pick<ItsmPort, 'createTicket'>
  audit: HighClassAuditSink
  now?: () => Date
}

export class FraudIncidentService {
  private readonly now: () => Date
  constructor(private readonly deps: FraudIncidentServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async report(
    principal: Principal,
    input: {
      consent_id?: string | null
      client_id?: string | null
      nebras_severity?: string
      nebras_case_reference?: string | null
      operational_pause?: boolean
      summary?: string
    },
    traceId: string
  ): Promise<StoredFraudIncident> {
    assertScope(principal, FRAUD_WRITE_SCOPE)
    if (!input.nebras_severity || !input.summary) {
      throw new FraudIncidentError('BACKOFFICE.INVALID_BODY', 'nebras_severity and summary are required.', 400)
    }
    if (!(NEBRAS_SEVERITIES as readonly string[]).includes(input.nebras_severity)) {
      throw new FraudIncidentError('BACKOFFICE.INVALID_SEVERITY', `nebras_severity must be one of: ${NEBRAS_SEVERITIES.join(', ')}.`, 400)
    }
    const itsm_priority = itsmPriorityFor(input.nebras_severity)
    const operational_pause = input.operational_pause ?? true
    // Systemic-fraud P1 events are scheme-imposed holds/temporary revocations on the bank.
    const scheme_imposed_hold = input.nebras_severity === 'P1'
    const reportedAt = this.now().toISOString()

    const record = await this.deps.store.create(
      {
        consent_id: input.consent_id ?? null,
        client_id: input.client_id ?? null,
        nebras_severity: input.nebras_severity,
        itsm_priority,
        nebras_case_reference: input.nebras_case_reference ?? null,
        status: 'reported',
        operational_pause,
        scheme_imposed_hold,
        summary: input.summary,
        opened_by: principal.subject,
        reported_at: reportedAt
      },
      traceId
    )

    // Map to the ITSM (P3) priority scheme and raise a P3 ticket on the risk queue.
    await this.deps.itsm.createTicket(
      {
        type: 'nebras_fraud_incident',
        severity: itsm_priority as ItsmSeverity,
        team: 'risk',
        summary: `Nebras fraud incident (${input.nebras_severity}${scheme_imposed_hold ? ', scheme-imposed hold' : ''}): ${input.summary}`
      },
      { trace_id: traceId }
    )

    await this.deps.audit.emit({
      event_type: 'fraud_incident_reported',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: FRAUD_WRITE_SCOPE,
      target_consent_id: input.consent_id ?? null,
      request_trace_id: traceId,
      request_body: {
        incident_id: record.id,
        nebras_severity: input.nebras_severity,
        itsm_priority,
        scheme_imposed_hold,
        operational_pause,
        nebras_case_reference: input.nebras_case_reference ?? null,
        client_id: input.client_id ?? null
      },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return record
  }

  async list(
    principal: Principal,
    query: { cursor?: string; limit?: number; status?: string; nebras_severity?: string }
  ): Promise<FraudIncidentPage> {
    assertScope(principal, FRAUD_READ_SCOPE)
    return this.deps.store.list({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.nebras_severity ? { nebras_severity: query.nebras_severity } : {})
    })
  }

  async resolve(
    principal: Principal,
    id: string,
    input: { resolution_note?: string },
    traceId: string
  ): Promise<StoredFraudIncident> {
    assertScope(principal, FRAUD_WRITE_SCOPE)
    if (!input.resolution_note || input.resolution_note.trim().length === 0) {
      throw new FraudIncidentError('BACKOFFICE.INVALID_BODY', 'resolution_note is required.', 400)
    }
    const incident = await this.deps.store.get(id)
    if (!incident) throw new FraudIncidentError('BACKOFFICE.FRAUD_INCIDENT_NOT_FOUND', 'No fraud incident matches that id.', 404)

    const updated = await this.deps.store.update(
      id,
      { status: 'resolved', operational_pause: false, resolved_at: this.now().toISOString() },
      traceId
    )
    if (!updated) throw new FraudIncidentError('BACKOFFICE.FRAUD_INCIDENT_NOT_FOUND', 'No fraud incident matches that id.', 404)

    await this.deps.audit.emit({
      event_type: 'fraud_incident_resolved',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: FRAUD_WRITE_SCOPE,
      target_consent_id: incident.consent_id,
      request_trace_id: traceId,
      request_body: { incident_id: id, resolution_note: input.resolution_note, from_status: incident.status },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return updated
  }
}
