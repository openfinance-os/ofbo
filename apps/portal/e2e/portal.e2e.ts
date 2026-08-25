import { test, expect, type Page } from '@playwright/test'

/**
 * Portal E2E — exercises the Next server pages + server actions end-to-end against
 * the running stack (portal → BFF → seeded Postgres). These are the surfaces vitest
 * cannot cover. Seeded demo data is assumed (cust-0001 has consents; the reconciliation
 * replay + directory sync are triggered by the test where needed, or pre-seeded in CI).
 */

const SUPER = 'platform-super-admin'

async function login(page: Page, persona: string) {
  await page.goto('/')
  await expect(page.getByTestId('persona-login-list')).toBeVisible()
  await page.getByTestId(`login-${persona}`).click()
  await page.waitForURL('**/dashboard')
}

test.describe('auth + session (app/page.tsx, api/login, dashboard/page.tsx)', () => {
  test('persona sign-in mints a session and lands on the dashboard app shell', async ({ page }) => {
    await login(page, SUPER)
    await expect(page.getByTestId('app-shell')).toBeVisible()
    // the top bar shows the FRIENDLY role label (personaLabel), not the raw persona key;
    // the raw scopes/privileges moved to /profile (reached via this identity chip).
    await expect(page.getByTestId('role-badge')).toContainText('Platform Super Admin')
    await expect(page.getByTestId('persona-badge')).toHaveAttribute('href', '/profile') // identity chip → profile
    await expect(page.getByTestId('superadmin-badge')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    // the High-class audit panel is the dashboard content
    await expect(page.getByTestId('audit-panel')).toBeVisible()
  })

  test('an unauthenticated request to a gated page redirects to sign-in', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/care')
    await expect(page).toHaveURL('/')
    await expect(page.getByTestId('persona-login-list')).toBeVisible()
  })

  test('the "how this was built" colophon opens the embedded harness map', async ({ page }) => {
    await page.goto('/')
    // the served map is reachable (the iframe + full-screen link target)
    const map = await page.request.get('/the-loom-ways-of-working.html')
    expect(map.status()).toBe(200)
    expect(await map.text()).toContain('Double Diamond')
    // pre-sign-in colophon → dialog embedding the map
    await page.getByTestId('built-with-open').click()
    await expect(page.getByTestId('built-with-dialog')).toBeVisible()
    await expect(page.getByTestId('harness-map-frame')).toHaveAttribute('src', '/the-loom-ways-of-working.html')
    await expect(page.getByTestId('built-with-full-link')).toHaveAttribute('href', '/the-loom-ways-of-working.html')
    // the embedded map actually renders its Double Diamond phase cards inside the iframe
    await expect(page.frameLocator('[data-testid="harness-map-frame"]').locator('.fc').first()).toBeVisible()
    await page.getByTestId('built-with-close').click()
    await expect(page.getByTestId('built-with-dialog')).toHaveCount(0)
  })

  test('switch persona clears the session (api/logout)', async ({ page }) => {
    await login(page, 'finance-analyst')
    await page.getByTestId('switch-persona').click()
    await expect(page).toHaveURL('/')
    await expect(page.getByTestId('persona-login-list')).toBeVisible()
  })
})

test.describe('scope-aware navigation (the §2 matrix, app-shell + page gates)', () => {
  test('super-admin sees every module', async ({ page }) => {
    await login(page, SUPER)
    for (const key of ['dashboard', 'approvals', 'customer-care', 'finance', 'analytics', 'billing-console', 'billing', 'compliance', 'risk', 'operations', 'agents', 'guide']) {
      await expect(page.getByTestId(`nav-${key}`)).toBeVisible()
    }
  })

  test('finance-analyst sees finance/analytics/billing but NOT risk/customer-care', async ({ page }) => {
    await login(page, 'finance-analyst')
    await expect(page.getByTestId('nav-finance')).toBeVisible()
    await expect(page.getByTestId('nav-analytics')).toBeVisible()
    await expect(page.getByTestId('nav-billing-console')).toBeVisible()
    await expect(page.getByTestId('nav-billing')).toBeVisible()
    await expect(page.getByTestId('nav-risk')).toHaveCount(0)
    await expect(page.getByTestId('nav-customer-care')).toHaveCount(0)
  })

  test('an out-of-scope page shows the scope-denied surface (risk-analyst → /reconciliation)', async ({ page }) => {
    // UX-07: out-of-scope deep links now land on an explicit /access-denied page (naming the
    // missing scope) instead of a silent bounce to /dashboard. The gate still blocks.
    await login(page, 'risk-analyst')
    await page.goto('/reconciliation')
    await expect(page).toHaveURL(/\/access-denied/)
    await expect(page.getByTestId('access-denied')).toBeVisible()
    await expect(page.getByTestId('denied-scope')).toContainText('reconciliation:read')
  })
})

