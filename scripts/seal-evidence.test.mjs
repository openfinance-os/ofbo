// Tests for the evidence collector (flow-plan Phase 2, rc.35). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, typeOfFile } from './seal-evidence.mjs';
import { evaluate, REQUIRED_TYPES } from './evidence-seal-check.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'seal-evidence.mjs');
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// Semantically-valid artifact bodies (mirrors evidence-seal-check.test.mjs — the collector must
// produce a bundle those semantics accept, so the fixtures are held to the same standard).
const VALID = {
  'tests.json': { suite: 'q1', total: 5, passed: 5, failed: 0, commit: COMMIT },
  'reviews.json': { 'hard-stop-reviewer': 'PASS', 'contract-conformance-reviewer': 'CONFORMANT' },
  'lineage.json': { stores: ['audit'], emits_lineage: true, insert_only: true },
  'model-provenance.json': { gate: 'model-provenance-check', result: 'OK' },
  'control-plane.json': { gate: 'control-plane-check', result: 'OK' },
  'sast.sarif': { version: '2.1.0', runs: [{ tool: { driver: { name: 'demo-sast' } }, results: [] }] },
  'sbom.cdx.json': { bomFormat: 'CycloneDX', components: [{ type: 'library', name: 'x', version: '1' }] },
  'dependency-audit.json': { critical: 0, high: 0, moderate: 0, low: 0 },
  'provenance.json': { subject: [{ name: 'app', digest: { sha256: 'ab'.repeat(32) } }], predicate: { builder: { id: 'ci://demo' } } },
};

// Stage a complete artifact set (no manifest) in a fresh tmp dir; the collector derives the rest.
function stage(mutate = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'seal-'));
  for (const [name, body] of Object.entries({ ...VALID, ...mutate })) {
    if (body === null) continue; // a way to LEAVE OUT an artifact
    writeFileSync(join(dir, name), JSON.stringify(body) + '\n');
  }
  return dir;
}

const run = (dir, args = []) =>
  spawnSync(process.execPath, [CLI, '--dir', '.', '--commit', COMMIT, ...args], { cwd: dir, encoding: 'utf8' });

const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

test('a complete artifact set is sealed into a manifest the seal gate verifies clean', () => {
  const dir = stage();
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const m = manifestOf(dir);
    assert.equal(m.release_commit, COMMIT);
    assert.deepEqual(evaluate(m, { baseDir: dir, requiredTypes: REQUIRED_TYPES }), []);
    assert.equal(m.anchor, m.entries[m.entries.length - 1].seal, 'the anchor is the final seal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('entries are ordered by the required-types contract, not by filename', () => {
  const dir = stage();
  try {
    run(dir);
    // Alphabetical would begin control-plane, dependency-audit, …; the contract begins tests.
    assert.deepEqual(manifestOf(dir).entries.map((e) => e.type), REQUIRED_TYPES);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('REFUSED on failing sealed content: non-zero and NOTHING written', () => {
  const dir = stage({ 'tests.json': { ...VALID['tests.json'], failed: 3, passed: 2 } });
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSED \(nothing written\)/);
    assert.match(r.stderr, /not clean \(failed=3\)/);
    assert.ok(!existsSync(join(dir, 'manifest.json')), 'no manifest may be written on refusal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a refusal leaves a previously-written manifest byte-for-byte untouched', () => {
  const dir = stage();
  try {
    assert.equal(run(dir).status, 0);
    const before = readFileSync(join(dir, 'manifest.json'), 'utf8');
    writeFileSync(join(dir, 'tests.json'), JSON.stringify({ ...VALID['tests.json'], failed: 1 }) + '\n');
    assert.equal(run(dir).status, 1);
    assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing required artifact refuses the seal — the collector never invents evidence', () => {
  const dir = stage({ 'provenance.json': null });
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing required evidence: provenance/);
    assert.ok(!existsSync(join(dir, 'manifest.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no --commit and no git, the collector refuses to start (exit 2)', () => {
  const dir = stage();
  try {
    const r = spawnSync(process.execPath, [CLI, '--dir', '.'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no release commit/);
    assert.ok(!existsSync(join(dir, 'manifest.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- the gate-run record joins the chain (plan item 3) ---- */

const GATE_RUN = { lane: 'release', commit: COMMIT, executed: [], skipped: [], result: 'pass' };

test('a passing gate-run record present in the directory is sealed into the chain', () => {
  const dir = stage({ 'gate-run.json': GATE_RUN });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gate-run record: sealed into the chain/);
    const m = manifestOf(dir);
    const entry = m.entries.find((e) => e.type === 'gate-run');
    assert.ok(entry, 'the gate-run record must be a chain entry');
    assert.deepEqual(evaluate(m, { baseDir: dir, requiredTypes: REQUIRED_TYPES }), []);
    // Extra evidence chains AFTER the required contract, never displacing it.
    assert.deepEqual(m.entries.slice(0, REQUIRED_TYPES.length).map((e) => e.type), REQUIRED_TYPES);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a FAILING gate-run record refuses the seal — a failed run is not release evidence', () => {
  const dir = stage({ 'gate-run.json': { ...GATE_RUN, result: 'fail' } });
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a passing run/);
    assert.ok(!existsSync(join(dir, 'manifest.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the runner\'s lane-named records (gate-run-release.json) are recognised too', () => {
  assert.equal(typeOfFile('gate-run.json'), 'gate-run');
  assert.equal(typeOfFile('gate-run-release.json'), 'gate-run');
  assert.equal(typeOfFile('gate-runner.json'), 'gate-run'); // prefix rule: any runner emission
  assert.equal(typeOfFile('release-subject.json'), null, 'a non-evidence file maps to no type');
  assert.equal(typeOfFile('notes.txt'), null);
});

test('files that are not evidence are LISTED as left out, never silently ignored', () => {
  const dir = stage();
  writeFileSync(join(dir, 'notes.txt'), 'a stray file\n');
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /left OUT of the chain/);
    assert.match(r.stdout, /notes\.txt/);
    assert.ok(!manifestOf(dir).entries.some((e) => e.ref === 'notes.txt'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('re-sealing preserves the release id and drops a stale attestation LOUDLY', () => {
  const dir = stage();
  try {
    assert.equal(run(dir, ['--release', 'v-test']).status, 0);
    const m = manifestOf(dir);
    assert.equal(m.release, 'v-test');
    m.attestation = { issuer: 'demo-anchor-signer', signature: 'over-the-old-anchor' };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
    const r = run(dir); // no --release this time: preserved from the previous manifest
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /attestation over the OLD anchor — dropped/);
    const m2 = manifestOf(dir);
    assert.equal(m2.release, 'v-test');
    assert.ok(!m2.attestation, 'a signature over a rebuilt chain must not be carried forward');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- collect(): the pure ordering rule ---- */

test('collect orders required types by contract, then other recognised types, and reports the rest', () => {
  const names = ['zzz.bin', 'reviews.json', 'gate-run.json', 'tests.json', 'manifest.json'];
  const { entries, unsealed } = collect(names, ['tests', 'reviews']);
  assert.deepEqual(entries, [
    { type: 'tests', ref: 'tests.json' },
    { type: 'reviews', ref: 'reviews.json' },
    { type: 'gate-run', ref: 'gate-run.json' },
  ]);
  assert.deepEqual(unsealed, ['zzz.bin'], 'manifest.json is the output, never an entry or a stray');
});
