import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

/**
 * M1-DEMO-DEPLOY acceptance: the demo URL is live (PRD §9 M1 exit criteria, the
 * pipeline slice). Runs against the DEPLOYED demo environment — the deploy
 * workflow executes this suite after every merge to main, so a broken demo
 * fails the pipeline, not the next visitor.
 *
 * Portal-shell criteria (DEMO banner, login screen, audit visible in UI) land
 * with M1-PORTAL-SHELL and extend this suite then.
 */

const BFF = process.env.DEMO_BFF_URL ?? 'https://ofbo-bff.michartmann.workers.dev'
const SIM = process.env.DEMO_SIM_URL ?? 'https://nebras-sim-production.up.railway.app'
const DATABASE_URL = process.env.DATABASE_URL

const fapi = () => randomUUID()

describe('demo BFF (Cloudflare Worker)', () => {
  it('rejects requests missing x-fapi-interaction-id with the binding 400 envelope', async () => {
    const res = await fetch(`${BFF}/approvals/pending`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; remediation: string; docs_url: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_FAPI_INTERACTION_ID')
    expect(body.error.remediation).toBeTruthy()
    expect(body.error.docs_url).toBeTruthy()
  })

  it('refuses unauthenticated requests with the 401 envelope', async () => {
    const res = await fetch(`${BFF}/approvals/pending`, {
      headers: { 'x-fapi-interaction-id': fapi() }
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toMatch(/^BACKOFFICE\./)
  })

  it('authenticates a demo persona via the IdP port (MFA) and answers in the response envelope', async () => {
    const id = fapi()
    const res = await fetch(`${BFF}/approvals/pending`, {
      headers: {
        'x-fapi-interaction-id': id,
        authorization: 'Bearer demo-token:operations-analyst'
      }
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-fapi-interaction-id')).toBe(id)
    const body = (await res.json()) as { data: unknown; meta: { request_id: string; timestamp: string } }
    expect(body.data).toBeDefined()
    expect(body.meta.request_id).toBeTruthy()
    expect(body.meta.timestamp).toBeTruthy()
  })

  it('enforces the Idempotency-Key convention on mutating routes', async () => {
    const res = await fetch(`${BFF}/approvals`, {
      method: 'POST',
      headers: {
        'x-fapi-interaction-id': fapi(),
        authorization: 'Bearer demo-token:operations-analyst',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ operation_type: 'smoke.noop', operation_payload: {} })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_IDEMPOTENCY_KEY')
  })

  it.skipIf(!DATABASE_URL)(
    'persists a High-class audit record for the sign-in (request_trace_id = x-fapi-interaction-id)',
    async () => {
      // Demo profile is sleep-tolerant / free-tier (CLAUDE.md §3.1): a just-
      // deployed Worker can cold-start for several seconds, and the CI→Supabase
      // pooler adds latency. Warm the Worker first, then verify persistence with
      // a generous budget — this is a liveness + eventual-persistence check, not
      // the <500ms p95 API SLA (which is asserted against real infra, not here).
      await fetch(`${BFF}/approvals/pending`, {
        headers: { 'x-fapi-interaction-id': fapi(), authorization: 'Bearer demo-token:operations-analyst' }
      }).catch(() => undefined)

      const traceId = fapi()
      const res = await fetch(`${BFF}/approvals/pending`, {
        headers: {
          'x-fapi-interaction-id': traceId,
          authorization: 'Bearer demo-token:operations-analyst'
        }
      })
      expect(res.status).toBe(200)

      const pool = new pg.Pool({ connectionString: DATABASE_URL })
      try {
        // Poll to a wall-clock deadline with capped backoff + jitter — more robust on a
        // slow/cold CI runner than a fixed attempt-count × fixed 1s sleep (and it stops
        // promptly once the row lands rather than always padding to a worst case).
        const deadline = Date.now() + 45_000
        let rows: Array<{ event_type: string }> = []
        let delay = 250
        while (rows.length === 0 && Date.now() < deadline) {
          const result = await pool.query(
            `SELECT event_type FROM audit_high_sensitivity WHERE request_trace_id = $1`,
            [traceId]
          )
          rows = result.rows
          if (rows.length === 0) {
            await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 100)))
            delay = Math.min(delay * 2, 2000)
          }
        }
        expect(rows.length).toBeGreaterThan(0)
      } finally {
        await pool.end()
      }
    },
    60_000
  )
})

describe('demo Nebras simulator (Railway)', () => {
  it('serves the Consent Manager surface deterministically', async () => {
    const res = await fetch(`${SIM}/consent-manager/consents/smoke-test-consent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { consent_id: string; status: string }
    expect(body.consent_id).toBe('smoke-test-consent')
    expect(body.status).toBe('Authorized')
  })

  it('keeps the fault-injection admin surface OFF public ingress (401 without the operator token)', async () => {
    const res = await fetch(`${SIM}/admin/faults`)
    expect(res.status).toBe(401)
  })

  it.skipIf(!process.env.SIM_ADMIN_TOKEN)(
    'admits the operator token to the fault-injection surface (breaks on demand for demos)',
    async () => {
      const res = await fetch(`${SIM}/admin/faults`, {
        headers: { 'x-admin-token': process.env.SIM_ADMIN_TOKEN! }
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { faults: unknown[] }
      expect(Array.isArray(body.faults)).toBe(true)
    }
  )

  it('serves the TPP reports surface', async () => {
    const res = await fetch(`${SIM}/tpp-reports/2026-05`)
    expect(res.status).toBe(200)
  })
})
