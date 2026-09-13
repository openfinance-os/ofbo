// Tests for release trains (rc.38 · flow-plan Phase 4.4). Node built-in runner.
//
// A train's only job is to be a TRUSTWORTHY enumeration of what is in a release. Every case below
// is one way an enumeration stops being trustworthy: two trains claiming a change, two claiming a
// commit, a change nobody governed, a release taken by somebody who may not take it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAIN_FIELDS, evaluateTrains, trainForCommit } from './release-trains.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The worked train is BUNDLE demonstration data — the installer does not ship it (it names
// changes an adopter does not have), so in an adopted layout it is absent and the fixture test
// below skips rather than throwing. Every pure case above it runs in both layouts.
const TRAIN_EXAMPLE = ['release-train-example/train.json', 'docs/governance/release-trains/train.json']
  .map((c) => `${HARNESS}/${c}`).find(existsSync) || null;
const REGISTRY = {
  identities: [
    { id: 'risk-lena', kind: 'human', groups: ['second-line'], roles: ['risk-second-line'] },
    { id: 'eng-omar', kind: 'human', groups: ['builders'], roles: ['engineering'] },
    { id: 'agent-loom', kind: 'agent', groups: ['builders'], roles: [] },
  ],
};
const identityOf = (r, id) => (r?.identities || []).find((i) => i.id === id);
const IDS = new Set(['CHG-1', 'CHG-2', 'CHG-3']);
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);

const TRAIN = (over = {}) => ({
  file: 'TRAIN-A.json',
  train: {
    train_id: 'TRAIN-A',
    release_commit: C1,
    changes: ['CHG-1', 'CHG-2'],
    bundle: 'docs/governance/evidence/manifest.json',
    sealed_at: '2026-07-27T18:00:00Z',
    released_by: 'risk-lena',
    ...over,
  },
});
const ev = (trains, opts = {}) => evaluateTrains(trains, { changeIds: IDS, registry: REGISTRY, identityOf, ...opts });

test('a well-formed train produces no findings', () => {
  assert.deepEqual(ev([TRAIN()]), []);
});

test('every required field is required', () => {
  for (const f of TRAIN_FIELDS) {
    const t = TRAIN();
    delete t.train[f];
    assert.ok(ev([t]).some((x) => x.includes(`missing ${f}`)), `${f} should be required`);
  }
});

test('a change belongs to at most ONE train', () => {
  const b = TRAIN({ train_id: 'TRAIN-B', release_commit: C2, changes: ['CHG-2', 'CHG-3'] });
  b.file = 'TRAIN-B.json';
  assert.ok(ev([TRAIN(), b]).some((f) => /change CHG-2 is also carried by train TRAIN-A/.test(f)));
});

test('one commit is one release', () => {
  const b = TRAIN({ train_id: 'TRAIN-B', changes: ['CHG-3'] });
  b.file = 'TRAIN-B.json';
  assert.ok(ev([TRAIN(), b]).some((f) => /is also claimed by train TRAIN-A — one commit is one release/.test(f)));
});

test('a duplicate train_id is refused', () => {
  const b = TRAIN({ release_commit: C2, changes: ['CHG-3'] });
  b.file = 'TRAIN-B.json';
  assert.ok(ev([TRAIN(), b]).some((f) => /duplicate train_id/.test(f)));
});

test('a train cannot enumerate a change nobody governed', () => {
  assert.ok(ev([TRAIN({ changes: ['CHG-1', 'CHG-999'] })]).some((f) => /CHG-999 is not a governed change/.test(f)));
});

test('with no changes tree, membership is NOT VERIFIED — reported, never passed quietly', () => {
  const notices = [];
  const findings = evaluateTrains([TRAIN()], { changeIds: null, registry: REGISTRY, identityOf, notices });
  assert.deepEqual(findings, []);
  assert.ok(notices.some((n) => /train membership is NOT VERIFIED/.test(n)));
});

test('a symbolic release_commit is not a commit', () => {
  assert.ok(ev([TRAIN({ release_commit: 'v2.4.0' })]).some((f) => /is not a 40-hex commit sha/.test(f)));
});

test('an empty enumeration is not an enumeration', () => {
  assert.ok(ev([TRAIN({ changes: [] })]).some((f) => /a train that enumerates nothing is not an enumeration/.test(f)));
});

test('only a second-line HUMAN releases a train', () => {
  for (const who of ['eng-omar', 'agent-loom', 'nobody']) {
    assert.ok(ev([TRAIN({ released_by: who })]).some((f) => /is not a second-line HUMAN identity/.test(f)), who);
  }
});

test('trainForCommit finds the train binding a commit, and nothing for an unbound one', () => {
  assert.equal(trainForCommit([TRAIN()], C1).train_id, 'TRAIN-A');
  assert.equal(trainForCommit([TRAIN()], C2), null);
  assert.equal(trainForCommit([TRAIN()], undefined), null);
});

test('the shipped worked example is a valid train against the bundled changes', { skip: TRAIN_EXAMPLE ? false : 'worked train is bundle-only — absent in an adopted layout' }, () => {
  const train = JSON.parse(readFileSync(TRAIN_EXAMPLE, 'utf8'));
  const ids = new Set(['CHG-2026-0042', 'CHG-2026-0055']);
  // The committed release_commit is a placeholder the release job stamps; everything ELSE about
  // the example must already be sound, or the fixture is teaching a shape that does not verify.
  const findings = evaluateTrains([{ file: 'train.json', train: { ...train, release_commit: C1 } }],
    { changeIds: ids, registry: REGISTRY, identityOf });
  assert.deepEqual(findings, []);
});
