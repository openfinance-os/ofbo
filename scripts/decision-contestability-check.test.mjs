// Tests for the decision-contestability gate. Node built-in runner: `node --test`.
//
// The property that matters most is CT-R02, and it is the reason this control stopped being
// `absent`: a plan could always satisfy its `explainability-and-contestability` PA2 section in
// prose while a model shipped that the prose never mentioned. The coverage rule is the join that
// catches it, and it is tested against a manifest rather than in the abstract.
//
// The other two: the gate is SILENT for a repository that ships no customer-deciding model and
// compiles nothing, and the SHIPPED TEMPLATE never reads as a declaration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY, COVERED_TIERS, evaluate, isPlaceholder, requiringChanges, run } from './decision-contestability-check.mjs';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only inspect the immutable bundle template. Adopted-layout CI intentionally replaces the
// installed destination with the worked record before this suite runs.
const TEMPLATE_CANDIDATE = join(H, 'governance/decision-contestability.template.json');
const TEMPLATE_PATH = existsSync(TEMPLATE_CANDIDATE) ? TEMPLATE_CANDIDATE : null;
const SKIP_NO_TEMPLATE = !TEMPLATE_PATH && 'decision-contestability template not present in this layout';
const clean = (d) => rmSync(d, { recursive: true, force: true });

const surface = (over = {}) => ({
  role: 'delivery-loop',
  decision: 'Declined for a limit increase.',
  reason_surface: {
    where: 'The decline letter and the in-app decision screen.',
    reason_source: "The model's own attributions, mapped to seven reason codes by the decision service.",
  },
  contest_route: { how: 'The "review this decision" form in-app, or a written request to the branch; the customer supplies their reference number.', sla_days: 14 },
  authority: 'credit-head',
  overturns_recorded_in: 'docs/governance/evidence/overturns.json, fed into the monthly model review.',
  ...over,
});
const record = (over = {}) => ({ response_sla_days: 30, surfaces: [surface()], ...over });
const REGISTRY = { identities: [{ id: 'credit-head', kind: 'human', roles: ['credit-authority'], groups: ['second-line'] }] };
const MODELS = [{ role: 'delivery-loop', risk_tier: 'high', model_id: 'm@1', prompt_version: 'p@1' }];

