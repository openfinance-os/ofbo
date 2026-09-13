// Tests for the self-claims gate. Node runner: `node --test`.
//
// The gate exists because a whole class of defect was found by humans reading carefully. So the
// tests are mostly REGRESSIONS AGAINST THE REAL HISTORY: each defect that actually shipped is
// replayed as a fixture, and the gate must catch it. If one of these ever goes green without the
// gate firing, the class is back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { classifyClaim, checklistRows, cliFiles, documentedFlags, evaluate, invertedGates, proseFiles, unimplementedFlags, PLAYBOOK, WORKFLOW } from './self-claims-check.mjs';

const BUNDLE = existsSync(WORKFLOW) && existsSync(PLAYBOOK);
const row = (mech, status) => `| An attack | ${mech} | ${status} |`;
const WORKFLOW_WITH = (g) => `          if node scripts/${g}.mjs; then\n            echo "::error::x"; exit 1; fi\n`;

// --- the shipped state ------------------------------------------------------------------------

test('the bundle as shipped passes its own claims gate', { skip: !BUNDLE && 'bundle-only' }, () => {
  const { findings } = evaluate({
    playbook: readFileSync(PLAYBOOK, 'utf8'),
    workflow: readFileSync(WORKFLOW, 'utf8'),
    prose: proseFiles().map((f) => ({ file: f, text: readFileSync(f, 'utf8') })),
  });
  assert.deepEqual(findings, [], `the bundle overstates itself:\n${findings.join('\n')}`);
});

test('every CI-proven claim in the shipped playbook is named or scoped — none bare', { skip: !BUNDLE && 'bundle-only' }, () => {
  const bare = checklistRows(readFileSync(PLAYBOOK, 'utf8')).filter((r) => r.form === 'bare');
  assert.deepEqual(bare.map((r) => r.attack), []);
});

// --- C2 · the three shapes --------------------------------------------------------------------

test('classifyClaim distinguishes named, scoped and bare', () => {
  assert.equal(classifyClaim('**CI-proven** (placeholder-owner negative test)'), 'named');
  assert.equal(classifyClaim('control-plane **CI-proven**; branch protection **live**'), 'scoped');
  assert.equal(classifyClaim('declared **CI-proven**; execution **live**'), 'scoped');
  assert.equal(classifyClaim('**CI-proven**'), 'bare');
  assert.equal(classifyClaim('**CI-proven**; live routing **live**'), 'bare');
  assert.equal(classifyClaim('not a claim at all'), null);
});

// --- REGRESSIONS against defects that actually shipped ------------------------------------------

