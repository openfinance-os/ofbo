// Tests for pre-approved change patterns (rc.38 · flow-plan Phase 4.3). Node built-in runner.
//
// The point of every case below is the same: a pattern is a RE-PRICING of approval, and the only
// thing that makes that safe is that each of its conditions fails CLOSED. So each test breaks one
// condition and asserts the change loses coverage — never that it merely warns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PATTERN_DIFF_LINES, collectPatterns, evaluateClaim, evaluatePattern, globMatch } from './change-patterns.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-07-28T00:00:00Z');

const REGISTRY = {
  identities: [
    { id: 'risk-lena', kind: 'human', groups: ['second-line'], roles: ['risk-second-line'] },
    { id: 'eng-omar', kind: 'human', groups: ['builders'], roles: ['engineering'] },
    { id: 'po-fatima', kind: 'human', groups: [], roles: ['product-owner'] },
    { id: 'agent-loom', kind: 'agent', groups: ['builders'], roles: [] },
  ],
};
const identityOf = (r, id) => (r?.identities || []).find((i) => i.id === id);

const PATTERN = () => ({
  pattern_id: 'dependency-patch',
  matcher: { paths: ['package-lock.json', 'services/**/package-lock.json'], max_diff_lines: 60 },
  pre_compiled_plan_hash: 'a'.repeat(64),
  approved_by: 'risk-lena',
  expires: '2030-01-01',
  sampling_rate: 0.1,
});
const PLAN = () => ({ plan_hash: 'a'.repeat(64) });
const ENVELOPE = () => ({
  change_id: 'CHG-1',
  change_class: 'standard',
  pattern_claim: {
    pattern_id: 'dependency-patch',
    changed_paths: ['package-lock.json'],
    diff_lines: 12,
    sampling: { enrolled: true, rate: 0.1, selected: false },
  },
});
const entry = (pattern = PATTERN()) => ({ pattern, profile: 'regulated-bank' });
const claim = (env = ENVELOPE(), ent = entry(), opts = {}) =>
  evaluateClaim(env, ent, { plan: PLAN(), registry: REGISTRY, identityOf, now: NOW, ...opts });

test('globMatch is anchored at both ends — a prefix is not a match', () => {
  assert.ok(globMatch('package-lock.json', 'package-lock.json'));
  assert.ok(!globMatch('lock', 'package-lock.json'));
  assert.ok(!globMatch('package-lock.json', 'vendor/package-lock.json'));
});

test('* does not cross a directory separator; ** does', () => {
  assert.ok(globMatch('services/*/package.json', 'services/a/package.json'));
  assert.ok(!globMatch('services/*/package.json', 'services/a/b/package.json'));
  assert.ok(globMatch('services/**/package.json', 'services/a/b/package.json'));
  // `**/` must also match ZERO directories, or `services/**/x` silently excludes `services/x`.
  assert.ok(globMatch('services/**/package.json', 'services/package.json'));
});

test('a regex metacharacter in a glob is a literal, not a wildcard', () => {
  assert.ok(globMatch('a.b.json', 'a.b.json'));
  assert.ok(!globMatch('a.b.json', 'axbxjson'));
});

test('the happy path: a matching claim is COVERED and says which pattern covered it', () => {
  const res = claim();
  assert.deepEqual(res.findings, []);
  assert.equal(res.covered, true);
  assert.ok(res.notices.some((n) => /rides PRE-APPROVED pattern dependency-patch/.test(n)));
});

test('an EXPIRED pattern covers nothing', () => {
  const p = PATTERN();
  p.expires = '2026-01-01';
  const res = claim(ENVELOPE(), entry(p));
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /EXPIRED 2026-01-01/.test(f)));
});

test('a BUILDER cannot approve a pattern', () => {
  const p = PATTERN();
  p.approved_by = 'eng-omar';
  const res = claim(ENVELOPE(), entry(p));
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /is in the builders group — a builder cannot approve a pattern/.test(f)));
  assert.ok(res.findings.some((f) => /not a second-line identity/.test(f)));
});

test('an AGENT cannot approve a pattern', () => {
  const p = PATTERN();
  p.approved_by = 'agent-loom';
  assert.ok(claim(ENVELOPE(), entry(p)).findings.some((f) => /is an agent — agents build, they never approve/.test(f)));
});

test('a matcher MISS on path falls back to the full route', () => {
  const e = ENVELOPE();
  e.pattern_claim.changed_paths = ['package-lock.json', 'src/pricing/engine.ts'];
  const res = claim(e);
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /"src\/pricing\/engine.ts" is outside the pattern matcher/.test(f)));
});

test('a claim over the size ceiling falls back to the full route', () => {
  const e = ENVELOPE();
  e.pattern_claim.diff_lines = 61;
  const res = claim(e);
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /exceeds the pattern's ceiling of 60/.test(f)));
});

