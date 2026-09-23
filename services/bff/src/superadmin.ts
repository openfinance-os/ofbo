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
  dedup_key?: string
}

export interface RiskSignalSink {
  record(event: RiskSignalEvent): Promise<void>
  /**
   * Durable once-per-window write: records the signal unless one with the same `dedup_key` exists
   * since `sinceIso`, and returns whether it wrote. Optional — a sink without it falls back to
   * `record`, deduped only by the guardrail's in-memory window.
   */
  recordOnce?(
    event: RiskSignalEvent & { dedup_key: string },
    sinceIso: string,
    onFirst?: () => Promise<Record<string, unknown>>
  ): Promise<boolean>
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

export class SuperAdminGuardrails {
  private readonly seenSessions = new Map<string, number>()
  private readonly sessionTtlMs: number

  constructor(private readonly deps: SuperAdminDeps) {
    this.sessionTtlMs = deps.sessionTtlMs ?? 8 * 60 * 60 * 1000
  }

  /**
   * Once per principal per session window (TTL-bounded): informational ITSM ticket + Risk signal.
   *
   * The in-memory map alone is not enough: the deployed BFF builds its app per request
   * (services/bff/src/worker.ts), so the map is empty on every request and every super-admin read
   * wrote another open signal — 1,775 of them on the hosted demo, which the dashboard then paged
   * through on every render. The durable `recordOnce` on the sink is the check that survives the
   * request boundary; the map just saves it a round trip within one app instance.
   *
   * Keyed by the verified SUBJECT, never by anything derived from the bearer token: the key is
   * persisted in a 5-year-retained store, and credential-derived material has no business there.
   * The subject is already the signal's own `acting_principal`, so the key discloses nothing new,
   * and two principals can never share one.
   *
   * The ITSM ticket is raised INSIDE `recordOnce`, under its lock and before the signal row commits.
   * A failed ticket call therefore leaves no row behind and the next request retries both — the
   * durable dedupe can never mark a session as raised when only half of the guardrail ran.
   */
  async onSession(subject: string, _tokenKey: string, traceId: string): Promise<void> {
    const nowMs = Date.now()
    const seen = this.seenSessions.get(subject)
    if (seen !== undefined && nowMs - seen < this.sessionTtlMs) return
    const signal: RiskSignalEvent & { dedup_key: string } = {
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: subject,
      summary: 'super-admin session active',
      trace_id: traceId,
      dedup_key: `superadmin_session:${subject}`
    }
    const raiseTicket = async (): Promise<Record<string, unknown>> => {
      const { ticket_id } = await this.deps.itsm.createTicket(
        {
          type: 'superadmin_session',
          severity: 'low',
          team: 'risk_compliance',
          summary: `Informational: super-admin session active (${subject}) — anomalous by definition (BACKOFFICE-80)`
        },
        { trace_id: traceId }
      )
      return { itsm_ticket_id: ticket_id }
    }
    if (this.deps.riskSignals.recordOnce) {
      const sinceIso = new Date(nowMs - this.sessionTtlMs).toISOString()
      await this.deps.riskSignals.recordOnce(signal, sinceIso, raiseTicket)
    } else {
      await raiseTicket()
      await this.deps.riskSignals.record(signal)
    }
    // Only once both halves landed (or were already recorded) — a failure above is retried.
    this.seenSessions.set(subject, nowMs)
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

// CODE-02 — in-memory store(s) moved to services/bff/memory/superadmin.ts (demo-profile production
// defaults, not test fixtures). Re-exported so every existing import is unchanged.
export {
  InMemoryRiskSignalSink
} from '../memory/superadmin.js'
