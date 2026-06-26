import type { PortMap } from '../../interfaces.js'
import { serviceNowItsmFromEnv } from './servicenow-itsm.js'
import { salesforceCareSurfaceFromEnv } from './salesforce-care-surface.js'
import { otlpApmFromEnv } from './otlp-apm.js'
import { openLineageFromEnv } from './openlineage.js'

/**
 * Pre-staged enterprise adapters (ADR 0023). Only ports written ahead of their M6 swap
 * appear here; everything else stays a stub (registry throws EnterpriseAdapterNotImplemented).
 * Each entry must pass EXACTLY the port-contract suite the simulator passes (the M6
 * port-swap acceptance gate).
 *
 * Built from the Bank Profile in the environment. In demo/contract context (no vendor
 * env set) each adapter binds its in-memory fake transport — a real tenant is NEVER wired
 * into the demo profile (ADR 0023 guardrail 4); demo selects the sim adapters, not these.
 */
export const ENTERPRISE_ADAPTERS: Partial<PortMap> = {
  'p1-care-surface': salesforceCareSurfaceFromEnv(),
  'p3-itsm': serviceNowItsmFromEnv(),
  'p5-apm': otlpApmFromEnv(),
  'p7-lineage': openLineageFromEnv()
}