test('REGRESSION — a bare CI-proven claim fails (the three rows a reviewer caught by hand)', () => {
  // Exactly the shape rc.25 fixed: "| Stale model evaluation | `model-provenance-check` … | **CI-proven** |"
  const { findings } = evaluate({
    playbook: row('`model-provenance-check` (eval pinned to the shipping model)', '**CI-proven**'),
    workflow: WORKFLOW_WITH('model-provenance-check'),
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /without naming its negative test/);
});

test('REGRESSION — a named claim whose gate has NO inversion fails', () => {
  // The substantive version of the same defect: the row says a test exists; CI has none.
  const { findings } = evaluate({
    playbook: row('`supply-chain-check` (SCA policy)', '**CI-proven** (critical-CVE negative test)'),
    workflow: '          node scripts/supply-chain-check.mjs\n', // positive run only
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /no gate it names .* has an inversion/);
});

test('REGRESSION — a named claim that links to no gate at all fails', () => {
  // pilot-playbook.md:46 shipped in this state: a named test, no backticked gate to link it to.
  const { findings } = evaluate({
    playbook: row('Disjoint builders ∩ second-line; release hold is second-line-owned', '**CI-proven** (held-release negative test)'),
    workflow: WORKFLOW_WITH('change-envelope-check'),
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /names no gate in backticks/);
});

test('REGRESSION — prose citing a gate that does not exist fails (the dangling-reference class)', () => {
  const { findings } = evaluate({
    playbook: null,
    workflow: null,
    prose: [{ file: 'references/made-up.md', text: 'enforced by `scripts/does-not-exist.mjs`' }],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /does not exist/);
});

// --- what must NOT fail -------------------------------------------------------------------------

test('a named claim backed by a real inversion passes', () => {
  const { findings } = evaluate({
    playbook: row('`model-provenance-check` (eval pinned)', '**CI-proven** (superseded-pin negative test)'),
    workflow: WORKFLOW_WITH('model-provenance-check'),
  });
  assert.deepEqual(findings, []);
});

test('a SCOPED claim needs no bypass test — it is already a narrower claim', () => {
  // "declared **CI-proven**" says the DECLARATION is gate-checked, not that an attack was repelled.
  const { findings } = evaluate({
    playbook: row('R6 reconciliation + A5', 'declared **CI-proven**; live break handling **live**'),
    workflow: '',
  });
  assert.deepEqual(findings, []);
});

// --- C4 · the reverse drift is reported, never failed -------------------------------------------

test('an inversion no row credits is a NOTICE, not a finding', () => {
  // Forcing one row per inversion would manufacture rows nobody meant to write — the checklist
  // enumerates attacks, not gates. But the drift must still be visible.
  const { findings, notices } = evaluate({
    playbook: row('`model-provenance-check` (eval pinned)', '**CI-proven** (superseded-pin negative test)'),
    workflow: WORKFLOW_WITH('model-provenance-check') + WORKFLOW_WITH('secrets-scan'),
  });
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, ['scripts/secrets-scan.mjs']);
});

test('invertedGates finds only inversions, never plain positive runs', () => {
  const wf = '          node scripts/sast-check.mjs\n' + WORKFLOW_WITH('secrets-scan');
  const got = invertedGates(wf);
  assert.ok(got.has('scripts/secrets-scan.mjs'));
  assert.ok(!got.has('scripts/sast-check.mjs'), 'a positive run is not a negative test');
});

test('the gate is inert where the bundle layout is absent', () => {
  const { findings, notices, rows } = evaluate({ playbook: null, workflow: null });
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
  assert.deepEqual(rows, []);
});

// ── C5 · a documented CLI flag must exist (rc.32) ────────────────────────────────────────────
//
// Added because this gate MISSED one, in the gate written to stop exactly this class. C1 checks a
// cited script PATH resolves; rc.29's discovery-sync-check.mjs existed, and only its advertised
// `--reconcile` did not. Everything below defends the narrowness that makes the rule usable.

const CLI = (usage, code) => `// ${usage}\n${code}\n`;

test('REGRESSION — a flag in the usage line with no implementation fails', () => {
  const text = CLI('node scripts/foo.mjs --upstream <dir> --reconcile', "if (argv.includes('--upstream')) run();");
  assert.deepEqual(unimplementedFlags(text, 'foo.mjs'), ['--reconcile']);
  const { findings } = evaluate({ playbook: null, workflow: null, clis: [{ file: 'scripts/foo.mjs', name: 'foo.mjs', text }] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /documents `--reconcile`, which appears nowhere in the code/);
  assert.match(findings[0], /silently/, 'the finding says why it matters, not just that it happened');
});

test('a flag that IS handled passes', () => {
  const text = CLI('node scripts/foo.mjs --record', "if (argv.includes('--record')) write();");
  assert.deepEqual(unimplementedFlags(text, 'foo.mjs'), []);
});

test("another tool's flag in a comment is not a claim THIS file makes", () => {
  // The false positive that would make the rule unusable: prose about git, npm, or a sibling script.
  const text = ['// Restores use `git checkout --force-with-lease`, never --force.',
                '// See adopt.mjs --tier for how staging works.',
                '// node scripts/foo.mjs --record',
                "if (argv.includes('--record')) write();"].join('\n');
  assert.deepEqual(documentedFlags(text, 'foo.mjs'), ['--record'], 'only the line naming THIS file counts');
  assert.deepEqual(unimplementedFlags(text, 'foo.mjs'), []);
});

test('a flag used in code but only in a trailing comment position still counts as implemented', () => {
  // Conservative comment-stripping: whole-line comments go, nothing else. The rule errs toward
  // missing a defect rather than inventing one — a gate that cries wolf gets switched off.
  const text = CLI('node scripts/foo.mjs --dry-run', "const dry = argv.includes('--dry-run'); // the flag");
  assert.deepEqual(unimplementedFlags(text, 'foo.mjs'), []);
});

test('a CLI documenting no flags is simply not subject to the rule', () => {
  assert.deepEqual(documentedFlags('// node scripts/foo.mjs\nrun();\n', 'foo.mjs'), []);
});

// The historical proof: run the rule against the ACTUAL rc.29 blob, from git. A synthetic fixture
// only shows the rule works on what I imagined; this shows it catches the defect that really shipped.
let RC29 = null;
try {
  RC29 = execFileSync('git', ['show', '39995a3:plugins/middleleap-loom/skills/loom-adopt/harness/scripts/discovery-sync-check.mjs'],
    { encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
} catch { /* shallow clone or adopted layout — the git history is not reachable here */ }

test('HISTORICAL — the real rc.29 blob is caught', { skip: !RC29 && 'git history not reachable' }, () => {
  assert.deepEqual(documentedFlags(RC29, 'discovery-sync-check.mjs'), ['--reconcile', '--record', '--upstream'].sort());
  assert.deepEqual(unimplementedFlags(RC29, 'discovery-sync-check.mjs'), ['--reconcile'],
    'the flag rc.29 advertised and never wrote — and only this flag');
});

test('the bundle as shipped implements every flag it advertises', { skip: !BUNDLE && 'bundle-only', concurrency: false }, () => {
  const offenders = cliFiles()
    .map((f) => ({ f, missing: unimplementedFlags(readFileSync(f, 'utf8'), f.split('/').pop()) }))
    .filter((x) => x.missing.length);
  assert.deepEqual(offenders.map((x) => `${x.f.split('/').pop()}: ${x.missing.join(' ')}`), []);
});
