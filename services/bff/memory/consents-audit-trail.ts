// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/consents/audit-trail.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { ConsentEventSource } from '../src/consents/audit-trail.js'
import type { ConsentEventPage } from '@ofbo/db'

export class InMemoryConsentEventSource implements ConsentEventSource {
  async byConsent(): Promise<ConsentEventPage> {
    return { events: [], next_cursor: null }
  }
  async byPsu(): Promise<ConsentEventPage> {
    return { events: [], next_cursor: null }
  }
}
