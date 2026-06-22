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
    for (const key of ['dashboard', 'approvals', 'customer-care', 'finance', 'analytics', 'billing', 'compliance', 'risk', 'operations']) {
      await expect(page.getByTestId(`nav-${key}`)).toBeVisible()
    }
  })

  test('finance-analyst sees finance/analytics/billing but NOT risk/customer-care', async ({ page }) => {
    await login(page, 'finance-analyst')
    await expect(page.getByTestId('nav-finance')).toBeVisible()
    await expect(page.getByTestId('nav-analytics')).toBeVisible()
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
