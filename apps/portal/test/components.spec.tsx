// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'

afterEach(cleanup)
import { DemoPill } from '../src/components/demo-banner.js'
import { PersonaLoginList } from '../src/components/persona-login-list.js'
import { ScopeEcho } from '../src/components/scope-echo.js'
import { AuditPanel } from '../src/components/audit-panel.js'

describe('DemoPill (persistent non-prod marker)', () => {
  it('renders a subtle DEMO pill that still announces the full synthetic-data statement', () => {
    render(<DemoPill />)
    const banner = screen.getByTestId('demo-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent(/DEMO/) // short visible label
    // the full regulatory statement is announced via aria-label (the hard-stop "must say so")
    expect(banner.getAttribute('aria-label') ?? '').toMatch(/synthetic data only.*no real PSU data/i)
  })
})

describe('PersonaLoginList', () => {
  const personas = [
    { persona: 'risk-analyst', display_name: 'OF Risk Analyst', demo_token: 'demo-token:risk-analyst' },
    { persona: 'compliance-officer', display_name: 'OF Compliance Officer', demo_token: 'demo-token:compliance-officer' }
  ]

  it('shows an MFA-enforced sign-in per persona, posting its token to /api/login', () => {
    render(<PersonaLoginList personas={personas} />)
    expect(screen.getByTestId('mfa-note')).toHaveTextContent(/MFA is enforced/i)
    const risk = screen.getByTestId('login-risk-analyst')
    expect(risk).toHaveTextContent('OF Risk Analyst')
    const form = risk.closest('form')!
    expect(form).toHaveAttribute('action', '/api/login')
    expect(form).toHaveAttribute('method', 'post')
    const hidden = form.querySelector('input[name="token"]') as HTMLInputElement
    expect(hidden.value).toBe('demo-token:risk-analyst')
  })

  /**
   * BACKOFFICE-84 — re-pointed from the raw enum to the sentence an operator reads.
   *
   * This asserted that `mfa_not_satisfied` appeared verbatim in the alert, which is exactly the
   * rendering the story replaces: unreadable at best, and for the infrastructure case actively
   * misleading, because a database outage printed "invalid_token" and sent people to check a token
   * that was fine. The requirement — a failed sign-in must SAY SO on the screen — is unchanged and
   * still asserted; what moved is that the message now has to be usable.
   */
  it('surfaces a readable sign-in error when present', () => {
    render(<PersonaLoginList personas={personas} error="mfa_not_satisfied" />)
    expect(screen.getByTestId('signin-error')).toHaveTextContent(/multi-factor authentication/i)
  })

  it('distinguishes a service failure from a rejected credential', () => {
    // The two need different actions — retry, versus pick a different role — so they must not read
    // the same. This is the pairing the old single-reason handler could not express at all.
    const { rerender } = render(<PersonaLoginList personas={personas} error="service_unavailable" />)
    const service = screen.getByTestId('signin-error').textContent ?? ''
    expect(service).toMatch(/temporarily unavailable/i)
    expect(service).toMatch(/no session was created/i)

    rerender(<PersonaLoginList personas={personas} error="invalid_token" />)
    expect(screen.getByTestId('signin-error').textContent).not.toBe(service)
  })

  it('still shows an unrecognised reason rather than a blank alert', () => {
    render(<PersonaLoginList personas={personas} error="some_new_reason" />)
    expect(screen.getByTestId('signin-error')).toHaveTextContent('some_new_reason')
  })

  it('UX: shows the welcome explainer + enriches each role card with its purpose and reachable modules', () => {
    render(<PersonaLoginList personas={personas} />)
    const hero = screen.getByTestId('welcome-hero')
    expect(hero).toHaveTextContent(/Open Finance Back Office/i)
    expect(hero).toHaveTextContent(/what it does/i)
    const risk = screen.getByTestId('login-risk-analyst')
    expect(risk).toHaveTextContent(/Anomaly detection/i) // role purpose (PERSONA_GUIDE tagline)
    expect(within(risk).getByText('Risk')).toBeInTheDocument() // reachable-module chip
  })

  it('has no axe violations', async () => {
    const results = await axe(render(<PersonaLoginList personas={personas} />).container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    })
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
})

describe('ScopeEcho', () => {
  it('echoes the authenticated principal and its minted scopes', () => {
    render(
      <ScopeEcho
        principal={{
          subject: 'demo:risk-analyst',
          persona: 'risk-analyst',
          scopes: ['risk:read', 'consents:admin:fraud-revoke'],
          superadmin: false
        }}
      />
    )
    expect(screen.getByTestId('echo-subject')).toHaveTextContent('demo:risk-analyst')
    expect(screen.getByTestId('echo-persona')).toHaveTextContent('risk-analyst')
    expect(screen.getByTestId('echo-superadmin')).toHaveTextContent('no')
    const scopes = within(screen.getByTestId('echo-scopes')).getAllByRole('listitem')
    expect(scopes.map((s) => s.textContent)).toEqual(['risk:read', 'consents:admin:fraud-revoke'])
  })

  it('marks the super-admin session', () => {
    render(
      <ScopeEcho
        principal={{ subject: 'demo:platform-super-admin', persona: 'platform-super-admin', scopes: ['platform:superadmin'], superadmin: true }}
      />
    )
    expect(screen.getByTestId('echo-superadmin')).toHaveTextContent('yes')
  })
})

describe('AuditPanel', () => {
  it('renders the empty state when no events are visible', () => {
    render(<AuditPanel events={[]} />)
    expect(screen.getByTestId('audit-empty')).toBeInTheDocument()
  })

  it('renders a row per High-class audit event', () => {
    render(
      <AuditPanel
        events={[
          {
            id: 'e1',
            event_type: 'signin_success',
            acting_principal: 'demo:risk-analyst',
            acting_persona: 'risk-analyst',
            scope_used: 'none',
            request_trace_id: 'trace-abc',
            response_status: 200,
            superadmin_marker: false,
            created_at: '2026-06-14T00:00:00.000Z'
          }
        ]}
      />
    )
    const rows = screen.getAllByTestId('audit-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('signin_success')
    expect(rows[0]).toHaveTextContent('trace-abc')
  })
})
