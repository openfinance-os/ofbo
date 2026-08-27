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
  return error.stack
    .split('\n')
    .filter((line) => STACK_FRAME.test(line))
    .slice(0, limit)
    .map((line) => line.trim())
    .join(' | ')
}

/**
 * A frame is recognised by its SHAPE, not by starting with `at `.
 *
 * `stack` is `Name: message\n…frames`, so dropping the first line only removes a SINGLE-line
 * message. A multi-line one — an aggregated validation error, or a driver error that appends a
 * `detail:` naming the offending parameter — puts its continuation lines in front of the filter on
 * equal terms with the frames, and a line reading `  at the point of conflict` sails through a
 * `startsWith('at ')` test carrying message content into the log this function exists to keep it
 * out of.
 *
 * Requiring the trailing `:line:column` is what separates them: every V8 frame ends in one, and
 * prose essentially never does.
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
