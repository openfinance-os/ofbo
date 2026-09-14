// Tests for the fairness-evaluation gate. Node built-in runner: `node --test`.
//
// Three properties matter more than the field rules and are tested first and last. The gate is
// SILENT for a repository that ships no customer-deciding model and compiles nothing. The SHIPPED
// TEMPLATE, which the installer mounts, never reads as an adopted register. And the two rules a
// filled-in slot cannot satisfy — coverage (FR-R06) and THE PIN BINDING (FR-R08) — fail when the
// manifest and the record disagree, which is the whole reason this control stopped being `absent`.
//
// Every rule test passes `enforced: true`: dormant, each is a notice, and the dormant-vs-armed pair
// is asserted explicitly in its own test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY, COVERED_TIERS, evaluate, isPlaceholder, requiringChanges, run } from './fairness-evaluation-check.mjs';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only inspect the immutable bundle template. Adopted-layout CI intentionally replaces the
// installed destination with the worked record before this suite runs.
const TEMPLATE_CANDIDATE = join(H, 'governance/fairness-evaluations.template.json');
const TEMPLATE_PATH = existsSync(TEMPLATE_CANDIDATE) ? TEMPLATE_CANDIDATE : null;
const SKIP_NO_TEMPLATE = !TEMPLATE_PATH && 'fairness-evaluations template not present in this layout';
const clean = (d) => rmSync(d, { recursive: true, force: true });

const PIN = { model_id: 'example-model@2026-01', prompt_version: 'loom-harness@1.4.0' };
const attribute = (name, over = {}) => ({
  attribute: name,
  basis: 'Named a protected characteristic by the applicable equality statute.',
  measured_by: 'declared at onboarding',
  proxy_risk: 'Postcode reviewed as a possible carrier; excluded from the feature set.',
  ...over,
});
const evaluation = (over = {}) => ({
  role: 'delivery-loop',
  evaluated_model_id: PIN.model_id,
  evaluated_prompt_version: PIN.prompt_version,
  ran_at: '2026-08-01',
  population: { dataset_version: 'fairness-set@4', representativeness: 'Drawn from twelve months of live applications; under-represents applicants over 75.' },
  disparities: { 'age-band': 0.02 },
  report: { ref: 'docs/governance/evidence/fairness-delivery-loop.json', sha256: 'a'.repeat(64) },
  ...over,
});
const record = (over = {}) => ({
  metric: 'demographic-parity-difference',
  threshold: { max_disparity: 0.05, direction: 'ceiling' },
  owner: 'mrm-aisha',
  material_retrain: 'Any weight update, or a prompt change altering the decision instruction.',
  protected_attributes: [attribute('age-band')],
  evaluations: [evaluation()],
  ...over,
});
const REGISTRY = { identities: [{ id: 'mrm-aisha', kind: 'human', roles: ['model-validator'], groups: ['second-line'] }] };
const MODELS = [{ role: 'delivery-loop', risk_tier: 'high', ...PIN }];

test('a register measured against the shipping pin passes clean', () => {
  const { findings, notices, attributes, evaluations } = evaluate(record(), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, [], notices.join('\n'));
  assert.equal(attributes, 1);
  assert.equal(evaluations, 1);
});

test('FR-R01 — a register naming nothing to protect silences the PER-ATTRIBUTE rules and nothing else', () => {
  for (const attrs of [undefined, [], 'later', [{}], [{ attribute: 'ADOPT: the attribute' }]]) {
    const { findings } = evaluate(record({ protected_attributes: attrs }), { models: MODELS, registry: REGISTRY, enforced: true });
    assert.ok(findings.some((f) => /FR-R01/.test(f)), JSON.stringify(attrs));
    // No per-attribute rule fires — there is nothing to measure against.
    assert.deepEqual(findings.filter((f) => /FR-R09|FR-R10/.test(f)), [], JSON.stringify(attrs));
  }
  // …but the rules that join to the MANIFEST still report, because they are properties of the
  // evaluations rather than of the register. An empty register plus an uncovered deciding model
  // is a more useful message than either half alone.
  const models = [...MODELS, { role: 'pricing', risk_tier: 'high', ...PIN }];
  const { findings } = evaluate(record({ protected_attributes: [], evaluations: [evaluation({ evaluated_model_id: 'example-model@2019-01' })] }), { models, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R01/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /FR-R06.*"pricing"/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /FR-R08.*STALE/.test(f)), findings.join('\n'));
});

