/**
 * BACKOFFICE-70 — LFI Ozone Connect health-check surfacing. Ozone Connect is the
 * scheme's LFI connection standard; its GET /health is polled and surfaced on the
 * Operations Console platform-health screen (status, uptime, last failure) so
 * operators see connectivity health without a separate tool. Read-only; the demo
 * source is deterministic, the enterprise adapter polls the real /health via P6.
 */

export type OzoneStatus = 'up' | 'degraded' | 'down'

export interface OzoneHealth {
  status: OzoneStatus
  checked_at: string
  uptime_pct_30d: number
  last_failure_at: string | null
}

export interface OzoneHealthSource {
  getHealth(): Promise<OzoneHealth>
}

/** Deterministic demo health: up, 99.8% 30-day uptime, a last failure a few days ago. */
export class DemoOzoneHealthSource implements OzoneHealthSource {
  constructor(private readonly now: () => Date = () => new Date()) {}
  async getHealth(): Promise<OzoneHealth> {
    const n = this.now()
    return {
      status: 'up',
      checked_at: n.toISOString(),
      uptime_pct_30d: 99.8,
      last_failure_at: new Date(n.getTime() - 6 * 24 * 3600 * 1000).toISOString()
    }
  }
}
