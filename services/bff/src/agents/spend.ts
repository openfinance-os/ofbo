import type { MiddlewareHandler } from 'hono'
import type { ItsmPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import type { RiskSignalSink } from '../superadmin.js'
import { errorEnvelope, DOCS_BASE } from '../envelope.js'

/**
 * BACKOFFICE-53 / ADR 0018 — BFF-side re-assertion of agentic spend-control. The MCP gateway
 * already pre-flights a per-session budget (#251), but the gateway must NEVER be the sole
 * guard (defence in depth). Now that an agent presents a server-verified session token
 * (ADR 0018), the BFF keys enforcement on the real (agent_id, session_id) — not a
 * client-asserted header — and:
 *   - blocks every consequential op when the registration is read-only (allow_mutations=false),
 *   - caps consequential ops at the registration's spend_budget (429 on exhaustion),
 *   - raises the agent_anomaly Risk signal + ITSM ticket BFF-side on first exhaustion
 *     (moving the auto-raise authority off the gateway), reusing the BACKOFFICE-80 sinks.
 * Humans are unaffected (no `agent` on the principal). No PII — agent + session telemetry only.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Per-(agent_id, session_id) consequential-operation ledger. In-memory for the demo profile
 * — one per app (so each createApp / test gets an isolated ledger) yet persistent across a
 * session's many calls within the isolate (the in-process MCP demo). The enterprise
 * deployment (M6) backs it with a durable, replicated store.
 */
export class AgentSpendLedger {
  private readonly used = new Map<string, number>()
  private readonly notified = new Set<string>()
  private key(agentId: string, sessionId: string): string {
    return `${agentId}:${sessionId}`
  }
  spent(agentId: string, sessionId: string): number {
    return this.used.get(this.key(agentId, sessionId)) ?? 0
  }
  /** A successful consequential op burns one unit of budget. */
  commit(agentId: string, sessionId: string): void {
    const k = this.key(agentId, sessionId)
    this.used.set(k, (this.used.get(k) ?? 0) + 1)
  }
  /** True the FIRST time a session is seen exhausted — so the anomaly raises exactly once. */
  firstExhaustion(agentId: string, sessionId: string): boolean {
    const k = this.key(agentId, sessionId)
    if (this.notified.has(k)) return false
    this.notified.add(k)
    return true
  }
}

export interface AgentSpendDeps {
  ledger: AgentSpendLedger
  riskSignals: RiskSignalSink
  itsm: Pick<ItsmPort, 'createTicket'>
}

async function raiseAnomaly(
  deps: AgentSpendDeps,
  principal: Principal,
  agent: NonNullable<Principal['agent']>,
  traceId: string
): Promise<void> {
  const summary =
    `Agent ${agent.agent_id} (persona ${principal.persona}) session ${agent.session_id} ` +
    `exhausted its consequential-operation budget of ${agent.spend_budget} (BACKOFFICE-53).`
  await deps.riskSignals.record({
    signal_type: 'agent_anomaly',
    severity: 'info',
    acting_principal: agent.agent_id,
    summary,
    trace_id: traceId
  })
  await deps.itsm.createTicket({ type: 'agent_spend_anomaly', severity: 'medium', team: 'risk', summary }, { trace_id: traceId })
}

export function createAgentSpendMiddleware(deps: AgentSpendDeps): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get('principal') as Principal | undefined
    const agent = principal?.agent
    // Only registered agents are spend-governed; human sessions pass straight through.
    if (!principal || !agent) return next()
    // Reads never consume budget — only consequential (mutating) operations do.
    if (!MUTATING.has(c.req.method)) return next()

    const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'

    // Re-assert the registration's allow_mutations BFF-side (the gateway also blocks it).
    if (!agent.allow_mutations) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.AGENT_MUTATIONS_DISABLED',
          'This agent is registered read-only (allow_mutations=false).',
          'Raise allow_mutations on the agent registration (four-eyes, BACKOFFICE-60) before it can perform consequential operations.',
          DOCS_BASE
        ),
        403
      )
    }

    // Pre-flight budget gate — check WITHOUT consuming (mirrors the gateway SpendGuard.check).
    if (deps.ledger.spent(agent.agent_id, agent.session_id) >= agent.spend_budget) {
      if (deps.ledger.firstExhaustion(agent.agent_id, agent.session_id)) {
        await raiseAnomaly(deps, principal, agent, traceId)
      }
      return c.json(
        errorEnvelope(
          'BACKOFFICE.SPEND_BUDGET_EXCEEDED',
          'This agent session has spent its consequential-operation budget.',
          'Escalate to a human principal; the per-session budget (BACKOFFICE-53) caps autonomous mutations.',
          DOCS_BASE,
          { spend_budget: String(agent.spend_budget), used: String(deps.ledger.spent(agent.agent_id, agent.session_id)) }
        ),
        429
      )
    }

    await next()

    // Commit on success only — a rejected mutation does NOT burn budget. A 202 (four-eyes
    // initiation) counts, mirroring the gateway, where four-eyes counts at initiation.
    if (c.res.status < 400) deps.ledger.commit(agent.agent_id, agent.session_id)
  }
}
