// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ErrorBanner } from '../src/components/ui/feedback.js'
import { searchConsents, CareApiError } from '../src/lib/care.js'

afterEach(cleanup)

/**
 * UX-06 (part 1) — the API error envelope's remediation + docs_url are now parsed and surfaced
 * instead of dropped. Covers the envelope parsing (lib) and the ErrorBanner rendering (UI).
 */
describe('ErrorBanner remediation/docs_url', () => {
  it('renders the remediation line and the docs link when provided', () => {
    render(
      <ErrorBanner testid="e" remediation="Re-check the identifier and retry." docsUrl="https://docs.example/err">
        Search failed.
      </ErrorBanner>
    )
    expect(screen.getByTestId('e')).toHaveTextContent('Search failed.')
    expect(screen.getByTestId('e-remediation')).toHaveTextContent('Re-check the identifier and retry.')
    expect(screen.getByTestId('e-docs')).toHaveAttribute('href', 'https://docs.example/err')
  })

  it('refuses a non-http(s) docs_url (defence-in-depth against a stray javascript: value)', () => {
    render(
      <ErrorBanner testid="e" docsUrl="javascript:alert(1)">
        Search failed.
      </ErrorBanner>
    )
    expect(screen.queryByTestId('e-docs')).not.toBeInTheDocument()
  })

  it('omits remediation/docs nodes when not provided (message-only callers unaffected)', () => {
    render(<ErrorBanner testid="e">Plain error.</ErrorBanner>)
    expect(screen.getByTestId('e')).toHaveTextContent('Plain error.')
    expect(screen.queryByTestId('e-remediation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('e-docs')).not.toBeInTheDocument()
  })
})

describe('envelope parses remediation + docs_url into the typed error', () => {
  it('populates CareApiError.remediation and .docsUrl from the error envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'BACKOFFICE.CONSENT_NOT_FOUND',
            message: 'No consents for that identifier.',
            remediation: 'Confirm the customer id and retry.',
            docs_url: 'https://docs.ofbo/consents'
          }
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    )
    await expect(
      searchConsents('tok', 'bank_customer_id', 'cust-1', { baseUrl: 'http://bff', fetchImpl })
    ).rejects.toMatchObject({
      code: 'BACKOFFICE.CONSENT_NOT_FOUND',
      remediation: 'Confirm the customer id and retry.',
      docsUrl: 'https://docs.ofbo/consents'
    })
    await expect(
      searchConsents('tok', 'bank_customer_id', 'cust-1', { baseUrl: 'http://bff', fetchImpl })
    ).rejects.toBeInstanceOf(CareApiError)
  })
})
