import type { ReactNode } from 'react'
import { AGENT_PERSONAS, type AgentRegistration } from '../lib/agents'
import { Notice, ErrorBanner, LoadMore, StatusBadge, SubmitButton, IdempotencyField, ConfirmSubmit, ClearStatusParam } from './ui'

/**
 * BACKOFFICE-60 — Agent Registry, the portal surface for programmatic admin-scope access
 * (ADR 0017). Translated against the Stitch "Regulated Institutional Interface" design
 * system (project 8050269076066130289) using the shared token-only primitives. Server-
 * rendered, OpenAPI-bound: lists DCR-registered automation agents (platform:agents:read);
 * registering one is FOUR-EYES (submitted to the approvals queue, never inline); revoke is
 * a single-actor kill switch. NO PSU PII — agents are service-account metadata. Mutations
 * are server actions, injected so the unit renders without Next.
 */
export interface AgentsRegistryProps {
  agents?: AgentRegistration[]
  moreHref?: string | null
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  notice?: ReactNode
  /** platform:agents:write — register (four-eyes) + revoke. */
  canWrite?: boolean
  registerAction?: (formData: FormData) => void | Promise<void>
  revokeAction?: (formData: FormData) => void | Promise<void>
}

const th = 'px-4 py-2 text-left font-semibold text-on-surface-variant'
const td = 'px-4 py-3 align-top'

function ScopeChips({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <span key={s} className="inline-block rounded-md bg-surface-container px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
          {s}
        </span>
      ))}
    </div>
  )
}

export function AgentsRegistry({ agents = [], moreHref = null, error, errorRemediation, errorDocsUrl, notice, canWrite = false, registerAction, revokeAction }: AgentsRegistryProps) {
  return (
    <div className="space-y-6" data-testid="agents-registry">
      <ClearStatusParam />
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-on-surface">Agent Registry</h1>
        <p className="text-sm text-on-surface-variant">
          Programmatic admin-scope access for internal automations (ADR 0017). Each agent runs under a least-privilege persona — a strict
          subset of a human persona, never super-admin. Registration is four-eyes; revoke is immediate.
        </p>
      </header>

      {error ? (
        <ErrorBanner testid="agents-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>
          {error}
        </ErrorBanner>
      ) : null}
      {notice ? <Notice testid="agents-notice">{notice}</Notice> : null}

      {canWrite && registerAction ? (
        <section aria-labelledby="register-agent-heading" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <h2 id="register-agent-heading" className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">
            Register an agent
          </h2>
          <form action={registerAction} className="flex flex-wrap items-end gap-3" data-testid="register-agent-form">
            <IdempotencyField />
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Persona</span>
              <select name="persona" required defaultValue="" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface" data-testid="register-persona">
                <option value="" disabled>
                  Select a persona…
                </option>
                {AGENT_PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Display name</span>
              <input
                name="display_name"
                required
                minLength={3}
                placeholder="e.g. Reconciliation read-only bot"
                className="w-64 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
                data-testid="register-display-name"
              />
            </label>
            <SubmitButton testid="register-submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary">
              Submit for approval
            </SubmitButton>
          </form>
          <p className="mt-2 text-xs text-on-surface-variant">
            Four-eyes — a second authorised principal approves before the credential is issued. The agent is read-only until a human raises its budget.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="agents-list-heading" className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="border-b border-outline-variant px-4 py-3">
          <h2 id="agents-list-heading" className="text-sm font-bold uppercase tracking-widest text-primary">
            Registered agents
          </h2>
        </div>
        {agents.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-on-surface-variant" data-testid="agents-empty">
            No agents registered yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-outline-variant text-xs uppercase tracking-wider">
                <tr>
                  <th scope="col" className={th}>Agent</th>
                  <th scope="col" className={th}>Persona</th>
                  <th scope="col" className={th}>Scopes</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Registered</th>
                  {canWrite ? <th scope="col" className={th}>Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {agents.map((a) => (
                  <tr key={a.agent_id} data-testid={`agent-row-${a.agent_id}`}>
                    <td className={td}>
                      <div className="font-medium text-on-surface">{a.display_name}</div>
                      <div className="font-mono text-xs text-on-surface-variant">{a.client_id}</div>
                    </td>
                    <td className={td}>
                      <div className="text-on-surface">{a.persona}</div>
                      <div className="text-xs text-on-surface-variant">⊂ {a.derived_from}</div>
                    </td>
                    <td className={td}>
                      <ScopeChips scopes={a.scopes} />
                      <div className="mt-1 text-xs text-on-surface-variant">{a.allow_mutations ? `mutating · budget ${a.spend_budget}` : 'read-only'}</div>
                    </td>
                    <td className={td}>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-on-surface-variant`}>
                      <div data-testid={`agent-created-${a.agent_id}`}>{a.created_at.slice(0, 10)}</div>
                      {a.approved_by ? <div className="font-mono">by {a.approved_by}</div> : null}
                    </td>
                    {canWrite ? (
                      <td className={td}>
                        {a.status === 'revoked' ? (
                          <span className="text-xs text-on-surface-variant">{a.revoke_reason ? `revoked: ${a.revoke_reason}` : 'revoked'}</span>
                        ) : revokeAction ? (
                          <form action={revokeAction} className="flex flex-col gap-1" data-testid={`revoke-form-${a.agent_id}`}>
                            <IdempotencyField />
                            <input type="hidden" name="agent_id" value={a.agent_id} />
                            <input
                              name="reason"
                              required
                              minLength={10}
                              placeholder="Reason (min 10 chars)"
                              className="w-44 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs text-on-surface"
                              data-testid={`revoke-reason-${a.agent_id}`}
                            />
                            <ConfirmSubmit
                              testid={`revoke-${a.agent_id}`}
                              label="Revoke"
                              summary="This deactivates the agent's credential immediately. Single-actor — no second approval is needed to remove authority."
                              confirmLabel="Confirm revoke"
                              className="self-start rounded-lg bg-error-container px-3 py-1 text-xs font-semibold text-on-error-container"
                            />
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore moreHref={moreHref} shown={agents.length} noun="agents" />
      </section>
    </div>
  )
}
