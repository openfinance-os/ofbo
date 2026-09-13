// Tests for the pilot-conduct gate. Node built-in runner: `node --test`.
//
// The property that earns this control is PL-R08 — the join to the playbook's own adversarial
// table — and it is tested against the SHIPPED playbook, not a fixture, so that a row added to
// the real file becomes a real obligation. The two framing properties are tested first and last:
// the gate is silent until a record declares a pilot (`status: active`), and the shipped template
// never reads as a declaration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, isPlaceholder, parsePlaybook, run } from './pilot-record-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ is copied into an adopted tree.
const TEMPLATE_PATH = [join(H, 'governance/pilot-record.template.json'), join(H, 'docs/governance/pilot-record.json')].find(existsSync);
const PLAYBOOK_PATH = [join(H, 'governance/runbooks/pilot-playbook.md'), join(H, 'docs/governance/runbooks/pilot-playbook.md')].find(existsSync);
const SKIP_NO_TEMPLATE = !TEMPLATE_PATH && 'pilot-record template not present in this layout';
const SKIP_NO_PLAYBOOK = !PLAYBOOK_PATH && 'pilot playbook not present in this layout';
const clean = (d) => rmSync(d, { recursive: true, force: true });

const REGISTRY = {
  identities: [
    { id: 'risk-lena', kind: 'human', roles: ['risk'], groups: ['second-line'] },
    { id: 'exec-omar', kind: 'human', roles: ['accountable-executive'], groups: ['second-line'] },
    { id: 'dev-sam', kind: 'human', roles: ['engineer'], groups: ['builders'] },
    { id: 'bot', kind: 'agent', roles: ['risk'] },
  ],
};
const PLAYBOOK = [
  { ax: 'AX-01', exercise: 'direct push', live: true },
  { ax: 'AX-02', exercise: 'gate edit', live: false },
  { ax: 'AX-03', exercise: 'rollback', live: true },
];
const exit_ = (over = {}) => ({
  stage: 1,
  exited_on: '2026-07-01',
  exit_evidence: 'run 4411, synthetic rehearsal report',
  approved_by: 'risk-lena',
  ...over,
});
const record = (over = {}) => ({
  status: 'active',
  pilot_id: 'PILOT-1',
  stage: 2,
  stage_exits: [exit_()],
  scope_bound: { max_customers: 50, max_transaction_value: 1000, scope_note: 'Limit increases only; no core posting.', financial_execution: false },
  reversibility: { route: 'Feature flag pilot.limits, falling back to the manual queue.', drilled_on: '2026-07-10', drill_evidence: 'drill 12' },
  supervision: {
    second_line_observer: 'risk-lena',
    accountable_executive: 'exec-omar',
    observation_cadence_days: 7,
    observations: [{ observed_on: new Date().toISOString().slice(0, 10), by: 'risk-lena', note: 'Observed 12 decisions.' }],
  },
  exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'held', evidence: 'run 4490' }],
  findings: [],
  ...over,
});
const ctx = { playbook: PLAYBOOK, registry: REGISTRY };

test('a coherent active pilot passes, carrying only the standing notices', () => {
  const { findings, notices, armed } = evaluate(record(), ctx);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.equal(armed, true);
  // The standing limit is reported every run — a record is not a pilot.
  assert.ok(notices.some((n) => /PL-R14.*nothing in this gate observed production/.test(n)), notices.join('\n'));
  // AX-03 is live and unexercised: a NOTICE while active, because that is what a pilot is for.
  assert.ok(notices.some((n) => /PL-R08.*AX-03.*a pilot in flight is expected/.test(n)), notices.join('\n'));
});

test('PL-R01 — an unreadable status declares no pilot and arms nothing', () => {
  for (const bad of ['running', 'ACTIVE!', 'done']) {
    const r = evaluate(record({ status: bad }), ctx);
    assert.deepEqual(r.findings, [], bad);
    assert.equal(r.armed, false);
    assert.ok(r.notices.some((n) => /PL-R01/.test(n)), bad);
  }
});

test('PL-R03 — STAGE MONOTONICITY: you cannot sit at stage 4 having exited only stage 1', () => {
  const { findings } = evaluate(record({ stage: 4, stage_exits: [exit_()] }), ctx);
  assert.ok(findings.some((f) => /PL-R03.*stage 4.*stages 2, 3/.test(f)), findings.join('\n'));
  // With every prior stage exited, the rule is silent.
  const full = record({ stage: 4, stage_exits: [exit_(), exit_({ stage: 2 }), exit_({ stage: 3 })] });
  assert.deepEqual(evaluate(full, ctx).findings.filter((f) => /PL-R03/.test(f)), []);
});

