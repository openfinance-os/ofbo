import { describe, expect, it } from 'vitest'
import { limitParam } from '../src/pagination.js'

describe('limitParam — pagination limit coercion', () => {
  it('returns a spreadable { limit } for a valid positive integer', () => {
    expect(limitParam('25')).toEqual({ limit: 25 })
    expect(limitParam('1')).toEqual({ limit: 1 })
  })

  it('omits the limit (service default) when absent or empty', () => {
    expect(limitParam(undefined)).toEqual({})
    expect(limitParam(null)).toEqual({})
    expect(limitParam('')).toEqual({})
  })

  it('omits the limit rather than propagating NaN for non-numeric input', () => {
    // The previous Number('abc') path produced NaN, which silently emptied the page.
    expect(limitParam('abc')).toEqual({})
    expect(limitParam('12x')).toEqual({})
  })

  it('rejects fractional, zero, and negative values', () => {
    expect(limitParam('2.5')).toEqual({})
    expect(limitParam('0')).toEqual({})
    expect(limitParam('-5')).toEqual({})
  })
})