test('a pattern whose own ceiling exceeds the shipped maximum is refused', () => {
  const p = PATTERN();
  p.matcher.max_diff_lines = MAX_PATTERN_DIFF_LINES + 1;
  assert.ok(evaluatePattern(p, { now: NOW }).some((f) => /exceeds the shipped ceiling/.test(f)));
});

test('a pattern matching everything is refused — an empty matcher pre-approves the repository', () => {
  const p = PATTERN();
  p.matcher.paths = [];
  assert.ok(evaluatePattern(p, { now: NOW }).some((f) => /matcher.paths must be a non-empty array/.test(f)));
});

test('THE load-bearing check: a change compiling a different plan is NOT pre-approved', () => {
  const res = evaluateClaim(ENVELOPE(), entry(), { plan: { plan_hash: 'b'.repeat(64) }, registry: REGISTRY, identityOf, now: NOW });
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /the pre-approval covers a DIFFERENT route/.test(f)));
});

test('riding a pattern IS enrolling in its sample — an unenrolled claim is refused', () => {
  const e = ENVELOPE();
  e.pattern_claim.sampling.enrolled = false;
  assert.ok(claim(e).findings.some((f) => /sampling.enrolled must be true/.test(f)));
  const e2 = ENVELOPE();
  delete e2.pattern_claim.sampling;
  assert.ok(claim(e2).findings.some((f) => /pattern_claim.sampling missing/.test(f)));
});

test('the enrolment must record the rate ACTUALLY in force, not a rate of its choosing', () => {
  const e = ENVELOPE();
  e.pattern_claim.sampling.rate = 0.01;
  assert.ok(claim(e).findings.some((f) => /is not the pattern's declared 0.1/.test(f)));
});

test('a SELECTED sample owes a completed second-line review', () => {
  const e = ENVELOPE();
  e.pattern_claim.sampling.selected = true;
  assert.ok(claim(e).findings.some((f) => /a sample nobody reviews is a sample nobody took/.test(f)));
  e.pattern_claim.sampling.reviewed_by = 'eng-omar';
  e.pattern_claim.sampling.reviewed_at = '2026-07-26';
  assert.ok(claim(e).findings.some((f) => /is not a second-line human/.test(f)));
  e.pattern_claim.sampling.reviewed_by = 'risk-lena';
  assert.deepEqual(claim(e).findings, []);
});

test('an unresolvable pattern id pre-approves nothing', () => {
  const res = evaluateClaim(ENVELOPE(), null, { plan: PLAN(), registry: REGISTRY, identityOf, now: NOW });
  assert.equal(res.covered, false);
  assert.ok(res.findings.some((f) => /which no profile in required_profiles declares/.test(f)));
});

test('two profiles declaring one pattern_id is a finding, not a silent merge', () => {
  const a = { profile: 'regulated-bank', patterns: [PATTERN()] };
  const b = { profile: 'lending', patterns: [{ ...PATTERN(), matcher: { paths: ['**'], max_diff_lines: 9999 } }] };
  const { patterns, findings } = collectPatterns([a, b]);
  assert.equal(patterns.size, 1);
  assert.ok(findings.some((f) => /declared by BOTH regulated-bank and lending/.test(f)));
});

test('with no diff the claim is NOT VERIFIED out loud, and with one it is reconciled', () => {
  const quiet = claim();
  assert.ok(quiet.notices.some((n) => /SELF-DECLARED and NOT VERIFIED/.test(n)));

  const good = claim(ENVELOPE(), entry(), { diff: { paths: ['package-lock.json'], lines: 12 } });
  assert.deepEqual(good.findings, []);
  assert.ok(!good.notices.some((n) => /NOT VERIFIED/.test(n)));

  const undeclared = claim(ENVELOPE(), entry(), { diff: { paths: ['package-lock.json', 'src/secret.ts'], lines: 12 } });
  assert.ok(undeclared.findings.some((f) => /the claim is not the change/.test(f)));

  const understated = claim(ENVELOPE(), entry(), { diff: { paths: ['package-lock.json'], lines: 400 } });
  assert.ok(understated.findings.some((f) => /declares 12 changed lines but the diff has 400/.test(f)));
});

test('the SHIPPED pattern in profiles/regulated-bank.json is itself well-formed and live', () => {
  const profile = JSON.parse(readFileSync(`${HARNESS}/profiles/regulated-bank.json`, 'utf8'));
  const { patterns, findings } = collectPatterns([profile]);
  assert.deepEqual(findings, []);
  assert.ok(patterns.size >= 1, 'the base profile should ship the worked-example pattern');
  for (const [id, e] of patterns) {
    assert.deepEqual(evaluatePattern(e.pattern, { profile: 'regulated-bank', registry: REGISTRY, identityOf, now: Date.now() }), [], `shipped pattern ${id}`);
  }
});
