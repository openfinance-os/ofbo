import type { LineagePort } from '../../interfaces.js'

/**
 * P7 — Enterprise data-catalogue lineage adapter via OpenLineage (pre-staged per ADR 0023,
 * fidelity rung ③).
 *
 * Emits the column-level BCBS 239 write-time lineage (the Q4.5 obligation) to the bank's
 * data catalogue using OpenLineage — the de-facto open standard ingested by Marquez,
 * DataHub, Collibra, Atlan and Microsoft Purview. Vendor-neutral by construction (ADR 0023
 * guardrail 3): the endpoint + namespace + auth are configuration / Bank Profile, so the
 * contract is "speak OpenLineage", not "speak <catalogue>".
 *
 * Implements EXACTLY the P7 port contract (`emitLineage`) — nothing more (guardrail 1).
 * Transport is injectable; with no endpoint configured it binds an in-memory fake catalogue
 * that validates the RunEvent shape, so the contract exercises the real map→serialize→POST
 * path with no backend (guardrail 4 / rung ②). The bank's real catalogue/credentials/
 * residency are the M6 swap (rung ④).
 */

const OL_SCHEMA_URL = 'https://openlineage.io/spec/2-0-2/OpenLineage.json'
const DEFAULT_PRODUCER = 'https://github.com/openfinance-os/ofbo'

export interface OpenLineageConfig {
  /** Bank Profile — OpenLineage HTTP endpoint base, e.g. `https://marquez.bank.example`
   *  (the adapter POSTs to `<endpoint>/api/v1/lineage`). When unset, the in-memory fake
   *  catalogue is used (contract/test context). */
  endpoint?: string
  /** Job namespace (the producing system), default `ofbo`. */
  namespace?: string
  /** Dataset namespace (the store the table lives in), default `ofbo-postgres`. */
  datasetNamespace?: string
  /** OpenLineage `producer` URI (default the OFBO repo). */
  producer?: string
  /** Bank Profile — static headers (e.g. a catalogue ingest key). */
  headers?: Record<string, string>
  /** Bank Profile — dynamic header provider; merged over `headers`. */
  getHeaders?: () => Promise<Record<string, string>>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

/** Thrown on a non-2xx from the catalogue. `retryable` on 429/5xx so the emitter can back
 *  off — lineage is part of the Q4.5 Definition of Done and must not be silently dropped. */
export class OpenLineageError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'OpenLineageError'
  }
}

const FAKE_ENDPOINT = 'https://fake.openlineage.invalid'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** OpenLineage `run.runId` must be a UUID. trace_id IS the x-fapi-interaction-id (a UUID);
 *  if a non-UUID id is ever passed, shape its hex deterministically into UUID form so the
 *  run is still correlatable rather than rejected. */
function toRunId(traceId: string): string {
  if (UUID_RE.test(traceId)) return traceId.toLowerCase()
  const hex = traceId.replace(/[^0-9a-fA-F]/g, '').toLowerCase().padEnd(32, '0').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Deterministic in-memory OpenLineage catalogue — validates the RunEvent is well-formed
 *  and returns 201, so the adapter's real serialize+POST path runs with no backend (rung ②). */
const fakeOpenLineageFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
  const okShape = body.eventType && body.run && Array.isArray(body.outputs) && body.producer
  if (!/\/api\/v1\/lineage$/.test(url) || (init?.method ?? 'GET') !== 'POST' || !okShape) {
    return new Response(JSON.stringify({ error: 'malformed OpenLineage RunEvent' }), { status: 400 })
  }
  return new Response(null, { status: 201 })
}

export function createOpenLineageAdapter(config: OpenLineageConfig = {}): LineagePort {
  const real = Boolean(config.endpoint)
  const endpoint = config.endpoint ?? FAKE_ENDPOINT
  const namespace = config.namespace ?? 'ofbo'
  const datasetNamespace = config.datasetNamespace ?? 'ofbo-postgres'
  const producer = config.producer ?? DEFAULT_PRODUCER
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeOpenLineageFetch)

  return {
    async emitLineage({ table, columns, source, trace_id }) {
      const facetMeta = { _producer: producer, _schemaURL: OL_SCHEMA_URL }
      const runEvent = {
        eventType: 'COMPLETE',
        eventTime: new Date(Date.now()).toISOString(),
        producer,
        schemaURL: OL_SCHEMA_URL,
        run: {
          runId: toRunId(trace_id),
          // Carry the x-fapi-interaction-id verbatim so the catalogue ties lineage back to
          // the originating FAPI transaction (BCBS 239 traceability).
          facets: { ofbo_trace: { ...facetMeta, fapi_interaction_id: trace_id } }
        },
        job: { namespace, name: source }, // source = the writing process (e.g. recon-engine)
        inputs: [],
        outputs: [
          {
            namespace: datasetNamespace,
            name: table,
            facets: {
              // Column-level schema = the write-time column lineage this port exists to emit.
              schema: { ...facetMeta, fields: columns.map((name) => ({ name })) }
            }
          }
        ]
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...config.headers,
        ...(config.getHeaders ? await config.getHeaders() : {})
      }
      const res = await doFetch(`${endpoint}/api/v1/lineage`, { method: 'POST', headers, body: JSON.stringify(runEvent) })
      if (!res.ok) {
        throw new OpenLineageError(res.status, res.status === 429 || res.status >= 500, `OpenLineage emit → ${res.status}`)
      }
    }
  }
}

/** Build from the Bank Profile in the environment. With no OPENLINEAGE_URL set, binds the
 *  fake catalogue (contract/test context). Honours the standard OPENLINEAGE_* vars. */
export function openLineageFromEnv(env: NodeJS.ProcessEnv = process.env): LineagePort {
  let headers: Record<string, string> | undefined
  if (env.OPENLINEAGE_API_KEY) headers = { authorization: `Bearer ${env.OPENLINEAGE_API_KEY}` }
  return createOpenLineageAdapter({
    endpoint: env.OPENLINEAGE_URL,
    namespace: env.OPENLINEAGE_NAMESPACE,
    headers
  })
}