test.describe('every console screen renders for super-admin (each page.tsx)', () => {
  const screens: [string, string][] = [
    ['/care?identifier_type=bank_customer_id&identifier=cust-0001', 'care-console'],
    ['/reconciliation', 'recon-console'],
    ['/approvals', 'approvals-portal'],
    ['/analytics', 'analytics-dashboard'],
    ['/risk', 'risk-dashboard'],
    ['/billing', 'billing-console'],
    ['/tpp-billing', 'tpp-billing'],
    ['/operations', 'operations-console'],
    ['/compliance', 'compliance-view']
  ]
  for (const [url, testid] of screens) {
    test(`renders ${url.split('?')[0]}`, async ({ page }) => {
      await login(page, SUPER)
      await page.goto(url)
      await expect(page.getByTestId(testid)).toBeVisible()
    })
  }

  test('customer care: PSU search returns the real consent inventory (no PII)', async ({ page }) => {
    await login(page, SUPER)
    await page.goto('/care?identifier_type=bank_customer_id&identifier=cust-0001')
    await expect(page.getByTestId('profile-card')).toContainText('cust-0001')
    await expect(page.getByTestId('consents-panel')).toBeVisible()
    // the contract returns no PSU name/balances — the screen must not invent any
    await expect(page.getByTestId('care-console')).not.toContainText('AL M')
  })
})

test.describe('mutating server actions (the actions.ts files)', () => {
  test('customer-care: admin-revoke a consent (care/actions.ts)', async ({ page }) => {
    await login(page, 'customer-care-agent')
    await page.goto('/care?identifier_type=bank_customer_id&identifier=cust-0001')
    await expect(page.getByTestId('consents-panel')).toBeVisible()
    const revoke = page.locator('[data-testid^="revoke-form-"] button[type="submit"]').first()
    if ((await revoke.count()) > 0) {
      await revoke.click()
      await expect(page).toHaveURL(/[?&]status=(revoked|revoke_failed)/, { timeout: 30_000 })
      await expect(page.getByTestId('care-console')).toBeVisible()
    } else {
      test.info().annotations.push({ type: 'note', description: 'no revocable consent present — revoke action not exercised this run' })
    }
  })

  test('reconciliation: claim a flagged break (reconciliation/actions.ts)', async ({ page }) => {
    await login(page, 'finance-analyst')
    await page.goto('/reconciliation')
    await expect(page.getByTestId('break-queue')).toBeVisible()
    const claim = page.locator('[data-testid^="claim-form-"] button[type="submit"]').first()
    if ((await claim.count()) > 0) {
      await claim.click()
      await expect(page).toHaveURL(/[?&]status=(claimed|claim_failed)/, { timeout: 30_000 })
    } else {
      test.info().annotations.push({ type: 'note', description: 'no flagged break present — claim action not exercised this run' })
    }
  })
})

/**
 * BILL-17 — the TPP Cost Management section of the billing console.
 *
 * Driven against the seeded demo evidence, which deliberately seeds TWO periods so the close gate
 * can be demonstrated in both directions: the month before last is CLOSED (with a dispatched then
 * accepted payable) and last month is BLOCKED by a material VAT-variance break. One period could
 * only ever show one of those states.
 */
