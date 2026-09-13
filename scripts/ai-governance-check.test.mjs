import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY, SCHEMA, evaluate, isPlaceholder, run } from './ai-governance-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only inspect the immutable bundle template. In the adopted-layout CI exercise the destination
// is deliberately replaced with the worked governance record before tests run; treating that live
// adopter file as the template would make this unit test depend on test ordering.
const TEMPLATE_CANDIDATE = join(H, 'governance/ai-governance.template.json');
const TEMPLATE = existsSync(TEMPLATE_CANDIDATE) ? TEMPLATE_CANDIDATE : null;
const clean = (dir) => rmSync(dir, { recursive: true, force: true });
const MODEL = {
  role: 'credit-decision', model_id: 'credit@7', prompt_version: 'affordability@4', risk_tier: 'high',
  third_party: { outsourcing_assessment: 'OSR-9' },
};
const REGISTRY = { identities: [
  { id: 'exec-noor', kind: 'human', roles: ['accountable-executive'], groups: ['second-line'] },
  { id: 'eng-omar', kind: 'human', roles: ['accountable-executive'], groups: ['builders'] },
  { id: 'agent-x', kind: 'agent', roles: ['accountable-executive'], groups: [] },
] };
const system = (over = {}) => ({
  role: MODEL.role,
  model_id: MODEL.model_id,
  prompt_version: MODEL.prompt_version,
  use_case: 'Recommend whether a customer receives a requested credit-limit increase.',
  consumer_impact: 'material-decision',
  accountable_owner: 'exec-noor',
  human_oversight: {
    mode: 'human-in-the-loop',
    operator_role: 'credit-underwriter',
    intervention_path: 'The underwriter rejects or overrides before any limit is changed.',
    alternative_arrangement: 'Route to manual affordability assessment on request.',
    customer_review_path: 'In-app review request or branch-assisted review.',
    overrides_recorded_in: 'model-oversight ledger',
  },
  disclosure: { english_surface: 'credit decision screen EN', arabic_surface: 'credit decision screen AR' },
  monitoring: { metrics: ['override rate', 'outcome drift'], review_every_days: 30, incident_runbook: 'docs/governance/runbooks/ai-incident-runbook.md' },
  privacy_security_assessment: 'docs/governance/changes/CHG-1/dpia.json + architecture-assurance.json',
  third_party_assessment: 'docs/governance/outsourcing/OSR-9.md',
  stress_test: { ref: 'docs/governance/ai-evidence/stress.json', sha256: 'a'.repeat(64) },
  ...over,
});
const record = (over = {}) => ({ schema: SCHEMA, systems: [system()], ...over });

test('complete AI governance record passes with the standing runtime notice', () => {
  const result = evaluate(record(), { models: [MODEL], registry: REGISTRY, requiredRoles: new Set([MODEL.role]), enforced: true });
  assert.deepEqual(result.findings, [], result.findings.join('\n'));
  assert.ok(result.notices.some((n) => /AG-R15.*does not observe/.test(n)));
});

test('template placeholders are not declarations', { skip: !TEMPLATE && 'template absent' }, () => {
  const doc = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  assert.equal(isPlaceholder(doc.systems[0].role), true);
  const result = evaluate(doc, { models: [MODEL], registry: REGISTRY, requiredRoles: new Set([MODEL.role]), enforced: true });
  assert.ok(result.findings.some((f) => /AG-R02/.test(f)));
  assert.ok(result.findings.some((f) => /AG-R03.*credit-decision/.test(f)));
});

test('AG-R01/R02 — schema and populated systems are required', () => {
  const result = evaluate({}, { enforced: true });
  assert.ok(result.findings.some((f) => /AG-R01/.test(f)));
  assert.ok(result.findings.some((f) => /AG-R02/.test(f)));
});

test('AG-R03/R04 — coverage joins the governed change to the model manifest', () => {
  const missing = evaluate(record({ systems: [] }), { models: [MODEL], requiredRoles: new Set([MODEL.role]), enforced: true });
  assert.ok(missing.findings.some((f) => /AG-R03.*credit-decision/.test(f)));
  const ghost = evaluate(record({ systems: [system({ role: 'ghost' })] }), { models: [MODEL], requiredRoles: new Set(), enforced: true });
  assert.ok(ghost.findings.some((f) => /AG-R04.*ghost/.test(f)));
});

