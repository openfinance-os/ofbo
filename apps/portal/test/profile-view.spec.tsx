// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'

import { ProfileView } from '../src/components/profile-view.js'

afterEach(cleanup)

/**
 * Profile — "who you're signed in as and what you can do". The top bar shows a friendly
 * role; the raw scopes/privileges are explained here, in plain language.
 */
const WCAG = { runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
const finance = { subject: 'demo:finance', persona: 'finance-analyst', scopes: ['reconciliation:read', 'finance:reconciliation:write'], superadmin: false }

describe('ProfileView', () => {
  it('shows the friendly role, the modules it can open, and each privilege in plain language', () => {
    render(<ProfileView principal={finance} />)
    expect(screen.getByTestId('profile-role')).toHaveTextContent('Finance Analyst')
    // modules the scope-gated nav lets this persona reach: Finance + Analytics, not Risk/Care
    const modules = screen.getByTestId('profile-modules')
    expect(within(modules).getByText('Finance')).toBeInTheDocument()
    expect(within(modules).getByText('Analytics')).toBeInTheDocument()
    expect(within(modules).queryByText('Risk')).not.toBeInTheDocument()
    // privileges described in human terms, with the raw scope kept subtly alongside
    const priv = screen.getByTestId('profile-privileges')
    expect(priv).toHaveTextContent(/Claim & resolve breaks/i) // finance:reconciliation:write
    expect(priv).toHaveTextContent('finance:reconciliation:write') // raw scope, for transparency
  })

  it('flags a super-administrator role', () => {
    render(<ProfileView principal={{ subject: 'demo:sa', persona: 'platform-super-admin', scopes: ['platform:superadmin'], superadmin: true }} />)
    expect(screen.getByTestId('profile-role')).toHaveTextContent('Platform Super Admin')
    expect(screen.getByTestId('profile-privileges')).toHaveTextContent(/super-administrator/i)
  })

  it('has no axe violations', async () => {
    const results = await axe(render(<ProfileView principal={finance} />).container, WCAG)
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
})
