import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * BACKOFFICE-55 acceptance: the IaC module is region-parameterised from day one
 * — "the same module deploys to any approved region per the bank's residency
 * assessment" (PRD §7), UAE region for regulated production data (BD-06). These
 * checks are static (no Terraform binary), so they gate every PR in CI Q1.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

const versions = read('versions.tf')
const variables = read('variables.tf')
const main = read('main.tf')
const outputs = read('outputs.tf')
const uaeTfvars = read('environments/enterprise.uae.tfvars')

// Region tokens that, if they appeared in the module BODY, would mean a region
// was hardcoded instead of parameterised.
const REGION_TOKENS = [
  'me-central-1',
  'me-south-1',
  'uaenorth',
  'uaecentral',
  'me-central1',
  'us-east-1',
  'eu-west-1',
  'ap-northeast-2'
]

describe('BACKOFFICE-55 — region-parameterised IaC skeleton', () => {
  it('pins Terraform >= 1.9 (cross-variable validation for the residency guard)', () => {
    expect(versions).toMatch(/required_version\s*=\s*">=\s*1\.9/)
  })

  it('declares region as a required input variable (no default)', () => {
    expect(variables).toMatch(/variable\s+"region"\s*{/)
    // the region block must not carry a default — it is supplied per deployment
    const block = variables.slice(variables.indexOf('variable "region"'))
    expect(block).not.toMatch(/default\s*=/)
  })

  it('enforces residency: region is validated against the approved residency set', () => {
    expect(variables).toMatch(/variable\s+"approved_residency_regions"/)
    expect(variables).toMatch(/contains\(var\.approved_residency_regions,\s*var\.region\)/)
  })

  it('defaults the approved set to UAE regions (BD-06: UAE for regulated prod)', () => {
    expect(variables).toMatch(/me-central-1/) // AWS UAE
    expect(variables).toMatch(/uaenorth/) // Azure UAE
  })

  it('threads region only through var.region — no hardcoded region in the module body', () => {
    expect(main).toMatch(/var\.region/)
    for (const token of REGION_TOKENS) {
      expect(main, `main.tf must not hardcode region "${token}"`).not.toContain(token)
      expect(outputs, `outputs.tf must not hardcode region "${token}"`).not.toContain(token)
    }
  })

  it('region-aware naming derives from region (parallel regional deploys cannot collide)', () => {
    expect(main).toMatch(/name_prefix\s*=\s*".*\$\{var\.region\}.*"/)
  })

  it('asserts residency for the regulated profile with a check block', () => {
    expect(main).toMatch(/check\s+"data_residency"\s*{/)
    expect(main).toMatch(/var\.deploy_profile\s*==\s*"enterprise"/)
  })

  it('exposes the resolved region and residency status as outputs', () => {
    expect(outputs).toMatch(/output\s+"region"/)
    expect(outputs).toMatch(/output\s+"residency_compliant"/)
  })

  it('ships a UAE production tfvars whose region is within the approved set', () => {
    const m = uaeTfvars.match(/region\s*=\s*"([^"]+)"/)
    expect(m, 'enterprise.uae.tfvars must set region').not.toBeNull()
    const region = m![1]!
    // the chosen UAE region must be one the module's default approved set admits
    expect(variables).toContain(region)
    expect(region).toBe('me-central-1')
  })
})
