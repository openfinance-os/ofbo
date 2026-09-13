// Tests for the discovery-sync gate. Node runner: `node --test`.
//
// What is pinned here is mostly RESTRAINT, because the failure mode of a sync tool is not that it
// crashes — it is that it implies agreement it has not checked. The ledger records one side. Every
// assertion below exists to stop the other side being inferred:
//
//   · a null `upstream` digest is never read as "in sync"
//   · the never-reconciled notice is printed on a CLEAN run, not only a dirty one
//   · only compareUpstream() — which has actually seen the other tree — produces a verdict about it
//   · a file added here is a divergence by definition, and says so
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  LEDGER, STATE, checkClaims, evaluate, compareUpstream, reconcile, record, trackedFiles,
} from './discovery-sync-check.mjs';

/** A ledger with the given per-file states, digests keyed 'd:<path>' unless overridden. */
const ledgerOf = (files, upstream = {}) => ({
  upstream: { repo: 'openfinance-os/ofbo', last_reconciled: null, ...upstream },
  files: Object.fromEntries(Object.entries(files).map(([p, s]) => [p, { base: `d:${p}`, bundle: `d:${p}`, upstream: null, state: s }])),
});
const disk = (...paths) => Object.fromEntries(paths.map((p) => [p, `d:${p}`]));

test('a tree matching its ledger passes, and still reports the debt', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/b.mjs': STATE.OWED });
  const { findings, debt, total } = evaluate(l, disk('discovery/a.mjs', 'discovery/b.mjs'));
  assert.deepEqual(findings, [], 'a declared debt is not a failure — the port lands in another repo');
  assert.deepEqual(debt, ['discovery/b.mjs']);
  assert.equal(total, 2);
});

test('an UNDECLARED change fails — this is the drift the gate exists to stop', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION });
  const { findings } = evaluate(l, { 'discovery/a.mjs': 'd:CHANGED' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /differs from the digest recorded/);
  assert.match(findings[0], /--record/, 'the finding says what to do');
});

test('a change already declared owed does NOT fail again', () => {
  // Once the debt is on the books the file is expected to differ from upstream; nagging about it
  // every build would train people to ignore the gate.
  const l = ledgerOf({ 'discovery/a.mjs': STATE.OWED });
  l.files['discovery/a.mjs'].bundle = 'd:CHANGED';
  assert.deepEqual(evaluate(l, { 'discovery/a.mjs': 'd:CHANGED' }).findings, []);
});

test('a file added here with no ledger entry fails — a new file IS a divergence', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION });
  const { findings } = evaluate(l, disk('discovery/a.mjs', 'discovery/new.mjs'));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /discovery\/new\.mjs.*absent from discovery-sync\.json/s);
});

test('a ledger entry with no file fails', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/gone.mjs': STATE.EXTRACTION });
  const { findings } = evaluate(l, disk('discovery/a.mjs'));
  assert.match(findings[0], /no longer on disk/);
});

// ── The honesty rules ───────────────────────────────────────────────────────────────────────

test('the never-reconciled limit is printed on a CLEAN run, not just a dirty one', () => {
  const { findings, notices } = evaluate(ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION }), disk('discovery/a.mjs'));
  assert.deepEqual(findings, [], 'this run is clean');
  assert.match(notices[0], /NOT VERIFIED/, 'and the limit is still the first thing said');
  assert.match(notices[0], /Nothing here asserts the two agree/);
});

test('at-extraction is never reported as agreement with upstream', () => {
  // The whole tree untouched since extraction is the most flattering possible state. It must STILL
  // say the comparison was never made — otherwise a green tick means "in sync", which is unearned.
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/b.mjs': STATE.EXTRACTION });
  const { notices, debt } = evaluate(l, disk('discovery/a.mjs', 'discovery/b.mjs'));
  assert.deepEqual(debt, []);
  assert.ok(notices.some((n) => /NOT VERIFIED/.test(n)));
  assert.ok(!notices.some((n) => /in sync|agree(?!$)/i.test(n.replace(/Nothing here asserts the two agree.*/, ''))));
});

