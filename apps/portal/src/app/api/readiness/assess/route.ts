import { NextResponse, type NextRequest } from 'next/server'
import { assessReadiness, ReadinessApiError, type ReadinessAssessmentInput } from '../../../../lib/readiness'

/**
 * Public proxy (ADR 0022): the browser posts the wizard's estate mapping here; this server-side
 * handler forwards to the BFF's public `/public/readiness:assess` (keeping BFF_URL off the client).
 * No auth — the wizard is pre-login. Bank system-metadata only, never PII.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let input: ReadinessAssessmentInput
  try {
    input = (await req.json()) as ReadinessAssessmentInput
  } catch {
    return NextResponse.json({ error: { code: 'BACKOFFICE.INVALID_BODY', message: 'A JSON body is required.' } }, { status: 400 })
  }
  try {
    const digest = await assessReadiness(input)
    return NextResponse.json(digest)
  } catch (e) {
    if (e instanceof ReadinessApiError) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status })
    }
    return NextResponse.json({ error: { code: 'BACKOFFICE.ERROR', message: 'Assessment failed.' } }, { status: 502 })
  }
}
