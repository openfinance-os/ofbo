import { describe, expect, it } from 'vitest'
import { redactPii, redactText } from '../src/index.js'

// PII-shaped inputs assembled at runtime — no real-shaped literal exists as
// source text (repo pii-guard convention); the library must catch the shapes
// at emission time regardless.
const EMIRATES_ID = ['784', '1990', '1234567', '1'].join('-')
const REAL_SHAPED_IBAN = 'AE07' + '0331234567890123456'

describe('BACKOFFICE-51 — shared PII redaction library', () => {
  it('masks Emirates-ID shapes (hyphen/space/dot separators)', () => {
    for (const sep of ['-', ' ', '.']) {
      const id = EMIRATES_ID.replace(/-/g, sep)
      expect(redactText(`id ${id} end`)).toBe('id [REDACTED:emirates_id] end')
    }
  })

  it('masks numeric Emirates-ID values, not just strings', () => {
    const numeric = Number(EMIRATES_ID.replace(/-/g, ''))
    const out = redactPii({ emirates_id: numeric, amount: 1500 })
    expect(out.emirates_id).toBe('[REDACTED:emirates_id]')
    expect(out.amount).toBe(1500) // ordinary numbers survive
  })

  it('masks IBAN shapes including grouped and lowercase variants', () => {
    // grouped variant assembled at runtime, like every PII shape in this file
    const grouped = REAL_SHAPED_IBAN.replace(/(.{4})/g, '$1 ').trim()
    const out = redactPii({
      a: REAL_SHAPED_IBAN,
      b: grouped,
      c: REAL_SHAPED_IBAN.toLowerCase()
    })
    for (const v of Object.values(out)) expect(v).toBe('[REDACTED:iban]')
  })

  it('redacts well-known PII keys entirely', () => {
    const out = redactPii({
      full_name: 'Zayn Al-Fiction',
      name: 'x',
      account_number: '0012345678',
      email: 'zayn@example.invalid',
      phone: '+971-0000',
      address: 'nowhere',
      note: 'survives'
    })
    for (const k of ['full_name', 'name', 'account_number', 'email', 'phone', 'address']) {
      expect(out[k], k).toBe('[REDACTED:key]')
    }
    expect(out.note).toBe('survives')
  })

  it('recurses into nested objects/arrays without mutating input', () => {
    const input = { a: [{ emirates_id: EMIRATES_ID }], b: { c: 'plain' } }
    const out = redactPii(input)
    expect(out.a[0].emirates_id).toBe('[REDACTED:emirates_id]')
    expect(out.b.c).toBe('plain')
    expect(input.a[0]!.emirates_id).toBe(EMIRATES_ID)
  })

  it('redactText is the log-emission helper: masks shapes inside free text', () => {
    const line = `lookup for ${EMIRATES_ID} via ${REAL_SHAPED_IBAN} ok`
    const out = redactText(line)
    expect(out).not.toContain(EMIRATES_ID)
    expect(out).not.toContain(REAL_SHAPED_IBAN)
    expect(out).toContain('[REDACTED:emirates_id]')
    expect(out).toContain('[REDACTED:iban]')
  })

  it('masks underscore-separated Emirates-ID shapes (adapter-specific separators)', () => {
    const id = EMIRATES_ID.replace(/-/g, '_')
    expect(redactText(`id ${id} end`)).toBe('id [REDACTED:emirates_id] end')
  })

  it('masks email addresses in free text (a value not under a known PII key)', () => {
    const email = ['zayn', 'example.invalid'].join('@')
    expect(redactText(`contact ${email} please`)).toBe('contact [REDACTED:email] please')
    // a free-text note carrying an email is scrubbed in place, not left to leak
    expect(redactPii({ note: `reach ${email}` }).note).toBe('reach [REDACTED:email]')
    // an email-only value collapses to the marker
    expect(redactPii(email)).toBe('[REDACTED:email]')
  })

  it('redacts common PII key-name variants entirely', () => {
    const out = redactPii({
      phone_number: 'x',
      mobile: 'x',
      email_address: 'x',
      contact_email: 'x',
      middle_name: 'x',
      date_of_birth: '1990-01-01',
      dob: '1990-01-01',
      national_id: 'x',
      passport_number: 'x',
      reference: 'survives'
    })
    for (const k of ['phone_number', 'mobile', 'email_address', 'contact_email', 'middle_name', 'date_of_birth', 'dob', 'national_id', 'passport_number']) {
      expect(out[k], k).toBe('[REDACTED:key]')
    }
    expect(out.reference).toBe('survives')
  })
})
