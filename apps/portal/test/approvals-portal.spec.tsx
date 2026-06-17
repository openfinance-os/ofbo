// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ApprovalCard, ApprovalsPortal } from '../src/components/approvals-portal.js'
import type { ApprovalRequest } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UI-05 — Four-Eyes Approval Portal (presentational). Asserts the dual initiator/approver
 * cards, and that approve/reject are offered only to a non-initiator with the approver
 * scope (permission lockout for the initiator — no self-approval — and for the unscoped).
 */

const pending: ApprovalRequest = {
  approval_request_id: 'ap-1',
  operation_type: 'consents.fraud_revoke',
  state: 'pending',
  initiator: 'demo:risk',
  approver_required_scope: 'risk:read',
  approver: null,
  expires_at: '2026-06-17T12:00:00Z',
  reject_reason: null
}

const noop = () => {}

describe('ApprovalCard', () => {
  it('renders dual initiator/approver cards', () => {
    render(<ApprovalCard approval={pending} subject="demo:risk2" scopes={['risk:read']} approveAction={noop} rejectAction={noop} />)
    expect(screen.getByTestId('initiator-card')).toHaveTextContent('demo:risk')
    expect(screen.getByTestId('approver-card')).toHaveTextContent('risk:read')
  })

  it('offers approve + reject to a non-initiator with the approver scope', () => {
    render(<ApprovalCard approval={pending} subject="demo:risk2" scopes={['risk:read']} approveAction={noop} rejectAction={noop} />)
    expect(screen.getByTestId('approve-form-ap-1')).toBeInTheDocument()
    expect(screen.getByTestId('reject-form-ap-1')).toBeInTheDocument()
    expect(screen.queryByTestId('lockout-ap-1')).not.toBeInTheDocument()
  })

  it('locks the initiator out of approving their own request (four-eyes)', () => {
    render(<ApprovalCard approval={pending} subject="demo:risk" scopes={['risk:read']} approveAction={noop} rejectAction={noop} />)
    expect(screen.queryByTestId('approve-form-ap-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('lockout-ap-1')).toHaveTextContent('You initiated this request')
  })

  it('locks out a principal lacking the approver scope', () => {
    render(<ApprovalCard approval={pending} subject="demo:other" scopes={['billing:read']} approveAction={noop} rejectAction={noop} />)
    expect(screen.queryByTestId('approve-form-ap-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('lockout-ap-1')).toHaveTextContent('requires the risk:read scope')
  })
})

describe('ApprovalsPortal', () => {
  it('lists pending approvals with the count and renders the queue', () => {
    render(<ApprovalsPortal approvals={[pending]} subject="demo:risk2" scopes={['risk:read']} approveAction={noop} rejectAction={noop} />)
    expect(screen.getByTestId('approval-ap-1')).toBeInTheDocument()
    expect(screen.getByTestId('approve-form-ap-1')).toBeInTheDocument()
  })

  it('shows the empty state and the action banners', () => {
    const { rerender } = render(<ApprovalsPortal approvals={[]} subject="demo:x" scopes={[]} notice="Approved — the gated operation was executed by the BFF." />)
    expect(screen.getByTestId('approvals-empty')).toBeInTheDocument()
    expect(screen.getByTestId('approvals-notice')).toHaveTextContent('executed by the BFF')
    rerender(<ApprovalsPortal approvals={[]} subject="demo:x" scopes={[]} error="Could not approve." />)
    expect(screen.getByTestId('approvals-error')).toHaveTextContent('Could not approve.')
  })
})
