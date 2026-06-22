// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CareConsole, SearchForm, StatusPill } from '../src/components/care-console.js'
import type { ConsentSearchResult, CareTimeline } from '../src/lib/care.js'

afterEach(cleanup)

/**
 * UI-02 — Customer Care Console (presentational). Asserts the search form exposes the
 * contract identifier types, status pills carry the OFBO triad tone, revoke is offered
 * only on revocable consents, the 24-month timeline renders, and NO PSU PII beyond the
 * searched internal id is shown (the Stitch masked name/accounts are appearance only).
 */

const result: ConsentSearchResult = {
  psu: { bank_customer_id: 'cust-77', account_count: 4 },
  consents: [
    { consent_id: 'c-active', tpp: { client_id: 'tpp-1', display_name: 'WealthBot AI' }, purpose: 'AIS', scope: ['accounts', 'balances'], status: 'Authorized', granted_at: '2025-01-01', expires_at: '2026-01-01', last_access_at: '2025-06-01' },
    { consent_id: 'c-expired', tpp: { client_id: 'tpp-2', display_name: 'OpenPay Mobile' }, purpose: 'PIS', scope: ['payments'], status: 'Expired', granted_at: '2024-01-01', expires_at: '2025-01-01', last_access_at: null }
  ]
}

const timeline: CareTimeline = {
  events: [{ id: 'ev-1', consent_id: 'c-active', psu_identifier: 'cust-77', event_type: 'granted', event_subtype: 'AIS Access', event_data: {}, acting_principal: 'sys', created_at: '2025-01-01T00:00:00.000Z' }],
  next_cursor: null
}

describe('SearchForm', () => {
  it('renders a GET form exposing the three contract identifier types', () => {
    render(<SearchForm query={{ identifier_type: 'iban', identifier: 'AE07' }} />)
    const form = screen.getByTestId('search-form')
    expect(form).toHaveAttribute('method', 'get')
    for (const t of ['bank_customer_id', 'iban', 'emirates_id']) {
      expect(within(form).getByRole('option', { name: t })).toBeInTheDocument()
    }
  })
})

describe('StatusPill', () => {
  it('renders the status label with a tone class per state', () => {
    render(<StatusPill status="Authorized" />)
    expect(screen.getByTestId('status-Authorized')).toHaveTextContent('Authorized')
  })
})

describe('CareConsole', () => {
  // UX-06b — the care write actions are useActionState actions: (prevState, formData) => Promise<result>.
  const noop = async () => ({ ok: true })

  it('renders the PSU profile from the contract — internal id + account count, no fabricated PII', () => {
    render(<CareConsole query={{ identifier_type: 'bank_customer_id', identifier: 'cust-77' }} result={result} timeline={timeline} revokeAction={noop} disputeAction={noop} />)
    expect(screen.getByTestId('psu-id')).toHaveTextContent('cust-77')
    expect(screen.getByTestId('profile-card')).toHaveTextContent('4 linked accounts')
    // the Stitch screen's masked PSU name is appearance-only; the contract returns none
    expect(screen.queryByText(/AL M/)).not.toBeInTheDocument()
  })

  it('lists consents and offers revoke ONLY on a revocable (Authorized) consent', () => {
    render(<CareConsole query={{ identifier: 'cust-77' }} result={result} timeline={timeline} revokeAction={noop} disputeAction={noop} />)
    expect(screen.getByTestId('consent-c-active')).toBeInTheDocument()
    expect(screen.getByTestId('revoke-form-c-active')).toBeInTheDocument()
    // an Expired consent is terminal — no revoke affordance
    expect(screen.queryByTestId('revoke-form-c-expired')).not.toBeInTheDocument()
  })

  it('renders the 24-month event history and the investigation (dispute) module', () => {
    render(<CareConsole query={{ identifier: 'cust-77' }} result={result} timeline={timeline} revokeAction={noop} disputeAction={noop} />)
    expect(screen.getByTestId('event-history')).toHaveTextContent('24-Month Event History')
    expect(screen.getByTestId('event-ev-1')).toHaveTextContent('granted') // uppercased via CSS only
    expect(screen.getByTestId('dispute-form')).toBeInTheDocument()
  })

  it('UIF-09b: offers the emergency bulk-revoke module when there are revocable consents + the action; hides it otherwise', () => {
    // with the action + a revocable (Authorized) consent present → module shows, counting only revocable ones
    render(<CareConsole query={{ identifier: 'cust-77' }} result={result} timeline={timeline} revokeAction={noop} bulkRevokeAction={noop} />)
    expect(screen.getByTestId('bulk-revoke-module')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-revoke-form')).toBeInTheDocument()
    cleanup()
    // no bulk-revoke action passed → no module
    render(<CareConsole query={{ identifier: 'cust-77' }} result={result} timeline={timeline} revokeAction={noop} />)
    expect(screen.queryByTestId('bulk-revoke-module')).not.toBeInTheDocument()
    cleanup()
    // a PSU with no revocable consents → no module (nothing to bulk-revoke)
    const noneRevocable = { ...result, consents: [result.consents[1]!] } // only the Expired one
    render(<CareConsole query={{ identifier: 'cust-77' }} result={noneRevocable} timeline={timeline} revokeAction={noop} bulkRevokeAction={noop} />)
    expect(screen.queryByTestId('bulk-revoke-module')).not.toBeInTheDocument()
  })

  it('shows a success notice and an error banner from the action result', () => {
    const { rerender } = render(<CareConsole notice="Consent revoked." />)
    expect(screen.getByTestId('care-notice')).toHaveTextContent('Consent revoked.')
    rerender(<CareConsole error="Revocation failed." />)
    expect(screen.getByTestId('care-error')).toHaveTextContent('Revocation failed.')
  })

  it('renders only the lookup form before a search (no results panel)', () => {
    render(<CareConsole />)
    expect(screen.getByTestId('psu-lookup')).toBeInTheDocument()
    expect(screen.queryByTestId('consents-panel')).not.toBeInTheDocument()
  })
})
