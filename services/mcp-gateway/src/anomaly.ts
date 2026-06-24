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

/**
 * The BFF/P3 sinks the reporter raises into — structural, so the demo can pass the BFF's
 * own InMemoryRiskSignalSink + the P3 ITSM adapter (the same sinks the super-admin
 * guardrails use, BACKOFFICE-80) and the agent_anomaly lands where the Risk View reads it.
 */
export interface AgentRiskSignalRecorder {
  record(event: { signal_type: 'agent_anomaly'; severity: 'info'; acting_principal: string; summary: string; trace_id: string }): Promise<void>
}
export interface AgentItsmRaiser {
  createTicket(input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; team: string; summary: string }, trace: { trace_id: string }): Promise<unknown>
}

/**
 * BACKOFFICE-53 — raises the agent_anomaly as a real Risk signal + ITSM ticket on spend
 * exhaustion, reusing the BACKOFFICE-80 auto-raise sinks (no new primitive). No PSU PII —
 * agent + session telemetry only.
 */
export class BffBackedAnomalySink implements AgentAnomalySink {
  constructor(private readonly deps: { riskSignals: AgentRiskSignalRecorder; itsm: AgentItsmRaiser; tracer?: () => string }) {}

  async report(event: AgentAnomalyEvent): Promise<void> {
    const trace = this.deps.tracer?.() ?? crypto.randomUUID()
    await this.deps.riskSignals.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: event.agent_persona,
      summary: event.detail,
      trace_id: trace
    })
    await this.deps.itsm.createTicket(
      {
        type: 'agent_spend_anomaly',
        severity: 'medium',
        team: 'risk',
        summary: `Agent ${event.agent_persona} session ${event.session_id} hit its ${event.budget}-op spend budget; mutations blocked pending human escalation (BACKOFFICE-53)`
      },
      { trace_id: trace }
    )
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
