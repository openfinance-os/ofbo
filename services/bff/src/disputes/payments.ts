import { generateDemoDataset } from '@ofbo/synthetic-data'
import type { ConsentAdminView } from '../consents/directory.js'

/**
 * BACKOFFICE-20 — payment investigation data source. The demo profile reads the
 * deterministic synthetic payment history (the "existing LFI/TPP API services"
 * reused per the PRD); the enterprise adapter (M6) implements this interface
 * against the real services. consent_at_time_of_payment reuses the consent admin
 * view of the payment's originating consent.
 */

export interface PaymentAdminView {
  payment_id: string
  ipp_status: string
  consent_at_time_of_payment: ConsentAdminView | null
  cop_outcome: unknown
  risk_information_block: unknown
  channel: string
  /** Internal PSU id (non-PII) — used to stamp a dispute opened from this payment. */
  psu_identifier: string
}

export interface PaymentSource {
  get(paymentId: string): PaymentAdminView | null
  /** All payments for a PSU (internal bank_customer_id) — the inquiry bundle. */
  byPsu(psuIdentifier: string): PaymentAdminView[]
}

export class DemoPaymentDirectory implements PaymentSource {
  private readonly byId = new Map<string, PaymentAdminView>()
  private readonly byPsuId = new Map<string, PaymentAdminView[]>()

  constructor(seed?: number) {
    const ds = seed === undefined ? generateDemoDataset() : generateDemoDataset(seed)
    for (const psu of ds.psus) {
      const consentById = new Map(psu.consents.map((c) => [c.consent_id, c]))
      for (const p of psu.payments) {
        const c = consentById.get(p.originating_consent_id)
        const consentView: ConsentAdminView | null = c
          ? {
              consent_id: c.consent_id,
              tpp: { client_id: c.tpp_client_id, display_name: c.tpp_display_name },
              purpose: c.purpose,
              scope: c.scope,
              status: c.status,
              granted_at: c.granted_at,
              expires_at: c.expires_at,
              last_access_at: c.last_access_at
            }
          : null
        const view: PaymentAdminView = {
          payment_id: p.payment_id,
          ipp_status: p.ipp_status,
          consent_at_time_of_payment: consentView,
          cop_outcome: p.cop_outcome,
          risk_information_block: p.risk_information_block,
          channel: p.channel,
          psu_identifier: psu.bank_customer_id
        }
        this.byId.set(p.payment_id, view)
        const list = this.byPsuId.get(psu.bank_customer_id) ?? []
        list.push(view)
        this.byPsuId.set(psu.bank_customer_id, list)
      }
    }
  }

  get(paymentId: string): PaymentAdminView | null {
    return this.byId.get(paymentId) ?? null
  }

  byPsu(psuIdentifier: string): PaymentAdminView[] {
    return this.byPsuId.get(psuIdentifier) ?? []
  }
}