test('once reconciled, the notice states the date AND that upstream may have moved since', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.RECONCILED }, { last_reconciled: '2026-08-01', last_reconciled_ref: 'abc1234' });
  const { notices } = evaluate(l, disk('discovery/a.mjs'));
  assert.match(notices[0], /Last reconciled.*2026-08-01.*abc1234/);
  assert.match(notices[0], /not knowable from here/);
});

// ── The three-way comparison — the only thing that may judge upstream ────────────────────────

test('compareUpstream separates bundle-ahead from upstream-ahead from a real merge', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/b.mjs': STATE.EXTRACTION, 'discovery/c.mjs': STATE.EXTRACTION });
  const rows = compareUpstream(
    l,
    { 'discovery/a.mjs': 'd:CHANGED', 'discovery/b.mjs': 'd:discovery/b.mjs', 'discovery/c.mjs': 'd:MINE' },
    { 'discovery/a.mjs': 'd:discovery/a.mjs', 'discovery/b.mjs': 'd:THEIRS', 'discovery/c.mjs': 'd:THEIRS' },
  );
  const v = Object.fromEntries(rows.map((r) => [r.path, r.verdict]));
  assert.equal(v['discovery/a.mjs'], 'bundle-ahead', 'we moved, they did not → back-port');
  assert.equal(v['discovery/b.mjs'], 'upstream-ahead', 'they moved, we did not → forward-port');
  assert.equal(v['discovery/c.mjs'], 'both-changed', 'both moved → a merge, and it must not be called a copy');
});

test('REGRESSION: an owed file we hardened is bundle-ahead, never upstream-ahead', () => {
  // The inversion this test exists for: `base` is the shared ancestor, `bundle` is merely what we
  // looked like at the last --record. For a file already carrying a debt those differ, and reading
  // `bundle` as the ancestor flips the verdict — it tells you to FORWARD-port, which would overwrite
  // the hardening with the exact content it replaced. Upstream is still sitting at base here.
  const l = ledgerOf({ 'discovery/gates/validate.mjs': STATE.OWED });
  l.files['discovery/gates/validate.mjs'].bundle = 'd:HARDENED'; // --record moved bundle, not base
  const [row] = compareUpstream(
    l,
    { 'discovery/gates/validate.mjs': 'd:HARDENED' },
    { 'discovery/gates/validate.mjs': 'd:discovery/gates/validate.mjs' },
  );
  assert.equal(row.verdict, 'bundle-ahead');
  assert.match(row.detail, /back-port/);
});

test('a file both sides have with no shared ancestor is never called a copy either way', () => {
  const l = ledgerOf({ 'discovery/x.mjs': STATE.BUNDLE_ONLY });
  l.files['discovery/x.mjs'].base = null; // added here; ofbo later grew its own
  const [row] = compareUpstream(l, { 'discovery/x.mjs': 'd:MINE' }, { 'discovery/x.mjs': 'd:THEIRS' });
  assert.equal(row.verdict, 'no-shared-base');
  assert.match(row.detail, /do not copy either way/);
});

test('compareUpstream reports identical, and files present on only one side', () => {
  const l = ledgerOf({ 'discovery/same.mjs': STATE.EXTRACTION, 'discovery/mine.mjs': STATE.BUNDLE_ONLY });
  const rows = compareUpstream(
    l,
    disk('discovery/same.mjs', 'discovery/mine.mjs'),
    { 'discovery/same.mjs': 'd:discovery/same.mjs', 'discovery/theirs.mjs': 'd:x' },
  );
  const v = Object.fromEntries(rows.map((r) => [r.path, r.verdict]));
  assert.equal(v['discovery/same.mjs'], 'identical');
  assert.equal(v['discovery/mine.mjs'], 'missing-upstream');
  assert.equal(v['discovery/theirs.mjs'], 'missing-here');
});

// ── record() ────────────────────────────────────────────────────────────────────────────────

