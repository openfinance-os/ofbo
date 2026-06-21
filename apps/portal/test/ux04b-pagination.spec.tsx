// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ApprovalsPortal } from '../src/components/approvals-portal.js'
import type { ApprovalRequest } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UX-04b — cursor pagination wired into the approvals queue (and the care timeline, via the
 * shared LoadMore). Asserts the approvals queue surfaces a Next-page link when more exist.
 */
const approval = (id: string): ApprovalRequest => ({
  approval_request_id: id,
  operation_type: 'invoice_run',
  state: 'pending',
  initiator: 'op-1',
  approver_required_scope: 'billing:write',
  approver: null,
  expires_at: '2026-06-21T12:00:00Z',
  reject_reason: null
})

describe('ApprovalsPortal pagination', () => {
  it('renders a Next-page link when more approvals are available', () => {
    render(<ApprovalsPortal approvals={[approval('ar-1')]} subject="op-2" scopes={[]} moreHref="/approvals?cursor=next" />)
    expect(screen.getByTestId('load-more-link')).toHaveAttribute('href', '/approvals?cursor=next')
  })

  it('shows "all loaded" when there is no further page', () => {
    render(<ApprovalsPortal approvals={[approval('ar-1')]} subject="op-2" scopes={[]} moreHref={null} />)
    expect(screen.getByTestId('load-more-status')).toHaveTextContent('all loaded')
    expect(screen.queryByTestId('load-more-link')).not.toBeInTheDocument()
  })
})
