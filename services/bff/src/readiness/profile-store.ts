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

// CODE-02 — in-memory store(s) moved to services/bff/memory/readiness-profile-store.ts (demo-profile production
// defaults, not test fixtures). Re-exported so every existing import is unchanged.
export {
  InMemoryReadinessProfileStore
} from '../../memory/readiness-profile-store.js'
