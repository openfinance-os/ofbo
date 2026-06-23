/**
 * BACKOFFICE-53 — when an agent session crosses its spend budget, the same auto-raise
 * the super-admin guardrails use fires: a Risk signal (type `agent_anomaly`) plus an
 * informational ITSM ticket. In production both go through the BFF (POST risk-signals)
 * and the P3 ITSM port; the gateway just reports the event so it can never be the sole
 * record (defence in depth). This module defines the event + the sink; wiring it to the
 * BFF/P3 is a thin adapter left to the enterprise deployment.
 */

export interface AgentAnomalyEvent {
  type: 'agent_anomaly'
  reason: 'spend_budget_exhausted'
  severity: 'info' | 'warning'
  agent_persona: string
  session_id: string
  used: number
  budget: number
  /** No PII — agent + session telemetry only. */
  detail: string
}

export interface AgentAnomalySink {
  report(event: AgentAnomalyEvent): void | Promise<void>
}

/** Test/default sink — records in memory. Production swaps in a BFF + P3 ITSM adapter. */
export class InMemoryAgentAnomalySink implements AgentAnomalySink {
  readonly events: AgentAnomalyEvent[] = []
  report(event: AgentAnomalyEvent): void {
    this.events.push(event)
  }
}

export function spendExhaustedEvent(agentPersona: string, sessionId: string, used: number, budget: number): AgentAnomalyEvent {
  return {
    type: 'agent_anomaly',
    reason: 'spend_budget_exhausted',
    severity: 'warning',
    agent_persona: agentPersona,
    session_id: sessionId,
    used,
    budget,
    detail: `Agent session exhausted its ${budget}-operation spend budget; further mutations blocked pending human escalation.`
  }
}
