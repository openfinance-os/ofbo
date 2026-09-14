// Tests for the drift gate (Factory Floor WS4 · D4.2). Node built-in runner.
//
// The gate's whole difficulty is restraint. Blocking on drift is easy; the hard part is that a
// repository which has frozen nothing must be untouched, a repository which has frozen but wired no
// watcher must be untouched, a page that has drifted with nobody claiming against it must not turn a
// build red — and the moment somebody DOES claim against it, the block must be absolute. Each of
// those has a test here, and each blocking control has the negative that would pass without it.
//
// The fixtures are synthetic throughout: a page nobody has, a change nobody raised, an approver who
// does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeStamp, sha256 } from '../core/floor-export.mjs';
import { CAPABILITY, REJECTIONS, driftObservation } from '../core/floor-drift.mjs';
import { DRIFT_DIR, badge, evaluate, run } from './drift-check.mjs';

const SRC = 'notion:page/synthetic-floor-page';
const FROZEN = '---\nartifact: data-governance\n---\n\n# Data governance\n\nThe bytes that were frozen.\n';
const EDITED = `${FROZEN}\nAnd a paragraph somebody added on the floor afterwards.\n`;
const A = sha256(FROZEN);
const B = sha256(EDITED);

const CHANGE = 'CHG-SYNTHETIC-0001';

/** A repository with one frozen discovery artifact, and whatever else a test asks for. */
function repo({ observations = [], approvals = [], stamps = null, requireCapability = false, frozen = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  if (frozen) {
    const runDir = join(dir, 'discovery/runs/synthetic-run');
    mkdirSync(join(runDir, '.freeze'), { recursive: true });
    writeFileSync(join(runDir, 'data-governance.md'), FROZEN);
    const list = stamps || [freezeStamp({
      slug: 'synthetic-run',
      file: 'data-governance.md',
      digest: A,
      source: SRC,
      exportedAt: '2026-02-01T00:00:00Z',
      exportedBy: 'svc-floor-freezer',
    })];
    list.forEach((s, i) => writeFileSync(join(runDir, `.freeze/data-governance${i || ''}.json`), JSON.stringify(s)));
  }
  if (observations.length) {
    mkdirSync(join(dir, DRIFT_DIR), { recursive: true });
    observations.forEach((o, i) => writeFileSync(join(dir, DRIFT_DIR, `2026-06-0${i + 1}-sweep.json`), JSON.stringify(o)));
  }
  if (approvals.length || requireCapability) {
    const changeDir = join(dir, 'docs/governance/changes', CHANGE);
    mkdirSync(join(changeDir, 'approvals'), { recursive: true });
    writeFileSync(join(changeDir, 'change-envelope.json'), JSON.stringify({ change_id: CHANGE }));
    writeFileSync(join(changeDir, 'control-plan.json'), JSON.stringify({
      required_capabilities: requireCapability ? { [CAPABILITY]: { required: true } } : {},
    }));
    approvals.forEach((a, i) => writeFileSync(join(changeDir, `approvals/pa1-${i}.json`), JSON.stringify(a)));
  }
  return dir;
}

const obs = (digest, at, by = 'platform-observer') => driftObservation({ source: SRC, digest, observedAt: at, observedBy: by });

const approval = (issuedAt, over = {}) => ({
  schema: 'loom.approval-attestation/v1',
  change_id: CHANGE,
  stage: 'PA1',
  outcome: 'approved',
  role: 'risk-second-line',
  subject: { registry_id: 'synthetic-approver', idp_subject: 'idp|synthetic' },
  bound_to: { artifact_digest: A },
  origin: { system: 'notion', event_id: 'evt-synthetic', nonce: 'n-synthetic' },
  validity: { issued_at: issuedAt },
  ...over,
});

const withRepo = (opts, fn) => { const dir = repo(opts); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

// ── silence where unadopted ──────────────────────────────────────────────────────────────────────

test('a repository that has frozen nothing is a clean no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.sources, 0);
    assert.equal(r.states.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repository that has frozen but wired no watcher is untouched', () => {
  // The freeze round-trip is adoptable without the watcher. Reporting a verdict on a page nobody
  // has looked at would be inventing one, and an adopter who froze last week would open a red
  // build they cannot fix without standing up a service.
  withRepo({}, (dir) => {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.sources, 0);
    assert.equal(r.observed, 0);
  });
});

test('an observation of a page nobody froze says nothing', () => {
  withRepo({ frozen: false, observations: [obs(B, '2026-06-01T00:00:00Z')] }, (dir) => {
    assert.deepEqual(run(dir).findings, []);
  });
});

// ── the badge ────────────────────────────────────────────────────────────────────────────────────

test('an in-sync page reports in sync and fails nothing', () => {
  withRepo({ observations: [obs(A, '2026-06-01T00:00:00Z')] }, (dir) => {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.sources, 1);
    assert.equal(r.drifted, 0);
    assert.equal(r.states[0].status, 'in-sync');
  });
});

