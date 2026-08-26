import { describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
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
const billingToken = 'Bearer demo-token:finance-analyst@alpha-bank'
const period = () => new Date().toISOString().slice(0, 7)

function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (current === null || typeof current !== 'object') return current
    if (Array.isArray(current)) return current.map(normalize)
    return Object.fromEntries(
      Object.keys(current as Record<string, unknown>).sort()
        .map((key) => [key, normalize((current as Record<string, unknown>)[key])])
    )
  }
  return JSON.stringify(normalize(value))
}

function expectDigest(data: Record<string, unknown>): void {
  const { sha256, ...body } = data
  expect(sha256).toBe(`sha256:${createHash('sha256').update(canonicalJson(body)).digest('hex')}`)
}

function scenario(month: string): Record<string, unknown> {
  return {
    scenario_id: `deploy-smoke-${month}`,
    effective_date: `${month}-01`,
    receivable_multiplier_basis_points: 10000,
    retail_overage: {
      overage_units: 1000,
      current_rate_milli_fils: 950000,
      proposed_rate_milli_fils: 975000
    }
  }
}

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

  it('serves the provisioned tenant billing console and pure profitability scenario', async () => {
    const month = period()
    const consoleResponse = await fetch(`${BFF}/back-office/billing/console?period=${month}`, {
      headers: { 'x-fapi-interaction-id': fapi(), authorization: billingToken }
    })
    expect(consoleResponse.status).toBe(200)
    const overview = (await consoleResponse.json()) as { data: { bank_id: string; period: string; profitability: unknown } }
    expect(overview.data.bank_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(overview.data.period).toBe(month)
    expect(overview.data.profitability).not.toBeNull()

    const simulationResponse = await fetch(`${BFF}/back-office/billing/profitability:simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fapi-interaction-id': fapi(), authorization: billingToken },
      body: JSON.stringify({ period: month, scenario: scenario(month) })
    })
    expect(simulationResponse.status).toBe(200)
    const simulation = (await simulationResponse.json()) as { data: { scenario_id: string } }
    expect(simulation.data.scenario_id).toBe(`deploy-smoke-${month}`)
  })

  it('ships verifiable tenant-portability and CBUAE fee-review artifacts', async () => {
    const month = period()
    const portableResponse = await fetch(`${BFF}/back-office/billing/export`, {
      headers: { 'x-fapi-interaction-id': fapi(), authorization: billingToken }
    })
    expect(portableResponse.status).toBe(200)
    const portable = (await portableResponse.json()) as { data: Record<string, unknown> }
    expectDigest(portable.data)

    const reviewResponse = await fetch(`${BFF}/back-office/billing/exports:cbuae-fee-review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fapi-interaction-id': fapi(),
        'idempotency-key': `deploy-smoke-${randomUUID()}`,
        authorization: billingToken
      },
      body: JSON.stringify({ period: month, scenarios: [scenario(month)] })
    })
    expect(reviewResponse.status).toBe(200)
    const review = (await reviewResponse.json()) as { data: Record<string, unknown> }
    expectDigest(review.data)
  }, 30_000)

  /**
   * BILL-17 — the TPP Cost Management (payable) surface on the hosted demo.
   *
   * Asserts the TOTALS, not just a 200: the console's headline figures are derived from the payable
   * rows, so a read that succeeds while the arithmetic drifts is exactly the failure a status-code
   * smoke misses. Money is checked as integer MINOR units — the ledger's finer milli-fils must not
   * reach the wire (the CODE-03 ruling), and a period whose gross does not equal net + VAT would
   * mean the boundary conversion had gone wrong somewhere it is expensive to find later.
   *
   * Period-agnostic by design. The demo seed provisions the last two months relative to whenever it
   * ran, so pinning a month here would make the suite fail on the first of every month rather than
   * when something is actually broken.
   */
  it('serves the TPP cost-period surface with totals that tie out', async () => {
    const month = period()
    const res = await fetch(`${BFF}/back-office/billing/cost-periods/${month}`, {
      headers: { 'x-fapi-interaction-id': fapi(), authorization: billingToken }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        period: string
        close_state: string
        open_break_count: number
        blockers: Array<{ variance: { amount: number; currency: string } }>
        payables: Array<{
          net_amount: { amount: number; currency: string }
          vat_amount: { amount: number; currency: string }
          gross_amount: { amount: number; currency: string }
          cost_recipient_type: string
        }>
      }
    }
    const view = body.data
    expect(view.period).toBe(month)
    expect(['open', 'blocked', 'closed']).toContain(view.close_state)
    // Derived, never stored: a period carrying unresolved breaks and no close row IS blocked.
    if (view.close_state === 'blocked') expect(view.open_break_count).toBeGreaterThan(0)
    expect(view.open_break_count).toBe(view.blockers.length)

    for (const payable of view.payables) {
      for (const money of [payable.net_amount, payable.vat_amount, payable.gross_amount]) {
        // Integer minor units, per the binding convention. A milli-fils leak shows up here as a
        // non-integer or as a figure a thousand times too large.
        expect(Number.isInteger(money.amount)).toBe(true)
        expect(money.currency).toMatch(/^[A-Z]{3}$/)
      }
      expect(payable.gross_amount.amount).toBe(payable.net_amount.amount + payable.vat_amount.amount)
      expect(['nebras', 'underlying_lfi']).toContain(payable.cost_recipient_type)
    }
  }, 30_000)

  /**
   * The four-eyes rule, asserted as a REFUSAL to act inline.
   *
   * A close either returns `202` with an approval request — meaning nothing has closed and a second
   * principal must still act — or `409`, meaning the period is blocked or already shut. A `200`
   * would mean the period closed on one person's say-so, which is the single thing this control
   * exists to prevent, so it is called out by name rather than folded into a range check.
   */
  it('never closes a cost period inline — 202 with an approval, or a refusal', async () => {
    const res = await fetch(`${BFF}/back-office/billing/cost-periods/${period()}:close`, {
      method: 'POST',
      headers: {
        'x-fapi-interaction-id': fapi(),
        'idempotency-key': `deploy-smoke-close-${randomUUID()}`,
        authorization: billingToken
      }
    })
    expect(res.status).not.toBe(200)
    expect([202, 409]).toContain(res.status)
    const body = (await res.json()) as {
      data?: { approval_request_id?: string; state?: string; operation_type?: string }
      error?: { code?: string; remediation?: string }
    }
    if (res.status === 202) {
      expect(body.data?.operation_type).toBe('billing.tpp_cost.period_close')
      expect(body.data?.state).toBe('pending')
      expect(body.data?.approval_request_id).toBeTruthy()
    } else {
      // A refusal still has to tell the operator what to do about it.
      expect(body.error?.code).toBeTruthy()
      expect(body.error?.remediation).toBeTruthy()
    }
  }, 30_000)

  /**
   * BILL-17 — the governed evidence pack, with its digest recomputed INDEPENDENTLY.
   *
   * The acceptance criterion is that the hosted smoke recomputes the export digest rather than
   * trusting the one the service published. So the body is re-canonicalised and re-hashed here with
   * this file's own helper — the same thing a recipient holding only the downloaded file would do.
   * Note the digest here carries NO `sha256:` prefix, unlike the other billing artefacts: the pack
   * publishes a bare hex digest, and asserting the prefixed form would silently never match.
   */
  it('issues a TPP cost evidence pack whose digest an outside party can recompute', async () => {
    const month = period()
    const res = await fetch(`${BFF}/back-office/billing/tpp-cost-export?period=${month}`, {
      headers: { 'x-fapi-interaction-id': fapi(), authorization: billingToken }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    const { sha256, ...pack } = body.data
    expect(pack.period).toBe(month)
    expect(pack.schema_version).toBe('1')

    // Recomputed, not trusted.
    expect(sha256).toBe(createHash('sha256').update(canonicalJson(pack)).digest('hex'))

    // The counts must describe the collections beside them, or a truncated file would pass a
    // digest check while under-reporting what it contains.
    const counts = pack.record_counts as Record<string, number>
    for (const key of ['documents', 'reconciliations', 'diff_lines', 'closes', 'dispatches']) {
      expect(counts[key]).toBe((pack[key] as unknown[]).length)
    }

    // No PSU identifier can reach the payable ledger by construction. Asserted on the artefact a
    // human actually receives, not only on the rows behind it. Synthetic ranges only (CLAUDE.md):
    // real Emirates IDs start 784, so this shape-checks for one without embedding one.
    expect(JSON.stringify(pack)).not.toMatch(/\b784-\d{4}-\d{7}-\d\b/)
  }, 30_000)

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
