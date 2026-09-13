// Tests for the evidence-seal gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { evaluate, buildChain, sealOf, REQUIRED_TYPES, SEMANTICS, requiredTypesFor, verifyReleaseCommit, EVIDENCE_FLOOR, PLAN_ONLY_TYPES } from './evidence-seal-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'; // a real 40-hex sha (rc.11: symbolic subjects fail)

// Semantically-valid artifact bodies, one per required type (1.10: meaning is verified too).
const VALID = {
  tests: { suite: 'q1', total: 5, passed: 5, failed: 0, commit: COMMIT },
  reviews: { 'hard-stop-reviewer': 'PASS', 'contract-conformance-reviewer': 'CONFORMANT' },
  lineage: { stores: ['audit'], emits_lineage: true, insert_only: true },
  'model-provenance': { gate: 'model-provenance-check', result: 'OK' },
  'control-plane': { gate: 'control-plane-check', result: 'OK' },
  sast: { version: '2.1.0', runs: [{ tool: { driver: { name: 'demo-sast' } }, results: [] }] },
  sbom: { bomFormat: 'CycloneDX', components: [{ type: 'library', name: 'x', version: '1' }] },
  'dependency-audit': { critical: 0, high: 0, moderate: 0, low: 0 },
  provenance: { subject: [{ name: 'app', digest: { sha256: 'ab'.repeat(32) } }], predicate: { builder: { id: 'ci://demo' } } },
};

// rc.36 (D4): the anchor is mandatory, so every fixture carries it — the final seal, exactly as
// the collector writes it.
const anchored = (m) => ({ ...m, anchor: m.entries[m.entries.length - 1].seal });

// Build a real on-disk bundle (artifacts + manifest chained over their true hashes) in a tmp dir.
function realBundle() {
  const dir = mkdtempSync(join(tmpdir(), 'ev-'));
  const raw = REQUIRED_TYPES.map((type) => {
    const ref = `${type}.json`;
    const body = JSON.stringify(VALID[type]) + '\n';
    writeFileSync(join(dir, ref), body);
    return { type, ref, sha256: createHash('sha256').update(body).digest('hex') };
  });
  return { dir, manifest: anchored({ release: 'v', release_commit: COMMIT, entries: buildChain(raw) }) };
}

// A raw, complete evidence set (one entry per required type) — chain-only, no disk.
const RAW = REQUIRED_TYPES.map((type, i) => ({ type, ref: `evidence/${type}.json`, sha256: `hash${i}` }));
const sealed = () => anchored({ release: 'v-test', release_commit: COMMIT, entries: buildChain(RAW) });

test('a complete, intact chain passes', () => {
  assert.deepEqual(evaluate(sealed()), []);
});

test('a manifest without a release_commit is unbound evidence', () => {
  const m = sealed();
  delete m.release_commit;
  assert.ok(evaluate(m).some((x) => /release_commit/.test(x)));
});

test('a symbolic release_commit fails — release-v-demo is not a binding subject (rc.11, F2)', () => {
  const m = sealed();
  m.release_commit = 'release-v-demo';
  assert.ok(evaluate(m).some((x) => /not a 40-hex commit sha/.test(x)));
});

test('an altered artifact hash (without re-sealing) is caught', () => {
  const m = sealed();
  m.entries[2].sha256 = 'tampered'; // change content, leave the seal as-is
  const f = evaluate(m);
  assert.ok(f.some((x) => /seal mismatch/.test(x)));
});

test('reordering entries breaks the chain', () => {
  const m = sealed();
  [m.entries[0], m.entries[1]] = [m.entries[1], m.entries[0]];
  const f = evaluate(m);
  assert.ok(f.some((x) => /broken chain|seal mismatch/.test(x)));
});

test('dropping a required entry is reported as missing evidence', () => {
  const m = sealed();
  const droppedType = m.entries[m.entries.length - 1].type;
  m.entries.pop();
  const f = evaluate(m);
  assert.ok(f.some((x) => x === `missing required evidence: ${droppedType}`));
});

