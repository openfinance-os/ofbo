// Tests for drift, narrowed (Factory Floor WS4 · D4.2). Node built-in runner.
//
// Every control here is tested twice: once for the case it must catch, and once for the case that
// would sail through if the control were absent. The second half is the important one. A drift
// check that blocks everything is trivial to write and destroys the record — the difficulty is
// blocking new claims while leaving merged ones alone, and only a negative test can show that the
// second half still works.
//
// All fixture names, digests and dates are synthetic: a page nobody has, frozen by a service
// nobody runs, approved by a person who does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeStamp, sha256 } from './floor-export.mjs';
import {
  CAPABILITY,
  blocksClaimAt,
  checkApprovalClaim,
  checkCurrency,
  checkFreezeClaim,
  checkObservation,
  citedStamps,
  driftObservation,
  driftRequired,
  driftState,
  driftStates,
  observe,
  pageIdOf,
} from './floor-drift.mjs';

const SRC = 'notion:page/synthetic-floor-page';
const OTHER = 'notion:page/synthetic-other-page';
const FROZEN = '# Synthetic artifact\n\nThe bytes that were frozen.\n';
const EDITED = '# Synthetic artifact\n\nThe bytes that were frozen.\n\nAnd a paragraph added afterwards.\n';
const AGAIN = '# Synthetic artifact\n\nEdited a second time.\n';
const A = sha256(FROZEN);
const B = sha256(EDITED);
const C = sha256(AGAIN);

const stamp = (over = {}) => ({
  ...freezeStamp({
    slug: 'synthetic-run',
    file: 'artifact.md',
    digest: A,
    source: SRC,
    exportedAt: '2026-02-01T00:00:00Z',
    exportedBy: 'svc-floor-freezer',
  }),
  ...over,
});

const obs = (digest, at, by = 'platform-observer', source = SRC) => driftObservation({ source, digest, observedAt: at, observedBy: by });

/** A synthetic approval record in the D2.4 shape — only the fields drift reads are meaningful. */
const approval = (over = {}) => ({
  schema: 'loom.approval-attestation/v1',
  change_id: 'CHG-SYNTHETIC-0001',
  stage: 'PA1',
  outcome: 'approved',
  role: 'risk-second-line',
  subject: { registry_id: 'synthetic-approver', idp_subject: 'idp|synthetic' },
  bound_to: { artifact_digest: A },
  origin: { system: 'notion', event_id: 'evt-synthetic', nonce: 'n-synthetic' },
  validity: { issued_at: '2026-03-01T00:00:00Z' },
  ...over,
});

const states = (list) => new Map(list.map((s) => [s.source, s]));

// ── the badge ────────────────────────────────────────────────────────────────────────────────────

test('a page whose observed digest matches its freeze is not drifted', () => {
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(A, '2026-03-10T00:00:00Z')] });
  assert.equal(s.status, 'in-sync');
  assert.deepEqual(s.findings, []);
  assert.equal(s.drifted_since, null);
  assert.equal(blocksClaimAt(s, '2026-12-31T00:00:00Z').blocked, false);
});

test('a post-freeze edit is drift, and the badge records when it became known', () => {
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-03-05T09:00:00Z')] });
  assert.equal(s.status, 'drifted');
  assert.equal(s.stamped_digest, A);
  assert.equal(s.live_digest, B);
  assert.equal(s.drifted_since, '2026-03-05T09:00:00Z');
  // Drift is a STATE, not a finding. On its own it blocks nothing and fails no build.
  assert.deepEqual(s.findings, []);
});

test('an observation taken before the freeze cannot judge it', () => {
  // It read a different document. Treating it as a verdict would report drift against bytes that
  // were superseded by the freeze itself — which is how a freshly frozen page would come up red.
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-01-15T00:00:00Z')] });
  assert.equal(s.status, 'unobserved');
  assert.deepEqual(s.findings, []);
});

test('a divergence that was later resolved does not block claims made after it resolved', () => {
  const s = driftState({
    source: SRC,
    stamps: [stamp()],
    observations: [obs(B, '2026-03-01T00:00:00Z'), obs(A, '2026-03-02T00:00:00Z'), obs(C, '2026-03-09T00:00:00Z')],
  });
  assert.equal(s.status, 'drifted');
  // The clock restarts at the divergence that is still live, not at the one someone already fixed.
  assert.equal(s.drifted_since, '2026-03-09T00:00:00Z');
  assert.equal(blocksClaimAt(s, '2026-03-05T00:00:00Z').blocked, false);
  assert.equal(blocksClaimAt(s, '2026-03-09T00:00:00Z').blocked, true);
});

// ── the asymmetry ────────────────────────────────────────────────────────────────────────────────

