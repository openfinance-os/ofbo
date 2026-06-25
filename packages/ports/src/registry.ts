import type { PortMap } from './interfaces.js'
import { SIM_ADAPTERS } from './adapters/sim.js'
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
  'p9-financial-system',
  'p10-str-workflow'
] as const satisfies readonly PortName[]

/**
 * The ONLY place profile selection happens. Application core code calls
 * getAdapter(port, profileFromConfig()) — it never branches on the profile itself.
 * Enterprise adapters are written port-by-port at bank adoption (M6); each must
 * pass exactly the contract suite the simulator passes.
 */
export function getAdapter<K extends PortName>(port: K, profile: DeployProfile): PortMap[K] {
  if (profile === 'enterprise') throw new EnterpriseAdapterNotImplementedError(port)
  return SIM_ADAPTERS[port]
}

export function profileFromConfig(env: Record<string, string | undefined>): DeployProfile {
  const value = env.DEPLOY_PROFILE ?? 'demo'
  if (value !== 'demo' && value !== 'enterprise') {
    throw new Error(`DEPLOY_PROFILE must be demo|enterprise, got: ${value}`)
  }
  return value
}
