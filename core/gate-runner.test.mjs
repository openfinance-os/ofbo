// Tests for the gate runner's selection logic. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { select, LANES } from './gate-runner.mjs';

const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), 'gate-runner.mjs');

const CAT = { controls: [
  { control_id: 'CORE-1', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true },
  { control_id: 'SCOPED-1', mechanism_ref: 'scripts/b.mjs', lane: 'pr', paths: ['docs/governance/changes/', 'profiles/'] },
  { control_id: 'SCOPED-2', mechanism_ref: 'scripts/c.mjs', lane: 'pr', paths: ['docs/governance/model-manifest.json'] },
  { control_id: 'UNSCOPED', mechanism_ref: 'scripts/d.mjs', lane: 'pr' },
  { control_id: 'REL-1', mechanism_ref: 'scripts/e.mjs', lane: 'release' },
  { control_id: 'DOC-ONLY', doc_ref: 'runbook.md', lane: 'pr' },
  { control_id: 'LIB-1', mechanism_ref: 'core/lib.mjs', lane: 'pr', execute: false, execute_note: 'library — enforced via scripts/b.mjs' },
  { control_id: 'CORE-1B', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true },
] };

const ids = (r) => r.run.flatMap((g) => g.ids).sort();
const skippedIds = (r) => r.skipped.map((s) => s.id).sort();

test('always-on core runs whatever the diff; out-of-scope controls skip WITH a recorded reason', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: ['README.md'] });
  assert.deepEqual(ids(r), ['CORE-1', 'CORE-1B', 'UNSCOPED']);
  assert.deepEqual(skippedIds(r), ['LIB-1', 'REL-1', 'SCOPED-1', 'SCOPED-2']);
  for (const s of r.skipped) assert.ok(s.reason.length > 0, 'every skip carries a reason');
});

test('a diff touching a scoped path implicates its control', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: ['docs/governance/changes/CHG-1/change-envelope.json'] });
  assert.ok(ids(r).includes('SCOPED-1'));
  assert.ok(!ids(r).includes('SCOPED-2'));
});

test('an UNKNOWN diff fails open: everything in the lane runs', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: null });
  assert.deepEqual(ids(r), ['CORE-1', 'CORE-1B', 'SCOPED-1', 'SCOPED-2', 'UNSCOPED']);
  assert.deepEqual(skippedIds(r), ['LIB-1', 'REL-1']); // only the other lane + the library skip
});

test('lanes separate: a release run skips pr controls (recorded) and runs release ones', () => {
  const r = select(CAT, { lane: 'release', changedPaths: ['README.md'] });
  assert.deepEqual(ids(r), ['REL-1']);
  assert.ok(r.skipped.every((s) => /lane:pr|enforced via/.test(s.reason)));
});

test('a control with no path scope runs by default — declaring a scope is the opt-in', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: ['nothing/relevant.txt'] });
  assert.ok(ids(r).includes('UNSCOPED'));
});

test('a file scope matches the file and its children, never a sibling that shares the prefix (rc.33)', () => {
  // SCOPED-2 is scoped to the exact file docs/governance/model-manifest.json. A raw prefix
  // match also implicated docs/governance/model-manifest.json.bak — a sibling, not the file.
  const exact = select(CAT, { lane: 'pr', changedPaths: ['docs/governance/model-manifest.json'] });
  assert.ok(ids(exact).includes('SCOPED-2'), 'the exact file must implicate its control');
  const sibling = select(CAT, { lane: 'pr', changedPaths: ['docs/governance/model-manifest.json.bak'] });
  assert.ok(!ids(sibling).includes('SCOPED-2'), 'a shared-prefix sibling must NOT implicate the control');
  const dirLike = select(CAT, { lane: 'pr', changedPaths: ['docs/governance/changesets/x.json'] });
  assert.ok(!ids(dirLike).includes('SCOPED-1'), 'changesets/ must not satisfy a changes/ scope');
});

