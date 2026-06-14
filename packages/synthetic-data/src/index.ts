import { makePick, mulberry32 } from './rng.js'

/**
 * Deterministic synthetic demo dataset. PII-safe BY CONSTRUCTION (hard stop:
 * zero real PII, ever — both profiles):
 *   - Emirates IDs use the 999 prefix (real ones start 784)
 *   - IBANs use synthetic bank code 000: AEkk000…
 *   - names are fictional-only
 */

export const DEFAULT_SEED = 20260611

export const DEMO_BANK_ID = '11111111-1111-4111-8111-111111111111'

const CHANNELS = ['internal_retail', 'internal_sme', 'internal_corporate', 'external_direct', 'external_tpp_aas'] as const
const CONSENT_STATUSES = ['AwaitingAuthorization', 'Authorized', 'Rejected', 'Suspended', 'Consumed', 'Expired', 'Revoked'] as const
const LINE_TYPES = ['nebras_fees', 'payment_settlement', 'consent_record', 'tpp_aas_pass_through', 'lfi_access_log'] as const
const TPPS = ['org-fictional-fintech-01', 'org-fictional-fintech-02', 'org-fictional-fintech-03'] as const
const FIRST_NAMES = ['Zayn', 'Lulwa', 'Omar', 'Mariam', 'Tariq', 'Noor', 'Hessa', 'Faris'] as const
const LAST_NAMES = ['Al-Fiction', 'Demoson', 'Testwala', 'Samplebhai', 'Mockner', 'Specced'] as const

export const PERSONA_LOGINS = [
  'operations-analyst',
  'customer-care-agent',
  'compliance-officer',
  'finance-analyst',
  'risk-analyst',
  'commercial-desk-head',
  'programme-manager',
  'platform-super-admin'
] as const

export interface Money {
  amount: number
  currency: 'AED'
}

export interface DemoDataset {
  bank_id: string
  persona_logins: readonly string[]
  psus: {
    bank_customer_id: string
    emirates_id: string
    full_name: string
    accounts: { iban: string; account_ref: string }[]
    consents: {
      consent_id: string
      tpp_organisation_id: string
      tpp_client_id: string
      tpp_display_name: string
      purpose: string
      scope: string[]
      status: (typeof CONSENT_STATUSES)[number]
      granted_at: string
      expires_at: string | null
      last_access_at: string | null
    }[]
  }[]
  billing_lines: {
    line_ref: string
    channel: (typeof CHANNELS)[number]
    line_type: (typeof LINE_TYPES)[number]
    tpp_organisation_id: string
    fee: Money
    occurred_at: string
  }[]
}

/** OF v2.1 data-scope sets per purpose — deterministic, no RNG draw. */
const SCOPE_BY_PURPOSE: Record<string, string[]> = {
  AISP_DATA_SHARING: ['accounts:read', 'balances:read', 'transactions:read'],
  SIP_PAYMENT: ['payments:initiate'],
  COP_CONFIRMATION: ['cop:confirm']
}

/** Statuses for which the PSU's data was actually accessed → a last_access exists. */
const ACCESSED_STATUSES = new Set(['Authorized', 'Consumed', 'Expired', 'Revoked'])

/** Deterministic UUID-v4-shaped client id from an organisation id (no RNG draw,
 *  so enrichment never shifts the generator's byte-repeatable sequence). */
function deterministicClientId(org: string): string {
  let h = 0x811c9dc5
  const out: string[] = []
  for (let i = 0; i < 32; i++) {
    h ^= org.charCodeAt(i % org.length) + i
    h = Math.imul(h, 0x01000193) >>> 0
    out.push((h & 0xf).toString(16))
  }
  out[12] = '4'
  out[16] = ((parseInt(out[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = out.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/** 'org-fictional-fintech-01' → 'Fictional Fintech 01'. */
function tppDisplayName(org: string): string {
  return org
    .replace(/^org-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().replace('.000Z', 'Z')
}

export function generateDemoDataset(seed: number = DEFAULT_SEED): DemoDataset {
  const pick = makePick(mulberry32(seed))

  const psus = Array.from({ length: 6 }, (_, i) => {
    const accounts = Array.from({ length: pick.int(1, 3) }, () => ({
      iban: `AE${pick.digits(2)}000${pick.digits(16)}`,
      account_ref: `acc-${pick.digits(6)}`
    }))
    const consents = Array.from({ length: pick.int(3, 6) }, () => {
      // RNG draws stay in the original order; derived fields consume no draws.
      const consent_id = pick.uuid()
      const tpp_organisation_id = pick.of(TPPS)
      const purpose = pick.of(['AISP_DATA_SHARING', 'SIP_PAYMENT', 'COP_CONFIRMATION'] as const)
      const status = pick.of(CONSENT_STATUSES)
      const granted_at = `2026-0${pick.int(1, 5)}-${String(pick.int(1, 28)).padStart(2, '0')}T${String(pick.int(0, 23)).padStart(2, '0')}:00:00Z`
      return {
        consent_id,
        tpp_organisation_id,
        tpp_client_id: deterministicClientId(tpp_organisation_id),
        tpp_display_name: tppDisplayName(tpp_organisation_id),
        purpose,
        scope: SCOPE_BY_PURPOSE[purpose] ?? [],
        status,
        granted_at,
        expires_at: status === 'AwaitingAuthorization' || status === 'Rejected' ? null : addMonthsIso(granted_at, 12),
        last_access_at: ACCESSED_STATUSES.has(status) ? addMonthsIso(granted_at, 1) : null
      }
    })
    return {
      bank_customer_id: `cust-${String(i + 1).padStart(4, '0')}`,
      emirates_id: `999-${pick.int(1960, 2005)}-${pick.digits(7)}-${pick.digits(1)}`,
      full_name: `${pick.of(FIRST_NAMES)} ${pick.of(LAST_NAMES)}`,
      accounts,
      consents
    }
  })

  // fee schedule in fils-as-minor-units; aggregated lines stay integer
  const billing_lines = Array.from({ length: 120 }, (_, i) => ({
    line_ref: `bill-2026-05-${String(i + 1).padStart(4, '0')}`,
    channel: CHANNELS[i % CHANNELS.length]!,
    line_type: pick.of(LINE_TYPES),
    tpp_organisation_id: pick.of(TPPS),
    fee: { amount: pick.int(1, 500), currency: 'AED' as const },
    occurred_at: `2026-05-${String(pick.int(1, 31)).padStart(2, '0')}T${String(pick.int(0, 23)).padStart(2, '0')}:${String(pick.int(0, 59)).padStart(2, '0')}:00Z`
  }))

  return { bank_id: DEMO_BANK_ID, persona_logins: PERSONA_LOGINS, psus, billing_lines }
}