test('record flips a changed file to owed, keeps its history, and adopts new files as bundle-only', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/b.mjs': STATE.EXTRACTION });
  const out = record(l, { 'discovery/a.mjs': 'd:CHANGED', 'discovery/b.mjs': 'd:discovery/b.mjs', 'discovery/new.mjs': 'd:n' }, { now: '2026-08-02' });
  assert.equal(out.files['discovery/a.mjs'].state, STATE.OWED);
  assert.equal(out.files['discovery/a.mjs'].bundle, 'd:CHANGED');
  assert.match(out.files['discovery/a.mjs'].note, /git log -- discovery\/a\.mjs/, 'the note points at the change itself');
  assert.equal(out.files['discovery/b.mjs'].state, STATE.EXTRACTION, 'an untouched file is left alone');
  assert.equal(out.files['discovery/new.mjs'].state, STATE.BUNDLE_ONLY);
});

test('record NEVER invents an upstream digest, and NEVER moves the shared base', () => {
  // The two things --record must not do: it has not seen ofbo, so it may not write anything about
  // it — and moving `base` would erase the very debt it is booking, leaving the next three-way
  // comparison with no ancestor to reason from.
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION });
  const out = record(l, { 'discovery/a.mjs': 'd:CHANGED', 'discovery/new.mjs': 'd:n' }, { now: '2026-08-02' });
  for (const e of Object.values(out.files)) assert.equal(e.upstream, null);
  assert.equal(out.files['discovery/a.mjs'].base, 'd:discovery/a.mjs', 'base is the ancestor, not the latest content');
  assert.equal(out.files['discovery/new.mjs'].base, null, 'a file added here has no shared ancestor');
});

test('record drops entries whose files are gone', () => {
  const out = record(ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION, 'discovery/gone.mjs': STATE.OWED }), disk('discovery/a.mjs'), { now: '2026-08-02' });
  assert.ok(!('discovery/gone.mjs' in out.files));
});

// ── checkClaims: the ledger may not assert more than it has seen ────────────────────────────

test('an upstream digest with no recorded reconciliation is a fabrication and fails', () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION });
  l.files['discovery/a.mjs'].upstream = 'd:INVENTED';
  assert.match(checkClaims(l)[0], /nobody has seen ofbo, so that digest was invented/);
});

test('a seen-only state with no recorded reconciliation fails', () => {
  for (const s of [STATE.RECONCILED, STATE.BEHIND, STATE.DIVERGED]) {
    const l = ledgerOf({ 'discovery/a.mjs': s });
    assert.ok(checkClaims(l).some((f) => /asserts a comparison against ofbo that the ledger says never happened/.test(f)), s);
  }
});

test("'reconciled' with digests that do not actually agree fails", () => {
  const l = ledgerOf({ 'discovery/a.mjs': STATE.RECONCILED }, { last_reconciled: '2026-08-01' });
  l.files['discovery/a.mjs'].upstream = 'd:DIFFERENT';
  assert.match(checkClaims(l).find((f) => /all three digests agree/.test(f)), /all three digests agree/);
});

test('THE RULE IS CONDITIONAL: a real reconciliation is allowed, not frozen out', () => {
  // The regression this exists for. A ledger that HAS been reconciled may carry upstream digests
  // and seen-only states — otherwise doing the right thing breaks the build.
  const l = ledgerOf({ 'discovery/a.mjs': STATE.RECONCILED, 'discovery/b.mjs': STATE.BEHIND }, { last_reconciled: '2026-08-01', last_reconciled_ref: 'abc1234' });
  l.files['discovery/a.mjs'].upstream = 'd:discovery/a.mjs';
  l.files['discovery/b.mjs'].upstream = 'd:THEIRS';
  assert.deepEqual(checkClaims(l), []);
});

// ── reconcile(): the only thing entitled to write about ofbo ────────────────────────────────

