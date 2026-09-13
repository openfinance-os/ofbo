// Tests for the model-provenance gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPABILITY_DOMAINS, domainValidatorRole, evaluate, run } from './model-provenance-check.mjs';

// A high-tier model that satisfies every check — the fixture others mutate.
const HIGH = {
  role: 'delivery-loop',
  provider: 'example',
  model_id: 'example-model@2026-01',
  prompt_version: 'harness@1.4.0',
  risk_tier: 'high',
  eval: {
    suite: 'evals/delivery-loop',
    ran_at: '2026-07-20',
    dataset_version: 'evalset@3',
    runner_version: 'loom-eval-runner@1.2.0',
    result: 'pass',
    threshold_met: true,
    evaluated_model_id: 'example-model@2026-01',
    evaluated_prompt_version: 'harness@1.4.0',
    report: { ref: 'docs/governance/evidence/eval-report-delivery-loop.json', sha256: 'ab'.repeat(32) },
  },
  validated_by: 'model-risk (2nd line)',
  runtime: {
    monitoring: ['decision-vs-outcome drift', 'override rate'],
    suspension: 'suspend to manual on override rate > 15% over 2 weeks',
    fallback: 'manual underwriting queue on model/provider outage',
  },
};
const manifest = (m) => ({ models: [{ ...HIGH, ...m }] });

test('a fully-pinned, evaluated, validated high-tier model passes', () => {
  assert.deepEqual(evaluate(manifest()), []);
});

test('a low-tier model needs no eval or validation', () => {
  assert.deepEqual(evaluate({ models: [{ role: 'summariser', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'low' }] }), []);
});

test('a medium-tier model requires an eval and an independent validation (runbook §2.2)', () => {
  const f = evaluate({ models: [{ role: 'facilitator', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'medium' }] });
  assert.ok(f.some((x) => /has no eval block/.test(x)), 'medium needs an eval');
  assert.ok(f.some((x) => /no independent validation/.test(x)), 'medium needs validated_by');
});

test('a floating model_id is not a pin', () => {
  const f = evaluate(manifest({ model_id: 'latest' }));
  assert.ok(f.some((x) => /model_id is not pinned/.test(x)));
});

test('a floating prompt_version is not a pin', () => {
  assert.match(evaluate(manifest({ prompt_version: '' }))[0], /prompt_version is not pinned/);
});

test('an unknown risk tier is rejected', () => {
  assert.match(evaluate(manifest({ risk_tier: 'critical' }))[0], /risk_tier must be one of/);
});

test('a high-tier model with no eval fails', () => {
  const f = evaluate(manifest({ eval: undefined }));
  assert.ok(f.some((x) => /has no eval block/.test(x)));
});

test('a failing eval threshold fails', () => {
  const f = evaluate(manifest({ eval: { ...HIGH.eval, threshold_met: false } }));
  assert.ok(f.some((x) => /did not pass its threshold/.test(x)));
});

test('a stale eval (pin mismatch) is caught', () => {
  const f = evaluate(manifest({ eval: { ...HIGH.eval, evaluated_model_id: 'example-model@2025-09' } }));
  assert.ok(f.some((x) => /stale eval/.test(x)));
});

test('a high-tier model with no independent validation fails', () => {
  const f = evaluate(manifest({ validated_by: '   ' }));
  assert.ok(f.some((x) => /no independent validation/.test(x)));
});

test('an eval with no dataset/runner/timestamp identification is a claim, not evidence (1.10)', () => {
  const f = evaluate(manifest({ eval: { ...HIGH.eval, dataset_version: undefined, runner_version: '' } }));
  assert.ok(f.some((x) => /no dataset_version/.test(x)));
  assert.ok(f.some((x) => /no runner_version/.test(x)));
});

test('an eval without a hashed report artifact fails — `result: pass` alone is the false green (1.10)', () => {
  const f = evaluate(manifest({ eval: { ...HIGH.eval, report: undefined } }));
  assert.ok(f.some((x) => /no report \{ref, sha256\}/.test(x)));
  const g = evaluate(manifest({ eval: { ...HIGH.eval, report: { ref: 'x.json', sha256: 'not-a-hash' } } }));
  assert.ok(g.some((x) => /no report \{ref, sha256\}/.test(x)));
});

