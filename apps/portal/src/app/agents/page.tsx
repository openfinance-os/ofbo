import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AgentsRegistry } from '../../components/agents-registry'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { listAgents, AgentsApiError, type AgentRegistration } from '../../lib/agents'
import { registerAgentAction, revokeAgentAction } from './actions'

/**
 * BACKOFFICE-60 — Agent Registry screen (ADR 0017). The portal surface for programmatic
 * admin-scope access. Wired over the OpenAPI contract, server-side (httpOnly token never in
 * the browser). platform:agents:read gates the screen; platform:agents:write gates register
 * (four-eyes — submitted to the approvals queue, never inline) + revoke (single-actor). All
 * re-enforced at the BFF. No PSU PII — agents are service-account metadata.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  revoked: 'Agent revoked — its credential is deactivated immediately.'
}
const FAILURE: Record<string, string> = {
  register_failed: 'Could not submit the agent registration. Check the persona and display name.',
  revoke_failed: 'Could not revoke the agent. It may already be revoked.'
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.agentsRead)) {
    redirect(`/access-denied?module=${encodeURIComponent('Agent Registry')}&required=${encodeURIComponent(SCOPES.agentsRead)}`)
  }

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''
  const ar = one(sp.ar)
  const cursor = one(sp.cursor)
  const canWrite = principal.superadmin || principal.scopes.includes(SCOPES.agentsWrite)

  // UX-03 — on a four-eyes submit, give the initiator the request id + a deep-link to track it.
  const notice: ReactNode =
    status === 'registered' ? (
      <>
        Agent registration submitted to four-eyes{ar ? <> — request <span className="font-mono">{ar}</span></> : null}. A second authorised principal approves before the credential is issued.{' '}
        <a href={ar ? `/approvals/${encodeURIComponent(ar)}` : '/approvals'} className="font-semibold underline">
          {ar ? 'Open this approval →' : 'Track in the approvals queue →'}
        </a>
      </>
    ) : (
      NOTICE[status] ?? null
    )

  let agents: AgentRegistration[] = []
  let moreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  try {
    const page = await listAgents(token, { limit: 50, cursor })
    agents = page.agents
    moreHref = page.next_cursor ? `/agents?cursor=${encodeURIComponent(page.next_cursor)}` : null
  } catch (e) {
    error = e instanceof AgentsApiError ? e.message : 'Failed to load the agent registry.'
    if (e instanceof AgentsApiError) {
      errorRemediation = e.remediation ?? null
      errorDocsUrl = e.docsUrl ?? null
    }
  }

  return (
    <AppShell
      badges={await shellBadges(token)}
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="agents"
    >
      <AgentsRegistry
        agents={agents}
        moreHref={moreHref}
        error={error}
        errorRemediation={errorRemediation}
        errorDocsUrl={errorDocsUrl}
        notice={notice}
        canWrite={canWrite}
        registerAction={registerAgentAction}
        revokeAction={revokeAgentAction}
      />
    </AppShell>
  )
}
