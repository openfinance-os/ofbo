// Tests for the HG-0013 routine-change lane. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, pathMatch, verifyClass, gatesGreenFromRecords, gitDiffDetail, FLOOR_DENY, ROUTINE_CLASSES } from './routine-change-check.mjs';

const REGISTRY = {
  groups: { 'second-line': {}, builders: {} },
  identities: [
    { id: 'sara-2l', kind: 'human', groups: ['second-line'] },
    { id: 'dev-omar', kind: 'human', groups: ['builders'] },
    { id: 'loom-agent', kind: 'agent', groups: ['builders'] },
  ],
};

const ENVELOPE = {
  envelope_id: 'RTE-T', owner: 'sara-2l', expires: '2026-12-31',
  allowed_classes: ['doc-fix', 'dependency-patch'],
  path_allow: ['docs/', 'package-lock.json', 'CHANGELOG.md'],
  path_deny: ['docs/governance/'],
  max_diff_lines: 40,
  required_green_gates: ['Q1', 'Q1b'],
};
// 2.1.0: `gates_green` on the claim is decorative — what evaluate() reads is `_green_recorded`,
// the set check() derives from the gate runner's records; `_files` is the diff content check()
// derives from git. Both are supplied here the way check() would.
const CLAIM = {
  envelope: 'RTE-T', class: 'doc-fix',
  changed_paths: ['docs/guide.md'], diff_lines: 8, gates_green: ['Q1', 'Q1b', 'Q2'],
  _green_recorded: new Set(['q1', 'q1b', 'q2']),
  _files: [{ path: 'docs/guide.md', added: ['fixed typo'], removed: ['fixed tpyo'], base: 'fixed tpyo\n', head: 'fixed typo\n' }],
};
const ASOF = '2026-07-22';

test('a conforming routine change qualifies (empty findings)', () => {
  assert.deepEqual(evaluate(ENVELOPE, CLAIM, REGISTRY, ASOF), []);
});

test('NEGATIVE — a path outside path_allow does not qualify', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, changed_paths: ['src/app.js'] }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /outside the envelope's path_allow/.test(m)));
});

test('NEGATIVE — a control-plane path hits the absolute floor even if the envelope allows it', () => {
  // An envelope that recklessly allows everything still cannot reach the control plane.
  const reckless = { ...ENVELOPE, path_allow: ['', 'scripts/', 'docs/'] };
  const f = evaluate(reckless, { ...CLAIM, changed_paths: ['scripts/control-plane-check.mjs'] }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /absolute floor/.test(m)), 'floor is code, not configuration');
});

test('NEGATIVE — the API contract is under the floor', () => {
  const reckless = { ...ENVELOPE, path_allow: ['specs/'] };
  const f = evaluate(reckless, { ...CLAIM, changed_paths: ['specs/openapi.yaml'] }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /absolute floor/.test(m)));
});

/* rc.46 (Shari'ah workstream): the routine lane must never reach the surfaces where a
   product's economic substance is decided. The rulings register is floored for free by
   docs/governance/; an adopter's pricing and product-structure roots are not, which is what
   the ADOPT line on FLOOR_DENY exists for. Both halves are proved here. INERT for an adopter
   with no Islamic product: nothing below changes the shipped floor. */

test("NEGATIVE — a Shari'ah rulings register change hits the floor even under a reckless envelope", () => {
  // An agent that could auto-merge a ruling could authorise its own product structure.
  const reckless = { ...ENVELOPE, path_allow: [''], path_deny: [] };
  const f = evaluate(reckless, { ...CLAIM, changed_paths: ['docs/governance/shariah-rulings.json'] }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /absolute floor/.test(m)), 'the rulings register is control-plane data, never routine');
});

test('NEGATIVE — a floored pricing root refuses a profit-rate change that looks routine', () => {
  // The defect: a profit-rate table is a one-line diff that reads exactly like a routine
  // config bump. Once the adopter appends their pricing root per the ADOPT line, no envelope
  // can auto-merge it. The shipped floor names no adopter src/ path — asserted first.
  assert.ok(!FLOOR_DENY.some((p) => /pricing/.test(p)), 'the shipped floor must not invent adopter roots');
  FLOOR_DENY.push('src/pricing/'); // stands in for the adopter's ADOPT append
  try {
    const reckless = { ...ENVELOPE, path_allow: [''], path_deny: [] };
    const f = evaluate(reckless, { ...CLAIM, changed_paths: ['src/pricing/profit-rates.json'] }, REGISTRY, ASOF);
    assert.ok(f.some((m) => /absolute floor/.test(m)), 'a profit-rate change is not routine by construction');
  } finally { FLOOR_DENY.pop(); }
});

test('NEGATIVE — an expired envelope does not qualify', () => {
  const f = evaluate({ ...ENVELOPE, expires: '2026-01-01' }, CLAIM, REGISTRY, ASOF);
  assert.ok(f.some((m) => /expired/.test(m)));
});

