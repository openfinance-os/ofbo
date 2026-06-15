import type { ItsmPort } from '@ofbo/ports'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-66 — scheme certificate expiry monitoring. The FAPI 2.0 chain
 * (Root CA → Al Tareq Intermediate → bank end-entity) is handled by the egress
 * gateway (P6); this monitor reads the chain's expiry dates and classifies each
 * cert by days-to-expiry: amber ≤60d, red ≤30d (+ P3 ITSM ticket), critical ≤7d
 * (+ ITSM ticket AND a High-class audit entry). The classified chain is surfaced
 * in the Operations Console; the scheduled monitor raises the tickets/audit.
 * Deterministic / synthetic in the demo (DemoCertChainSource); enterprise adapters
 * feed the real chain via P6.
 */

export const CERT_THRESHOLDS = { amber_days: 60, red_days: 30, critical_days: 7 }
export type CertRole = 'root_ca' | 'intermediate' | 'end_entity'
export type CertExpiryStatus = 'ok' | 'amber' | 'red' | 'critical'

export interface SchemeCertificate {
  name: string
  role: CertRole
  subject: string
  expires_at: string
}

export interface CertStatus {
  name: string
  role: CertRole
  subject: string
  expires_at: string
  days_to_expiry: number
  status: CertExpiryStatus
}

export interface CertChainSource {
  getCertificateChain(): Promise<SchemeCertificate[]>
}

const DAY_MS = 24 * 3600 * 1000

export function classifyCert(cert: SchemeCertificate, now: Date): CertStatus {
  const days = Math.floor((new Date(cert.expires_at).getTime() - now.getTime()) / DAY_MS)
  const status: CertExpiryStatus = days <= CERT_THRESHOLDS.critical_days ? 'critical' : days <= CERT_THRESHOLDS.red_days ? 'red' : days <= CERT_THRESHOLDS.amber_days ? 'amber' : 'ok'
  return { name: cert.name, role: cert.role, subject: cert.subject, expires_at: cert.expires_at, days_to_expiry: days, status }
}

const RANK: Record<CertExpiryStatus, number> = { ok: 0, amber: 1, red: 2, critical: 3 }
export function worstStatus(chain: CertStatus[]): CertExpiryStatus {
  return chain.reduce<CertExpiryStatus>((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), 'ok')
}

/** Read-only classification of the chain for the Operations Console surface. */
export async function classifyChain(source: CertChainSource, now: Date): Promise<{ chain: CertStatus[]; worst_status: CertExpiryStatus }> {
  const chain = (await source.getCertificateChain()).map((c) => classifyCert(c, now))
  return { chain, worst_status: worstStatus(chain) }
}

const RUN_PRINCIPAL = 'system:cert-expiry-monitor'

export interface CertExpiryMonitorDeps {
  source: CertChainSource
  /** P3 ITSM — red/critical certs raise a ticket (omit to classify only). */
  itsm?: Pick<ItsmPort, 'createTicket'>
  /** High-class audit — critical (≤7d) certs also write an audit entry (omit to skip). */
  audit?: HighClassAuditSink
  now?: () => Date
}

export interface CertMonitorResult extends CertStatus {
  ticketed: boolean
  audited: boolean
}

export class CertExpiryMonitor {
  private readonly now: () => Date
  constructor(private readonly deps: CertExpiryMonitorDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Classify the chain and escalate: red (≤30d) → a P3 ITSM ticket; critical (≤7d) →
   * an ITSM ticket AND a High-class cert_expiry_critical audit entry. amber/ok do not
   * escalate (they only surface in the console). Re-raising on each scheduled run is
   * intentional — an expiring cert is a persistent condition until renewed.
   */
  async check(traceId: string): Promise<CertMonitorResult[]> {
    const now = this.now()
    const chain = (await this.deps.source.getCertificateChain()).map((c) => classifyCert(c, now))
    const out: CertMonitorResult[] = []
    for (const c of chain) {
      let ticketed = false
      let audited = false
      if (c.status === 'red' || c.status === 'critical') {
        const severity = c.status === 'critical' ? 'critical' : 'high'
        const summary = `Scheme certificate expiry ${c.status}: ${c.name} (${c.role}) expires in ${c.days_to_expiry}d (${c.expires_at})`
        if (this.deps.itsm) {
          await this.deps.itsm.createTicket({ type: 'scheme_cert_expiry', severity, team: 'security', summary }, { trace_id: traceId })
          ticketed = true
        }
        if (c.status === 'critical' && this.deps.audit) {
          await this.deps.audit.emit({
            event_type: 'cert_expiry_critical',
            acting_principal: RUN_PRINCIPAL,
            acting_persona: 'system',
            scope_used: 'platform:operations:read',
            request_trace_id: traceId,
            request_body: { name: c.name, role: c.role, subject: c.subject, expires_at: c.expires_at, days_to_expiry: c.days_to_expiry },
            response_status: 200
          })
          audited = true
        }
      }
      out.push({ ...c, ticketed, audited })
    }
    return out
  }
}

/**
 * Deterministic demo chain: Root CA healthy, Al Tareq Intermediate in the red band
 * (~25d), bank end-entity in the critical band (~5d) — so the demo shows the full
 * amber/red/critical escalation. Dates are computed relative to `from`.
 */
export class DemoCertChainSource implements CertChainSource {
  constructor(private readonly from: () => Date = () => new Date()) {}
  async getCertificateChain(): Promise<SchemeCertificate[]> {
    const plus = (days: number) => new Date(this.from().getTime() + days * DAY_MS).toISOString()
    return [
      { name: 'CBUAE Open Finance Root CA', role: 'root_ca', subject: 'CN=CBUAE OF Root CA', expires_at: plus(900) },
      { name: 'Al Tareq Issuing Intermediate', role: 'intermediate', subject: 'CN=Al Tareq Intermediate CA', expires_at: plus(25) },
      { name: 'Bank end-entity (mTLS/PAR)', role: 'end_entity', subject: 'CN=demo-bank.of.ae', expires_at: plus(5) }
    ]
  }
}
