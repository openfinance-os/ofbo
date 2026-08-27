import { describe, expect, it } from 'vitest'
import { getAdapter, type OtelSpan } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { errorFrames, redactingLog } from '../src/telemetry.js'
import { FAPI_HEADERS, AUTHED_HEADERS, FIXED_UUID } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')

function build() {
  const spans: OtelSpan[] = []
  const apm = {
    exportSpans: async (batch: OtelSpan[]) => {
      spans.push(...batch)
    }
  }
  const app = createApp({ idp, apm })
  return { app, spans }
}

describe('BACKOFFICE-48 — OTel emission, x-fapi-interaction-id end-to-end', () => {
  it('emits one span per request with the fapi header as trace id', async () => {
    const { app, spans } = build()
    await app.request('/back-office/reconciliation/runs', { headers: AUTHED_HEADERS })
    expect(spans).toHaveLength(1)
    expect(spans[0]!.trace_id).toBe(FIXED_UUID)
    expect(spans[0]!.span_id).toBeTruthy()
    expect(spans[0]!.end_time >= spans[0]!.start_time).toBe(true)
  })

  it('records the ROUTE TEMPLATE, never the concrete path (no identifiers in telemetry)', async () => {
    const { app, spans } = build()
    await app.request(`/consents/${FIXED_UUID}:revoke-admin`, {
      method: 'POST',
      headers: { ...AUTHED_HEADERS, 'idempotency-key': FIXED_UUID }
    })
    expect(spans[0]!.attributes['http.route']).toBe('/consents/{consent_id}:revoke-admin')
    expect(JSON.stringify(spans[0]!.attributes)).not.toContain(FIXED_UUID)
  })

  it('marks 2xx/501 spans ok and 4xx auth failures as error with the status code attribute', async () => {
    const { app, spans } = build()
    await app.request('/back-office/analytics/onboarding-handover-health', { headers: AUTHED_HEADERS }) // 501 stub — instrumented, not an app error
    await app.request('/back-office/analytics/onboarding-handover-health', { headers: FAPI_HEADERS }) // 401
    expect(spans[0]!.attributes['http.status_code']).toBe(501)
    expect(spans[0]!.status_code).toBe('ok')
    expect(spans[1]!.attributes['http.status_code']).toBe(401)
    expect(spans[1]!.status_code).toBe('error')
  })

  it('still emits a span when the fapi header is missing (trace_id=untraced, 400 recorded)', async () => {
    const { app, spans } = build()
    await app.request('/back-office/reconciliation/runs')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.trace_id).toBe('untraced')
    expect(spans[0]!.attributes['http.status_code']).toBe(400)
  })

  it('unknown routes are spanned under a bounded name (no attacker-controlled cardinality)', async () => {
    const { app, spans } = build()
    await app.request('/not-a-route-with-secret-784-1990', { headers: AUTHED_HEADERS })
    expect(spans[0]!.attributes['http.route']).toBe('UNMATCHED')
    expect(JSON.stringify(spans[0]!)).not.toContain('secret')
  })

  it('redactingLog masks PII shapes before anything reaches the log stream', () => {
    // The SYNTHETIC issuer range (999), never the real 784 — CLAUDE.md's PII hard stop admits no
    // exemption for the real prefix, and redactText's pattern is prefix-agnostic
    // (\d{3}[-._ ]?\d{4}…), so 999 exercises the identical shape. Written as a plain literal
    // rather than assembled at runtime: a `.join('-')` would slip past pii-literal-check, which
    // matches file TEXT, and a convention that only holds while everyone remembers it is not one.
    const emiratesId = '999-1990-1234567-1'
    const lines: string[] = []
    redactingLog((l) => lines.push(l))('lookup', { trace_id: 't-1', note: `id ${emiratesId}` })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(emiratesId)
    expect(lines[0]).toContain('[REDACTED:emirates_id]')
    expect(lines[0]).toContain('t-1')
  })

  /**
   * BACKOFFICE-84 — a 500 used to log `error_name` and nothing else, so the error envelope's
   * promise ("quote the interaction id to support; it correlates to the server-side log") led to
   * a line naming no cause. Frames restore the diagnosable half WITHOUT the message, which is the
   * half that can quote the offending input.
   */
  describe('errorFrames', () => {
    it('captures code locations and never the message', () => {
      const psu = '999-1990-1234567-1' // synthetic range, plain literal — see above
      const frames = errorFrames(new Error(`lookup failed for ${psu}`))
      expect(frames).not.toContain(psu)
      expect(frames).not.toContain('lookup failed')
      // Bare `path:line:column`, with no `at ` and no function name — the free text a frame line
      // carries is never emitted, only its location.
      expect(frames).not.toContain('at ')
      expect(frames).toMatch(/telemetry\.spec\.ts:\d+:\d+/)
    })

    /**
     * A MULTI-LINE message is the case that breaks a naive "keep lines starting with at ".
     * `stack` is `Name: line1\nline2\n…\n    at frame`, so every continuation line of the message
     * reaches the filter on equal terms with the frames — and driver errors that append a
     * `detail:` are exactly the ones that quote the offending parameter. Dropping only the FIRST
     * line of the stack is not enough; a frame has to be recognised by its shape.
     */
    it('drops every line of a multi-line message, not just the first', () => {
      const psu = '999-1990-1234567-1'
      const error = new Error(
        `insert failed\n  detail: Key (psu_id)=(${psu}) already exists.\n  at the point of conflict`
      )
      const frames = errorFrames(error)
      expect(frames).not.toContain(psu)
      expect(frames).not.toContain('detail:')
      expect(frames).not.toContain('point of conflict')
      // …while still yielding the real locations, which is the whole reason the function exists.
      expect(frames).toMatch(/telemetry\.spec\.ts:\d+:\d+/)
    })

    /**
     * The adversarial case, and the reason the message is measured rather than pattern-matched.
     *
     * A shape filter — "starts with `at `, ends in `:line:col`" — is a guess about what a message
     * cannot look like, and this is a message that looks exactly like that. Driver and parser
     * errors quote source positions in precisely this form. Counting the message's own lines is
     * not a better guess; it is not a guess.
     */
    it('drops a message line that is shaped like a frame', () => {
      const psu = '999-1990-1234567-1'
      const error = new Error(`insert failed\n  at psu_id ${psu} in accounts.sql:12:5`)
      const frames = errorFrames(error)
      expect(frames).not.toContain(psu)
      expect(frames).not.toContain('accounts.sql')
      expect(frames).not.toContain('insert failed')
      expect(frames).toMatch(/telemetry\.spec\.ts:\d+:\d+/)
    })

    /**
     * When the arithmetic guard's PRECONDITION does not hold, there is nothing left to fall back
     * to that is worth trusting.
     *
     * Measuring the message out assumes `stack` opens with `Name: <message>`. A re-thrown error
     * with a rewritten stack, or a non-V8 runtime, breaks that — and then the only thing standing
     * is the shape filter, which this file documents as admitting a message line shaped like a
     * frame. Two guards are only two guards while both apply; on this path it is one, and it is
     * the fallible one.
     *
     * So emit nothing. Losing the frames costs a diagnostic; guessing costs the hard stop.
     */
    it('emits nothing when the stack does not open with the message', () => {
      const psu = '999-1990-1234567-1'
      const error = new Error('the real message')
      // A rewritten stack — the message is gone from the head, so counting its lines would slice
      // off frames and leave whatever follows.
      error.stack = `  at psu_id ${psu} in accounts.sql:12:5\n    at real (/app/x.ts:1:1)`
      const frames = errorFrames(error)
      expect(frames).not.toContain(psu)
      expect(frames).toBe('')
    })

    /**
     * The empty-message case, which an earlier cut of the precondition check skipped entirely:
     * `message !== '' && !head.includes(message)` never evaluates its second half when the message
     * is empty, so those errors fell through to the shape filter alone — the exact guard this
     * file documents as fallible.
     */
    /**
     * An empty message is the weakest position the head check can be in — it degenerates to
     * `head === error.name`, which a hand-written stack can satisfy trivially. So this asserts
     * what holds even there: whatever free text the stack's lines carry, only their LOCATION is
     * emitted.
     *
     * An earlier cut of this test asserted the opposite — that the contrived line's text SHOULD
     * appear — which documented the hole as intended behaviour instead of closing it. Asserting
     * that an identifier-shaped literal reaches the log is the wrong assertion to write down, and
     * it is why the location extraction replaced line-level filtering entirely.
     */
    it('emits only the location even when the message is empty', () => {
      const marker = 'caller-controlled-text'
      const error = new Error()
      error.stack = `Error\n  at ${marker} in accounts.sql:12:5`
      const frames = errorFrames(error)
      expect(frames).not.toContain(marker)
      expect(frames).toBe('accounts.sql:12:5')

      // …and a stack whose head is not what V8 would write is refused outright.
      const rewritten = new Error()
      rewritten.stack = `  at ${marker} in accounts.sql:12:5`
      expect(errorFrames(rewritten)).toBe('')
    })

    it('caps the frame count so one error cannot flood the log', () => {
      const frames = errorFrames(new Error('deep'), 2)
      expect(frames.split(' | ')).toHaveLength(2)
    })

    it('returns empty for a non-Error throw rather than inventing a stack', () => {
      expect(errorFrames('a bare string')).toBe('')
      expect(errorFrames(undefined)).toBe('')
    })
  })
})