test('PL-R04 — the team running the pilot does not authorise its own advance', () => {
  const byBuilder = record({ stage_exits: [exit_({ approved_by: 'dev-sam' })] });
  assert.ok(evaluate(byBuilder, ctx).findings.some((f) => /PL-R04.*builders/.test(f)));
  const byAgent = record({ stage_exits: [exit_({ approved_by: 'bot' })] });
  assert.ok(evaluate(byAgent, ctx).findings.some((f) => /PL-R04.*AGENT/.test(f)));
  const unknown = record({ stage_exits: [exit_({ approved_by: 'ghost' })] });
  assert.ok(evaluate(unknown, ctx).findings.some((f) => /PL-R04.*not in the identity registry/.test(f)));
  for (const key of ['exited_on', 'exit_evidence']) {
    const missing = record({ stage_exits: [exit_({ [key]: undefined })] });
    assert.ok(evaluate(missing, ctx).findings.some((f) => /PL-R04/.test(f)), key);
  }
});

test('PL-R05 — ZERO IS A REAL CAP before the exposure exists (the defect a real rehearsal found)', () => {
  // A stage-1 synthetic rehearsal has no customers and moves no money. Requiring a POSITIVE cap
  // there left an adopter two options — fabricate a number, or not declare the pilot — which is
  // the rule making its own honest answer unwritable. Zero must pass at stage 1.
  const rehearsal = record({
    stage: 1,
    stage_exits: [],
    scope_bound: { max_customers: 0, max_transaction_value: 0, scope_note: 'Synthetic rehearsal; nothing deployed.', financial_execution: false },
  });
  const r = evaluate(rehearsal, ctx);
  assert.deepEqual(r.findings.filter((f) => /PL-R05/.test(f)), [], r.findings.join('\n'));
  // Stage 2 is internal users with no external customers — still zero.
  const internal = { ...rehearsal, stage: 2, stage_exits: [exit_()] };
  assert.deepEqual(evaluate(internal, ctx).findings.filter((f) => /PL-R05/.test(f)), []);
});

test('PL-R05 — but a ZERO cap where the exposure exists is a finding', () => {
  const exits = [exit_(), exit_({ stage: 2 })];
  // Stage 3: real users, so a zero customer cap says the pilot is bounded to nothing while it
  // demonstrably is not. Transaction value may still be zero — stage 3 has no financial execution.
  const s3 = record({ stage: 3, stage_exits: exits, scope_bound: { max_customers: 0, max_transaction_value: 0, scope_note: 'beta', financial_execution: false } });
  const r3 = evaluate(s3, ctx).findings.filter((f) => /PL-R05/.test(f));
  assert.equal(r3.length, 1, r3.join('\n'));
  assert.ok(/max_customers is 0 at stage 3/.test(r3[0]), r3[0]);
  // Stage 4: money moves, so a zero value cap is a finding too.
  const s4 = record({ stage: 4, stage_exits: [...exits, exit_({ stage: 3 })], scope_bound: { max_customers: 10, max_transaction_value: 0, scope_note: 'cohort', financial_execution: true } });
  assert.ok(evaluate(s4, ctx).findings.some((f) => /PL-R05.*max_transaction_value is 0 at stage 4/.test(f)));
});

test('PL-R05 — a cap declared BEFORE its exposure exists is a notice, never a block', () => {
  const early = record({ stage: 1, stage_exits: [], scope_bound: { max_customers: 50, max_transaction_value: 0, scope_note: 'x', financial_execution: false } });
  const r = evaluate(early, ctx);
  assert.deepEqual(r.findings.filter((f) => /PL-R05/.test(f)), [], r.findings.join('\n'));
  assert.ok(r.notices.some((n) => /PL-R05.*max_customers is 50 at stage 1.*stage number is behind/.test(n)), r.notices.join('\n'));
});

test('PL-R05 — an unstated cap is still a finding: an unstated ceiling is not a bound', () => {
  for (const key of ['max_customers', 'max_transaction_value']) {
    for (const bad of [undefined, null, 'lots', -1, NaN]) {
      const doc = record({ scope_bound: { ...record().scope_bound, [key]: bad } });
      assert.ok(evaluate(doc, ctx).findings.some((f) => /PL-R05/.test(f)), `${key}=${JSON.stringify(bad)}`);
    }
  }
  const early = record({ stage: 3, stage_exits: [exit_(), exit_({ stage: 2 })], scope_bound: { ...record().scope_bound, financial_execution: true } });
  assert.ok(evaluate(early, ctx).findings.some((f) => /PL-R05.*financial_execution at stage 3/.test(f)));
  // At stage 4 it is expected, not a finding.
  const ok = record({ stage: 4, stage_exits: [exit_(), exit_({ stage: 2 }), exit_({ stage: 3 })], scope_bound: { ...record().scope_bound, financial_execution: true } });
  assert.deepEqual(evaluate(ok, ctx).findings.filter((f) => /PL-R05/.test(f)), []);
});

