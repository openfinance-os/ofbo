import { Hono } from 'hono'
import { generateDemoDataset } from '@ofbo/synthetic-data'

/**
 * Nebras simulator v1 (PRD §3.1, P6 demo adapter target): emulates the API Hub
 * surfaces the Back Office consumes — Consent Manager (<5s revoke ack), TPP
 * Reports, Dataset — with deterministic synthetic UAE OF v2.1-shaped payloads
 * and INJECTABLE FAULTS so breaks and signals can be triggered live in a demo.
 * Synthetic data only; the service never sees real PSU data.
 */

type Fault =
  | { fault: 'revoke_delay'; delay_ms: number }
  | { fault: 'fee_variance'; period: string; variance_minor_units: number }
  | { fault: 'consent_drift'; consent_id: string }

const FAULT_TYPES = new Set(['revoke_delay', 'fee_variance', 'consent_drift'])

/** Deterministic per-period seed: same period string → identical dataset. */
function periodSeed(period: string): number {
  let h = 0
  for (const ch of period) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h || 1
}

export function createNebrasSim() {
  const app = new Hono()
  const faults: Fault[] = []
  const revoked = new Map<string, string>() // consent_id → revoked_at ISO

  const activeFault = <K extends Fault['fault']>(kind: K) =>
    faults.find((f): f is Extract<Fault, { fault: K }> => f.fault === kind)

  // ── Consent Manager surface ───────────────────────────────────────────────
  app.post('/consent-manager/consents/:consent_id/revoke', (c) => {
    const consentId = c.req.param('consent_id')
    revoked.set(consentId, new Date().toISOString())
    const delay = activeFault('revoke_delay')
    // ack latency is REPORTED (deterministic demos must not actually sleep 7s)
    const acknowledgedInMs = delay ? delay.delay_ms : 420
    return c.json({ consent_id: consentId, status: 'Revoked', acknowledged_in_ms: acknowledgedInMs })
  })

  app.get('/consent-manager/consents/:consent_id', (c) => {
    const consentId = c.req.param('consent_id')
    const drift = activeFault('consent_drift')
    const driftInjected = drift?.consent_id === consentId
    return c.json({
      consent_id: consentId,
      // drift: the Hub reports a state the platform mirror won't expect
      status: driftInjected ? 'Authorized' : revoked.has(consentId) ? 'Revoked' : 'Authorized',
      drift_injected: driftInjected,
      revoked_at: revoked.get(consentId) ?? null
    })
  })

  // ── Reports surfaces ──────────────────────────────────────────────────────
  app.get('/tpp-reports/:period', (c) => {
    const period = c.req.param('period')
    const ds = generateDemoDataset(periodSeed(period))
    const rows = ds.billing_lines.map((l) => ({
      line_ref: l.line_ref.replace('2026-05', period),
      channel: l.channel,
      line_type: l.line_type,
      tpp_organisation_id: l.tpp_organisation_id,
      fee: { ...l.fee },
      occurred_at: l.occurred_at.replace('2026-05', period)
    }))
    const variance = activeFault('fee_variance')
    if (variance && variance.period === period && rows.length > 0) {
      // perturb exactly one deterministic line — the reconciliation break to find
      const idx = periodSeed(period) % rows.length
      rows[idx] = { ...rows[idx]!, fee: { ...rows[idx]!.fee, amount: rows[idx]!.fee.amount + variance.variance_minor_units } }
    }
    return c.json({ period, rows })
  })

  app.get('/datasets/:name/:period', (c) => {
    const { name, period } = c.req.param()
    const ds = generateDemoDataset(periodSeed(`${name}:${period}`))
    const rows =
      name === 'consents'
        ? ds.psus.flatMap((p) => p.consents.map((x) => ({ consent_id: x.consent_id, status: x.status, tpp_organisation_id: x.tpp_organisation_id })))
        : ds.billing_lines.map((l) => ({ line_ref: l.line_ref, line_type: l.line_type }))
    return c.json({ dataset: name, period, rows })
  })

  // ── Fault-injection admin (the live-demo trigger) ─────────────────────────
  app.post('/admin/faults', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'JSON body required' }, 400)
    }
    if (typeof body.fault !== 'string' || !FAULT_TYPES.has(body.fault)) {
      return c.json({ error: `fault must be one of: ${[...FAULT_TYPES].join(', ')}` }, 400)
    }
    // money stays integer minor units even under fault injection
    if (body.fault === 'fee_variance' && !Number.isInteger(body.variance_minor_units)) {
      return c.json({ error: 'variance_minor_units must be an integer (minor units)' }, 400)
    }
    if (body.fault === 'revoke_delay' && !Number.isInteger(body.delay_ms)) {
      return c.json({ error: 'delay_ms must be an integer' }, 400)
    }
    faults.push(body as unknown as Fault)
    return c.json({ injected: body, active_faults: faults.length }, 201)
  })

  app.get('/admin/faults', (c) => c.json({ faults }))

  app.delete('/admin/faults', (c) => {
    faults.length = 0
    return c.json({ faults })
  })

  return app
}
