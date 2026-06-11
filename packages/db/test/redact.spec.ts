import { describe, expect, it } from 'vitest'
import { redactPii } from '../src/redact.js'

// PII-shaped test inputs are assembled at runtime so no real-shaped literal
// ever exists in the repo (the pii-guard hook enforces that for source text;
// the redactor must still catch such shapes arriving at emission time).
const EMIRATES_ID = ['784', '1990', '1234567', '1'].join('-')
const REAL_SHAPED_IBAN = 'AE07' + '0331234567890123456'

describe('BACKOFFICE-45 — PII redaction at emission', () => {
  it('masks Emirates-ID shapes wherever they appear in a body', () => {
    const out = redactPii({ note: `customer id ${EMIRATES_ID} on file`, emirates_id: EMIRATES_ID })
    expect(JSON.stringify(out)).not.toContain(EMIRATES_ID)
    expect(out.emirates_id).toBe('[REDACTED:emirates_id]')
    expect(out.note).toContain('[REDACTED:emirates_id]')
  })

  it('masks IBAN shapes including separator-grouped and lowercase ones', () => {
    const grouped = 'AE07 0331 2345 6789 0123 456'
    const lower = REAL_SHAPED_IBAN.toLowerCase()
    const out = redactPii({ iban: REAL_SHAPED_IBAN, grouped, lower })
    expect(JSON.stringify(out)).not.toContain(REAL_SHAPED_IBAN)
    expect(JSON.stringify(out)).not.toContain(lower)
    expect(out.iban).toBe('[REDACTED:iban]')
    expect(out.grouped).toBe('[REDACTED:iban]')
  })

  it('masks dot-separated Emirates-ID shapes', () => {
    const dotted = EMIRATES_ID.replace(/-/g, '.')
    const out = redactPii({ note: `id ${dotted}` })
    expect(out.note).not.toContain(dotted)
    expect(out.note).toContain('[REDACTED:emirates_id]')
  })

  it('redacts well-known PII keys entirely (names, account numbers)', () => {
    const out = redactPii({ full_name: 'Zayn Al-Fiction', account_number: '0012345678', amount: 1500 })
    expect(out.full_name).toBe('[REDACTED:key]')
    expect(out.account_number).toBe('[REDACTED:key]')
    expect(out.amount).toBe(1500) // non-PII survives
  })

  it('recurses into nested objects and arrays without mutating the input', () => {
    const input = { a: [{ emirates_id: EMIRATES_ID }], b: { c: 'plain' } }
    const out = redactPii(input)
    expect(out.a[0].emirates_id).toBe('[REDACTED:emirates_id]')
    expect(out.b.c).toBe('plain')
    expect(input.a[0]!.emirates_id).toBe(EMIRATES_ID) // input untouched
  })
})