test('PL-R06 — production exposure with an undrilled rollback is the R3 case', () => {
  const undrilled = record({
    stage: 4,
    stage_exits: [exit_(), exit_({ stage: 2 }), exit_({ stage: 3 })],
    reversibility: { route: 'the flag' },
  });
  assert.ok(evaluate(undrilled, ctx).findings.some((f) => /PL-R06.*stage 4.*undrilled route is a plan/.test(f)), 'stage 4 needs a drill');
  // Below stage 4 an undrilled route is not yet a finding — but a missing ROUTE always is.
  const early = record({ stage: 2, reversibility: { route: 'the flag' } });
  assert.deepEqual(evaluate(early, ctx).findings.filter((f) => /PL-R06/.test(f)), []);
  assert.ok(evaluate(record({ reversibility: {} }), ctx).findings.some((f) => /PL-R06.*intention/.test(f)));
});

test('PL-R07 — a pilot supervised by the team running it is unsupervised', () => {
  const sup = record().supervision;
  assert.ok(evaluate(record({ supervision: { ...sup, second_line_observer: 'dev-sam' } }), ctx)
    .findings.some((f) => /PL-R07.*builders.*unsupervised/.test(f)));
  assert.ok(evaluate(record({ supervision: { ...sup, accountable_executive: 'bot' } }), ctx)
    .findings.some((f) => /PL-R07.*AGENT/.test(f)));
  assert.ok(evaluate(record({ supervision: { ...sup, observation_cadence_days: 0 } }), ctx)
    .findings.some((f) => /PL-R07.*cadence/.test(f)));
  // A declared pilot with no observation at all leaves no trace of supervision.
  assert.ok(evaluate(record({ supervision: { ...sup, observations: [] } }), ctx)
    .findings.some((f) => /PL-R07.*indistinguishable from none/.test(f)));
});

test('PL-R08 — THE PLAYBOOK JOIN: outstanding live rows are a notice while active, a FINDING at concluded', () => {
  const concluded = record({
    status: 'concluded',
    exit: { independent_report: 'docs/pilot-report.md', report_author: 'risk-lena', second_line_confirmation: 'risk-lena', internal_audit_reperformance: 'IA-2026-04' },
  });
  const r = evaluate(concluded, ctx);
  assert.ok(r.findings.some((f) => /PL-R08.*AX-03/.test(f)), r.findings.join('\n'));
  // Exercise the outstanding row and the finding clears.
  const done = { ...concluded, exercises: [...concluded.exercises, { ax: 'AX-03', exercised_on: '2026-07-20', outcome: 'held', evidence: 'run 4501' }] };
  assert.deepEqual(evaluate(done, ctx).findings.filter((f) => /PL-R08/.test(f)), []);
  // A row that is NOT live is never demanded.
  assert.ok(!r.findings.some((f) => /AX-02/.test(f)), 'a CI-proven-only row carries no live obligation');
});

test('PL-R09 — an exercise of a row the playbook does not contain is an exercise of nothing', () => {
  const ghost = record({ exercises: [{ ax: 'AX-99', exercised_on: '2026-07-05', outcome: 'held', evidence: 'run 1' }] });
  assert.ok(evaluate(ghost, ctx).findings.some((f) => /PL-R09.*"AX-99".*exercise of nothing/.test(f)));
  for (const [key, val] of [['exercised_on', undefined], ['outcome', 'fine'], ['evidence', undefined]]) {
    const bad = record({ exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'held', evidence: 'run 1', [key]: val }] });
    assert.ok(evaluate(bad, ctx).findings.some((f) => /PL-R09/.test(f)), key);
  }
});

test('PL-R10 — a failed exercise with no finding is a pilot that dropped what it found', () => {
  const dropped = record({ exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'failed', evidence: 'run 1' }], findings: [] });
  assert.ok(evaluate(dropped, ctx).findings.some((f) => /PL-R10.*least believable record/.test(f)), 'unlinked failure must be caught');
  // Linked by `ax` on the finding.
  const linked = record({
    exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'failed', evidence: 'run 1' }],
    findings: [{ id: 'F-1', ax: 'AX-01', summary: 'Fallback did not page.', disposition: 'resolved', resolved_by: 'risk-lena' }],
  });
  assert.deepEqual(evaluate(linked, ctx).findings.filter((f) => /PL-R10/.test(f)), []);
  // `partial` is treated the same as `failed`.
  const partial = record({ exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'partial', evidence: 'run 1' }], findings: [{ id: 'F-2', summary: 'x', disposition: 'open' }] });
  assert.ok(evaluate(partial, ctx).findings.some((f) => /PL-R10/.test(f)));
});

