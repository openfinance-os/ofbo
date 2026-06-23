import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { ApprovalError, toWire } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-33 PR 5 — four-eyes registration of a NEW cross-fintech query purpose
 * (BD-13 / ADR 0015: Option 1 + four-eyes). The BD-13 starter set is seeded pre-approved;
 * this endpoint governs purposes added afterwards. New scope compliance:query-purposes:write
 * (data governance owns the purpose registry). Gated: returns 202 + approval_request, and the
 * purpose becomes active (approved_by set) only when a DIFFERENT principal approves — it never
 * registers inline. Mirrors the consents:revoke-fraud gated pattern.
 */

export const QUERY_PURPOSE_REGISTER_SCOPE = 'compliance:query-purposes:write'
export const QUERY_PURPOSE_REGISTER_OPERATION = 'query_purpose.register'

/** snake_case identifier, unique per bank (mirrors the spec pattern). */
export const PURPOSE_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/

export interface RegisterPurposeInput {
  purpose_code: string
  description: string
  registered_by: string
  approved_by: string
  trace_id: string
}

/**
 * Persists an approved query purpose. The Pg-backed implementation (PgQueryPurposeRegistrar,
 * @ofbo/db) writes to query_purpose_registry with approved_by set + emits BCBS 239 lineage;
 * the in-memory one below backs the demo profile and tests.
 */
export interface QueryPurposeRegistrar {
  register(input: RegisterPurposeInput): Promise<void>
}

export class QueryPurposeRegistrarError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'QueryPurposeRegistrarError'
  }
}

export class InMemoryQueryPurposeRegistrar implements QueryPurposeRegistrar {
  readonly registered: RegisterPurposeInput[] = []
  async register(input: RegisterPurposeInput): Promise<void> {
    if (this.registered.some((r) => r.purpose_code === input.purpose_code)) {
      throw new QueryPurposeRegistrarError(409, 'BACKOFFICE.PURPOSE_ALREADY_REGISTERED', `query purpose '${input.purpose_code}' is already registered for this bank`)
    }
    this.registered.push(input)
  }
}

/**
 * The gated executor: runs only on the SECOND principal's approval. `ctx.approver` is the
 * approving principal (the four-eyes second pair of eyes) — recorded as approved_by, the value
 * that flips the purpose to active. registered_by carries the initiator from the payload.
 */
export function makeRegisterQueryPurposeOperation(deps: { registrar: QueryPurposeRegistrar; audit: HighClassAuditSink }): GatedOperation {
  return {
    initiatorScope: QUERY_PURPOSE_REGISTER_SCOPE,
    approverScope: QUERY_PURPOSE_REGISTER_SCOPE,
    execute: async (payload, ctx) => {
      const purposeCode = String(payload.purpose_code)
      const description = String(payload.description)
      const registeredBy = String(payload.initiated_by ?? 'unknown')
      const traceId = String(payload.trace_id ?? 'unknown')
      const approvedBy = ctx?.approver ?? 'unknown'
      const approverPersona = ctx?.approverPersona ?? 'unknown'

      await deps.registrar.register({ purpose_code: purposeCode, description, registered_by: registeredBy, approved_by: approvedBy, trace_id: traceId })

      await deps.audit.emit({
        event_type: 'query_purpose_registered',
        acting_principal: approvedBy, // the approver caused the active write
        acting_persona: approverPersona,
        scope_used: QUERY_PURPOSE_REGISTER_SCOPE,
        request_trace_id: traceId,
        // purpose_code is a format-validated identifier; registered_by/approved_by are operator
        // subjects (not PSU data). The free-text description is NOT echoed into the audit body.
        request_body: { purpose_code: purposeCode, registered_by: registeredBy, approved_by: approvedBy, four_eyes_approved: true },
        response_status: 200
      })

      return { purpose_code: purposeCode, status: 'Registered', registered_by: registeredBy, approved_by: approvedBy }
    }
  }
}

export interface QueryPurposeApprovalRequester {
  requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord>
}

export class RegisterQueryPurposeService {
  constructor(private readonly approvals: QueryPurposeApprovalRequester) {}

  async initiate(principal: Principal, input: { purpose_code: string; description: string }, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, QUERY_PURPOSE_REGISTER_SCOPE)
    return this.approvals.requestApproval(
      principal,
      {
        operation_type: QUERY_PURPOSE_REGISTER_OPERATION,
        operation_payload: {
          purpose_code: input.purpose_code,
          description: input.description,
          initiated_by: principal.subject,
          initiated_by_persona: principal.persona,
          trace_id: traceId
        }
      },
      traceId
    )
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const invalidBody = (c: Context, message: string, remediation: string) =>
  c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', message, remediation, DOCS_BASE), 400)

export function registerQueryPurposeRoutes(service: RegisterQueryPurposeService, idempotency: IdempotencyStore): Record<string, Handler> {
  const handler: Handler = async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return invalidBody(c, 'A JSON body is required.', 'Send { purpose_code, description }.')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return invalidBody(c, 'A JSON object body is required.', 'Send { purpose_code, description }.')
    }
    const b = raw as Record<string, unknown>
    // additionalProperties: false (ADR-aligned with the spec schema) — reject unmodelled fields
    // so approved_by/registered_by can never be caller-supplied.
    const extra = Object.keys(b).filter((k) => k !== 'purpose_code' && k !== 'description')
    if (extra.length > 0) {
      return invalidBody(c, `Unexpected field(s): ${extra.join(', ')}.`, 'Only purpose_code and description are accepted.')
    }
    if (typeof b.purpose_code !== 'string' || !PURPOSE_CODE_PATTERN.test(b.purpose_code)) {
      return invalidBody(c, 'purpose_code must be a snake_case identifier matching ^[a-z][a-z0-9_]{2,63}$.', 'Use lowercase letters, digits and underscores; start with a letter.')
    }
    if (typeof b.description !== 'string' || b.description.length < 8 || b.description.length > 280) {
      return invalidBody(c, 'description must be 8–280 characters.', 'Describe the class of cross-fintech aggregate reads this purpose authorises.')
    }
    const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
    try {
      const record = await service.initiate(c.get('principal'), { purpose_code: b.purpose_code, description: b.description }, traceId)
      return c.json(dataEnvelope(toWire(record)), 202)
    } catch (e) {
      const denied = scopeDenied(c, e)
      if (denied) return denied
      if (e instanceof ApprovalError) {
        return c.json(errorEnvelope(e.code, e.message, 'Registering a new cross-fintech query purpose is four-eyes-gated (BD-13 / ADR 0015).', DOCS_BASE), e.status as ContentfulStatusCode)
      }
      throw e
    }
  }

  const withIdempotency: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(
        errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
        400
      )
    }
    const cacheKey = `governance:query-purposes|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await handler(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }

  return { 'post /back-office/governance/query-purposes': withIdempotency }
}
