import { describe, expect, it } from 'vitest'
import { matchRoute } from '../src/match.js'

const UUID = '4d2c2e2a-0000-4000-8000-000000000000'

describe('route matcher (colon-action safe)', () => {
  it('matches a plain path', () => {
    expect(matchRoute('get', '/back-office/reconciliation/runs')?.path).toBe('/back-office/reconciliation/runs')
  })

  it('matches a parameterised path and extracts the param', () => {
    const m = matchRoute('get', `/back-office/reconciliation/runs/${UUID}`)
    expect(m?.path).toBe('/back-office/reconciliation/runs/{run_id}')
    expect(m?.params.run_id).toBe(UUID)
  })

  it('matches colon-action paths with a leading param', () => {
    const m = matchRoute('post', `/consents/${UUID}:revoke-admin`)
    expect(m?.path).toBe('/consents/{consent_id}:revoke-admin')
    expect(m?.params.consent_id).toBe(UUID)
  })

  it('matches collection-level colon-action paths', () => {
    expect(matchRoute('post', '/consents:revoke-bulk')?.path).toBe('/consents:revoke-bulk')
  })

  it('param never swallows a colon action', () => {
    // bare /consents/{id} GET does not exist; the admin view is /consents/{id}:admin
    expect(matchRoute('get', `/consents/${UUID}`)).toBeNull()
    // wrong action must not match another action's route
    expect(matchRoute('post', `/consents/${UUID}:revoke-fraud`)?.path).toBe('/consents/{consent_id}:revoke-fraud')
    expect(matchRoute('post', `/consents/${UUID}:revoke-nonsense`)).toBeNull()
  })

  it('is method-aware and rejects unknown paths', () => {
    expect(matchRoute('delete', '/back-office/reconciliation/runs')).toBeNull()
    expect(matchRoute('get', '/nope')).toBeNull()
  })
})
