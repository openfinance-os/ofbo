// Persistence for named readiness profiles (ADR 0022).
// NON-REGULATED, NO PII: bank system-metadata self-assessments only. Never audit_high_sensitivity,
// never a regulated record. Keyed by an unguessable slug for sharing/reopening.

import type { AssessmentInput } from './scoring.js'

export interface StoredReadinessProfile {
  slug: string
  name: string
  created_at: string
  input: AssessmentInput
}

export interface ReadinessProfileStore {
  create(name: string, input: AssessmentInput): Promise<StoredReadinessProfile>
  get(slug: string): Promise<StoredReadinessProfile | null>
}

/** 122-bit unguessable share token; not a PSU identifier. */
export function newSlug(): string {
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
