// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { ConfirmSubmit } from '../src/components/ui/confirm-submit.js'

afterEach(cleanup)

/**
 * UX-02 — two-step confirmation for irreversible actions. Asserts the armed/confirm
 * behaviour and that the action does NOT fire until the user confirms: the initial button
 * is type=button (never submits), arming shows the summary, Confirm is type=submit (submits
 * the enclosing form), and Cancel disarms.
 */

function renderInForm() {
  const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <ConfirmSubmit label="Revoke" confirmLabel="Confirm revoke" summary="This cannot be undone." testid="revoke-submit" />
    </form>
  )
  return { onSubmit }
}

describe('ConfirmSubmit', () => {
  it('starts disarmed: a non-submitting action button, no summary, no confirm', () => {
    const { onSubmit } = renderInForm()
    const btn = screen.getByTestId('revoke-submit')
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveTextContent('Revoke')
    expect(screen.queryByText('This cannot be undone.')).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(onSubmit).not.toHaveBeenCalled() // arming must not submit
  })

  it('arming reveals the summary and a submit confirm + cancel', () => {
    renderInForm()
    fireEvent.click(screen.getByTestId('revoke-submit'))
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    const confirm = screen.getByTestId('revoke-submit-confirm')
    expect(confirm).toHaveAttribute('type', 'submit')
    expect(confirm).toHaveTextContent('Confirm revoke')
    expect(screen.getByTestId('revoke-submit-cancel')).toHaveAttribute('type', 'button')
  })

  it('confirm submits the enclosing form', () => {
    const { onSubmit } = renderInForm()
    fireEvent.click(screen.getByTestId('revoke-submit'))
    fireEvent.click(screen.getByTestId('revoke-submit-confirm'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancel disarms back to the action button without submitting', () => {
    const { onSubmit } = renderInForm()
    fireEvent.click(screen.getByTestId('revoke-submit'))
    fireEvent.click(screen.getByTestId('revoke-submit-cancel'))
    expect(screen.getByTestId('revoke-submit')).toHaveAttribute('type', 'button')
    expect(screen.queryByText('This cannot be undone.')).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
