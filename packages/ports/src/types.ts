/** Shared types for port contracts (PRD §3). */

/** Binding money convention: integer minor units + ISO 4217. Never floating point. */
export interface Money {
  amount: number
  currency: string
}

export interface TraceContext {
  /** x-fapi-interaction-id, propagated end-to-end. */
  trace_id: string
}

export type DeployProfile = 'demo' | 'enterprise'

export class EnterpriseAdapterNotImplementedError extends Error {
  constructor(port: string) {
    super(`Enterprise adapter for ${port} is written at bank adoption (M6). Configure DEPLOY_PROFILE=demo.`)
    this.name = 'EnterpriseAdapterNotImplementedError'
  }
}
