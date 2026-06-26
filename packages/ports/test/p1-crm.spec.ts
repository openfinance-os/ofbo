import { describe, expect, it } from 'vitest'
import {
  CrmCareSurfaceAdapter,
  crmCareFromEnv,
  CrmCareConfigError,
  type CrmHttp,
  type CrmCareConfig
} from '../src/adapters/enterprise/p1-crm.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

function fakeCrm(status = 200, json: unknown = { id: 'rec-1', recording_url: 'https://cc.example/r/1' }) {
  const calls: { path: string }[] = []
  const crm: CrmHttp = {
    async get(path) {
      calls.push({ path })
      return { status, json }
    }
  }
  return { crm, calls }
}

const adapter = (crm: CrmHttp, over: Partial<CrmCareConfig> = {}) =>
  new CrmCareSurfaceAdapter({ vendor: 'salesforce', signingKey: 'synthetic-care-signing-key-0123456789abcd', crm, ...over })

describe('P1 CRM care surface — mintCareToken (the contract)', () => {
  it('mints a signed token carrying act + sub with ≤15-min expiry', async () => {
    const t = await adapter(fakeCrm().crm).mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)
    expect(t.act).toBe('agent-001')
    expect(t.sub).toBe('psu-001')
    expect(t.token).toMatch(/^care-token\./)
    expect(new Date(t.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
  })

  it('binds the identity into the signature (different psu → different token)', async () => {
    const a = adapter(fakeCrm().crm)
    const t1 = await a.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)
    const t2 = await a.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-002' }, trace)
    expect(t1.token).not.toBe(t2.token)
  })
})

describe('P1 CRM care surface — resolveCallRecording (links, never copies)', () => {
  it('returns a short-lived locator for a recording on file (Salesforce path)', async () => {
    const { crm, calls } = fakeCrm()
    const r = await adapter(crm).resolveCallRecording({ call_id: 'VC-1' }, trace)
    expect(calls[0]!.path).toContain('/sobjects/VoiceCall/VC-1')
    expect(r).not.toBeNull()
    expect(r!.recording_ref).toBe('rec-1')
    expect(r!.recording_url).toBe('https://cc.example/r/1')
  })

  it('uses the Dynamics path when configured', async () => {
    const { crm, calls } = fakeCrm()
    await adapter(crm, { vendor: 'dynamics' }).resolveCallRecording({ call_id: 'VC-9' }, trace)
    expect(calls[0]!.path).toContain('/voicecalls(VC-9)')
  })

  it('returns null for an empty call id (no lookup) and for a 404 (nothing on file)', async () => {
    const { crm, calls } = fakeCrm()
    expect(await adapter(crm).resolveCallRecording({ call_id: '' }, trace)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await adapter(fakeCrm(404, {}).crm).resolveCallRecording({ call_id: 'VC-x' }, trace)).toBeNull()
  })

  it('returns a null url when the CRM has the call but no recording link', async () => {
    const r = await adapter(fakeCrm(200, { id: 'rec-2' }).crm).resolveCallRecording({ call_id: 'VC-2' }, trace)
    expect(r!.recording_ref).toBe('rec-2')
    expect(r!.recording_url).toBeNull()
  })

  it('throws on a non-2xx/404 CRM error', async () => {
    await expect(adapter(fakeCrm(500, {}).crm).resolveCallRecording({ call_id: 'VC-3' }, trace)).rejects.toThrow(/HTTP 500/)
  })
})

describe('P1 CRM care surface — config', () => {
  const baseEnv = {
    P1_CRM_BASE_URL: 'https://acme.my.salesforce.com',
    P1_CRM_AUTH: 'Bearer sf',
    P1_CARE_TOKEN_SIGNING_KEY: 'synthetic-care-signing-key-0123456789abcd'
  }
  it('throws a clear config error on missing url/auth/key, a weak key, or a bad vendor', () => {
    expect(() => crmCareFromEnv({})).toThrow(CrmCareConfigError)
    expect(() => crmCareFromEnv({ P1_CRM_BASE_URL: 'https://x' })).toThrow(/AUTH/)
    expect(() => crmCareFromEnv({ ...baseEnv, P1_CARE_TOKEN_SIGNING_KEY: 'short' })).toThrow(/32/)
    expect(() => crmCareFromEnv({ ...baseEnv, P1_CRM_VENDOR: 'sap' })).toThrow(/salesforce.*dynamics/)
  })
  it('constructs from a complete config', () => {
    expect(crmCareFromEnv(baseEnv)).toBeInstanceOf(CrmCareSurfaceAdapter)
  })
})