test('PL-R11 — risk acceptance is the accountable executive\'s act and nobody else\'s', () => {
  const wrong = record({ findings: [{ id: 'F-1', summary: 'x', disposition: 'risk-accepted', risk_accepted_by: 'risk-lena' }] });
  assert.ok(evaluate(wrong, ctx).findings.some((f) => /PL-R11.*not the accountable executive.*better paperwork/.test(f)));
  const right = record({ findings: [{ id: 'F-1', summary: 'x', disposition: 'risk-accepted', risk_accepted_by: 'exec-omar' }] });
  assert.deepEqual(evaluate(right, ctx).findings.filter((f) => /PL-R11/.test(f)), []);
  // An open finding blocks only at `concluded`.
  const open = record({ findings: [{ id: 'F-1', summary: 'x', disposition: 'open' }] });
  assert.deepEqual(evaluate(open, ctx).findings.filter((f) => /PL-R11/.test(f)), []);
  const closedWithOpen = {
    ...open,
    status: 'concluded',
    exercises: [...open.exercises, { ax: 'AX-03', exercised_on: '2026-07-20', outcome: 'held', evidence: 'r' }],
    exit: { independent_report: 'r.md', report_author: 'risk-lena', second_line_confirmation: 'risk-lena', internal_audit_reperformance: 'IA-1' },
  };
  assert.ok(evaluate(closedWithOpen, ctx).findings.some((f) => /PL-R11.*still open/.test(f)));
});

test('PL-R12/PL-R13 — an "independent" report by a builder is not independent', () => {
  const base = record({
    status: 'concluded',
    exercises: [{ ax: 'AX-01', exercised_on: '2026-07-05', outcome: 'held', evidence: 'r' }, { ax: 'AX-03', exercised_on: '2026-07-20', outcome: 'held', evidence: 'r' }],
  });
  const byBuilder = { ...base, exit: { independent_report: 'r.md', report_author: 'dev-sam', second_line_confirmation: 'risk-lena', internal_audit_reperformance: 'IA-1' } };
  assert.ok(evaluate(byBuilder, ctx).findings.some((f) => /PL-R12.*builders.*entire content of this criterion/.test(f)));
  const noReport = { ...base, exit: { report_author: 'risk-lena', second_line_confirmation: 'risk-lena', internal_audit_reperformance: 'IA-1' } };
  assert.ok(evaluate(noReport, ctx).findings.some((f) => /PL-R12.*no `exit.independent_report`/.test(f)));
  const noConfirm = { ...base, exit: { independent_report: 'r.md', report_author: 'risk-lena', internal_audit_reperformance: 'IA-1' } };
  assert.ok(evaluate(noConfirm, ctx).findings.some((f) => /PL-R13/.test(f)));
  // Internal-audit re-performance is a NOTICE, never a block.
  const noAudit = { ...base, exit: { independent_report: 'r.md', report_author: 'risk-lena', second_line_confirmation: 'risk-lena' } };
  const r = evaluate(noAudit, ctx);
  assert.deepEqual(r.findings, [], r.findings.join('\n'));
  assert.ok(r.notices.some((n) => /PL-R14.*fabricate the field/.test(n)));
});

test('DORMANCY — a not-started record reports everything and fails nothing', () => {
  const broken = record({
    status: 'not-started',
    pilot_id: undefined,
    stage: 9,
    scope_bound: {},
    reversibility: {},
    supervision: { second_line_observer: 'dev-sam', accountable_executive: 'bot', observation_cadence_days: 0, observations: [] },
    exercises: [{ ax: 'AX-99', outcome: 'nope' }],
  });
  const dormant = evaluate(broken, ctx);
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  for (const rule of ['PL-R02', 'PL-R05', 'PL-R06', 'PL-R07', 'PL-R09']) {
    assert.ok(dormant.notices.some((n) => n.startsWith(rule)), `${rule} missing:\n${dormant.notices.join('\n')}`);
  }
  // Declared, the same record fails on all of them — dormant, not toothless.
  const live = evaluate({ ...broken, status: 'active' }, ctx);
  for (const rule of ['PL-R02', 'PL-R05', 'PL-R06', 'PL-R07', 'PL-R09']) {
    assert.ok(live.findings.some((f) => f.startsWith(rule)), `${rule} missing:\n${live.findings.join('\n')}`);
  }
});

