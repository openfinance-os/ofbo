import { NextResponse, type NextRequest } from 'next/server'
import { saveReadinessProfile, ReadinessApiError, type ReadinessAssessmentInput } from '../../../../lib/readiness'

/**
 * Public proxy (ADR 0022): save a named readiness profile via the BFF's public endpoint and return
 * its shareable slug. No auth (pre-login). Persists non-regulated bank system-metadata, never PII.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: { name?: string; input?: ReadinessAssessmentInput }
  try {
    body = (await req.json()) as { name?: string; input?: ReadinessAssessmentInput }
  } catch {
    return NextResponse.json({ error: { code: 'BACKOFFICE.INVALID_BODY', message: 'A JSON body is required.' } }, { status: 400 })
  }
  try {
    const profile = await saveReadinessProfile(body.name ?? '', body.input ?? { ports: {} })
    return NextResponse.json(profile, { status: 201 })
  } catch (e) {
    if (e instanceof ReadinessApiError) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status })
    }
    return NextResponse.json({ error: { code: 'BACKOFFICE.ERROR', message: 'Save failed.' } }, { status: 502 })
  }
}
