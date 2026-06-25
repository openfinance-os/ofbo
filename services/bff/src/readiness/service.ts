// Integration Readiness Wizard service (ADR 0022) — ties the deterministic scoring engine to the
// profile store. No principal, no scope: these are PUBLIC, pre-login operations.

import { getCatalogView, type PublicCatalog } from './catalog.js'
import { getMaturity, type MaturitySummary } from './maturity.js'
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

  catalog(): PublicCatalog {
    return getCatalogView()
  }

  maturity(): MaturitySummary {
    return getMaturity()
  }

  /** Stateless scoring. Throws ReadinessInputError on bad input. */
  assess(input: AssessmentInput): ReadinessDigest {
    return assess(input)
  }

  async saveProfile(name: string, input: AssessmentInput): Promise<ReadinessProfile> {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) {
      throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', 'A non-empty profile `name` is required.')
    }
    // Match the spec's maxLength:120 — reject rather than silently truncate (the saved/shared
    // name must equal what the caller typed).
    if (trimmed.length > 120) {
      throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', 'Profile `name` exceeds 120 characters.')
    }
    // Validate by scoring before persisting — never store an un-scoreable input.
    const digest = assess(input)
    const row = await this.store.create(trimmed, input)
    return { ...row, digest }
  }

  async getProfile(slug: string): Promise<ReadinessProfile | null> {
    const row = await this.store.get(slug)
    if (!row) return null
    // Recompute the digest on read so a saved profile always reflects current scoring. The
    // catalog is editable, so a stored input could reference an option that was later removed —
    // surface that as a typed error the route maps to 422, not an opaque 500.
    try {
      return { ...row, digest: assess(row.input) }
    } catch (e) {
      if (e instanceof ReadinessInputError) {
        throw new ReadinessInputError(
          'BACKOFFICE.READINESS_PROFILE_STALE',
          'This saved profile references a system option that has since changed; re-run the assessment.',
          422
        )
      }
      throw e
    }
  }
}