test('reconcile records what was seen, and a stamp does not mean everything agreed', () => {
  const l = ledgerOf({
    'discovery/same.mjs': STATE.EXTRACTION,
    'discovery/ours.mjs': STATE.OWED,
    'discovery/theirs.mjs': STATE.EXTRACTION,
  });
  l.files['discovery/ours.mjs'].bundle = 'd:HARDENED'; // we are ahead; base still the ancestor
  const out = reconcile(
    l,
    // here: same unchanged · ours hardened · theirs still at the ancestor
    { 'discovery/same.mjs': 'd:discovery/same.mjs', 'discovery/ours.mjs': 'd:HARDENED', 'discovery/theirs.mjs': 'd:discovery/theirs.mjs' },
    // upstream: same agrees · ours still at the ancestor · theirs moved on
    { 'discovery/same.mjs': 'd:discovery/same.mjs', 'discovery/ours.mjs': 'd:discovery/ours.mjs', 'discovery/theirs.mjs': 'd:MOVED' },
    { now: '2026-08-01', ref: 'abc1234' },
  );
  assert.equal(out.upstream.last_reconciled, '2026-08-01');
  assert.equal(out.files['discovery/same.mjs'].state, STATE.RECONCILED);
  assert.equal(out.files['discovery/ours.mjs'].state, STATE.OWED, 'we are ahead — the debt survives the stamp');
  assert.equal(out.files['discovery/theirs.mjs'].state, STATE.BEHIND, 'they are ahead — forward-port');
  assert.deepEqual(checkClaims(out), [], 'and the result is internally consistent');
});

test('reconcile moves the shared base ONLY on files that actually agree', () => {
  const l = ledgerOf({ 'discovery/ours.mjs': STATE.OWED });
  l.files['discovery/ours.mjs'].bundle = 'd:HARDENED';
  const out = reconcile(l, { 'discovery/ours.mjs': 'd:HARDENED' }, { 'discovery/ours.mjs': 'd:discovery/ours.mjs' }, { now: '2026-08-01' });
  assert.equal(out.files['discovery/ours.mjs'].base, 'd:discovery/ours.mjs', 'base stays at the ancestor — moving it declares an unpaid debt paid');
  assert.equal(out.files['discovery/ours.mjs'].upstream, 'd:discovery/ours.mjs', 'but what upstream holds is now real evidence');
});

test('reconcile does not adopt upstream-only files into this tree', () => {
  // The ledger tracks OUR tree. compareUpstream still reports missing-here, so it stays visible.
  const l = ledgerOf({ 'discovery/a.mjs': STATE.EXTRACTION });
  const out = reconcile(l, disk('discovery/a.mjs'), { 'discovery/a.mjs': 'd:discovery/a.mjs', 'discovery/theirs.mjs': 'd:x' }, { now: '2026-08-01' });
  assert.ok(!('discovery/theirs.mjs' in out.files));
});

// ── The shipped ledger is the contract ──────────────────────────────────────────────────────
//
// Bundle-only (never installed — it is provenance for this bundle), so skip in an adopted layout.

if (!existsSync(LEDGER)) {
  test('discovery-sync ledger (bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
  test('the shipped ledger covers the real tree exactly, and its digests are current', () => {
    const l = JSON.parse(readFileSync(LEDGER, 'utf8'));
    const { findings } = evaluate(l, Object.fromEntries(trackedFiles().map((p) => [p, l.files[p] && l.files[p].bundle])));
    assert.deepEqual(findings, [], 'every tracked file is recorded and every record has a file');
  });

  test('the shipped ledger asserts no more than it has seen', () => {
    // NOT `last_reconciled === null`. That was the original assertion and it was a booby trap: it
    // froze today's state as an invariant, so a real reconciliation would turn the build red and
    // the only fix would be deleting the check. The rule is conditional — see checkClaims.
    assert.deepEqual(checkClaims(JSON.parse(readFileSync(LEDGER, 'utf8'))), []);
  });

  test('the shipped ledger states agree with its own digests', () => {
    // The states were derived from `git log`; the digests from file content. They are independent
    // evidence for the same claim, so they must agree — if they ever disagree, one of them is a
    // story rather than a measurement.
    const l = JSON.parse(readFileSync(LEDGER, 'utf8'));
    for (const [p, e] of Object.entries(l.files)) {
      if (e.state === STATE.EXTRACTION) assert.equal(e.base, e.bundle, `${p}: unchanged since extraction, so base must equal bundle`);
      if (e.state === STATE.OWED) assert.notEqual(e.base, e.bundle, `${p}: owed means it CHANGED, so base must differ from bundle`);
      if (e.state === STATE.BUNDLE_ONLY) assert.equal(e.base, null, `${p}: never existed upstream, so there is no shared ancestor`);
    }
  });
}
