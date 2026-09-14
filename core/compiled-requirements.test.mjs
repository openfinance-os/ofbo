// Tests for compiled-requirements aggregation. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateRequirements, requiredBy, capabilityRequired, modelRolesRequiredByCapability } from './compiled-requirements.mjs';

// Build a tmp repo with N governed changes, each {id, state, gates, evidence, capabilities}.
function repo(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'cr-'));
  for (const c of changes) {
    const base = join(dir, 'docs/governance/changes', c.id);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: c.id, current_state: c.state || 'in-delivery', control_plan: 'control-plan.json', model_roles: c.model_roles }));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: c.gates || [], required_evidence: c.evidence || [], required_capabilities: c.capabilities || {} }));
  }
  return dir;
}

test('capabilities aggregate across changes; capabilityRequired reflects "required" (rc.13 WS3)', () => {
  const dir = repo([
    { id: 'CHG-1', capabilities: { data_risk_register: { required: true, minimum_version: '3.1', institution_owned: true } } },
    { id: 'CHG-2', capabilities: { model_risk: { required: true, minimum_tier: 'medium' } } },
  ]);
  try {
    const agg = aggregateRequirements(dir);
    assert.equal(capabilityRequired(agg, 'data_risk_register'), true);
    assert.equal(capabilityRequired(agg, 'model_risk'), true);
    assert.equal(capabilityRequired(agg, 'nonexistent'), false);
    assert.equal(agg.capabilities.data_risk_register.minimum_version, '3.1');
    assert.equal(agg.capabilities.data_risk_register.institution_owned, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('2.4 — model-role scope is precise only when every capability-requiring change enumerates it', () => {
  const scoped = repo([
    { id: 'CHG-1', model_roles: ['credit-decision'], capabilities: { ai_governance: { required: true } } },
    { id: 'CHG-2', model_roles: ['fraud-screen'], capabilities: { ai_governance: { required: true } } },
  ]);
  const failOpen = repo([
    { id: 'CHG-1', model_roles: ['credit-decision'], capabilities: { ai_governance: { required: true } } },
    { id: 'CHG-2', capabilities: { ai_governance: { required: true } } },
  ]);
  try {
    assert.deepEqual([...modelRolesRequiredByCapability(aggregateRequirements(scoped), 'ai_governance')].sort(), ['credit-decision', 'fraud-screen']);
    assert.equal(modelRolesRequiredByCapability(aggregateRequirements(failOpen), 'ai_governance'), null, 'an unscoped envelope must expand coverage, never narrow it');
  } finally {
    rmSync(scoped, { recursive: true, force: true });
    rmSync(failOpen, { recursive: true, force: true });
  }
});

test('capability attributes aggregate STRONGEST-WINS in either read order (rc.33 — the first-wins weakening)', () => {
  // Two plans require the same capability at different strengths. Whichever directory is read
  // first, the aggregate must report the STRONGER attributes — a first-wins merge silently
  // weakened the requirement to whichever change happened to sort first.
  const lowFirst = repo([
    { id: 'CHG-A', capabilities: { data_risk_register: { required: true, minimum_version: '3.1', minimum_tier: 'low' } } },
    { id: 'CHG-B', capabilities: { data_risk_register: { required: true, minimum_version: '4.0', minimum_tier: 'high' } } },
  ]);
  const highFirst = repo([
    { id: 'CHG-A', capabilities: { data_risk_register: { required: true, minimum_version: '4.0', minimum_tier: 'high' } } },
    { id: 'CHG-B', capabilities: { data_risk_register: { required: true, minimum_version: '3.1', minimum_tier: 'low' } } },
  ]);
  try {
    for (const dir of [lowFirst, highFirst]) {
      const cap = aggregateRequirements(dir).capabilities.data_risk_register;
      assert.equal(cap.minimum_version, '4.0', 'the weaker minimum_version must never survive the merge');
      assert.equal(cap.minimum_tier, 'high', 'the weaker minimum_tier must never survive the merge');
      assert.equal(cap.required, true);
    }
  } finally { rmSync(lowFirst, { recursive: true, force: true }); rmSync(highFirst, { recursive: true, force: true }); }
});

test('a change that does NOT require a capability leaves it unrequired (generic repo)', () => {
  const dir = repo([{ id: 'CHG-1', gates: ['D', 'Q'] }]);
  try {
    assert.equal(capabilityRequired(aggregateRequirements(dir), 'data_risk_register'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no changes dir, requirements are empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-'));
  try {
    const agg = aggregateRequirements(dir);
    assert.equal(agg.families.size, 0);
    assert.equal(agg.evidence.size, 0);
    assert.equal(agg.anyInProduction, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('families and evidence are the UNION across changes', () => {
  const dir = repo([
    { id: 'CHG-1', gates: ['D', 'Q'], evidence: ['tests'] },
    { id: 'CHG-2', gates: ['A', 'product-eval'], evidence: ['sast', 'product-eval'] },
  ]);
  try {
    const agg = aggregateRequirements(dir);
    assert.deepEqual([...agg.families].sort(), ['A', 'D', 'Q', 'product-eval']);
    assert.deepEqual([...agg.evidence].sort(), ['product-eval', 'sast', 'tests']);
    assert.deepEqual(requiredBy(agg, 'product-eval'), ['CHG-2']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('anyInProduction flips when a change holds a production state', () => {
  const inProd = repo([{ id: 'CHG-9', state: 'in-production', gates: ['D'] }]);
  const notProd = repo([{ id: 'CHG-9', state: 'in-delivery', gates: ['D'] }]);
  try {
    assert.equal(aggregateRequirements(inProd).anyInProduction, true);
    assert.equal(aggregateRequirements(notProd).anyInProduction, false);
  } finally { rmSync(inProd, { recursive: true, force: true }); rmSync(notProd, { recursive: true, force: true }); }
});

test('a TERMINAL change (closed/superseded) contributes nothing — the union stops growing with repo age (rc.34)', () => {
  const dir = repo([
    { id: 'CHG-LIVE', state: 'in-delivery', gates: ['D', 'Q'], evidence: ['tests'] },
    { id: 'CHG-DONE', state: 'closed', gates: ['PA1', 'PA2', 'R'], evidence: ['sast'], capabilities: { model_risk: { required: true } } },
    { id: 'CHG-OLD', state: 'superseded', gates: ['A'] },
  ]);
  try {
    const agg = aggregateRequirements(dir);
    assert.deepEqual([...agg.families].sort(), ['D', 'Q'], 'terminal changes must not mandate families');
    assert.deepEqual([...agg.evidence].sort(), ['tests']);
    assert.equal(capabilityRequired(agg, 'model_risk'), false, 'a closed change must not keep a capability mandatory');
    assert.deepEqual(agg.changes.map((c) => c.change_id), ['CHG-LIVE']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('changedPaths scopes the aggregate to the changes the diff implicates (rc.34)', () => {
  const dir = repo([
    { id: 'CHG-A', gates: ['PA1'], evidence: ['sast'] },
    { id: 'CHG-B', gates: ['R'], evidence: ['provenance'] },
  ]);
  try {
    // A diff inside CHG-A's envelope directory implicates CHG-A only.
    const scoped = aggregateRequirements(dir, { changedPaths: ['docs/governance/changes/CHG-A/product-passport.json', 'src/app.mjs'] });
    assert.equal(scoped.scoped, true);
    assert.deepEqual([...scoped.families], ['PA1'], 'only the implicated change mandates families');
    assert.deepEqual(scoped.changes.map((c) => c.change_id), ['CHG-A']);
    // A diff touching neither implicates nothing — the light path, with the reason recorded upstream.
    const none = aggregateRequirements(dir, { changedPaths: ['README.md'] });
    assert.equal(none.families.size, 0);
    // Unknown diff (null) fails open: every non-terminal change counts.
    const all = aggregateRequirements(dir, { changedPaths: null });
    assert.equal(all.scoped, false);
    assert.deepEqual([...all.families].sort(), ['PA1', 'R']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an envelope scope_paths prefix implicates its change from a code diff (rc.34)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-'));
  try {
    const base = join(dir, 'docs/governance/changes/CHG-S');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-S', current_state: 'in-delivery', control_plan: 'control-plan.json', scope_paths: ['services/credit/'] }));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: ['Q'] }));
    const hit = aggregateRequirements(dir, { changedPaths: ['services/credit/handler.mjs'] });
    assert.deepEqual([...hit.families], ['Q']);
    const miss = aggregateRequirements(dir, { changedPaths: ['services/payments/handler.mjs'] });
    assert.equal(miss.families.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('maxTier is the highest risk_tier among counted changes, and scoping narrows it (rc.34)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-'));
  try {
    for (const [id, tier] of [['CHG-LOW', 'low'], ['CHG-CRIT', 'critical']]) {
      const base = join(dir, 'docs/governance/changes', id);
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: id, current_state: 'in-delivery', risk_tier: tier, control_plan: 'control-plan.json' }));
      writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: [] }));
    }
    assert.equal(aggregateRequirements(dir).maxTier, 'critical');
    const scoped = aggregateRequirements(dir, { changedPaths: ['docs/governance/changes/CHG-LOW/change-envelope.json'] });
    assert.equal(scoped.maxTier, 'low', 'a diff implicating only the low change must not carry the critical tier');
    assert.equal(aggregateRequirements(dir, { changedPaths: ['README.md'] }).maxTier, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a change with no plan contributes nothing — it never lowers a requirement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-'));
  try {
    const base = join(dir, 'docs/governance/changes/CHG-X');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-X', control_plan: 'control-plan.json' }));
    // no control-plan.json written
    const agg = aggregateRequirements(dir);
    assert.equal(agg.families.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- rc.40 (flow-plan Phase 6.2): plan_hash travels with the change, for the result cache ---- */

test('each counted change carries its plan_hash — the cache keys on the set of them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-ph-'));
  try {
    const base = `${dir}/docs/governance/changes/CHG-9`;
    mkdirSync(base, { recursive: true });
    writeFileSync(`${base}/change-envelope.json`, JSON.stringify({ change_id: 'CHG-9', current_state: 'proposed', risk_tier: 'high' }));
    writeFileSync(`${base}/control-plan.json`, JSON.stringify({ required_gates: ['Q'], plan_hash: 'abc123' }));
    const agg = aggregateRequirements(dir);
    assert.equal(agg.changes.find((c) => c.change_id === 'CHG-9').plan_hash, 'abc123');
    // A plan with no stored hash reports null rather than inventing one.
    writeFileSync(`${base}/control-plan.json`, JSON.stringify({ required_gates: ['Q'] }));
    assert.equal(aggregateRequirements(dir).changes[0].plan_hash, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
