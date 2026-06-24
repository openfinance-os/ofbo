import { createApp } from '@ofbo/bff'
import { McpGateway, type FetchLike } from './gateway.js'
import { runStdioServer } from './stdio.js'
import { fetchAgentRegistration, mintAgentSession, sessionFromRegistration } from './registry.js'
import { InMemoryAgentAnomalySink } from './anomaly.js'

/**
 * Registry-driven OFBO demo MCP server (ADR 0017) — the agent-first loop, self-contained.
 *
 * Instead of a hardcoded persona, the gateway adopts a DCR-registered, four-eyes-APPROVED
 * agent's identity from the BFF registry. This server proves the whole loop in-process:
 *   1. register an agent (platform-admin) → 202 + approval_request,
 *   2. a DIFFERENT principal (platform-super-admin) approves it → the credential is issued,
 *   3. the gateway looks the agent up in the registry and adopts EXACTLY its bound scopes,
 *      allow_mutations, and spend_budget.
 * In production steps 1–2 happen in the portal and the agent presents its DCR credential;
 * here everything runs against the in-process demo BFF (synthetic data, zero PII).
 */
const app = createApp()
const inProcessFetch: FetchLike = (url, init) => Promise.resolve(app.request(url, init))

const ADMIN = 'demo-token:platform-admin' // platform:agents:read + :write
const persona = process.env.OFBO_AGENT_PERSONA ?? 'care-readonly-agent'

async function call(path: string, init: RequestInit): Promise<{ status: number; data: unknown }> {
  const res = await inProcessFetch(path, init)
  const body = (await res.json().catch(() => ({}))) as { data?: unknown }
  return { status: res.status, data: body.data }
}

/** Register an agent (four-eyes) and approve it with a second principal → active registration. */
async function registerAndApprove(): Promise<string> {
  const reg = await call('/back-office/agents:register', {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'x-fapi-interaction-id': crypto.randomUUID(), 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
    body: JSON.stringify({ persona, display_name: 'Registry-driven demo agent' })
  })
  if (reg.status !== 202) throw new Error(`register failed (HTTP ${reg.status})`)
  const approvalId = (reg.data as { approval_request_id: string }).approval_request_id

  const appr = await call(`/approvals/${encodeURIComponent(approvalId)}:approve`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer demo-token:platform-super-admin',
      'x-fapi-interaction-id': crypto.randomUUID(),
      'idempotency-key': crypto.randomUUID(),
      'x-superadmin-justification': 'approving the registry-driven demo agent registration (ADR 0017 loop demo)',
      'content-type': 'application/json'
    }
  })
  if (appr.status !== 200) throw new Error(`approve failed (HTTP ${appr.status})`)
  return (appr.data as { execution_result: { agent_id: string } }).execution_result.agent_id
}

const agentId = await registerAndApprove()

// Look the approved agent up in the registry and adopt its bound identity.
const reg = await fetchAgentRegistration({ baseUrl: '', adminToken: ADMIN, agentId, fetchImpl: inProcessFetch })
// ADR 0018 — mint a short-lived, server-verified agent SESSION token (token-exchange). The
// gateway presents THIS as its bearer (not a borrowed human token), so the BFF sees the real
// (agent_id, session_id) and re-asserts spend-control. In production the agent presents its
// DCR client credential (Option 1) instead — same seam.
const minted = await mintAgentSession({ baseUrl: '', adminToken: ADMIN, agentId, fetchImpl: inProcessFetch })
const { session, allowMutations, spendBudget } = sessionFromRegistration(reg, {
  sessionId: minted.session_id,
  agentToken: minted.session_token
})

const gateway = new McpGateway({
  baseUrl: '',
  session,
  allowMutations,
  spendBudget,
  anomalySink: new InMemoryAgentAnomalySink(),
  fetchImpl: inProcessFetch
})

process.stderr.write(
  `[ofbo-mcp-gateway] registry-driven ready — agent=${reg.agent_id} persona=${reg.persona} (⊂ ${reg.derived_from}) ` +
    `scopes=[${reg.scopes.join(', ')}] mutations=${allowMutations} budget=${spendBudget}; tools=${gateway.listTools().length}\n`
)

await runStdioServer(gateway)
