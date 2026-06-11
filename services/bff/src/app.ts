import { Hono } from 'hono'
import { matchRoute, ROUTES } from '@ofbo/contracts'
import type { IdentityProviderPort } from '@ofbo/ports'
import { getAdapter, profileFromConfig } from '@ofbo/ports'
import { errorEnvelope, DOCS_BASE } from './envelope.js'
import { createAuthMiddleware, InMemoryAuthAuditSink, type AuthAuditSink } from './auth.js'
import { assertScope, createScopeMiddleware, isDynamicScope, scopeDenialEnvelope, ScopeDeniedError } from './rbac.js'
import { ApprovalsService, type ApprovalsDeps } from './approvals/service.js'
import {
  createJustificationMiddleware,
  isServiceAccountSubject,
  InMemoryRiskSignalSink,
  SuperAdminGuardrails,
  type SuperAdminDeps
} from './superadmin.js'
import { approvalRoutes } from './approvals/routes.js'

/** Route keys (`method path`) handled by real story services — used by the test
 *  suites to exclude them from the contract-pending it.fails layer. */
export const IMPLEMENTED_ROUTES = new Set([
  'post /approvals',
  'get /approvals/pending',
  'get /approvals/{approval_id}',
  'post /approvals/{approval_id}:approve',
  'post /approvals/{approval_id}:reject'
])

/**
 * Stub BFF: every contract path resolves (via the colon-action-safe matcher,
 * NOT framework path syntax) and returns the binding 501 envelope. Stories
 * replace stubs route-by-route; the [contract-pending] it.fails suite enforces
 * that flip. Since BACKOFFICE-47, every request authenticates via the IdP
 * port (P2) — MFA mandatory, scopes minted from the §2 persona matrix.
 */
export interface AppDeps {
  idp?: IdentityProviderPort
  audit?: AuthAuditSink
  approvals?: ApprovalsDeps
  superadmin?: Partial<SuperAdminDeps>
}

export function createApp(deps: AppDeps = {}) {
  const idp = deps.idp ?? getAdapter('p2-identity-provider', profileFromConfig(process.env))
  const audit = deps.audit ?? new InMemoryAuthAuditSink()
  const approvals = new ApprovalsService(audit, deps.approvals ?? {})
  const guardrails = new SuperAdminGuardrails({
    itsm: deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env)),
    riskSignals: deps.superadmin?.riskSignals ?? new InMemoryRiskSignalSink(),
    ...(deps.superadmin?.sessionTtlMs !== undefined ? { sessionTtlMs: deps.superadmin.sessionTtlMs } : {})
  })
  // Implemented routes dispatch here; everything else stays a contract-pending 501 stub.
  const handlers = approvalRoutes(approvals)
  const app = new Hono()

  app.use('*', async (c, next) => {
    const fapi = c.req.header('x-fapi-interaction-id')
    if (!fapi) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.MISSING_FAPI_INTERACTION_ID',
          'The x-fapi-interaction-id header is required on every request.',
          'Send a UUID v4 in the x-fapi-interaction-id header; it is propagated end-to-end as the trace id.',
          DOCS_BASE
        ),
        400
      )
    }
    c.header('x-fapi-interaction-id', fapi)
    await next()
  })

  app.use(
    '*',
    createAuthMiddleware(idp, audit, {
      isServiceAccountSubject,
      onSuperAdminSession: (subject, tokenKey, traceId) => guardrails.onSession(subject, tokenKey, traceId)
    })
  )
  app.use('*', createScopeMiddleware(audit))
  app.use('*', createJustificationMiddleware(audit))

  app.all('*', async (c) => {
    const url = new URL(c.req.url)
    const match = matchRoute(c.req.method, url.pathname)
    if (!match) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.ROUTE_NOT_FOUND',
          `${c.req.method} ${url.pathname} is not part of the Back Office contract.`,
          'Check the path against specs/backoffice-openapi.yaml — the contract is ground truth.',
          DOCS_BASE
        ),
        404
      )
    }
    // Service-layer scope check (defence in depth, BACKOFFICE-43): the stub stands in
    // for the story services, which must each call assertScope themselves.
    const required = ROUTES.find((r) => r.method === match.method && r.path === match.path)?.scope ?? null
    if (required !== null && !isDynamicScope(required)) {
      try {
        assertScope(c.get('principal'), required)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(required), 403)
        throw e
      }
    }

    const handler = handlers[`${match.method} ${match.path}`]
    if (handler) return handler(c, match.params)

    return c.json(
      errorEnvelope(
        'BACKOFFICE.NOT_IMPLEMENTED',
        `${match.method.toUpperCase()} ${match.path} is specified but its story has not been implemented yet.`,
        'Implement the owning BACKOFFICE story (PRD §7); contract tests must be written first.',
        DOCS_BASE
      ),
      501
    )
  })

  return app
}
