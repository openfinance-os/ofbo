// Tests for the content-addressed gate result cache. Node built-in runner: `node --test`.
//
// The cache is the obvious place to launder a control, so the suite is written adversarially:
// every rule that keeps a hit honest has a test that tries to break it. The end-to-end path
// (a cold run, a warm run, a poisoned entry) lives in core/gate-runner.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_DIR, FORMAT, UNCACHEABLE_LANES, cacheability, computeKey, read, write } from './gate-cache.mjs';

const SCOPED = { control_id: 'SCOPED', mechanism_ref: 'scripts/s.mjs', lane: 'pr', paths: ['src/'] };
const ALWAYS = { control_id: 'CORE', mechanism_ref: 'scripts/c.mjs', lane: 'pr', always: true };
const UNSCOPED = { control_id: 'ANY', mechanism_ref: 'scripts/a.mjs', lane: 'pr' };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src', 'nested'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 's.mjs'), 'process.exit(0);\n');
  writeFileSync(join(dir, 'src', 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'src', 'nested', 'b.txt'), 'two\n');
  return dir;
}

const keyIn = (dir, over = {}) => computeKey({ cwd: dir, mechanism: 'scripts/s.mjs', args: [], controls: [SCOPED], planHashes: [], ...over });

/* ---- what may be cached at all ---- */

test('an always:true tamper check is NEVER cacheable, and says why', () => {
  const d = cacheability([ALWAYS], 'pr');
  assert.equal(d.cacheable, false);
  assert.match(d.reason, /always:true/);
});

test('an unscoped control is not cacheable — no declared paths, no provable input set', () => {
  const d = cacheability([UNSCOPED], 'pr');
  assert.equal(d.cacheable, false);
  assert.match(d.reason, /no path scope/);
});

test('the release and deploy lanes are never cached, whatever the control declares', () => {
  assert.deepEqual([...UNCACHEABLE_LANES].sort(), ['deploy', 'release']);
  for (const lane of ['release', 'deploy']) {
    const d = cacheability([SCOPED], lane);
    assert.equal(d.cacheable, false, `${lane} must not be cacheable`);
    assert.match(d.reason, new RegExp(`lane:${lane}`));
  }
});

test('one unscoped control among several poisons the whole mechanism — the weakest entry decides', () => {
  assert.equal(cacheability([SCOPED, UNSCOPED], 'pr').cacheable, false);
  assert.equal(cacheability([SCOPED, ALWAYS], 'pr').cacheable, false);
  assert.equal(cacheability([SCOPED], 'pr').cacheable, true);
});

test('no resolved catalog entry means no cache — the runner falls back to running it', () => {
  assert.equal(cacheability([], 'pr').cacheable, false);
  assert.equal(cacheability(undefined, 'pr').cacheable, false);
});

/* ---- what the key covers ---- */

