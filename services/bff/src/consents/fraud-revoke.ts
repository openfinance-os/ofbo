import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { NebrasEgressPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ConsentDirectory } from './directory.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { ApprovalError, toWire } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-22 — fraud-suspected revocation. Narrow Risk scope
 * (consents:admin:fraud-revoke), four-eyes-gated (spec PR #26: 202 + approval,
 * never inline). On the second principal's approval the consent is revoked
 * through the P6 egress gateway with reason FRAUD_SUSPECTED, an STR draft is
 * auto-created in the bank's STR workflow (the Back Office never submits — that
 * is BACKOFFICE-63), Compliance is notified via the High-class audit trail, and
 * PSU notification is deferred per fraud policy.
 */

export const FRAUD_REVOKE_SCOPE = 'consents:admin:fraud-revoke'
export const FRAUD_REVOKE_OPERATION = 'consents.fraud_revoke'

export interface FraudRevokeApprovalRequester {
  requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord>
}

/** BACKOFFICE-63 — persists the auto-created STR draft so Compliance can later hand it to the
 *  bank's STR workflow (P10). Optional: when absent (older wiring / unit tests) the operation
 *  keeps its prior behaviour and holds only a derived reference. */
export interface StrDraftRecorder {
  record(input: { source_consent_id: string; case_context: string; created_by: string }, traceId: string): Promise<{ str_draft_id: string }>
}

export function makeFraudRevokeOperation(deps: {
  egress: Pick<NebrasEgressPort, 'revokeConsent'>
  audit: HighClassAuditSink
  /** DEMO fidelity — reflect the revoke on re-lookup (no-op in enterprise). Optional. */
  directory?: Pick<ConsentDirectory, 'markRevoked'>
  /** BACKOFFICE-63 — persist the auto-created STR draft (optional). */
  strDrafts?: StrDraftRecorder
}): GatedOperation {
  return {
    initiatorScope: FRAUD_REVOKE_SCOPE,
    approverScope: FRAUD_REVOKE_SCOPE,
    execute: async (payload) => {
      const consentId = String(payload.consent_id)
      const caseContext = String(payload.case_context ?? '')
      const traceId = String(payload.trace_id ?? 'unknown')
      const initiatedBy = String(payload.initiated_by ?? 'unknown')
      const initiatedByPersona = String(payload.initiated_by_persona ?? 'unknown')

      // Revoke through P6 with the reserved fraud reason (no direct egress).
      const ack = await deps.egress.revokeConsent(consentId, 'FRAUD_SUSPECTED', { trace_id: traceId })
      // DEMO fidelity — reflect the new status so a re-lookup shows Revoked (no-op in enterprise).
      deps.directory?.markRevoked?.(consentId)
      // STR draft auto-created and persisted (BACKOFFICE-63) so Compliance can hand it to the
      // bank's STR workflow; the Back Office never submits to AML GO directly. Falls back to a
      // derived reference when no store is wired.
      const recorded = await deps.strDrafts?.record({ source_consent_id: consentId, case_context: caseContext, created_by: initiatedBy }, traceId)
      const strDraftRef = recorded?.str_draft_id ?? `str-draft-${consentId}`

      await deps.audit.emit({
        event_type: 'consent_revoked',
        acting_principal: initiatedBy,
        acting_persona: initiatedByPersona,
        scope_used: FRAUD_REVOKE_SCOPE,
        target_consent_id: consentId,
        request_trace_id: traceId,
        request_body: {
          reason_code: 'FRAUD_SUSPECTED',
          case_context: caseContext,
          str_draft_ref: strDraftRef,
          psu_notified: false, // deferred per fraud policy
          compliance_notified: true,
          four_eyes_approved: true,
          nebras_propagation_ms: ack.acknowledged_in_ms
        },
        response_status: 200
      })

      return {
        consent_id: consentId,
        status: 'Revoked',
        nebras_propagation_ms: ack.acknowledged_in_ms,
        psu_notified: false,
        str_draft_ref: strDraftRef
      }
    }
  }
}

export class ConsentFraudRevokeService {
  constructor(private readonly approvals: FraudRevokeApprovalRequester) {}

  async initiate(principal: Principal, consentId: string, caseContext: string, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, FRAUD_REVOKE_SCOPE)
    return this.approvals.requestApproval(
      principal,
      {
        operation_type: FRAUD_REVOKE_OPERATION,
        operation_payload: {
          consent_id: consentId,
          case_context: caseContext,
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

export function consentFraudRevokeRoutes(service: ConsentFraudRevokeService, idempotency: IdempotencyStore): Record<string, Handler> {
  const handler: Handler = async (c, params) => {
    let body: { case_context?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { case_context }.', DOCS_BASE), 400)
    }
    if (!body.case_context) {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'case_context is required.', 'Send { case_context } — it is carried into the STR draft.', DOCS_BASE), 400)
    }
    const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
    try {
      const record = await service.initiate(c.get('principal'), params.consent_id!, body.case_context, traceId)
      return c.json(dataEnvelope(toWire(record)), 202)
    } catch (e) {
      const denied = scopeDenied(c, e)
      if (denied) return denied
      if (e instanceof ApprovalError) {
        return c.json(errorEnvelope(e.code, e.message, 'Fraud revoke is four-eyes-gated (Risk narrow scope).', DOCS_BASE), e.status as ContentfulStatusCode)
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
    const cacheKey = `consents:fraud-revoke|${params.consent_id}|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await handler(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }

  return { 'post /consents/{consent_id}:revoke-fraud': withIdempotency }
}
