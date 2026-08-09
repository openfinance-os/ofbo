// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/governance/query-purposes.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { QueryPurposeRegistrar, RegisterPurposeInput } from '../src/governance/query-purposes.js'

// CODE-02 — moved with its only caller (the store below).
class QueryPurposeRegistrarError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'QueryPurposeRegistrarError'
  }
}

export class InMemoryQueryPurposeRegistrar implements QueryPurposeRegistrar {
  readonly registered: RegisterPurposeInput[] = []
  async register(input: RegisterPurposeInput): Promise<void> {
    if (this.registered.some((r) => r.purpose_code === input.purpose_code)) {
      throw new QueryPurposeRegistrarError(409, 'BACKOFFICE.PURPOSE_ALREADY_REGISTERED', `query purpose '${input.purpose_code}' is already registered for this bank`)
    }
    this.registered.push(input)
  }
}