test.describe('TPP Cost Management console (BILL-17)', () => {
  // Mirrors packages/db/src/seed-demo.ts: closed = month(2), blocked = month(1), UTC.
  const month = (back: number) => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7)
  }
  const CLOSED = month(2)
  const BLOCKED = month(1)

  test('the closed period reports closed and shows its four-eyes evidence', async ({ page }) => {
    await login(page, SUPER)
    await page.goto(`/billing?period=${CLOSED}`)
    await expect(page.getByTestId('tpp-cost-console')).toBeVisible()
    await expect(page.getByTestId('close-state')).toContainText(/reconciled|closed/i)
    // The close is evidence of a four-eyes act, so the screen must show WHO — a period that closed
    // itself would be the defect this whole gate exists to prevent.
    await expect(page.getByTestId('close-evidence')).toBeVisible()
  })

  test('the blocked period names its blockers and refuses the close control', async ({ page }) => {
    await login(page, SUPER)
    await page.goto(`/billing?period=${BLOCKED}`)
    await expect(page.getByTestId('tpp-cost-console')).toBeVisible()
    await expect(page.getByTestId('cost-blockers')).toBeVisible()
    // Blocked means the close cannot be requested. A control that looked available and then 409'd
    // would teach the operator to ignore the refusal — and the reason must be stated, not implied
    // by a greyed-out button.
    await expect(page.getByTestId('request-close-form').getByRole('button')).toBeDisabled()
    await expect(page.getByTestId('close-disabled-reason')).toBeVisible()
  })

  test('a blocker links to its real E1 break so "Investigate" resolves', async ({ page }) => {
    await login(page, SUPER)
    await page.goto(`/billing?period=${BLOCKED}`)
    const link = page.getByTestId('cost-blockers').getByRole('link').first()
    await expect(link).toBeVisible()
    await link.click()
    // Lands on the investigation surface rather than a dead href — the escalation path this story
    // had to build for the gate to be clearable at all.
    await expect(page).toHaveURL(/\/reconciliation\/breaks\//)
  })

  test('the payables table shows the dispatch state from the append-only log', async ({ page }) => {
    await login(page, SUPER)
    await page.goto(`/billing?period=${CLOSED}`)
    await expect(page.getByTestId('cost-payables')).toBeVisible()
    // Seeded as dispatched THEN accepted (two rows — the table is a state log), so the latest
    // state is what the console must show.
    await expect(page.getByTestId('cost-payables')).toContainText(/accepted/i)
  })

  test('the governed export is offered to the finance persona, beside the write controls', async ({ page }) => {
    // NOT asserted here: the read-only branch (billing:read WITHOUT
    // finance:reconciliation:write). No demo persona holds that combination — finance-analyst has
    // both and every other persona lacks billing:read entirely — so a browser test for it would be
    // asserting a fiction. The `canWrite: false` branch is covered at component level instead
    // (tpp-cost-console.spec.tsx), where the input can actually be constructed.
    await login(page, 'finance-analyst')
    await page.goto(`/billing?period=${BLOCKED}`)
    await expect(page.getByTestId('tpp-cost-console')).toBeVisible()
    await expect(page.getByTestId('tpp-cost-export-link')).toBeVisible()
    await expect(page.getByTestId('request-close-form')).toBeVisible()
  })

  test('the governed evidence export downloads a pack with a recomputable digest', async ({ page }) => {
    await login(page, SUPER)
    const response = await page.request.get(`/api/billing/tpp-cost-export?period=${CLOSED}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-disposition']).toContain(`ofbo-tpp-cost-evidence-${CLOSED}.json`)
    const pack = await response.json()
    expect(pack.period).toBe(CLOSED)
    expect(typeof pack.sha256).toBe('string')
    expect(pack.record_counts.closes).toBeGreaterThan(0)
    expect(pack.record_counts.dispatches).toBeGreaterThan(0)
    // No PSU identifier can reach the payable ledger by construction; assert it on the artefact a
    // human actually receives, not only on the rows behind it.
    expect(JSON.stringify(pack)).not.toMatch(/\b784-\d{4}-\d{7}-\d\b/)
  })

  test('the export refuses a malformed period rather than guessing one', async ({ page }) => {
    await login(page, SUPER)
    const response = await page.request.get('/api/billing/tpp-cost-export?period=2026-13')
    expect(response.status()).toBe(400)
  })

  test('the IA rename ships: billing is "Billing & TPP Cost", the registry is "LFI Revenue"', async ({ page }) => {
    await login(page, SUPER)
    await expect(page.getByTestId('nav-billing-console')).toContainText(/TPP Cost/i)
    await expect(page.getByTestId('nav-billing')).toContainText(/LFI Revenue/i)
  })
})
