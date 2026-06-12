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

/** Structured log emitter: every line passes redactText (zero PII in operational logs). */
export function redactingLog(write: (line: string) => void = (l) => console.log(l)) {
  return (message: string, fields: Record<string, string | number | boolean> = {}): void => {
    // key-based masking first (names/emails/phones), then shape-based over the whole line
    const line = JSON.stringify({ message, ...redactPii(fields), ts: new Date().toISOString() })
    write(redactText(line))
  }
}
