// Tests for the exposure gate (rc.39 · flow-plan Phase 5.2). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COHORT_STAGES, evaluate, run } from './feature-flag-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-08-01T00:00:00Z');
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

const REGISTRY = {
  identities: [
    { id: 'po-fatima', kind: 'human', groups: [] },
    { id: 'agent-loom-delivery', kind: 'agent', groups: ['builders'] },
  ],
};
const CHANGES = [{ change_id: 'CHG-1', current_state: 'in-delivery', requires_exposure_control: true }];

const flag = (over = {}) => ({
  flag_key: 'credit.decisioning.enabled', change_id: 'CHG-1', default: false, owner: 'po-fatima',
  kill_path: 'flag console → off; drains to manual queue', cohort_stage: 'capped-production-cohort',
  expires: inDays(180), ...over,
});
const check = (flags, over = {}) => evaluate({ flags }, { registry: REGISTRY, changes: CHANGES, now: NOW, ...over });

test('a well-formed flag against a governed change passes clean', () => {
  const { findings, notices } = check([flag()]);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('DEFAULT OFF — default true (or missing) is refused; that is the whole pattern', () => {
  for (const bad of [true, undefined, 'off']) {
    const { findings } = check([flag({ default: bad })]);
    assert.ok(findings.some((f) => /not an exposure control, it is a deploy/.test(f)), JSON.stringify(bad));
  }
});

test('OWNER — must resolve, and must not be an agent', () => {
  assert.ok(check([flag({ owner: 'nobody' })]).findings.some((f) => /does not resolve/.test(f)));
  assert.ok(check([flag({ owner: 'agent-loom-delivery' })]).findings.some((f) => /the thing you page at 3am is a person/.test(f)));
  assert.ok(check([flag()], { registry: null }).findings.some((f) => /no identity registry found/.test(f)));
});

test('KILL PATH and COHORT STAGE are required, and the stages are the pilot playbook\'s six', () => {
  assert.ok(check([flag({ kill_path: '' })]).findings.some((f) => /no kill_path/.test(f)));
  assert.ok(check([flag({ cohort_stage: 'ga' })]).findings.some((f) => /cohort_stage must be one of/.test(f)));
  assert.equal(COHORT_STAGES.length, 6);
  for (const s of COHORT_STAGES) assert.deepEqual(check([flag({ cohort_stage: s })]).findings, []);
});

test('OWNING CHANGE — an unresolvable change_id fails; no changes tree at all is NOT VERIFIED, never a quiet pass', () => {
  assert.ok(check([flag({ change_id: 'CHG-NOPE' })]).findings.some((f) => /does not resolve under/.test(f)));
  const { findings, notices } = check([flag()], { changes: null });
  assert.deepEqual(findings, []);
  assert.ok(notices.some((n) => /NOT VERIFIED/.test(n)));
});

test('RETIREMENT — a flag outliving a closed change is stale exposure machinery', () => {
  const { findings } = check([flag()], { changes: [{ change_id: 'CHG-1', current_state: 'closed', requires_exposure_control: true }] });
  assert.ok(findings.some((f) => /a flag outliving its change/.test(f)), findings.join('\n'));
});

test('EXPIRY — expired FAILS, undated FAILS, and 30/14/7 are notices that never fail', () => {
  assert.ok(check([flag({ expires: inDays(-1) })]).findings.some((f) => /EXPIRED/.test(f)));
  assert.ok(check([flag({ expires: 'when we are confident' })]).findings.some((f) => /permanent branch in production/.test(f)));
  for (const [days, band] of [[29, 30], [13, 14], [5, 7]]) {
    const { findings, notices } = check([flag({ expires: inDays(days) })]);
    assert.deepEqual(findings, [], `${days}d out must not fail`);
    assert.match(notices[0], new RegExp(`${band}-day band`));
  }
  assert.deepEqual(check([flag({ expires: inDays(31) })]).notices, []);
});

test('duplicate keys and whitespace keys are refused', () => {
  assert.ok(check([flag(), flag()]).findings.some((f) => /duplicate flag_key/.test(f)));
  assert.ok(check([flag({ flag_key: 'credit decisioning' })]).findings.some((f) => /contains whitespace/.test(f)));
});

test('MANDATORY-WHEN-COMPILED — a change requiring exposure_control with no flag naming it fails', () => {
  const { findings } = check([]);
  assert.ok(findings.some((f) => /CHG-1: its compiled plan requires the exposure_control capability/.test(f)), findings.join('\n'));
  // …and a change that does NOT require it is not dragged in.
  const relaxed = evaluate({ flags: [] }, { registry: REGISTRY, now: NOW, changes: [{ change_id: 'CHG-2', current_state: 'in-delivery', requires_exposure_control: false }] });
  assert.deepEqual(relaxed.findings, []);
});

// ── run(): the mandatory-when-compiled derivation end to end, off a real tree ─────────────────
function repo({ requiresExposure = true, flags = null, state = 'in-delivery' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: state, control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: [], required_evidence: [],
    required_capabilities: requiresExposure ? { exposure_control: { required: true } } : {},
  }));
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  if (flags) writeFileSync(join(dir, 'docs/governance/feature-flags.json'), JSON.stringify({ flags }));
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('run(): no register + no compiling change is SILENT; no register + a compiling change FAILS', () => {
  const quiet = repo({ requiresExposure: false });
  try {
    const r = run(quiet);
    assert.equal(r.present, false);
    assert.deepEqual(r.findings, []);
  } finally { clean(quiet); }

  const loud = repo();
  try {
    const r = run(loud);
    assert.equal(r.required, true);
    assert.ok(r.findings.some((f) => /requires the exposure_control capability \[CHG-1\]/.test(f)), r.findings.join('\n'));
  } finally { clean(loud); }
});

test('run(): a register that names the compiling change passes', () => {
  const dir = repo({ flags: [flag({ expires: '2099-01-01' })] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.equal(r.count, 1);
  } finally { clean(dir); }
});

// The shipped worked example must itself be sound — a demonstration that fails its own gate
// teaches the wrong shape. Resolved across the bundle AND adopted locations, and skipped with a
// stated reason where the example is not shipped (the installer does not ship demonstration data).
const EXAMPLE = [`${H}/exposure-example/feature-flags.json`, `${H}/../exposure-example/feature-flags.json`].find(existsSync);
test('the shipped exposure example is a valid register against the shipped registry', { skip: !EXAMPLE && 'exposure-example not present in this layout' }, () => {
  const doc = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const registry = JSON.parse(readFileSync([`${H}/governance/identities.template.json`, `${H}/docs/governance/identities.json`].find(existsSync), 'utf8'));
  const { findings } = evaluate(doc, {
    registry,
    changes: [{ change_id: 'CHG-2026-0042', current_state: 'in-delivery', requires_exposure_control: true }],
    now: NOW,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});
