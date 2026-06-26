import type { PortMap } from './interfaces.js'
import { SIM_ADAPTERS } from './adapters/sim.js'
import { entraIdpFromEnv } from './adapters/enterprise/p2-entra.js'
import { salesforceCareSurfaceFromEnv } from './adapters/enterprise/salesforce-care-surface.js'
import { serviceNowItsmFromEnv } from './adapters/enterprise/servicenow-itsm.js'
import { coreBankingFromEnv } from './adapters/enterprise/core-banking.js'
import { otlpApmFromEnv } from './adapters/enterprise/otlp-apm.js'
import { nebrasEgressFromEnv } from './adapters/enterprise/nebras-egress.js'
import { openLineageFromEnv } from './adapters/enterprise/openlineage.js'
import { onboardingHandoverFromEnv } from './adapters/enterprise/onboarding-handover.js'
import { financialSystemFromEnv } from './adapters/enterprise/financial-system.js'
import { EnterpriseAdapterNotImplementedError, type DeployProfile } from './types.js'

export type PortName = keyof PortMap

export const PORT_NAMES = [
  'p1-care-surface',
  'p2-identity-provider',
  'p3-itsm',
  'p4-core-banking',
  'p5-apm',
  'p6-nebras-egress',
  'p7-lineage',
  'p8-onboarding-handover',
  'p9-financial-system'
] as const satisfies readonly PortName[]

/**
 * Enterprise adapters land port-by-port at bank adoption (M6), or are pre-staged ahead of it
 * (ADR 0024). Each passes EXACTLY the contract suite its simulator passes (the port-swap
 * acceptance gate). P2 — Microsoft Entra ID — is the reference template; the other eight are
 * pre-staged at fidelity rung ③ (ADR 0024). Factories are lazy (constructed from config on
 * first use) and memoized; a configuration error is never cached, so a fixed env retries
 * cleanly. Every factory is FAIL-CLOSED — an unconfigured enterprise adapter throws a clear
 * config error, never a silent demo/fake fallback (a fake IdP or egress gateway under
 * DEPLOY_PROFILE=enterprise would be a security hazard).
 */
const ENTERPRISE_FACTORIES: Partial<{ [K in PortName]: () => PortMap[K] }> = {
  'p1-care-surface': () => salesforceCareSurfaceFromEnv(process.env),
  'p2-identity-provider': () => entraIdpFromEnv(process.env),
  'p3-itsm': () => serviceNowItsmFromEnv(process.env),
  'p4-core-banking': () => coreBankingFromEnv(process.env),
  'p5-apm': () => otlpApmFromEnv(process.env),
  'p6-nebras-egress': () => nebrasEgressFromEnv(process.env),
  'p7-lineage': () => openLineageFromEnv(process.env),
  'p8-onboarding-handover': () => onboardingHandoverFromEnv(process.env),
  'p9-financial-system': () => financialSystemFromEnv(process.env)
}
const enterpriseCache = new Map<PortName, unknown>()

/**
 * The ONLY place profile selection happens. Application core code calls
 * getAdapter(port, profileFromConfig()) — it never branches on the profile itself.
 */
export function getAdapter<K extends PortName>(port: K, profile: DeployProfile): PortMap[K] {
  if (profile === 'enterprise') {
    const factory = ENTERPRISE_FACTORIES[port]
    if (!factory) throw new EnterpriseAdapterNotImplementedError(port)
    if (!enterpriseCache.has(port)) enterpriseCache.set(port, factory()) // a config throw is not cached
    return enterpriseCache.get(port) as PortMap[K]
  }
  return SIM_ADAPTERS[port]
}

export function profileFromConfig(env: Record<string, string | undefined>): DeployProfile {
  const value = env.DEPLOY_PROFILE ?? 'demo'
  if (value !== 'demo' && value !== 'enterprise') {
    throw new Error(`DEPLOY_PROFILE must be demo|enterprise, got: ${value}`)
  }
  return value
}
