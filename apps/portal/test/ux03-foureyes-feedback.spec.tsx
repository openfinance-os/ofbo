// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ApprovalCard, formatExpiry } from '../src/components/approvals-portal.js'
import { TppBilling } from '../src/components/tpp-billing.js'
import type { ApprovalRequest } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UX-03 — four-eyes initiator feedback (unblocked frontend parts). Asserts the relative
 * expiry + urgency on approval cards, and that the TPP-billing notice surface renders a
 * rich (linked) initiator notice — the tracking deep-link to /approvals.
 */

const NOW = 1_700_000_000_000
const iso = (deltaMin: number) => new Date(NOW + deltaMin * 60_000).toISOString()

const approval = (expires_at: string): ApprovalRequest => ({
  approval_request_id: 'ar-1',
  operation_type: 'invoice_run',
  state: 'pending',
  initiator: 'op-1',
  approver_required_scope: 'billing:write',
  approver: null,
  expires_at,
  reject_reason: null
})

describe('formatExpiry', () => {
  it('formats hours+minutes remaining, not urgent', () => {
    expect(formatExpiry(iso(105), NOW)).toEqual({ label: 'Expires in 1h 45m', urgent: false, expired: false })
  })
  it('flags the last 30 minutes as urgent', () => {
    expect(formatExpiry(iso(20), NOW)).toEqual({ label: 'Expires in 20m', urgent: true, expired: false })
  })
  it('reports expired', () => {
    expect(formatExpiry(iso(-5), NOW)).toEqual({ label: 'Expired', urgent: true, expired: true })
  })
  it('falls back gracefully on an unparseable timestamp', () => {
    expect(formatExpiry('not-a-date', NOW).urgent).toBe(false)
  })
})

describe('ApprovalCard expiry', () => {
  it('renders relative expiry with urgency styling when expiring soon', () => {
    render(<ApprovalCard approval={approval(iso(15))} subject="other" scopes={[]} now={NOW} />)
    const el = screen.getByTestId('expiry-ar-1')
    expect(el).toHaveTextContent('Expires in 15m · expiring soon')
    expect(el.className).toContain('text-breach')
  })
  it('renders a calm expiry when far from expiry', () => {
    render(<ApprovalCard approval={approval(iso(110))} subject="other" scopes={[]} now={NOW} />)
    const el = screen.getByTestId('expiry-ar-1')
    expect(el).toHaveTextContent('Expires in 1h 50m')
    expect(el.className).toContain('text-on-surface-variant')
  })
})

describe('TppBilling rich notice', () => {
  it('renders a linked (ReactNode) initiator notice', () => {
    render(
      <TppBilling
        notice={
          <>
            Invoice run submitted to four-eyes — request <span>ar-1</span>.{' '}
            <a href="/approvals">Track in the approvals queue →</a>
          </>
        }
      />
    )
    const link = screen.getByRole('link', { name: /track in the approvals queue/i })
    expect(link).toHaveAttribute('href', '/approvals')
    expect(screen.getByRole('status')).toHaveTextContent('ar-1')
  })
})
