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

})
