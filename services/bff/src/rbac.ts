import type { MiddlewareHandler } from 'hono'
import { ROUTES, matchRoute } from '@ofbo/contracts'
import type { AuthAuditSink, Principal } from './auth.js'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

/**
 * BACKOFFICE-43: every action is verified against the route's x-required-scope at
 * the BFF middleware AND again at the service layer (defence in depth — both
 * layers must hold even though the demo profile has no enterprise gateway).
 * Denials are 403 + High-class audited (persona, attempted scope, reason).
 * platform:superadmin satisfies any scope check but stamps the marker (→ -80).
 */

const SUPERADMIN_MARKER = 'platform:superadmin'

/** Spec scopes like "(initiator scope)" are request-dependent — the owning story's
 *  service layer enforces them; the middleware only requires authentication. */
export function isDynamicScope(scope: string | null): boolean {
  return scope !== null && scope.startsWith('(')
}

export function hasScope(scopes: readonly string[], required: string): boolean {
  return scopes.includes(required) || scopes.includes(SUPERADMIN_MARKER)
}

export class ScopeDeniedError extends Error {
  constructor(readonly required: string, readonly persona: string) {
    super(`scope ${required} is not held by persona ${persona} (PRD §2 matrix)`)
    this.name = 'ScopeDeniedError'
  }
}

/** Service-layer guard — story services call this regardless of what the BFF checked. */
export function assertScope(principal: Pick<Principal, 'persona' | 'scopes'>, required: string): void {
  if (!hasScope(principal.scopes, required)) throw new ScopeDeniedError(required, principal.persona)
}

const ROUTE_SCOPE = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r.scope]))

export function requiredScopeFor(method: string, pathname: string): string | null {
  const m = matchRoute(method, pathname)
  if (!m) return null
  return ROUTE_SCOPE.get(`${m.method} ${m.path}`) ?? null
}

export function scopeDenialEnvelope(required: string) {
  return errorEnvelope(
    'BACKOFFICE.SCOPE_DENIED',
    'The authenticated persona does not hold the scope this operation requires.',
    'Scope hygiene is load-bearing (PRD §2): request the operation through a persona that owns it — scopes are never granted beyond the matrix.',
    DOCS_BASE,
    { required_scope: required }
  )
}

export function createScopeMiddleware(audit: AuthAuditSink): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get('principal')
    const required = requiredScopeFor(c.req.method, new URL(c.req.url).pathname)
    // unknown routes fall through to the 404 envelope; dynamic scopes defer to the service layer
    if (required === null || isDynamicScope(required)) return next()
    if (!hasScope(principal.scopes, required)) {
      await audit.record({
        event_type: 'scope_denied',
        acting_principal: principal.subject,
        acting_persona: principal.persona,
        attempted_scope: required,
        reason: 'scope_not_held',
        trace_id: c.req.header('x-fapi-interaction-id') ?? 'unknown',
        superadmin_marker: false
      })
      return c.json(scopeDenialEnvelope(required), 403)
    }
    await next()
  }
}
