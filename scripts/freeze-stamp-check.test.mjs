// Tests for the freeze-stamp gate (Factory Floor WS4 · D4.1). Node built-in runner.
//
// The gate exists for one scenario: someone makes a small, well-intentioned correction directly
// to a frozen file instead of going back to the floor and re-freezing. That is the quiet way to
// change what a D-gate reads without passing back through the surface that produced it, and it
// is the ordinary case rather than the malicious one — which is why it needs a gate and not a
// convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_ID, freezeStamp, sha256 } from '../core/floor-export.mjs';
import { checkRun, run } from './freeze-stamp-check.mjs';

const CONTENT = '---\nartifact: problem-statement\n---\n\n# Problem statement\n\nThe thing we froze.\n';

/** A run directory with one frozen artifact and its stamp. */
function frozenRun(over = {}, content = CONTENT) {
  const dir = mkdtempSync(join(tmpdir(), 'fz-'));
  const runDir = join(dir, 'discovery/runs/r1');
  mkdirSync(join(runDir, '.freeze'), { recursive: true });
  writeFileSync(join(runDir, 'problem-statement.md'), content);
  writeFileSync(join(runDir, '.freeze/problem-statement.json'), JSON.stringify({
    ...freezeStamp({ slug: 'r1', file: 'problem-statement.md', digest: sha256(CONTENT), exportedAt: '2026-07-25T10:00:00Z', exportedBy: 'svc-floor-freezer' }),
    ...over,
  }));
  return { dir, runDir };
}

test('a frozen run whose files match their stamps passes', () => {
  const { dir, runDir } = frozenRun();
  try {
    assert.deepEqual(checkRun(runDir, 'r1').findings, []);
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.checked, 1);
    assert.equal(r.runs, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The whole point.
test('a quick fix edited straight into the frozen file is caught', () => {
  const { dir, runDir } = frozenRun({}, `${CONTENT}\nAnd one small correction.\n`);
  try {
    const f = checkRun(runDir, 'r1').findings;
    assert.equal(f.length, 1);
    assert.match(f[0], /does not match its freeze stamp/);
    assert.match(f[0], /re-freeze it rather than editing in place/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stamp naming a file that is not there is a finding, not a skip', () => {
  const { dir, runDir } = frozenRun({ file: 'never-written.md' });
  try {
    assert.match(checkRun(runDir, 'r1').findings[0], /is missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A stamp may only vouch for a file inside its own run — otherwise one run's freeze could be
// pointed at another's file, or climb out of the runs tree entirely.
test('a stamp cannot reach outside its own run directory', () => {
  for (const file of ['../r2/problem-statement.md', '/etc/passwd']) {
    const { dir, runDir } = frozenRun({ file });
    try {
      assert.match(checkRun(runDir, 'r1').findings[0], /escapes the run directory/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a stamp with no file, a bad schema, or unreadable JSON is refused', () => {
  const cases = [
    [{ file: undefined }, /names no file/],
    [{ schema: 'other/v1' }, /is not loom\.freeze-stamp\/v1/],
  ];
  for (const [over, re] of cases) {
    const { dir, runDir } = frozenRun(over);
    try { assert.match(checkRun(runDir, 'r1').findings[0], re); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const { dir, runDir } = frozenRun();
  try {
    writeFileSync(join(runDir, '.freeze/problem-statement.json'), '{ not json');
    assert.match(checkRun(runDir, 'r1').findings[0], /not readable as JSON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// An adopter who has not adopted the floor freezes nothing, and their hand-authored discovery
// runs must be entirely unaffected. The gate tightens only where a freeze actually happened.
test('a run with no .freeze directory is untouched by the gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fz-'));
  try {
    mkdirSync(join(dir, 'discovery/runs/hand-authored'), { recursive: true });
    writeFileSync(join(dir, 'discovery/runs/hand-authored/problem-statement.md'), '# written by a person\n');
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.checked, 0);
    assert.equal(r.runs, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repository with no discovery runs at all is silent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fz-'));
  try { assert.deepEqual(run(dir), { findings: [], runs: 0, checked: 0 }); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the stamp schema id is the one the exporter writes', () => {
  assert.equal(freezeStamp({ slug: 'x', file: 'y.md', digest: sha256('z') }).schema, SCHEMA_ID);
});
