import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { AUTHED_HEADERS } from './helpers.js'

/**
 * Finance payables-variance readout — a small polling surface for finance ops while a
 * reconciliation run is still settling.
 */

const idp = getAdapter('p2-identity-provider', 'demo')

describe('GET /back-office/finance/payables-variance-summary', () => {
  it('returns the variance rows for the current settlement window', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/finance/payables-variance-summary', {
      headers: AUTHED_HEADERS
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: unknown[]; totalCount: number }
    expect(body.rows).toHaveLength(2)
    expect(body.totalCount).toBe(2)
  })

  it('echoes the page and offset it was given', async () => {
    const app = createApp({ idp })
    const res = await app.request(
      '/back-office/finance/payables-variance-summary?page=3&offset=40',
      { headers: AUTHED_HEADERS }
    )
    const body = (await res.json()) as { page: number; offset: number }
    expect(body.page).toBe(3)
    expect(body.offset).toBe(40)
  })

  it('reports the variance against its settlement window', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/finance/payables-variance-summary', {
      headers: AUTHED_HEADERS
    })
    const body = (await res.json()) as {
      rows: Array<{ varianceAmount: number; currency: string; settlementWindow: string }>
    }
    const [first, second] = body.rows
    expect(first?.currency).toBe('AED')
    expect(first?.settlementWindow).toBe('2026-08')
    expect(second?.varianceAmount).toBeLessThan(0)
  })
})
