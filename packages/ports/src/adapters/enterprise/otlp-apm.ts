import type { ApmPort, OtelSpan } from '../../interfaces.js'

/**
 * P5 — Enterprise APM adapter via OTLP/HTTP (pre-staged per ADR 0024, fidelity rung ③).
 *
 * CLAUDE.md: "Enterprise APM is a bridge off the OTel stream, never a second
 * instrumentation path." This adapter IS that bridge — it forwards already-captured
 * spans to the bank's APM over OTLP/HTTP (the universal protocol ingested by Datadog,
 * Grafana/Tempo, Dynatrace, New Relic, Honeycomb, …). Vendor-neutral by construction:
 * the endpoint + auth headers are configuration / Bank Profile (ADR 0024 guardrail 3),
 * so no vendor is hardcoded — the contract is "speak OTLP", not "speak Datadog".
 *
 * Implements EXACTLY the P5 port contract (`exportSpans`) — nothing more (guardrail 1).
 * Transport is injectable; fail-closed when unconfigured — tests inject a fake OTLP
 * collector that validates the payload shape, so the contract exercises the real
 * map→serialize→POST path with no backend (guardrail 4 / rung ②). The bank's real
 * endpoint/credentials/residency are the M6 swap (rung ④).
 */

export interface OtlpApmConfig {
  /** Bank Profile — OTLP/HTTP traces endpoint, e.g. `https://otlp.bank.example/v1/traces`.
   *  Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
  endpoint?: string
  /** resource `service.name` (default `ofbo`). */
  serviceName?: string
  /** Bank Profile — static headers (e.g. an APM ingest key). */
  headers?: Record<string, string>
  /** Bank Profile — dynamic header provider (e.g. a rotating bearer); merged over `headers`. */
  getHeaders?: () => Promise<Record<string, string>>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

/** Thrown on a non-2xx from the OTLP collector. `retryable` on 429/5xx so the OTel
 *  export pipeline can back off (telemetry is best-effort, never blocks the request path). */
export class OtlpApmError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'OtlpApmError'
  }
}


/** FNV-1a 32-bit — deterministic, dependency-free, only used to derive valid hex ids
 *  when an inbound id isn't already hex (never for security). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** OTLP requires trace/span ids as fixed-length lowercase hex. x-fapi-interaction-id is a
 *  UUID (→ 32 hex once dashes are stripped); other ids are derived deterministically. */
function toHexId(input: string, hexLen: number): string {
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (cleaned.length >= hexLen) return cleaned.slice(0, hexLen)
  let out = ''
  for (let salt = 0; out.length < hexLen; salt++) out += fnv1a(`${input}:${salt}`).toString(16).padStart(8, '0')
  return out.slice(0, hexLen)
}

function attrValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }
  return { stringValue: v }
}

function toOtlpSpan(s: OtelSpan): Record<string, unknown> {
  const span: Record<string, unknown> = {
    traceId: toHexId(s.trace_id, 32), // trace_id IS x-fapi-interaction-id (per the port contract)
    spanId: toHexId(s.span_id, 16),
    name: s.name,
    // start/end are epoch-ms in the port shape; OTLP wants unix-nanos as a string.
    startTimeUnixNano: String(Math.round(s.start_time * 1e6)),
    endTimeUnixNano: String(Math.round(s.end_time * 1e6)),
    status: { code: s.status_code === 'error' ? 2 : 1 }, // STATUS_CODE_ERROR=2, _OK=1
    attributes: Object.entries(s.attributes).map(([key, value]) => ({ key, value: attrValue(value) }))
  }
  if (s.parent_span_id) span.parentSpanId = toHexId(s.parent_span_id, 16)
  return span
}

export function createOtlpApmAdapter(config: OtlpApmConfig = {}): ApmPort {
  // FAIL-CLOSED: no silent fake collector — exportSpans requires a configured endpoint
  // (the fail-closed env gate is otlpApmFromEnv). Transport is injectable for tests.
  const serviceName = config.serviceName ?? 'ofbo'
  const doFetch = config.fetchImpl ?? globalThis.fetch

  return {
    async exportSpans(spans) {
      if (spans.length === 0) return // nothing to bridge
      if (!config.endpoint) throw new OtlpApmError(0, false, 'OTLP endpoint is required (fail-closed — no fake collector under the enterprise profile)')
      const payload = {
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
            scopeSpans: [{ scope: { name: 'ofbo' }, spans: spans.map(toOtlpSpan) }]
          }
        ]
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...config.headers,
        ...(config.getHeaders ? await config.getHeaders() : {})
      }
      const res = await doFetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(payload) })
      if (!res.ok) {
        throw new OtlpApmError(res.status, res.status === 429 || res.status >= 500, `OTLP export → ${res.status}`)
      }
    }
  }
}

/** Build from the Bank Profile in the environment, honouring the standard OTEL_* vars.
 *  FAIL-CLOSED: throws when no OTLP endpoint is configured (never a silent fake collector). */
export function otlpApmFromEnv(env: NodeJS.ProcessEnv = process.env): ApmPort {
  const base = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? (env.OTEL_EXPORTER_OTLP_ENDPOINT ? `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces` : undefined)
  if (!base) throw new OtlpApmError(0, false, 'OTLP APM adapter misconfigured: set OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)')
  let headers: Record<string, string> | undefined
  if (env.OTEL_EXPORTER_OTLP_HEADERS) {
    // Standard format: comma-separated key=value pairs.
    headers = {}
    for (const pair of env.OTEL_EXPORTER_OTLP_HEADERS.split(',')) {
      const i = pair.indexOf('=')
      if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
    }
  }
  return createOtlpApmAdapter({ endpoint: base, serviceName: env.OTEL_SERVICE_NAME, headers })
}
