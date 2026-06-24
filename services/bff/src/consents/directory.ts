import { generateDemoDataset } from '@ofbo/synthetic-data'

/**
 * BACKOFFICE-16 consent data source. The demo profile resolves a PSU identifier
 * (bank customer id, IBAN, or Emirates ID) to that PSU's consents across all
 * TPPs from the deterministic synthetic dataset. The enterprise adapter (M6)
 * implements this same interface against the bank's consent store — the search
 * service depends only on the interface.
 */

export type IdentifierType = 'bank_customer_id' | 'iban' | 'emirates_id'

export interface MultiAuthView {
  threshold: number
  received: number
  pending: boolean
  authorisers: { authoriser_ref: string; status: string; authorised_at: string | null }[]
}

export interface ConsentAdminView {
  consent_id: string
  tpp: { client_id: string; display_name: string }
  purpose: string
  scope: string[]
  status: string
  granted_at: string
  expires_at: string | null
  last_access_at: string | null
  /** BACKOFFICE-61 — present only for multi-authorisation payment consents. */
  multi_auth?: MultiAuthView | null
}

export interface PsuConsentSearchResult {
  psu: { bank_customer_id: string; account_count: number }
  consents: ConsentAdminView[]
}

export interface ConsentDirectory {
  /** Resolve a PSU by identifier and return its consents, or null if unknown. */
  search(identifierType: IdentifierType, identifier: string): PsuConsentSearchResult | null
  /** BACKOFFICE-61 — resolve a single consent by id (admin detail), or null. */
  getByConsentId(consentId: string): ConsentAdminView | null
  /** DEMO-01 — resolve the owning PSU's bank_customer_id for a consent, or null.
   *  Lets the admin-revoke stamp target_psu_identifier so it surfaces in the PSU timeline. */
  psuByConsentId(consentId: string): string | null
  /**
   * DEMO fidelity — mark a consent revoked so the admin view + PSU search reflect it on
   * re-lookup within the running process (a revoke an operator/agent just performed shows
   * as Revoked). Optional: the enterprise adapter (M6) reflects status from the bank's
   * consent store and does not implement it.
   */
  markRevoked?(consentId: string): void
}

export class DemoConsentDirectory implements ConsentDirectory {
  private readonly byBankCustomerId = new Map<string, PsuConsentSearchResult>()
  private readonly byEmiratesId = new Map<string, string>()
  private readonly byIban = new Map<string, string>()
  private readonly byConsentId = new Map<string, ConsentAdminView>()
  private readonly psuOfConsent = new Map<string, string>()

  constructor(seed?: number) {
    const ds = seed === undefined ? generateDemoDataset() : generateDemoDataset(seed)
    for (const psu of ds.psus) {
      const result: PsuConsentSearchResult = {
        psu: { bank_customer_id: psu.bank_customer_id, account_count: psu.accounts.length },
        consents: psu.consents.map((c) => ({
          consent_id: c.consent_id,
          tpp: { client_id: c.tpp_client_id, display_name: c.tpp_display_name },
          purpose: c.purpose,
          scope: c.scope,
          status: c.status,
          granted_at: c.granted_at,
          expires_at: c.expires_at,
          last_access_at: c.last_access_at,
          multi_auth: c.multi_auth
        }))
      }
      this.byBankCustomerId.set(psu.bank_customer_id, result)
      this.byEmiratesId.set(psu.emirates_id, psu.bank_customer_id)
      for (const acct of psu.accounts) this.byIban.set(acct.iban, psu.bank_customer_id)
      for (const consent of result.consents) {
        this.byConsentId.set(consent.consent_id, consent)
        this.psuOfConsent.set(consent.consent_id, psu.bank_customer_id)
      }
    }
  }

  getByConsentId(consentId: string): ConsentAdminView | null {
    return this.byConsentId.get(consentId) ?? null
  }

  psuByConsentId(consentId: string): string | null {
    return this.psuOfConsent.get(consentId) ?? null
  }

  search(identifierType: IdentifierType, identifier: string): PsuConsentSearchResult | null {
    const bankCustomerId =
      identifierType === 'bank_customer_id'
        ? identifier
        : identifierType === 'emirates_id'
          ? this.byEmiratesId.get(identifier)
          : this.byIban.get(identifier)
    if (!bankCustomerId) return null
    return this.byBankCustomerId.get(bankCustomerId) ?? null
  }
}

/**
 * DEMO fidelity — a per-process mutable overlay over an immutable base directory (the
 * shared synthetic seed). A revoke (admin / bulk / fraud) calls `markRevoked`, and reads
 * thereafter report that consent as `Revoked` — so a re-lookup in the same running process
 * (the in-process MCP demo, or local dev where the app is built once) shows the change,
 * while the shared seed is NEVER mutated (so each `createApp()` — every test — gets a fresh,
 * isolated overlay). Reads return copies with the status overridden; the seed is untouched.
 */
export class RevocableConsentDirectory implements ConsentDirectory {
  private readonly revoked = new Set<string>()
  constructor(private readonly base: ConsentDirectory) {}

  markRevoked(consentId: string): void {
    this.revoked.add(consentId)
  }

  private applied(view: ConsentAdminView): ConsentAdminView {
    return this.revoked.has(view.consent_id) ? { ...view, status: 'Revoked' } : view
  }

  getByConsentId(consentId: string): ConsentAdminView | null {
    const v = this.base.getByConsentId(consentId)
    return v ? this.applied(v) : null
  }

  psuByConsentId(consentId: string): string | null {
    return this.base.psuByConsentId(consentId)
  }

  search(identifierType: IdentifierType, identifier: string): PsuConsentSearchResult | null {
    const r = this.base.search(identifierType, identifier)
    if (!r || this.revoked.size === 0) return r
    return { psu: r.psu, consents: r.consents.map((c) => this.applied(c)) }
  }
}
