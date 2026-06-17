import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-69 — CAAP user registration/deregistration audit. CAAP (the scheme's
 * centralized auth/authorization platform) register/deregister events are recorded
 * as INSERT-only High-class audit entries: one per event, with the device as the
 * acting principal (so the streaming anomaly watch — >10 registrations/device/hour,
 * BACKOFFICE-37/-46 detector — can group by device) and an opaque CAAP user ref.
 * No bank PSU PII: the caap_user_ref is the scheme's opaque id and the body is
 * redacted at emission. Recording is event-driven (the scheme integration calls
 * record); the anomaly watch scans the audit stream.
 */

export type CaapAction = 'register' | 'deregister'

export interface CaapEvent {
  /** Device that performed the registration — the acting principal on the audit. */
  device_ref: string
  /** Opaque CAAP user reference (scheme id — NOT a bank PSU identifier). */
  caap_user_ref: string
  action: CaapAction
}

export interface CaapRecordResult {
  device_ref: string
  action: CaapAction
  event_type: 'caap_registered' | 'caap_deregistered'
}

export class CaapRegistrationRecorder {
  constructor(private readonly deps: { audit: HighClassAuditSink }) {}

  /** Record a batch of CAAP register/deregister events — one High-class audit each. */
  async record(events: CaapEvent[], traceId: string): Promise<CaapRecordResult[]> {
    const out: CaapRecordResult[] = []
    for (const e of events) {
      const event_type = e.action === 'register' ? 'caap_registered' : 'caap_deregistered'
      await this.deps.audit.emit({
        event_type,
        acting_principal: e.device_ref,
        acting_persona: 'caap',
        scope_used: 'platform:operations:read',
        request_trace_id: traceId,
        request_body: { device_ref: e.device_ref, caap_user_ref: e.caap_user_ref, action: e.action },
        response_status: 200
      })
      out.push({ device_ref: e.device_ref, action: e.action, event_type })
    }
    return out
  }
}

/**
 * Deterministic demo CAAP events: a couple of normal devices plus one device with a
 * registration spike (12 in the hour) so the >10/device/hour anomaly fires on cue.
 */
export class DemoCaapEventSource {
  async getEvents(): Promise<CaapEvent[]> {
    const events: CaapEvent[] = [
      { device_ref: 'device:normal-1', caap_user_ref: 'caap-user-aa', action: 'register' },
      { device_ref: 'device:normal-2', caap_user_ref: 'caap-user-bb', action: 'register' },
      { device_ref: 'device:normal-2', caap_user_ref: 'caap-user-bb', action: 'deregister' }
    ]
    for (let i = 0; i < 12; i++) events.push({ device_ref: 'device:spike-9', caap_user_ref: `caap-user-s${i}`, action: 'register' })
    return events
  }
}
