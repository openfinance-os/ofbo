import type { McpGateway } from './gateway.js'
import { toMcpToolList, toMcpCallContent } from './mcp-shape.js'

/**
 * Transport-agnostic MCP dispatcher (ADR 0017 spike).
 *
 * Implements just enough of the MCP JSON-RPC surface — `initialize`, `tools/list`,
 * `tools/call` — to drive the gateway from any transport. Wiring this to a real stdio
 * server is boilerplate and intentionally left out of the spike; bind it like:
 *
 *     // server entry (requires @modelcontextprotocol/sdk):
 *     import { Server } from '@modelcontextprotocol/sdk/server/index.js'
 *     import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
 *     const gateway = new McpGateway({ baseUrl, session, allowMutations: false })
 *     // forward server requests into handleJsonRpc(gateway, req)
 *
 * The novel, regulated part of the spike is the GOVERNED MAPPING (catalog + gateway +
 * governance), not the transport — so that is what is built and tested here.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

const SERVER_INFO = { name: 'ofbo-mcp-gateway', version: '0.0.0-spike' }

export async function handleJsonRpc(gateway: McpGateway, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id }
  switch (req.method) {
    case 'initialize':
      return {
        ...base,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO }
      }
    case 'tools/list':
      return { ...base, result: { tools: toMcpToolList(gateway) } }
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      const args = (req.params?.arguments as Record<string, unknown>) ?? {}
      return { ...base, result: toMcpCallContent(await gateway.callTool(name, args)) }
    }
    default:
      return { ...base, error: { code: -32601, message: `Method not found: ${req.method}` } }
  }
}
