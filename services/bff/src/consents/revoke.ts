import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { NebrasEgressPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ConsentDirectory } from './directory.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-17 — single-consent revocation with a regulatory reason code.
 * Propagates to the Nebras Consent Manager through the P6 egress port (no direct
 * egress; <5s p99 — NFR-18), records the propagation time, and writes exactly one
 * High-class `consent_revoked` audit event. FRAUD_SUSPECTED is rejected here —
 * it is reserved for :revoke-fraud (Risk scope, BACKOFFICE-22).
 */

export const REVOKE_SCOPE = 'consents:admin'
export const VALID_REASON_CODES = ['TPP_REQUEST', 'CLIENT_INSTRUCTION', 'REGULATORY'] as const
export const NEBRAS_SLA_MS = 5000

export interface RevocationResult {
  consent_id: string
  status: 'Revoked'
  nebras_propagation_ms: number
  psu_notified: boolean
}

export class ConsentRevokeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ConsentRevokeDeps {
  egress: Pick<NebrasEgressPort, 'revokeConsent'>
  audit: HighClassAuditSink
  /** DEMO-01 — resolves the consent's owning PSU so the audit row carries
   *  target_psu_identifier (without it the revoke never shows in the per-PSU timeline).
   *  Optional: absent in degraded wiring → the field is simply left null. */
  directory?: Pick<ConsentDirectory, 'psuByConsentId'>
}

export class ConsentRevokeService {
  constructor(private readonly deps: ConsentRevokeDeps) {}

  async revoke(principal: Principal, consentId: string, reasonCode: string, traceId: string): Promise<RevocationResult> {
    assertScope(principal, REVOKE_SCOPE) // service-layer defence in depth (throws ScopeDeniedError → 403)

    if (reasonCode === 'FRAUD_SUSPECTED') {
      throw new ConsentRevokeError(
        'BACKOFFICE.REASON_CODE_RESERVED',
        'FRAUD_SUSPECTED is reserved for :revoke-fraud (Risk scope).',
        400
      )
    }
    if (!(VALID_REASON_CODES as readonly string[]).includes(reasonCode)) {
      throw new ConsentRevokeError(
        'BACKOFFICE.INVALID_REASON_CODE',
        `reason_code must be one of: ${VALID_REASON_CODES.join(', ')}.`,
        400
      )
    }

    // All Nebras-bound traffic goes through the P6 egress port.
    const ack = await this.deps.egress.revokeConsent(consentId, reasonCode, { trace_id: traceId })
    const result: RevocationResult = {
      consent_id: consentId,
      status: 'Revoked',
      nebras_propagation_ms: ack.acknowledged_in_ms,
      psu_notified: true
    }

    await this.deps.audit.emit({
      event_type: 'consent_revoked',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: REVOKE_SCOPE,
      target_psu_identifier: this.deps.directory?.psuByConsentId(consentId) ?? null,
      target_consent_id: consentId,
      request_trace_id: traceId,
      request_body: {
        reason_code: reasonCode,
        nebras_propagation_ms: result.nebras_propagation_ms,
        sla_met: result.nebras_propagation_ms < NEBRAS_SLA_MS
      },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return result
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function consentRevokeRoutes(service: ConsentRevokeService, idempotency: IdempotencyStore): Record<string, Handler> {
  const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

  const handler: Handler = async (c, params) => {
    let body: { reason_code?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { reason_code }.', DOCS_BASE), 400)
    }
    if (!body.reason_code) {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'reason_code is required.', 'Send { reason_code }.', DOCS_BASE), 400)
    }
    try {
      const result = await service.revoke(c.get('principal'), params.consent_id!, body.reason_code, trace(c))
      return c.json(dataEnvelope(result), 200)
    } catch (e) {
      if (e instanceof ConsentRevokeError) {
        return c.json(
          errorEnvelope(e.code, e.message, 'See the consent revocation contract; FRAUD_SUSPECTED uses :revoke-fraud.', DOCS_BASE),
          e.status as ContentfulStatusCode
        )
      }
      throw e
    }
  }

  // Mutating route — Idempotency-Key required; successful outcomes replay verbatim (24h).
  const withIdempotency: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.MISSING_IDEMPOTENCY_KEY',
          'The Idempotency-Key header is required on every mutating endpoint.',
          'Send a unique Idempotency-Key; replays within 24h return the original result.',
          DOCS_BASE
        ),
        400
      )
    }
    // Scope the replay key by consent_id too: a key reused across different
    // consents must NOT replay the first result (which would silently skip the
    // second revoke).
    const cacheKey = `revoke-admin|${params.consent_id}|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await handler(c, params)
    if (res.status >= 200 && res.status < 300) {
      await idempotency.set(cacheKey, res.status, await res.clone().json())
    }
    return res
  }

  return { 'post /consents/{consent_id}:revoke-admin': withIdempotency }
}
