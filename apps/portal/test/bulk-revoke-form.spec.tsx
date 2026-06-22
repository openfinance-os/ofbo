// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'

import { BulkRevokeForm } from '../src/components/care/bulk-revoke-form.js'
import type { CareWriteResult } from '../src/lib/care.js'

afterEach(cleanup)

/**
 * UIF-09b(a) / BACKOFFICE-18 — the emergency PSU-wide bulk-revoke control on the care
 * console. Four-eyes (202 + approval); a second consents-admin approver completes it.
 */
const WCAG = { runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
const noop = async (): Promise<CareWriteResult> => ({ ok: true })

describe('BulkRevokeForm', () => {
  it('renders the emergency bulk-revoke trigger + the four-eyes Approvals affordance, carrying the PSU context as hidden inputs', () => {
    render(<BulkRevokeForm psu="CUST-1" identifierType="bank_customer_id" consentCount={4} action={noop} />)
    const form = screen.getByTestId('bulk-revoke-form')
    expect(within(form).getByTestId('bulk-revoke-submit')).toBeInTheDocument()
    // four-eyes is explicit + links to the Approvals queue (never inline)
    expect(within(form).getByText(/four-eyes/i)).toBeInTheDocument()
    expect(within(form).getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/approvals')
    // PSU context travels server-side via hidden inputs (no PSU identifier typed into the browser here)
    expect(form.querySelector('input[name="identifier"]')).toHaveValue('CUST-1')
    expect(form.querySelector('input[name="identifier_type"]')).toHaveValue('bank_customer_id')
  })

  it('has no axe violations', async () => {
    const results = await axe(render(<BulkRevokeForm psu="CUST-1" identifierType="bank_customer_id" consentCount={4} action={noop} />).container, WCAG)
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
})
