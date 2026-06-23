import { buildCatalog, type McpTool } from './catalog.js'
import { classify, SpendGuard, toPendingApproval, type PendingApproval } from './governance.js'

/**
 * ADR 0017 — the MCP gateway is a PURE CONTRACT CLIENT. It maps the agent's tool
 * calls onto BFF requests, attaches the agent's identity + trace + idempotency, and
 * surfaces four-eyes 202s as pending approvals. It enforces nothing the BFF doesn't
 * also enforce — auth, RBAC, four-eyes, audit, and lineage all stay BFF-side. If this
 * gateway is ever the only thing standing between an agent and an operation, that's a bug.
 *
 * Spike scope: in-process / fetch-injected dispatch, no transport wired, not in the
 * deploy pipeline. See README.md.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface GatewaySession {
  /** Agent identity (DCR-registered service account — BACKOFFICE-60). Used as the bearer. */
  agentToken: string
  /** Minted scopes — a STRICT SUBSET of a human persona (never platform:superadmin). */
  scopes: readonly string[]
  /** Stable session id for tracing + spend accounting. */
  sessionId: string
}

export interface GatewayConfig {
  baseUrl: string
  session: GatewaySession
  /** Read-only until BACKOFFICE-53 spend-control is built (ADR 0017). Default false. */
  allowMutations?: boolean
  /** Per-session consequential-operation budget (BACKOFFICE-53). Default 0 → no mutations. */
  spendBudget?: number
  /** Fires when the session spend budget is exhausted — wire to a Risk signal + ITSM ticket. */
  onSpendExhausted?: (used: number, budget: number) => void
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: FetchLike
}

export type ToolResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: unknown }
  | { ok: true; status: 202; pendingApproval: PendingApproval }

function newTraceId(): string {
  return crypto.randomUUID()
}

function substitutePath(path: string, args: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = args[name]
    if (v === undefined || v === null) throw new Error(`Missing required path parameter: ${name}`)
    return encodeURIComponent(String(v))
  })
}

function buildQuery(query: unknown): string {
  if (!query || typeof query !== 'object') return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export class McpGateway {
  private readonly tools: Map<string, McpTool>
  private readonly fetchImpl: FetchLike
  private readonly spend: SpendGuard

  constructor(private readonly config: GatewayConfig) {
    const catalog = buildCatalog({
      scopes: config.session.scopes,
      allowMutations: config.allowMutations ?? false
    })
    this.tools = new Map(catalog.map((t) => [t.name, t]))
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init))
    this.spend = new SpendGuard(config.spendBudget ?? 0, config.onSpendExhausted)
  }

  /** MCP `tools/list` — the scope-filtered, policy-filtered catalogue for this agent. */
  listTools(): McpTool[] {
    return [...this.tools.values()]
  }

  /** MCP `tools/call` — dispatch one tool to the BFF under the agent's identity. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      // Not in the agent's catalogue → not authorised to even attempt it.
      return { ok: false, status: 403, error: { code: 'TOOL_NOT_AVAILABLE', message: `No tool \`${name}\` in this agent's scope-filtered catalogue.` } }
    }

    const route = tool._route
    // Pre-flight spend reservation (BFF re-asserts; this only bounds attempts).
    if (classify(route) !== 'read') this.spend.consume(route)

    const traceId = newTraceId()
    const url = this.config.baseUrl.replace(/\/$/, '') + substitutePath(route.path, args) + (route.method === 'get' ? buildQuery(args.query) : '')

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.session.agentToken}`,
      'x-fapi-interaction-id': traceId,
      accept: 'application/json'
    }
    const init: RequestInit = { method: route.method.toUpperCase(), headers }
    if (route.method !== 'get') {
      headers['content-type'] = 'application/json'
      // Agents retry — idempotency is mandatory on mutating calls (CLAUDE.md).
      headers['idempotency-key'] = `${this.config.session.sessionId}:${name}:${traceId}`
      init.body = JSON.stringify(args.body ?? {})
    }

    const res = await this.fetchImpl(url, init)
    const payload = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: unknown }

    // Four-eyes: never auto-approve. Surface the pending approval and stop.
    if (res.status === 202 && payload.data) {
      return { ok: true, status: 202, pendingApproval: toPendingApproval(payload.data) }
    }
    if (res.status >= 400) {
      return { ok: false, status: res.status, error: payload.error ?? payload }
    }
    return { ok: true, status: res.status, data: payload.data ?? payload }
  }

  /** Remaining consequential-operation budget for this session (BACKOFFICE-53). */
  get remainingBudget(): number {
    return this.spend.remaining
  }
}
