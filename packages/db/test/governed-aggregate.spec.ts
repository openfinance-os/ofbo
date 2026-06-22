import { describe, expect, it, vi } from 'vitest'
import { beginInternalViewTx } from '../src/tenant-tx.js'
import {
  GovernedQueryError,
  runGovernedAggregate,
  SEED_QUERY_PURPOSES,
  type GovernedAggregateContext
} from '../src/governed-aggregate.js'

/**
 * BACKOFFICE-33 (ADR 0015) — governed cross-fintech aggregation control. Unit-level proof of the
 * gate logic with a mock pool: an unregistered purpose is rejected BEFORE any cross-tenant read,
 * and an approved purpose runs as bank_internal_view and is High-class logged. (The real RLS-bypass
 * + grant semantics are proven in governed-aggregate.int.spec.ts against Postgres.)
 */

const BANK = '11111111-1111-4111-8111-111111111111'

/** A mock pool whose registry SELECT reports the purpose as approved or not. */
function mockPool(approved: boolean) {
  const calls: string[] = []
  const client = {
    query: vi.fn(async (sql: unknown) => {
      const s = typeof sql === 'string' ? sql : JSON.stringify(sql)
      calls.push(s)
      if (s.includes('query_purpose_registry')) return { rowCount: approved ? 1 : 0, rows: approved ? [{ ok: 1 }] : [] }
      return { rowCount: 0, rows: [] }
    }),
    release: vi.fn()
  }
  const pool = { connect: vi.fn(async () => client) }
  return { pool: pool as unknown as GovernedAggregateContext['pool'], client, calls }
}

function ctx(over: Partial<GovernedAggregateContext> & { pool: GovernedAggregateContext['pool'] }): GovernedAggregateContext {
  return {
    bankId: BANK,
    purposeCode: 'compliance_reporting',
    audit: { emit: vi.fn(async () => undefined) },
    actingPrincipal: 'demo:compliance-officer',
    traceId: 'trace-1',
    ...over
  }
}

describe('beginInternalViewTx', () => {
  it('assumes the SELECT-only bank_internal_view role and does NOT pin app.bank_id', () => {
    const sql = beginInternalViewTx()
    expect(sql).toBe('BEGIN; SET LOCAL ROLE bank_internal_view')
    expect(sql).not.toContain('app.bank_id') // RLS is bypassed by the internal_view_select policy, deliberately
  })
})

describe('SEED_QUERY_PURPOSES (BD-13 starter set)', () => {
  it('is exactly the six approved purposes', () => {
    expect(SEED_QUERY_PURPOSES.map((p) => p.purpose_code)).toEqual([
      'executive_dashboard',
      'finance_view',
      'risk_monitoring',
      'operations_monitoring',
      'compliance_reporting',
      'regulatory_periodic_report'
    ])
  })
})

describe('runGovernedAggregate — the gate', () => {
  it('REJECTS an unregistered purpose before any cross-tenant read (no query, no log)', async () => {
    const { pool, calls } = mockPool(false)
    const audit = { emit: vi.fn(async () => undefined) }
    const queryFn = vi.fn(async () => ({ result: 1, rowCount: 1 }))

    await expect(runGovernedAggregate(ctx({ pool, audit, purposeCode: 'not_registered' }), queryFn)).rejects.toMatchObject({
      name: 'GovernedQueryError',
      code: 'BACKOFFICE.UNREGISTERED_QUERY_PURPOSE'
    })
    expect(queryFn).not.toHaveBeenCalled() // the bypass read never happens
    expect(audit.emit).not.toHaveBeenCalled()
    expect(calls.some((s) => s.includes('SET LOCAL ROLE bank_internal_view'))).toBe(false)
  })

  it('runs an approved purpose as bank_internal_view and High-class logs the bypass', async () => {
    const { pool, calls } = mockPool(true)
    const audit = { emit: vi.fn(async () => undefined) }
    const queryFn = vi.fn(async (c: { query: (s: string) => Promise<unknown> }) => {
      await c.query('SELECT count(*) FROM consent_admin_event')
      return { result: 'AGG', rowCount: 42 }
    })

    const out = await runGovernedAggregate(ctx({ pool, audit, purposeCode: 'compliance_reporting', traceId: 't-9' }), queryFn)

    expect(out).toBe('AGG')
    expect(queryFn).toHaveBeenCalledOnce()
    expect(calls).toContain('BEGIN; SET LOCAL ROLE bank_internal_view') // bypass ran under the governed role
    expect(audit.emit).toHaveBeenCalledOnce()
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'cross_fintech_query',
        acting_principal: 'demo:compliance-officer',
        request_trace_id: 't-9',
        request_body: { purpose_code: 'compliance_reporting', row_count: 42 },
        response_status: 200
      })
    )
  })

  it('propagates a query failure and never logs a half-finished read', async () => {
    const { pool } = mockPool(true)
    const audit = { emit: vi.fn(async () => undefined) }
    const queryFn = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(runGovernedAggregate(ctx({ pool, audit }), queryFn)).rejects.toThrow('boom')
    expect(audit.emit).not.toHaveBeenCalled()
  })
})

describe('GovernedQueryError', () => {
  it('carries a stable code for the BFF to map', () => {
    const e = new GovernedQueryError('BACKOFFICE.UNREGISTERED_QUERY_PURPOSE', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('BACKOFFICE.UNREGISTERED_QUERY_PURPOSE')
  })
})
