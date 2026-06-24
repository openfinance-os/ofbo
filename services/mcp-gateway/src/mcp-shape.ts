import type { McpGateway, ToolResult } from './gateway.js'
import type { McpTool } from './catalog.js'

/**
 * Shared MCP wire-shaping for the transports (server.ts JSON-RPC + stdio.ts SDK), so the
 * tool-list projection and the tool-call result envelope live in ONE place — a change to
 * either shape can't drift between the two entry points.
 */
export function toMcpToolList(gateway: McpGateway): Array<{ name: string; description: string; inputSchema: McpTool['inputSchema'] }> {
  return gateway.listTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

export function toMcpCallContent(result: ToolResult): { isError: boolean; content: Array<{ type: 'text'; text: string }> } {
  return { isError: result.ok === false, content: [{ type: 'text', text: JSON.stringify(result) }] }
}