test('a record merged before the drift was observed is NOT invalidated by it', () => {
  // THE negative. If this test ever fails, the delivery has become the thing it was written to
  // refuse: a typo on a floor page retroactively unapproving a decision that already shipped.
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  assert.equal(s.status, 'drifted');
  const merged = approval({ validity: { issued_at: '2026-03-01T00:00:00Z' } });
  assert.deepEqual(checkApprovalClaim(merged, { states: states([s]), stamps: [stamp()] }, 'merged'), []);
});

test('a NEW claim dated at or after the drift was observed is blocked (DR-F02)', () => {
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  for (const at of ['2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z']) {
    const f = checkApprovalClaim(approval({ validity: { issued_at: at } }), { states: states([s]), stamps: [stamp()] }, 'new');
    assert.equal(f.length, 1, at);
    assert.match(f[0], /^DR-F02:/);
    assert.match(f[0], /Records already merged against this artifact stand/);
  }
});

test('a claim with no parseable instant is blocked, not waved through', () => {
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  for (const validity of [{}, { issued_at: 'last Tuesday' }, undefined]) {
    const f = checkApprovalClaim(approval({ validity }), { states: states([s]), stamps: [stamp()] }, 'undated');
    assert.equal(f.length, 1, JSON.stringify(validity));
    assert.match(f[0], /cannot be shown to have been made before/);
  }
});

test('the verdict reads no clock — the same record judges the same way forever', () => {
  // Adversarial: if anything in the drift comparison consulted `now`, a green build would go red on
  // its own and a past verdict could not be re-derived. Take the clock away and prove it.
  const real = Date.now;
  Date.now = () => { throw new Error('driftState and blocksClaimAt must not read a clock'); };
  try {
    const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] });
    assert.equal(s.status, 'drifted');
    assert.equal(blocksClaimAt(s, '2026-03-01T00:00:00Z').blocked, false);
    assert.equal(blocksClaimAt(s, '2026-07-01T00:00:00Z').blocked, true);
    assert.deepEqual(checkApprovalClaim(approval(), { states: states([s]), stamps: [stamp()] }), []);
  } finally { Date.now = real; }
});

test('drift on one page does not block a claim resting on another', () => {
  const otherStamp = stamp({ source: OTHER, digest: C, file: 'other.md' });
  const drifted = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-01-05T00:00:00Z')] });
  const clean = driftState({ source: OTHER, stamps: [otherStamp], observations: [obs(C, '2026-03-01T00:00:00Z', 'platform-observer', OTHER)] });
  const rec = approval({ bound_to: { artifact_digest: C }, validity: { issued_at: '2026-06-01T00:00:00Z' } });
  assert.deepEqual(checkApprovalClaim(rec, { states: states([drifted, clean]), stamps: [stamp(), otherStamp] }), []);
});

// ── the second freeze ────────────────────────────────────────────────────────────────────────────

test('re-stamping the stale bytes after a drift observation is refused (DR-F01)', () => {
  const first = stamp();
  const restamp = stamp({ exported_at: '2026-06-02T00:00:00Z' }); // same digest, new date
  const s = driftState({
    source: SRC,
    stamps: [first, restamp],
    observations: [obs(B, '2026-06-01T00:00:00Z')],
  });
  assert.equal(s.findings.length, 1);
  assert.match(s.findings[0], /^DR-F01:/);
  assert.match(s.findings[0], /re-stamping is not re-freezing/);
});

