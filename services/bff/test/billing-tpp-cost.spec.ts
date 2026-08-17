import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  UnpriceableOverageError,
  fils,
  type DirectoryOverageSnapshot,
  type MeteredLine
} from '@ofbo/billing'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { TppCostStatementService, type TppCostStatementStore } from '../src/billing/tpp-cost.js'

/**
 * BILL-13 — generation of the expected TPP cost statement on the monthly billing trigger.
 *
 * The property under test beyond the happy path: a period that cannot be priced must SKIP, not
 * throw. Rating fails closed without a directory snapshot by design, and letting that failure
 * escape would take the regulated receivable projections down with the payable one.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const RUN = { id: '4f1d9a1e-0000-4000-8000-000000000001', period: '2026-06', rateCardVersion: SCHEME_RATE_CARD_2026_06_02.version }

const SNAPSHOT: DirectoryOverageSnapshot = {
  snapshotId: 'dir-2026-06-01',
  retrievedAt: '2026-06-01T00:00:00.000Z',
  sourceUrl: 'https://data.directory.openfinance.ae/participants',
  digest: 'sha256:dir-fixture',
  currency: 'AED',
  unit: 'per_page',
  rates: [{ lfiId: 'lfi-alpha', rateMilliFils: fils(800), effectiveFrom: '2026-01-01' }]
}

const hubOnly: MeteredLine[] = [{
  eventId: 'evt-hub', occurredAt: '2026-06-15T10:00:00Z', tppId: 'bank-as-tpp', traceId: 'fapi-hub',
  endpoint: 'POST /payments', clientId: 'client-a', counterpartyLfiId: 'lfi-alpha',
  direction: 'outbound', side: 'payable_hub', feeClass: 'hub.standard', units: 1
}]

/** A chargeable retail overage line: unpriceable without a directory snapshot. */
const withOverage: MeteredLine[] = [...hubOnly, {
  eventId: 'evt-data', occurredAt: '2026-06-15T10:00:00Z', tppId: 'bank-as-tpp', traceId: 'fapi-data',
  endpoint: 'GET /accounts/{id}/transactions', clientId: 'client-a', counterpartyLfiId: 'lfi-alpha',
  direction: 'outbound', side: 'payable_lfi', feeClass: 'data.retail_page', units: 3, freeUnits: 15
}]

function store(lines: MeteredLine[], run: typeof RUN | null = RUN): TppCostStatementStore & { saved: number } {
  return {
    saved: 0,
    async latestMeterRun() { return run },
    async meteredLinesForRun() { return lines },
    async saveStatement(this: { saved: number }) {
      this.saved += 1
      return { record: { id: 'statement-1' }, created: this.saved === 1 }
    }
  } as TppCostStatementStore & { saved: number }
}

function service(target: TppCostStatementStore, overage?: DirectoryOverageSnapshot | null) {
  const audit = new InMemoryHighClassAuditSink()
  const svc = new TppCostStatementService({
    store: target,
    audit,
    tenantId: TENANT,
    ...(overage !== undefined ? { overage: { async snapshotForPeriod() { return overage } } } : {})
  })
  return { svc, audit }
}

describe('BILL-13 expected TPP cost statement generation', () => {
  it('generates and persists a statement for a priced period, auditing the totals', async () => {
    const target = store(withOverage)
    const { svc, audit } = service(target, SNAPSHOT)

    const result = await svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 'trace-1')

    expect(result).toMatchObject({ status: 'generated', created: true, statementId: 'statement-1' })
    const event = audit.events.at(-1)
    expect(event?.event_type).toBe('billing_tpp_cost_statement_generated')
    expect(event?.request_body).toMatchObject({
      period: '2026-06',
      directory_snapshot_id: 'dir-2026-06-01',
      nebras_hub_net_milli_fils: fils(2.5)
    })
  })

  it('is idempotent on a replayed or resumed run', async () => {
    const target = store(withOverage)
    const { svc } = service(target, SNAPSHOT)

    await svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 'trace-1')
    const second = await svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 'trace-2')

    expect(second).toMatchObject({ status: 'generated', created: false })
  })

  it('skips — never throws — when a chargeable overage line cannot be priced', async () => {
    // No snapshot: rating fails closed. That must not escape into the billing projection.
    const target = store(withOverage)
    const { svc, audit } = service(target, null)

    const result = await svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 'trace-1')

    expect(result.status).toBe('skipped')
    expect(result.reason).toMatch(/directory overage snapshot/i)
    expect(audit.events.at(-1)?.event_type).toBe('billing_tpp_cost_statement_unpriceable')
    // Nothing half-priced was written.
    expect((target as unknown as { saved: number }).saved).toBe(0)
  })

  it('still prices a period whose costs are all scheme-uniform, with no directory snapshot at all', async () => {
    const target = store(hubOnly)
    const { svc } = service(target, null)

    const result = await svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 'trace-1')

    expect(result).toMatchObject({ status: 'generated', created: true })
  })

  it('skips a period with no meter run, and one metered under a different rate card', async () => {
    const missing = service(store(hubOnly, null), SNAPSHOT)
    expect(await missing.svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 't'))
      .toMatchObject({ status: 'skipped', reason: /no metering run/ })

    const stale = service(store(hubOnly, { ...RUN, rateCardVersion: '2025.01.01' }), SNAPSHOT)
    expect(await stale.svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 't'))
      .toMatchObject({ status: 'skipped', reason: /not 2026\.06\.02/ })
  })

  it('classifies the skip by error type, not by matching message text', async () => {
    // A defect whose message merely mentions the same words must NOT be downgraded to a skip.
    const impostor: TppCostStatementStore = {
      async latestMeterRun() { return RUN },
      async meteredLinesForRun() { throw new Error('directory overage snapshot table is corrupt') },
      async saveStatement() { throw new Error('unreachable') }
    }
    const { svc } = service(impostor, SNAPSHOT)
    await expect(svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 't'))
      .rejects.toThrow(/corrupt/)

    // And the genuine refusal is the typed error the service keys on.
    expect(new UnpriceableOverageError('evt-1', 'x')).toBeInstanceOf(Error)
  })

  it('propagates a genuine defect instead of disguising it as a skip', async () => {
    const broken: TppCostStatementStore = {
      async latestMeterRun() { return RUN },
      async meteredLinesForRun() { throw new Error('database unavailable') },
      async saveStatement() { throw new Error('unreachable') }
    }
    const { svc } = service(broken, SNAPSHOT)

    await expect(svc.generateStatement('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T02:00:00.000Z', 't'))
      .rejects.toThrow(/database unavailable/)
  })
})
