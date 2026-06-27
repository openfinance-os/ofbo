// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ReadinessWizard } from '../src/components/readiness/readiness-wizard.js'
import type { ReadinessCatalog, ReadinessDigest } from '../src/lib/readiness.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const catalog: ReadinessCatalog = {
  ports: [
    { id: 'P2', name: 'Enterprise IdP', maps_to: 'Sign-in + MFA', options: [{ value: 'okta', label: 'Okta', effort_band: 'low' }] },
    { id: 'P6', name: 'Egress gateway', maps_to: 'Nebras traffic', options: [{ value: 'kong', label: 'Kong', effort_band: 'medium' }] }
  ],
  decisions: [{ id: 'BD-01', title: 'IdP', default: 'OIDC provider', impact: 'sign-in', blocks: 'M1' }]
}

const digest: ReadinessDigest = {
  score: 84,
  verdict: 'Achievable; a few ports need scoping.',
  ports: [
    { id: 'P2', name: 'Enterprise IdP', chosen_system: 'Okta', adapter_status: 'enterprise_reference', contract_test_gate: 'gate', effort_band: 'low', config_keys: ['P2_OIDC_ISSUER'] }
  ],
  governance: [{ id: 'BD-01', title: 'IdP', answer: 'OIDC provider', is_default: true, blocker: 'M1' }],
  generated_profile: { DEPLOY_PROFILE: 'enterprise', P2_SYSTEM: 'Okta' },
  already_done: { sim_adapters_ready: 9, ports_total: 9, note: 'bounded work' },
  sequencing: [{ step: 1, port: 'P2', system: 'Okta', action: 'Write the IdP adapter.' }]
}

describe('ReadinessWizard', () => {
  it('walks hero → estate → governance → digest, calling the assess proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(digest), { status: 200, headers: { 'content-type': 'application/json' } })
    )

    render(<ReadinessWizard catalog={catalog} />)

    // Hero
    fireEvent.click(screen.getByTestId('readiness-start'))
    // Estate — map a port
    fireEvent.change(screen.getByTestId('port-select-P2'), { target: { value: 'okta' } })
    fireEvent.click(screen.getByTestId('estate-next'))
    // Governance — run assessment
    fireEvent.click(screen.getByTestId('run-assessment'))

    expect(await screen.findByTestId('readiness-digest')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-score')).toHaveTextContent('84')
    expect(screen.getByTestId('generated-profile')).toHaveTextContent('DEPLOY_PROFILE = enterprise')

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('/api/readiness/assess')
    expect(JSON.parse(String((init as RequestInit).body)).ports.P2).toBe('okta')
  })

  it('renders straight to the digest when reopened from a saved profile', () => {
    render(
      <ReadinessWizard
        catalog={catalog}
        initialProfile={{ slug: 'rdy-1', name: 'Bank A', created_at: '2026-06-25T00:00:00Z', input: { ports: { P2: 'okta' } }, digest }}
      />
    )
    expect(screen.getByTestId('readiness-digest')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-score')).toHaveTextContent('84')
  })

  it('shows an enterprise_reference port as "reference ships", not "to write"', () => {
    render(
      <ReadinessWizard
        catalog={catalog}
        initialProfile={{ slug: 'rdy-1', name: 'Bank A', created_at: '2026-06-25T00:00:00Z', input: { ports: { P2: 'okta' } }, digest }}
      />
    )
    const row = screen.getByTestId('digest-port-P2')
    expect(row).toHaveTextContent('reference ships')
    expect(row).not.toHaveTextContent('to write')
  })
})