test('a genuine re-freeze changes the bytes and is not a re-stamp', () => {
  // The negative for DR-F01. A control that fired on "a second stamp after an observation" would
  // block the very remedy it tells people to use.
  const first = stamp();
  const refreeze = stamp({ digest: B, exported_at: '2026-06-02T00:00:00Z' });
  const s = driftState({ source: SRC, stamps: [first, refreeze], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  assert.deepEqual(s.findings, []);
  assert.notEqual(s.status, 'drifted');
});

test('a re-freeze clears the drift block, and a fresh observation confirms it', () => {
  const first = stamp();
  const refreeze = stamp({ digest: B, exported_at: '2026-06-02T00:00:00Z' });
  const cleared = driftState({ source: SRC, stamps: [first, refreeze], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  assert.equal(cleared.status, 'unobserved'); // nobody has looked since the re-freeze
  assert.equal(blocksClaimAt(cleared, '2026-06-03T00:00:00Z').blocked, false);

  const confirmed = driftState({
    source: SRC,
    stamps: [first, refreeze],
    observations: [obs(B, '2026-06-01T00:00:00Z'), obs(B, '2026-06-03T00:00:00Z')],
  });
  assert.equal(confirmed.status, 'in-sync');
  assert.deepEqual(confirmed.findings, []);
});

test('a repeated digest corroborated by a later independent observation is allowed', () => {
  // The page really was reverted to the frozen bytes. The route through is another look by the
  // watcher, not a route that a freezer can take on its own — see the DR-F06 test below.
  const first = stamp();
  const restamp = stamp({ exported_at: '2026-06-02T00:00:00Z' });
  const s = driftState({
    source: SRC,
    stamps: [first, restamp],
    observations: [obs(B, '2026-06-01T00:00:00Z'), obs(A, '2026-06-03T00:00:00Z')],
  });
  assert.deepEqual(s.findings, []);
  assert.equal(s.status, 'in-sync');
});

test('a freezer cannot clear its own re-stamp by observing itself', () => {
  const first = stamp();
  const restamp = stamp({ exported_at: '2026-06-02T00:00:00Z' });
  const f = checkFreezeClaim(restamp, {
    stamps: [first, restamp],
    observations: [obs(B, '2026-06-01T00:00:00Z'), obs(A, '2026-06-03T00:00:00Z', 'svc-floor-freezer')],
  }, 'self-cleared');
  assert.equal(f.length, 1);
  assert.match(f[0], /^DR-F01:/);
});

test('a first freeze can never be a re-stamp', () => {
  assert.deepEqual(checkFreezeClaim(stamp(), { stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] }), []);
});

// ── who may vouch ────────────────────────────────────────────────────────────────────────────────

test('a freezer may not corroborate its own freeze (DR-F06)', () => {
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(A, '2026-03-10T00:00:00Z', 'svc-floor-freezer')] });
  assert.equal(s.findings.length, 1);
  assert.match(s.findings[0], /^DR-F06:/);
  // …and the self-observation does not become a clean bill of health by being discarded.
  assert.equal(s.status, 'unobserved');
});

test('the same observation from an independent watcher does count', () => {
  // The negative for DR-F06: the control must reject the observer, not the observation.
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(A, '2026-03-10T00:00:00Z', 'platform-observer')] });
  assert.deepEqual(s.findings, []);
  assert.equal(s.status, 'in-sync');
});

// ── unknown is not in-sync ───────────────────────────────────────────────────────────────────────

test('an absent or unreadable freeze is unknown, never in-sync (DR-F03)', () => {
  const cases = [
    [[], /nothing was frozen from this page/],
    [[stamp({ schema: 'other/v1' })], /not a readable loom\.freeze-stamp\/v1 stamp/],
    [[stamp({ digest: 'not-a-digest' })], /not a readable loom\.freeze-stamp\/v1 stamp/],
    [[stamp({ exported_at: null })], /no parseable exported_at/],
  ];
  for (const [stamps, re] of cases) {
    const s = driftState({ source: SRC, stamps, observations: [obs(A, '2026-03-10T00:00:00Z')] });
    assert.equal(s.status, 'unknown');
    assert.match(s.findings[0], /^DR-F03:/);
    assert.match(s.findings[0], re);
  }
});

test('a claim resting on an unknown freeze is refused, not passed (DR-F03)', () => {
  const s = driftState({ source: SRC, stamps: [stamp({ schema: 'other/v1' })], observations: [] });
  const f = checkApprovalClaim(approval(), { states: states([s]), cites: [SRC] }, 'claim');
  assert.equal(f.length, 1);
  assert.match(f[0], /^DR-F03:/);
  assert.match(f[0], /unknown is not in-sync/);
});

test('citing a source nothing was frozen from is refused (DR-F03)', () => {
  const f = checkApprovalClaim(approval(), { states: states([]), cites: ['notion:page/never-frozen'] }, 'claim');
  assert.equal(f.length, 1);
  assert.match(f[0], /^DR-F03:/);
  assert.match(f[0], /nothing has been frozen/);
});

test('an unreadable observation is a finding, and never reads as agreement (DR-F05)', () => {
  const cases = [
    [null, /not an object/],
    [{ ...obs(A, '2026-03-10T00:00:00Z'), schema: 'other/v1' }, /is not loom\.drift-observation\/v1/],
    [{ ...obs(A, '2026-03-10T00:00:00Z'), source: '' }, /names no source/],
    [{ ...obs(A, '2026-03-10T00:00:00Z'), digest: 'sha256:' }, /carries no sha256 digest/],
    [{ ...obs(A, '2026-03-10T00:00:00Z'), observed_at: 'yesterday' }, /not a parseable ISO-8601/],
    [{ ...obs(A, '2026-03-10T00:00:00Z'), observed_by: null }, /names no observer/],
  ];
  for (const [bad, re] of cases) {
    const f = checkObservation(bad, 'obs.json');
    assert.ok(f.length >= 1, re.source);
    assert.match(f.join(' '), re);
    assert.ok(f.every((x) => x.startsWith('DR-F05:')));
    // The dangerous outcome is not the finding — it is the state. A junk observation carrying the
    // frozen digest must not be able to certify a page as current.
    const s = driftState({ source: SRC, stamps: [stamp()], observations: [bad] });
    assert.notEqual(s.status, 'in-sync');
  }
});

