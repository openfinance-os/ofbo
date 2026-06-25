import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell'
import { shellBadges } from '../../../../lib/shell'
import { InvestigationDetail } from '../../../../components/investigation-detail'
import { SCOPES } from '../../../../lib/scopes'
import { getSession } from '../../../../lib/session'
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
  // Like the global audit screen, an in-scope-less but signed-in operator is sent to their
  // dashboard (not the access-denied screen), so resolve the session directly.
  const session = await getSession()
  if (!session) redirect('/')
  const { token, principal } = session
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.reconciliationRead)) redirect('/dashboard')

  const { break_id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''
  const canDispute = principal.superadmin || principal.scopes.includes(SCOPES.disputesWrite)

  let error: string | null = FAILURE[status] ?? null
  const [break_, badges] = await Promise.all([
    getBreak(token, break_id).catch((e: unknown): ReconciliationBreak | null => {
      error = e instanceof ReconApiError ? e.message : 'Failed to load the break.'
      return null
    }),
    shellBadges(token)
  ])

  return (
    <AppShell badges={badges} principal={principal}>
      {break_ ? (
        <InvestigationDetail break_={break_} error={error} notice={NOTICE[status] ?? null} canDispute={canDispute} escalateAction={escalateNebrasAction} />
      ) : (
        <div className="space-y-4" data-testid="investigation-missing">
          <Link href="/reconciliation" className="text-xs text-secondary hover:underline">
            ← Back to Reconciliation Console
          </Link>
          <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg">{error ?? 'Break not found.'}</p>
        </div>
      )}
    </AppShell>
  )
}
