// Product maturity — what's built vs. what remains (ADR 0022, public). The companion to the
// readiness wizard: the wizard scores a given bank's estate; this shows how complete the product
// itself is. Deterministic + drift-free: ports are derived from the catalog (single source of
// truth), milestones are a stable constant tracking the PRD §9 build order. No PII.

import { PORTS } from './catalog.js'

export interface MaturityMilestone {
  id: string
  title: string
  status: 'done' | 'remaining'
  detail: string
}

export interface MaturityPort {
  id: string
  name: string
  sim_status: 'ready'
  enterprise_status: 'stub' | 'ready'
  contract_test_gate: string
}

export interface MaturitySummary {
  milestones: MaturityMilestone[]
  ports: MaturityPort[]
  summary: {
    milestones_total: number
    milestones_done: number
    ports_total: number
    sim_adapters_ready: number
    enterprise_adapters_remaining: number
    note: string
  }
}

// PRD §9 build order. M0–M5 are delivered and demonstrable on the live demo; M6 (per-bank
// enterprise port-swaps) is the remaining milestone — exactly the work the readiness wizard sizes.
const MILESTONES: MaturityMilestone[] = [
  { id: 'M0', title: 'Foundation', status: 'done', detail: 'Repo, CI gates, schema + RLS, synthetic data, port interfaces.' },
  { id: 'M1', title: 'Substrate + live demo', status: 'done', detail: 'IdP federation, admin scopes, audit + four-eyes, Nebras simulator, auto-deploy.' },
  { id: 'M2', title: 'Customer Care', status: 'done', detail: 'PSU search, consent revocation, dispute + four-eyes refund, 24-month audit timeline.' },
  { id: 'M3', title: 'Reconciliation', status: 'done', detail: 'Three-way matching, break workflow, monthly close, CBUAE export.' },
  { id: 'M4', title: 'Analytics & Reports', status: 'done', detail: 'Five views, report generator, liability monitor, TPP billing.' },
  { id: 'M5', title: 'Hardening', status: 'done', detail: 'Accessibility, SLO surfacing, certificate-expiry monitor, mutation testing.' },
  { id: 'M6', title: 'Enterprise port-swaps', status: 'remaining', detail: 'Per-bank: write the 9 enterprise adapters, each passing the contract suite its simulator passes.' }
]

// Ports that already ship a reference enterprise adapter. All nine now do: P2 — Microsoft Entra ID —
// is the worked reference (ADR 0023); the other eight were pre-staged to the same fidelity rung ③
// (sandbox-validated, config-from-env, registry-wired, contract-green) under ADR 0024. 'ready' here
// means "a reference adapter ships and swaps via config" — the per-bank production cutover is still
// M6 (which stays a remaining milestone above); it is not a claim that M6 is done.
const ENTERPRISE_READY = new Set<string>(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'])

export function getMaturity(): MaturitySummary {
  const ports: MaturityPort[] = PORTS.map((p) => ({
    id: p.id,
    name: p.name,
    sim_status: 'ready',
    // 'ready' = a reference enterprise adapter ships (config + swap); 'stub' = M6 work per bank.
    enterprise_status: ENTERPRISE_READY.has(p.id) ? 'ready' : 'stub',
    contract_test_gate: p.contract_test_gate
  }))
  const milestonesDone = MILESTONES.filter((m) => m.status === 'done').length
  const enterpriseRemaining = ports.filter((p) => p.enterprise_status === 'stub').length
  return {
    milestones: MILESTONES,
    ports,
    summary: {
      milestones_total: MILESTONES.length,
      milestones_done: milestonesDone,
      ports_total: ports.length,
      sim_adapters_ready: ports.length,
      enterprise_adapters_remaining: enterpriseRemaining,
      note: `${milestonesDone} of ${MILESTONES.length} milestones delivered and live on the demo. All ${ports.length} simulator adapters ship today, and all ${ports.length} ports now carry a reference enterprise adapter (sandbox-validated, config-and-swap; ADR 0023/0024) — each inheriting the same contract tests its simulator already passes. M6 remains: the per-bank production cutover that hardens each reference adapter against the institution's live system.`
    }
  }
}
