import type { Route } from '@ofbo/contracts'

/**
 * ADR 0017 governance helpers. The gateway PRE-FLIGHTS these checks; the BFF
 * re-asserts every one of them (defence in depth) — the gateway is never the sole
 * guard. None of this replaces a BFF primitive; it only bounds what an agent attempts.
 */

export type OperationClass = 'read' | 'mutate' | 'four-eyes'

export function classify(route: Route): OperationClass {
  if (route.fourEyes) return 'four-eyes'
  return route.method === 'get' ? 'read' : 'mutate'
}

/** Consequential = anything that changes state or initiates an approval. Counts toward spend. */
export function isConsequential(route: Route): boolean {
  return classify(route) !== 'read'
}

export class SpendBudgetExceededError extends Error {
  constructor(
    readonly used: number,
    readonly budget: number
  ) {
    super(
      `Agent session spend budget exhausted (${used}/${budget} consequential operations). ` +
        `Escalate to a human principal to continue (BACKOFFICE-53).`
    )
    this.name = 'SpendBudgetExceededError'
  }
}

/**
 * BACKOFFICE-53: a per-session blast-radius budget on consequential operations.
 * Mirrors the BACKOFFICE-80 per-session guardrail pattern. Four-eyes operations
 * count at INITIATION (the 202), not at approval. On exhaustion, callers should
 * raise a Risk signal (type agent_anomaly) + an informational ITSM ticket — the
 * same auto-raise the super-admin guardrails use.
 */
export class SpendGuard {
  private used = 0
  constructor(
    private readonly budget: number,
    private readonly onExhausted?: (used: number, budget: number) => void
  ) {}

  get remaining(): number {
    return Math.max(0, this.budget - this.used)
  }

  /** Reserve budget for a consequential op. Throws SpendBudgetExceededError when over. */
  consume(route: Route): void {
    if (!isConsequential(route)) return
    if (this.used >= this.budget) {
      this.onExhausted?.(this.used, this.budget)
      throw new SpendBudgetExceededError(this.used, this.budget)
    }
    this.used += 1
    if (this.used >= this.budget) this.onExhausted?.(this.used, this.budget)
  }
}

/** The structured tool result returned when a four-eyes operation yields a 202. */
export interface PendingApproval {
  status: 'pending_approval'
  approval_request_id: string
  operation_type: string
  approver_required_scope: string
  expires_at: string
  /**
   * The agent must NOT poll-and-approve this itself. Per BACKOFFICE-44 the approver
   * must be a different principal (and per policy, human). The agent's job ends at
   * initiation.
   */
  guidance: string
}

/** Shape a 202 `approval_request` envelope into an agent-facing pending result. */
export function toPendingApproval(envelopeData: Record<string, unknown>): PendingApproval {
  return {
    status: 'pending_approval',
    approval_request_id: String(envelopeData.approval_request_id ?? ''),
    operation_type: String(envelopeData.operation_type ?? ''),
    approver_required_scope: String(envelopeData.approver_required_scope ?? ''),
    expires_at: String(envelopeData.expires_at ?? ''),
    guidance:
      'Four-eyes operation initiated. A different human principal must approve it in the portal ' +
      '(/approvals). This agent cannot approve its own request (BACKOFFICE-44).'
  }
}
