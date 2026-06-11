/**
 * BACKOFFICE-51: the shared PII redaction library — the single masking path for
 * audit emission, operational logs, and telemetry (hard stop: PII never appears
 * in operational logs or telemetry; prod PII only inside audit-class records,
 * masked). Extracted from the BACKOFFICE-45 seed in @ofbo/db.
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

// Separator-tolerant identifier shapes (matching the repo pii-guard conventions);
// dots and case variants count — redaction errs toward masking.
const EMIRATES_ID_RE = /\b\d{3}[-. ]?\d{4}[-. ]?\d{7}[-. ]?\d\b/g
const IBAN_RE = /\bAE\d{2}(?:[ .-]?\d){19}\b/gi
// A bare 15-digit number is Emirates-ID-shaped (3+4+7+1) — covers numeric values.
const NUMERIC_EMIRATES_RE = /^\d{15}$/

/** Log-emission helper: masks identifier shapes inside free text. */
export function redactText(value: string): string {
  return value.replace(EMIRATES_ID_RE, '[REDACTED:emirates_id]').replace(IBAN_RE, '[REDACTED:iban]')
}

function isFullyRedactedString(s: string): boolean {
  return s === '[REDACTED:emirates_id]' || s === '[REDACTED:iban]'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function redactPii<T>(input: T): any {
  if (typeof input === 'string') {
    const r = redactText(input)
    return isFullyRedactedString(r.trim()) ? r.trim() : r
  }
  if (typeof input === 'number' && Number.isInteger(input) && NUMERIC_EMIRATES_RE.test(String(input))) {
    return '[REDACTED:emirates_id]'
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