test('a surface naming where, how and who passes clean (with the standing CT-R11 notice)', () => {
  const { findings, notices, surfaces } = evaluate(record(), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.equal(surfaces, 1);
  // CT-R11 is a notice in BOTH postures — a complete record is a record, not a working path.
  assert.ok(notices.some((n) => /CT-R11.*never that it works/.test(n)), notices.join('\n'));
});

test('CT-R01 — a repository declaring no surfaces at all says so', () => {
  for (const s of [undefined, [], 'later', [{}], [{ role: 'ADOPT: the model role' }]]) {
    assert.ok(evaluate({ surfaces: s }, { enforced: true }).findings.some((f) => /CT-R01/.test(f)), JSON.stringify(s));
  }
});

test('CT-R02 — THE COVERAGE RULE: a covered-tier model with no contest route is named', () => {
  const models = [...MODELS, { role: 'pricing', risk_tier: 'medium' }];
  const { findings } = evaluate(record(), { models, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /CT-R02.*"pricing".*medium-tier.*Silence is not a pass/.test(f)), findings.join('\n'));
  // The message says WHY the rule exists — the prose-only PA2 section it backstops.
  assert.ok(findings.some((f) => /prose while a model ships that the prose never mentioned/.test(f)));
  // A low-tier model is not covered by default.
  assert.deepEqual(evaluate(record(), { models: [...MODELS, { role: 'summariser', risk_tier: 'low' }], registry: REGISTRY, enforced: true }).findings, []);
  assert.ok(COVERED_TIERS.has('high') && COVERED_TIERS.has('medium') && !COVERED_TIERS.has('low'));
});

test('2.4 — coverage follows the model roles named by the governed change', () => {
  const models = [...MODELS, { role: 'pricing', risk_tier: 'medium' }];
  const scoped = evaluate(record(), { models, coveredRoles: new Set(['delivery-loop']), registry: REGISTRY, enforced: true });
  assert.ok(!scoped.findings.some((f) => /CT-R02.*"pricing"/.test(f)), scoped.findings.join('\n'));
  const expanded = evaluate(record(), { models, coveredRoles: null, registry: REGISTRY, enforced: true });
  assert.ok(expanded.findings.some((f) => /CT-R02.*"pricing"/.test(f)), expanded.findings.join('\n'));
});

test('CT-R01 and CT-R02 report together — an empty file against three deciding models says both', () => {
  const models = [MODELS[0], { role: 'pricing', risk_tier: 'high' }, { role: 'fraud', risk_tier: 'medium' }];
  const { findings } = evaluate({ surfaces: [] }, { models, registry: REGISTRY, enforced: true });
  assert.ok(findings.some((f) => /CT-R01/.test(f)));
  assert.equal(findings.filter((f) => /CT-R02/.test(f)).length, 3, findings.join('\n'));
});

test('CT-R03 — a route for a model this repository does not ship', () => {
  assert.ok(evaluate(record({ surfaces: [surface({ role: 'ghost' })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /CT-R03.*"ghost"/.test(f)));
});

test('CT-R04/CT-R05/CT-R06 — the decision, where the reason appears, and what it is derived from', () => {
  assert.ok(evaluate(record({ surfaces: [surface({ decision: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /CT-R04/.test(f)));
  for (const [key, rule] of [['where', 'CT-R05'], ['reason_source', 'CT-R06']]) {
    const rs = { where: 'the letter', reason_source: 'attributions', [key]: undefined };
    assert.ok(evaluate(record({ surfaces: [surface({ reason_surface: rs })] }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => new RegExp(rule).test(f)), key);
  }
  // A missing reason_surface block reports both halves rather than crashing.
  const none = evaluate(record({ surfaces: [surface({ reason_surface: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true });
  assert.ok(none.findings.some((f) => /CT-R05/.test(f)) && none.findings.some((f) => /CT-R06/.test(f)));
  // CT-R06 says plainly what it cannot check.
  assert.ok(none.findings.some((f) => /THE GATE CANNOT TELL WHETHER THE ANSWER IS TRUE/.test(f)));
});

test('CT-R07 — "contact us" is not a route', () => {
  for (const route of [undefined, {}, { how: 'ADOPT: the form' }, { sla_days: 14 }]) {
    assert.ok(evaluate(record({ surfaces: [surface({ contest_route: route })] }), { models: MODELS, registry: REGISTRY, enforced: true })
      .findings.some((f) => /CT-R07/.test(f)), JSON.stringify(route));
  }
});

test('CT-R08 — the bound may come from the surface or the file, and must be a positive number', () => {
  // Surface overrides the file default.
  assert.deepEqual(evaluate(record({ response_sla_days: undefined }), { models: MODELS, registry: REGISTRY, enforced: true }).findings, []);
  // File default covers a surface that sets none.
  const noOwn = record({ surfaces: [surface({ contest_route: { how: 'the in-app form' } })] });
  assert.deepEqual(evaluate(noOwn, { models: MODELS, registry: REGISTRY, enforced: true }).findings, []);
  // Neither, or an unusable one, is a finding — including a surface value that OVERRIDES a good default.
  for (const [own, dflt] of [[undefined, undefined], [undefined, 0], [undefined, 'thirty'], [0, 30], [-5, 30], ['14', 30], [null, 30]]) {
    const doc = record({ response_sla_days: dflt, surfaces: [surface({ contest_route: { how: 'the in-app form', ...(own === undefined ? {} : { sla_days: own }) } })] });
    assert.ok(evaluate(doc, { models: MODELS, registry: REGISTRY, enforced: true }).findings.some((f) => /CT-R08/.test(f)), `${JSON.stringify(own)}/${JSON.stringify(dflt)}`);
  }
});

test('CT-R09 — a contest must reach a human who can actually overturn', () => {
  assert.ok(evaluate(record({ surfaces: [surface({ authority: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /CT-R09/.test(f)));
  assert.ok(evaluate(record({ surfaces: [surface({ authority: 'nobody' })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /CT-R09.*not in the identity registry/.test(f)));
  // An agent reconsidering a machine decision is the same decision twice.
  const agents = { identities: [{ id: 'bot', kind: 'agent', roles: ['credit-authority'] }] };
  assert.ok(evaluate(record({ surfaces: [surface({ authority: 'bot' })] }), { models: MODELS, registry: agents, enforced: true })
    .findings.some((f) => /CT-R09.*AGENT.*same decision twice/.test(f)));
  // Nor is the team that shipped the model the independent look the person was promised.
  const builder = { identities: [{ id: 'dev', kind: 'human', roles: ['credit-authority'], groups: ['builders'] }] };
  assert.ok(evaluate(record({ surfaces: [surface({ authority: 'dev' })] }), { models: MODELS, registry: builder, enforced: true })
    .findings.some((f) => /CT-R09.*builders/.test(f)));
  // With no registry mounted the authority is taken as stated — this gate does not invent a registry.
  assert.deepEqual(evaluate(record({ surfaces: [surface({ authority: 'someone' })] }), { models: MODELS, enforced: true }).findings, []);
});

test('CT-R10 — an overturn that lands nowhere can never reach the monitoring', () => {
  assert.ok(evaluate(record({ surfaces: [surface({ overturns_recorded_in: undefined })] }), { models: MODELS, registry: REGISTRY, enforced: true })
    .findings.some((f) => /CT-R10/.test(f)));
});

test('DORMANCY — every rule is a notice until a compiled plan requires the capability', () => {
  const broken = record({
    response_sla_days: undefined,
    surfaces: [surface({ decision: undefined, reason_surface: undefined, contest_route: { how: 'the form' }, authority: 'nobody', overturns_recorded_in: undefined })],
  });
  const models = [...MODELS, { role: 'pricing', risk_tier: 'high' }];
  const dormant = evaluate(broken, { models, registry: REGISTRY });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  for (const rule of ['CT-R02', 'CT-R04', 'CT-R05', 'CT-R06', 'CT-R08', 'CT-R09', 'CT-R10']) {
    assert.ok(dormant.notices.some((n) => n.startsWith(rule)), `${rule} missing from notices:\n${dormant.notices.join('\n')}`);
  }
  // Armed, the same record fails on all of them — dormant, not toothless.
  const live = evaluate(broken, { models, registry: REGISTRY, enforced: true });
  for (const rule of ['CT-R02', 'CT-R04', 'CT-R05', 'CT-R06', 'CT-R08', 'CT-R09', 'CT-R10']) {
    assert.ok(live.findings.some((f) => f.startsWith(rule)), `${rule} missing from findings:\n${live.findings.join('\n')}`);
  }
  // CT-R11 stays a notice in the armed posture — it is the standing limit, not a defect.
  assert.ok(live.notices.every((n) => n.startsWith('CT-R11')), live.notices.join('\n'));
});

test('the SHIPPED TEMPLATE never reads as a declaration', { skip: SKIP_NO_TEMPLATE }, () => {
  const doc = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  assert.ok(isPlaceholder(doc.surfaces[0].role));
  assert.ok(isPlaceholder(doc.response_sla_days));
  // Mounting it can never fail anybody: dormant, CT-R01 is a notice and nothing is a finding.
  const dormant = evaluate(doc, { models: MODELS });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.ok(dormant.notices.some((n) => /CT-R01/.test(n)));
});

/** A repository with an optional compiled plan requiring the capability, and optional records. */
function repo({ requires = false, contestability = null, manifest = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-contest-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: ['PA2'],
    required_capabilities: requires ? { [CAPABILITY]: { required: true } } : {},
  }));
  if (contestability) writeFileSync(join(dir, 'docs/governance/decision-contestability.json'), typeof contestability === 'string' ? contestability : JSON.stringify(contestability));
  if (manifest) writeFileSync(join(dir, 'docs/governance/model-manifest.json'), JSON.stringify({ models: manifest }));
  return dir;
}

test('run() — INERT for a repository with no record and nothing compiled', () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
  } finally { clean(dir); }
});

test('run() — a compiled plan with no record FAILS and names the change', () => {
  const dir = repo({ requires: true });
  try {
    const r = run(dir);
    assert.ok(r.findings.some((f) => /CHG-1/.test(f) && new RegExp(CAPABILITY).test(f)), r.findings.join('\n'));
    assert.deepEqual(requiringChanges(aggregateRequirements(dir)), ['CHG-1']);
  } finally { clean(dir); }
});

test('run() — without a manifest the coverage rule CANNOT run, and the gate says so', () => {
  const dir = repo({ requires: true, contestability: record() });
  try {
    const r = run(dir);
    assert.equal(r.joined, false);
    assert.ok(r.notices.some((n) => /THE COVERAGE RULE \(CT-R02\) could not run/.test(n)), r.notices.join('\n'));
  } finally { clean(dir); }
});

test('run() — with a manifest, an uncovered deciding model fails and is named', () => {
  const dir = repo({ requires: true, contestability: record(), manifest: [...MODELS, { role: 'pricing', risk_tier: 'high' }] });
  try {
    const r = run(dir);
    assert.equal(r.joined, true);
    assert.ok(r.findings.some((f) => /CT-R02.*"pricing"/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() — unparseable JSON is a finding when armed and a notice when dormant', () => {
  for (const requires of [true, false]) {
    const dir = repo({ requires, contestability: '{not json' });
    try {
      const r = run(dir);
      const where = requires ? r.findings : r.notices;
      assert.ok(where.some((m) => /not valid JSON/.test(m)), `requires=${requires}`);
      if (!requires) assert.deepEqual(r.findings, []);
    } finally { clean(dir); }
  }
});