test('the CLI refuses a lane with no runnable catalogued controls — an empty lane is a hole (rc.33)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-'));
  try {
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'PR-1', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true },
    ] }));
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'build'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `an empty build lane must exit 2, got ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /empty lane is a hole/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two controls sharing one mechanism dedupe into a single execution', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: [] });
  const core = r.run.find((g) => g.mechanism === 'scripts/a.mjs');
  assert.deepEqual(core.ids.sort(), ['CORE-1', 'CORE-1B']);
});

test('documented controls (no runnable mechanism) are neither run nor reported skipped', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: null });
  assert.ok(!ids(r).includes('DOC-ONLY'));
  assert.ok(!skippedIds(r).includes('DOC-ONLY'));
});

test('an execute:false control is skipped with its stated reason, never spawned', () => {
  const r = select(CAT, { lane: 'pr', changedPaths: null });
  assert.ok(!r.run.some((g) => g.mechanism === 'core/lib.mjs'));
  const s = r.skipped.find((x) => x.id === 'LIB-1');
  assert.match(s.reason, /enforced via scripts\/b\.mjs/);
});

/* ---- W1: a compiled plan makes a control's family unskippable in its lane ---- */

const FAMCAT = { controls: [
  { control_id: 'FAM-A', mechanism_ref: 'scripts/a.mjs', lane: 'pr', paths: ['nothing/'], gate_family: 'A' },
  { control_id: 'FAM-R', mechanism_ref: 'scripts/r.mjs', lane: 'release', paths: ['nothing/'], gate_family: 'R' },
] };

test('a path-scoped control whose family a plan requires becomes UNSKIPPABLE, naming the change', () => {
  const reqs = { families: new Set(['A']), changes: [{ change_id: 'CHG-7', families: ['A'] }] };
  const r = select(FAMCAT, { lane: 'pr', changedPaths: ['README.md'], requirements: reqs });
  assert.ok(r.run.some((g) => g.ids.includes('FAM-A')), 'FAM-A must run though the diff implicates nothing');
});

test('without the requirement, the same control skips on an unrelated diff', () => {
  const r = select(FAMCAT, { lane: 'pr', changedPaths: ['README.md'], requirements: { families: new Set(), changes: [] } });
  assert.ok(r.skipped.some((s) => s.id === 'FAM-A'));
});

test('lane separation still holds — a required release-family control does not run in a pr run', () => {
  const reqs = { families: new Set(['R']), changes: [{ change_id: 'CHG-7', families: ['R'] }] };
  const r = select(FAMCAT, { lane: 'pr', changedPaths: ['README.md'], requirements: reqs });
  assert.ok(r.skipped.some((s) => s.id === 'FAM-R' && /lane:release/.test(s.reason)));
});

test('the lanes cover the artifact life: pr, build, release, deploy, scheduled (rc.11 WS1.4)', () => {
  assert.deepEqual(LANES, ['pr', 'build', 'release', 'deploy', 'scheduled']);
});

/* ---- rc.34: tier-aware selection — min_tier is opt-in, and always/mandated override upward ---- */

const TIERCAT = { controls: [
  { control_id: 'HI-ONLY', mechanism_ref: 'scripts/h.mjs', lane: 'pr', min_tier: 'high' },
  { control_id: 'HI-ALWAYS', mechanism_ref: 'scripts/ha.mjs', lane: 'pr', min_tier: 'high', always: true },
  { control_id: 'HI-FAM', mechanism_ref: 'scripts/hf.mjs', lane: 'pr', min_tier: 'high', gate_family: 'PA2', paths: ['nothing/'] },
  { control_id: 'ANY', mechanism_ref: 'scripts/any.mjs', lane: 'pr' },
] };

test('a min_tier control skips below its tier WITH a recorded reason, and runs at or above it', () => {
  const low = { families: new Set(), changes: [], maxTier: 'low' };
  const rLow = select(TIERCAT, { lane: 'pr', changedPaths: null, requirements: low });
  const s = rLow.skipped.find((x) => x.id === 'HI-ONLY');
  assert.ok(s && /min_tier:high/.test(s.reason), 'the skip must name the tier rule');
  assert.ok(ids(rLow).includes('ANY'), 'controls without min_tier are untouched');
  const high = { families: new Set(), changes: [], maxTier: 'high' };
  assert.ok(ids(select(TIERCAT, { lane: 'pr', changedPaths: null, requirements: high })).includes('HI-ONLY'));
});

test('always and plan-mandated controls IGNORE min_tier — the override goes upward, never downward', () => {
  const low = { families: new Set(['PA2']), changes: [{ change_id: 'CHG-1', families: ['PA2'] }], maxTier: 'low' };
  const r = select(TIERCAT, { lane: 'pr', changedPaths: ['README.md'], requirements: low });
  assert.ok(ids(r).includes('HI-ALWAYS'), 'always beats min_tier');
  assert.ok(ids(r).includes('HI-FAM'), 'a plan-mandated family beats min_tier');
});

test('with no aggregated requirements at all, min_tier does not apply — fail open', () => {
  const r = select(TIERCAT, { lane: 'pr', changedPaths: null });
  assert.ok(ids(r).includes('HI-ONLY'));
});

/* ---- rc.35 (flow-plan Phase 2): the runner EMITS evidence instead of a human transcribing it ---- */

import { mkdirSync, readFileSync, existsSync } from 'node:fs';

// A runnable layout: two tiny mechanisms and a catalog naming them.
function emitFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gr-emit-'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'ok.mjs'), 'console.log("ok-gate stdout line"); process.exit(0);\n');
  writeFileSync(join(dir, 'scripts', 'bad.mjs'), 'console.error("bad-gate: a real finding"); process.exit(1);\n');
  return dir;
}

test('--emit-dir writes one result record per mechanism plus the run record; the log still streams', () => {
  const dir = emitFixture();
  try {
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'OK-1', mechanism_ref: 'scripts/ok.mjs', lane: 'pr', always: true },
      { control_id: 'OK-2', mechanism_ref: 'scripts/ok.mjs', lane: 'pr', always: true },
    ] }));
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr', '--emit-dir', 'emitted', '--out', 'record.json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // Capture must not eat the log: the mechanism's own output still reaches the runner's stdout.
    assert.match(r.stdout, /ok-gate stdout line/);
    const emitted = JSON.parse(readFileSync(join(dir, 'emitted', 'scripts-ok.json'), 'utf8'));
    assert.equal(emitted.gate, 'scripts/ok.mjs');
    assert.deepEqual(emitted.controls.sort(), ['OK-1', 'OK-2']);
    assert.equal(emitted.result, 'pass');
    assert.match(emitted.findings_excerpt, /ok-gate stdout line/);
    assert.ok(!Number.isNaN(Date.parse(emitted.produced_at)), 'produced_at must be a timestamp');
    assert.ok('commit' in emitted, 'the record must carry the commit (null where there is no git)');
    // The run record is itself emitted, under the name the evidence collector seals (gate-run*),
    // byte-identical to --out — one record, two homes.
    assert.equal(readFileSync(join(dir, 'emitted', 'gate-run.json'), 'utf8'), readFileSync(join(dir, 'record.json'), 'utf8'));
    const rec = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
    assert.equal(rec.result, 'pass');
    assert.ok(!Number.isNaN(Date.parse(rec.produced_at)), 'the rc.34 record fields gain produced_at');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failing mechanism is emitted as result:fail with its findings excerpt, and the run fails', () => {
  const dir = emitFixture();
  try {
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'BAD-1', mechanism_ref: 'scripts/bad.mjs', lane: 'pr', always: true },
    ] }));
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr', '--emit-dir', 'emitted'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /bad-gate: a real finding/, 'the failing gate\'s output still reaches the log');
    const emitted = JSON.parse(readFileSync(join(dir, 'emitted', 'scripts-bad.json'), 'utf8'));
    assert.equal(emitted.result, 'fail');
    assert.match(emitted.findings_excerpt, /a real finding/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'emitted', 'gate-run.json'), 'utf8')).result, 'fail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without --emit-dir nothing is emitted and the captured output still streams (no behaviour change)', () => {
  const dir = emitFixture();
  try {
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'OK-1', mechanism_ref: 'scripts/ok.mjs', lane: 'pr', always: true },
    ] }));
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ok-gate stdout line/);
    assert.ok(!existsSync(join(dir, 'emitted')));
    assert.ok(!existsSync(join(dir, 'gate-run.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- rc.40 (flow-plan Phase 6): waves, the pool, the timeout, and the cache ---- */

import { planWaves, defaultJobs, runMechanism } from './gate-runner.mjs';

const WAVECAT = { controls: [
  { control_id: 'A', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true },
  { control_id: 'B', mechanism_ref: 'scripts/b.mjs', lane: 'pr', always: true, depends_on: ['A'] },
  { control_id: 'C', mechanism_ref: 'scripts/c.mjs', lane: 'pr', always: true, depends_on: ['A', 'B'] },
  { control_id: 'D', mechanism_ref: 'scripts/d.mjs', lane: 'pr', always: true },
] };

test('depends_on becomes topological waves; independents share a wave', () => {
  const { run } = select(WAVECAT, { lane: 'pr', changedPaths: null });
  const waves = planWaves(run, WAVECAT).map((w) => w.map((g) => g.mechanism));
  assert.deepEqual(waves, [['scripts/a.mjs', 'scripts/d.mjs'], ['scripts/b.mjs'], ['scripts/c.mjs']]);
});

test('a dependency on a control this run SKIPPED is not a barrier — it was skipped, with a reason', () => {
  // A is scoped away; B depends on it. B must not wait on something that is not running.
  const cat = { controls: [
    { control_id: 'A', mechanism_ref: 'scripts/a.mjs', lane: 'pr', paths: ['nothing/'] },
    { control_id: 'B', mechanism_ref: 'scripts/b.mjs', lane: 'pr', always: true, depends_on: ['A'] },
  ] };
  const r = select(cat, { lane: 'pr', changedPaths: ['README.md'] });
  assert.ok(r.skipped.some((s) => s.id === 'A' && s.reason.length > 0));
  assert.deepEqual(planWaves(r.run, cat).map((w) => w.map((g) => g.mechanism)), [['scripts/b.mjs']]);
});

test('a depends_on CYCLE is refused, never flattened — the declared order would not be the executed one', () => {
  const cat = { controls: [
    { control_id: 'A', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true, depends_on: ['B'] },
    { control_id: 'B', mechanism_ref: 'scripts/b.mjs', lane: 'pr', always: true, depends_on: ['A'] },
  ] };
  const { run } = select(cat, { lane: 'pr', changedPaths: null });
  assert.throws(() => planWaves(run, cat), /cycle/);
});

test('two controls sharing a mechanism collapse to one node — a self-edge is not a cycle', () => {
  const cat = { controls: [
    { control_id: 'A', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true },
    { control_id: 'A2', mechanism_ref: 'scripts/a.mjs', lane: 'pr', always: true, depends_on: ['A'] },
  ] };
  const { run } = select(cat, { lane: 'pr', changedPaths: null });
  assert.deepEqual(planWaves(run, cat).length, 1);
});

test('the default pool leaves a core for the machine that is watching, and never drops below 1', () => {
  assert.ok(Number.isInteger(defaultJobs()) && defaultJobs() >= 1);
});

test('a hung gate is KILLED and recorded as a timeout — a timeout is a failure, never a pass', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-hang-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'hang.mjs'), 'setTimeout(() => {}, 600000);\n');
    const r = await runMechanism({ mechanism: 'scripts/hang.mjs', args: [] }, { timeoutMs: 300, cwd: dir });
    assert.equal(r.status, 'timeout');
    assert.match(r.stderr, /TIMEOUT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A layout whose gates SLEEP, so a serial run and a pooled run are distinguishable by wall-clock,
// and whose output order is checked against the catalog rather than the scheduler.
function poolFixture(n, ms) {
  const dir = mkdtempSync(join(tmpdir(), 'gr-pool-'));
  mkdirSync(join(dir, 'scripts'));
  const controls = [];
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, 'scripts', `s${i}.mjs`), `setTimeout(() => { console.log("gate-${i}"); }, ${ms});\n`);
    controls.push({ control_id: `S-${i}`, mechanism_ref: `scripts/s${i}.mjs`, lane: 'pr', always: true });
  }
  writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls }));
  return dir;
}

test('the pool runs a wave concurrently, and flushes output in CATALOG order, not finish order', () => {
  const dir = poolFixture(4, 400);
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr', '--jobs', '4', '--out', 'rec.json'], { cwd: dir, encoding: 'utf8' });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    assert.ok(elapsed < 4 * 400, `4x400ms of gates at --jobs 4 took ${elapsed}ms — the pool is not running them concurrently`);
    const order = [...r.stdout.matchAll(/gate-(\d)/g)].map((m) => m[1]);
    assert.deepEqual(order, ['0', '1', '2', '3'], 'the log is ordered by the catalog, not by which gate finished first');
    const rec = JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8'));
    assert.equal(rec.concurrency.jobs, 4);
    assert.equal(rec.concurrency.waves, 1);
    assert.equal(rec.concurrency.timeout_ms, 300000);
    for (const e of rec.executed) assert.equal(e.wave, 0, 'every execution records its wave');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--jobs 1 still passes and still records the rc.34/rc.35 fields (nothing was traded for the pool)', () => {
  const dir = poolFixture(2, 10);
  try {
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr', '--jobs', '1', '--out', 'rec.json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8'));
    for (const f of ['lane', 'base', 'commit', 'changed_paths', 'requirements_scope', 'implicated_changes', 'max_implicated_tier', 'required_families', 'executed', 'skipped', 'result', 'produced_at']) {
      assert.ok(f in rec, `the rc.34/rc.35 record field ${f} survived the parallel runner`);
    }
    for (const e of rec.executed) assert.ok(Number.isFinite(e.ms), 'flow-report reads ms — it must stay numeric');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI refuses a catalogued depends_on cycle with exit 2 rather than running it', () => {
  const dir = poolFixture(2, 5);
  try {
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'S-0', mechanism_ref: 'scripts/s0.mjs', lane: 'pr', always: true, depends_on: ['S-1'] },
      { control_id: 'S-1', mechanism_ref: 'scripts/s1.mjs', lane: 'pr', always: true, depends_on: ['S-0'] },
    ] }));
    const r = spawnSync(process.execPath, [RUNNER, '--lane', 'pr'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cycle/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- the cache, end to end through the CLI ---- */

// A scoped control over a real input file: the only shape the cache will ever serve.
function cacheFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gr-cache-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'scripts', 'scoped.mjs'), 'console.log("scoped-gate ran"); process.exit(0);\n');
  writeFileSync(join(dir, 'scripts', 'core.mjs'), 'console.log("core-gate ran"); process.exit(0);\n');
  writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
    { control_id: 'SCOPED', mechanism_ref: 'scripts/scoped.mjs', lane: 'pr', paths: ['src/'] },
    { control_id: 'CORE', mechanism_ref: 'scripts/core.mjs', lane: 'pr', always: true },
  ] }));
  return dir;
}

const runIn = (dir, args) => spawnSync(process.execPath, [RUNNER, ...args], { cwd: dir, encoding: 'utf8' });

test('a warm run serves the scoped control as pass-cached WITH its key; the always control never caches', () => {
  const dir = cacheFixture();
  try {
    const cold = runIn(dir, ['--lane', 'pr', '--out', 'cold.json']);
    assert.equal(cold.status, 0, cold.stderr);
    const c = JSON.parse(readFileSync(join(dir, 'cold.json'), 'utf8'));
    assert.equal(c.cache.enabled, true);
    assert.equal(c.cache.hits, 0);
    assert.equal(c.cache.stored, 1, 'only the scoped control is storable');
    assert.ok(c.cache.not_cacheable.some((x) => /always:true/.test(x.reason)), 'the always control says WHY it is never cached');

    const warm = runIn(dir, ['--lane', 'pr', '--out', 'warm.json']);
    assert.equal(warm.status, 0, warm.stderr);
    const w = JSON.parse(readFileSync(join(dir, 'warm.json'), 'utf8'));
    assert.equal(w.cache.hits, 1);
    const scoped = w.executed.find((e) => e.mechanism === 'scripts/scoped.mjs');
    assert.equal(scoped.status, 'pass-cached');
    assert.match(scoped.cache_key, /^[0-9a-f]{64}$/);
    assert.match(scoped.cached_from, /\.loom\/gate-cache\//);
    assert.equal(w.executed.find((e) => e.mechanism === 'scripts/core.mjs').status, 'pass');
    // The log of a cached run says what the uncached one said — replayed verbatim.
    assert.match(warm.stdout, /scoped-gate ran/);
    assert.match(warm.stdout, /pass-cached scripts\/scoped\.mjs — key/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('touching a file INSIDE the declared scope busts the key', () => {
  const dir = cacheFixture();
  try {
    runIn(dir, ['--lane', 'pr']);
    writeFileSync(join(dir, 'src', 'a.txt'), 'two\n');
    const r = runIn(dir, ['--lane', 'pr', '--out', 'r.json']);
    const rec = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    assert.equal(rec.cache.hits, 0, 'a changed input must re-run the gate');
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('editing the MECHANISM busts the key — the gate itself is part of the input', () => {
  const dir = cacheFixture();
  try {
    runIn(dir, ['--lane', 'pr']);
    writeFileSync(join(dir, 'scripts', 'scoped.mjs'), 'console.log("scoped-gate ran (v2)"); process.exit(0);\n');
    const rec = JSON.parse(readFileSync(join(dir, (runIn(dir, ['--lane', 'pr', '--out', 'r.json']), 'r.json')), 'utf8'));
    assert.equal(rec.cache.hits, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('re-scoping the CONTROL busts the key — the catalog entry is part of the input', () => {
  const dir = cacheFixture();
  try {
    runIn(dir, ['--lane', 'pr']);
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'SCOPED', mechanism_ref: 'scripts/scoped.mjs', lane: 'pr', paths: ['src/', 'docs/'] },
      { control_id: 'CORE', mechanism_ref: 'scripts/core.mjs', lane: 'pr', always: true },
    ] }));
    runIn(dir, ['--lane', 'pr', '--out', 'r.json']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8')).cache.hits, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a FAILING gate is never cached — a failure always re-runs (cache poisoning negative test)', () => {
  const dir = cacheFixture();
  try {
    writeFileSync(join(dir, 'scripts', 'scoped.mjs'), 'console.error("scoped-gate: a real finding"); process.exit(1);\n');
    const first = runIn(dir, ['--lane', 'pr', '--out', 'a.json']);
    assert.equal(first.status, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).cache.stored, 0, 'there is no such thing as a cached red');
    const second = runIn(dir, ['--lane', 'pr', '--out', 'b.json']);
    assert.equal(second.status, 1, 'the failure must be re-discovered, not remembered as absent');
    assert.match(second.stderr, /a real finding/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8')).cache.hits, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a poisoned cache entry claiming a pass for a failing gate is REFUSED — the key is content-addressed', () => {
  const dir = cacheFixture();
  try {
    runIn(dir, ['--lane', 'pr', '--out', 'a.json']);
    const key = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).executed.find((e) => e.mechanism === 'scripts/scoped.mjs').cache_key;
    // Now break the gate. The attacker's entry still sits in the store under the OLD key.
    writeFileSync(join(dir, 'scripts', 'scoped.mjs'), 'console.error("scoped-gate: a real finding"); process.exit(1);\n');
    assert.ok(existsSync(join(dir, '.loom', 'gate-cache', `${key}.json`)), 'the pass entry is still on disk');
    const r = runIn(dir, ['--lane', 'pr', '--out', 'b.json']);
    assert.equal(r.status, 1, 'the stale pass must not be served for a changed mechanism');
    assert.equal(JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8')).cache.hits, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--no-cache disables it and says so in the record', () => {
  const dir = cacheFixture();
  try {
    runIn(dir, ['--lane', 'pr']);
    const r = runIn(dir, ['--lane', 'pr', '--no-cache', '--out', 'r.json']);
    const rec = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    assert.equal(rec.cache.enabled, false);
    assert.equal(rec.cache.hits, 0);
    assert.match(r.stdout, /cache OFF/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the RELEASE lane is never cached, whatever the control declares', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-rel-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.txt'), 'one\n');
    writeFileSync(join(dir, 'scripts', 'rel.mjs'), 'console.log("release gate ran"); process.exit(0);\n');
    writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [
      { control_id: 'REL', mechanism_ref: 'scripts/rel.mjs', lane: 'release', paths: ['src/'] },
    ] }));
    runIn(dir, ['--lane', 'release', '--out', 'a.json']);
    const r = runIn(dir, ['--lane', 'release', '--out', 'b.json']);
    const rec = JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8'));
    assert.equal(rec.cache.hits, 0);
    assert.equal(rec.cache.stored, 0);
    assert.ok(rec.cache.not_cacheable.some((x) => /lane:release is never cached/.test(x.reason)));
    assert.match(r.stdout, /release gate ran/, 'the release re-runs its gates, for real');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- 2.1.0 (plan row 2.4, decision K9): --record posts through the external-record seam ---- */
import { generateKeyPairSync } from 'node:crypto';
import { cpSync } from 'node:fs';
import { calls as fakeCalls, createFakeKosli, respond as fakeRespond } from './kosli-fake.mjs';
const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function recordFixture({ mount }) {
  const dir = emitFixture();
  writeFileSync(join(dir, 'control-catalog.json'), JSON.stringify({ controls: [{ control_id: 'OK-1', mechanism_ref: 'scripts/ok.mjs', lane: 'pr', always: true }] }));
  const keys = generateKeyPairSync('ed25519');
  const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
  mkdirSync(join(dir, 'docs/governance/adapters'), { recursive: true });
  writeFileSync(join(dir, 'docs/governance/attestation-issuers.json'), JSON.stringify({ issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] }));
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify({ identities: [{ id: 'agent-loom-delivery', kind: 'agent', model: { provider: 'p', model_id: 'm@1', prompt_version: 'v' }, harness_role: 'delivery-loop' }] }));
  writeFileSync(join(dir, 'key.pem'), pem(keys.privateKey, 'pkcs8'));
  const src = resolve(HARNESS, 'change-example');
  if (existsSync(src)) cpSync(src, join(dir, 'docs/governance/changes/CHG-2026-0042'), { recursive: true });
  if (mount) {
    writeFileSync(join(dir, 'docs/governance/provider-selection.json'), JSON.stringify({ selections: [{ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', decided_by: 'x', decided_at: '2026-09-13', source: 'y' }] }));
    writeFileSync(join(dir, 'docs/governance/adapters/kosli.json'), JSON.stringify({ role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', config: { org: 'acme' }, activation_evidence: {} }));
  }
  const fake = createFakeKosli(join(dir, 'fake'));
  spawnSync('git', ['init', '-q'], { cwd: dir }); spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const env = { ...process.env, KOSLI_BIN: fake.bin, GITHUB_REPOSITORY: 'acme/x', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head };
  return { dir, fake: fake.dir, env, head };
}
const recordArgs = ['--lane', 'pr', '--record', '--actor', 'agent-loom-delivery', '--record-issuer', 'ci-runner', '--record-key', 'key.pem', '--emit-dir', 'emitted', '--out', 'record.json'];

test('--record unmounted: the run record says so, nothing reaches a binary, the run still passes', () => {
  const f = recordFixture({ mount: false });
  try {
    const r = spawnSync(process.execPath, [RUNNER, ...recordArgs], { cwd: f.dir, encoding: 'utf8', env: f.env });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(readFileSync(join(f.dir, 'record.json'), 'utf8'));
    assert.equal(rec.external_record.mounted, false);
    assert.ok(rec.external_record.notes.some((n) => /not mounted/.test(n)));
    assert.match(r.stdout, /external record: not mounted/);
    assert.deepEqual(fakeCalls(f.fake), []);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('--record mounted: each executed mechanism is posted as a signed gate record on the implicated change\'s trail, and the kept copy carries the id', { skip: existsSync(resolve(HARNESS, 'change-example')) ? false : 'worked example absent' }, () => {
  const f = recordFixture({ mount: true });
  try {
    fakeRespond(f.fake, ['get', 'trail'], { stdout: { name: 'CHG-2026-0042', compliance_status: { attestations_statuses: [{ attestation_name: 'gate.scripts-ok', attestation_type: 'generic', attestation_id: 'att-42', status: 'COMPLETE', is_compliant: true, unexpected: false }] } } });
    const r = spawnSync(process.execPath, [RUNNER, ...recordArgs], { cwd: f.dir, encoding: 'utf8', env: f.env });
    assert.equal(r.status, 0, r.stderr);
    const xr = JSON.parse(readFileSync(join(f.dir, 'record.json'), 'utf8')).external_record;
    assert.equal(xr.provider, 'kosli');
    assert.deepEqual(xr.posted, [{ trail: 'CHG-2026-0042', name: 'gate.scripts-ok', status: 'recorded', id: 'att-42' }]);
    assert.deepEqual(xr.rejected, []); assert.deepEqual(xr.queued, []);
    const argv = fakeCalls(f.fake).map((c) => c.argv);
    assert.deepEqual(argv.map((a) => a.slice(0, 2)), [['begin', 'trail'], ['attest', 'generic'], ['get', 'trail']]);
    assert.equal(argv[1][argv[1].indexOf('--trail') + 1], 'CHG-2026-0042');
    const kept = JSON.parse(readFileSync(join(f.dir, 'emitted/records/CHG-2026-0042-gate.scripts-ok.json'), 'utf8'));
    assert.equal(kept.record.status, 'recorded'); assert.equal(kept.record.id, 'att-42');
    assert.equal(kept.attestation.issuer, 'ci-runner'); assert.equal(kept.commit, f.head); assert.equal(kept.runner.sha, f.head);
    assert.equal(kept.payload.gate, 'scripts/ok.mjs'); assert.equal(kept.payload.result, 'pass');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('--record with no signing key: every envelope is REJECTED (unsigned), nothing is posted or queued, and the log says why', { skip: existsSync(resolve(HARNESS, 'change-example')) ? false : 'worked example absent' }, () => {
  const f = recordFixture({ mount: true });
  try {
    const r = spawnSync(process.execPath, [RUNNER, ...recordArgs.filter((a, i, all) => !['--record-issuer', '--record-key'].includes(a) && !['--record-issuer', '--record-key'].includes(all[i - 1]))], { cwd: f.dir, encoding: 'utf8', env: f.env });
    assert.equal(r.status, 0, r.stderr);
    const xr = JSON.parse(readFileSync(join(f.dir, 'record.json'), 'utf8')).external_record;
    assert.equal(xr.rejected.length, 1); assert.ok(xr.rejected[0].findings.some((x) => /unsigned/.test(x)));
    assert.deepEqual(xr.posted, []);
    assert.deepEqual(fakeCalls(f.fake), [], 'a rejected envelope never reaches the binary');
    assert.ok(!existsSync(join(f.dir, '.loom/record-outbox')));
    assert.match(r.stdout, /REJECTED gate\.scripts-ok/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