test('NEGATIVE — an unparseable expiry does not silently never-expire', () => {
  const f = evaluate({ ...ENVELOPE, expires: 'not-a-date' }, CLAIM, REGISTRY, ASOF);
  assert.ok(f.some((m) => /not a valid date/.test(m)), 'a NaN date must fail, not pass');
});

test('NEGATIVE — an agent-owned envelope is rejected', () => {
  const f = evaluate({ ...ENVELOPE, owner: 'loom-agent' }, CLAIM, REGISTRY, ASOF);
  assert.ok(f.some((m) => /not a human/.test(m)));
});

test('NEGATIVE — a builder-owned envelope is rejected (must be second line)', () => {
  const f = evaluate({ ...ENVELOPE, owner: 'dev-omar' }, CLAIM, REGISTRY, ASOF);
  assert.ok(f.some((m) => /not in the second-line group/.test(m)));
});

test('NEGATIVE — a class the envelope does not allow is rejected', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, class: 'formatting' }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /not allowed by this envelope/.test(m)));
});

test('NEGATIVE — a class outside the known routine set is rejected', () => {
  const f = evaluate({ ...ENVELOPE, allowed_classes: ['refactor'] }, { ...CLAIM, class: 'refactor' }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /is not a routine class/.test(m)));
});

test('NEGATIVE — a diff over the cap is rejected', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, diff_lines: 400 }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /over the envelope cap/.test(m)));
});

test('NEGATIVE — gates_green typed into the claim is NOT evidence (2.1.0)', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, gates_green: ['Q1', 'Q1b'], _green_recorded: new Set() }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /required gate Q1 is not recorded green by the gate runner/.test(m)), f.join('; '));
});

test('gatesGreenFromRecords — only pass/pass-cached rows, only at this commit, case-insensitive', () => {
  const rec = (commit, rows) => ({ commit, executed: rows });
  const g = gatesGreenFromRecords([
    rec('abc', [{ controls: ['Q1B'], status: 'pass' }, { controls: ['Q2-SAST'], status: 'pass-cached' }, { controls: ['Q4-SECRETS'], status: 'fail' }]),
    rec('old', [{ controls: ['Q9'], status: 'pass' }]),
  ], 'abc');
  assert.ok(g.has('q1b') && g.has('q2-sast'));
  assert.ok(!g.has('q4-secrets'), 'a failed gate is not green');
  assert.ok(!g.has('q9'), 'a record for another commit is not evidence for this one');
});

test('verifyClass — dependency-patch refuses a new package name (the typosquat) and a major bump', () => {
  const base = JSON.stringify({ dependencies: { lodash: '^4.17.20', express: '^4.18.0' } }, null, 2);
  const swap = JSON.stringify({ dependencies: { lodahs: '^4.17.21', express: '^4.18.0' } }, null, 2);
  let f = verifyClass('dependency-patch', [{ path: 'package.json', added: [], removed: [], base, head: swap }]);
  assert.ok(f.some((m) => /introduces 1 package\(s\) not present before \(lodahs\)/.test(m)), f.join('; '));
  const major = JSON.stringify({ dependencies: { lodash: '^4.17.20', express: '^5.0.0' } }, null, 2);
  f = verifyClass('dependency-patch', [{ path: 'package.json', added: [], removed: [], base, head: major }]);
  assert.ok(f.some((m) => /moves express across a major/.test(m)), f.join('; '));
  const patch = JSON.stringify({ dependencies: { lodash: '^4.17.21', express: '^4.18.2' } }, null, 2);
  assert.deepEqual(verifyClass('dependency-patch', [{ path: 'package.json', added: [], removed: [], base, head: patch }]), []);
  // a lockfile: a new node_modules entry is a new package
  const lockA = JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.20' } } });
  const lockB = JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.21' }, 'node_modules/evil-pkg': { version: '1.0.0' } } });
  f = verifyClass('dependency-patch', [{ path: 'package-lock.json', added: [], removed: [], base: lockA, head: lockB }]);
  assert.ok(f.some((m) => /evil-pkg/.test(m)));
  // not a manifest at all
  f = verifyClass('dependency-patch', [{ path: 'src/index.js', added: ['x'], removed: [], base: '', head: 'x' }]);
  assert.ok(f.some((m) => /not a dependency manifest/.test(m)));
});

