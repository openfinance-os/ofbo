/** Session cookie name. The value is a demo IdP token (`demo-token:<persona>`),
 *  never PII. Stored httpOnly so it is unreachable from page JS — no PII and no
 *  bearer material in browser-accessible storage (CLAUDE.md hard stop). */
export const TOKEN_COOKIE = 'ofbo_portal_token'

/** HOST-01 scaffold (ADR 0028) — the selected demo tenant slug for the flagged multi-tenant demo.
 *  Value is a tenant slug (e.g. `beta-bank`), never PII. Only meaningful when MULTITENANT_DEMO is on;
 *  ignored otherwise. httpOnly so page JS can't read it — the switch is a server-side POST. */
export const TENANT_COOKIE = 'ofbo_tenant'
