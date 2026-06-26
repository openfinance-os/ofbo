import { describe, expect, it, vi } from 'vitest'
import {
  createServiceNowItsmAdapter,
  serviceNowItsmFromEnv,
  ServiceNowItsmError
} from '../src/adapters/enterprise/servicenow-itsm.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

/** Captures the request the adapter would send to a real ServiceNow Table API and
 *  returns a canned ServiceNow response — the rung-② sandbox harness (no tenant). */
function fakeTransport(response: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(response.body ?? { result: { number: 'INC0042001', sys_id: 'sys-1' } }), {
      status: response.status ?? 201,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('ServiceNow P3 adapter — request mapping (real path, faked transport)', () => {
  it('POSTs to the configured instance + table with the bearer token and trace header', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createServiceNowItsmAdapter({
      instanceUrl: 'https://acme.service-now.com',
      table: 'incident',
      getToken: async () => 'tok-123',
      fetchImpl
    })

    const r = await adapter.createTicket({ type: 'liability_threshold', severity: 'high', team: 'risk_compliance', summary: 'Liability threshold crossed' }, trace)

    expect(r.ticket_id).toBe('INC0042001')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://acme.service-now.com/api/now/table/incident')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok-123')
    expect(headers['x-fapi-interaction-id']).toBe(trace.trace_id)
  })

  it('maps severity → ServiceNow urgency/impact and routes team → assignment_group', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createServiceNowItsmAdapter({
      instanceUrl: 'https://acme.service-now.com',
      getToken: async () => 't',
      assignmentGroups: { risk_compliance: 'sys-grp-risk', payment_operations: 'sys-grp-payops' },
      fetchImpl
    })

    await adapter.createTicket({ type: 'fraud_revoke', severity: 'critical', team: 'risk_compliance', summary: 's' }, trace)
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      short_description: 's',
      category: 'fraud_revoke',
      urgency: 1, // critical → High urgency
      impact: 1, // critical → High impact
      assignment_group: 'sys-grp-risk'
    })
  })

  it('falls back to the raw team key when no assignment-group mapping exists (routing never dropped)', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createServiceNowItsmAdapter({ instanceUrl: 'https://acme.service-now.com', getToken: async () => 't', fetchImpl })
    await adapter.createTicket({ type: 't', severity: 'low', team: 'it_support', summary: 's' }, trace)
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body.assignment_group).toBe('it_support')
    expect(body).toMatchObject({ urgency: 3, impact: 3 }) // low → Low/Low
  })

  it('throws a retryable ServiceNowItsmError on 5xx, non-retryable on 4xx', async () => {
    const adapter5 = createServiceNowItsmAdapter({ instanceUrl: 'https://x.service-now.com', getToken: async () => 't', fetchImpl: fakeTransport({ status: 503 }).fetchImpl })
    await expect(adapter5.createTicket({ type: 't', severity: 'high', team: 'it_support', summary: 's' }, trace)).rejects.toMatchObject({ name: 'ServiceNowItsmError', retryable: true, status: 503 })

    const adapter4 = createServiceNowItsmAdapter({ instanceUrl: 'https://x.service-now.com', getToken: async () => 't', fetchImpl: fakeTransport({ status: 400 }).fetchImpl })
    await expect(adapter4.createTicket({ type: 't', severity: 'high', team: 'it_support', summary: 's' }, trace)).rejects.toMatchObject({ name: 'ServiceNowItsmError', retryable: false, status: 400 })
  })

  it('requires an OAuth token provider (no anonymous writes) — throws at construction', () => {
    expect(() => createServiceNowItsmAdapter({ instanceUrl: 'https://x.service-now.com' })).toThrow(ServiceNowItsmError)
  })
})

describe('ServiceNow P3 adapter — fail-closed (no silent fake under enterprise)', () => {
  it('createServiceNowItsmAdapter() throws without an instanceUrl', () => {
    expect(() => createServiceNowItsmAdapter()).toThrow(ServiceNowItsmError)
  })

  it('serviceNowItsmFromEnv throws when SERVICENOW_INSTANCE_URL / BEARER are unset', () => {
    expect(() => serviceNowItsmFromEnv({})).toThrow(/misconfigured/)
    expect(() => serviceNowItsmFromEnv({ SERVICENOW_INSTANCE_URL: 'https://x.service-now.com' })).toThrow(/misconfigured/)
  })

  const ENV = { SERVICENOW_INSTANCE_URL: 'https://x.service-now.com', SERVICENOW_BEARER_TOKEN: 't' }
  it('serviceNowItsmFromEnv parses the assignment-group routing map from env (surfaces malformed JSON)', () => {
    expect(() => serviceNowItsmFromEnv({ ...ENV, SERVICENOW_ASSIGNMENT_GROUPS: JSON.stringify({ risk_compliance: 'grp-9' }) })).not.toThrow()
    expect(() => serviceNowItsmFromEnv({ ...ENV, SERVICENOW_ASSIGNMENT_GROUPS: '{not-json' })).toThrow()
  })
})
