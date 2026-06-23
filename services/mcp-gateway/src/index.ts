/**
 * @ofbo/mcp-gateway — EXPERIMENTAL SPIKE (ADR 0017).
 *
 * An agent-first interface over the OFBO BFF: every OpenAPI operation becomes an MCP
 * tool, scope-filtered to the agent's least-privilege persona, read-only by default,
 * with four-eyes 202s surfaced as pending approvals the agent can never self-ratify.
 *
 * NOT in the deploy pipeline. Gated on BACKOFFICE-60 (agent identity via DCR) and
 * BACKOFFICE-53 (spend-control). See README.md and docs/adrs/0017-agent-first-mcp-gateway.md.
 */
export { buildCatalog, routeAllowed, toolName, pathParams, type McpTool, type CatalogOptions } from './catalog.js'
export {
  classify,
  isConsequential,
  SpendGuard,
  SpendBudgetExceededError,
  toPendingApproval,
  type OperationClass,
  type PendingApproval
} from './governance.js'
export { McpGateway, type GatewayConfig, type GatewaySession, type ToolResult, type FetchLike } from './gateway.js'
export { handleJsonRpc, type JsonRpcRequest, type JsonRpcResponse } from './server.js'
