import { cookies } from 'next/headers'
import { cache } from 'react'
import { TENANT_COOKIE } from './cookies'

/**
 * HOST-01 scaffold (ADR 0028 / docs/proposals/multitenant-platform-blueprint.md §6) — the portal
 * side of the flagged three-tenant demo. This 3-entry registry MIRRORS `DEMO_TENANTS` in
 * `@ofbo/synthetic-data` (which the portal does not depend on); the slugs + labels must stay in
 * sync. The switch is a server-side cookie the portal forwards to the BFF as `x-ofbo-tenant`; the
 * BFF (MULTITENANT_DEMO=true) maps the slug to the tenant's bank_id and RLS does the isolation.
 * Zero-PII: a tenant slug is not PII.
 */
export interface PortalTenant {
  slug: string
  label: string
  short: string
  /** Semantic brand key → the `data-tenant` attribute the CSS accent keys off (token-only). */
  brand: 'indigo' | 'emerald' | 'teal'
  kind: 'bank' | 'insurer'
}

const ALPHA: PortalTenant = { slug: 'alpha-bank', label: 'Alpha Bank', short: 'Alpha', brand: 'indigo', kind: 'bank' }

export const PORTAL_TENANTS: readonly PortalTenant[] = [
  ALPHA,
  { slug: 'beta-bank', label: 'Beta Bank', short: 'Beta', brand: 'emerald', kind: 'bank' },
  { slug: 'gamma-takaful', label: 'Gamma Takaful', short: 'Gamma', brand: 'teal', kind: 'insurer' }
]

export const DEFAULT_PORTAL_TENANT: PortalTenant = ALPHA

/** The flag that turns the multi-tenant demo on. Off by default — the demo stays single-tenant. */
export function isMultiTenantDemo(): boolean {
  return process.env.MULTITENANT_DEMO === 'true'
}

export function portalTenantBySlug(slug: string | undefined): PortalTenant | undefined {
  return slug ? PORTAL_TENANTS.find((t) => t.slug === slug) : undefined
}

/**
 * The currently-selected demo tenant, read from the httpOnly cookie (validated against the
 * registry). Defaults to Alpha Bank. `cache()`d so repeated reads in one render are one cookie read.
 * Reading cookies() outside a request context (some build passes) is swallowed → default.
 */
export const getTenant = cache(async (): Promise<PortalTenant> => {
  try {
    const slug = (await cookies()).get(TENANT_COOKIE)?.value
    return portalTenantBySlug(slug) ?? DEFAULT_PORTAL_TENANT
  } catch {
    return DEFAULT_PORTAL_TENANT
  }
})
