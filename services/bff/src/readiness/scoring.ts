// Integration Readiness Wizard — deterministic scoring (ADR 0022).
// A port→system mapping + BD-01..16 answers in, a readiness digest out. No randomness, no clock
// dependence, no I/O — same input always yields the same digest (so it is fully unit-testable
// and safe to contract-test). PUBLIC: bank system-metadata only, never PSU data.

import {
  DECISIONS,
  PORTS,
  findOption,
  findPort,
  type CatalogPort,
  type EffortBand,
  type PortOption
} from './catalog.js'

export interface AssessmentInput {
  ports: Record<string, string>
  decisions?: Record<string, string>
}

export interface PortResult {
  id: string
  name: string
  chosen_system: string
  adapter_status: 'sim_ready' | 'enterprise_reference' | 'enterprise_to_write'
  contract_test_gate: string
  effort_band: EffortBand
  config_keys: string[]
}

export interface GovernanceResult {
  id: string
  title: string
  answer: string
  is_default: boolean
  blocker: string | null
}

export interface SequencingStep {
  step: number
  port: string
  system: string
  action: string
}

export interface ReadinessDigest {
  score: number
  verdict: string
  ports: PortResult[]
  governance: GovernanceResult[]
  generated_profile: Record<string, string>
  already_done: { sim_adapters_ready: number; ports_total: number; note: string }
  sequencing: SequencingStep[]
}

export class ReadinessInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const BAND_POINTS: Record<EffortBand, number> = { low: 100, medium: 70, scoping: 30 }
const NOT_SELECTED = 'Not selected yet'
// The M6 port-swap order (proposal §digest): auth first, then the egress that everything depends
// on, then the supporting estate. Built-in / declined ports drop out of the sequence.
const SWAP_ORDER = ['P2', 'P6', 'P3', 'P4', 'P7', 'P9', 'P1', 'P5', 'P8']

function validate(input: AssessmentInput): void {
  if (!input || typeof input !== 'object' || typeof input.ports !== 'object' || input.ports === null) {
    throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', 'A `ports` object mapping port id → option value is required.')
  }
  for (const [portId, value] of Object.entries(input.ports)) {
    const port = findPort(portId)
    if (!port) throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', `Unknown port id "${portId}".`)
    if (!findOption(port, value)) {
      throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', `Unknown option "${value}" for port ${portId}.`)
    }
  }
  if (input.decisions) {
    for (const [id, value] of Object.entries(input.decisions)) {
      if (!DECISIONS.some((d) => d.id === id)) {
        throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', `Unknown decision id "${id}".`)
      }
      // Public, persisted, no-PII-by-contract free-text sink — cap length to bound it (a policy
      // answer is short; a long paste is more likely PII/abuse than a real decision).
      if (typeof value === 'string' && value.length > 200) {
        throw new ReadinessInputError('BACKOFFICE.INVALID_READINESS_INPUT', `Decision ${id} answer exceeds 200 characters; use a short policy answer (no personal data).`)
      }
    }
  }
}

function portResult(port: CatalogPort, option: PortOption | undefined): PortResult {
  const builtin = Boolean(option?.builtin)
  return {
    id: port.id,
    name: port.name,
    chosen_system: option?.label ?? NOT_SELECTED,
    // Every port ships a reference enterprise adapter today (ADR 0023 P2 + ADR 0024's eight,
    // all wired in the ports registry), so a non-built-in choice is 'enterprise_reference', not
    // 'enterprise_to_write' — the remaining work is config + the per-bank production cutover (M6).
    // 'enterprise_to_write' is retained for any future port that ships without a reference.
    adapter_status: builtin ? 'sim_ready' : 'enterprise_reference',
    contract_test_gate: builtin ? 'No enterprise adapter — built-in / declined' : port.contract_test_gate,
    effort_band: option?.effort_band ?? 'scoping',
    config_keys: builtin ? [] : port.config_keys
  }
}

function verdictFor(score: number, weakest: PortResult | undefined): string {
  const tail = weakest ? ` Heaviest lift: ${weakest.id} ${weakest.name} (${weakest.chosen_system}).` : ''
  if (score >= 85) return `Mostly standard protocols — a fast path to production.${tail}`
  if (score >= 65) return `Achievable; a few ports need scoping before you commit a timeline.${tail}`
  return `Several ports need scoping — expect an integration-discovery phase first.${tail}`
}

function buildProfile(results: PortResult[], decisions: Record<string, string>): Record<string, string> {
  const profile: Record<string, string> = { DEPLOY_PROFILE: 'enterprise' }
  for (const r of results) {
    // one summary key per port reflecting the choice; the per-port config_keys above name the
    // full set an enterprise adapter wires.
    profile[`${r.id}_SYSTEM`] = r.chosen_system === NOT_SELECTED ? 'UNSET' : r.chosen_system
  }
  profile.BANK_RESIDENCY_REGION = decisions['BD-06']?.trim() ? slug(decisions['BD-06']) : 'me-central-1'
  profile.BANK_ID_SCOPE = /\bgroup\b/i.test(decisions['BD-12'] ?? '') ? 'group' : 'single'
  profile.FRAUD_REVOKE_FOUR_EYES = /\b(narrow|single)\b/i.test(decisions['BD-03'] ?? '') ? 'false' : 'true'
  return profile
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function sequencing(byId: Map<string, { port: CatalogPort; option: PortOption | undefined }>): SequencingStep[] {
  const steps: SequencingStep[] = []
  for (const portId of SWAP_ORDER) {
    const entry = byId.get(portId)
    if (!entry || !entry.option || entry.option.builtin) continue // unselected, built-in, or declined → no swap
    steps.push({
      step: steps.length + 1,
      port: portId,
      system: entry.option.label,
      action: `Configure the ${entry.port.name} reference adapter for ${entry.option.label} and production-harden it; pass ${entry.port.contract_test_gate}.`
    })
  }
  return steps
}

export function assess(input: AssessmentInput): ReadinessDigest {
  validate(input)
  const decisions = input.decisions ?? {}

  const byId = new Map<string, { port: CatalogPort; option: PortOption | undefined }>()
  const ports: PortResult[] = PORTS.map((port) => {
    const value = input.ports[port.id]
    const option = value ? findOption(port, value) : undefined
    byId.set(port.id, { port, option })
    return portResult(port, option)
  })

  const score = Math.round(ports.reduce((sum, r) => sum + BAND_POINTS[r.effort_band], 0) / ports.length)
  const weakest = [...ports].sort((a, b) => BAND_POINTS[a.effort_band] - BAND_POINTS[b.effort_band])[0]

  const governance: GovernanceResult[] = DECISIONS.map((d) => {
    const provided = decisions[d.id]
    const answer = provided?.trim() ? provided : d.default
    return {
      id: d.id,
      title: d.title,
      answer,
      is_default: !provided?.trim() || provided.trim() === d.default,
      blocker: d.blocks ?? null
    }
  })

  return {
    score,
    verdict: verdictFor(score, weakest),
    ports,
    governance,
    generated_profile: buildProfile(ports, decisions),
    already_done: {
      sim_adapters_ready: PORTS.length,
      ports_total: PORTS.length,
      note: `All ${PORTS.length} simulator adapters ship today and pass the port-swap contract suite — and every port also ships a reference enterprise adapter (ADR 0023/0024). For the systems you selected, the remaining work is configuration and the per-bank production cutover (M6), not building an adapter from scratch.`
    },
    sequencing: sequencing(byId)
  }
}
