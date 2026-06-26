import type { ItsmPort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P3 — ServiceNow ITSM enterprise adapter (pre-staged per ADR 0023, fidelity rung ③).
 *
 * Implements EXACTLY the P3 port contract (`ItsmPort.createTicket`) — nothing more.
 * ServiceNow exposes hundreds of tables and APIs; the adapter surface is the port,
 * full stop (ADR 0023 guardrail 1). Everything bank-specific — instance URL, OAuth,
 * the incident table, team→assignment-group routing — is configuration (guardrail 3),
 * supplied via the Bank Profile / environment, never hardcoded.
 *
 * Transport is injectable (`fetchImpl`) so the port-contract suite and unit tests bind
 * a fake ServiceNow with no tenant (guardrail 4 / rung ②). When no instance URL is
 * configured the adapter routes to an in-memory fake Table API that runs the SAME
 * request-build → POST → response-parse path — so the contract exercises real adapter
 * logic, not a shortcut. The final tenant/OAuth/residency mile is the M6 swap (rung ④).
 */

/** OFBO's port-level severity, mapped to ServiceNow urgency+impact (1=High,2=Medium,3=Low),
 *  from which ServiceNow derives `priority` via its matrix. */
const SEVERITY_MATRIX: Record<
  'low' | 'medium' | 'high' | 'critical',
  { urgency: 1 | 2 | 3; impact: 1 | 2 | 3 }
> = {
  critical: { urgency: 1, impact: 1 },
  high: { urgency: 1, impact: 2 },
  medium: { urgency: 2, impact: 2 },
  low: { urgency: 3, impact: 3 }
}

export interface ServiceNowConfig {
  /** Bank Profile — instance base, e.g. `https://acme.service-now.com`. When unset the
   *  adapter binds the in-memory fake Table API (contract/unit context, no tenant). */
  instanceUrl?: string
  /** Bank Profile — table to create records in (default `incident`). */
  table?: string
  /** Bank Profile — OAuth bearer provider. The adapter never holds static credentials:
   *  the bank wires its connected-app / client-credentials flow here. Required once
   *  `instanceUrl` is set; unused on the fake path. trace lets the provider correlate. */
  getToken?: (trace: TraceContext) => Promise<string>
  /** Bank Profile — OFBO team key → ServiceNow `assignment_group` (sys_id or name).
   *  Teams per PRD §3 P3: `risk_compliance`, `it_support`, `payment_operations`.
   *  An unmapped team falls back to its raw key so routing is never silently dropped. */
  assignmentGroups?: Record<string, string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

/** Thrown when ServiceNow returns a non-2xx. `retryable` on 429/5xx so the caller
 *  (ticketing is best-effort, often retried off the ITSM fallback channel) can back off.
 *  Mirrors the P6 `NebrasEgressError` shape for a consistent adapter error contract. */
export class ServiceNowItsmError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'ServiceNowItsmError'
  }
}

const FAKE_BASE = 'https://fake.service-now.invalid'

/** Deterministic in-memory ServiceNow Table API — used when no `instanceUrl` is
 *  configured. Validates the request shape and returns a canned `result` exactly as
 *  ServiceNow's REST Table API does, so the adapter's real mapping + parsing run in
 *  tests without a tenant. Deterministic incident numbers (counter) for repeatable runs. */
let fakeSeq = 0
const fakeServiceNowFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
  if (!/\/api\/now\/table\//.test(url) || (init?.method ?? 'GET') !== 'POST' || !body.short_description) {
    return new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })
  }
  const number = `INC${String(++fakeSeq).padStart(7, '0')}`
  return new Response(JSON.stringify({ result: { ...body, number, sys_id: `sys-${number}` } }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  })
}

export function createServiceNowItsmAdapter(config: ServiceNowConfig = {}): ItsmPort {
  const real = Boolean(config.instanceUrl)
  const base = config.instanceUrl ?? FAKE_BASE
  const table = config.table ?? 'incident'
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeServiceNowFetch)

  const resolveGroup = (team: string): string => config.assignmentGroups?.[team] ?? team

  return {
    async createTicket({ type, severity, team, summary }, trace) {
      const { urgency, impact } = SEVERITY_MATRIX[severity]
      const payload = {
        short_description: summary,
        category: type,
        urgency,
        impact,
        assignment_group: resolveGroup(team)
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        // CLAUDE.md: x-fapi-interaction-id propagated end-to-end for trace correlation.
        'x-fapi-interaction-id': trace.trace_id
      }
      if (real) {
        if (!config.getToken) {
          throw new ServiceNowItsmError(0, false, 'ServiceNow getToken (OAuth provider) is required when instanceUrl is set')
        }
        headers.authorization = `Bearer ${await config.getToken(trace)}`
      }

      const res = await doFetch(`${base}/api/now/table/${encodeURIComponent(table)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        throw new ServiceNowItsmError(res.status, res.status === 429 || res.status >= 500, `ServiceNow create ticket → ${res.status}`)
      }
      const data = (await res.json()) as { result?: { number?: string; sys_id?: string } }
      const ticket_id = data.result?.number ?? data.result?.sys_id
      if (!ticket_id) throw new ServiceNowItsmError(res.status, false, 'ServiceNow response missing result.number/sys_id')
      return { ticket_id }
    }
  }
}

/** Build the adapter from the Bank Profile in the environment. With no
 *  SERVICENOW_INSTANCE_URL this binds the fake Table API (contract/test context).
 *  The real OAuth client-credentials / connected-app flow is wired at the M6 sandbox
 *  swap; SERVICENOW_BEARER_TOKEN is a rung-② stand-in for that provider. */
export function serviceNowItsmFromEnv(env: NodeJS.ProcessEnv = process.env): ItsmPort {
  let assignmentGroups: Record<string, string> | undefined
  if (env.SERVICENOW_ASSIGNMENT_GROUPS) {
    assignmentGroups = JSON.parse(env.SERVICENOW_ASSIGNMENT_GROUPS) as Record<string, string>
  }
  const bearer = env.SERVICENOW_BEARER_TOKEN
  return createServiceNowItsmAdapter({
    instanceUrl: env.SERVICENOW_INSTANCE_URL,
    table: env.SERVICENOW_TABLE,
    assignmentGroups,
    getToken: bearer ? async () => bearer : undefined
  })
}