test('the join is to the REAL playbook — its live rows are parsed from the shipped file', { skip: SKIP_NO_PLAYBOOK }, () => {
  const rows = parsePlaybook(readFileSync(PLAYBOOK_PATH, 'utf8'));
  assert.ok(rows && rows.length >= 20, `expected the shipped adversarial table, got ${rows && rows.length}`);
  // Ids are unique and sequential-ish; every row has an exercise description.
  assert.equal(new Set(rows.map((r) => r.ax)).size, rows.length, 'AX ids must be unique');
  assert.ok(rows.every((r) => r.exercise.length > 3));
  // The live rows are the pilot's actual obligation, and there are real ones.
  const live = rows.filter((r) => r.live);
  assert.ok(live.length >= 10, `expected the shipped live rows, got ${live.length}`);
  // A concluded pilot that exercised NONE of them is failed, naming them.
  const none = { status: 'concluded', pilot_id: 'P', stage: 6, stage_exits: [1, 2, 3, 4, 5].map((s) => exit_({ stage: s })), scope_bound: record().scope_bound, reversibility: record().reversibility, supervision: record().supervision, exercises: [], findings: [], exit: { independent_report: 'r.md', report_author: 'risk-lena', second_line_confirmation: 'risk-lena', internal_audit_reperformance: 'IA-1' } };
  const r = evaluate(none, { playbook: rows, registry: REGISTRY });
  assert.ok(r.findings.some((f) => /PL-R08/.test(f) && f.includes(live[0].ax)), r.findings.join('\n'));
});

test('parsePlaybook returns null rather than an empty pass when it cannot read the table', () => {
  for (const text of ['', null, '# a playbook with no table', '| not | an | ax | row |']) {
    assert.equal(parsePlaybook(text), null, JSON.stringify(text));
  }
  // A row that lost a column is skipped rather than half-read.
  assert.equal(parsePlaybook('| AX-01 | only two |'), null);
});

test('the SHIPPED TEMPLATE never reads as a declared pilot', { skip: SKIP_NO_TEMPLATE }, () => {
  const doc = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  assert.ok(isPlaceholder(doc.status));
  const r = evaluate(doc, ctx);
  assert.equal(r.armed, false);
  assert.deepEqual(r.findings, [], r.findings.join('\n'));
});

/** A repository with an optional pilot record and an optional playbook. */
function repo({ record: rec = null, playbook = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-pilot-'));
  mkdirSync(join(dir, 'docs/governance/runbooks'), { recursive: true });
  if (rec) writeFileSync(join(dir, 'docs/governance/pilot-record.json'), typeof rec === 'string' ? rec : JSON.stringify(rec));
  if (playbook) writeFileSync(join(dir, 'docs/governance/runbooks/pilot-playbook.md'), playbook);
  return dir;
}
const TABLE = ['| ID | Adversarial exercise | Control | Status |', '|---|---|---|---|', '| AX-01 | push | HG-0001 | **live** |', '| AX-03 | rollback | R3 | **live** |'].join('\n');

test('run() — INERT for a repository with no pilot record', () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.equal(r.present, false);
    assert.deepEqual(r.findings, []);
  } finally { clean(dir); }
});

test('run() — a declared pilot arms, and a broken one fails naming its rules', () => {
  const dir = repo({ record: { ...record(), supervision: { ...record().supervision, second_line_observer: 'dev-sam' } }, playbook: TABLE });
  try {
    // No registry mounted in this temp repo, so the builders check cannot run — but the record is
    // still armed and internally checked.
    const r = run(dir);
    assert.equal(r.armed, true);
    assert.equal(r.joined, true);
    assert.equal(r.status, 'active');
  } finally { clean(dir); }
});

test('run() — without a readable playbook the live-row obligation CANNOT be computed, and the gate says so', () => {
  const dir = repo({ record: record() });
  try {
    const r = run(dir);
    assert.equal(r.joined, false);
    assert.ok(r.notices.some((n) => /THE LIVE-ROW OBLIGATION \(PL-R08\) could not be computed/.test(n)), r.notices.join('\n'));
  } finally { clean(dir); }
});

test('run() — an unparseable record declares no pilot rather than failing closed', () => {
  const dir = repo({ record: '{not json', playbook: TABLE });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.armed, false);
    assert.ok(r.notices.some((n) => /not valid JSON/.test(n)));
  } finally { clean(dir); }
});
