// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { AgentsRegistry } from '../src/components/agents-registry.js'
import type { AgentRegistration } from '../src/lib/agents.js'

afterEach(cleanup)

/**
 * BACKOFFICE-60 — Agent Registry screen (ADR 0017). Lists DCR-registered automation agents;
 * register is four-eyes, revoke is single-actor. Token-only, OpenAPI-bound, no PSU PII.
 */
const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(ui)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

const agent = (overrides: Partial<AgentRegistration> = {}): AgentRegistration => ({
  agent_id: '11111111-1111-4111-8111-111111111111',
  client_id: 'agent-abc',
  display_name: 'Reconciliation read-only bot',
  persona: 'reconciliation-readonly-agent',
  derived_from: 'finance-analyst',
  scopes: ['reconciliation:read', 'billing:read'],
  status: 'active',
  allow_mutations: false,
  spend_budget: 0,
  registered_by: 'demo:platform-admin',
  approved_by: 'demo:platform-super-admin',
  created_at: '2026-06-24T00:00:00.000Z',
  revoked_at: null,
  revoke_reason: null,
  ...overrides
})

const noop = async () => {}

describe('AgentsRegistry', () => {
  it('lists agents with persona subset, scopes, read-only label, and a status badge', () => {
    render(<AgentsRegistry agents={[agent()]} />)
    const row = screen.getByTestId('agent-row-11111111-1111-4111-8111-111111111111')
    expect(within(row).getByText('Reconciliation read-only bot')).toBeInTheDocument()
    expect(within(row).getByText('reconciliation-readonly-agent')).toBeInTheDocument()
    expect(within(row).getByText(/⊂ finance-analyst/)).toBeInTheDocument()
    expect(within(row).getByText('reconciliation:read')).toBeInTheDocument()
    expect(within(row).getByText('read-only')).toBeInTheDocument()
    expect(within(row).getByTestId('status-active')).toBeInTheDocument()
  })

  it('hides the register form and the actions column without write scope', () => {
    render(<AgentsRegistry agents={[agent()]} canWrite={false} />)
    expect(screen.queryByTestId('register-agent-form')).not.toBeInTheDocument()
    expect(screen.queryByText('Actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('revoke-form-11111111-1111-4111-8111-111111111111')).not.toBeInTheDocument()
  })

  it('with write scope, shows the four-eyes register form (persona picker + display name) and a revoke control', () => {
    render(<AgentsRegistry agents={[agent()]} canWrite registerAction={noop} revokeAction={noop} />)
    const form = screen.getByTestId('register-agent-form')
    expect(within(form).getByTestId('register-persona')).toHaveAttribute('name', 'persona')
    expect(within(form).getByRole('option', { name: 'Customer Care (read-only)' })).toBeInTheDocument()
    expect(within(form).getByTestId('register-display-name')).toHaveAttribute('minLength', '3')
    expect(screen.getByText(/approves before the credential is issued/i)).toBeInTheDocument()
    // revoke is single-actor: a reason input (min 10) + a confirm control
    const revoke = screen.getByTestId('revoke-form-11111111-1111-4111-8111-111111111111')
    expect(within(revoke).getByTestId('revoke-reason-11111111-1111-4111-8111-111111111111')).toHaveAttribute('minLength', '10')
    expect(within(revoke).getByTestId('revoke-11111111-1111-4111-8111-111111111111')).toBeInTheDocument()
  })

  it('shows the revoke reason (not a revoke control) for an already-revoked agent', () => {
    render(<AgentsRegistry agents={[agent({ status: 'revoked', revoke_reason: 'rotating the credential' })]} canWrite registerAction={noop} revokeAction={noop} />)
    expect(screen.getByText(/revoked: rotating the credential/)).toBeInTheDocument()
    expect(screen.queryByTestId('revoke-form-11111111-1111-4111-8111-111111111111')).not.toBeInTheDocument()
  })

  it('renders an empty state when there are no agents', () => {
    render(<AgentsRegistry agents={[]} />)
    expect(screen.getByTestId('agents-empty')).toBeInTheDocument()
  })

  it('surfaces a four-eyes notice and an error banner', () => {
    render(<AgentsRegistry agents={[]} notice={<>submitted to four-eyes</>} error="Boom" errorRemediation="Retry" />)
    expect(screen.getByTestId('agents-notice')).toHaveTextContent('submitted to four-eyes')
    expect(screen.getByTestId('agents-error')).toHaveTextContent('Boom')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<AgentsRegistry agents={[agent(), agent({ agent_id: '22222222-2222-4222-8222-222222222222', status: 'revoked', revoke_reason: 'done here' })]} canWrite registerAction={noop} revokeAction={noop} />)
  })
})