test('with baseDir, a missing or altered report artifact is caught', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'mp-'));
  try {
    const missing = evaluate(manifest(), { baseDir: dir });
    assert.ok(missing.some((x) => /report .* not found/.test(x)));
    const body = '{"cases":12,"pass":12}\n';
    writeFileSync(join(dir, 'report.json'), body);
    const good = createHash('sha256').update(body).digest('hex');
    assert.deepEqual(evaluate(manifest({ eval: { ...HIGH.eval, report: { ref: 'report.json', sha256: good } } }), { baseDir: dir }), []);
    const bad = evaluate(manifest({ eval: { ...HIGH.eval, report: { ref: 'report.json', sha256: 'cd'.repeat(32) } } }), { baseDir: dir });
    assert.ok(bad.some((x) => /does not match its declared sha256/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a high-tier model must declare runtime governance — monitoring, suspension, fallback (§10, 2.0-rc)', () => {
  assert.ok(evaluate(manifest({ runtime: undefined })).some((x) => /has no runtime block/.test(x)));
  const partial = evaluate(manifest({ runtime: { monitoring: ['x'] } }));
  assert.ok(partial.some((x) => /runtime.suspension must state/.test(x)));
  assert.ok(partial.some((x) => /runtime.fallback must state/.test(x)));
});

test('a medium-tier model does not require a runtime block (tier-proportionate)', () => {
  const med = { role: 'facilitator', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'medium',
    eval: { suite: 'e', ran_at: '2026-07-20', dataset_version: 'd@1', runner_version: 'r@1', result: 'pass', threshold_met: true,
      evaluated_model_id: 'x@1', evaluated_prompt_version: 'p@1', report: { ref: HIGH.eval.report.ref, sha256: HIGH.eval.report.sha256 } },
    validated_by: 'mrm' };
  assert.deepEqual(evaluate({ models: [med] }), []);
});

test('an empty inventory is a finding', () => {
  assert.match(evaluate({ models: [] })[0], /model inventory is empty/);
  assert.match(evaluate({})[0], /no `models` array|inventory is empty/);
});

/* ---- W5: validated_by resolves against the identity registry (closes F6) ---- */

const REG = { identities: [
  { id: 'mrm-aisha', kind: 'human', roles: ['model-validator'], groups: ['second-line'] },
  { id: 'eng-omar', kind: 'human', roles: ['engineering'], groups: ['builders'] },
  { id: 'agent-x', kind: 'agent', roles: ['model-validator'], groups: ['builders'] },
  { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
] };

test('with a registry, validated_by must resolve to a second-line human model-validator', () => {
  assert.deepEqual(evaluate(manifest({ validated_by: 'mrm-aisha' }), { registry: REG }), []);
});

test('free text, an agent, a builder, or the wrong role all fail validation resolution', () => {
  assert.ok(evaluate(manifest({ validated_by: 'Risk' }), { registry: REG }).some((x) => /not a registry identity/.test(x)));
  assert.ok(evaluate(manifest({ validated_by: 'agent-x' }), { registry: REG }).some((x) => /is an AGENT/.test(x)));
  assert.ok(evaluate(manifest({ validated_by: 'eng-omar' }), { registry: REG }).some((x) => /does not hold the model-validator role/.test(x)));
  assert.ok(evaluate(manifest({ validated_by: 'risk-lena' }), { registry: REG }).some((x) => /does not hold the model-validator role/.test(x)));
});

test('without a registry, validated_by stays a presence check (generic repo, backward compatible)', () => {
  assert.deepEqual(evaluate(manifest({ validated_by: 'anything non-empty' })), []);
});

/* ---- 2.1: domain validation — a SECOND signature, generic across domains ---- */

const DREG = { identities: [
  ...REG.identities,
  { id: 'scholar-yusuf', kind: 'human', roles: ['shariah-model-validator'], groups: ['second-line'] },
  { id: 'clinician-nadia', kind: 'human', roles: ['medical-model-validator'], groups: ['second-line'] },
  { id: 'both-hana', kind: 'human', roles: ['model-validator', 'shariah-model-validator'], groups: ['second-line'] },
  { id: 'builder-sam', kind: 'human', roles: ['shariah-model-validator'], groups: ['builders'] },
  { id: 'agent-scholar', kind: 'agent', roles: ['shariah-model-validator'], groups: [] },
] };
const domained = (over = {}) => manifest({ validated_by: 'mrm-aisha', domains: ['shariah'], domain_validations: { shariah: 'scholar-yusuf' }, ...over });

test('STRICTLY ADDITIVE: a manifest with no domains key produces zero new findings', () => {
  assert.deepEqual(evaluate(manifest({ validated_by: 'mrm-aisha' }), { registry: DREG }), []);
  // and at every tier, with and without a registry mounted
  assert.deepEqual(evaluate({ models: [{ role: 'summariser', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'low' }] }, { registry: DREG }), []);
  assert.deepEqual(evaluate(manifest({ validated_by: 'anything non-empty' })), []);
});

test('a declared domain with a resolvable second-line domain validator passes', () => {
  assert.deepEqual(evaluate(domained(), { registry: DREG }), []);
});

test('the domain check is generic — medical takes the identical path', () => {
  assert.deepEqual(evaluate(domained({ domains: ['medical'], domain_validations: { medical: 'clinician-nadia' } }), { registry: DREG }), []);
  const f = evaluate(domained({ domains: ['medical'], domain_validations: { medical: 'scholar-yusuf' } }), { registry: DREG });
  assert.ok(f.some((x) => /does not hold the medical-model-validator role/.test(x)), f.join('\n'));
});

test('two domains each need their own signature', () => {
  const ok = evaluate(domained({ domains: ['shariah', 'medical'], domain_validations: { shariah: 'scholar-yusuf', medical: 'clinician-nadia' } }), { registry: DREG });
  assert.deepEqual(ok, []);
  const f = evaluate(domained({ domains: ['shariah', 'medical'], domain_validations: { shariah: 'scholar-yusuf' } }), { registry: DREG });
  assert.ok(f.some((x) => /declares domain medical but domain_validations.medical names nobody/.test(x)), f.join('\n'));
});

test('a declared domain with no signature, an empty signature, or a placeholder signature fails', () => {
  assert.ok(evaluate(domained({ domain_validations: undefined }), { registry: DREG }).some((x) => /names nobody/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: { shariah: '  ' } }), { registry: DREG }).some((x) => /names nobody/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: { shariah: 'ADOPT: the scholar id' } }), { registry: DREG }).some((x) => /still an ADOPT placeholder/.test(x)));
});