test('verifyClass — doc-fix, comment-fix, formatting and lint-fix are judged on content', () => {
  assert.ok(verifyClass('doc-fix', [{ path: 'src/app.js', added: [], removed: [], base: '', head: '' }]).some((m) => /not a documentation file/.test(m)));
  assert.deepEqual(verifyClass('doc-fix', [{ path: 'README.md', added: ['a'], removed: [], base: '', head: 'a' }]), []);
  assert.deepEqual(verifyClass('comment-fix', [{ path: 'src/a.js', added: ['// clearer'], removed: ['// unclear'], base: '// unclear', head: '// clearer' }]), []);
  assert.ok(verifyClass('comment-fix', [{ path: 'src/a.js', added: ['return 1;'], removed: [], base: '', head: 'return 1;' }]).some((m) => /non-comment line/.test(m)));
  assert.deepEqual(verifyClass('formatting', [{ path: 'src/a.js', added: ['  x = 1;'], removed: ['x=1;'], base: 'x=1;\n', head: '  x = 1;\n' }]), []);
  assert.ok(verifyClass('formatting', [{ path: 'src/a.js', added: ['x = 2;'], removed: ['x = 1;'], base: 'x = 1;\n', head: 'x = 2;\n' }]).some((m) => /other than whitespace/.test(m)));
  assert.ok(verifyClass('formatting', [{ path: 'src/new.js', added: ['x'], removed: [], base: null, head: 'x' }]).some((m) => /was added/.test(m)));
  assert.deepEqual(verifyClass('lint-fix', [{ path: 'src/a.js', added: ["const y = 1;"], removed: ['var y = 1;'], base: "import fs from 'fs';\nvar y = 1;", head: "import fs from 'fs';\nconst y = 1;" }]), []);
  assert.ok(verifyClass('lint-fix', [{ path: 'src/a.js', added: ["import x from 'evil';"], removed: [], base: 'const y = 1;', head: "import x from 'evil';\nconst y = 1;" }]).some((m) => /imports evil/.test(m)));
});

test('NEGATIVE — a missing required green gate is rejected', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, _green_recorded: new Set(['q1']) }, REGISTRY, ASOF);
  assert.ok(f.some((m) => /required gate Q1b is not recorded green/.test(m)));
});

test('NEGATIVE — an envelope path_deny still bites inside an allowed prefix', () => {
  const f = evaluate(ENVELOPE, { ...CLAIM, changed_paths: ['docs/governance/notes.md'] }, REGISTRY, ASOF);
  // caught by the floor first (docs/governance/), proving defence in depth
  assert.ok(f.some((m) => /floor/.test(m) || /path_deny/.test(m)));
});

test('no envelope at all → normal lane', () => {
  const f = evaluate(null, CLAIM, REGISTRY, ASOF);
  assert.ok(f.some((m) => /no standing authorization/.test(m)));
});

test('pathMatch handles dir prefixes, exacts, and *.ext', () => {
  assert.ok(pathMatch('docs/', 'docs/a/b.md'));
  assert.ok(pathMatch('CHANGELOG.md', 'CHANGELOG.md'));
  assert.ok(!pathMatch('CHANGELOG.md', 'CHANGELOG.md.bak'));
  assert.ok(pathMatch('*.lock', 'pnpm.lock'));
  assert.ok(!pathMatch('docs/', 'src/docs/x'));
});

test('the floor covers every control-plane root', () => {
  for (const root of ['scripts/x.mjs', 'core/y.mjs', '.github/workflows/ci.yml', 'CODEOWNERS', 'profiles/z.json', 'docs/governance/a.json']) {
    assert.ok(FLOOR_DENY.some((p) => pathMatch(p, root)), `floor should cover ${root}`);
  }
});

test('the known routine classes are the closed set', () => {
  assert.deepEqual(ROUTINE_CLASSES, ['dependency-patch', 'lint-fix', 'doc-fix', 'formatting', 'comment-fix']);
});

/* ---- W2: the two check contexts diverge on the same PR (closes F2) ---- */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'routine-change-check.mjs');
const runCli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

test('an ordinary PR (no routine claim): normal lane PASSES, routine-qualified FAILS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-')); // no routine-change-claim.json here
  try {
    const normal = runCli(['--base', 'HEAD'], dir);
    assert.equal(normal.status, 0, 'normal-human-review passes an ordinary PR');
    assert.match(normal.stdout, /normal human-merge lane applies/);

    const routine = runCli(['--assert-routine', '--base', 'HEAD'], dir);
    assert.equal(routine.status, 1, 'routine-qualified FAILS an ordinary PR — it cannot enter the queue');
    assert.match(routine.stderr, /NOT routine-qualified/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 2.1.0 — the diff content comes from git, end to end ───────────────────────────────────────
import { writeFileSync, mkdirSync } from 'node:fs';
const sh = (cmd, cwd) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
const HAVE_GIT = sh('git --version').status === 0;

test('gitDiffDetail + verifyClass — a typosquat swap under the diff cap is refused from the real diff', { skip: !HAVE_GIT && 'git not available' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-git-'));
  try {
    sh('git init -q && git config user.email t@t && git config user.name t && git checkout -q -b main', dir);
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.20' } }, null, 2) + '\n');
    writeFileSync(join(dir, 'docs/guide.md'), 'hello\n');
    sh('git add -A && git commit -q -m base', dir);
    sh('git checkout -q -b feature', dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodahs: '^4.17.21' } }, null, 2) + '\n');
    sh('git add -A && git commit -q -m swap', dir);
    const prev = process.cwd(); process.chdir(dir);
    try {
      const files = gitDiffDetail('main', ['package.json']);
      assert.ok(files && files.length === 1);
      assert.ok(files[0].base.includes('lodash') && files[0].head.includes('lodahs'));
      const f = verifyClass('dependency-patch', files);
      assert.ok(f.some((m) => /lodahs/.test(m)), f.join('; '));
    } finally { process.chdir(prev); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
