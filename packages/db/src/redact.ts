/**
 * BACKOFFICE-45: PII redaction at emission — prod PII may exist ONLY inside
 * audit-class records, and even there identifier shapes are masked. This is the
 * seed of the shared redaction library (BACKOFFICE-51 extracts and extends it).
 */

const REDACTED_KEYS = new Set([
  'full_name',
  'name',
  'first_name',
  'last_name',
  'account_number',
  'phone',
  'email',
  'address'
])

// Separator-tolerant identifier shapes (matching the repo pii-guard conventions).
const EMIRATES_ID_RE = /\b\d{3}[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g
const IBAN_RE = /\bAE\d{2}(?:[ -]?\d){19}\b/g

function redactString(value: string): string {
  return value.replace(EMIRATES_ID_RE, '[REDACTED:emirates_id]').replace(IBAN_RE, '[REDACTED:iban]')
}

function isFullyRedactedString(s: string): boolean {
  return s === '[REDACTED:emirates_id]' || s === '[REDACTED:iban]'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function redactPii<T>(input: T): any {
  if (typeof input === 'string') {
    const r = redactString(input)
    // a string that was nothing but the identifier collapses to the marker
    return isFullyRedactedString(r.trim()) ? r.trim() : r
  }
  if (Array.isArray(input)) return input.map((v) => redactPii(v))
  if (input !== null && typeof input === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[REDACTED:key]' : redactPii(v)
    }
    return out
  }
  return input
}
