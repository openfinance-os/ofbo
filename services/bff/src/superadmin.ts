import type { MiddlewareHandler } from 'hono'
import type { ItsmPort } from '@ofbo/ports'
import type { AuthAuditSink } from './auth.js'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

/**
 * BACKOFFICE-80: super-admin guardrails, enforced in code, not policy.
 * Super-admin activity is anomalous by definition: every session auto-raises an
 * informational ITSM ticket (P3) + a Risk View signal; mutating actions require
 * a recorded ≥20-char justification; the role is never held by automations —
 * service-account tokens carrying the persona are rejected at sign-in.
 * (Marker stamping and self-approval rejection live in auth/rbac/approvals.)
 */

export interface RiskSignalEvent {
  signal_type: 'agent_anomaly'
  severity: 'info'
  acting_principal: string
  summary: string
  trace_id: string
}

export interface RiskSignalSink {
  record(event: RiskSignalEvent): Promise<void>
}

export class InMemoryRiskSignalSink implements RiskSignalSink {
  readonly signals: RiskSignalEvent[] = []
  async record(event: RiskSignalEvent): Promise<void> {
    this.signals.push(event)
  }
}

export interface SuperAdminDeps {
  itsm: Pick<ItsmPort, 'createTicket'>
  riskSignals: RiskSignalSink
  /** Session window for the once-per-session auto-raise (default 8h). */
  sessionTtlMs?: number
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MARKER = 'platform:superadmin'
const SERVICE_ACCOUNT_RE = /^(svc[:\-_]|service[:\-_]|bot[:\-_])/i

export function isServiceAccountSubject(subject: string): boolean {
  return SERVICE_ACCOUNT_RE.test(subject)
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export class SuperAdminGuardrails {
  private readonly seenSessions = new Map<string, number>()
  private readonly sessionTtlMs: number

  constructor(private readonly deps: SuperAdminDeps) {
    this.sessionTtlMs = deps.sessionTtlMs ?? 8 * 60 * 60 * 1000
  }

  /** Once per session (token, TTL-bounded): informational ITSM ticket + Risk signal. */
  async onSession(subject: string, tokenKey: string, traceId: string): Promise<void> {
    const sessionKey = fnv1a(tokenKey) // never hold the raw bearer token
    const nowMs = Date.now()
    const seen = this.seenSessions.get(sessionKey)
    if (seen !== undefined && nowMs - seen < this.sessionTtlMs) return
    this.seenSessions.set(sessionKey, nowMs)
    await this.deps.itsm.createTicket(
      {
        type: 'superadmin_session',
        severity: 'low',
        team: 'risk_compliance',
        summary: `Informational: super-admin session active (${subject}) — anomalous by definition (BACKOFFICE-80)`
      },
      { trace_id: traceId }
    )
    await this.deps.riskSignals.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: subject,
      summary: 'super-admin session active',
      trace_id: traceId
    })
  }
}

/** Mutating super-admin actions require a recorded ≥20-char justification. */
export function createJustificationMiddleware(audit: AuthAuditSink): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get('principal')
    if (!principal.scopes.includes(MARKER) || !MUTATING.has(c.req.method)) return next()
    const justification = c.req.header('x-superadmin-justification') ?? ''
    if (justification.trim().length < 20) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.JUSTIFICATION_REQUIRED',
          'Mutating super-admin actions require a recorded justification of at least 20 characters.',
          'Send the x-superadmin-justification header describing why this action is being taken (BACKOFFICE-80 guardrail d).',
          DOCS_BASE
        ),
        400
      )
    }
    await audit.record({
      event_type: 'superadmin_mutation',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      reason: null,
      trace_id: c.req.header('x-fapi-interaction-id') ?? 'unknown',
      superadmin_marker: true,
      justification: justification.trim()
    })
    await next()
  }
}
