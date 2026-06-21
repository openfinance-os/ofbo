/**
 * UX-05 — read the form-embedded idempotency key (rendered by IdempotencyField), falling
 * back to a fresh key when absent. A stable per-render key makes a double-submit of the same
 * form idempotent (the BFF collapses it within the 24h window) while a fresh page load can
 * legitimately retry.
 */
export function idempotencyKey(formData: FormData): string {
  const k = formData.get('idempotency_key')
  return typeof k === 'string' && k.length > 0 ? k : crypto.randomUUID()
}
