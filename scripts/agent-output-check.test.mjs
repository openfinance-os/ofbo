// Tests for the agent output contract gate (2.1.0, plan phase 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDefinition, validate, invariants, checkFixtures, checkManifestRoles, check, SCHEMA_ID, REQUIRED_DECLARATIONS } from './agent-output-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = [join(HARNESS, 'agents/agent-output.schema.json'), join(HARNESS, '.claude/agents/agent-output.schema.json')].find(existsSync);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const EVALS = [join(HARNESS, 'agents/evals'), join(HARNESS, '.claude/agents/evals')].find(existsSync);

const good = (over = {}) => ({
  schema: SCHEMA_ID, agent: 'risk-reviewer', prompt_version: 'loom-agents@2.1.0', model: 'example-model@2026-01',
  inputs_read: ['docs/governance/data-risk-register/risks.json'], register_state: 'mounted', verdict: 'ACCEPTABLE', confidence: 'high',
  findings: [{ id: 'ASSESS 1', severity: 'low', subject: 'DR-1.1', issue: 'touched, residual unchanged', evidence_refs: [{ file: 'docs/governance/data-risk-register/risks.json', locator: 'DR-1.1' }] }],
  ...over,
});
const DEFINITION = `---\nname: risk-reviewer\n---\n## Output\nemit loom.agent-output/v1; INSUFFICIENT_EVIDENCE when the register is absent; confidence; evidence_refs on every finding.\n`;

