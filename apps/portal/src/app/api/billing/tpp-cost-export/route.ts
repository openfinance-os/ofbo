import { NextResponse } from 'next/server'
import { BillingConsoleApiError, getTppCostEvidenceExport } from '../../../../lib/billing-console'
import { SCOPES } from '../../../../lib/scopes'
import { getSession } from '../../../../lib/session'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Every error body here carries the full four-field envelope the API convention requires
 * (code, message, remediation, docs_url). The sibling proxies predate that and emit only two on
 * their auth branches; this one does not copy the deviation.
 */
const DOCS_URL = 'https://github.com/openfinance-os/ofbo/blob/main/specs/backoffice-openapi.yaml'

/**
 * BILL-17 — server-side download proxy for the governed TPP cost evidence pack.
 *
 * The httpOnly Bearer never leaves the portal Worker, and the pack itself is streamed straight to
 * the browser as an attachment rather than being held in any client store: the acceptance criterion
 * is "no tokens or export payloads in browser storage", and a fetch-then-render path would put the
 * whole evidence base into page state to satisfy nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: 'BACKOFFICE.UNAUTHENTICATED',
          message: 'Sign in is required.',
          remediation: 'Sign in with a persona holding billing:read, then retry the download.',
          docs_url: DOCS_URL
        }
      },
      { status: 401 }
    )
  }
  if (!session.principal.superadmin && !session.principal.scopes.includes(SCOPES.billingRead)) {
    return NextResponse.json(
      {
        error: {
          code: 'BACKOFFICE.SCOPE_DENIED',
          message: 'billing:read is required.',
          remediation: 'Switch to a persona holding billing:read — the Finance Analyst has it.',
          docs_url: DOCS_URL
        }
      },
      { status: 403 }
    )
  }
  // Validated here as well as at the BFF. The value lands in a Content-Disposition filename below,
  // and an unvalidated one would let a crafted query string steer that header.
  const period = new URL(request.url).searchParams.get('period') ?? ''
  if (!PERIOD.test(period)) {
    return NextResponse.json(
      {
        error: {
          code: 'BACKOFFICE.INVALID_PERIOD',
          message: `Period ${period || '(absent)'} is not YYYY-MM.`,
          remediation: 'Request the export with a period such as 2026-06.',
          docs_url: DOCS_URL
        }
      },
      { status: 400 }
    )
  }
  try {
    const artifact = await getTppCostEvidenceExport(session.token, period)
    return new Response(JSON.stringify(artifact, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="ofbo-tpp-cost-evidence-${period}.json"`,
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    if (error instanceof BillingConsoleApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, remediation: error.remediation, docs_url: error.docsUrl } },
        { status: error.status }
      )
    }
    return NextResponse.json(
      {
        error: {
          code: 'BACKOFFICE.ERROR',
          message: 'TPP cost evidence export failed.',
          remediation: 'Retry once the back office is reachable; the export is a read and is safe to repeat.',
          docs_url: DOCS_URL
        }
      },
      { status: 502 }
    )
  }
}
