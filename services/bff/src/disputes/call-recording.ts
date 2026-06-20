import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { CareSurfacePort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { DisputeStore } from './service.js'

/**
 * BACKOFFICE-64 — GET /disputes/{dispute_id}/call-recording (ADR 0003 Option 1).
 * Resolves a dispute's originating_call_id to a short-lived link to the contact-centre
 * recording via the P1 CareSurfacePort. The Back Office links, never copies — recording
 * content stays in the bank's system. Exactly one High-class call_recording_accessed
 * audit per access. 404 when the dispute is unknown, has no call linkage (non-voice
 * channels), or the recording is unavailable. Same RBAC as the dispute (disputes:admin).
 */

export const CALL_RECORDING_SCOPE = 'disputes:admin'

export interface CallRecording {
  recording_ref: string
  recording_url: string | null
  expires_at: string
}

export class CallRecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface CallRecordingDeps {
  store: Pick<DisputeStore, 'get'>
  careSurface: Pick<CareSurfacePort, 'resolveCallRecording'>
  audit: HighClassAuditSink
}

export class CallRecordingService {
  constructor(private readonly deps: CallRecordingDeps) {}

  async getRecording(principal: Principal, disputeId: string, traceId: string): Promise<CallRecording> {
    assertScope(principal, CALL_RECORDING_SCOPE) // service-layer defence in depth (→ 403)

    const dispute = await this.deps.store.get(disputeId)
    if (!dispute) {
      throw new CallRecordingError('BACKOFFICE.DISPUTE_NOT_FOUND', `No dispute ${disputeId}.`, 404)
    }
    const callId = dispute.originating_call_id
    if (!callId) {
      throw new CallRecordingError('BACKOFFICE.NO_CALL_LINKAGE', 'This dispute has no originating call (non-voice channel).', 404)
    }

    const rec = await this.deps.careSurface.resolveCallRecording({ call_id: callId }, { trace_id: traceId })
    if (!rec) {
      throw new CallRecordingError('BACKOFFICE.RECORDING_UNAVAILABLE', 'No recording is available for the originating call.', 404)
    }

    // Exactly one High-class audit per access (who viewed which dispute's recording).
    // The raw originating_call_id is not recorded; recording_ref is the resolved handle.
    await this.deps.audit.emit({
      event_type: 'call_recording_accessed',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: CALL_RECORDING_SCOPE,
      target_dispute_id: disputeId,
      request_trace_id: traceId,
      request_body: { recording_ref: rec.recording_ref, expires_at: rec.expires_at },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return rec
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function callRecordingRoutes(service: CallRecordingService): Record<string, Handler> {
  const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

  const handler: Handler = async (c, params) => {
    try {
      const rec = await service.getRecording(c.get('principal'), params.dispute_id!, trace(c))
      return c.json(dataEnvelope(rec), 200)
    } catch (e) {
      if (e instanceof CallRecordingError) {
        return c.json(
          errorEnvelope(e.code, e.message, 'See the call-recording contract (BACKOFFICE-64); 404 for non-voice disputes.', DOCS_BASE),
          e.status as ContentfulStatusCode
        )
      }
      throw e
    }
  }

  return { 'get /disputes/{dispute_id}/call-recording': handler }
}