test('a complete definition passes; each missing declaration is its own finding', () => {
  assert.deepEqual(checkDefinition(DEFINITION, 'x'), []);
  assert.ok(checkDefinition('# no output section\n', 'x').some((f) => /no "## Output"/.test(f)));
  for (const d of REQUIRED_DECLARATIONS) {
    const without = DEFINITION.split('\n').filter((l) => !d.re.test(l) || l.startsWith('## ')).join('\n').replace(/^## Output$/m, '## Output\n');
    if (d.re.test(without)) continue; // declaration also appears elsewhere in this tiny fixture
    assert.ok(checkDefinition(without, 'x').some((f) => f.includes(d.what)), d.what);
  }
});

test('a well-formed output validates; shape defects are named by path', () => {
  assert.deepEqual(validate(good(), schema), []);
  assert.ok(validate(good({ schema: 'other' }), schema).some((f) => f.startsWith('$.schema')));
  assert.ok(validate(good({ agent: 'not-an-agent' }), schema).some((f) => f.startsWith('$.agent')));
  assert.ok(validate(good({ verdict: 'MAYBE' }), schema).some((f) => f.startsWith('$.verdict')));
  assert.ok(validate(good({ findings: [{ id: 'x', severity: 'low', subject: 's', issue: 'i', evidence_refs: [] }] }), schema).some((f) => /evidence_refs: needs at least 1/.test(f)));
  const { confidence, ...noConfidence } = good();
  assert.ok(validate(noConfidence, schema).some((f) => /missing required confidence/.test(f)));
});

test('invariants: absent register forces INSUFFICIENT_EVIDENCE with a reason; refs must be read; a pass carries no blocker; unknown pins fail', () => {
  assert.deepEqual(invariants(good()), []);
  assert.ok(invariants(good({ register_state: 'absent' })).some((f) => /register_state is absent but verdict/.test(f)));
  assert.deepEqual(invariants(good({ register_state: 'absent', verdict: 'INSUFFICIENT_EVIDENCE', findings: [], reason: 'register not mounted' })), []);
  assert.ok(invariants(good({ verdict: 'INSUFFICIENT_EVIDENCE', findings: [] })).some((f) => /no reason/.test(f)));
  assert.ok(invariants(good({ inputs_read: ['other.json'] })).some((f) => /not in inputs_read/.test(f)));
  assert.ok(invariants(good({ findings: [{ ...good().findings[0], severity: 'high' }] })).some((f) => /a pass does not carry a blocker/.test(f)));
  assert.deepEqual(invariants(good({ verdict: 'ESCALATE', findings: [{ ...good().findings[0], severity: 'high' }] })), []);
  assert.ok(invariants(good({ model: 'unknown' })).some((f) => /"unknown"/.test(f)));
});

test('the shipped fixtures validate and cover the register-absent case', { skip: !EVALS && 'fixtures absent' }, () => {
  const { findings, cases } = checkFixtures(EVALS, schema);
  assert.deepEqual(findings, []);
  assert.ok(cases >= 5);
  const absent = JSON.parse(readFileSync(join(EVALS, 'risk-reviewer/register-absent/expected.json'), 'utf8'));
  assert.equal(absent.verdict, 'INSUFFICIENT_EVIDENCE');
  assert.equal(absent.register_state, 'absent');
});

test('fixture defects are findings: a register-less case that expects a verdict, a cited input missing from input/, a case/expected mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-evals-'));
  try {
    const put = (name, meta, exp, inputs = {}) => {
      const d = join(dir, 'risk-reviewer', name); mkdirSync(join(d, 'input'), { recursive: true });
      writeFileSync(join(d, 'case.json'), JSON.stringify(meta)); writeFileSync(join(d, 'expected.json'), JSON.stringify(exp));
      for (const [f, c] of Object.entries(inputs)) { mkdirSync(dirname(join(d, 'input', f)), { recursive: true }); writeFileSync(join(d, 'input', f), c); }
    };
    put('ok', { register_mounted: true, expect_verdict: 'ACCEPTABLE' }, good(), { 'docs/governance/data-risk-register/risks.json': '{}' });
    put('absent-with-verdict', { register_mounted: false }, good({ inputs_read: [], findings: [] }));
    put('missing-input', { register_mounted: true }, good());
    put('mismatch', { register_mounted: true, expect_verdict: 'ESCALATE' }, good(), { 'docs/governance/data-risk-register/risks.json': '{}' });
    put('wrong-agent', { register_mounted: true }, good({ agent: 'change-watch', verdict: 'CLEAR' }), { 'docs/governance/data-risk-register/risks.json': '{}' });
    mkdirSync(join(dir, 'risk-reviewer/incomplete'));
    const { findings, cases } = checkFixtures(dir, schema);
    assert.equal(cases, 6);
    assert.ok(!findings.some((f) => f.startsWith('risk-reviewer/ok')), findings.join('\n'));
    assert.ok(findings.some((f) => /absent-with-verdict.*register is not mounted but expects ACCEPTABLE/.test(f)));
    assert.ok(findings.some((f) => /absent-with-verdict.*expected.register_state is mounted/.test(f)));
    assert.ok(findings.some((f) => /missing-input.*not in the fixture's input/.test(f)));
    assert.ok(findings.some((f) => /mismatch.*case.json expects ESCALATE/.test(f)));
    assert.ok(findings.some((f) => /wrong-agent.*expected.agent is change-watch/.test(f)));
    assert.ok(findings.some((f) => /incomplete: needs case.json and expected.json/.test(f)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every emitting agent must be a manifest role, by name or through a role\'s agents list', () => {
  assert.deepEqual(checkManifestRoles({ models: [{ role: 'risk-reviewer' }] }, ['risk-reviewer']), []);
  assert.deepEqual(checkManifestRoles({ models: [{ role: 'assurance-reviewers', agents: ['risk-reviewer', 'change-watch'] }] }, ['risk-reviewer', 'change-watch']), []);
  const f = checkManifestRoles({ models: [{ role: 'delivery-loop' }] }, ['risk-reviewer']);
  assert.equal(f.length, 1); assert.match(f[0], /HG-0006/);
  assert.equal(checkManifestRoles(null, ['x']).length, 1);
});

test('the shipped bundle passes end to end, and an adopted tree with an unlisted agent fails', () => {
  const r = check(HARNESS);
  assert.deepEqual(r.findings, []);
  assert.ok(r.agents >= 3, 'the harness reviewer templates are read');
  assert.ok(r.notices.some((n) => /structural only/.test(n)), 'the gate says it did not run the model');
  const dir = mkdtempSync(join(tmpdir(), 'agent-adopted-'));
  try {
    mkdirSync(join(dir, '.claude/agents'), { recursive: true }); mkdirSync(join(dir, 'docs/governance'), { recursive: true });
    cpSync(SCHEMA_PATH, join(dir, '.claude/agents/agent-output.schema.json'));
    writeFileSync(join(dir, '.claude/agents/hard-stop-reviewer.md'), '---\nname: hard-stop-reviewer\n---\n## Output\nVERDICT: PASS or FAIL\n');
    writeFileSync(join(dir, 'docs/governance/model-manifest.json'), JSON.stringify({ models: [{ role: 'delivery-loop' }] }));
    const bad = check(dir);
    assert.ok(bad.findings.some((f) => /hard-stop-reviewer: does not declare the output schema id/.test(f)), bad.findings.join('\n'));
    assert.ok(bad.findings.some((f) => /hard-stop-reviewer: emits loom.agent-output\/v1 but is not a role/.test(f)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