test('a post-freeze edit raises the badge, and on its own does not fail the build', () => {
  // The judgement most worth arguing with, so it is pinned: drift with no claim against it is
  // REPORTED, not refused. A red build for someone typing on a page makes reflexive re-freezing the
  // cheapest way to green, and a re-freeze changes the record.
  withRepo({ observations: [obs(B, '2026-06-01T00:00:00Z')] }, (dir) => {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.drifted, 1);
    assert.equal(r.states[0].drifted_since, '2026-06-01T00:00:00Z');
    assert.match(badge(r.states[0]), /DRIFTED since 2026-06-01T00:00:00Z/);
  });
});

// ── the asymmetry, end to end ────────────────────────────────────────────────────────────────────

test('a post-freeze edit blocks a NEW approval citing the frozen artifact', () => {
  withRepo({
    observations: [obs(B, '2026-06-01T00:00:00Z')],
    approvals: [approval('2026-06-04T00:00:00Z')],
  }, (dir) => {
    const f = run(dir).findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /^DR-F02:/);
    assert.match(f[0], new RegExp(CHANGE));
  });
});

test('the SAME approval, dated before the drift was observed, still passes', () => {
  // THE negative, at the gate level. Identical repository but for the decision date. If this ever
  // fails, drift has started reaching backwards into merged history.
  withRepo({
    observations: [obs(B, '2026-06-01T00:00:00Z')],
    approvals: [approval('2026-03-01T00:00:00Z')],
  }, (dir) => {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.drifted, 1); // the page is still visibly out of sync — the record is just not
    assert.equal(r.claims, 1);
  });
});

test('an approval citing an unrelated artifact is not blocked by this page drifting', () => {
  withRepo({
    observations: [obs(B, '2026-06-01T00:00:00Z')],
    approvals: [approval('2026-06-04T00:00:00Z', { bound_to: { artifact_digest: sha256('some other artifact entirely') } })],
  }, (dir) => {
    assert.deepEqual(run(dir).findings, []);
  });
});

// ── the second freeze ────────────────────────────────────────────────────────────────────────────

test('re-stamping the stale bytes to clear the block is refused (DR-F01)', () => {
  const first = freezeStamp({ slug: 'synthetic-run', file: 'data-governance.md', digest: A, source: SRC, exportedAt: '2026-02-01T00:00:00Z', exportedBy: 'svc-floor-freezer' });
  const restamp = { ...first, exported_at: '2026-06-02T00:00:00Z' };
  withRepo({ stamps: [first, restamp], observations: [obs(B, '2026-06-01T00:00:00Z')] }, (dir) => {
    const f = run(dir).findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /^DR-F01:/);
    assert.match(f[0], /re-stamping is not re-freezing/);
  });
});

test('a real re-freeze clears the block and lets a new approval through', () => {
  // The negative for DR-F01 and for the whole block: the remedy the messages recommend must
  // actually work, or the gate is a dead end and people will route around it.
  const first = freezeStamp({ slug: 'synthetic-run', file: 'data-governance.md', digest: A, source: SRC, exportedAt: '2026-02-01T00:00:00Z', exportedBy: 'svc-floor-freezer' });
  const refreeze = { ...first, digest: B, exported_at: '2026-06-02T00:00:00Z' };
  withRepo({
    stamps: [first, refreeze],
    observations: [obs(B, '2026-06-01T00:00:00Z'), obs(B, '2026-06-03T00:00:00Z')],
    approvals: [approval('2026-06-04T00:00:00Z', { bound_to: { artifact_digest: B } })],
  }, (dir) => {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.states[0].status, 'in-sync');
  });
});

// ── junk in the observation directory ────────────────────────────────────────────────────────────

