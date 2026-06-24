import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpGateway } from './gateway.js'
import { toMcpToolList, toMcpCallContent } from './mcp-shape.js'

/**
 * ADR 0017 — binds the governed gateway to a real MCP stdio transport. This is the
 * boilerplate the spike deliberately deferred; the regulated logic stays in the gateway.
 * The transport is a dumb pipe: every list/call is delegated to the gateway, which is
 * the single place scope-filtering, four-eyes shaping, idempotency, and spend-control
 * live (and the BFF re-enforces all of it).
 */
export async function runStdioServer(gateway: McpGateway): Promise<void> {
  const server = new Server({ name: 'ofbo-mcp-gateway', version: '0.0.1' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toMcpToolList(gateway) }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    return toMcpCallContent(await gateway.callTool(req.params.name, args))
  })

  await server.connect(new StdioServerTransport())
}
