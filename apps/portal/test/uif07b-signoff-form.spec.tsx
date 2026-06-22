// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'

import { SignoffForm } from '../src/components/reconciliation/signoff-form.js'
import type { ReconWriteResult } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * UIF-07b(c) / BACKOFFICE-06 — the four-eyes monthly sign-off control on the recon console.
 * Requests the sign-off (202); a different finance approver completes it in /approvals.
 */
const WCAG = { runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
const noop = async (): Promise<ReconWriteResult> => ({ ok: true })

describe('SignoffForm', () => {
  it('renders the period (defaulted), the request button, and the four-eyes Approvals affordance', () => {
    render(<SignoffForm defaultPeriod="2026-06" action={noop} />)
    const form = screen.getByTestId('signoff-form')
    expect(within(form).getByRole('textbox', { name: /period/i })).toHaveValue('2026-06')
    expect(within(form).getByRole('button', { name: /request monthly sign-off/i })).toBeInTheDocument()
    // four-eyes is explicit + links to the Approvals queue (never inline)
    expect(within(form).getByText(/four-eyes/i)).toBeInTheDocument()
    expect(within(form).getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/approvals')
  })

  it('has no axe violations', async () => {
    const results = await axe(render(<SignoffForm defaultPeriod="2026-06" action={noop} />).container, WCAG)
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
})
