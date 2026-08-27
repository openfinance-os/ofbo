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

  // Measure the message out, and VERIFY the head is what V8 would have written — `Name: message`,
  // or bare `Name` when the message is empty. Where it is not, emit nothing.
  const head = lines.slice(0, messageLines).join('\n')
  if (head !== (message === '' ? error.name : `${error.name}: ${message}`)) return ''

  // Then keep ONLY the source location from each frame, never the line's free text.
  //
  // This is what makes the result safe rather than merely likely-safe. Every earlier cut emitted
  // whole lines and tried to decide which lines were trustworthy — first by prefix, then by shape,
  // then by requiring all of them to match. Each is a judgement about what text is safe to pass
  // through, and each was defeated by a line contrived to look like a frame:
  // `at psu_id 999-... in accounts.sql:12:5` satisfies all three.
  //
  // Extracting the location inverts that. `path:line:column` cannot carry free text by
  // construction, so it no longer matters what the rest of the line said or who wrote it — a
  // hand-written stack contributes a file position or contributes nothing. The function name is
  // the only thing lost, and a file and line already pinpoint the code it would have named.
  const locations: string[] = []
  for (const line of lines.slice(messageLines)) {
    if (line.trim() === '') continue
    if (!STACK_FRAME.test(line)) return '' // not a frame at all — the whole stack is untrusted
    const at = FRAME_LOCATION.exec(line)
    if (at?.[1]) locations.push(at[1])
    if (locations.length >= limit) break
  }
  return locations.join(' | ')
}

/**
 * A line that is structurally a stack frame. Kept as a VALIDATOR — one non-frame line condemns the
 * whole stack — but no longer the thing that decides what TEXT is emitted, which is the job
 * FRAME_LOCATION now does.
 *
 * `(<anonymous>)` is admitted because V8 genuinely emits it: `at new Promise (<anonymous>)` sits in
 * any stack that crosses a promise boundary, and rejecting it made the validator discard every
 * real stack. Found by probing an actual stack rather than reasoning about what one ought to look
 * like, which is the only way this pattern should ever be widened.
 */
const STACK_FRAME = /^\s*at\s+(?:.*:\d+:\d+\)?|.*\(<anonymous>\)|<anonymous>)\s*$/

/**
 * The source location inside a frame — the trailing `path:line:column` and nothing around it.
 * A native frame (`at new Promise (<anonymous>)`) has none and contributes nothing.
 */
const FRAME_LOCATION = /([^\s(]+:\d+:\d+)\)?\s*$/

/** Structured log emitter: every line passes redactText (zero PII in operational logs). */
// eslint-disable-next-line no-console -- this IS the sanctioned operational-log sink; the line is already redacted
export function redactingLog(write: (line: string) => void = (l) => console.log(l)) {
  return (message: string, fields: Record<string, string | number | boolean> = {}): void => {
    // key-based masking first (names/emails/phones), then shape-based over the whole line
    const line = JSON.stringify({ message, ...redactPii(fields), ts: new Date().toISOString() })
    write(redactText(line))
  }
}
