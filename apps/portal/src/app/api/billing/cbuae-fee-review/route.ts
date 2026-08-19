import { NextResponse, type NextRequest } from 'next/server'
import { BillingConsoleApiError, generateCbuaeFeeReview } from '../../../../lib/billing-console'
import { idempotencyKey } from '../../../../lib/idempotency'
import { SCOPES } from '../../../../lib/scopes'
import { getSession } from '../../../../lib/session'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** Generate and download a baseline annual-review artifact; scenario runs can be added separately. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: { code: 'BACKOFFICE.UNAUTHENTICATED', message: 'Sign in is required.' } }, { status: 401 })
  if (!session.principal.superadmin && !session.principal.scopes.includes(SCOPES.billingRead)) {
    return NextResponse.json({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'billing:read is required.' } }, { status: 403 })
  }
  const form = await request.formData().catch(() => null)
  const period = String(form?.get('period') ?? '')
  if (!PERIOD.test(period)) {
    return NextResponse.json({ error: { code: 'BACKOFFICE.INVALID_PERIOD', message: 'Period must be YYYY-MM.' } }, { status: 400 })
  }
  try {
    const artifact = await generateCbuaeFeeReview(session.token, { period, scenarios: [] }, idempotencyKey(form ?? new FormData()))
    return new Response(JSON.stringify(artifact, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="ofbo-cbuae-fee-review-${period}.json"`,
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    if (error instanceof BillingConsoleApiError) {
      return NextResponse.json({ error: { code: error.code, message: error.message, remediation: error.remediation, docs_url: error.docsUrl } }, { status: error.status })
    }
    return NextResponse.json({ error: { code: 'BACKOFFICE.ERROR', message: 'CBUAE fee-review export failed.' } }, { status: 502 })
  }
}
