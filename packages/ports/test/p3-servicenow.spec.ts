import { describe, expect, it } from 'vitest'
import {
  ServiceNowItsmAdapter,
  serviceNowItsmFromEnv,
  ServiceNowConfigError,
  type ServiceNowHttp,
  type ServiceNowConfig
} from '../src/adapters/enterprise/p3-servicenow.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

interface Captured {
  path: string
  body: Record<string, unknown>
}

/** A fake Table API: records the request and returns a canned incident. */
function fakeHttp(status = 201, result: { number?: string; sys_id?: string } = { number: 'INC0012345', sys_id: 'sys-abc' }) {
  const calls: Captured[] = []
  const http: ServiceNowHttp = {
    async post(path, body) {
      calls.push({ path, body })
      return { status, json: { result } }
    }
  }
  return { http, calls }
}

function adapter(http: ServiceNowHttp, over: Partial<ServiceNowConfig> = {}) {
  return new ServiceNowItsmAdapter({
    instanceUrl: 'https://acme.service-now.com',
    assignmentGroupMap: { risk_compliance: 'grp-risk', operations: 'grp-ops' },
    http,
    ...over
  })
}

describe('P3 ServiceNow adapter — createTicket', () => {
  it('creates an incident and returns the ServiceNow number (the contract: ticket_id truthy)', async () => {
    const { http, calls } = fakeHttp()
    const r = await adapter(http).createTicket({ type: 'liability_threshold', severity: 'high', team: 'risk_compliance', summary: 'test' }, trace)
    expect(r.ticket_id).toBe('INC0012345')
    expect(calls[0]!.path).toBe('/api/now/table/incident')
  })

  it('maps OFBO fields → ServiceNow incident fields with the routing map + correlation id', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).createTicket({ type: 'liability_threshold', severity: 'critical', team: 'risk_compliance', summary: 'fee variance' }, trace)
    expect(calls[0]!.body).toMatchObject({
      short_description: 'fee variance',
      category: 'liability_threshold',
      urgency: 1, // critical → urgency 1
      impact: 1,
      assignment_group: 'grp-risk',
      correlation_id: trace.trace_id
    })
  })

  it('maps severities to ServiceNow urgency/impact', async () => {
    const cases: [string, number][] = [['low', 3], ['medium', 2], ['high', 2], ['critical', 1]]
    for (const [severity, urgency] of cases) {
      const { http, calls } = fakeHttp()
      await adapter(http).createTicket({ type: 't', severity: severity as 'low', team: 'operations', summary: 's' }, trace)
      expect(calls[0]!.body.urgency).toBe(urgency)
    }
  })

  it('falls back to a default assignment group, else rejects an unmapped team', async () => {
    const { http } = fakeHttp()
    await expect(adapter(http).createTicket({ type: 't', severity: 'low', team: 'unmapped', summary: 's' }, trace)).rejects.toThrow(/assignment group/)

    const withDefault = adapter(fakeHttp().http, { defaultAssignmentGroup: 'grp-fallback' })
    const r = await withDefault.createTicket({ type: 't', severity: 'low', team: 'unmapped', summary: 's' }, trace)
    expect(r.ticket_id).toBeTruthy()
  })

  it('does not let a reserved-key team resolve to an inherited prototype member', async () => {
    const { http } = fakeHttp()
    await expect(adapter(http).createTicket({ type: 't', severity: 'low', team: 'toString', summary: 's' }, trace)).rejects.toThrow(/assignment group/)
  })

  it('fails closed on a non-2xx ServiceNow response', async () => {
    const { http } = fakeHttp(403, {})
    await expect(adapter(http).createTicket({ type: 't', severity: 'low', team: 'operations', summary: 's' }, trace)).rejects.toThrow(/HTTP 403/)
  })

  it('errors when the response carries no incident number or sys_id', async () => {
    const { http } = fakeHttp(201, {})
    await expect(adapter(http).createTicket({ type: 't', severity: 'low', team: 'operations', summary: 's' }, trace)).rejects.toThrow(/missing incident/)
  })

  it('falls back to sys_id when number is absent', async () => {
    const { http } = fakeHttp(201, { sys_id: 'sys-only' })
    const r = await adapter(http).createTicket({ type: 't', severity: 'low', team: 'operations', summary: 's' }, trace)
    expect(r.ticket_id).toBe('sys-only')
  })
})

describe('P3 ServiceNow adapter — config', () => {
  const baseEnv = {
    P3_SERVICENOW_INSTANCE_URL: 'https://acme.service-now.com',
    P3_SERVICENOW_AUTH: 'Bearer token-xyz',
    P3_ASSIGNMENT_GROUP_MAP: JSON.stringify({ risk_compliance: 'grp-risk' })
  }

  it('throws a clear config error on missing/invalid env', () => {
    expect(() => serviceNowItsmFromEnv({})).toThrow(ServiceNowConfigError)
    expect(() => serviceNowItsmFromEnv({ P3_SERVICENOW_INSTANCE_URL: 'https://x' })).toThrow(/AUTH/)
    expect(() => serviceNowItsmFromEnv({ ...baseEnv, P3_ASSIGNMENT_GROUP_MAP: 'not json' })).toThrow(/ASSIGNMENT_GROUP_MAP/)
    expect(() => serviceNowItsmFromEnv({ ...baseEnv, P3_ASSIGNMENT_GROUP_MAP: JSON.stringify({ team: 123 }) })).toThrow(/ASSIGNMENT_GROUP_MAP/)
  })

  it('constructs from a complete config', () => {
    expect(serviceNowItsmFromEnv(baseEnv)).toBeInstanceOf(ServiceNowItsmAdapter)
  })
})
