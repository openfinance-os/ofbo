// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { DisputeForm } from '../src/components/care/dispute-form.js'
import { RevokeForm } from '../src/components/care/revoke-form.js'
import type { CareConsent, CareWriteResult } from '../src/lib/care.js'

afterEach(cleanup)

/**
 * UX-06b — the care write path returns a typed CareWriteResult on failure (no redirect), so the
 * form surfaces the real BFF error + remediation IN PLACE and keeps the operator's inputs.
 */
const consent: CareConsent = {
  consent_id: 'c-1',
  tpp: { client_id: 't-1', display_name: 'Acme PISP' },
  purpose: 'pis',
  scope: ['payments'],
  status: 'Authorized',
  granted_at: '2026-06-01T00:00:00Z',
  expires_at: null,
  last_access_at: null
}

describe('DisputeForm (useActionState)', () => {
  it('renders the typed error + remediation in place and preserves entered values on failure', async () => {
    const action = async (): Promise<CareWriteResult> => ({
      ok: false,
      error: 'The originating payment was not found.',
      remediation: 'Confirm the PIS id and retry.',
      values: { originating_payment_id: 'PIS-9', dispute_type: 'consent_complaint' }
    })
    render(<DisputeForm psu="cust-1" identifierType="bank_customer_id" action={action} />)
    fireEvent.submit(screen.getByTestId('dispute-form'))

    const banner = await screen.findByTestId('dispute-error')
    expect(banner).toHaveTextContent('The originating payment was not found.')
    expect(screen.getByTestId('dispute-error-remediation')).toHaveTextContent('Confirm the PIS id and retry.')
    // inputs re-seeded from the returned values (React 19 resets the form on submit)
    expect(screen.getByLabelText('dispute type')).toHaveValue('consent_complaint')
  })
})

describe('RevokeForm (useActionState)', () => {
  it('renders the typed error in place and preserves the chosen reason on failure', async () => {
    const action = async (): Promise<CareWriteResult> => ({
      ok: false,
      error: 'Consent already revoked.',
      values: { reason_code: 'REGULATORY' }
    })
    render(<RevokeForm consent={consent} psu="cust-1" identifierType="bank_customer_id" action={action} />)
    fireEvent.submit(screen.getByTestId('revoke-form-c-1'))

    const banner = await screen.findByTestId('revoke-error-c-1')
    expect(banner).toHaveTextContent('Consent already revoked.')
    expect(screen.getByLabelText('revoke reason')).toHaveValue('REGULATORY')
  })
})
