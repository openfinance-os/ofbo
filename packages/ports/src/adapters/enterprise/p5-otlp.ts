import type { ApmPort, OtelSpan } from '../../interfaces.js'

/**
 * P5 enterprise adapter — OTLP/HTTP APM bridge (Datadog, Dynatrace, Grafana, New Relic, any
 * OTLP-compatible backend). Follows the ADR 0023 pattern. CLAUDE.md is explicit: OTel is canonical
 * and the enterprise APM is a BRIDGE off the OTel stream, never a second instrumentation path — so
 * this adapter just re-encodes the platform's OtelSpan batch as OTLP/HTTP JSON and ships it to the
 * configured collector. It does NOT instrument anything itself.
 *
 * Telemetry is best-effort: a transport failure must NEVER break the request that produced the
 * span, so exportSpans swallows transport errors (drops the batch) and resolves — exactly how a
 * real OTLP exporter behaves. The HTTP transport is an injected seam (fetch default; tests inject a
 * fake — no network, no new dependency).
 */

export interface OtlpHttp {
  post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number }>
}

export interface OtlpConfig {
  /** OTLP/HTTP traces endpoint, e.g. https://otlp.<vendor>.com (the /v1/traces suffix is appended). */
  endpoint: string
  /** Extra headers (auth), e.g. { 'dd-api-key': '…' } or { authorization: 'Bearer …' }. */
  headers?: Record<string, string>
  /** resource service.name (default 'ofbo-bff'). */
  serviceName?: string
  http: OtlpHttp
}

// ── OTLP/HTTP JSON encoding ───────────────────────────────────────────────────────────────────

/** OTLP trace/span ids are hex. The OFBO trace_id is the x-fapi-interaction-id (a UUID → 32 hex);
 *  span ids are opaque strings, so non-hex ids are derived deterministically to the required width. */
function hexId(input: string, bytes: number): string {
  const cleaned = input.replace(/-/g, '').toLowerCase()
  if (cleaned.length === bytes * 2 && /^[0-9a-f]+$/.test(cleaned)) return cleaned
  let h = 2166136261 >>> 0
  let out = ''
  let round = 0
  while (out.length < bytes * 2) {
    for (let c = 0; c < input.length; c++) {
      h ^= input.charCodeAt(c)
      h = Math.imul(h, 16777619) >>> 0
    }
    h = (Math.imul(h ^ round++, 16777619) >>> 0) >>> 0
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, bytes * 2)
}

function attrValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }
  return { stringValue: v }
}

function toKeyValues(attrs: Record<string, string | number | boolean>) {
  return Object.entries(attrs).map(([key, v]) => ({ key, value: attrValue(v) }))
}

// OtelSpan times are epoch ms (the platform convention); OTLP wants unix-nanos as a string.
const toNanos = (ms: number): string => String(Math.round(ms * 1_000_000))

function encodeSpan(s: OtelSpan) {
  return {
    traceId: hexId(s.trace_id, 16),
    spanId: hexId(s.span_id, 8),
    ...(s.parent_span_id ? { parentSpanId: hexId(s.parent_span_id, 8) } : {}),
    name: s.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: toNanos(s.start_time),
    endTimeUnixNano: toNanos(s.end_time),
    attributes: toKeyValues(s.attributes),
    status: { code: s.status_code === 'error' ? 2 : 1 } // STATUS_CODE_ERROR : STATUS_CODE_OK
  }
}

export class OtlpApmAdapter implements ApmPort {
  constructor(private readonly cfg: OtlpConfig) {}

  async exportSpans(spans: OtelSpan[]): Promise<void> {
    if (spans.length === 0) return
    const body = {
      resourceSpans: [
        {
          resource: { attributes: toKeyValues({ 'service.name': this.cfg.serviceName ?? 'ofbo-bff' }) },
          scopeSpans: [{ scope: { name: 'ofbo' }, spans: spans.map(encodeSpan) }]
        }
      ]
    }
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}/v1/traces`
    try {
      // Best-effort: drop the batch on any non-2xx or transport error — telemetry must never break
      // the request that produced it.
      await this.cfg.http.post(url, { 'content-type': 'application/json', ...(this.cfg.headers ?? {}) }, body)
    } catch {
      /* dropped — exactly as a real OTLP exporter does on a transient backend failure */
    }
  }
}

// ── fetch-backed transport (production default) ──────────────────────────────────────────────

export function fetchOtlpHttp(): OtlpHttp {
  return {
    async post(url, headers, body) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      return { status: res.status }
    }
  }
}

// ── Env factory ──────────────────────────────────────────────────────────────────────────────

export class OtlpConfigError extends Error {
  constructor(message: string) {
    super(`P5 OTLP APM adapter misconfigured: ${message}`)
    this.name = 'OtlpConfigError'
  }
}

/** Construct from configuration (registry calls this for DEPLOY_PROFILE=enterprise). Required:
 *  P5_OTLP_ENDPOINT. Optional: P5_OTLP_HEADERS (JSON header map, e.g. auth), P5_SERVICE_NAME. */
export function otlpApmFromEnv(env: Record<string, string | undefined>): OtlpApmAdapter {
  const endpoint = env.P5_OTLP_ENDPOINT
  if (!endpoint) throw new OtlpConfigError('P5_OTLP_ENDPOINT is required (the OTLP/HTTP collector base URL)')

  let headers: Record<string, string> | undefined
  if (env.P5_OTLP_HEADERS) {
    let parsed: unknown
    try {
      parsed = JSON.parse(env.P5_OTLP_HEADERS)
    } catch {
      throw new OtlpConfigError('P5_OTLP_HEADERS must be a JSON object of header name → value')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OtlpConfigError('P5_OTLP_HEADERS must be a JSON object of header name → value')
    }
    headers = Object.create(null)
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') throw new OtlpConfigError('P5_OTLP_HEADERS values must be strings')
      headers![k] = v
    }
  }

  return new OtlpApmAdapter({
    endpoint,
    ...(headers ? { headers } : {}),
    ...(env.P5_SERVICE_NAME ? { serviceName: env.P5_SERVICE_NAME } : {}),
    http: fetchOtlpHttp()
  })
}
