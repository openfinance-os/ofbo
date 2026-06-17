import { defineConfig, devices } from '@playwright/test'

/**
 * Portal E2E (Playwright) — closes the automated-coverage gap on the Next server
 * pages + actions, which vitest cannot exercise (they need cookies()/redirect(),
 * the IdP port, and a live BFF). These specs drive the real running stack
 * (portal + BFF + Nebras sim + seeded Postgres) through the persona sign-in,
 * scope-aware nav, every console screen, and the mutating server actions.
 *
 * Prereqs (CI does this; locally the run-ofbo stack + `pnpm dev` provide it):
 *   - Postgres applied + seeded (DATABASE_URL)
 *   - BFF on :8787 and Nebras sim on :8788
 *   - portal on :3000 (reused if already running)
 */
const PORTAL_URL = process.env.PORTAL_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Generous timeouts: in dev, a server action's first hit compiles the route AND
  // round-trips the BFF (+ P6→Nebras for revoke), which can take 10–15s. A production
  // `next start` build (CI) is far faster, but the suite must be robust either way.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PORTAL_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Manage the portal only; the BFF + sim are started outside Playwright (CI shell
  // step / local run-ofbo). Reuse a portal already running on :3000 (e.g. `pnpm dev`).
  webServer: {
    command: 'pnpm start',
    url: PORTAL_URL,
    reuseExistingServer: true,
    timeout: 120_000
  }
})
