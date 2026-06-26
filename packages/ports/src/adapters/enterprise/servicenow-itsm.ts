import type { ItsmPort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P3 — ServiceNow ITSM enterprise adapter (pre-staged per ADR 0024, fidelity rung ③).
 *
 * Implements EXACTLY the P3 port contract (`ItsmPort.createTicket`) — nothing more.
 * ServiceNow exposes hundreds of tables and APIs; the adapter surface is the port,
 * full stop (ADR 0024 guardrail 1). Everything bank-specific — instance URL, OAuth,
 * the incident table, team→assignment-group routing — is configuration (guardrail 3),
 * supplied via the Bank Profile / environment, never hardcoded.
 *
 * FAIL-CLOSED: a configured `instanceUrl` is mandatory — an unconfigured enterprise adapter
 * throws, it never silently becomes a fake (a fake ITSM under DEPLOY_PROFILE=enterprise would
 * swallow real signals). Transport is injectable (`fetchImpl`) so unit tests bind a fake
 * ServiceNow with no tenant (guardrail 4 / rung ②), exercising the real request-build → POST →
 * response-parse path. The final tenant/OAuth/residency mile is the M6 swap (rung ④).
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
  /** Bank Profile — instance base, e.g. `https://acme.service-now.com`. Mandatory (the
   *  adapter is fail-closed; tests inject a fake `fetchImpl` against this base). */
  instanceUrl?: string
  /** Bank Profile — table to create records in (default `incident`). */
  table?: string
  /** Bank Profile — OAuth bearer provider. The adapter never holds static credentials:
   *  the bank wires its connected-app / client-credentials flow here. Required. trace lets
   *  the provider correlate. */
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

export function createServiceNowItsmAdapter(config: ServiceNowConfig = {}): ItsmPort {
  if (!config.instanceUrl) throw new ServiceNowItsmError(0, false, 'ServiceNow instanceUrl is required (fail-closed — no fake fallback under the enterprise profile)')
  if (!config.getToken) throw new ServiceNowItsmError(0, false, 'ServiceNow getToken (OAuth provider) is required')
  const getToken = config.getToken
  const base = config.instanceUrl
  const table = config.table ?? 'incident'
  const doFetch = config.fetchImpl ?? globalThis.fetch

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
        'x-fapi-interaction-id': trace.trace_id,
        authorization: `Bearer ${await getToken(trace)}`
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

/** Build the adapter from the Bank Profile in the environment. FAIL-CLOSED: throws if
 *  SERVICENOW_INSTANCE_URL / SERVICENOW_BEARER_TOKEN are absent (never a silent fake under
 *  the enterprise profile). The real OAuth client-credentials / connected-app flow is wired
 *  at the M6 sandbox swap; SERVICENOW_BEARER_TOKEN is a rung-② stand-in for that provider. */
export function serviceNowItsmFromEnv(env: NodeJS.ProcessEnv = process.env): ItsmPort {
  if (!env.SERVICENOW_INSTANCE_URL || !env.SERVICENOW_BEARER_TOKEN) {
    throw new ServiceNowItsmError(0, false, 'ServiceNow adapter misconfigured: set SERVICENOW_INSTANCE_URL and SERVICENOW_BEARER_TOKEN')
  }
  let assignmentGroups: Record<string, string> | undefined
  if (env.SERVICENOW_ASSIGNMENT_GROUPS) {
    assignmentGroups = JSON.parse(env.SERVICENOW_ASSIGNMENT_GROUPS) as Record<string, string>
  }
  const bearer = env.SERVICENOW_BEARER_TOKEN
  return createServiceNowItsmAdapter({
    instanceUrl: env.SERVICENOW_INSTANCE_URL,
    table: env.SERVICENOW_TABLE,
    assignmentGroups,
    getToken: async () => bearer
  })
}
