import { describe, expect, it } from 'vitest'
import { mintScopes, SCOPE_MATRIX } from '@ofbo/bff/auth'
import { PERSONA_GUIDE } from '../src/lib/persona-guide.js'
import { NAV_MODULES, visibleModules, type NavKey } from '../src/lib/nav.js'

/**
 * BACKOFFICE-85 — the sign-in screen must not promise a workspace the scope matrix denies.
 *
 * `persona-guide.ts` tells every visitor what each role can reach, and its own header says "keep
 * aligned with lib/nav.ts". Nothing enforced that, and it drifted: Commercial Desk Head was
 * advertised as "TPP billing, registry & commercial margin" with **Billing Control** and **TPP
 * Billing** tags, while the §2 matrix gives that persona `platform:analytics:read`,
 * `commercial:read`, `pipeline:read` — no `billing:read` at all. The persona whose entire stated
 * job is TPP billing could not open either billing screen.
 *
 * That is not a cosmetic mismatch. A visitor picks a role from these cards, so the card is the
 * product's promise about what the role does; and it is the first screen anyone evaluating OFBO
 * sees. The PRD §2 table is canon — Commercial Desk Head's surface is the Executive Dashboard
 * (Commercial angle) — so the ADVERTISING was wrong, not the matrix. Granting `billing:read` to
 * make the card true would have been granting beyond the matrix, an automatic review FAIL.
 *
 * These derive from the same `mintScopes` the portal actually signs a persona in with, so the
 * claim is checked against the real gate rather than a copy of it.
 */
describe('persona guide — every advertised module is actually reachable', () => {
  const personas = Object.keys(PERSONA_GUIDE)

  it('covers every persona in the scope matrix, and invents none', () => {
    // A persona missing here renders a bare card with no explanation; one invented here advertises
    // a role that cannot be signed in to at all.
    expect(personas.sort()).toEqual(Object.keys(SCOPE_MATRIX).sort())
  })

  it.each(personas)('%s can reach every module its card advertises', (persona) => {
    const scopes = mintScopes(persona)
    const superadmin = scopes.includes('platform:superadmin')
    const reachable = new Set<NavKey>(visibleModules(scopes, superadmin).map((m) => m.key))
    const advertised = PERSONA_GUIDE[persona]!.modules

    const unreachable = advertised.filter((key) => !reachable.has(key))
    expect(unreachable, `${persona} advertises modules it cannot open`).toEqual([])
  })

  it.each(personas)('%s advertises only real nav modules', (persona) => {
    // Guards the other direction: a key that matches no nav module renders an empty tag and can
    // never be caught by the reachability check above, because it is reachable by nobody.
    const known = new Set<NavKey>(NAV_MODULES.map((m) => m.key))
    const unknown = PERSONA_GUIDE[persona]!.modules.filter((key) => !known.has(key))
    expect(unknown, `${persona} advertises a module that does not exist`).toEqual([])
  })

  it('advertises the modules that distinguish a role, not the ones everyone has', () => {
    // Dashboard, Approvals and Guide are visible to every persona (scope: null), so listing them
    // tells a visitor nothing about the role. The cards exist to differentiate.
    const universal = new Set<NavKey>(NAV_MODULES.filter((m) => m.scope === null).map((m) => m.key))
    for (const persona of personas) {
      if (persona === 'platform-super-admin') continue // legitimately "everything"
      const advertised = PERSONA_GUIDE[persona]!.modules
      expect(
        advertised.some((key) => !universal.has(key)),
        `${persona} advertises only modules every persona already has`
      ).toBe(true)
    }
  })
})