test('the key is stable across calls when nothing changed', () => {
  const dir = fixture();
  try { assert.equal(keyIn(dir), keyIn(dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every input the answer could depend on moves the key', () => {
  const dir = fixture();
  try {
    const base = keyIn(dir);
    assert.notEqual(base, keyIn(dir, { args: ['--strict'] }), 'arguments');
    assert.notEqual(base, keyIn(dir, { planHashes: ['deadbeef'] }), 'the compiled plan set');
    assert.notEqual(base, keyIn(dir, { controls: [{ ...SCOPED, paths: ['src/', 'docs/'] }] }), 'the catalog entry');
    assert.notEqual(base, keyIn(dir, { controls: [{ ...SCOPED, min_tier: 'high' }] }), 'any catalog field, at any depth');

    writeFileSync(join(dir, 'src', 'nested', 'b.txt'), 'changed\n');
    assert.notEqual(base, keyIn(dir), 'a file nested under a declared directory scope');

    writeFileSync(join(dir, 'src', 'nested', 'b.txt'), 'two\n');
    assert.equal(base, keyIn(dir), 'and restoring it restores the key');

    writeFileSync(join(dir, 'src', 'c.txt'), 'new\n');
    assert.notEqual(base, keyIn(dir), 'a file ADDED under the scope');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('editing the mechanism file moves the key — the gate is part of its own input', () => {
  const dir = fixture();
  try {
    const base = keyIn(dir);
    writeFileSync(join(dir, 'scripts', 's.mjs'), 'process.exit(0); // v2\n');
    assert.notEqual(base, keyIn(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the plan-hash set is order-independent and duplicate-insensitive', () => {
  const dir = fixture();
  try {
    assert.equal(keyIn(dir, { planHashes: ['a', 'b'] }), keyIn(dir, { planHashes: ['b', 'a', 'b'] }));
    assert.notEqual(keyIn(dir, { planHashes: ['a', 'b'] }), keyIn(dir, { planHashes: ['a'] }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing mechanism yields NO key — an absent gate is a failure to surface by running', () => {
  const dir = fixture();
  try { assert.equal(computeKey({ cwd: dir, mechanism: 'scripts/gone.mjs', controls: [SCOPED] }), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file scope (not a directory) is keyed on that file alone', () => {
  const dir = fixture();
  try {
    const c = [{ ...SCOPED, paths: ['src/a.txt'] }];
    const base = computeKey({ cwd: dir, mechanism: 'scripts/s.mjs', controls: c });
    writeFileSync(join(dir, 'src', 'nested', 'b.txt'), 'irrelevant\n');
    assert.equal(base, computeKey({ cwd: dir, mechanism: 'scripts/s.mjs', controls: c }), 'a sibling outside the scope does not move it');
    writeFileSync(join(dir, 'src', 'a.txt'), 'changed\n');
    assert.notEqual(base, computeKey({ cwd: dir, mechanism: 'scripts/s.mjs', controls: c }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- the store ---- */

test('only a PASS is stored, and the store ignores itself', () => {
  const dir = fixture();
  try {
    assert.equal(write(dir, 'k1', { status: 'fail', mechanism: 'scripts/s.mjs' }), false, 'there is no such thing as a cached red');
    assert.equal(write(dir, 'k1', { status: 'timeout', mechanism: 'scripts/s.mjs' }), false);
    assert.equal(write(dir, 'k1', { status: 'pass', mechanism: 'scripts/s.mjs', stdout: 'ok\n' }), true);
    assert.equal(read(dir, 'k1').stdout, 'ok\n');
    assert.equal(readFileSync(join(dir, CACHE_DIR, '.gitignore'), 'utf8'), '*\n');
    assert.ok(existsSync(join(dir, CACHE_DIR, 'k1.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stored entry is served only for its OWN key, format and status', () => {
  const dir = fixture();
  try {
    write(dir, 'k1', { status: 'pass', mechanism: 'scripts/s.mjs' });
    assert.equal(read(dir, 'k2'), null);
    assert.equal(read(dir, ''), null);
    // Hand-edit the entry to claim another key: it is refused, not honoured.
    const p = join(dir, CACHE_DIR, 'k1.json');
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, JSON.stringify({ ...rec, key: 'k9' }));
    assert.equal(read(dir, 'k1'), null, 'an entry whose key does not match the file it sits in is not served');
    writeFileSync(p, JSON.stringify({ ...rec, format: 'loom-gate-cache/0' }));
    assert.equal(read(dir, 'k1'), null, 'an entry from another cache format is not served');
    writeFileSync(p, JSON.stringify({ ...rec, status: 'fail' }));
    assert.equal(read(dir, 'k1'), null, 'a stored non-pass is never served');
    writeFileSync(p, 'not json');
    assert.equal(read(dir, 'k1'), null, 'a corrupt entry is a miss, not a crash');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the format version is declared, so changing what a key covers invalidates every old entry', () => {
  assert.match(FORMAT, /^loom-gate-cache\/\d+$/);
});
