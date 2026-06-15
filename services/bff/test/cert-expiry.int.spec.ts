import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { CertExpiryMonitor, type SchemeCertificate } from '../src/ops/cert-expiry.js'

/**
 * BACKOFFICE-66 integration: a critical (≤7d) scheme certificate writes a High-class
 * cert_expiry_critical audit entry (INSERT-only) under RLS. Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

class FakeItsm {
  tickets: { team: string; severity: string }[] = []
  async createTicket(input: { team: string; severity: string }) {
    this.tickets.push({ team: input.team, severity: input.severity })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

describe('cert expiry monitor — critical audit under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('a critical cert writes a cert_expiry_critical High-class audit; red does not', async () => {
    const now = new Date('2026-06-16T00:00:00.000Z')
    const plus = (d: number) => new Date(now.getTime() + d * 24 * 3600 * 1000).toISOString()
    const chain: SchemeCertificate[] = [
      { name: 'root', role: 'root_ca', subject: 'CN=root', expires_at: plus(900) },
      { name: 'inter', role: 'intermediate', subject: 'CN=inter', expires_at: plus(20) }, // red
      { name: 'leaf', role: 'end_entity', subject: 'CN=leaf', expires_at: plus(4) } // critical
    ]
    const itsm = new FakeItsm()
    const trace = randomUUID()
    const out = await new CertExpiryMonitor({ source: { getCertificateChain: async () => chain }, itsm, audit, now: () => now }).check(trace)
    expect(out.find((c) => c.role === 'end_entity')!.audited).toBe(true)

    const ev = await admin.query(
      `SELECT acting_principal, request_body_redacted FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'cert_expiry_critical'`,
      [trace]
    )
    expect(ev.rows).toHaveLength(1) // only the critical cert audits, not the red one
    expect(ev.rows[0].acting_principal).toBe('system:cert-expiry-monitor')
    expect((ev.rows[0].request_body_redacted as { role: string }).role).toBe('end_entity')
    // red + critical both ticket (security team)
    expect(itsm.tickets.filter((t) => t.team === 'security').length).toBe(2)
  })
})
