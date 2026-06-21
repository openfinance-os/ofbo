import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { ReconConsole } from '../../components/recon-console'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { listBreaks, listRuns, ReconApiError, type ReconciliationBreak, type ReconciliationRun } from '../../lib/reconciliation'
import { claimBreakAction, resolveBreakAction } from './actions'

/**
 * UI-03 — Reconciliation Console (BACKOFFICE-01/-02/-03/-04/-06). Wired to the Hono
 * BFF over the OpenAPI contract, server-side (httpOnly token never in the browser).
 * reconciliation:read gates the screen; finance:reconciliation:write gates claim/resolve
 * (both re-enforced at the BFF). Run list + KPIs are reads; claim + resolve are server-
 * action mutations. Rendered inside the UI-01 AppShell. Stitch = appearance.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  claimed: 'Break claimed — SLA clock started.',
  resolved: 'Break resolved.'
}
const FAILURE: Record<string, string> = {
  claim_failed: 'Could not claim the break. It may already be claimed.',
  resolve_failed: 'Could not resolve the break. Check the outcome and note (≥20 chars).'
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.reconciliationRead)) redirect(`/access-denied?module=${encodeURIComponent('Reconciliation')}&required=${encodeURIComponent(SCOPES.reconciliationRead)}`)

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const runId = one(sp.run_id) ?? ''
  const status = one(sp.status) ?? ''
  const runsCursor = one(sp.runs_cursor)
  const breaksCursor = one(sp.breaks_cursor)
  const canWrite = principal.superadmin || principal.scopes.includes(SCOPES.reconciliationWrite)

  let runs: ReconciliationRun[] = []
  let breaks: ReconciliationBreak[] = []
  let selectedRun: ReconciliationRun | null = null
  let runsMoreHref: string | null = null
  let breaksMoreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null

  try {
    const runsPage = await listRuns(token, { limit: 10, cursor: runsCursor })
    runs = runsPage.runs
    selectedRun = runId ? (runs.find((r) => r.run_id === runId) ?? null) : (runs[0] ?? null)
    // Break queue: the selected run's breaks (flagged + assigned + terminal), each
    // rendered with the right badge/actions. No status filter — the queue shows the
    // full picture and the BreakStatus single-value filter can't express flagged|assigned.
    const breaksPage = await listBreaks(token, { ...(selectedRun ? { run_id: selectedRun.run_id } : {}), cursor: breaksCursor })
    breaks = breaksPage.breaks
    // Forward cursor links (UX-04) — preserve the selected run; each list has its own cursor param.
    const keep = (extra: Record<string, string>) => `/reconciliation?${new URLSearchParams({ ...(runId ? { run_id: runId } : {}), ...extra }).toString()}`
    runsMoreHref = runsPage.next_cursor ? keep({ runs_cursor: runsPage.next_cursor }) : null
    breaksMoreHref = breaksPage.next_cursor ? keep({ breaks_cursor: breaksPage.next_cursor }) : null
  } catch (e) {
    error = e instanceof ReconApiError ? e.message : 'Failed to load reconciliation data.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="finance"
    >
      <ReconConsole
        runs={runs}
        selectedRun={selectedRun}
        breaks={breaks}
        runsMoreHref={runsMoreHref}
        breaksMoreHref={breaksMoreHref}
        error={error}
        notice={NOTICE[status] ?? null}
        canWrite={canWrite}
        claimAction={claimBreakAction}
        resolveAction={resolveBreakAction}
      />
    </AppShell>
  )
}
