import { createApp } from '@ofbo/bff'
import { McpGateway, type FetchLike } from './gateway.js'
import { runStdioServer } from './stdio.js'
import { AGENT_PERSONAS } from './agent-personas.js'

/**
 * Self-contained OFBO demo MCP server (ADR 0017). Lets a Claude client (e.g. Claude
 * Code on the web) look up Back Office info — and, when explicitly enabled, revoke a
 * consent — through the agent-first interface.
 *
 * The demo-profile BFF runs IN-PROCESS (seeded synthetic data, zero PII): the gateway
 * dispatches each tool call straight to it via `app.request`, so there is NO separate
 * service to start and NO external network (the deployed demo isn't reachable from the
 * cowork sandbox). Everything stays governed by the same BFF — auth, RBAC, four-eyes,
 * and High-class audit all apply exactly as in production.
 *
 * Read-only by default. Set OFBO_DEMO_ALLOW_MUTATIONS=true to expose mutating tools
 * (e.g. single-consent revoke) — DEMO ONLY, against synthetic data.
 */
const persona = AGENT_PERSONAS['care-readonly-agent']
const allowMutations = process.env.OFBO_DEMO_ALLOW_MUTATIONS === 'true'

const app = createApp()
// Route the gateway's HTTP client to the in-process Hono app (no socket, no network).
const inProcessFetch: FetchLike = (url, init) => Promise.resolve(app.request(url, init))

const gateway = new McpGateway({
  baseUrl: '',
  session: {
    // The demo IdP (P2 sim) accepts demo-token:<persona>. We present the human persona
    // the agent is delegated from (customer-care-agent); the gateway still restricts the
    // catalogue to the agent's least-privilege subset (consents:admin + audit:read).
    agentToken: `demo-token:${persona.derivedFrom}`,
    scopes: persona.scopes,
    sessionId: crypto.randomUUID(),
    personaId: persona.id
  },
  allowMutations,
  spendBudget: allowMutations ? 25 : 0,
  fetchImpl: inProcessFetch
})

process.stderr.write(
  `[ofbo-mcp-gateway] demo ready — persona=${persona.id} mutations=${allowMutations ? 'ENABLED (demo only)' : 'read-only'}; tools=${gateway.listTools().length}\n`
)

await runStdioServer(gateway)
