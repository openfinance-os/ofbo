/** Session cookie name. The value is a demo IdP token (`demo-token:<persona>`),
 *  never PII. Stored httpOnly so it is unreachable from page JS — no PII and no
 *  bearer material in browser-accessible storage (CLAUDE.md hard stop). */
export const TOKEN_COOKIE = 'ofbo_portal_token'
