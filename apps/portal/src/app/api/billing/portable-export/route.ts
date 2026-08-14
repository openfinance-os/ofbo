import { NextResponse } from 'next/server'
import { BillingConsoleApiError, getPortableBillingExport } from '../../../../lib/billing-console'
import { SCOPES } from '../../../../lib/scopes'
import { getSession } from '../../../../lib/session'

/** Server-side download proxy: the httpOnly Bearer remains inside the portal Worker. */
export async function GET(): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: { code: 'BACKOFFICE.UNAUTHENTICATED', message: 'Sign in is required.' } }, { status: 401 })
  if (!session.principal.superadmin && !session.principal.scopes.includes(SCOPES.billingRead)) {
    return NextResponse.json({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'billing:read is required.' } }, { status: 403 })
  }
  try {
    const artifact = await getPortableBillingExport(session.token)
    return new Response(JSON.stringify(artifact, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="ofbo-billing-${artifact.bank_id ?? 'tenant'}.json"`,
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    if (error instanceof BillingConsoleApiError) {
      return NextResponse.json({ error: { code: error.code, message: error.message, remediation: error.remediation, docs_url: error.docsUrl } }, { status: error.status })
    }
    return NextResponse.json({ error: { code: 'BACKOFFICE.ERROR', message: 'Billing export failed.' } }, { status: 502 })
  }
}
