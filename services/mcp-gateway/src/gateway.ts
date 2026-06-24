import { buildCatalog, type McpTool } from './catalog.js'
import { classify, SpendGuard, SpendBudgetExceededError, toPendingApproval, type PendingApproval } from './governance.js'
import { spendExhaustedEvent, type AgentAnomalySink } from './anomaly.js'

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
  /** Agent persona id, for anomaly attribution (BACKOFFICE-53). */
  personaId?: string
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
  /** BACKOFFICE-53: emits an agent_anomaly Risk signal + ITSM ticket on spend exhaustion. */
  anomalySink?: AgentAnomalySink
  /** Per-request timeout (ms) so a hung BFF can't hang the MCP tools/call forever. Default 30s. */
  timeoutMs?: number
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
    if (v === undefined || v === null) continue
    // Repeat the key for arrays (?k=a&k=b) rather than stringifying to "a,b".
    if (Array.isArray(v)) {
      for (const item of v) if (item !== undefined && item !== null) params.append(k, String(item))
    } else {
      params.append(k, String(v))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Stable FNV-1a hash of a canonical (key-sorted) JSON — for a retry-stable Idempotency-Key. */
function stableHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
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
    this.spend = new SpendGuard(config.spendBudget ?? 0, (used, budget) => {
      config.onSpendExhausted?.(used, budget)
      const reported = config.anomalySink?.report(spendExhaustedEvent(config.session.personaId ?? 'unknown-agent', config.session.sessionId, used, budget))
      // The raise must never be a silent unhandled rejection (BFF/ITSM down) — surface it.
      if (reported && typeof (reported as Promise<void>).then === 'function') {
        void (reported as Promise<void>).catch((err) =>
          console.error(`[mcp-gateway] agent_anomaly raise failed: ${err instanceof Error ? err.message : String(err)}`)
        )
      }
    })
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
    const consequential = classify(route) !== 'read'

    // Pre-flight gate: block (without consuming) when the budget is exhausted. Return a
    // structured result the agent can act on — never throw past the MCP transport.
    if (consequential) {
      try {
        this.spend.check(route)
      } catch (e) {
        if (e instanceof SpendBudgetExceededError) {
          return {
            ok: false,
            status: 429,
            error: { code: 'SPEND_BUDGET_EXCEEDED', message: e.message, remediation: 'Escalate to a human principal; this agent session has spent its operation budget (BACKOFFICE-53).' }
          }
        }
        throw e
      }
    }

    const traceId = newTraceId()
    const url = this.config.baseUrl.replace(/\/$/, '') + substitutePath(route.path, args) + buildQuery(args.query)

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.session.agentToken}`,
      'x-fapi-interaction-id': traceId,
      accept: 'application/json'
    }
    const init: RequestInit = { method: route.method.toUpperCase(), headers, signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000) }
    if (route.method !== 'get') {
      headers['content-type'] = 'application/json'
      // Idempotency-Key (CLAUDE.md): derived from (session, tool, args) so a RETRIED
      // identical call carries the SAME key and the BFF dedupes it within the 24h window.
      // The trace id stays fresh per attempt; it must NOT be part of the idempotency key.
      headers['idempotency-key'] = `${this.config.session.sessionId}:${name}:${stableHash(args.body ?? {})}`
      init.body = JSON.stringify(args.body ?? {})
    }

    let res: Response
    try {
      res = await this.fetchImpl(url, init)
    } catch (e) {
      // Network failure / timeout (AbortSignal) — return a structured result, never throw past the transport.
      const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { ok: false, status: 504, error: { code: aborted ? 'BFF_TIMEOUT' : 'BFF_UNREACHABLE', message: e instanceof Error ? e.message : String(e) } }
    }
    const payload = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: unknown }

    // Four-eyes is determined by the CONTRACT (tool.fourEyes), never guessed from the
    // payload shape — so a malformed/unparseable approval can never degrade to a success.
    if (tool.fourEyes) {
      if (res.status === 202) {
        const pending = payload.data ? toPendingApproval(payload.data) : null
        if (!pending) {
          return { ok: false, status: 502, error: { code: 'MALFORMED_APPROVAL', message: 'Four-eyes operation returned 202 without a valid approval_request — refusing to treat as success.' } }
        }
        if (consequential) this.spend.commit(route) // four-eyes counts at INITIATION
        return { ok: true, status: 202, pendingApproval: pending }
      }
      if (res.status >= 400) return { ok: false, status: res.status, error: payload.error ?? payload }
      // A four-eyes op that did not return 202 is a contract violation — never assume it executed.
      return { ok: false, status: 502, error: { code: 'UNEXPECTED_FOUR_EYES_RESPONSE', message: `Four-eyes operation returned ${res.status}; expected 202 + approval_request.` } }
    }

    if (res.status >= 400) {
      // A rejected mutation does NOT burn budget (only successful consequential ops commit).
      return { ok: false, status: res.status, error: payload.error ?? payload }
    }
    if (consequential) this.spend.commit(route)
    return { ok: true, status: res.status, data: payload.data ?? payload }
  }

  /** Remaining consequential-operation budget for this session (BACKOFFICE-53). */
  get remainingBudget(): number {
    return this.spend.remaining
  }
}
