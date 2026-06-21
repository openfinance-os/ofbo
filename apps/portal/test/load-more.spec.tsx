// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { LoadMore } from '../src/components/ui/load-more.js'
import { RunList } from '../src/components/recon-console.js'
import type { ReconciliationRun } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * UX-04 — cursor pagination. The list getters return next_cursor but the pages discarded
 * it, so long lists truncated silently. Asserts the LoadMore control (next-page link +
 * "more available" indicator) and that a wired list (RunList) surfaces it.
 */

describe('LoadMore', () => {
  it('shows a next-page link + "more available" when a cursor exists', () => {
    render(<LoadMore moreHref="/x?cursor=abc" shown={10} noun="runs" />)
    expect(screen.getByTestId('load-more-status')).toHaveTextContent('10 runs shown · more available')
    expect(screen.getByTestId('load-more-link')).toHaveAttribute('href', '/x?cursor=abc')
  })

  it('shows "all loaded" and no link when there is no further cursor', () => {
    render(<LoadMore moreHref={null} shown={4} noun="runs" />)
    expect(screen.getByTestId('load-more-status')).toHaveTextContent('4 runs shown · all loaded')
    expect(screen.queryByTestId('load-more-link')).not.toBeInTheDocument()
  })

  it('renders nothing for an empty list (the empty-state owns that case)', () => {
    const { container } = render(<LoadMore moreHref="/x?cursor=abc" shown={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RunList wiring', () => {
  const run: ReconciliationRun = {
    id: 'r-1',
    run_id: 'RUN-1',
    status: 'completed',
    run_type: 'daily',
    created_at: '2026-06-21T00:00:00Z',
    reconciliation_window_start: '2026-06-20T00:00:00Z',
    reconciliation_window_end: '2026-06-21T00:00:00Z',
    failure_reason: null,
    line_count_total: 100,
    line_count_matched: 98,
    line_count_unmatched: 2,
    line_count_disputed: 0
  }

  it('renders the next-page link when more runs are available', () => {
    render(<RunList runs={[run]} moreHref="/reconciliation?runs_cursor=next" />)
    expect(screen.getByTestId('load-more-link')).toHaveAttribute('href', '/reconciliation?runs_cursor=next')
  })

  it('shows "all loaded" when there is no further page', () => {
    render(<RunList runs={[run]} moreHref={null} />)
    expect(screen.getByTestId('load-more-status')).toHaveTextContent('all loaded')
    expect(screen.queryByTestId('load-more-link')).not.toBeInTheDocument()
  })
})