test('an agent, a builder, free text, or the wrong role all fail domain validation', () => {
  assert.ok(evaluate(domained({ domain_validations: { shariah: 'agent-scholar' } }), { registry: DREG }).some((x) => /is an AGENT/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: { shariah: 'builder-sam' } }), { registry: DREG }).some((x) => /is a BUILDER/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: { shariah: 'Scholars' } }), { registry: DREG }).some((x) => /not a registry identity/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: { shariah: 'risk-lena' } }), { registry: DREG }).some((x) => /does not hold the shariah-model-validator role/.test(x)));
});

test('one identity may cover validated_by AND the domain only by holding both roles', () => {
  assert.deepEqual(evaluate(domained({ validated_by: 'both-hana', domain_validations: { shariah: 'both-hana' } }), { registry: DREG }), []);
  const f = evaluate(domained({ validated_by: 'mrm-aisha', domain_validations: { shariah: 'mrm-aisha' } }), { registry: DREG });
  assert.ok(f.some((x) => /reuses validated_by mrm-aisha.*needs two distinct signatures/.test(x)), f.join('\n'));
  // the reverse: the domain validator cannot stand in for the model-risk signature either
  const g = evaluate(domained({ validated_by: 'scholar-yusuf', domain_validations: { shariah: 'scholar-yusuf' } }), { registry: DREG });
  assert.ok(g.some((x) => /does not hold the model-validator role/.test(x)), g.join('\n'));
});

