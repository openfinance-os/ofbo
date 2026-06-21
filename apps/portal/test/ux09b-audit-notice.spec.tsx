// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { AuditNote } from '../src/components/ui/audit-note.js'
import { ClearStatusParam } from '../src/components/ui/clear-status-param.js'

afterEach(cleanup)

/**
 * UX-09b — point-of-action audit affordance + clearing the one-shot notice params.
 */
describe('AuditNote', () => {
  it('states that actions are recorded to the immutable audit trail', () => {
    render(<AuditNote />)
    expect(screen.getByTestId('audit-note')).toHaveTextContent('recorded to the immutable audit trail')
  })
})

describe('ClearStatusParam', () => {
  it('strips status + ar from the URL but keeps pagination cursors', () => {
    window.history.replaceState(null, '', '/care?status=revoked&ar=AR-1&runs_cursor=abc')
    render(<ClearStatusParam />)
    expect(window.location.search).toBe('?runs_cursor=abc')
  })

  it('is a no-op when there are no notice params', () => {
    window.history.replaceState(null, '', '/reconciliation?run_id=RUN-1')
    render(<ClearStatusParam />)
    expect(window.location.search).toBe('?run_id=RUN-1')
  })
})
