// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/readiness/profile-store.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
// Persistence for named readiness profiles (ADR 0022).
// NON-REGULATED, NO PII: bank system-metadata self-assessments only. Never audit_high_sensitivity,
// never a regulated record. Keyed by an unguessable slug for sharing/reopening.
import type { ReadinessProfileStore, StoredReadinessProfile } from '../src/readiness/profile-store.js'

import type { AssessmentInput } from '../src/readiness/scoring.js'

// CODE-02 — moved with its only caller (the store below).
/** 122-bit unguessable share token; not a PSU identifier. */
function newSlug(): string {
  return `rdy-${crypto.randomUUID()}`
}

export class InMemoryReadinessProfileStore implements ReadinessProfileStore {
  private readonly rows = new Map<string, StoredReadinessProfile>()
  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(name: string, input: AssessmentInput): Promise<StoredReadinessProfile> {
    const row: StoredReadinessProfile = {
      slug: newSlug(),
      name,
      created_at: this.now().toISOString(),
      input
    }
    this.rows.set(row.slug, row)
    return row
  }

  async get(slug: string): Promise<StoredReadinessProfile | null> {
    return this.rows.get(slug) ?? null
  }
}
