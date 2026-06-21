// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AuditLog } from '../src/components/audit-log.js'
import type { AuditLogEvent } from '../src/lib/audit-log.js'

afterEach(cleanup)

/**
 * DEMO-01 — global audit log (presentational). Asserts it renders cross-operator rows with
 * the acting principal + PSU, exposes the event-type filter, and handles empty/error states.
 */

const events: AuditLogEvent[] = [
  {
    id: 'e1',
    event_type: 'consent_revoked',
    acting_principal: 'demo:customer-care-agent',
    acting_persona: 'customer-care-agent',
    scope_used: 'consents:admin',
    target_psu_identifier: 'cust-0001',
    target_consent_id: 'd5ec7542-b298-4d27-9327-d299fc43e4cf',
    request_trace_id: 't-1',
    response_status: 200,
    created_at: '2026-06-21T15:00:00Z'
  }
]

const noFilter = { event_type: '', acting_principal: '' }

describe('AuditLog', () => {
  it('renders cross-operator rows with the acting principal and PSU', () => {
    render(<AuditLog events={events} filters={noFilter} error={null} />)
    const row = screen.getByTestId('audit-log-row')
    expect(row).toHaveAttribute('data-event-type', 'consent_revoked')
    expect(row).toHaveTextContent('demo:customer-care-agent')
    expect(row).toHaveTextContent('cust-0001')
    expect(row).toHaveTextContent('consents:admin')
  })

  it('exposes an event-type filter pre-set to the active filter', () => {
    render(<AuditLog events={events} filters={{ event_type: 'consent_revoked', acting_principal: '' }} error={null} />)
    const select = screen.getByTestId('audit-filter-event-type') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('consent_revoked')
  })

  it('shows an empty state when nothing matches', () => {
    render(<AuditLog events={[]} filters={noFilter} error={null} />)
    expect(screen.getByTestId('audit-log-empty')).toBeInTheDocument()
  })

  it('shows an error banner instead of the table on failure', () => {
    render(<AuditLog events={[]} filters={noFilter} error={'The Audit Log is temporarily unavailable.'} />)
    expect(screen.getByTestId('audit-log-error')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-log-table')).not.toBeInTheDocument()
  })
})
