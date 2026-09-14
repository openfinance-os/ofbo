// W1 — mandatory-when-compiled: a capability optional for a generic repo becomes REQUIRED
// once a compiled plan asks for it, and its absence then fails (closes F3). Node `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as productEvalRun } from './product-eval-check.mjs';
import { run as decisionLogRun } from './decision-log-check.mjs';
import { run as assuranceCycleRun } from './assurance-cycle-check.mjs';
import { run as providerSelectionRun } from './provider-selection-check.mjs';
import { run as featureFlagRun } from './feature-flag-check.mjs';

// A tmp repo with one governed change whose compiled plan requires `families`.
function repoRequiring(families, state = 'in-delivery') {
  const dir = mkdtempSync(join(tmpdir(), 'mwc-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: state, control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: families, required_evidence: [] }));
  return dir;
}

// The same, for a plan requiring a CAPABILITY rather than a gate family, plus the role catalog
// the capability is bound to. (rc.20 — the base profile declares `sca` at high tier.)
function repoRequiringCapability(capability) {
  const dir = mkdtempSync(join(tmpdir(), 'mwc-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  mkdirSync(join(dir, 'docs/governance/adapters/providers'), { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: [], required_evidence: [], required_capabilities: { [capability]: { required: true } } }));
  writeFileSync(join(dir, 'docs/governance/adapters/providers/roles.json'), JSON.stringify({ roles: [{ role: 'sca', control: 'Q4-SUPPLY', capability: 'sca' }] }));
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('product-eval: absent is OK with no requirement, FAILS when a plan requires it', () => {
  const generic = mkdtempSync(join(tmpdir(), 'mwc-'));
  try { assert.deepEqual(productEvalRun(generic).findings, []); } finally { clean(generic); }
  const req = repoRequiring(['product-eval']);
  try {
    const { findings } = productEvalRun(req);
    assert.ok(findings.some((f) => /a compiled plan requires product evals \[CHG-1\]/.test(f)));
  } finally { clean(req); }
});

test('decision-log: absent is OK with no requirement, FAILS when a plan requires it', () => {
  const generic = mkdtempSync(join(tmpdir(), 'mwc-'));
  try { assert.deepEqual(decisionLogRun(generic), []); } finally { clean(generic); }
  const req = repoRequiring(['decision-log']);
  try {
    assert.ok(decisionLogRun(req).some((f) => /a compiled plan requires one \[CHG-1\]/.test(f)));
  } finally { clean(req); }
});

test('assurance-cycle: absent FAILS when a plan requires cadence, or anything is in production', () => {
  const generic = mkdtempSync(join(tmpdir(), 'mwc-'));
  try { assert.deepEqual(assuranceCycleRun(generic).findings, []); } finally { clean(generic); }
  const req = repoRequiring(['assurance-cadence']);
  try {
    assert.ok(assuranceCycleRun(req).findings.some((f) => /requires assurance cadence \[CHG-1\]/.test(f)));
  } finally { clean(req); }
  const prod = repoRequiring([], 'in-production');
  try {
    assert.ok(assuranceCycleRun(prod).findings.some((f) => /in production — silence is not assurance/.test(f)));
  } finally { clean(prod); }
});

test('provider-selection: no choice is OK for a generic repo, FAILS when a plan requires the role', () => {
  // The choice of scanner or hardened-image supplier is the institution's (HG-0008), so a repo
  // that has not made it is not failing — until a compiled plan requires the capability, at which
  // point "we never chose" stops being a neutral state. This is the same shape as the D6 register:
  // the requirement comes from the profile, never from a CI flag.
  const generic = mkdtempSync(join(tmpdir(), 'mwc-'));
  try { assert.deepEqual(providerSelectionRun(generic).findings, []); } finally { clean(generic); }
  const req = repoRequiringCapability('sca');
  try {
    const { findings } = providerSelectionRun(req);
    assert.ok(findings.some((f) => /PS-R06: a compiled plan requires capability "sca"/.test(f)));
  } finally { clean(req); }
});

test('exposure-control: no register is OK for a generic repo, FAILS when a plan requires the capability', () => {
  // rc.39 (flow-plan Phase 5.2). Most repositories are not doing staged exposure and are not
  // failing. The moment a compiled plan asks for `exposure_control` — the regulated-bank profile
  // declares it at HIGH tier — "we have no flag register" stops being a neutral state, and the
  // change that made it non-neutral is named in the finding. Same shape as the D6 register and
  // the provider roles: the requirement comes from the profile, never from a CI flag.
  const generic = mkdtempSync(join(tmpdir(), 'mwc-'));
  try { assert.deepEqual(featureFlagRun(generic).findings, []); } finally { clean(generic); }
  const req = repoRequiringCapability('exposure_control');
  try {
    const { findings } = featureFlagRun(req);
    assert.ok(findings.some((f) => /requires the exposure_control capability \[CHG-1\]/.test(f)), findings.join('\n'));
  } finally { clean(req); }
});
