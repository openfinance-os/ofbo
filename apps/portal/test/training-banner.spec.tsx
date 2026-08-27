// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { TrainingPill, isTrainingEnvironment } from '../src/components/training-banner.js'

const ENV = process.env.NEXT_PUBLIC_OFBO_TRAINING
afterEach(() => {
  cleanup()
  if (ENV === undefined) delete process.env.NEXT_PUBLIC_OFBO_TRAINING
  else process.env.NEXT_PUBLIC_OFBO_TRAINING = ENV
})

/**
 * BACKOFFICE-59 — the TRAINING pill renders ONLY in a training deployment
 * (NEXT_PUBLIC_OFBO_TRAINING=true), and carries the full non-prod statement for assistive
 * tech. In production/demo it renders nothing, so it can never mislead.
 */
describe('TrainingPill', () => {
  it('renders nothing outside a training deployment', () => {
    delete process.env.NEXT_PUBLIC_OFBO_TRAINING
    const { container } = render(<TrainingPill />)
    expect(container).toBeEmptyDOMElement()
    expect(isTrainingEnvironment()).toBe(false)
  })

  it('renders a labelled TRAINING marker when NEXT_PUBLIC_OFBO_TRAINING=true', () => {
    process.env.NEXT_PUBLIC_OFBO_TRAINING = 'true'
    render(<TrainingPill />)
    expect(isTrainingEnvironment()).toBe(true)
    const pill = screen.getByTestId('training-banner')
    expect(pill).toHaveTextContent(/training/i)
    // The full regulatory statement rides aria-label so it is announced on every page.
    expect(screen.getByRole('note', { name: /training environment.*never affect production/i })).toBeInTheDocument()
  })

  /**
   * BACKOFFICE-83 re-pointed this from `bg-training/10` to `bg-training` on the dot. The tinted
   * fill, border and shadow were removed on purpose — the marker is meant to be present, not
   * prominent, and the chrome was the thing every screen ended up working around. The rule this
   * test exists to enforce is unchanged and still asserted in full: the colour is token-named
   * and no raw hex reaches the markup.
   */
  it('uses token-named classes only (no raw hex/px) for the marker colour', () => {
    process.env.NEXT_PUBLIC_OFBO_TRAINING = 'true'
    render(<TrainingPill />)
    const marker = screen.getByTestId('training-banner')
    expect(marker.className).toMatch(/text-training/)
    expect(marker.querySelector('.bg-training')).not.toBeNull() // the status dot
    expect(marker.outerHTML).not.toMatch(/#[0-9a-f]{3,6}/i) // no raw hex, anywhere in the marker
  })

  /** The quiet treatment, asserted so it is not silently re-chromed later. */
  it('carries no fill, border, shadow or blur — presence is the requirement, not prominence', () => {
    process.env.NEXT_PUBLIC_OFBO_TRAINING = 'true'
    render(<TrainingPill />)
    const cls = screen.getByTestId('training-banner').className
    expect(cls).not.toMatch(/\bbg-training\/\d/)
    expect(cls).not.toMatch(/\bborder\b/)
    expect(cls).not.toMatch(/shadow/)
    expect(cls).not.toMatch(/backdrop-blur/)
  })
})
