import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ScopeDeniedError, scopeDenialEnvelope } from './rbac.js'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

/**
 * Shared error→response mapping for route handlers. Two shapes recur in every module:
 *   1. the universal scope-denial (ScopeDeniedError → the binding 403 envelope), and
 *   2. a domain error carrying { code, message, status } → the binding error envelope.
 * Centralising them keeps the scope-denial response identical everywhere (scope hygiene
 * is load-bearing) and removes the per-module envelope boilerplate.
 */

/** A domain error carrying the binding error-envelope fields — the shape BFF service errors implement. */
export interface DomainErrorLike {
  code: string
  message: string
  status: number
}

/**
 * Map the universal ScopeDeniedError to its binding 403 envelope. Returns the response,
 * or `null` when `e` is not a scope denial so the caller can fall through to its
 * domain-specific handling: `const denied = scopeDenied(c, e); if (denied) return denied`.
 */
export function scopeDenied(c: Context, e: unknown): Response | null {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  return null
}

/** Render a domain error ({ code, message, status }) as the binding error envelope. */
export function domainError(c: Context, e: DomainErrorLike, remediation: string): Response {
  return c.json(errorEnvelope(e.code, e.message, remediation, DOCS_BASE), e.status as ContentfulStatusCode)
}
