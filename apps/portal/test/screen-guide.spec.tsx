// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SCREEN_GUIDE, ECOSYSTEM, GUARDRAILS, BANK_ROLES, screenGuideFor } from '../src/lib/screen-guide.js'
import { NAV_MODULES } from '../src/lib/nav.js'
import { GuideContent } from '../src/components/guide-content.js'
import { ScreenGuideOverlay } from '../src/components/screen-guide-overlay.js'

afterEach(cleanup)

/**
 * UX — the Open Finance onboarding layer: the introductory guide page + the per-screen
 * "About this screen" overlay. Both read lib/screen-guide.ts, so the in-app help and the
 * guide can never drift, and every nav module is explained.
 */

describe('screen-guide content (single source of truth)', () => {
  it('explains every nav module the operator can reach', () => {
    const guideKeys = new Set(SCREEN_GUIDE.map((s) => s.key))
    for (const m of NAV_MODULES) {
      expect(guideKeys.has(m.key), `nav module "${m.key}" has no guide entry`).toBe(true)
    }
  })

  it('every screen entry carries the what / helps / why triad', () => {
    for (const s of SCREEN_GUIDE) {
      expect(s.whatItIs.length, `${s.key}.whatItIs`).toBeGreaterThan(20)
      expect(s.helpsYou.length, `${s.key}.helpsYou`).toBeGreaterThan(20)
      expect(s.whyOpenFinance.length, `${s.key}.whyOpenFinance`).toBeGreaterThan(20)
    }
  })

  it('names the three UAE ecosystem actors', () => {
    const names = ECOSYSTEM.map((a) => a.name).join(' ')
    expect(names).toMatch(/CBUAE/)
    expect(names).toMatch(/Al Tareq/)
    expect(names).toMatch(/Nebras/)
  })

  it('screenGuideFor resolves a key and is undefined otherwise', () => {
    expect(screenGuideFor('finance')?.title).toMatch(/Reconciliation/)
    expect(screenGuideFor('nope')).toBeUndefined()
    expect(screenGuideFor(undefined)).toBeUndefined()
  })
})

describe('GuideContent', () => {
  it('renders the hero, ecosystem, guardrails and a card for every screen', () => {
    render(<GuideContent />)
    expect(screen.getByTestId('guide-hero')).toBeInTheDocument()
    for (const s of SCREEN_GUIDE) {
      expect(screen.getByTestId(`guide-screen-${s.key}`)).toBeInTheDocument()
    }
    // guardrails + bank roles are explained
    expect(screen.getByText(GUARDRAILS[0]!.title)).toBeInTheDocument()
    expect(screen.getByText(BANK_ROLES[0]!.role)).toBeInTheDocument()
  })

  it('chromeless mode shows a back-to-sign-in route', () => {
    render(<GuideContent chromeless />)
    expect(screen.getByTestId('guide-back-to-signin')).toHaveAttribute('href', '/')
  })
})

describe('ScreenGuideOverlay', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens the dialog for the active screen and links to the full guide', () => {
    window.localStorage.setItem('ofbo-guide-seen-v1', '1') // suppress first-run auto-open
    render(<ScreenGuideOverlay activeKey="risk" />)
    expect(screen.queryByTestId('screen-guide-dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('screen-guide-open'))
    const dialog = screen.getByTestId('screen-guide-dialog')
    expect(dialog).toHaveTextContent('Risk')
    expect(dialog).toHaveTextContent(screenGuideFor('risk')!.whyOpenFinance)
    expect(screen.getByTestId('screen-guide-full-link')).toHaveAttribute('href', '/guide')
  })

  it('closes on the backdrop', () => {
    window.localStorage.setItem('ofbo-guide-seen-v1', '1')
    render(<ScreenGuideOverlay activeKey="dashboard" />)
    fireEvent.click(screen.getByTestId('screen-guide-open'))
    expect(screen.getByTestId('screen-guide-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('screen-guide-backdrop'))
    expect(screen.queryByTestId('screen-guide-dialog')).not.toBeInTheDocument()
  })

  it('first-run: surfaces itself once, then stays closed on the next visit', () => {
    const first = render(<ScreenGuideOverlay activeKey="customer-care" />)
    // auto-opened on first ever mount
    expect(screen.getByTestId('screen-guide-dialog')).toBeInTheDocument()
    expect(window.localStorage.getItem('ofbo-guide-seen-v1')).toBe('1')
    first.unmount()
    cleanup()
    // a later visit does not auto-open
    render(<ScreenGuideOverlay activeKey="customer-care" />)
    expect(screen.queryByTestId('screen-guide-dialog')).not.toBeInTheDocument()
  })

  it('falls back to a general OFBO explainer when the screen has no entry', () => {
    window.localStorage.setItem('ofbo-guide-seen-v1', '1')
    render(<ScreenGuideOverlay activeKey="unknown" />)
    fireEvent.click(screen.getByTestId('screen-guide-open'))
    expect(screen.getByTestId('screen-guide-dialog')).toHaveTextContent('Open Finance Back Office')
  })
})
