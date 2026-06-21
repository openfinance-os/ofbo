// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { SubmitButton } from '../src/components/ui/submit-button.js'
import { IdempotencyField } from '../src/components/ui/idempotency-field.js'
import { idempotencyKey } from '../src/lib/idempotency.js'

afterEach(cleanup)

/**
 * UX-05 — submitting states + stable idempotency keys. SubmitButton reflects the in-flight
 * action via useFormStatus (idle here = enabled, shows its label); IdempotencyField emits a
 * per-render key so a double-submit of the same form dedupes; idempotencyKey reads it.
 */

describe('SubmitButton', () => {
  it('renders an enabled submit button showing its label when idle', () => {
    render(<SubmitButton testid="go" pendingLabel="Working…" className="x">Claim break</SubmitButton>)
    const btn = screen.getByTestId('go')
    expect(btn).toHaveAttribute('type', 'submit')
    expect(btn).toHaveTextContent('Claim break')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'false')
  })
})

describe('IdempotencyField', () => {
  it('emits a hidden idempotency_key with a UUID value', () => {
    const { container } = render(<IdempotencyField />)
    const input = container.querySelector('input[name="idempotency_key"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('hidden')
    expect(input.value).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('mints a distinct key per render (per form instance)', () => {
    const a = render(<IdempotencyField />).container.querySelector('input')!.getAttribute('value')
    cleanup()
    const b = render(<IdempotencyField />).container.querySelector('input')!.getAttribute('value')
    expect(a).not.toBe(b)
  })
})

describe('idempotencyKey', () => {
  it('returns the form-embedded key when present', () => {
    const fd = new FormData()
    fd.set('idempotency_key', 'stable-key-123')
    expect(idempotencyKey(fd)).toBe('stable-key-123')
  })

  it('falls back to a fresh key when the field is missing', () => {
    expect(idempotencyKey(new FormData())).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
