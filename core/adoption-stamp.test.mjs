// Tests for the adoption stamp. Node runner: `node --test`.
//
// The property under test is not "the stamp records a version" — it is that an adopter's edit
// SURVIVES an upgrade. Three things have to hold together for that, and each is easy to get
// backwards, so each is pinned here rather than left to the installer's integration test:
//
//   1. Prerelease ORDER. rc.9 < rc.18. String comparison says otherwise, and a wrong answer here
//      shows a repository the wrong migration notes — or none.
//   2. The stamp records what WE INSTALLED, never what is on disk. Record the on-disk digest and
//      an edited file reads as unmodified on the next run and gets clobbered: the bug, disguised.
//   3. UNKNOWN is not SAFE. A pre-stamp repository must classify as unverifiable, never update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS, SCHEMA, classifyFile, compareVersions, emptyStamp, isSafeToWrite, nextStamp, notesBetween, parseVersion,
} from './adoption-stamp.mjs';

// --- 1 · version precedence ------------------------------------------------------------------

test('prerelease identifiers compare NUMERICALLY — rc.9 is older than rc.18', () => {
  // The bug a string comparison produces: '2.0.0-rc.18' < '2.0.0-rc.9' lexically.
  assert.equal(compareVersions('2.0.0-rc.9', '2.0.0-rc.18'), -1);
  assert.equal(compareVersions('2.0.0-rc.18', '2.0.0-rc.9'), 1);
  assert.ok('2.0.0-rc.18' < '2.0.0-rc.9', 'string order really is backwards — that is why this test exists');
});

test('version precedence across the real release line', () => {
  const line = ['1.11.0', '1.12.0', '2.0.0-rc.1', '2.0.0-rc.2', '2.0.0-rc.9', '2.0.0-rc.13', '2.0.0-rc.18', '2.0.0'];
  for (let i = 1; i < line.length; i++) {
    assert.equal(compareVersions(line[i - 1], line[i]), -1, `${line[i - 1]} should precede ${line[i]}`);
  }
  assert.equal(compareVersions('2.0.0-rc.18', '2.0.0-rc.18'), 0);
});

test('a release outranks its own prereleases', () => {
  assert.equal(compareVersions('2.0.0', '2.0.0-rc.18'), 1);
  assert.equal(compareVersions('2.0.0-rc.18', '2.0.0'), -1);
});

test('an unparseable version is null, never an assumed order', () => {
  assert.equal(parseVersion('not-a-version'), null);
  assert.equal(compareVersions('2.0.0', 'garbage'), null);
  assert.equal(compareVersions(undefined, '2.0.0'), null);
});

// --- 2 · classification ----------------------------------------------------------------------

const cls = (stampDigest, currentDigest, sourceDigest) => classifyFile({ stampDigest, currentDigest, sourceDigest });

test('an untouched file updates; an edited file is a local edit', () => {
  // installed 'a', still 'a' on disk, bundle now ships 'b' → safe to update
  assert.equal(cls('a', 'a', 'b'), CLASS.UPDATE);
  // installed 'a', disk says 'x' (the adopter edited it), bundle ships 'b' → theirs
  assert.equal(cls('a', 'x', 'b'), CLASS.LOCAL_EDIT);
});

test('a missing file is new, and a converged file is already-current', () => {
  assert.equal(cls(undefined, null, 'b'), CLASS.NEW);
  assert.equal(cls('a', 'b', 'b'), CLASS.CURRENT); // however it got there, there is nothing to do
});

test('UNSTAMPED IS NOT UNMODIFIED — a pre-stamp repo classifies unverifiable, never update', () => {
  assert.equal(cls(undefined, 'x', 'b'), CLASS.UNVERIFIABLE);
  assert.equal(cls(null, 'x', 'b'), CLASS.UNVERIFIABLE);
});

test('only the three harmless classes are writable — unverifiable and local-edit are not', () => {
  assert.ok(isSafeToWrite(CLASS.NEW) && isSafeToWrite(CLASS.CURRENT) && isSafeToWrite(CLASS.UPDATE));
  assert.equal(isSafeToWrite(CLASS.LOCAL_EDIT), false);
  assert.equal(isSafeToWrite(CLASS.UNVERIFIABLE), false, 'writing on "I cannot tell" is the data-loss bug');
});

// --- 3 · the stamp records what we installed --------------------------------------------------

test('a preserved file keeps its OLD stamp entry, so it stays flagged as the adopter\'s', () => {
  // The inversion this guards: if a preserved file were stamped with its on-disk (edited)
  // digest, the NEXT run would classify it UPDATE and overwrite the very edit just preserved.
  const previous = { ...emptyStamp(), bundle_version: '2.0.0-rc.17', files: { 'scripts/a.mjs': 'installed-digest' } };
  const stamp = nextStamp({ previous, version: '2.0.0-rc.18', installed: {}, manifestDigest: 'm', now: 'T1' });
  assert.equal(stamp.files['scripts/a.mjs'], 'installed-digest');
  // and it still classifies as the adopter's next time round
  assert.equal(cls(stamp.files['scripts/a.mjs'], 'edited-digest', 'new-source'), CLASS.LOCAL_EDIT);
});

test('a written file is stamped with the SOURCE digest', () => {
  const stamp = nextStamp({ version: '2.0.0-rc.18', installed: { 'scripts/a.mjs': 'src' }, manifestDigest: 'm', now: 'T1' });
  assert.equal(stamp.files['scripts/a.mjs'], 'src');
  assert.equal(cls('src', 'src', 'src'), CLASS.CURRENT);
});

