import type { MiddlewareHandler } from 'hono'
import type { IdentityProviderPort } from '@ofbo/ports'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

/**
 * BACKOFFICE-47: every Internal Portal request authenticates via the IdP port (P2),
 * MFA is mandatory with no skip path, and admin scopes are minted from the PRD §2
 * persona matrix — the matrix is load-bearing for audit defensibility; granting
 * beyond it is an automatic review FAIL.
 */

export const SCOPE_MATRIX = {
  'operations-analyst': ['platform:operations:read', 'platform:operations:write', 'certification:read'],
  'customer-care-agent': ['consents:admin', 'disputes:admin', 'audit:read'],
  // compliance:query-purposes:write (BACKOFFICE-33 PR 5) — data governance owns the cross-fintech
  // query_purpose_registry; registering a NEW purpose is four-eyes-gated.
  'compliance-officer': ['audit:read', 'compliance:reports:read', 'compliance:reports:generate', 'compliance:query-purposes:write'],
  'finance-analyst': [
    'reconciliation:read',
    'finance:reconciliation:write',
    'finance:disputes:write',
    'billing:read',
    'billing:write'
  ],
  'risk-analyst': ['risk:read', 'risk:investigations:write', 'consents:admin:fraud-revoke'],
  'commercial-desk-head': ['platform:analytics:read', 'commercial:read', 'pipeline:read'],
  'programme-manager': ['platform:analytics:read', 'programme:read', 'certification:read'],
  // BACKOFFICE-80: marker scope + union of all; guardrails (auto-signal, no
  // self-approval, justification) land with the BACKOFFICE-80 story.
  'platform-super-admin': ['platform:superadmin']
} as const satisfies Record<string, readonly string[]>

export type Persona = keyof typeof SCOPE_MATRIX
export const ALL_PERSONAS = Object.keys(SCOPE_MATRIX) as Persona[]

const UNION_OF_ALL = [...new Set(Object.values(SCOPE_MATRIX).flat())]

export function mintScopes(persona: string): string[] {
  if (!(persona in SCOPE_MATRIX)) return []
  if (persona === 'platform-super-admin') return [...new Set(['platform:superadmin', ...UNION_OF_ALL])]
  return [...SCOPE_MATRIX[persona as Persona]]
}

export interface Principal {
  subject: string
  persona: Persona
  scopes: string[]
}

export interface AuthAuditEvent {
  event_type:
    | 'signin_success'
    | 'signin_failure'
    | 'scope_denied'
    | 'approval_requested'
    | 'approval_approved'
    | 'approval_rejected'
    | 'approval_timed_out'
    | 'superadmin_mutation'
  acting_principal: string
  acting_persona: string | null
  reason:
    | 'missing_token'
    | 'invalid_token'
    | 'mfa_not_satisfied'
    | 'unknown_persona'
    | 'scope_not_held'
    | 'service_account_superadmin'
    | null
  trace_id: string
  /** Set on scope_denied events (BACKOFFICE-43 acceptance: persona, attempted scope, reason). */
  attempted_scope?: string | null
  /** BACKOFFICE-43/-80: platform:superadmin satisfies any check but stamps the marker. */
  superadmin_marker?: boolean
  /** Set on approval lifecycle events (BACKOFFICE-44). */
  approval_request_id?: string
  /** Set on superadmin_mutation events (BACKOFFICE-80 guardrail d). */
  justification?: string
}

/** Sink for sign-in audit events. The DB-backed High-class emitter replaces the
 *  in-memory default with BACKOFFICE-45; the event shape is already final. */
export interface AuthAuditSink {
  record(event: AuthAuditEvent): Promise<void>
}

export class InMemoryAuthAuditSink implements AuthAuditSink {
  readonly events: AuthAuditEvent[] = []
  async record(event: AuthAuditEvent): Promise<void> {
    this.events.push(event)
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal
  }
}

export interface AuthHooks {
  /** Fires after a successful super-admin sign-in (BACKOFFICE-80 session auto-raise). */
  onSuperAdminSession?: (subject: string, tokenKey: string, traceId: string) => Promise<void>
  /** BACKOFFICE-80 guardrail (a): the role is never held by automations. */
  isServiceAccountSubject?: (subject: string) => boolean
}

export function createAuthMiddleware(idp: IdentityProviderPort, audit: AuthAuditSink, hooks: AuthHooks = {}): MiddlewareHandler {
  return async (c, next) => {
    const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
    const deny = async (
      code: string,
      message: string,
      reason: NonNullable<AuthAuditEvent['reason']>,
      principal: string,
      persona: string | null = null
    ) => {
      await audit.record({
        event_type: 'signin_failure',
        acting_principal: principal,
        acting_persona: persona,
        reason,
        trace_id: traceId
      })
      return c.json(
        errorEnvelope(code, message, 'Sign in through the Internal Portal IdP (P2); MFA is mandatory with no skip path.', DOCS_BASE),
        401
      )
    }

    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return deny('BACKOFFICE.UNAUTHENTICATED', 'A bearer token from the enterprise IdP is required.', 'missing_token', 'anonymous')
    }
    const token = header.slice('Bearer '.length)

    let claims: Awaited<ReturnType<IdentityProviderPort['verifyToken']>>
    try {
      claims = await idp.verifyToken(token)
    } catch {
      return deny('BACKOFFICE.UNAUTHENTICATED', 'The bearer token was not accepted by the IdP.', 'invalid_token', 'unverified')
    }

    if (!claims.mfa) {
      return deny('BACKOFFICE.MFA_REQUIRED', 'MFA is mandatory on every Internal Portal sign-in.', 'mfa_not_satisfied', claims.subject, claims.persona)
    }

    const scopes = mintScopes(claims.persona)
    if (scopes.length === 0) {
      return deny('BACKOFFICE.UNAUTHENTICATED', 'The token persona is not in the persona scope matrix.', 'unknown_persona', claims.subject, claims.persona)
    }

    if (claims.persona === 'platform-super-admin' && hooks.isServiceAccountSubject?.(claims.subject)) {
      await audit.record({
        event_type: 'signin_failure',
        acting_principal: claims.subject,
        acting_persona: claims.persona,
        reason: 'service_account_superadmin',
        trace_id: traceId
      })
      return c.json(
        errorEnvelope(
          'BACKOFFICE.SERVICE_ACCOUNT_SUPERADMIN_FORBIDDEN',
          'platform:superadmin is assignable only to named human principals — never to service accounts or automations.',
          'Use a named human principal, or register the automation under BACKOFFICE-60 (Phase 2) with its own scoped access.',
          DOCS_BASE
        ),
        403
      )
    }

    await audit.record({
      event_type: 'signin_success',
      acting_principal: claims.subject,
      acting_persona: claims.persona,
      reason: null,
      trace_id: traceId,
      superadmin_marker: scopes.includes('platform:superadmin')
    })
    c.set('principal', { subject: claims.subject, persona: claims.persona as Persona, scopes })
    if (scopes.includes('platform:superadmin') && hooks.onSuperAdminSession) {
      await hooks.onSuperAdminSession(claims.subject, token, traceId)
    }
    await next()
  }
}
