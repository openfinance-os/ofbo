import { generateDemoDataset } from '@ofbo/synthetic-data'

/**
 * BACKOFFICE-16 consent data source. The demo profile resolves a PSU identifier
 * (bank customer id, IBAN, or Emirates ID) to that PSU's consents across all
 * TPPs from the deterministic synthetic dataset. The enterprise adapter (M6)
 * implements this same interface against the bank's consent store — the search
 * service depends only on the interface.
 */

export type IdentifierType = 'bank_customer_id' | 'iban' | 'emirates_id'

export interface ConsentAdminView {
  consent_id: string
  tpp: { client_id: string; display_name: string }
  purpose: string
  scope: string[]
  status: string
  granted_at: string
  expires_at: string | null
  last_access_at: string | null
}

export interface PsuConsentSearchResult {
  psu: { bank_customer_id: string; account_count: number }
  consents: ConsentAdminView[]
}

export interface ConsentDirectory {
  /** Resolve a PSU by identifier and return its consents, or null if unknown. */
  search(identifierType: IdentifierType, identifier: string): PsuConsentSearchResult | null
}

export class DemoConsentDirectory implements ConsentDirectory {
  private readonly byBankCustomerId = new Map<string, PsuConsentSearchResult>()
  private readonly byEmiratesId = new Map<string, string>()
  private readonly byIban = new Map<string, string>()

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
          last_access_at: c.last_access_at
        }))
      }
      this.byBankCustomerId.set(psu.bank_customer_id, result)
      this.byEmiratesId.set(psu.emirates_id, psu.bank_customer_id)
      for (const acct of psu.accounts) this.byIban.set(acct.iban, psu.bank_customer_id)
    }
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
