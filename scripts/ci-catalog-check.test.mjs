// Tests for the CI-catalog closure gate. Node runner: `node --test`.
//
// The gate's whole value is one assertion, so the tests are mostly about not weakening it:
//
//   1. THE REAL WORKFLOW CLOSES — not a fixture, but whichever workflow/catalog pair this layout
//      actually has (see the resolution below: the bundle's, or an adopted repo's). This is the
//      regression that matters: it is the exact check that was missing when nine Factory Floor
//      gates ran in CI with no catalog entry and the gate runner silently dropped every one.
//   2. AGREEMENT WITH THE RUNNER. gate-runner selects on mechanism_ref; this gate closes on
//      mechanism_ref. Asserted against core/gate-runner.mjs's own selection rather than restated,
//      so the two cannot drift apart into a gate that passes while the runner still skips.
//   3. THE EXEMPTION CANNOT GO QUIET. A report-only carve-out must be named AND printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, gatesInWorkflow, main, mechanismArgCollisions, REPORT_ONLY, CI_LOCATIONS, CATALOG_LOCATIONS } from './ci-catalog-check.mjs';
import { select } from '../core/gate-runner.mjs';

// These tests run in BOTH layouts — the bundle (where the reference workflow is `ci/ci.yml` and
// the catalog is a `.template.json`) and an adopted repo (where CI's adoption dry-run re-runs
// this whole suite against `.github/workflows/ci.yml` + `docs/governance/control-catalog.json`).
// Resolving the pair rather than hard-coding the bundle's is not a convenience: the adopted
// layout is where closure actually protects someone, so the assertions should hold there too.
const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pick = (...candidates) => candidates.find((p) => existsSync(p)) || null;
const CI = pick(resolve(HARNESS, 'ci/ci.yml'), resolve(process.cwd(), '.github/workflows/ci.yml'));
const CATALOG = pick(
  resolve(HARNESS, 'governance/control-catalog.template.json'),
  resolve(process.cwd(), 'docs/governance/control-catalog.json'),
);
const readCatalog = () => JSON.parse(readFileSync(CATALOG, 'utf8'));

test('the shipped workflow closes over the shipped catalog', () => {
  const findings = evaluate(readFileSync(CI, 'utf8'), readCatalog());
  assert.deepEqual(findings, [], `uncatalogued CI gates:\n${findings.join('\n')}`);
});

test('every gate the workflow runs is runner-reachable, or exempted with a stated reason', () => {
  // The closure gate's PURPOSE, asserted end to end. Presence in the catalog is not enough: a
  // gate must actually be SELECTABLE by the runner in some lane, or be marked `execute: false`
  // with an `execute_note` saying who runs it instead (Q1B is the real case — it needs a
  // merge-base the runner does not supply, so CI invokes it directly). What this forbids is the
  // third case: catalogued, never selected, and nothing saying so — which reads as covered.
  const catalog = readCatalog();
  const byMechanism = new Map(catalog.controls.filter((c) => c.mechanism_ref).map((c) => [c.mechanism_ref, c]));
  const gates = gatesInWorkflow(readFileSync(CI, 'utf8'))
    .filter((g) => g.startsWith('scripts/') && !REPORT_ONLY.has(g));
  const reachable = new Set();
  for (const lane of ['pr', 'build', 'release', 'deploy', 'scheduled']) {
    for (const entry of select(catalog, { lane, changedPaths: null }).run.values()) reachable.add(entry.mechanism);
  }
  const silent = gates.filter((g) => {
    if (reachable.has(g)) return false;
    const c = byMechanism.get(g);
    return !(c && c.execute === false && typeof c.execute_note === 'string' && c.execute_note.trim());
  });
  assert.deepEqual(silent, [], `catalogued, never selected by the runner, and no execute_note explaining who runs it:\n${silent.join('\n')}`);
});

test('the nine Factory Floor gates are specifically covered', () => {
  // Named explicitly so a future edit that drops one from the catalog fails HERE, with the
  // reason, rather than only inside the generic closure assertion.
  const mechanisms = new Set(readCatalog().controls.map((c) => c.mechanism_ref));
  for (const gate of [
    'scripts/floor-only-check.mjs',
    'scripts/floor-keeper-check.mjs',
    'scripts/approval-surface-check.mjs',
    'scripts/projection-capability-check.mjs',
    'scripts/freeze-stamp-check.mjs',
    'scripts/drift-check.mjs',
    'scripts/template-parity-check.mjs',
    'scripts/identity-map-check.mjs',
    'scripts/adapter-evidence-check.mjs',
  ]) {
    assert.ok(mechanisms.has(gate), `${gate} lost its catalog entry — the gate runner would stop running it`);
  }
});

