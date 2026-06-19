/**
 * Server-side BFF client resolution.
 *
 * A deployed Cloudflare Worker CANNOT reach another Worker via its public
 * `*.workers.dev` URL — the subrequest loops back to the caller (the portal's
 * own Next.js app, which 404s on /back-office/*). So when deployed we call the
 * BFF through its **service binding** (`env.BFF`), which routes Worker→Worker
 * directly. Local dev and unit tests have no binding and fall back to a URL
 * fetch: an injected baseUrl/fetchImpl (tests) or process.env.BFF_URL, defaulting
 * to the local BFF port.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'

export interface BffDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

type Fetchish = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface BffClient {
  base: string
  f: Fetchish
}

const LOCAL_BFF = 'http://localhost:8787'

export function bffClient(deps: BffDeps = {}): BffClient {
  // Explicit injection (unit tests) always wins.
  if (deps.fetchImpl || deps.baseUrl) {
    return { base: (deps.baseUrl ?? LOCAL_BFF).replace(/\/$/, ''), f: deps.fetchImpl ?? fetch }
  }
  // Deployed: prefer the service binding (Worker→Worker over workers.dev loops back).
  const bound = serviceBindingFetch()
  if (bound) return { base: 'https://bff', f: bound }
  // Local dev / non-Worker context: plain URL fetch.
  return { base: (process.env.BFF_URL ?? LOCAL_BFF).replace(/\/$/, ''), f: fetch }
}

/**
 * The BFF service-binding fetch when running inside a Cloudflare Worker request,
 * or null otherwise. `getCloudflareContext()` throws outside a Worker request
 * (local dev / tests) — we swallow that and fall back to URL fetch.
 */
function serviceBindingFetch(): Fetchish | null {
  try {
    const env = getCloudflareContext().env as unknown as { BFF?: { fetch: Fetchish } }
    if (env?.BFF) {
      const bff = env.BFF
      return (input, init) => bff.fetch(input, init)
    }
  } catch {
    // not in a Cloudflare request context — use URL fetch
  }
  return null
}
