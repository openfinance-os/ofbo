import { ROUTES, type Route } from '@ofbo/contracts'

/**
 * ADR 0017 — the agent tool catalogue is GENERATED from the OpenAPI contract
 * (`@ofbo/contracts` ROUTES), so the spec stays ground truth for the agent surface
 * just as it does for the portal. Each route becomes one MCP tool carrying its
 * required scope and four-eyes flag; contract drift surfaces as a catalogue diff.
 *
 * This module is PURE — it adds no auth/RBAC/approval/audit primitive. Scope is
 * filtered here only to shape the catalogue (least privilege); the BFF remains the
 * enforcement point (defence in depth, CLAUDE.md).
 */

/** Minimal MCP-tool shape (transport-agnostic; mirrors the MCP `Tool` schema). */
export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonSchema>
    required: string[]
  }
  /** Non-standard metadata the gateway uses to dispatch + govern the call. */
  _route: Route
  /** Read-only operations are safe to expose first (ADR 0017 rollout step 1). */
  readOnly: boolean
  /** True when the operation is four-eyes-gated (returns 202; agent may initiate, never approve). */
  fourEyes: boolean
}

interface JsonSchema {
  type: string
  description?: string
  additionalProperties?: boolean
}

/** Path-template tokens like `{break_id}` are required string inputs. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)
}

/**
 * Deterministic, collision-free tool name from method + path. Path is unique per
 * method in the contract, so `method + sanitised(path)` never collides. The
 * `back-office/` prefix is dropped for readability.
 */
export function toolName(route: Route): string {
  const cleaned = route.path
    .replace(/^\/+/, '')
    .replace(/^back-office\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[/:]+/g, '_')
    .replace(/-/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return `${route.method}_${cleaned}`
}

function describe(route: Route): string {
  const kind = route.fourEyes
    ? 'FOUR-EYES: returns a pending approval — a different human principal must ratify; the agent cannot self-approve.'
    : route.method === 'get'
      ? 'Read-only.'
      : 'Mutating.'
  const scope = route.scope ? `Requires scope \`${route.scope}\`.` : 'Scope resolved at the service layer.'
  return `[${route.tag}] ${route.method.toUpperCase()} ${route.path}. ${scope} ${kind}`
}

function toTool(route: Route): McpTool {
  const params = pathParams(route.path)
  const properties: Record<string, JsonSchema> = {}
  for (const p of params) {
    properties[p] = { type: 'string', description: `Path parameter \`${p}\`.` }
  }
  if (route.method === 'get') {
    properties.query = { type: 'object', description: 'Query-string parameters (snake_case).', additionalProperties: true }
  } else {
    properties.body = { type: 'object', description: 'Request body (snake_case JSON).', additionalProperties: true }
  }
  return {
    name: toolName(route),
    description: describe(route),
    inputSchema: { type: 'object', properties, required: params },
    _route: route,
    readOnly: route.method === 'get',
    fourEyes: route.fourEyes
  }
}

/** True when an agent holding `scopes` is permitted to see/call `route`. */
export function routeAllowed(route: Route, scopes: readonly string[]): boolean {
  // platform:superadmin is human-only (BACKOFFICE-80) and never minted for an agent,
  // so it is intentionally NOT treated as a wildcard here.
  if (route.scope === null) return true // dynamic scope — deferred to the service layer
  return scopes.includes(route.scope)
}

export interface CatalogOptions {
  /** Agent's minted scopes (a STRICT SUBSET of a human persona — BACKOFFICE-60). */
  scopes: readonly string[]
  /**
   * ADR 0017 rollout: mutating tools stay disabled until spend-control (BACKOFFICE-53)
   * is built. Default false → read-only catalogue.
   */
  allowMutations?: boolean
}

/** Build the scope-filtered, policy-filtered tool catalogue for one agent. */
export function buildCatalog(opts: CatalogOptions): McpTool[] {
  const allowMutations = opts.allowMutations ?? false
  return ROUTES.filter((r) => routeAllowed(r, opts.scopes))
    .filter((r) => allowMutations || r.method === 'get')
    .map(toTool)
    .sort((a, b) => a.name.localeCompare(b.name))
}