test('without a registry a domain signature stays a presence check', () => {
  assert.deepEqual(evaluate(domained({ domain_validations: { shariah: 'whoever' } })), []);
  assert.ok(evaluate(domained({ domain_validations: {} })).some((x) => /names nobody/.test(x)));
});

test('a non-slug domain cannot derive a role name, and malformed containers are caught', () => {
  assert.ok(evaluate(domained({ domains: ['Shari\'ah Board'] }), { registry: DREG }).some((x) => /is not a slug/.test(x)));
  assert.ok(evaluate(domained({ domains: 'shariah' }), { registry: DREG }).some((x) => /domains must be an array/.test(x)));
  assert.ok(evaluate(domained({ domain_validations: ['scholar-yusuf'] }), { registry: DREG }).some((x) => /domain_validations must be an object/.test(x)));
});

test('an ADOPT-placeholder domain row is an untouched template, not a declaration', () => {
  assert.deepEqual(evaluate(manifest({
    validated_by: 'mrm-aisha',
    domains: ['ADOPT: e.g. shariah, medical, privacy'],
    domain_validations: { 'ADOPT: <domain>': 'ADOPT: <identity id>' },
  }), { registry: DREG }), []);
});

test('a signature for an undeclared domain is coverage the manifest does not have', () => {
  const f = evaluate(domained({ domain_validations: { shariah: 'scholar-yusuf', privacy: 'clinician-nadia' } }), { registry: DREG });
  assert.ok(f.some((x) => /domain_validations names "privacy", which is not in domains/.test(x)), f.join('\n'));
});

test('domain significance is not tier — a low-tier model that declares a domain still needs the signature', () => {
  const low = { role: 'screener', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'low', domains: ['shariah'] };
  assert.ok(evaluate({ models: [low] }, { registry: DREG }).some((x) => /names nobody/.test(x)));
});

/* ---- 2.1: mandatory-when-compiled (run()) ---- */

function repo({ capability = null, domains = undefined } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mprov-'));
  const base = join(dir, 'docs/governance/changes/CHG-7');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-7', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: [], required_evidence: [],
    required_capabilities: capability ? { [capability]: { required: true } } : {},
  }));
  const model = { role: 'screener', model_id: 'x@1', prompt_version: 'p@1', risk_tier: 'low' };
  if (domains) { model.domains = domains; model.domain_validations = { shariah: 'scholar-yusuf' }; }
  writeFileSync(join(dir, 'docs/governance/model-manifest.json'), JSON.stringify({ models: [model] }));
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(DREG));
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('run(): a repo whose plans require no domain capability is SILENT about domains', () => {
  const d = repo();
  try { assert.deepEqual(run(d), []); } finally { clean(d); }
});

test('run(): shariah_model_validation compiled + no model naming the domain FAILS, naming the change', () => {
  const d = repo({ capability: 'shariah_model_validation' });
  try {
    const f = run(d);
    assert.ok(f.some((x) => /requires the shariah_model_validation capability \[CHG-7\]/.test(x)), f.join('\n'));
    assert.ok(f.some((x) => /no model in the manifest declares the "shariah" domain/.test(x)), f.join('\n'));
  } finally { clean(d); }
});

test('run(): once a model declares the domain with a valid signature, the limb is satisfied', () => {
  const d = repo({ capability: 'shariah_model_validation', domains: ['shariah'] });
  try { assert.deepEqual(run(d), []); } finally { clean(d); }
});

test('run(): an unrelated compiled capability does not trigger the domain limb', () => {
  const d = repo({ capability: 'exposure_control' });
  try { assert.deepEqual(run(d), []); } finally { clean(d); }
});

test('the capability→domain table is data, and the role name is derived from it', () => {
  assert.equal(CAPABILITY_DOMAINS.shariah_model_validation, 'shariah');
  assert.equal(domainValidatorRole('medical'), 'medical-model-validator');
});
