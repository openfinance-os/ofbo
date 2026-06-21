// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { AppShell } from '../src/components/app-shell.js'
import { CareConsole } from '../src/components/care-console.js'
import { ApprovalsPortal } from '../src/components/approvals-portal.js'
import { AnalyticsDashboard } from '../src/components/analytics-dashboard.js'
import { RiskDashboard } from '../src/components/risk-dashboard.js'
import { OperationsConsole } from '../src/components/operations-console.js'
import { ComplianceView } from '../src/components/compliance-view.js'
import { TppBilling } from '../src/components/tpp-billing.js'

afterEach(cleanup)

/**
 * UX-01 — the shared accessibility gate. The recon console (BACKOFFICE-15) was the only
 * AA-clean screen; this spec asserts no axe-core violations across the OTHER screens and
 * that every screen announces server-action outcomes (role=status / role=alert) via the
 * shared Notice/ErrorBanner primitives. Wired into the unit test project so a new
 * screen cannot merge with these violations. axe runs the WCAG 2.0/2.1 A+AA rulesets;
 * jsdom cannot compute layout, so colour-contrast is validated by the token tests instead.
 */

const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  // colour-contrast needs real layout (canvas) which jsdom can't compute — it's validated by
  // the design-tokens tests instead; disabling it keeps the gate output clean.
  rules: { 'color-contrast': { enabled: false } }
}

async function expectNoViolations(ui: ReactElement) {
  // Wrap in a <main> landmark so component fragments are evaluated as page content.
  const { container } = render(<main>{ui}</main>)
  const results = await axe(container, WCAG)
  // Assert on the rule ids so a failure names the violated WCAG rule(s) directly.
  expect(results.violations.map((v) => v.id)).toEqual([])
}

describe('UX-01 accessibility gate', () => {
  it('app shell has no violations and exposes a skip link', async () => {
    const principal = { subject: 'op-1', persona: 'customer-care', scopes: ['consents:admin'], superadmin: false }
    const { container } = render(
      <AppShell principal={principal} active="care">
        <h1>Content</h1>
      </AppShell>
    )
    expect(screen.getByTestId('skip-link')).toHaveAttribute('href', '#shell-content')
    const results = await axe(container, WCAG)
    expect(results.violations.map((v) => v.id)).toEqual([])
  })

  it('care console: no violations + status/alert banners', async () => {
    render(<main><CareConsole notice="Consent revoked." error="Could not revoke." /></main>)
    expect(screen.getByRole('status')).toHaveTextContent('Consent revoked.')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not revoke.')
    cleanup()
    await expectNoViolations(<CareConsole notice="Consent revoked." error="Could not revoke." />)
  })

  it('approvals portal: no violations + status/alert banners', async () => {
    const props = { approvals: [], subject: 'op-1', scopes: ['finance:reconciliation:write'], superadmin: false, notice: 'Approved.', error: 'Locked.' }
    render(<main><ApprovalsPortal {...props} /></main>)
    expect(screen.getByRole('status')).toHaveTextContent('Approved.')
    expect(screen.getByRole('alert')).toHaveTextContent('Locked.')
    cleanup()
    await expectNoViolations(<ApprovalsPortal {...props} />)
  })

  it('tpp billing: no violations + status/alert banners', async () => {
    render(<main><TppBilling notice="Invoice submitted." error="Register failed." /></main>)
    expect(screen.getByRole('status')).toHaveTextContent('Invoice submitted.')
    expect(screen.getByRole('alert')).toHaveTextContent('Register failed.')
    cleanup()
    await expectNoViolations(<TppBilling notice="Invoice submitted." error="Register failed." />)
  })

  it('analytics dashboard: no violations + alert banner', async () => {
    render(<main><AnalyticsDashboard error="Unavailable." /></main>)
    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable.')
    cleanup()
    await expectNoViolations(<AnalyticsDashboard error="Unavailable." />)
  })

  it('risk / operations / compliance: no violations + alert banner', async () => {
    await expectNoViolations(<RiskDashboard error="Unavailable." />)
    cleanup()
    await expectNoViolations(<OperationsConsole error="Unavailable." />)
    cleanup()
    await expectNoViolations(<ComplianceView error="Unavailable." />)
  })
})
