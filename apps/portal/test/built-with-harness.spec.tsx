// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { BuiltWithHarness } from '../src/components/built-with-harness.js'

afterEach(cleanup)

/**
 * The "How this was built" colophon: a closed-by-default trigger that opens a labelled
 * dialog embedding the harness map. Token-only, accessible, dismissible.
 */
describe('BuiltWithHarness', () => {
  it('renders only the trigger by default (dialog closed)', () => {
    render(<BuiltWithHarness />)
    expect(screen.getByTestId('built-with-open')).toBeInTheDocument()
    expect(screen.queryByTestId('built-with-dialog')).not.toBeInTheDocument()
  })

  it('opens a labelled dialog embedding the served harness map', () => {
    render(<BuiltWithHarness />)
    fireEvent.click(screen.getByTestId('built-with-open'))
    const dialog = screen.getByTestId('built-with-dialog')
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // explains how OFBO was built
    expect(dialog).toHaveTextContent(/double diamond/i)
    expect(dialog).toHaveTextContent(/human merges it/i)
    // embeds the map served from /public, and links to it full-screen
    expect(screen.getByTestId('harness-map-frame')).toHaveAttribute('src', '/the-loom-ways-of-working.html')
    expect(screen.getByTestId('built-with-full-link')).toHaveAttribute('href', '/the-loom-ways-of-working.html')
    // and a companion link to the AI-DLC tooling page, served from /public
    expect(screen.getByTestId('built-with-aidlc-link')).toHaveAttribute(
      'href',
      '/ai-dlc-harness-tooling.html',
    )
  })

  it('closes via the close control and via Escape', () => {
    render(<BuiltWithHarness />)
    fireEvent.click(screen.getByTestId('built-with-open'))
    fireEvent.click(screen.getByTestId('built-with-close'))
    expect(screen.queryByTestId('built-with-dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('built-with-open'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('built-with-dialog')).not.toBeInTheDocument()
  })

  it('uses token-named classes only (no raw hex/px) for the trigger', () => {
    render(<BuiltWithHarness />)
    const cls = screen.getByTestId('built-with-open').className
    expect(cls).toMatch(/text-on-nav/)
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}/i)
    expect(cls).not.toMatch(/\b\d+px\b/)
  })
})