test('an unreadable observation file is a finding, not a skip (DR-F05)', () => {
  withRepo({ observations: [obs(A, '2026-06-01T00:00:00Z')] }, (dir) => {
    writeFileSync(join(dir, DRIFT_DIR, '2026-06-02-sweep.json'), '{ not json');
    const f = run(dir).findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /^DR-F05:/);
    assert.match(f[0], /2026-06-02-sweep\.json/);
  });
});

test('a batched sweep file carrying several observations is read', () => {
  withRepo({}, (dir) => {
    mkdirSync(join(dir, DRIFT_DIR), { recursive: true });
    writeFileSync(join(dir, DRIFT_DIR, 'sweep.json'), JSON.stringify({
      observations: [obs(B, '2026-06-01T00:00:00Z'), driftObservation({ source: 'notion:page/unrelated', digest: A, observedAt: '2026-06-01T00:00:00Z', observedBy: 'platform-observer' })],
    }));
    const r = run(dir);
    assert.equal(r.observed, 2);
    assert.equal(r.drifted, 1);
    assert.deepEqual(r.findings, []);
  });
});

// ── mandatory-when-compiled ──────────────────────────────────────────────────────────────────────

test('a compiled plan requiring the capability turns silence into a finding (DR-F04)', () => {
  withRepo({ requireCapability: true }, (dir) => {
    const f = run(dir).findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /^DR-F04:/);
    assert.match(f[0], /never been observed/);
  });
});

test('the same repository without the compiled capability is silent', () => {
  // The negative for DR-F04. Mandatory-when-compiled means a plan that does not compile the
  // capability behaves exactly as it did before this gate existed.
  withRepo({ requireCapability: false, approvals: [approval('2026-06-04T00:00:00Z')] }, (dir) => {
    assert.deepEqual(run(dir).findings, []);
  });
});

test('a compiled requirement with nothing frozen to apply it to is a plan defect', () => {
  withRepo({ frozen: false, requireCapability: true }, (dir) => {
    const f = run(dir).findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /^DR-F04:/);
    assert.match(f[0], /nothing has been frozen/);
  });
});

test('a stale observation fails only where the capability is compiled', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const stamps = [freezeStamp({ slug: 'synthetic-run', file: 'data-governance.md', digest: A, source: SRC, exportedAt: '2026-02-01T00:00:00Z', exportedBy: 'svc-floor-freezer' })];
  const args = { stamps: stamps.map((s) => ({ slug: 'synthetic-run', name: 'data-governance.json', stamp: s })), observations: [{ name: 'sweep.json', observation: obs(A, '2026-06-01T00:00:00Z') }], now };
  assert.deepEqual(evaluate(args).findings, []);
  const f = evaluate({ ...args, required: [CHANGE] }).findings;
  assert.equal(f.length, 1);
  assert.match(f[0], /^DR-F04:.*days old/);
});

// ── the D4.1 seam ────────────────────────────────────────────────────────────────────────────────

test('every rejection code a reader can meet is documented, and every documented one is used', () => {
  // Rot this catches: a seventh refusal added in a hurry, emitted as `DR-F07` and explained
  // nowhere, so the operator reading the red build has nothing to look up. It runs the other way
  // too — a code documented but never emitted is a control someone believes exists.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = [`${here}/drift-check.mjs`, `${here}/../core/floor-drift.mjs`].map((p) => readFileSync(p, 'utf8')).join('\n');
  const emitted = new Set([...src.matchAll(/`?(DR-F\d\d)[:`]/g)].map((m) => m[1]));
  assert.deepEqual([...emitted].sort(), [...REJECTIONS.keys()].sort());
  for (const [code, gloss] of REJECTIONS) assert.ok(gloss.length > 20, code);
});

test('a freeze stamp naming no source page is only a finding where currency is required', () => {
  const sourceless = freezeStamp({ slug: 'synthetic-run', file: 'data-governance.md', digest: A, exportedAt: '2026-02-01T00:00:00Z', exportedBy: 'svc-floor-freezer' });
  withRepo({ stamps: [sourceless], observations: [obs(A, '2026-06-01T00:00:00Z')] }, (dir) => {
    assert.deepEqual(run(dir).findings, []);
  });
  withRepo({ stamps: [sourceless], requireCapability: true }, (dir) => {
    assert.match(run(dir).findings[0], /^DR-F04:.*names no source page/);
  });
});