test('FR-R02 — an attribute with no basis is a choice nobody has to defend; the prose fields are notices', () => {
  const { findings } = evaluate(record({ protected_attributes: [attribute('age-band', { basis: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R02.*"age-band".*basis/.test(f)), findings.join('\n'));
  // measured_by and proxy_risk absent are NOTICES even when armed — a thinner record, not a broken one.
  const thin = evaluate(record({ protected_attributes: [attribute('age-band', { measured_by: undefined, proxy_risk: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(thin.findings, [], thin.findings.join('\n'));
  assert.equal(thin.notices.filter((n) => /FR-R02/.test(n)).length, 2, thin.notices.join('\n'));
  assert.ok(thin.notices.some((n) => /NOTHING HERE DETECTS A PROXY/.test(n)));
});

test('FR-R03 — one file, one metric', () => {
  assert.ok(evaluate(record({ metric: undefined }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /FR-R03/.test(f)));
  // An evaluation may restate the metric, but not a different one.
  const mixed = evaluate(record({ evaluations: [evaluation({ metric: 'disparate-impact-ratio' })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(mixed.findings.some((f) => /FR-R03.*disparate-impact-ratio.*demographic-parity-difference/.test(f)), mixed.findings.join('\n'));
  // Restating the SAME metric is fine.
  assert.deepEqual(evaluate(record({ evaluations: [evaluation({ metric: 'demographic-parity-difference' })] }), { models: MODELS, registry: REGISTRY, enforced: true }).findings, []);
});

test('FR-R04 — the threshold needs a real number and an EXPLICIT direction', () => {
  for (const bad of [undefined, null, 'five percent', NaN, Infinity]) {
    assert.ok(evaluate(record({ threshold: { max_disparity: bad, direction: 'ceiling' } }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => /FR-R04.*max_disparity/.test(f)), JSON.stringify(bad));
  }
  for (const bad of [undefined, 'lower-is-better', 'max', true]) {
    assert.ok(evaluate(record({ threshold: { max_disparity: 0.05, direction: bad } }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => /FR-R04.*NEVER INFERRED FROM THE METRIC NAME/.test(f)), JSON.stringify(bad));
  }
  // A missing threshold block reports both halves rather than crashing.
  const none = evaluate(record({ threshold: undefined }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.equal(none.findings.filter((f) => /FR-R04/.test(f)).length, 2, none.findings.join('\n'));
});

test('FR-R04/FR-R10 — direction inverts the comparison, so a ratio metric is judged the right way round', () => {
  // A ceiling: 0.09 over a 0.05 max is a breach.
  const ceiling = evaluate(record({ evaluations: [evaluation({ disparities: { 'age-band': 0.09 } })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(ceiling.findings.some((f) => /FR-R10.*0\.09.*ceiling of 0\.05/.test(f)), ceiling.findings.join('\n'));
  // A floor (disparate impact, 1.0 is parity): 0.7 UNDER a 0.8 floor is the breach, and the same
  // number passes as a ceiling. Getting this backwards is how a failing model reads green.
  const floorDoc = record({
    metric: 'disparate-impact-ratio',
    threshold: { max_disparity: 0.8, direction: 'floor' },
    evaluations: [evaluation({ disparities: { 'age-band': 0.7 } })],
  });
  assert.ok(evaluate(floorDoc, { models: MODELS, registry: REGISTRY, enforced: true }).findings.some((f) => /FR-R10.*0\.7.*floor of 0\.8/.test(f)));
  const asCeiling = { ...floorDoc, threshold: { max_disparity: 0.8, direction: 'ceiling' } };
  assert.deepEqual(evaluate(asCeiling, { models: MODELS, registry: REGISTRY, enforced: true }).findings, []);
});

test('FR-R05 — a threshold whose owner cannot be named belongs to nobody', () => {
  assert.ok(evaluate(record({ owner: undefined }), { models: MODELS, registry: REGISTRY, enforced: true }).findings.some((f) => /FR-R05/.test(f)));
  assert.ok(evaluate(record({ owner: 'ADOPT: the identity id' }), { models: MODELS, registry: REGISTRY, enforced: true }).findings.some((f) => /FR-R05/.test(f)));
  assert.ok(evaluate(record({ owner: 'nobody' }), { models: MODELS, registry: REGISTRY, enforced: true }).findings.some((f) => /FR-R05.*not in the identity registry/.test(f)));
  // An agent owns nothing.
  const agents = { identities: [{ id: 'bot', kind: 'agent', roles: ['model-validator'] }] };
  assert.ok(evaluate(record({ owner: 'bot' }), { models: MODELS, registry: agents, enforced: true }).findings.some((f) => /FR-R05.*AGENT/.test(f)));
  // Nor does the team being measured — `builders` is a GROUP on the identity.
  const builder = { identities: [{ id: 'dev', kind: 'human', roles: ['model-validator'], groups: ['builders'] }] };
  assert.ok(evaluate(record({ owner: 'dev' }), { models: MODELS, registry: builder, enforced: true }).findings.some((f) => /FR-R05.*builders/.test(f)));
  // With no registry mounted the owner is taken as stated — this gate does not invent a registry.
  assert.deepEqual(evaluate(record({ owner: 'someone' }), { models: MODELS, enforced: true }).findings, []);
});

test('FR-R06 — a covered-tier model with no evaluation is UNCOVERED, and silence is not a pass', () => {
  const models = [...MODELS, { role: 'pricing', risk_tier: 'medium', ...PIN }];
  const { findings } = evaluate(record(), { models, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R06.*"pricing".*medium-tier.*silence is not a pass/.test(f)), findings.join('\n'));
  // A low-tier model is not covered by default.
  const low = [...MODELS, { role: 'summariser', risk_tier: 'low', ...PIN }];
  assert.deepEqual(evaluate(record(), { models: low, registry: REGISTRY, enforced: true }).findings, []);
  assert.ok(COVERED_TIERS.has('high') && COVERED_TIERS.has('medium') && !COVERED_TIERS.has('low'));
});

test('2.4 — coverage follows the model roles named by the governed change', () => {
  const models = [...MODELS, { role: 'pricing', risk_tier: 'medium', ...PIN }];
  const scoped = evaluate(record(), { models, coveredRoles: new Set(['delivery-loop']), registry: REGISTRY, enforced: true });
  assert.ok(!scoped.findings.some((f) => /FR-R06.*"pricing"/.test(f)), scoped.findings.join('\n'));
  const expanded = evaluate(record(), { models, coveredRoles: null, registry: REGISTRY, enforced: true });
  assert.ok(expanded.findings.some((f) => /FR-R06.*"pricing"/.test(f)), expanded.findings.join('\n'));
});

test('FR-R07 — an evaluation of a model this repository does not ship measures nothing', () => {
  const { findings } = evaluate(record({ evaluations: [evaluation({ role: 'ghost' })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R07.*"ghost"/.test(f)), findings.join('\n'));
});

test('FR-R08 — THE BINDING RULE: a retrain that moves the pin invalidates its own fairness evidence', () => {
  // The property a filled-in slot cannot satisfy. Move the manifest pin and the record goes stale.
  const retrained = [{ role: 'delivery-loop', risk_tier: 'high', model_id: 'example-model@2026-06', prompt_version: PIN.prompt_version }];
  const { findings } = evaluate(record(), { models: retrained, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R08.*STALE.*2026-01.*2026-06/.test(f)), findings.join('\n'));
  // A prompt change is a model change: same weights, different instruction, same rule.
  const reprompted = [{ role: 'delivery-loop', risk_tier: 'high', model_id: PIN.model_id, prompt_version: 'loom-harness@2.0.0' }];
  assert.ok(evaluate(record(), { models: reprompted, registry: REGISTRY, enforced: true }).findings.some((f) => /FR-R08.*STALE/.test(f)));
});

test('FR-R09 — a registered attribute nobody measured is named, not averaged over', () => {
  const two = record({ protected_attributes: [attribute('age-band'), attribute('sex')] });
  const { findings } = evaluate(two, { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /FR-R09.*"sex"/.test(f)), findings.join('\n'));
  // Measuring MORE than the register demands is a notice, never a finding.
  const extra = evaluate(record({ evaluations: [evaluation({ disparities: { 'age-band': 0.02, tenure: 0.01 } })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(extra.findings, [], extra.findings.join('\n'));
  assert.ok(extra.notices.some((n) => /FR-R09.*"tenure".*never enforced/.test(n)));
  // Commentary keys are skipped, as everywhere else in the harness.
  assert.deepEqual(evaluate(record({ evaluations: [evaluation({ disparities: { 'age-band': 0.02, _comment: 'ADOPT' } })] }), { models: MODELS, registry: REGISTRY, enforced: true }).notices, []);
});

test('FR-R10 — a "pass" is not a measurement', () => {
  for (const bad of ['pass', null, true, '0.02', undefined]) {
    const { findings } = evaluate(record({ evaluations: [evaluation({ disparities: { 'age-band': bad } })] }), { models: MODELS, registry: REGISTRY, enforced: true });
    assert.ok(findings.some((f) => /FR-R09|FR-R10/.test(f)), JSON.stringify(bad));
  }
  // A breach is not reported when the threshold itself is unusable — FR-R04 already said so, and
  // comparing against NaN would silently pass everything.
  const unusable = evaluate(record({ threshold: { max_disparity: 'five', direction: 'ceiling' }, evaluations: [evaluation({ disparities: { 'age-band': 99 } })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(unusable.findings.filter((f) => /FR-R10/.test(f)), []);
  assert.ok(unusable.findings.some((f) => /FR-R04/.test(f)));
});

test('FR-R11 — an unidentified population makes the number unreproducible', () => {
  for (const key of ['dataset_version', 'representativeness']) {
    const pop = { dataset_version: 'set@1', representativeness: 'stated', [key]: undefined };
    assert.ok(evaluate(record({ evaluations: [evaluation({ population: pop })] }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => /FR-R11/.test(f)), key);
  }
  assert.ok(evaluate(record({ evaluations: [evaluation({ population: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /FR-R11/.test(f)));
  assert.ok(evaluate(record({ evaluations: [evaluation({ ran_at: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /FR-R11.*ran_at/.test(f)));
});

test('FR-R12 — a declared number is not evidence, and the report is re-hashed', () => {
  for (const bad of [undefined, {}, { ref: 'r.json' }, { ref: 'r.json', sha256: 'short' }, { ref: 'ADOPT: path', sha256: 'a'.repeat(64) }]) {
    assert.ok(evaluate(record({ evaluations: [evaluation({ report: bad })] }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => /FR-R12/.test(f)), JSON.stringify(bad));
  }
  // With a baseDir the artifact must exist and its bytes must match.
  const dir = mkdtempSync(join(tmpdir(), 'loom-fair-'));
  try {
    const body = '{"disparities":{"age-band":0.02}}';
    mkdirSync(join(dir, 'reports'), { recursive: true });
    writeFileSync(join(dir, 'reports/f.json'), body);
    const sha = createHash('sha256').update(body).digest('hex');
    const good = record({ evaluations: [evaluation({ report: { ref: 'reports/f.json', sha256: sha } })] });
    assert.deepEqual(evaluate(good, { models: MODELS, registry: REGISTRY, baseDir: dir, enforced: true }).findings, []);
    // Altered after the record was written.
    writeFileSync(join(dir, 'reports/f.json'), `${body} `);
    assert.ok(evaluate(good, { models: MODELS, registry: REGISTRY, baseDir: dir, enforced: true })
      .findings.some((f) => /FR-R12.*does not match its declared sha256/.test(f)));
    // Absent entirely.
    const missing = record({ evaluations: [evaluation({ report: { ref: 'reports/gone.json', sha256: sha } })] });
    assert.ok(evaluate(missing, { models: MODELS, registry: REGISTRY, baseDir: dir, enforced: true })
      .findings.some((f) => /FR-R12.*not found/.test(f)));
  } finally { clean(dir); }
});

test('FR-R13 — material_retrain is a NOTICE always, because the pin comparison cannot see a same-pin retrain', () => {
  const { findings, notices } = evaluate(record({ material_retrain: undefined }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(notices.some((n) => /FR-R13.*invisible to every gate in this repository/.test(n)), notices.join('\n'));
});

test('DORMANCY — every rule is a notice until a compiled plan requires the capability', () => {
  // One record breaking FR-R02, FR-R03, FR-R04, FR-R05, FR-R06, FR-R08 and FR-R12 at once.
  const broken = record({
    metric: undefined,
    threshold: { max_disparity: 'five', direction: 'downward' },
    owner: 'nobody',
    protected_attributes: [attribute('age-band', { basis: undefined })],
    evaluations: [evaluation({ evaluated_model_id: 'example-model@2019-01', report: undefined })],
  });
  const models = [...MODELS, { role: 'pricing', risk_tier: 'high', ...PIN }];
  const dormant = evaluate(broken, { models, registry: REGISTRY });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  for (const rule of ['FR-R02', 'FR-R03', 'FR-R04', 'FR-R05', 'FR-R06', 'FR-R08', 'FR-R12']) {
    assert.ok(dormant.notices.some((n) => n.startsWith(rule)), `${rule} missing from notices:\n${dormant.notices.join('\n')}`);
  }
  // Armed, the same record fails on all of them — dormant, not toothless.
  const live = evaluate(broken, { models, registry: REGISTRY, enforced: true });
  for (const rule of ['FR-R02', 'FR-R03', 'FR-R04', 'FR-R05', 'FR-R06', 'FR-R08', 'FR-R12']) {
    assert.ok(live.findings.some((f) => f.startsWith(rule)), `${rule} missing from findings:\n${live.findings.join('\n')}`);
  }
});

test('the SHIPPED TEMPLATE never reads as an adopted register', { skip: SKIP_NO_TEMPLATE }, () => {
  const doc = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  // Every adopter-facing value is still an ADOPT marker, so the register is empty by FR-R01 …
  assert.ok(isPlaceholder(doc.protected_attributes[0].attribute));
  assert.ok(isPlaceholder(doc.owner));
  // … and mounting it can never fail anybody: dormant, it is a notice and nothing else.
  const dormant = evaluate(doc, { models: MODELS });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.ok(dormant.notices.some((n) => /FR-R01/.test(n)));
});

/** A repository with an optional compiled plan requiring the capability, and optional records. */
function repo({ requires = false, fairness = null, manifest = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-fairness-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: ['product-eval'],
    required_capabilities: requires ? { [CAPABILITY]: { required: true } } : {},
  }));
  if (fairness) writeFileSync(join(dir, 'docs/governance/fairness-evaluations.json'), typeof fairness === 'string' ? fairness : JSON.stringify(fairness));
  if (manifest) writeFileSync(join(dir, 'docs/governance/model-manifest.json'), JSON.stringify({ models: manifest }));
  return dir;
}

test('run() — INERT for a repository with no record and nothing compiled', () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
  } finally { clean(dir); }
});

test('run() — a compiled plan with no record FAILS and names the change', () => {
  const dir = repo({ requires: true });
  try {
    const r = run(dir);
    assert.equal(r.inert, false);
    assert.ok(r.findings.some((f) => /CHG-1/.test(f) && new RegExp(CAPABILITY).test(f)), r.findings.join('\n'));
    assert.deepEqual(requiringChanges(aggregateRequirements(dir)), ['CHG-1']);
  } finally { clean(dir); }
});

test('run() — without a manifest the join CANNOT run, and the gate says so rather than reporting a clean pass', () => {
  const dir = repo({ requires: true, fairness: record() });
  try {
    const r = run(dir);
    assert.equal(r.joined, false);
    assert.ok(r.notices.some((n) => /THE PIN BINDING \(FR-R08\) could not run/.test(n)), r.notices.join('\n'));
    // FR-R12's baseDir check still applies — the report artifact does not exist in this repo.
    assert.ok(r.findings.some((f) => /FR-R12/.test(f)));
  } finally { clean(dir); }
});

test('run() — with a manifest whose pin has moved, the record is stale and the gate fails', () => {
  const stale = [{ role: 'delivery-loop', risk_tier: 'high', model_id: 'example-model@2026-06', prompt_version: PIN.prompt_version }];
  const dir = repo({ requires: true, fairness: record(), manifest: stale });
  try {
    const r = run(dir);
    assert.equal(r.joined, true);
    assert.ok(r.findings.some((f) => /FR-R08.*STALE/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() — unparseable JSON is a finding when armed and a notice when dormant', () => {
  for (const requires of [true, false]) {
    const dir = repo({ requires, fairness: '{not json' });
    try {
      const r = run(dir);
      const where = requires ? r.findings : r.notices;
      assert.ok(where.some((m) => /not valid JSON/.test(m)), `requires=${requires}`);
      if (!requires) assert.deepEqual(r.findings, []);
    } finally { clean(dir); }
  }
});
