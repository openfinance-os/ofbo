// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { AccessDenied } from '../src/components/ui/access-denied.js'

afterEach(cleanup)

/**
 * UX-07 — explicit scope-denied surface. Out-of-scope deep links used to bounce silently to
 * /dashboard; this names the persona + the missing scope so the denial is legible and
 * auditable. Asserts the labelled region, the persona/scope/module, and the back link.
 */
describe('AccessDenied', () => {
  it('names the persona, the missing scope, and the module', () => {
    render(<AccessDenied persona="finance-ops" moduleName="Customer Care" requiredScope="consents:admin" />)
    expect(screen.getByTestId('denied-persona')).toHaveTextContent('finance-ops')
    expect(screen.getByTestId('denied-scope')).toHaveTextContent('consents:admin')
    expect(screen.getByTestId('denied-module')).toHaveTextContent('Customer Care')
  })

  it('is a labelled region with an Access denied heading and a way back', () => {
    render(<AccessDenied persona="p" moduleName="Risk Management" requiredScope="risk:read" />)
    expect(screen.getByRole('region', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard')
  })
})
