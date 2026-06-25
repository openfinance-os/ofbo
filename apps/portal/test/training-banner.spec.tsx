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

  it('uses token-named classes only (no raw hex/px) for the marker colour', () => {
    process.env.NEXT_PUBLIC_OFBO_TRAINING = 'true'
    render(<TrainingPill />)
    const cls = screen.getByTestId('training-banner').className
    expect(cls).toMatch(/bg-training\/10/)
    expect(cls).toMatch(/text-training/)
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}/i) // no raw hex
  })
})