test('a well-formed observation passes its own check', () => {
  assert.deepEqual(checkObservation(obs(A, '2026-03-10T00:00:00Z'), 'obs.json'), []);
});

// ── citation ─────────────────────────────────────────────────────────────────────────────────────

test('a signed digest cites a frozen artifact; an unsigned page id cites it more weakly', () => {
  const s = stamp();
  assert.deepEqual(citedStamps(approval({ bound_to: { artifact_digest: A } }), [s]), [{ stamp: s, via: 'digest' }]);
  assert.deepEqual(
    citedStamps(approval({ bound_to: {}, origin: { system: 'notion', page_id: 'synthetic-floor-page' } }), [s]),
    [{ stamp: s, via: 'page-id' }],
  );
  // A record that binds nothing about the artifact and names no page cites nothing at all.
  assert.deepEqual(citedStamps(approval({ bound_to: { source_sha: 'deadbeef' }, origin: {} }), [s]), []);
  assert.equal(pageIdOf(SRC), 'synthetic-floor-page');
  assert.equal(pageIdOf('not-a-page-reference'), null);
});

test('any bound sha256 digest counts as a citation, not just the field we expected', () => {
  // A record that binds the frozen artifact under `passport_digest` is resting on it just as much
  // as one that uses `artifact_digest`. Matching a single field name would be a control that a
  // schema change silently switches off.
  const s = driftState({ source: SRC, stamps: [stamp()], observations: [obs(B, '2026-06-01T00:00:00Z')] });
  const rec = approval({ bound_to: { passport_digest: A }, validity: { issued_at: '2026-06-05T00:00:00Z' } });
  const f = checkApprovalClaim(rec, { states: states([s]), stamps: [stamp()] });
  assert.equal(f.length, 1);
  assert.match(f[0], /^DR-F02:/);
});

// ── currency (the only clock) ────────────────────────────────────────────────────────────────────

test('currency is unproven when nobody has looked, or has not looked recently', () => {
  const now = Date.parse('2026-07-01T00:00:00Z');
  assert.match(checkCurrency(SRC, [], { now })[0], /^DR-F04:.*never been observed/);
  assert.match(checkCurrency(SRC, [obs(A, '2026-05-01T00:00:00Z')], { now })[0], /^DR-F04:.*days old/);
  assert.deepEqual(checkCurrency(SRC, [obs(A, '2026-06-29T00:00:00Z')], { now }), []);
  // An observation of a different page proves nothing about this one.
  assert.match(checkCurrency(SRC, [obs(A, '2026-06-29T00:00:00Z', 'platform-observer', OTHER)], { now })[0], /never been observed/);
});

test('the capability is read from the compiled plan, and defaults to off', () => {
  assert.equal(driftRequired(null), false);
  assert.equal(driftRequired({ required_capabilities: {} }), false);
  assert.equal(driftRequired({ required_capabilities: { [CAPABILITY]: { required: false } } }), false);
  assert.equal(driftRequired({ required_capabilities: { [CAPABILITY]: { required: true } } }), true);
});

// ── observing ────────────────────────────────────────────────────────────────────────────────────

test('observe() hashes what an injected reader returns, through the same exporter digest', async () => {
  const o = await observe({ source: SRC, observedAt: '2026-07-01T00:00:00Z', observedBy: 'platform-observer' }, async () => ({ markdown: FROZEN }));
  assert.equal(o.digest, A);
  assert.equal(o.source, SRC);
  assert.deepEqual(checkObservation(o), []);
  const pre = await observe({ source: SRC, observedAt: '2026-07-01T00:00:00Z', observedBy: 'platform-observer' }, async () => ({ digest: B }));
  assert.equal(pre.digest, B);
});

test('observe() refuses to write an observation it could not actually make', async () => {
  // An observation file is evidence that somebody looked. A placeholder written when the read
  // failed would be indistinguishable, later, from a page that had not changed.
  await assert.rejects(() => observe({ source: SRC }, async () => ({})), /neither `markdown` nor a sha256 `digest`/);
  await assert.rejects(() => observe({ source: SRC }, null), /injected reader/);
  await assert.rejects(() => observe({ source: '' }, async () => ({ markdown: FROZEN })), /needs the source/);
});

test('driftStates groups a repository by source', () => {
  const otherStamp = stamp({ source: OTHER, digest: C, file: 'other.md' });
  const map = driftStates({
    stamps: [stamp(), otherStamp],
    observations: [obs(B, '2026-06-01T00:00:00Z'), obs(C, '2026-06-01T00:00:00Z', 'platform-observer', OTHER)],
  });
  assert.equal(map.get(SRC).status, 'drifted');
  assert.equal(map.get(OTHER).status, 'in-sync');
});
