// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ApprovalDetail } from '../src/components/approval-detail.js'
import type { ApprovalRequest } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UI-MOBILE-APPROVALS — the focused single-approval detail (Stitch Mobile Approval Detail).
 * Reuses the queue's expiry/canActOn + the UX-06c approve/reject islands.
 */
const NOW = Date.UTC(2026, 5, 21, 10, 0, 0)
const pending = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  approval_request_id: 'ar-1',
  operation_type: 'invoice_run',
  state: 'pending',
  initiator: 'op-1',
  approver_required_scope: 'billing:write',
  approver: null,
  expires_at: '2026-06-21T11:00:00Z',
  reject_reason: null,
  ...over
})

const noop = async () => ({ ok: true })

describe('ApprovalDetail', () => {
  it('renders the request + a back-to-queue link, and offers approve/reject to an entitled approver', () => {
    render(
      <ApprovalDetail approval={pending()} subject="op-2" scopes={['billing:write']} superadmin approveAction={noop} rejectAction={noop} now={NOW} />
    )
    expect(screen.getByTestId('approval-detail')).toHaveTextContent('invoice_run')
    expect(screen.getByTestId('back-to-queue')).toHaveAttribute('href', '/approvals')
    expect(screen.getByTestId('approval-expiry')).toBeInTheDocument()
    expect(screen.getByTestId('approve-form-ar-1')).toBeInTheDocument()
    expect(screen.getByTestId('reject-form-ar-1')).toBeInTheDocument()
  })

  it('locks out the initiator (four-eyes self) instead of showing the action forms', () => {
    render(
      <ApprovalDetail approval={pending()} subject="op-1" scopes={['billing:write']} approveAction={noop} rejectAction={noop} now={NOW} />
    )
    expect(screen.getByTestId('approval-lockout')).toHaveTextContent('You initiated this request')
    expect(screen.queryByTestId('approve-form-ar-1')).not.toBeInTheDocument()
  })
})
