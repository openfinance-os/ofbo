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
import { TENANT_COOKIE } from './cookies'

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
  // Explicit injection (unit tests) always wins — and is left UNWRAPPED so tests see exactly the
  // headers they set (the tenant rider is a real-runtime concern, not a fixture one).
  if (deps.fetchImpl || deps.baseUrl) {
    return { base: (deps.baseUrl ?? LOCAL_BFF).replace(/\/$/, ''), f: deps.fetchImpl ?? fetch }
  }
  // Deployed: prefer the service binding (Worker→Worker over workers.dev loops back).
  const bound = serviceBindingFetch()
  if (bound) return { base: 'https://bff', f: withTenantHeader(bound) }
  // Local dev / non-Worker context: plain URL fetch.
  return { base: (process.env.BFF_URL ?? LOCAL_BFF).replace(/\/$/, ''), f: withTenantHeader(fetch) }
}

/**
 * HOST-01 scaffold (ADR 0028 / docs/proposals/multitenant-platform-blueprint.md §2.4, §6) — ride
 * the selected demo tenant on every BFF request as `x-ofbo-tenant`, read from the httpOnly cookie.
 * Injected here (the single fetch choke point) so no data-module call site changes. Outside a
 * request context (or with no cookie) it is a no-op; the BFF only honours the header when
 * MULTITENANT_DEMO is on, so this is inert in a normal single-tenant deployment. This is the demo
 * stand-in for the production path, where tenant is a verified claim on the authenticated principal.
 */
function withTenantHeader(baseFetch: Fetchish): Fetchish {
  return async (input, init) => {
    let slug: string | undefined
    try {
      // Dynamic import so `next/headers` is NEVER pulled into a client bundle (a static import
      // here poisons every client component that transitively imports this module). Server-only.
      const { cookies } = await import('next/headers')
      slug = (await cookies()).get(TENANT_COOKIE)?.value || undefined
    } catch {
      slug = undefined // not in a request context
    }
    if (!slug) return baseFetch(input, init)
    const headers = new Headers(init?.headers)
    headers.set('x-ofbo-tenant', slug)
    return baseFetch(input, { ...init, headers })
  }
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
