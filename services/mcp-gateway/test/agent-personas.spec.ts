import { describe, it, expect } from 'vitest'
import { SCOPE_MATRIX } from '@ofbo/bff/auth'
import { AGENT_PERSONAS, assertSubsetOf, LeastPrivilegeViolation, type AgentPersona } from '../src/index.js'

describe('agent personas (BACKOFFICE-60 least privilege)', () => {
  it('every seeded agent persona is a STRICT subset of its human persona in the real SCOPE_MATRIX', () => {
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(() => assertSubsetOf(persona, SCOPE_MATRIX)).not.toThrow()
    }
  })

  it('no agent persona is read-write or carries a spend budget yet (read-only rollout step 1)', () => {
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(persona.allowMutations).toBe(false)
      expect(persona.spendBudget).toBe(0)
    }
  })

  it('no agent persona holds platform:superadmin or derives from platform-super-admin', () => {
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(persona.scopes).not.toContain('platform:superadmin')
      expect(persona.derivedFrom).not.toBe('platform-super-admin')
    }
  })

  it('rejects a persona that holds a scope outside its human persona', () => {
    const rogue: AgentPersona = {
      id: 'rogue',
      derivedFrom: 'customer-care-agent',
      scopes: ['reconciliation:read'], // not a care-agent scope
      allowMutations: false,
      spendBudget: 0
    }
    expect(() => assertSubsetOf(rogue, SCOPE_MATRIX)).toThrow(LeastPrivilegeViolation)
  })

  it('rejects a persona that derives from platform-super-admin', () => {
    const rogue: AgentPersona = {
      id: 'rogue-admin',
      derivedFrom: 'platform-super-admin',
      scopes: ['audit:read'],
      allowMutations: false,
      spendBudget: 0
    }
    expect(() => assertSubsetOf(rogue, SCOPE_MATRIX)).toThrow(/platform-super-admin/)
  })

  it('rejects a persona that merely mirrors its human persona (not a strict subset)', () => {
    const mirror: AgentPersona = {
      id: 'mirror',
      derivedFrom: 'customer-care-agent',
      scopes: [...SCOPE_MATRIX['customer-care-agent']],
      allowMutations: false,
      spendBudget: 0
    }
    expect(() => assertSubsetOf(mirror, SCOPE_MATRIX)).toThrow(LeastPrivilegeViolation)
  })
})
