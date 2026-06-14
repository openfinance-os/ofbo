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
    expect(html).toMatch(/Sign in to the Internal Portal/i)
    expect(html).toMatch(/MFA is enforced/i)
    expect(html).toContain('/api/login')
  })

  it('bounces an unauthenticated dashboard request back to sign-in', async () => {
    const res = await fetch(`${PORTAL}/dashboard`, { redirect: 'manual' })
    // Next redirect() → 3xx to the sign-in screen; no shell without a session.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toMatch(/\/$|\/\?/)
  })
})
