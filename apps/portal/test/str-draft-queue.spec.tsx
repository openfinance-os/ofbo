// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { StrDraftQueue } from '../src/components/str-draft-queue.js'
import type { StrDraft } from '../src/lib/str-drafts.js'

afterEach(cleanup)

/**
 * BACKOFFICE-63 — STR draft queue (Compliance surface, ADR 0022). Read-only list; the handoff
 * is four-eyes from the approvals surface. Token-only, OpenAPI-bound, no PSU PII.
 */
const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(ui)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

const draft = (overrides: Partial<StrDraft> = {}): StrDraft => ({
  str_draft_id: '5f0e63c0-0000-4000-8000-0000000000a1',
  source_consent_id: '22222222-2222-4222-8222-222222222222',
  case_context: 'velocity anomaly (synthetic)',
  status: 'draft',
  created_by: 'demo:risk-analyst',
  approval_id: null,
  workflow_ref: null,
  approved_by: null,
  handed_off_at: null,
  created_at: '2026-06-24T00:00:00.000Z',
  ...overrides
})

describe('BACKOFFICE-63 — StrDraftQueue', () => {
  it('renders drafts with the consent ref, status and workflow ref', () => {
    render(<StrDraftQueue drafts={[draft({ status: 'handed_off', workflow_ref: 'str-wf-abc' })]} />)
    expect(screen.getByTestId('str-draft-row-5f0e63c0-0000-4000-8000-0000000000a1')).toBeInTheDocument()
    expect(screen.getByText('22222222-2222-4222-8222-222222222222')).toBeInTheDocument()
    expect(screen.getByText('str-wf-abc')).toBeInTheDocument()
  })

  it('shows an empty state when there are no drafts', () => {
    render(<StrDraftQueue drafts={[]} />)
    expect(screen.getByTestId('str-drafts-empty')).toBeInTheDocument()
  })

  it('shows an error banner and no table when the queue is unavailable', () => {
    render(<StrDraftQueue error="The STR draft queue is temporarily unavailable." />)
    expect(screen.getByTestId('str-drafts-error')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('has no WCAG 2.1 AA violations', async () => {
    await expectNoViolations(<StrDraftQueue drafts={[draft()]} />)
  })
})
