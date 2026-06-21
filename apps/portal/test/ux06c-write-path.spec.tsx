// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ResolveForm } from '../src/components/reconciliation/resolve-form.js'
import { RejectForm } from '../src/components/approvals/reject-form.js'
import type { ReconWriteResult } from '../src/lib/reconciliation.js'
import type { ApprovalWriteResult } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UX-06c — recon/approvals write paths return a typed result on failure (no redirect), so the
 * form surfaces the real BFF error in place and keeps the operator's free-text inputs.
 */
describe('ResolveForm (useActionState)', () => {
  it('surfaces the typed error + preserves the chosen outcome and note on failure', async () => {
    const action = async (): Promise<ReconWriteResult> => ({
      ok: false,
      error: 'Break already resolved by another operator.',
      remediation: 'Refresh the queue.',
      values: { resolution_outcome: 'resolved_matched', resolution_note: 'Matched against Nebras ledger line.' }
    })
    render(<ResolveForm breakId="b-1" runId="RUN-1" action={action} />)
    fireEvent.submit(screen.getByTestId('resolve-form-b-1'))

    expect(await screen.findByTestId('resolve-error-b-1')).toHaveTextContent('already resolved')
    expect(screen.getByTestId('resolve-error-b-1-remediation')).toHaveTextContent('Refresh the queue.')
    expect(screen.getByLabelText('resolution outcome')).toHaveValue('resolved_matched')
    expect(screen.getByLabelText('resolution note')).toHaveValue('Matched against Nebras ledger line.')
  })
})

describe('RejectForm (useActionState)', () => {
  it('surfaces the typed error + preserves the reject reason on failure', async () => {
    const action = async (): Promise<ApprovalWriteResult> => ({
      ok: false,
      error: 'Approval already actioned.',
      values: { reject_reason: 'Counterparty not yet KYC-cleared.' }
    })
    render(<RejectForm approvalId="ar-1" action={action} />)
    fireEvent.submit(screen.getByTestId('reject-form-ar-1'))

    expect(await screen.findByTestId('reject-error-ar-1')).toHaveTextContent('already actioned')
    expect(screen.getByLabelText('reject reason')).toHaveValue('Counterparty not yet KYC-cleared.')
  })
})