test('an incomplete bundle names each missing evidence type', () => {
  const m = { release_commit: COMMIT, entries: buildChain([{ type: 'tests', ref: 'evidence/tests.json', sha256: 'h' }]) };
  const f = evaluate(m);
  for (const t of REQUIRED_TYPES.filter((t) => t !== 'tests')) {
    assert.ok(f.some((x) => x === `missing required evidence: ${t}`), `expected missing ${t}`);
  }
});

test('a matching external anchor passes; a wrong one fails', () => {
  const m = sealed();
  const finalSeal = m.entries[m.entries.length - 1].seal;
  assert.deepEqual(evaluate({ ...m, anchor: finalSeal }), []);
  assert.ok(evaluate({ ...m, anchor: 'deadbeef' }).some((x) => /external anchor mismatch/.test(x)));
});

test('an empty bundle is a finding', () => {
  assert.match(evaluate({ entries: [] })[0], /narrated, not sealed/);
});

test('sealOf is deterministic and chains on prev', () => {
  const e = { type: 'tests', ref: 'a', sha256: 'b' };
  assert.equal(sealOf('GENESIS', e), sealOf('GENESIS', e));
  assert.notEqual(sealOf('GENESIS', e), sealOf('other', e));
});

test('a real on-disk bundle passes when baseDir is given', () => {
  const { dir, manifest } = realBundle();
  try { assert.deepEqual(evaluate(manifest, { baseDir: dir }), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('altering an artifact ON DISK (not the manifest) is caught — the seal is tamper-evident', () => {
  const { dir, manifest } = realBundle();
  try {
    writeFileSync(join(dir, `${REQUIRED_TYPES[1]}.json`), '{"tampered":true}\n');
    assert.ok(evaluate(manifest, { baseDir: dir }).some((x) => /altered after sealing/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed artifact missing from disk is a finding', () => {
  const { dir, manifest } = realBundle();
  try {
    rmSync(join(dir, `${REQUIRED_TYPES[0]}.json`));
    assert.ok(evaluate(manifest, { baseDir: dir }).some((x) => /not found/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- 1.10 semantic validation: intact bytes are not enough ---- */

function resealed(dir, type, body) {
  // Re-write one artifact and re-seal the WHOLE chain over the new hashes — a perfectly
  // intact chain whose sealed content is bad. Only semantics can catch this.
  writeFileSync(join(dir, `${type}.json`), JSON.stringify(body) + '\n');
  const raw = REQUIRED_TYPES.map((t) => ({
    type: t, ref: `${t}.json`,
    sha256: createHash('sha256').update(JSON.stringify(t === type ? body : VALID[t]) + '\n').digest('hex'),
  }));
  return { release: 'v', release_commit: COMMIT, entries: buildChain(raw) };
}

test('a sealed bundle of FAILING tests fails — intact is not passing', () => {
  const { dir } = realBundle();
  try {
    const m = resealed(dir, 'tests', { ...VALID.tests, failed: 3, passed: 2 });
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /not clean \(failed=3\)/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('test results from a different commit than the release fail the binding', () => {
  const { dir } = realBundle();
  try {
    const m = resealed(dir, 'tests', { ...VALID.tests, commit: 'some-older-commit' });
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /not the release commit/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed reviewer verdict that is not PASS/CONFORMANT fails', () => {
  const { dir } = realBundle();
  try {
    const m = resealed(dir, 'reviews', { 'hard-stop-reviewer': 'FAIL', 'contract-conformance-reviewer': 'CONFORMANT' });
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /hard-stop-reviewer.*not PASS\/CONFORMANT/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed SARIF with an error-level finding fails', () => {
  const { dir } = realBundle();
  try {
    const bad = { version: '2.1.0', runs: [{ tool: { driver: { name: 'demo-sast' } }, results: [{ ruleId: 'sqli', level: 'error', message: { text: 'x' } }] }] };
    const m = resealed(dir, 'sast', bad);
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /sealed SAST report/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed dependency audit with a critical vulnerability fails', () => {
  const { dir } = realBundle();
  try {
    const m = resealed(dir, 'dependency-audit', { critical: 1, high: 0 });
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /sealed dependency audit: 1 critical/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The seal shares the Q4 gate's judgement rather than restating it. Before that, the seal held
// its own critical===0 && high===0 rule, so a bundle calibrated by reachability cleared Q4 and
// was then rejected here — two gates disagreeing about one artifact.
test('a reachability-calibrated audit that clears Q4 also clears the seal', () => {
  const { dir } = realBundle();
  try {
    const audit = {
      critical: 0, high: 3,
      reachability: { tool: 'demo-sca', method: 'transitive-call-graph', reachable: { critical: 0, high: 0 }, deferred_sla: '2099-01-01' },
    };
    const m = resealed(dir, 'dependency-audit', audit);
    assert.deepEqual(evaluate(m, { baseDir: dir }).filter((x) => /dependency audit/.test(x)), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unreachable backlog past its SLA fails the seal too', () => {
  const { dir } = realBundle();
  try {
    const audit = {
      critical: 0, high: 3,
      reachability: { tool: 'demo-sca', method: 'transitive-call-graph', reachable: { critical: 0, high: 0 }, deferred_sla: '2020-01-01' },
    };
    const m = resealed(dir, 'dependency-audit', audit);
    assert.ok(evaluate(m, { baseDir: dir }).some((x) => /sealed dependency audit: the deferral SLA/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every required type carries a semantic check — no sealed-but-unread evidence', () => {
  for (const t of REQUIRED_TYPES) assert.ok(SEMANTICS[t], `no semantics for ${t}`);
});

/* ---- W1: required types are DERIVED from the compiled plans, not a fixed list ---- */

test('with no governed changes, required types fall back to the fixed baseline', () => {
  assert.deepEqual(requiredTypesFor({ evidence: new Set() }), REQUIRED_TYPES);
  assert.deepEqual(requiredTypesFor(null), REQUIRED_TYPES);
});

test('a low-tier plan seals only the floor plus its own required evidence', () => {
  const req = requiredTypesFor({ evidence: new Set(['tests', 'reviews']) }).sort();
  assert.deepEqual(req, [...new Set([...EVIDENCE_FLOOR, 'tests', 'reviews'])].sort());
  assert.ok(!req.includes('sast'), 'a low-tier change must not be forced to seal SAST');
});

test('a high-tier plan seals more; plan evidence with no sealed counterpart is left to its own gate', () => {
  const req = requiredTypesFor({ evidence: new Set(['tests', 'reviews', 'control-plane', 'sast', 'sbom', 'product-eval']) });
  assert.ok(req.includes('sast') && req.includes('sbom'), 'high-tier evidence is sealed');
  assert.ok(!req.includes('product-eval'), 'product-eval has no seal counterpart — enforced by its own gate');
});

/* ---- rc.8 hardening (audit gap 1): brainkit-provenance is seal-demanded and seal-verified ---- */

test('a plan requiring brainkit-provenance makes the seal DEMAND it; a generic repo never seals it', () => {
  const req = requiredTypesFor({ evidence: new Set(['tests', 'reviews', 'brainkit-provenance']) });
  assert.ok(req.includes('brainkit-provenance'), 'plan-required brainkit-provenance must be a sealed type');
  assert.ok(!requiredTypesFor({ evidence: new Set() }).includes('brainkit-provenance'), 'the baseline must not demand it');
  assert.ok(!REQUIRED_TYPES.includes('brainkit-provenance'), 'it stays out of the generic-repo default');
});

/* ---- rc.35 flow-plan Phase 2: the gate-run record joins the evidence chain ---- */

// A bundle with the runner's emitted record chained AFTER the nine required types.
function bundleWithGateRun(gateRun) {
  const { dir } = realBundle();
  const body = JSON.stringify(gateRun) + '\n';
  writeFileSync(join(dir, 'gate-run.json'), body);
  const raw = [
    ...REQUIRED_TYPES.map((t) => ({ type: t, ref: `${t}.json`, sha256: createHash('sha256').update(JSON.stringify(VALID[t]) + '\n').digest('hex') })),
    { type: 'gate-run', ref: 'gate-run.json', sha256: createHash('sha256').update(body).digest('hex') },
  ];
  return { dir, manifest: anchored({ release: 'v', release_commit: COMMIT, entries: buildChain(raw) }) };
}

test('a sealed PASSING gate-run record at the release commit verifies clean', () => {
  const { dir, manifest } = bundleWithGateRun({ lane: 'release', commit: COMMIT, executed: [], skipped: [], result: 'pass' });
  try { assert.deepEqual(evaluate(manifest, { baseDir: dir }), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed FAILING gate-run record fails the seal — a failed run is not release evidence', () => {
  const { dir, manifest } = bundleWithGateRun({ lane: 'release', commit: COMMIT, executed: [], skipped: [], result: 'fail' });
  try { assert.ok(evaluate(manifest, { baseDir: dir }).some((x) => /not a passing run/.test(x))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a gate-run produced at a different commit than the release fails the binding', () => {
  const other = 'b'.repeat(40);
  const { dir, manifest } = bundleWithGateRun({ lane: 'release', commit: other, executed: [], skipped: [], result: 'pass' });
  try { assert.ok(evaluate(manifest, { baseDir: dir }).some((x) => /not the release commit/.test(x))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gate-run stays OUT of the required floor — existing bundles keep passing without one', () => {
  assert.ok(SEMANTICS['gate-run'], 'the seal must know HOW to verify a gate-run record');
  assert.ok(!REQUIRED_TYPES.includes('gate-run'), 'demanding it would break every existing bundle');
  assert.ok(!EVIDENCE_FLOOR.includes('gate-run'));
  assert.deepEqual(SEMANTICS['gate-run']({ result: 'pass', commit: null }, { releaseCommit: COMMIT }), [],
    'a record with no commit (no git) is not failed on the binding it cannot state');
});

/* ---- rc.36 flow-plan D4: the anchor is mandatory ---- */

test('a manifest with NO anchor field fails — omitting the field no longer skips the check (D4)', () => {
  const m = sealed();
  delete m.anchor;
  assert.ok(evaluate(m).some((x) => /manifest has no `anchor`/.test(x)));
  const empty = { ...sealed(), anchor: '' };
  assert.ok(evaluate(empty).some((x) => /manifest has no `anchor`/.test(x)), 'an empty-string anchor is no anchor');
});

/* ---- rc.36 flow-plan D5: release_commit must exist here and be an ancestor of HEAD ---- */

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ev-git-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'loom@test.invalid');
  git(dir, 'config', 'user.name', 'loom-test');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  const first = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.txt'), 'two\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'two');
  return { dir, first, head: git(dir, 'rev-parse', 'HEAD') };
}

test('a release_commit that exists and is an ancestor of HEAD verifies (HEAD itself included)', () => {
  const { dir, first, head } = scratchRepo();
  try {
    assert.equal(verifyReleaseCommit(first, dir).status, 'verified');
    assert.equal(verifyReleaseCommit(head, dir).status, 'verified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a foreign 40-hex commit fails — evidence from a commit nobody ran proves nothing (D5)', () => {
  const { dir } = scratchRepo();
  try {
    const r = verifyReleaseCommit('a'.repeat(40), dir);
    assert.equal(r.status, 'failed');
    assert.ok(r.findings.some((x) => /does not exist in this repository/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a commit outside the release line (not an ancestor of HEAD) fails', () => {
  const { dir } = scratchRepo();
  try {
    git(dir, 'checkout', '-qb', 'side', 'HEAD~1');
    writeFileSync(join(dir, 'b.txt'), 'side\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'side');
    const side = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', 'main');
    const r = verifyReleaseCommit(side, dir);
    assert.equal(r.status, 'failed');
    assert.ok(r.findings.some((x) => /not an ancestor of HEAD/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a non-git context is NOT-PERFORMABLE, said aloud — never a silent pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ev-nogit-'));
  try {
    const r = verifyReleaseCommit('a'.repeat(40), dir);
    assert.equal(r.status, 'not-performable');
    assert.deepEqual(r.findings, [], 'not-performable is a recorded skip, not a failure');
    assert.match(r.note, /NOT verified.*not a git repository/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a malformed commit is not re-judged here — its shape is already evaluate()\'s finding', () => {
  assert.equal(verifyReleaseCommit('release-v-demo', tmpdir()).status, 'not-checked');
  assert.equal(verifyReleaseCommit(undefined, tmpdir()).status, 'not-checked');
});

test('a sealed brainkit-provenance record is verified for what it SAYS', () => {
  const good = { brainkit_id: 'acme-brainkit', brainkit_version: '1.0.0', brainkit_digest: 'sha256:' + 'a'.repeat(64), artifacts: [{ ref: 'reports/prd.html' }] };
  assert.deepEqual(SEMANTICS['brainkit-provenance'](good), []);
  assert.ok(SEMANTICS['brainkit-provenance']({ ...good, brainkit_digest: 'not-a-digest' }).some((f) => /no sha256 brainkit_digest/.test(f)));
  assert.ok(SEMANTICS['brainkit-provenance']({ ...good, brainkit_id: '' }).some((f) => /declares no brainkit_id/.test(f)));
  assert.ok(SEMANTICS['brainkit-provenance']({ ...good, artifacts: [] }).some((f) => /lists no artifacts/.test(f)));
});

/* ---- rc.41: the tenth evidence type, shariah-attestation ------------------------------------
 *
 * Two properties matter more than the field rules and are tested first and last: a repository
 * whose compiled plans name no Islamic product NEVER seals one (so nothing here can fail a
 * conventional adopter), and the worked evidence bundle that shipped before this type existed
 * still passes untouched.
 */

// A registry with one scholar, one agent, and nobody else — the smallest thing that can tell a
// human attester from a machine one.
const SHARIAH_REGISTRY = {
  identities: [
    { id: 'scholar.alpha', kind: 'human', roles: ['shariah-committee'], external: true, reconciliation_source: 'docs/governance/issc-register.json' },
    { id: 'agent.delivery-loop', kind: 'agent', roles: [] },
  ],
};
const ATTESTATION = {
  attester_id: 'scholar.alpha',
  issc_decision_ref: 'SR-0001',
  structures: ['SR-0001', 'SR-0004'],
  result: 'PASS',
  commit: COMMIT,
};
const att = (over = {}, ctx = {}) =>
  SEMANTICS['shariah-attestation']({ ...ATTESTATION, ...over }, { releaseCommit: COMMIT, registry: SHARIAH_REGISTRY, ...ctx });

test('shariah-attestation is PLAN-ONLY — a generic repo seals nothing new', () => {
  assert.ok(PLAN_ONLY_TYPES.includes('shariah-attestation'), 'the seal must know HOW to verify it');
  assert.ok(!REQUIRED_TYPES.includes('shariah-attestation'), 'it stays out of the generic-repo default');
  assert.ok(!EVIDENCE_FLOOR.includes('shariah-attestation'));
  assert.ok(!requiredTypesFor({ evidence: new Set() }).includes('shariah-attestation'), 'the baseline must not demand it');
  assert.ok(!requiredTypesFor({ evidence: new Set(['tests', 'reviews']) }).includes('shariah-attestation'));
});

test('a plan compiling shariah-attestation makes the seal DEMAND it, and names it as missing', () => {
  const req = requiredTypesFor({ evidence: new Set(['tests', 'reviews', 'shariah-attestation']) });
  assert.ok(req.includes('shariah-attestation'), 'plan-required shariah-attestation must be a sealed type');
  const m = anchored({ release: 'v', release_commit: COMMIT, entries: buildChain([{ type: 'tests', ref: 'tests.json', sha256: 'h' }]) });
  assert.ok(evaluate(m, { requiredTypes: req }).some((x) => x === 'missing required evidence: shariah-attestation'));
});

test('a complete, human-attested, commit-bound attestation is structure-conformant', () => {
  assert.deepEqual(att(), []);
});

test('the attestation RECORDS a human decision — an agent attester is a finding', () => {
  assert.ok(att({ attester_id: 'agent.delivery-loop' }).some((f) => /is an AGENT/.test(f)));
});

test('an attester who resolves to nobody does not count, and neither does one nobody can resolve', () => {
  assert.ok(att({ attester_id: 'scholar.nobody' }).some((f) => /does not resolve in the identity registry/.test(f)));
  assert.ok(att({}, { registry: null }).some((f) => /cannot be resolved — no identity registry/.test(f)));
  assert.ok(att({ attester_id: '' }).some((f) => /names no attester_id/.test(f)));
});

test('an attestation citing no committee decision asserts approval on its own authority', () => {
  assert.ok(att({ issc_decision_ref: '' }).some((f) => /names no issc_decision_ref/.test(f)));
  assert.ok(att({ issc_decision_ref: undefined }).some((f) => /names no issc_decision_ref/.test(f)));
});

test('an attestation must say WHICH register rows the shipped structures are', () => {
  for (const structures of [[], undefined, 'SR-0001', ['SR-0001', '']]) {
    assert.ok(att({ structures }).some((f) => /lists no structures/.test(f)), JSON.stringify(structures));
  }
});

test('a non-PASS attestation is not release evidence, and a stale one is not this release\'s', () => {
  assert.ok(att({ result: 'CONDITIONAL' }).some((f) => /not PASS/.test(f)));
  assert.ok(att({ result: undefined }).some((f) => /not PASS/.test(f)));
  assert.ok(att({ commit: 'b'.repeat(40) }).some((f) => /not the release commit/.test(f)));
  assert.ok(att({ commit: undefined }).some((f) => /not the release commit/.test(f)), 'the tests validator\'s rule: an unstated commit is not a binding');
  // With no release commit known there is nothing to bind to, and the gate says nothing about it.
  assert.deepEqual(att({ commit: undefined }, { releaseCommit: null }), []);
});

test('the registry reaches the validator THROUGH evaluate() — a sealed attestation is resolved end to end', () => {
  const { dir } = realBundle();
  try {
    const body = JSON.stringify({ ...ATTESTATION, attester_id: 'agent.delivery-loop' }) + '\n';
    writeFileSync(join(dir, 'shariah-attestation.json'), body);
    const raw = [
      ...REQUIRED_TYPES.map((t) => ({ type: t, ref: `${t}.json`, sha256: createHash('sha256').update(JSON.stringify(VALID[t]) + '\n').digest('hex') })),
      { type: 'shariah-attestation', ref: 'shariah-attestation.json', sha256: createHash('sha256').update(body).digest('hex') },
    ];
    const m = anchored({ release: 'v', release_commit: COMMIT, entries: buildChain(raw) });
    assert.ok(evaluate(m, { baseDir: dir, registry: SHARIAH_REGISTRY }).some((x) => /shariah-attestation.*is an AGENT/.test(x)),
      'without the registry threaded through, an agent-signed attestation would seal clean');
    // Same bundle, human attester: the whole chain verifies.
    const good = JSON.stringify(ATTESTATION) + '\n';
    writeFileSync(join(dir, 'shariah-attestation.json'), good);
    raw[raw.length - 1].sha256 = createHash('sha256').update(good).digest('hex');
    const ok = anchored({ release: 'v', release_commit: COMMIT, entries: buildChain(raw) });
    assert.deepEqual(evaluate(ok, { baseDir: dir, registry: SHARIAH_REGISTRY }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const WORKED_BUNDLE = [join(HARNESS, 'evidence-example'), join(HARNESS, 'docs/governance/evidence')]
  .find((d) => existsSync(join(d, 'manifest.json')));
test('BACKWARD COMPATIBILITY — the shipped worked evidence bundle still passes, untouched', { skip: !WORKED_BUNDLE && 'worked evidence bundle not staged in this layout' }, () => {
  const dir = WORKED_BUNDLE;
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(evaluate(manifest, { baseDir: dir }), [], 'the worked bundle predates shariah-attestation and must not acquire a requirement');
  // …and with no registry loaded either, which is the state every conventional adopter is in.
  assert.deepEqual(evaluate(manifest, { baseDir: dir, registry: null }), []);
});

/* ---- 2.1.0 (plan row 2.5, decision K9): the anchor outside the tree ---- */
import { externalRecordFindings } from './evidence-seal-check.mjs';

const xrManifest = (over = {}) => ({ ...sealed(), external_record: { provider: 'kosli', id: 'att-1', ref: { provider: 'kosli', flow: 'f', trail: 'CHG-1', name: 'seal-anchor', id: 'att-1' }, recorded_at: '2026-09-13T00:00:00Z' }, ...over });
const MOUNTED = { mounted: true, provider: 'kosli', active: true };
const resolvedWith = (anchor) => async () => ({ status: 'resolved', record: { attestation_name: 'seal-anchor', user_data: { payload: { anchor } } } });

test('not required: nothing owed, whatever the manifest carries', async () => {
  assert.deepEqual(await externalRecordFindings(sealed(), { required: false, status: { mounted: false }, resolveFn: async () => { throw new Error('must not be called'); } }), []);
});

test('required but unmounted: a NOTE naming PS-R06 as the owner, never a finding here', async () => {
  const notes = [];
  assert.deepEqual(await externalRecordFindings(sealed(), { required: true, status: { mounted: false, reason: 'no provider selected' }, resolveFn: async () => ({}), notes }), []);
  assert.ok(notes.some((n) => /PS-R06/.test(n)));
});

test('required and mounted: the manifest must carry a record id, from the selected provider', async () => {
  const noField = await externalRecordFindings(sealed(), { required: true, status: MOUNTED, resolveFn: async () => ({}) });
  assert.ok(noField.some((f) => /carries no external_record id/.test(f)));
  const other = await externalRecordFindings(xrManifest({ external_record: { provider: 'worm-store', id: 'x' } }), { required: true, status: MOUNTED, resolveFn: async () => ({}) });
  assert.ok(other.some((f) => /names provider "worm-store" but the institution selected kosli/.test(f)));
});

test('a resolvable id holding the same anchor passes; a different anchor, an unknown id and an outage each fail in their own words', async () => {
  const m = xrManifest();
  assert.deepEqual(await externalRecordFindings(m, { required: true, status: MOUNTED, resolveFn: resolvedWith(m.anchor) }), []);
  assert.deepEqual(await externalRecordFindings(m, { required: true, status: MOUNTED, resolveFn: async () => ({ status: 'resolved', record: { attestation_name: 'seal-anchor' } }) }), [], 'a provider that does not echo the payload still resolves');
  assert.ok((await externalRecordFindings(m, { required: true, status: MOUNTED, resolveFn: resolvedWith('f'.repeat(64)) })).some((f) => /holds a different seal/.test(f)));
  assert.ok((await externalRecordFindings(m, { required: true, status: MOUNTED, resolveFn: async () => ({ status: 'unresolved', reason: 'not found' }) })).some((f) => /does NOT hold anchor id att-1/.test(f)));
  assert.ok((await externalRecordFindings(m, { required: true, status: MOUNTED, resolveFn: async () => ({ status: 'unavailable', reason: 'binary missing' }) })).some((f) => /could not be reached/.test(f)));
  const notes = [];
  await externalRecordFindings(m, { required: true, status: { ...MOUNTED, active: false }, resolveFn: resolvedWith(m.anchor), notes });
  assert.ok(notes.some((n) => /selected, not active/.test(n)));
});
