import type { MiddlewareHandler } from 'hono'
import type { ApmPort, OtelSpan } from '@ofbo/ports'
import { matchRoute } from '@ofbo/contracts'
import { redactPii, redactText } from '@ofbo/redaction'

/**
 * BACKOFFICE-48: OTel emission with x-fapi-interaction-id as the end-to-end
 * trace id, exported via the P5 port (the APM is a bridge — never a second
 * instrumentation path). Spans carry the ROUTE TEMPLATE, never the concrete
 * path: identifiers must not reach telemetry (hard stop), and unmatched paths
 * collapse to a bounded name so attackers cannot inflate cardinality.
 */

export function createTelemetryMiddleware(apm: Pick<ApmPort, 'exportSpans'>): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    await next()
    const url = new URL(c.req.url)
    const match = matchRoute(c.req.method, url.pathname)
    const route = match ? match.path : 'UNMATCHED'
    const status = c.res.status
    const span: OtelSpan = {
      name: `${c.req.method} ${route}`,
      // redactText closes the one channel a client could use to push an identifier into telemetry
      trace_id: redactText(c.req.header('x-fapi-interaction-id') ?? 'untraced'),
      span_id: crypto.randomUUID(),
      start_time: start,
      end_time: Date.now(),
      // 501 is the contract-pending stub answer, not an application failure
      status_code: status >= 400 && status !== 501 ? 'error' : 'ok',
      attributes: {
        'http.method': c.req.method,
        'http.route': route,
        'http.status_code': status
      }
    }
    // telemetry must never take the request down
    try {
      await apm.exportSpans([span])
    } catch {
      /* P5 sink unavailable — the request outcome stands */
    }
  }
}

/**
 * The CODE LOCATIONS an error came from, without its message.
 *
 * A 500 used to log `error_name` and nothing else, so the envelope's promise — "quote the
 * interaction id to support; it correlates to the server-side log" — resolved to a log line
 * containing `"error_name": "Error"`. There was no cause anywhere, and diagnosing one meant
 * temporarily patching the handler to print the error.
 *
 * The message is the part that is unsafe: it can quote the offending input, which on this
 * codebase can be a PSU identifier. Stack FRAMES cannot — they are file paths, line numbers and
 * function names, fixed at build time and carrying no request data. So the frames are exactly the
 * diagnosable half, and dropping the first line of `stack` (which is `Name: message`) drops
 * exactly the unsafe half.
 *
 * Frames still pass through redactingLog like any other field, so a path that somehow contained a
 * PII shape would be masked anyway. Capped because a stack is unbounded and a log line is not.
 */
export function errorFrames(error: unknown, limit = 8): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return ''
  const message = typeof error.message === 'string' ? error.message : ''
  const lines = error.stack.split('\n')
  const messageLines = message === '' ? 1 : message.split('\n').length

  // VERIFY the precondition instead of assuming it, and verify it for EVERY error rather than
  // only the ones with a message. Measuring the message out is sound only while `stack` actually
  // opens with what V8 puts there — `Name: message`, or bare `Name` when the message is empty.
  // A re-thrown error with a rewritten stack, or a non-V8 runtime, breaks that, and then there is
  // no trustworthy guard left: the shape filter alone admits `at psu_id 999-… in accounts.sql:12:5`.
  //
  // Compared EXACTLY, not with `includes`, and with no short-circuit for the empty message — an
  // earlier cut guarded this with `message !== '' && …`, which meant an empty-message error never
  // had its precondition checked at all and fell through to the shape filter on its own.
  const head = lines.slice(0, messageLines).join('\n')
  if (head !== (message === '' ? error.name : `${error.name}: ${message}`)) return ''

  return lines
    .slice(messageLines)
    .filter((line) => STACK_FRAME.test(line))
    .slice(0, limit)
    .map((line) => line.trim())
    .join(' | ')
}

/**
 * Two independent guards, because one of them is a heuristic and the other is not.
 *
 * The message is REMOVED BY MEASUREMENT. `stack` opens with `Name: <message>`, so the message
 * occupies exactly `message.split('\n').length` leading lines and those lines are dropped without
 * inspecting them. That is arithmetic, not pattern-matching, and it cannot be defeated by what the
 * message happens to contain.
 *
 * Which matters, because the obvious alternatives can be. Filtering for lines that start with
 * `at ` keeps a continuation line reading `  at the point of conflict`. Tightening that to require
 * a trailing `:line:column` keeps `  at psu_id 999-… in accounts.sql:12:5` — and driver and parser
 * errors quote source positions in exactly that form, which is precisely the class of error that
 * also quotes the offending parameter. Any shape filter is a guess about what a message cannot
 * look like, and this function exists to keep message content out of the operational log.
 *
 * The shape filter stays, but only ever as a SECOND pass over lines the arithmetic has already
 * cleared — never as a fallback standing on its own. Where the precondition fails, `errorFrames`
 * returns nothing rather than letting the heuristic decide; that was the correction, because a
 * fallible guard reached exactly when the reliable one gives up is not defence in depth.
 */
const STACK_FRAME = /^\s*at\s+.*:\d+:\d+\)?\s*$/

/** Structured log emitter: every line passes redactText (zero PII in operational logs). */
// eslint-disable-next-line no-console -- this IS the sanctioned operational-log sink; the line is already redacted
export function redactingLog(write: (line: string) => void = (l) => console.log(l)) {
  return (message: string, fields: Record<string, string | number | boolean> = {}): void => {
    // key-based masking first (names/emails/phones), then shape-based over the whole line
    const line = JSON.stringify({ message, ...redactPii(fields), ts: new Date().toISOString() })
    write(redactText(line))
  }
}
