import type { StrWorkflowPort } from '../../interfaces.js'

/**
 * P10 — the bank's existing STR (Suspicious Transaction Report) workflow enterprise adapter
 * (pre-staged per ADR 0024, rung ③; BACKOFFICE-63).
 *
 * BOUNDARY (PRD §7.2): the Back Office NEVER submits to the CBUAE AML GO portal directly.
 * This adapter is a one-way HANDOFF to the bank's internal STR workflow, which is the system
 * of record that files with AML GO. There is no AML GO client here — the only call is the
 * handoff, and it returns the workflow's own reference for the accepted draft. No PII — the
 * draft carries an internal consent ref + case context, never PSU identifiers.
 *
 * Implements EXACTLY the P10 port contract (`handoffStrDraft`). Transport injectable;
 * fail-closed when unconfigured (tests inject a fake `fetchImpl`, exercising the real
 * call→parse path with no backend).
 */

export interface StrWorkflowConfig {
  /** Bank Profile — STR workflow REST base URL. Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
  baseUrl?: string
  /** Bank Profile — bearer provider. Required once baseUrl is set. */
  getToken?: (trace: { trace_id: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export class StrWorkflowError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'StrWorkflowError'
  }
}

export function createStrWorkflowAdapter(config: StrWorkflowConfig = {}): StrWorkflowPort {
  // FAIL-CLOSED: no silent fake under the enterprise profile — base URL + token are mandatory.
  if (!config.baseUrl) throw new StrWorkflowError(0, false, 'str-workflow baseUrl is required (fail-closed)')
  if (!config.getToken) throw new StrWorkflowError(0, false, 'str-workflow getToken is required')
  const getToken = config.getToken
  const base = config.baseUrl
  const doFetch = config.fetchImpl ?? globalThis.fetch

  return {
    async handoffStrDraft(input, trace) {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-fapi-interaction-id': trace.trace_id,
        authorization: `Bearer ${await getToken(trace)}`
      }
      const res = await doFetch(`${base}/str-drafts`, { method: 'POST', headers, body: JSON.stringify(input) })
      if (!res.ok) {
        throw new StrWorkflowError(res.status, res.status === 429 || res.status >= 500, `str-workflow handoff → ${res.status}`)
      }
      const body = (await res.json()) as { workflow_ref?: string; accepted_at?: string }
      if (!body.workflow_ref || !body.accepted_at) {
        throw new StrWorkflowError(0, false, 'str-workflow returned no workflow_ref/accepted_at')
      }
      return { workflow_ref: body.workflow_ref, accepted_at: body.accepted_at }
    }
  }
}

export function strWorkflowFromEnv(env: NodeJS.ProcessEnv = process.env): StrWorkflowPort {
  const token = env.STR_WORKFLOW_TOKEN
  if (!env.STR_WORKFLOW_URL || !token) {
    throw new StrWorkflowError(0, false, 'str-workflow adapter misconfigured: set STR_WORKFLOW_URL and STR_WORKFLOW_TOKEN')
  }
  return createStrWorkflowAdapter({ baseUrl: env.STR_WORKFLOW_URL, getToken: async () => token })
}
