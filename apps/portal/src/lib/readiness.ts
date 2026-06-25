/**
 * Integration Readiness Wizard data layer (ADR 0022). PUBLIC, pre-login: these call the BFF's
 * `/public/readiness/*` endpoints with NO Bearer token (the wizard is the prospect hook, reachable
 * with no account). Server-side only, like every BFF call — the browser talks to Next route
 * handlers that proxy here, never to the BFF directly. Bank system-metadata only; no PII.
 */
import { bffClient, type BffDeps } from './bff'
import type { components } from '@ofbo/contracts'
import type { AssertContract, KeysConformToContract } from './contract-types'

type Schemas = components['schemas']
export type ReadinessCatalog = Schemas['ReadinessCatalog']
export type ReadinessAssessmentInput = Schemas['ReadinessAssessmentInput']
export type ReadinessDigest = Schemas['ReadinessDigest']
export type ReadinessProfile = Schemas['ReadinessProfile']
export type ReadinessPortResult = Schemas['ReadinessPortResult']
export type ReadinessGovernanceResult = Schemas['ReadinessGovernanceResult']
export type CatalogPort = Schemas['ReadinessCatalogPort']
export type CatalogDecision = Schemas['ReadinessCatalogDecision']

export interface ReadinessApiDeps extends BffDeps {
  traceId?: string
}

export class ReadinessApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation?: string | null
  ) {
    super(message)
  }
}

function resolve(deps: ReadinessApiDeps) {
  return { ...bffClient(deps), trace: deps.traceId ?? crypto.randomUUID() }
}

// PUBLIC: a trace id for end-to-end correlation, but NO authorization header.
const publicHeaders = (trace: string) => ({ 'x-fapi-interaction-id': trace, 'content-type': 'application/json' })

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string; remediation?: string }
  }
  if (!res.ok) {
    throw new ReadinessApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.remediation)
  }
  return body.data as T
}

export async function getReadinessCatalog(deps: ReadinessApiDeps = {}): Promise<ReadinessCatalog> {
  const { base, f, trace } = resolve(deps)
  return unwrap<ReadinessCatalog>(await f(`${base}/public/readiness/catalog`, { headers: publicHeaders(trace) }))
}

export async function assessReadiness(input: ReadinessAssessmentInput, deps: ReadinessApiDeps = {}): Promise<ReadinessDigest> {
  const { base, f, trace } = resolve(deps)
  return unwrap<ReadinessDigest>(
    await f(`${base}/public/readiness:assess`, { method: 'POST', headers: publicHeaders(trace), body: JSON.stringify(input) })
  )
}

export async function saveReadinessProfile(name: string, input: ReadinessAssessmentInput, deps: ReadinessApiDeps = {}): Promise<ReadinessProfile> {
  const { base, f, trace } = resolve(deps)
  return unwrap<ReadinessProfile>(
    await f(`${base}/public/readiness/profiles`, { method: 'POST', headers: publicHeaders(trace), body: JSON.stringify({ name, input }) })
  )
}

export async function getReadinessProfile(slug: string, deps: ReadinessApiDeps = {}): Promise<ReadinessProfile> {
  const { base, f, trace } = resolve(deps)
  return unwrap<ReadinessProfile>(
    await f(`${base}/public/readiness/profiles/${encodeURIComponent(slug)}`, { headers: publicHeaders(trace) })
  )
}

// ADR-0004 drift guards — fail typecheck if the contract renames/removes a field the wizard reads.
type PortResultView = { id: string; name: string; chosen_system: string; adapter_status: string; contract_test_gate: string; effort_band: string; config_keys: string[] }
export type PortResultGuard = AssertContract<KeysConformToContract<PortResultView, ReadinessPortResult>>