test('AG-R02/R03/R07 — duplicate roles, a missing manifest, or a missing identity registry fail closed', () => {
  const duplicate = evaluate(record({ systems: [system(), system()] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.ok(duplicate.findings.some((f) => /AG-R02.*more than once/.test(f)));
  const noManifest = evaluate(record(), { models: null, registry: REGISTRY, enforced: true });
  assert.ok(noManifest.findings.some((f) => /AG-R03.*no readable model manifest/.test(f)));
  const noRegistry = evaluate(record(), { models: [MODEL], registry: null, enforced: true });
  assert.ok(noRegistry.findings.some((f) => /AG-R07.*no readable identity registry/.test(f)));
});

test('coverage scope does not demand unrelated model roles; null scope fails open to covered tiers', () => {
  const other = { role: 'internal-reviewer', model_id: 'm@1', prompt_version: 'p@1', risk_tier: 'medium' };
  const scoped = evaluate(record(), { models: [MODEL, other], requiredRoles: new Set([MODEL.role]), registry: REGISTRY, enforced: true });
  assert.ok(!scoped.findings.some((f) => /internal-reviewer/.test(f)), scoped.findings.join('\n'));
  const broad = evaluate(record(), { models: [MODEL, other], requiredRoles: null, registry: REGISTRY, enforced: true });
  assert.ok(broad.findings.some((f) => /AG-R03.*internal-reviewer/.test(f)), broad.findings.join('\n'));
});

test('AG-R05 — model and prompt pins bind the governance decision', () => {
  const result = evaluate(record({ systems: [system({ model_id: 'credit@6' })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.ok(result.findings.some((f) => /AG-R05.*STALE/.test(f)));
});

test('AG-R06 — the consumer use and impact are explicit', () => {
  const result = evaluate(record({ systems: [system({ use_case: '', consumer_impact: 'assistive' })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.equal(result.findings.filter((f) => /AG-R06/.test(f)).length, 2);
});

test('AG-R07 — accountable owner resolves to a non-builder human holding the role', () => {
  for (const accountable_owner of ['missing', 'eng-omar', 'agent-x']) {
    const result = evaluate(record({ systems: [system({ accountable_owner })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
    assert.ok(result.findings.some((f) => /AG-R07/.test(f)), accountable_owner);
  }
});

test('AG-R08/R09 — meaningful oversight includes intervention, review and a non-AI route', () => {
  const humanOut = evaluate(record({ systems: [system({ human_oversight: { ...system().human_oversight, mode: 'human-out-of-the-loop' } })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.ok(humanOut.findings.some((f) => /AG-R08.*reserved for low-risk/.test(f)));
  const empty = evaluate(record({ systems: [system({ human_oversight: {} })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.ok(empty.findings.some((f) => /AG-R08/.test(f)));
  assert.equal(empty.findings.filter((f) => /AG-R09/.test(f)).length, 5);
});

test('AG-R10/R11/R12 — bilingual disclosure, monitoring, incident response and assessment are required', () => {
  const result = evaluate(record({ systems: [system({ disclosure: {}, monitoring: {}, privacy_security_assessment: '' })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.equal(result.findings.filter((f) => /AG-R10/.test(f)).length, 2);
  assert.equal(result.findings.filter((f) => /AG-R11/.test(f)).length, 3);
  assert.ok(result.findings.some((f) => /AG-R12/.test(f)));
});

test('AG-R13 applies when the manifest declares an external provider', () => {
  const result = evaluate(record({ systems: [system({ third_party_assessment: '' })] }), { models: [MODEL], registry: REGISTRY, enforced: true });
  assert.ok(result.findings.some((f) => /AG-R13/.test(f)));
  const internal = evaluate(record({ systems: [system({ third_party_assessment: '' })] }), { models: [{ ...MODEL, third_party: undefined }], registry: REGISTRY, enforced: true });
  assert.ok(!internal.findings.some((f) => /AG-R13/.test(f)));
});

test('AG-R14 re-hashes stress-test evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-gov-'));
  try {
    const ref = 'docs/governance/ai-evidence/stress.json';
    mkdirSync(join(dir, dirname(ref)), { recursive: true });
    writeFileSync(join(dir, ref), '{"result":"pass"}\n');
    const sha256 = createHash('sha256').update(readFileSync(join(dir, ref))).digest('hex');
    const good = evaluate(record({ systems: [system({ stress_test: { ref, sha256 } })] }), { models: [MODEL], registry: REGISTRY, baseDir: dir, enforced: true });
    assert.deepEqual(good.findings, [], good.findings.join('\n'));
    writeFileSync(join(dir, ref), '{"result":"changed"}\n');
    const bad = evaluate(record({ systems: [system({ stress_test: { ref, sha256 } })] }), { models: [MODEL], registry: REGISTRY, baseDir: dir, enforced: true });
    assert.ok(bad.findings.some((f) => /AG-R14.*does not match/.test(f)));
  } finally { clean(dir); }
});

test('mandatory-when-compiled: absent is inert until a plan requires AI governance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-gov-run-'));
  try {
    assert.equal(run(dir).inert, true);
    const base = join(dir, 'docs/governance/changes/CHG-AI');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-AI', current_state: 'in-delivery', model_roles: [MODEL.role] }));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_capabilities: { [CAPABILITY]: { required: true } } }));
    const result = run(dir);
    assert.equal(result.required, true);
    assert.ok(result.findings.some((f) => /CHG-AI.*absent/.test(f)));
  } finally { clean(dir); }
});
