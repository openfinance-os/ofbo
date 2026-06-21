// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import NotFound from '../src/app/not-found.js'

afterEach(cleanup)

/**
 * UX-09 — app-level 404. An unknown route gets a calm, token-styled recovery with a way
 * back into the portal instead of Next's default screen.
 */
describe('not-found', () => {
  it('renders a heading and a link back to the dashboard', () => {
    render(<NotFound />)
    expect(screen.getByTestId('not-found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard')
  })
})
