import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell'
import { shellBadges } from '../../../../lib/shell'
import { InvestigationDetail } from '../../../../components/investigation-detail'
import { TOKEN_COOKIE } from '../../../../lib/cookies'
import { SCOPES } from '../../../../lib/scopes'
import { verifyAndMint } from '../../../../lib/portal'
import { getBreak, ReconApiError, type ReconciliationBreak } from '../../../../lib/reconciliation'
import { escalateNebrasAction } from './actions'

/**
 * UI-04 — Investigation Detail View (BACKOFFICE-11 three-source diff + BACKOFFICE-05
 * one-click Nebras dispute). Wired to the Hono BFF over the OpenAPI contract, server-side
 * (httpOnly token never in the browser). reconciliation:read gates the screen;
 * finance:disputes:write gates escalation (both re-enforced at the BFF). Rendered inside
 * the UI-01 AppShell. Stitch = appearance.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  escalated: 'Escalated to Nebras — dispute case raised via the egress gateway.'
}
const FAILURE: Record<string, string> = {
  escalate_failed: 'Could not escalate. The break may already be escalated or resolved.'
}

export default async function InvestigationPage({ params, searchParams }: { params: Promise<{ break_id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.reconciliationRead)) redirect('/dashboard')

  const { break_id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''
  const canDispute = principal.superadmin || principal.scopes.includes(SCOPES.disputesWrite)

  let break_: ReconciliationBreak | null = null
  let error: string | null = FAILURE[status] ?? null
  try {
    break_ = await getBreak(token, break_id)
  } catch (e) {
    error = e instanceof ReconApiError ? e.message : 'Failed to load the break.'
  }

  return (
    <AppShell
      badges={token ? await shellBadges(token) : undefined}
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="finance"
    >
      {break_ ? (
        <InvestigationDetail break_={break_} error={error} notice={NOTICE[status] ?? null} canDispute={canDispute} escalateAction={escalateNebrasAction} />
      ) : (
        <div className="space-y-4" data-testid="investigation-missing">
          <a href="/reconciliation" className="text-xs text-secondary hover:underline">
            ← Back to Reconciliation Console
          </a>
          <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg">{error ?? 'Break not found.'}</p>
        </div>
      )}
    </AppShell>
  )
}
