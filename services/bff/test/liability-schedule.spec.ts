import { describe, expect, it } from 'vitest'
import {
  LIABILITY_SCHEDULE_MINOR,
  LIABILITY_SLA_TIERS_MINOR,
  LIABILITY_SCHEDULE_CITATION,
  liabilityAmountMinor,
  type LiabilityIssue
} from '../src/risk/liability-schedule.js'
import { LIABILITY_MATRIX, SLA_TIERS, liabilityAmount } from '../src/risk/liability.js'

/**
 * VAL-01 (ADR 0026) — the scheme liability schedule as a named, tested constant set in AED
 * MINOR units, cited to the scheme document. Acceptance criterion 1: never magic numbers in
 * the view layer.
 *
 * The amounts are canon, not invention: PRD §7 BACKOFFICE-36 quotes the CBUAE Limitation of
 * Liability Model v2.1 per-incident amounts, and this file pins every one of them. A test
 * that merely re-asserted the implementation's own constants would be vacuous, so the
 * expected values below are written out literally from the PRD line.
 */

// Transcribed from PRD §7 BACKOFFICE-36 — whole AED, exactly as the scheme document states.
const PRD_WHOLE_AED: Record<LiabilityIssue, number> = {
  consent_state_failure: 500,
  revocation_failure: 350,
  sca_auth_error: 500,
  data_breach: 750,
  sla_execution_failure: 350,
  consumer_protection_violation: 1000,
  deprecation_mismanagement: 2500,
  lfi_breaking_change: 5000,
  fraud_prevention_failure: 10000
}

describe('VAL-01 liability schedule (AED minor units)', () => {
  it('pins every v2.1 per-incident amount from the PRD, in minor units', () => {
    for (const [issue, wholeAed] of Object.entries(PRD_WHOLE_AED)) {
      expect(LIABILITY_SCHEDULE_MINOR[issue as LiabilityIssue]).toBe(wholeAed * 100)
    }
  })

  it('covers exactly the scheme issues — no extras invented, none dropped', () => {
    expect(Object.keys(LIABILITY_SCHEDULE_MINOR).sort()).toEqual(Object.keys(PRD_WHOLE_AED).sort())
  })

  it('tiers the SLA-execution failure 350/250/200 by delay severity', () => {
    expect(LIABILITY_SLA_TIERS_MINOR).toEqual({ 1: 35000, 2: 25000, 3: 20000 })
  })

  it('cites the scheme document rather than leaving the numbers unattributed', () => {
    expect(LIABILITY_SCHEDULE_CITATION).toMatch(/Limitation of Liability Model v2\.1/i)
  })

  describe('liabilityAmountMinor', () => {
    it('returns the flat per-incident amount for a non-tiered issue', () => {
      expect(liabilityAmountMinor('data_breach')).toBe(75000)
    })

    it('applies the tier for an SLA-execution failure', () => {
      expect(liabilityAmountMinor('sla_execution_failure', 2)).toBe(25000)
      expect(liabilityAmountMinor('sla_execution_failure', 3)).toBe(20000)
    })

    it('defaults an SLA-execution failure with no tier to the worst tier (1)', () => {
      expect(liabilityAmountMinor('sla_execution_failure')).toBe(35000)
    })

    it('returns 0 for an unknown issue rather than throwing or guessing', () => {
      expect(liabilityAmountMinor('not_a_scheme_issue' as LiabilityIssue)).toBe(0)
    })
  })

  /**
   * The whole-AED matrix used by the BACKOFFICE-36 monitor must be DERIVED from this schedule,
   * not a second hand-maintained copy — two copies of a regulated fee table drift silently, and
   * the drift is invisible until a figure is wrong in front of a regulator.
   */
  describe('single source of truth', () => {
    it('derives the BACKOFFICE-36 whole-AED matrix from the minor-unit schedule', () => {
      for (const [issue, minor] of Object.entries(LIABILITY_SCHEDULE_MINOR)) {
        expect(LIABILITY_MATRIX[issue]).toBe(minor / 100)
      }
      expect(Object.keys(LIABILITY_MATRIX).sort()).toEqual(Object.keys(LIABILITY_SCHEDULE_MINOR).sort())
    })

    it('derives the whole-AED SLA tiers from the minor-unit tiers', () => {
      expect(SLA_TIERS).toEqual({ 1: 350, 2: 250, 3: 200 })
    })

    it('keeps liabilityAmount() and liabilityAmountMinor() in agreement', () => {
      for (const issue of Object.keys(LIABILITY_SCHEDULE_MINOR) as LiabilityIssue[]) {
        expect(liabilityAmount({ issue }) * 100).toBe(liabilityAmountMinor(issue))
      }
      for (const tier of [1, 2, 3]) {
        expect(liabilityAmount({ issue: 'sla_execution_failure', sla_tier: tier }) * 100).toBe(
          liabilityAmountMinor('sla_execution_failure', tier)
        )
      }
    })
  })
})
