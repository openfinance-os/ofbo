/**
 * Runnable MCP stdio server entry (ADR 0017 step 1).
 *
 *   BFF_URL=https://ofbo-bff.example \
 *   AGENT_TOKEN=<bearer minted by the IdP (P2) for the agent persona> \
 *   AGENT_PERSONA=care-readonly-agent \
 *   node services/mcp-gateway/src/bin.ts
 *
 * Read-only by construction: the persona's `allowMutations`/`spendBudget` come from the
 * AGENT_PERSONAS catalogue (all read-only today). Mutations require BACKOFFICE-53 + a
 * human raising the persona's budget — never an env override here.
 */
import { McpGateway } from './gateway.js'
import { runStdioServer } from './stdio.js'
import { AGENT_PERSONAS, type AgentPersonaId } from './agent-personas.js'
import { InMemoryAgentAnomalySink } from './anomaly.js'

async function main(): Promise<void> {
  const baseUrl = required('BFF_URL')
  const agentToken = required('AGENT_TOKEN')
  const personaId = required('AGENT_PERSONA') as AgentPersonaId
  const persona = AGENT_PERSONAS[personaId]
  if (!persona) {
    throw new Error(`Unknown AGENT_PERSONA '${personaId}'. Known: ${Object.keys(AGENT_PERSONAS).join(', ')}`)
  }

  const gateway = new McpGateway({
    baseUrl,
    session: { agentToken, scopes: persona.scopes, sessionId: crypto.randomUUID(), personaId: persona.id },
    allowMutations: persona.allowMutations,
    spendBudget: persona.spendBudget,
    anomalySink: new InMemoryAgentAnomalySink()
  })

  await runStdioServer(gateway)
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

main().catch((err) => {
  console.error('[ofbo-mcp-gateway]', err instanceof Error ? err.message : err)
  process.exit(1)
})