test('first adoption sets first_adopted_at and starts the history', () => {
  const s = nextStamp({ version: '2.0.0-rc.18', installed: {}, manifestDigest: 'm', now: 'T1' });
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.first_adopted_at, 'T1');
  assert.deepEqual(s.history, [{ version: '2.0.0-rc.18', at: 'T1' }]);
});

test('first_adopted_at survives upgrades; history appends only on a version change', () => {
  const a = nextStamp({ version: '2.0.0-rc.17', installed: {}, manifestDigest: 'm', now: 'T1' });
  const reRun = nextStamp({ previous: a, version: '2.0.0-rc.17', installed: {}, manifestDigest: 'm', now: 'T2' });
  assert.equal(reRun.history.length, 1, 're-running the same version is not an upgrade');
  assert.equal(reRun.updated_at, 'T2');
  const up = nextStamp({ previous: reRun, version: '2.0.0-rc.18', installed: {}, manifestDigest: 'm', now: 'T3' });
  assert.equal(up.first_adopted_at, 'T1');
  assert.deepEqual(up.history.map((h) => h.version), ['2.0.0-rc.17', '2.0.0-rc.18']);
});

test('a stamp whose version and history disagree does not log the same version twice', () => {
  // Only reachable via a hand-edited stamp, but a trail that lies is worse than no trail.
  const drifted = { ...emptyStamp(), bundle_version: '2.0.0-rc.14', history: [{ version: '2.0.0-rc.18', at: 'T0' }] };
  const s = nextStamp({ previous: drifted, version: '2.0.0-rc.18', installed: {}, manifestDigest: 'm', now: 'T1' });
  assert.deepEqual(s.history.map((h) => h.version), ['2.0.0-rc.18']);
});

test('history is a trail, not an unbounded ledger', () => {
  let s = emptyStamp();
  for (let i = 0; i < 80; i++) s = nextStamp({ previous: s, version: `1.0.${i}`, installed: {}, manifestDigest: 'm', now: `T${i}` });
  assert.equal(s.history.length, 50);
  assert.equal(s.history.at(-1).version, '1.0.79');
});

// --- 4 · migration note selection --------------------------------------------------------------

const NOTES = {
  versions: [
    { version: '2.0.0-rc.9', headline: 'nine' },
    { version: '2.0.0-rc.13', headline: 'thirteen' },
    { version: '2.0.0-rc.18', headline: 'eighteen' },
  ],
};

test('notes are those AFTER the installed version, up to and including this one', () => {
  assert.deepEqual(notesBetween(NOTES, '2.0.0-rc.9', '2.0.0-rc.18').map((n) => n.version), ['2.0.0-rc.13', '2.0.0-rc.18']);
  assert.deepEqual(notesBetween(NOTES, '2.0.0-rc.13', '2.0.0-rc.18').map((n) => n.version), ['2.0.0-rc.18']);
  assert.deepEqual(notesBetween(NOTES, '2.0.0-rc.18', '2.0.0-rc.18'), []);
});

test('a first adoption replays nothing — there is no catching up to do', () => {
  assert.deepEqual(notesBetween(NOTES, null, '2.0.0-rc.18'), []);
  assert.deepEqual(notesBetween(NOTES, undefined, '2.0.0-rc.18'), []);
});

test('notes come back in version order even when the file is not sorted', () => {
  const jumbled = { versions: [...NOTES.versions].reverse() };
  assert.deepEqual(notesBetween(jumbled, '2.0.0-rc.1', '2.0.0-rc.18').map((n) => n.version), ['2.0.0-rc.9', '2.0.0-rc.13', '2.0.0-rc.18']);
});

test('a malformed notes file yields nothing rather than throwing mid-install', () => {
  assert.deepEqual(notesBetween(null, '2.0.0-rc.1', '2.0.0-rc.18'), []);
  assert.deepEqual(notesBetween({}, '2.0.0-rc.1', '2.0.0-rc.18'), []);
});

// --- 5 · the shipped notes file is well-formed --------------------------------------------------

// upgrade-notes.json is BUNDLE-ONLY: adopt.mjs reads it from the bundle it is upgrading FROM, so
// an adopted repo has no copy and nothing to validate. Same "inert where the bundle is absent"
// pattern as scripts/adopt.test.mjs and the doc-integrity gate.
const NOTES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'upgrade-notes.json');

test('every shipped upgrade note has a parseable version, in ascending order', { skip: !existsSync(NOTES_PATH) && 'bundle-only' }, () => {
  const notes = JSON.parse(readFileSync(NOTES_PATH, 'utf8'));
  assert.ok(notes.versions.length > 0);
  for (const n of notes.versions) {
    assert.ok(parseVersion(n.version), `unparseable version ${n.version}`);
    assert.ok(n.headline && n.headline.trim(), `${n.version} has no headline`);
    assert.ok(Array.isArray(n.notes), `${n.version} notes must be an array`);
    assert.ok(Array.isArray(n.action_required), `${n.version} action_required must be an array (empty is fine)`);
  }
  for (let i = 1; i < notes.versions.length; i++) {
    assert.equal(compareVersions(notes.versions[i - 1].version, notes.versions[i].version), -1, 'notes must be in ascending version order');
  }
});
