import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryStrDraftStore, makeStrHandoffOperation } from '../src/str/service.js'
import { makeFraudRevokeOperation } from '../src/consents/fraud-revoke.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-63 — STR draft handoff (ADR 0022). Compliance hands an approved STR draft to the
 * bank's STR workflow (P10), which submits to AML GO — the Back Office never submits directly.
 * The handoff is four-eyes: Compliance (compliance:reports:generate) initiates, a Risk
 * second-line (risk:read) approves, and only then does the P10 handoff run.
 */

const idp = getAdapter('p2-identity-provider', 'demo')

const compliance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer', 'content-type': 'application/json', ...extra })
const risk = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:risk-analyst', 'content-type': 'application/json', ...extra })

function build() {
  const store = new InMemoryStrDraftStore() // no demo seed — the test controls the drafts
  const audit = new InMemoryHighClassAuditSink()
  const app = createApp({ idp, strDraftStore: store, highClassAudit: audit })
  return { app, store, audit }
}

const seedDraft = (store: InMemoryStrDraftStore) =>
  store.record({ source_consent_id: 'consent-test-1', case_context: 'velocity anomaly (synthetic)', created_by: 'demo:risk-analyst' }, 't')

describe('BACKOFFICE-63 — STR draft list/get', () => {
  it('denies list without compliance:reports:read (403)', async () => {
    const { app } = build()
    const res = await app.request('/back-office/str-drafts', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' } })
    expect(res.status).toBe(403)
  })

  it('lists drafts for Compliance and gets one by id', async () => {
    const { app, store } = build()
    const d = await seedDraft(store)
    const list = await app.request('/back-office/str-drafts', { headers: compliance() })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { data: { str_draft_id: string }[] }
    expect(body.data.some((r) => r.str_draft_id === d.str_draft_id)).toBe(true)

    const one = await app.request(`/back-office/str-drafts/${d.str_draft_id}`, { headers: compliance() })
    expect(one.status).toBe(200)
    expect(((await one.json()) as { data: { status: string } }).data.status).toBe('draft')
  })

  it('404s an unknown draft', async () => {
    const { app } = build()
    expect((await app.request('/back-office/str-drafts/9999', { headers: compliance() })).status).toBe(404)
  })
})

describe('BACKOFFICE-63 — four-eyes handoff to the STR workflow (P10)', () => {
  it('requires an Idempotency-Key on submit (400)', async () => {
    const { app, store } = build()
    const d = await seedDraft(store)
    const res = await app.request(`/back-office/str-drafts/${d.str_draft_id}:submit-to-workflow`, { method: 'POST', headers: compliance() })
    expect(res.status).toBe(400)
  })

  it('Compliance initiates (202), a Risk second-line approves, and the draft is handed off with a workflow ref', async () => {
    const { app, store, audit } = build()
    const d = await seedDraft(store)

    const submit = await app.request(`/back-office/str-drafts/${d.str_draft_id}:submit-to-workflow`, { method: 'POST', headers: compliance({ 'idempotency-key': 'str-1' }) })
    expect(submit.status).toBe(202)
    const approvalId = ((await submit.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    expect(approvalId).toBeTruthy()
    // The draft is now awaiting handoff.
    expect((await store.get(d.str_draft_id))!.status).toBe('awaiting_handoff')

    const approve = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: risk({ 'idempotency-key': 'str-appr-1' }) })
    expect(approve.status).toBe(200)

    const handed = (await store.get(d.str_draft_id))!
    expect(handed.status).toBe('handed_off')
    expect(handed.workflow_ref).toMatch(/^str-wf-/) // P10 sim reference — never an AML GO id
    expect(handed.approved_by).toBe('demo:risk-analyst')
    expect(audit.events.some((e) => e.event_type === 'str_draft_handed_off' && e.request_body && (e.request_body as { four_eyes_approved?: boolean }).four_eyes_approved === true)).toBe(true)
  })

  it('rejects submitting a draft that is not in draft status (409)', async () => {
    const { app, store } = build()
    const d = await seedDraft(store)
    await app.request(`/back-office/str-drafts/${d.str_draft_id}:submit-to-workflow`, { method: 'POST', headers: compliance({ 'idempotency-key': 'str-a' }) })
    // second submit (now awaiting_handoff) with a different key
    const again = await app.request(`/back-office/str-drafts/${d.str_draft_id}:submit-to-workflow`, { method: 'POST', headers: compliance({ 'idempotency-key': 'str-b' }) })
    expect(again.status).toBe(409)
  })

  it('the handoff operation goes ONLY to the STR workflow port — no AML GO client exists', async () => {
    // Directly exercise the four-eyes executor: the only external call is the P10 handoff.
    const store = new InMemoryStrDraftStore()
    const d = await store.record({ source_consent_id: 'c-9', case_context: 'ctx', created_by: 'demo:risk-analyst' }, 't')
    let handoffCalls = 0
    const op = makeStrHandoffOperation({
      store,
      strWorkflow: { handoffStrDraft: async ({ str_draft_id }) => { handoffCalls++; return { workflow_ref: `str-wf-${str_draft_id}`, accepted_at: '2026-06-25T00:00:00.000Z' } } },
      audit: new InMemoryHighClassAuditSink()
    })
    const out = (await op.execute({ str_draft_id: d.str_draft_id, source_consent_id: 'c-9', case_context: 'ctx', trace_id: 't' }, { approver: 'demo:risk-analyst', approverPersona: 'risk-analyst' })) as { workflow_ref: string }
    expect(handoffCalls).toBe(1)
    expect(out.workflow_ref).toMatch(/^str-wf-/)
    expect((await store.get(d.str_draft_id))!.status).toBe('handed_off')
  })
})

describe('BACKOFFICE-63 — fraud-revoke persists the STR draft (links BACKOFFICE-22)', () => {
  it('a fraud-revoke records a draft into the STR store', async () => {
    const store = new InMemoryStrDraftStore()
    const op = makeFraudRevokeOperation({
      egress: { revokeConsent: async () => ({ acknowledged_in_ms: 100 }) },
      audit: new InMemoryHighClassAuditSink(),
      strDrafts: store
    })
    const res = (await op.execute(
      { consent_id: 'consent-fraud-1', case_context: 'suspected mule account', initiated_by: 'demo:risk-analyst', initiated_by_persona: 'risk-analyst', trace_id: 't' },
      { approver: 'demo:platform-super-admin', approverPersona: 'platform-super-admin' }
    )) as { str_draft_ref: string }
    const page = await store.list({})
    const draft = page.rows.find((r) => r.source_consent_id === 'consent-fraud-1')
    expect(draft).toBeDefined()
    expect(draft!.status).toBe('draft')
    expect(res.str_draft_ref).toBe(draft!.str_draft_id) // the revoke result references the persisted draft
  })
})
