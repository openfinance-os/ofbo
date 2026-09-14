import { describe, expect, it } from 'vitest'

/**
 * M1-PORTAL-SHELL acceptance against the DEPLOYED demo portal (PRD §9 M1 exit
 * criteria: persona login → portal shell → admin-scoped echo, audit visible,
 * DEMO banner present). Runs in the deploy workflow after every merge — a broken
 * portal fails the pipeline, not the next visitor.
 */

const PORTAL = process.env.DEMO_PORTAL_URL ?? 'https://ofbo-portal.michartmann.workers.dev'

describe('demo portal (Cloudflare Worker, OpenNext)', () => {
  it('serves the sign-in screen with the persistent DEMO banner', async () => {
    const res = await fetch(PORTAL, { redirect: 'manual' })
    expect(res.status).toBe(200)
    const html = await res.text()
    // DEMO banner — present on every screen (hard stop)
    expect(html).toMatch(/DEMO/)
    expect(html).toMatch(/synthetic data only/i)
    // sign-in screen with at least one MFA-gated persona option
    expect(html).toMatch(/Choose a role to explore/i)
    expect(html).toMatch(/MFA is enforced/i)
    expect(html).toContain('/api/login')
  })

  it('bounces an unauthenticated dashboard request back to sign-in', async () => {
    const res = await fetch(`${PORTAL}/dashboard`, { redirect: 'manual' })
    const html = await res.text()

    // THE security property, asserted first and directly: no session, no shell.
    // `requireSession()` calls Next's `redirect('/')` before any panel renders, so a
    // response that carries the authenticated shell means the guard did not run —
    // which is the failure this test exists to catch. The old assertion never looked
    // at the body at all, so it could not tell a leak from a bounce.
    expect(html).not.toContain('data-testid="app-shell"')
    expect(html).not.toMatch(/data-testid="(sidebar|persona-badge|audit-panel)"/)

    // …and the visitor is actually sent to sign-in. Next expresses `redirect()` two
    // different ways depending on whether the response has begun streaming: a 3xx with
    // a Location header, or — for a `dynamic = 'force-dynamic'` page whose <head> has
    // already flushed, which /dashboard is — a 200 carrying
    // `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/">`.
    // Both are the same redirect. Pinning only the 3xx form made this gate red from
    // 2026-07-26 on a page that was behaving correctly (HARNESS-14).
    const location = res.headers.get('location')
    const metaRefresh = /<meta[^>]+id="__next-page-redirect"[^>]+content="[^"]*url=\/"/.test(html)
    const httpRedirect = res.status >= 300 && res.status < 400 && /\/$|\/\?/.test(location ?? '')
    expect(
      httpRedirect || metaRefresh,
      `expected a bounce to sign-in, got status ${res.status} location=${location ?? 'none'}`
    ).toBe(true)
  })

  /**
   * BACKOFFICE-102 — the gate that was missing.
   *
   * This suite asserted that the sign-in SCREEN renders, and nothing more, so a deployment on
   * which no persona could actually sign in passed the pipeline green and reached the next
   * visitor. That is what happened: every button answered `/?error=service_unavailable` while
   * every assertion above stayed true.
   *
   * So the smoke suite now presses the buttons. Every persona the screen offers, in sequence,
   * because the defect it exists to catch was not present on the FIRST sign-in a Worker isolate
   * served — it was the second and every one after it, reusing a connection that belonged to an
   * earlier request. A single sign-in would have passed straight through it.
   *
   * It is also the end-to-end check for the whole sign-in chain: a reachable database, a
   * successful High-class audit write, a session cookie. Any of those failing lands on
   * `/?error=…`, which this reads back and reports by name.
   */
  it('signs in every persona the screen offers, not just the first', async () => {
    const html = await (await fetch(PORTAL)).text()
    // Deduplicated: the same hidden input appears in both the HTML and the RSC payload, and each
    // persona is to be signed in once.
    const tokens = [...new Set([...html.matchAll(/name="token"[^>]*?value="([^"]+)"/g)].map((m) => m[1]!))]
    // The screen is the source of the persona list, so a parse that finds nothing would leave this
    // test passing without signing anyone in. TWO is the floor rather than one: a single sign-in
    // cannot see a defect that only appears on the second request an isolate serves.
    expect(tokens.length, 'the sign-in screen must offer at least two persona sign-in buttons').toBeGreaterThan(1)

    for (const token of tokens) {
      const res = await fetch(`${PORTAL}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        redirect: 'manual'
      })
      const location = res.headers.get('location') ?? ''
      // The token is `demo-token:<persona>` — the persona is what the failure message must name,
      // so a red pipeline says which button is broken without anyone opening the demo.
      const persona = token.split(':')[1] ?? token
      expect(res.status, `sign-in for ${persona} must redirect`).toBe(303)
      expect(location, `sign-in for ${persona} must reach the dashboard, got ${location}`).toMatch(/\/dashboard$/)
      expect(res.headers.get('set-cookie') ?? '', `sign-in for ${persona} must set a session cookie`).toMatch(/HttpOnly/i)
    }
  }, 60_000)
})
