// Integration Readiness Wizard service (ADR 0022) — ties the deterministic scoring engine to the
// profile store. No principal, no scope: these are PUBLIC, pre-login operations.

import { getCatalog, type ReadinessCatalog } from './catalog.js'
import { assess, ReadinessInputError, type AssessmentInput, type ReadinessDigest } from './scoring.js'
import { InMemoryReadinessProfileStore, type ReadinessProfileStore } from './profile-store.js'

export interface ReadinessProfile {
  slug: string
  name: string
  created_at: string
  input: AssessmentInput
  digest: ReadinessDigest
}

export class ReadinessService {
  private readonly store: ReadinessProfileStore
  constructor(store: ReadinessProfileStore = new InMemoryReadinessProfileStore()) {
    this.store = store
  }

  catalog(): ReadinessCatalog {
    return getCatalog()
  }

  /** Stateless scoring. Throws ReadinessInputError on bad input. */
  assess(input: AssessmentInput): ReadinessDigest {
    return assess(input)
  }

  async saveProfile(name: string, input: AssessmentInput): Promise<ReadinessProfile> {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', 'A non-empty profile `name` is required.')
    }
    // Validate by scoring before persisting — never store an un-scoreable input.
    const digest = assess(input)
    const row = await this.store.create(name.trim().slice(0, 120), input)
    return { ...row, digest }
  }

  async getProfile(slug: string): Promise<ReadinessProfile | null> {
    const row = await this.store.get(slug)
    if (!row) return null
    // Recompute the digest on read so a saved profile always reflects current scoring.
    return { ...row, digest: assess(row.input) }
  }
}
