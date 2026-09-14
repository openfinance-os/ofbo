// Tests for the shipped base profiles. Node runner: `node --test`.
//
// rc.26 added `standard`, a non-bank base. Until then `regulated-bank` was the only one, which
// made the floor of the profile system a bank: a team building software with AI under ordinary
// engineering discipline had to take on a bank's approver set to adopt anything at all.
//
// The invariant that makes two bases safe rather than confusing is a SUBSET relation, and it is
// the only thing here worth being strict about:
//
//   at every tier, `standard` requires a subset of what `regulated-bank` requires.
//
// Break it and a REGULATED adopter misses a control an unregulated one gets — which is incoherent
// on its face and the fastest way to make the whole profile system untrustworthy. It is also an
// easy mistake: adding a good gate to `standard` without checking the stronger profile has it
// feels like tightening. It is not. Add to regulated-bank first, then here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, compile, loadProfiles } from './policy-compiler.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRESENT = existsSync(resolve(HARNESS, 'profiles/standard.json'));

const envelope = (profile, risk_tier) => ({
  change_id: 'CHG-TEST', product_id: 'PRD-TEST', change_type: 'software-change',
  risk_tier, required_profiles: [profile],
});

function planFor(profile, tier) {
  const { profiles, findings } = loadProfiles([profile], HARNESS);
  assert.deepEqual(findings, [], `profile ${profile} did not load`);
  const { plan, findings: compiled } = compile(envelope(profile, tier), profiles);
  assert.ok(plan, `compile failed for ${profile}/${tier}: ${compiled.join('; ')}`);
  return plan;
}

/** Requirement lists are arrays; capabilities is an object keyed by capability name. */
const names = (v) => (Array.isArray(v) ? v : Object.keys(v || {}));
const FIELDS = ['required_gates', 'required_approver_roles', 'required_evidence', 'required_capabilities'];

test('both base profiles load and compile at every tier', { skip: !PRESENT && 'standard profile not installed' }, () => {
  for (const p of ['standard', 'regulated-bank']) for (const t of TIERS) assert.ok(planFor(p, t));
});

test('INVARIANT — standard requires a SUBSET of regulated-bank at every tier', { skip: !PRESENT && 'standard profile not installed' }, () => {
  for (const tier of TIERS) {
    const s = planFor('standard', tier);
    const r = planFor('regulated-bank', tier);
    for (const f of FIELDS) {
      const extra = names(s[f]).filter((x) => !names(r[f]).includes(x));
      assert.deepEqual(extra, [], `standard/${tier} requires ${f} that regulated-bank does not: ${extra.join(', ')} — add it to regulated-bank first`);
    }
  }
});

test('standard is genuinely lighter — it is not regulated-bank under another name', { skip: !PRESENT && 'standard profile not installed' }, () => {
  // A "non-bank" base that compiled to the same plan would be a rename, not a fix.
  const s = planFor('standard', 'high');
  const r = planFor('regulated-bank', 'high');
  assert.ok(names(r.required_gates).length > names(s.required_gates).length, 'the bank profile should require more gates at high');
  assert.ok(names(r.required_approver_roles).length > names(s.required_approver_roles).length, 'the bank profile should require more approvers at high');
});

test('standard carries the warp, and none of the regulator-facing apparatus', { skip: !PRESENT && 'standard profile not installed' }, () => {
  const low = planFor('standard', 'low');
  // The warp — the part that makes the method work at all — is present from the lowest tier.
  for (const g of ['D', 'Q']) assert.ok(names(low.required_gates).includes(g), `standard/low must carry ${g}`);
  // What a regulated entity owes its regulator is deliberately absent, at EVERY tier: asserting
  // it here would be exactly the overstatement this method exists to refuse.
  for (const tier of TIERS) {
    const gates = names(planFor('standard', tier).required_gates);
    for (const g of ['PA1', 'PA2', 'A', 'R', 'second-line-hold']) {
      assert.ok(!gates.includes(g), `standard/${tier} must not require ${g} — that is a regulated obligation`);
    }
  }
});

test('regulated-bank still requires its full apparatus at high (standard did not weaken it)', () => {
  const gates = names(planFor('regulated-bank', 'high').required_gates);
  for (const g of ['D', 'Q', 'PA1', 'PA2', 'A', 'product-eval']) {
    assert.ok(gates.includes(g), `regulated-bank/high lost ${g}`);
  }
});

test('tiers are cumulative in both bases — a higher tier only adds', () => {
  for (const p of ['standard', 'regulated-bank']) {
    if (p === 'standard' && !PRESENT) continue;
    for (let i = 1; i < TIERS.length; i++) {
      const lower = names(planFor(p, TIERS[i - 1]).required_gates);
      const higher = names(planFor(p, TIERS[i]).required_gates);
      const lost = lower.filter((g) => !higher.includes(g));
      assert.deepEqual(lost, [], `${p}/${TIERS[i]} dropped ${lost.join(', ')} that ${TIERS[i - 1]} required`);
    }
  }
});
