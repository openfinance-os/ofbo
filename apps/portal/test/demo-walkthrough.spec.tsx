// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DemoWalkthrough } from '../src/components/demo-walkthrough.js'
import { WALKTHROUGH } from '../src/lib/demo-walkthrough.js'

afterEach(cleanup)

describe('DemoWalkthrough', () => {
  it('opens on step 1 (Customer Care) with a deep link into the console', () => {
    render(<DemoWalkthrough />)
    expect(screen.getByTestId('step-panel-care')).toBeInTheDocument()
    expect(screen.getByTestId('step-console-link')).toHaveAttribute('href', '/care')
    expect(screen.getByTestId('step-prev')).toBeDisabled()
  })

  it('walks forward through every step via Next and reveals the close at the end', () => {
    render(<DemoWalkthrough />)
    for (let i = 1; i < WALKTHROUGH.length; i++) {
      fireEvent.click(screen.getByTestId('step-next'))
    }
    expect(screen.getByTestId(`step-panel-${WALKTHROUGH[WALKTHROUGH.length - 1]!.id}`)).toBeInTheDocument()
    expect(screen.getByTestId('step-next')).toBeDisabled()
    expect(screen.getByTestId('walkthrough-close')).toBeInTheDocument()
  })

  it('jumps directly to a step from the rail', () => {
    render(<DemoWalkthrough />)
    fireEvent.click(screen.getByTestId('step-tab-risk'))
    expect(screen.getByTestId('step-panel-risk')).toBeInTheDocument()
    expect(screen.getByTestId('step-console-link')).toHaveAttribute('href', '/risk')
  })

  it('the CLI-only step has no console deep link', () => {
    render(<DemoWalkthrough />)
    fireEvent.click(screen.getByTestId('step-tab-live-triggers'))
    expect(screen.getByTestId('step-panel-live-triggers')).toBeInTheDocument()
    expect(screen.queryByTestId('step-console-link')).toBeNull()
  })
})
