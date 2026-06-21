/**
 * UX-05 — a per-render idempotency key. The actions used to mint a fresh Idempotency-Key on
 * every call, so a double-submit was treated as two distinct operations (the 24h idempotency
 * window was never exercised from the UI). This hidden field is minted ONCE when the form is
 * server-rendered, so a double-click of the SAME rendered form carries the SAME key (the BFF
 * collapses it to one effect) while a fresh page load mints a new key and can legitimately
 * retry. The action reads formData 'idempotency_key'. Server-rendered (no client hydration).
 */
export function IdempotencyField() {
  return <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
}
