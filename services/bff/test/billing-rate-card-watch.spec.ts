import { describe, expect, it, vi } from 'vitest'
import { SCHEME_RATE_CARD_2026_06_02 } from '@ofbo/billing'
import { InMemoryHighClassAuditSink, SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../src/high-class-audit.js'
import {
  BillingRateCardWatcher,
  HttpRateCardSourceFetcher,
  InMemoryBillingRateCardStore,
  runBillingRateCardWatch,
  type BillingRateCardWatchSource
} from '../src/billing/rate-card-watch.js'

const SOURCE: BillingRateCardWatchSource = {
  name: 'Commercial and Pricing Model',
  url: SCHEME_RATE_CARD_2026_06_02.source
}

describe('BILL-01 operational rate-card watcher', () => {
  it('persists a baseline, opens one High-class review on change, and notifies both teams once', async () => {
    const store = new InMemoryBillingRateCardStore()
    const audit = new InMemoryHighClassAuditSink()
    let body = 'scheme page v1'
    const fetcher = { fetchSource: vi.fn(async () => ({ body, httpStatus: 200, etag: null, lastModified: null })) }
    const tickets: Array<{ team: string; summary: string }> = []
    const itsm = {
      createTicket: vi.fn(async (input: { team: string; summary: string }) => {
        tickets.push(input)
        return { ticket_id: `TKT-${tickets.length}` }
      })
    }
    const watcher = new BillingRateCardWatcher({
      store,
      audit,
      itsm,
      fetcher,
      sources: [SOURCE],
      rateCard: SCHEME_RATE_CARD_2026_06_02,
      now: () => new Date('2026-08-12T08:00:00.000Z')
    })

    const baseline = await watcher.run('trace-baseline')
    expect(baseline).toMatchObject({ checkedSources: 1, changedSources: 0, failedSources: 0 })
    expect(store.rateCardVersions).toHaveLength(1)
    expect(store.snapshots).toHaveLength(1)
    expect(store.reviews).toHaveLength(0)

    body = 'scheme page v2'
    const changed = await watcher.run('trace-change')
    expect(changed).toMatchObject({ checkedSources: 1, changedSources: 1, failedSources: 0, notificationFailures: 0 })
    expect(store.snapshots).toHaveLength(2)
    expect(store.reviews).toHaveLength(1)
    expect(store.reviews[0]?.changes).toContainEqual(expect.objectContaining({ path: 'upstream.content' }))
    expect(store.reviews[0]).toMatchObject({
      sourceName: SOURCE.name,
      classification: 'High',
      status: 'notified',
      notifyAudiences: ['Finance', 'Compliance'],
      financeTicketId: 'TKT-1',
      complianceTicketId: 'TKT-2'
    })
    expect(tickets.map((ticket) => ticket.team)).toEqual(['finance', 'compliance'])
    expect(audit.events).toContainEqual(expect.objectContaining({
      event_type: 'billing_rate_card_upstream_change_detected',
      acting_principal: 'system:billing-rate-card-watcher',
      request_trace_id: 'trace-change',
      // CODE-03: the watcher issues no HTTP response, so it records the declared non-HTTP sentinel
      // rather than a 202 nobody received.
      response_status: SYSTEM_ACTOR_RESPONSE_STATUS,
      scope_used: SYSTEM_ACTOR_SCOPE
    }))

    const unchanged = await watcher.run('trace-repeat')
    expect(unchanged.changedSources).toBe(0)
    expect(store.snapshots).toHaveLength(2)
    expect(store.reviews).toHaveLength(1)
    expect(tickets).toHaveLength(2)

    body = 'scheme page v1'
    const reverted = await watcher.run('trace-revert')
    expect(reverted.changedSources).toBe(1)
    expect(store.snapshots).toHaveLength(3)
    expect(store.reviews).toHaveLength(2)
  })

  it('retries only the missing recipient after a partial notification failure', async () => {
    const store = new InMemoryBillingRateCardStore()
    const audit = new InMemoryHighClassAuditSink()
    let body = 'before'
    let failCompliance = true
    const fetcher = { fetchSource: vi.fn(async () => ({ body, httpStatus: 200, etag: null, lastModified: null })) }
    const attempts: string[] = []
    const itsm = {
      createTicket: vi.fn(async (input: { team: string }) => {
        attempts.push(input.team)
        if (input.team === 'compliance' && failCompliance) throw new Error('temporary ITSM outage')
        return { ticket_id: `TKT-${input.team}-${attempts.length}` }
      })
    }
    const watcher = new BillingRateCardWatcher({ store, audit, itsm, fetcher, sources: [SOURCE], rateCard: SCHEME_RATE_CARD_2026_06_02 })

    await watcher.run('trace-baseline')
    body = 'after'
    const partial = await watcher.run('trace-partial')
    expect(partial.notificationFailures).toBe(1)
    expect(store.reviews[0]).toMatchObject({ status: 'notification_pending', financeTicketId: 'TKT-finance-1', complianceTicketId: null })

    failCompliance = false
    const retried = await watcher.run('trace-retry')
    expect(retried.notificationFailures).toBe(0)
    expect(store.reviews[0]).toMatchObject({ status: 'notified', financeTicketId: 'TKT-finance-1' })
    expect(store.reviews[0]?.complianceTicketId).toMatch(/^TKT-compliance-/)
    expect(attempts).toEqual(['finance', 'compliance', 'compliance'])
  })

  it('continues other sources when one fetch fails and retries it on the next run', async () => {
    const sources = [SOURCE, { name: 'Nebras endpoint pricing', url: 'https://nebras.example/pricing/endpoints/' }]
    const store = new InMemoryBillingRateCardStore()
    const audit = new InMemoryHighClassAuditSink()
    let firstFails = true
    const fetcher = {
      fetchSource: vi.fn(async (source: BillingRateCardWatchSource) => {
        if (source === SOURCE && firstFails) throw new Error('upstream timeout')
        return { body: `content:${source.url}`, httpStatus: 200, etag: null, lastModified: null }
      })
    }
    const watcher = new BillingRateCardWatcher({
      store,
      audit,
      itsm: { createTicket: vi.fn(async () => ({ ticket_id: 'unused' })) },
      fetcher,
      sources,
      rateCard: SCHEME_RATE_CARD_2026_06_02
    })

    const first = await watcher.run('trace-failure')
    expect(first).toMatchObject({ checkedSources: 1, failedSources: 1 })
    expect(store.snapshots).toHaveLength(1)
    expect(audit.events).toContainEqual(expect.objectContaining({ event_type: 'billing_rate_card_watch_failed', response_status: SYSTEM_ACTOR_RESPONSE_STATUS }))

    firstFails = false
    const second = await watcher.run('trace-recovered')
    expect(second).toMatchObject({ checkedSources: 2, failedSources: 0, changedSources: 0 })
    expect(store.snapshots).toHaveLength(2)
  })
})

describe('HttpRateCardSourceFetcher', () => {
  it('captures source metadata and fails closed on non-success responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('pricing-v1', {
      status: 200,
      headers: { etag: '"abc"', 'last-modified': 'Tue, 11 Aug 2026 08:00:00 GMT' }
    }))
    const fetcher = new HttpRateCardSourceFetcher(fetchImpl)

    await expect(fetcher.fetchSource(SOURCE)).resolves.toEqual({
      body: 'pricing-v1',
      httpStatus: 200,
      etag: '"abc"',
      lastModified: 'Tue, 11 Aug 2026 08:00:00 GMT'
    })

    fetchImpl.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    await expect(fetcher.fetchSource(SOURCE)).rejects.toThrow(/503/)
  })
})

describe('runBillingRateCardWatch', () => {
  it('closes scheduled-run resources when fetching fails', async () => {
    const store = Object.assign(new InMemoryBillingRateCardStore(), { close: vi.fn(async () => undefined) })
    const audit = Object.assign(new InMemoryHighClassAuditSink(), { close: vi.fn(async () => undefined) })

    const result = await runBillingRateCardWatch({
      databaseUrl: 'postgres://unused',
      tenancy: { bankId: 'bank-a', channel: 'internal_retail' },
      makeStore: () => store,
      makeAudit: () => audit,
      itsm: { createTicket: vi.fn(async () => ({ ticket_id: 'unused' })) },
      fetcher: { fetchSource: vi.fn(async () => { throw new Error('timeout') }) },
      sources: [SOURCE],
      rateCard: SCHEME_RATE_CARD_2026_06_02
    }, 'trace-scheduled')

    expect(result.failedSources).toBe(1)
    expect(store.close).toHaveBeenCalledOnce()
    expect(audit.close).toHaveBeenCalledOnce()
  })
})
