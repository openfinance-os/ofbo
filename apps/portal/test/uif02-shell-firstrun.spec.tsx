// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { PersonaLoginList } from '../src/components/persona-login-list.js'
import { AppShell } from '../src/components/app-shell.js'

afterEach(cleanup)

/**
 * UIF-02 — sign-in + shell first impression (ADR 0016 / UI-FIDELITY). The bare top-left
 * sign-in and the edge-to-edge, footer-less shell read as an unstyled prototype. This asserts
 * the brand wordmark on the sign-in card, a status footer, and a constrained content width.
 * Token-only; colour-contrast is validated by the token tests (jsdom can't compute layout).
 */

const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(ui)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

const personas = [
  { persona: 'operations-analyst', display_name: 'OF Operations Analyst', demo_token: 'demo-token:operations-analyst' },
  { persona: 'customer-care-agent', display_name: 'Customer Care Agent (OF)', demo_token: 'demo-token:customer-care-agent' }
]

describe('UIF-02 — sign-in first impression', () => {
  it('leads with the OFBO brand wordmark + product name', () => {
    render(<PersonaLoginList personas={personas} />)
    const brand = screen.getByTestId('signin-brand')
    expect(brand).toHaveTextContent('OFBO')
    expect(brand).toHaveTextContent(/Open Finance Back Office/i)
  })

  it('preserves the accessible region, heading, and one sign-in button per persona', () => {
    render(<PersonaLoginList personas={personas} />)
    expect(screen.getByRole('region', { name: 'persona sign-in' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('login-operations-analyst')).toBeInTheDocument()
    expect(screen.getByTestId('login-customer-care-agent')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<PersonaLoginList personas={personas} />)
  })
})

const principal = { subject: 'demo:fin', persona: 'finance-analyst', scopes: ['reconciliation:read'], superadmin: false }

describe('UIF-02 — shell first impression', () => {
  it('renders a status footer naming the demo profile + synthetic-data posture', () => {
    render(
      <AppShell principal={principal}>
        <p>x</p>
      </AppShell>
    )
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveAttribute('data-testid', 'shell-footer')
    expect(footer).toHaveTextContent(/demo/i)
    expect(footer).toHaveTextContent(/synthetic/i)
  })

  it('constrains the content with a max-width inner container', () => {
    render(
      <AppShell principal={principal}>
        <p>body</p>
      </AppShell>
    )
    const inner = screen.getByTestId('shell-content-inner')
    expect(inner).toHaveTextContent('body')
    expect(inner.className).toMatch(/max-w-/)
  })
})
