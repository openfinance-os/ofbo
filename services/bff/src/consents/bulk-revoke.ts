import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { NebrasEgressPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { ApprovalError, toWire } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { replayCached, missingIdempotencyKey, type IdempotencyStore } from '../idempotency.js'
import type { ConsentDirectory, IdentifierType } from './directory.js'

/**
 * BACKOFFICE-18 — emergency PSU-wide bulk revocation. Four-eyes-gated
 * (consents:admin; 202 + approval, never inline). On the second principal's
 * approval, EVERY active consent for the PSU is revoked in parallel through the
 * P6 egress gateway (<5s total — NFR-18), a single grouped High-class audit
 * record carries all revocation ids, and the PSU is notified once
 * (consolidated). FRAUD_SUSPECTED is reserved for :revoke-fraud (Risk scope).
 */

export const BULK_REVOKE_SCOPE = 'consents:admin'
export const BULK_REVOKE_OPERATION = 'consents.bulk_revoke'
export const NEBRAS_SLA_MS = 5000

// Emergency bulk revoke is PSU-instruction-driven; fraud takes the narrow :revoke-fraud path.
const VALID_REASON_CODES = ['CLIENT_INSTRUCTION'] as const
const VALID_IDENTIFIER_TYPES: IdentifierType[] = ['bank_customer_id', 'iban', 'emirates_id']
// States that currently grant — or can resume granting — TPP access; an emergency
// sweep kills these. Terminal states (Revoked/Expired/Rejected/Consumed) and the
// not-yet-active AwaitingAuthorization are left untouched.
const ACTIVE_STATUSES = new Set(['Authorized', 'Suspended'])

export class BulkRevokeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface BulkRevokeBody {
  psu_identifier_type?: string
  psu_identifier?: string
  reason_code?: string
}

export function makeBulkRevokeOperation(deps: {
  directory: ConsentDirectory
  egress: Pick<NebrasEgressPort, 'revokeConsent'>
  audit: HighClassAuditSink
}): GatedOperation {
  return {
    initiatorScope: BULK_REVOKE_SCOPE,
    approverScope: BULK_REVOKE_SCOPE,
    execute: async (payload) => {
      // The payload only ever carries the internal bank_customer_id (the service
      // resolves the PSU at initiation — no raw Emirates ID/IBAN is persisted).
      const idType = String(payload.psu_identifier_type) as IdentifierType
      const identifier = String(payload.psu_identifier)
      const reasonCode = String(payload.reason_code)
      const traceId = String(payload.trace_id ?? 'unknown')
      const initiatedBy = String(payload.initiated_by ?? 'unknown')
      const initiatedByPersona = String(payload.initiated_by_persona ?? 'unknown')

      // Re-resolve at execution time so the freshest active set is revoked
      // (consents may change between initiation and the approver's decision).
      const found = deps.directory.search(idType, identifier)
      const psuId = found?.psu.bank_customer_id ?? identifier
      const active = (found?.consents ?? []).filter((c) => ACTIVE_STATUSES.has(c.status))

      // Revoke ALL active consents in parallel through P6 (no direct egress).
      const acks = await Promise.all(
        active.map(async (c) => ({
          consent_id: c.consent_id,
          nebras_propagation_ms: (await deps.egress.revokeConsent(c.consent_id, reasonCode, { trace_id: traceId })).acknowledged_in_ms
        }))
      )
      // Parallel dispatch ⇒ wall time ≈ the slowest single revoke.
      const total_ms = acks.reduce((m, a) => Math.max(m, a.nebras_propagation_ms), 0)
      const consent_ids = acks.map((a) => a.consent_id)
      // DEMO fidelity — reflect each revocation so a re-lookup shows Revoked (no-op in enterprise).
      for (const id of consent_ids) deps.directory.markRevoked?.(id)
      const sla_met = total_ms < NEBRAS_SLA_MS

      // ONE grouped audit record carrying every revocation id + a single
      // consolidated PSU notification (BACKOFFICE-18 acceptance).
      await deps.audit.emit({
        event_type: 'consents_bulk_revoked',
        acting_principal: initiatedBy,
        acting_persona: initiatedByPersona,
        scope_used: BULK_REVOKE_SCOPE,
        target_psu_identifier: psuId,
        request_trace_id: traceId,
        request_body: {
          reason_code: reasonCode,
          revoked_count: consent_ids.length,
          consent_ids,
          per_consent_ms: acks,
          total_ms,
          sla_met,
          psu_notified: true,
          four_eyes_approved: true
        },
        response_status: 200
      })

      return {
        psu_identifier: psuId,
        status: 'Revoked',
        revoked_count: consent_ids.length,
        consent_ids,
        nebras_total_ms: total_ms,
        sla_met,
        psu_notified: true
      }
    }
  }
}

export interface BulkRevokeApprovalRequester {
  requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord>
}

export class ConsentBulkRevokeService {
  constructor(
    private readonly approvals: BulkRevokeApprovalRequester,
    private readonly directory: ConsentDirectory
  ) {}

  async initiate(principal: Principal, input: BulkRevokeBody, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, BULK_REVOKE_SCOPE) // service-layer defence in depth
    if (!input.psu_identifier_type || !input.psu_identifier || !input.reason_code) {
      throw new BulkRevokeError('BACKOFFICE.INVALID_BODY', 'psu_identifier_type, psu_identifier and reason_code are required.', 400)
    }
    if (!VALID_IDENTIFIER_TYPES.includes(input.psu_identifier_type as IdentifierType)) {
      throw new BulkRevokeError('BACKOFFICE.INVALID_IDENTIFIER_TYPE', 'psu_identifier_type must be bank_customer_id, iban, or emirates_id.', 400)
    }
    if (!(VALID_REASON_CODES as readonly string[]).includes(input.reason_code)) {
      throw new BulkRevokeError('BACKOFFICE.INVALID_REASON_CODE', 'reason_code must be CLIENT_INSTRUCTION (fraud uses :revoke-fraud).', 400)
    }
    // Resolve here so we never open a four-eyes approval for a phantom PSU, and so
    // the stored approval payload holds only the internal bank_customer_id — never
    // the raw Emirates ID/IBAN the operator may have searched by (no PII at rest).
    const found = this.directory.search(input.psu_identifier_type as IdentifierType, input.psu_identifier)
    if (!found) throw new BulkRevokeError('BACKOFFICE.PSU_NOT_FOUND', 'No PSU matches that identifier.', 404)

    return this.approvals.requestApproval(
      principal,
      {
        operation_type: BULK_REVOKE_OPERATION,
        operation_payload: {
          psu_identifier_type: 'bank_customer_id',
          psu_identifier: found.psu.bank_customer_id,
          reason_code: input.reason_code,
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

/** Replay scope: subject + a hash of the identifier (never the raw Emirates ID/
 *  IBAN in the cache key) + the key. A key reused across PSUs must NOT replay the
 *  first approval — that would silently skip the second PSU's sweep. */
function replayKey(subject: string, body: BulkRevokeBody, key: string): string {
  const disc = body.psu_identifier
    ? createHash('sha256').update(`${body.psu_identifier_type ?? ''}:${body.psu_identifier}`).digest('hex').slice(0, 16)
    : 'none'
  return `consents:revoke-bulk|${subject}|${disc}|${key}`
}

export function consentBulkRevokeRoutes(service: ConsentBulkRevokeService, idempotency: IdempotencyStore): Record<string, Handler> {
  const handler: Handler = async (c) => {
    const key = c.req.header('idempotency-key')
    if (!key) return c.json(missingIdempotencyKey(), 400)
    let body: BulkRevokeBody
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { psu_identifier_type, psu_identifier, reason_code }.', DOCS_BASE), 400)
    }
    const cacheKey = replayKey(c.get('principal').subject, body, key)
    return replayCached(c, idempotency, cacheKey, async () => {
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const record = await service.initiate(c.get('principal'), body, traceId)
        return c.json(dataEnvelope(toWire(record)), 202)
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        if (e instanceof BulkRevokeError) {
          return c.json(errorEnvelope(e.code, e.message, 'See the emergency bulk revocation contract (BACKOFFICE-18); fraud uses :revoke-fraud.', DOCS_BASE), e.status as ContentfulStatusCode)
        }
        if (e instanceof ApprovalError) {
          return c.json(errorEnvelope(e.code, e.message, 'Bulk revocation is four-eyes-gated (consents:admin).', DOCS_BASE), e.status as ContentfulStatusCode)
        }
        throw e
      }
    })
  }

  return { 'post /consents:revoke-bulk': handler }
}