test('the shipped catalog has no mechanism-args collisions, and a collision fails (rc.33)', () => {
  // The runner de-duplicates executions by mechanism_ref and keeps the FIRST control's args —
  // two controls sharing a mechanism with different args means one control's arguments silently
  // never run while both are reported executed. The shipped catalog must be clean, and the rule
  // must bite on a forged collision.
  assert.deepEqual(mechanismArgCollisions(readCatalog()), []);
  const collided = { controls: [
    { control_id: 'X-1', mechanism_ref: 'scripts/x.mjs', mechanism_args: ['--strict'] },
    { control_id: 'X-2', mechanism_ref: 'scripts/x.mjs' },
    { control_id: 'Y-1', mechanism_ref: 'scripts/y.mjs', mechanism_args: ['--same'] },
    { control_id: 'Y-2', mechanism_ref: 'scripts/y.mjs', mechanism_args: ['--same'] },
  ] };
  const findings = mechanismArgCollisions(collided);
  assert.equal(findings.length, 1, 'identical args must not collide; differing args must');
  assert.match(findings[0], /scripts\/x\.mjs/);
  assert.match(findings[0], /only one variant/);
});

test('the execute:false inventory is PRINTED, so the escape hatch cannot go quiet (rc.33)', () => {
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try {
    main(['--ci', CI]);
  } finally {
    process.stdout.write = write;
  }
  const out = chunks.join('');
  assert.match(out, /execute:false — the runner never spawns these/);
  assert.match(out, /test-integrity-check\.mjs/);
});

test('NEGATIVE — an uncatalogued gate fails, and the finding names the runner consequence', () => {
  const yaml = 'jobs:\n  gates:\n    steps:\n      - run: node scripts/invented-check.mjs\n';
  const findings = evaluate(yaml, { controls: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /scripts\/invented-check\.mjs/);
  assert.match(findings[0], /gate-runner/);
});

test('a report-only tool is exempt, but only via the named list', () => {
  const yaml = '      - run: node scripts/token-report.mjs --check\n';
  assert.deepEqual(evaluate(yaml, { controls: [] }), []);
  assert.ok(REPORT_ONLY.has('scripts/token-report.mjs'));
  assert.match(REPORT_ONLY.get('scripts/token-report.mjs'), /never a merge gate/);
});

test('the exemption list is PRINTED, so a carve-out cannot go quiet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-catalog-report-'));
  const ci = join(dir, 'ci.yml');
  writeFileSync(ci, 'jobs:\n  report:\n    steps:\n      - run: node scripts/token-report.mjs --check\n');
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try {
    main(['--ci', ci]);
  } finally {
    process.stdout.write = write;
    rmSync(dir, { recursive: true, force: true });
  }
  const out = chunks.join('');
  assert.match(out, /report-only, deliberately not controls/);
  assert.match(out, /token-report\.mjs/);
});

test('gate extraction finds gates in both list and multi-command run blocks', () => {
  const yaml = [
    '      - run: node scripts/a-check.mjs',
    '      - run: |',
    '          node scripts/b-check.mjs',
    '          node scripts/c-check.mjs --flag && node scripts/d-check.mjs',
    '          node core/gate-runner.mjs --lane pr',
    '        # node scripts/not-real.mjs is prose, but a commented gate is still a gate we would rather catch',
  ].join('\n');
  const gates = gatesInWorkflow(yaml);
  for (const g of ['scripts/a-check.mjs', 'scripts/b-check.mjs', 'scripts/c-check.mjs', 'scripts/d-check.mjs', 'core/gate-runner.mjs']) {
    assert.ok(gates.includes(g), `missed ${g}`);
  }
});

test('a missing workflow is not a failure — an adoption may not have wired CI yet', () => {
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  let code;
  try {
    code = main(['--ci', resolve(HARNESS, 'ci/does-not-exist.yml')]);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(code, 0);
  assert.match(chunks.join(''), /nothing to close over/);
});

test('the search locations cover both the adopted and the bundle layout', () => {
  assert.ok(CI_LOCATIONS.some((p) => p === '.github/workflows/ci.yml'));
  assert.ok(CATALOG_LOCATIONS.some((p) => p === 'docs/governance/control-catalog.json'));
});
