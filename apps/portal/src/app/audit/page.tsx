import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { AuditLog } from '../../components/audit-log'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { searchAuditEvents, AuditLogError, type AuditLogEvent } from '../../lib/audit-log'

/**
 * DEMO-01 — global Audit Log screen. The Dashboard audit panel is self-scoped (your own
 * recent actions); this is the cross-operator view an auditor needs ("who revoked consent").
 * Server-rendered over the OpenAPI contract (httpOnly token never in the browser). audit:read
 * gates the screen here; the BFF re-enforces it and logs the access. Read-only, zero PII.
 */
export const dynamic = 'force-dynamic'

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.auditRead)) redirect('/dashboard')

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const eventType = one(sp.event_type) ?? ''
  const actingPrincipal = one(sp.acting_principal) ?? ''

  let events: AuditLogEvent[] = []
  let error: string | null = null
  try {
    events = await searchAuditEvents(token, {
      ...(eventType ? { eventType } : {}),
      ...(actingPrincipal.trim() ? { actingPrincipal: actingPrincipal.trim() } : {})
    })
  } catch (e) {
    error = e instanceof AuditLogError ? e.message : 'The Audit Log is temporarily unavailable.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="audit"
    >
      <AuditLog events={events} filters={{ event_type: eventType, acting_principal: actingPrincipal }} error={error} />
    </AppShell>
  )
}
