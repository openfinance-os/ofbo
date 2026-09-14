// Q1b — the test-integrity gate (anti-reward-hacking). An agent under pressure to go green
// has two moves: fix the code, or weaken the test. The test-tripwire hook blocks the second
// move at edit time; this gate is the CI half — it diffs the test surface against the merge
// base and fails when the tests got weaker on the way to green:
//
//   Deleted test files · net assertion loss · added skip/only/todo/expected-failure markers ·
//   newly commented-out assertions.
//
// The approved test-change process (delivery-harness.md): a genuine test defect is fixed in
// the open on a dedicated `-testfix-` branch — on such a branch the findings are reported as
// notices and the gate passes, so the escape hatch is visible, never silent.
//
// Run from the repo root of a git checkout: `node scripts/test-integrity-check.mjs
// [--base <ref>]` (default: merge-base with origin/main, then main). Exit 1 on findings,
// exit 2 when there is no git history to diff against — unverifiable is not a pass.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// ADOPT: what counts as a test file, and what counts as an assertion, in your stack.
export const TEST_FILE = /(\.|_|\/)(test|spec)s?\.[cm]?[jt]sx?$|(^|\/)tests?\//i;
export const ASSERTION = /\bassert\s*[.(]|\bexpect\s*\(|\.should\b|\bt\.(is|deepEqual|truthy|falsy|throws)\b/g;
// 2.1.0 — the spellings the old line missed: bracket access, x-/f-prefixed cases, the node:test /
// vitest options object, and the Python / Go / JVM decorators.
export const WEAKENER = /\.\s*(skip|only|todo|failing|fails)\s*\(|\b(it|test|describe|context)\s*\[\s*["'](skip|only|todo)["']\s*\]|\b(xit|xdescribe|xtest|xcontext|fit|fdescribe|ftest)\s*\(|\{\s*(skip|todo|only)\s*:\s*(true|["'])|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bpytest\.skip\s*\(|\bt\.(Skip|SkipNow)\s*\(|@Disabled\b|@Ignore\b/g;
export const COMMENTED_ASSERTION = /^[ \t]*(\/\/|#|--).*(\bassert\s*[.(]|\bexpect\s*\()/gm;
// A block comment wrapping an expectation — the multi-line form the line regex cannot see.
export const BLOCK_COMMENTED_ASSERTION = /\/\*(?:[^*]|\*+[^*/])*\b(?:expect|assert)\s*\(/g;
// An assertion that cannot fail: it keeps the count this gate compares while proving nothing.
export const TAUTOLOGY = /\bexpect\s*\(\s*(?:true|1|!0)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|toBeTruthy)\s*\(\s*(?:true|1)?\s*\)|\bassert(?:\.ok|\.equal|\.strictEqual)?\s*\(\s*(?:true|1)\s*(?:,\s*(?:true|1)\s*)?\)|^[ \t]*assert\s+True\b/gm;
// A test CASE, so an emptied file (still present, no cases left) is caught even when its
// assertions were never counted as lost by the deletion rule.
export const TEST_CASE = /\b(?:it|test|specify)\s*(?:\.\s*\w+\s*)?\(|^\s*def\s+test_|^\s*func\s+Test[A-Z]|@Test\b/gm;

const count = (text, re) => (text.match(new RegExp(re.source, re.flags)) || []).length;

/**
 * Findings, given the test surface before and after (Map of path → content).
 * Empty ⇒ the tests did not get weaker.
 */
export function evaluate(baseFiles, headFiles) {
  const findings = [];
  // Real assertions: the raw count minus the tautologies. A tautology is not evidence, so it
  // must not offset a removed assertion (2.1.0).
  const real = (t) => count(t, ASSERTION) - count(t, TAUTOLOGY);
  let baseTotal = 0, headTotal = 0;
  for (const [path, baseText] of baseFiles) {
    baseTotal += real(baseText);
    const headText = headFiles.get(path);
    if (headText === undefined) {
      findings.push(`${path} — test file deleted (a red bar goes green by fixing the code, never by removing the test)`);
      continue;
    }
    headTotal += real(headText);
    const dAssert = real(headText) - real(baseText);
    if (dAssert < 0) findings.push(`${path} — net assertion loss (${dAssert}): assertions were removed or weakened`);
    const dTaut = count(headText, TAUTOLOGY) - count(baseText, TAUTOLOGY);
    if (dTaut > 0) findings.push(`${path} — ${dTaut} tautological assertion(s) added (asserting true is true keeps the count and proves nothing)`);
    const dWeak = count(headText, WEAKENER) - count(baseText, WEAKENER);
    if (dWeak > 0) findings.push(`${path} — ${dWeak} skip/only/todo/expected-failure marker(s) added`);
    const dComment = (count(headText, COMMENTED_ASSERTION) + count(headText, BLOCK_COMMENTED_ASSERTION)) - (count(baseText, COMMENTED_ASSERTION) + count(baseText, BLOCK_COMMENTED_ASSERTION));
    if (dComment > 0) findings.push(`${path} — ${dComment} assertion(s) newly commented out`);
    // Emptied, not deleted: the file survives so the deletion rule is silent, but every case is gone.
    if (count(baseText, TEST_CASE) > 0 && count(headText, TEST_CASE) === 0) findings.push(`${path} — test file emptied: it had ${count(baseText, TEST_CASE)} case(s) and now has none`);
  }
  // Files that exist only at head still count toward the surface-wide total — and a NEW file made
  // of tautologies is fake coverage, reported as such.
  for (const [path, headText] of headFiles) {
    if (baseFiles.has(path)) continue;
    headTotal += real(headText);
    const taut = count(headText, TAUTOLOGY);
    if (taut > 0) findings.push(`${path} — new test file carries ${taut} tautological assertion(s) (asserting true is true is not coverage)`);
  }
  // The surface-wide total (2.1.0): a loss spread across files so that no single file trips the
  // per-file rule is still a loss. Only reported when no per-file finding already names it.
  if (headTotal < baseTotal && !findings.some((f) => /net assertion loss|deleted|emptied/.test(f))) {
    findings.push(`test surface — net assertion loss across all test files (${headTotal - baseTotal}): the suite as a whole got weaker`);
  }
  return findings;
}

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trimEnd();

function collect(ref) {
  // ref === null ⇒ the working tree; else the committed tree at ref.
  const files = new Map();
  const names = (ref ? git(['ls-tree', '-r', '--name-only', ref]) : git(['ls-files'])).split('\n');
  for (const name of names) {
    if (!name || !TEST_FILE.test(name)) continue;
    try {
      files.set(name, ref ? git(['show', `${ref}:${name}`]) : git(['show', `:${name}`]));
    } catch { /* unreadable (e.g. deleted in index) — treated as absent */ }
  }
  return files;
}

export function resolveBase(argv = process.argv) {
  const i = argv.indexOf('--base');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    try { return git(['merge-base', candidate, 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* next */ }
  }
  return null;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { git(['rev-parse', '--git-dir'], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch {
    process.stderr.write('Test-integrity gate (Q1b) — CANNOT VERIFY: not a git checkout. Unverifiable is not a pass.\n');
    process.exit(2);
  }
  const base = resolveBase();
  if (!base) {
    process.stderr.write('Test-integrity gate (Q1b) — CANNOT VERIFY: no merge base found (pass --base <ref>).\n');
    process.exit(2);
  }
  const findings = evaluate(collect(base), collect(null));
  // On a GitHub Actions PR checkout HEAD is DETACHED, so `rev-parse --abbrev-ref HEAD` returns
  // "HEAD", not the branch — the -testfix- escape hatch would never fire in the very environment
  // this gate calls the merge-blocking control of record. GITHUB_HEAD_REF carries the real PR
  // source branch on pull_request events; fall back to rev-parse for local runs.
  let branch = process.env.GITHUB_HEAD_REF || '';
  if (!branch) { try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch { /* detached */ } }
  const testfix = /testfix/i.test(branch);
  if (findings.length) {
    const head = testfix
      ? `\nTest-integrity gate (Q1b) — NOTICE (dedicated testfix branch: ${branch})\n\n`
      : '\nTest-integrity gate (Q1b) — FAIL\n\n';
    process.stderr.write(head);
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    if (!testfix) {
      process.stderr.write('\nA red bar goes green by fixing the code, never by weakening the test. A genuine\ntest defect is fixed in the open on a dedicated -testfix- branch (delivery-harness.md).\n');
      process.exit(1);
    }
  }
  // 2.1.0 — a record in the gate runner's shape, so a downstream consumer (the routine lane) can
  // read Q1B as green at THIS commit from evidence rather than from a claim. Written only on a
  // pass (a failing run exits above); `--out <file>`.
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    let commit = null;
    try { commit = git(['rev-parse', 'HEAD']); } catch { /* recorded as null */ }
    const record = { lane: 'pr', base, commit, executed: [{ controls: ['Q1B'], mechanism: 'scripts/test-integrity-check.mjs', status: 'pass' }], skipped: [], result: 'pass', produced_at: new Date().toISOString() };
    writeFileSync(process.argv[outIdx + 1], JSON.stringify(record, null, 2) + '\n');
  }
  process.stdout.write(`Test-integrity gate (Q1b) — OK (base ${base.slice(0, 12)})\n`);
}
