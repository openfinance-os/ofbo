import { describe, expect, it } from 'vitest'
import { generateDemoDataset, DEFAULT_SEED } from '../src/index.js'

describe('synthetic demo dataset', () => {
  it('is deterministic: same seed → byte-identical dataset', () => {
    const a = generateDemoDataset(DEFAULT_SEED)
    const b = generateDemoDataset(DEFAULT_SEED)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('differs for a different seed', () => {
    expect(JSON.stringify(generateDemoDataset(DEFAULT_SEED))).not.toBe(JSON.stringify(generateDemoDataset(7)))
  })

  it('is PII-safe by construction', () => {
    const blob = JSON.stringify(generateDemoDataset(DEFAULT_SEED)).replace(/[\s-]/g, '')
    expect(blob).not.toMatch(/784\d{12}/) // real Emirates-ID prefix never appears
    const ds = generateDemoDataset(DEFAULT_SEED)
    for (const psu of ds.psus) {
      expect(psu.emirates_id).toMatch(/^999-\d{4}-\d{7}-\d$/)
      for (const acc of psu.accounts) expect(acc.iban).toMatch(/^AE\d{2}000\d{16}$/) // synthetic bank code 000
    }
  })

  it('has demo-walkthrough volume and coverage', () => {
    const ds = generateDemoDataset(DEFAULT_SEED)
    expect(ds.psus.length).toBeGreaterThanOrEqual(5)
    for (const psu of ds.psus) expect(psu.consents.length).toBeGreaterThanOrEqual(3)
    expect(ds.billing_lines.length).toBeGreaterThanOrEqual(100)
    const channels = new Set(ds.billing_lines.map((l) => l.channel))
    expect(channels.size).toBe(5)
    expect(ds.persona_logins).toHaveLength(8)
  })

  it('uses binding Money everywhere (integer minor units + ISO 4217)', () => {
    const ds = generateDemoDataset(DEFAULT_SEED)
    for (const line of ds.billing_lines) {
      expect(Number.isInteger(line.fee.amount)).toBe(true)
      expect(line.fee.currency).toBe('AED')
    }
  })

  it('consent statuses come from the 7-state CBUAE lifecycle', () => {
    const ds = generateDemoDataset(DEFAULT_SEED)
    const valid = ['AwaitingAuthorization', 'Authorized', 'Rejected', 'Suspended', 'Consumed', 'Expired', 'Revoked']
    const seen = new Set<string>()
    for (const psu of ds.psus) for (const c of psu.consents) {
      expect(valid).toContain(c.status)
      seen.add(c.status)
    }
    expect(seen.size).toBeGreaterThanOrEqual(4) // walkthroughs need lifecycle variety
  })
})
