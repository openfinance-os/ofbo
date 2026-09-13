// Tests for the comprehension gate (rc.15 · WS8; sampling rc.41 · G5). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluate,
  hash32,
  loadPolicy,
  policyFindings,
  policyNotices,
  requirement,
  run,
  sampleReasons,
} from './comprehension-check.mjs';
// The saturation view lives in comprehension-report.mjs and its own suite is owned elsewhere this
// cycle, so its tests ride here. Same subject: the review resource and whether it is being reached.
import { saturation } from './comprehension-report.mjs';

const REGISTRY = { identities: [{ id: 'eng-omar', kind: 'human', groups: ['builders'] }, { id: 'agent-x', kind: 'agent' }] };
const record = (over = {}) => ({
  summary: 'a real human summary of the change',
  critical_path: 'request → score → overlay → write',
  architecture_explanation: 'stateless service behind the origination API',
  failure_modes: 'fails closed on stale features',
  named_owner: 'eng-omar',
  challenge_questions: [{ q: 'what if stale?', a: 'fails closed' }],
  decision_log_replay_ref: 'docs/governance/decision-log.json',
  metrics: { review_minutes: 95, change_complexity: 'high', pct_agent_generated: 78, reviewer_familiarity: 'medium' },
  ...over,
});
const ev = (r) => evaluate('CHG-1', r, { registry: REGISTRY });

test('a complete comprehension record for a high-tier change passes', () => {
  assert.deepEqual(ev(record()), []);
});

test('a high-tier change with NO comprehension record fails (mandatory-when-compiled)', () => {
  assert.ok(ev(null).some((f) => /has no comprehension.json/.test(f)));
});

test('a placeholder narrative field fails', () => {
  assert.ok(ev(record({ summary: 'TODO' })).some((f) => /summary is missing or a placeholder/.test(f)));
});

test('an agent named as the owner fails — an agent cannot be the human who understands', () => {
  assert.ok(ev(record({ named_owner: 'agent-x' })).some((f) => /is not a human registry identity/.test(f)));
});

test('an unresolved named_owner fails', () => {
  assert.ok(ev(record({ named_owner: 'ghost' })).some((f) => /is not a human registry identity/.test(f)));
});

test('missing challenge questions fail', () => {
  assert.ok(ev(record({ challenge_questions: [] })).some((f) => /no challenge_questions/.test(f)));
});

test('a missing decision-log replay reference fails', () => {
  assert.ok(ev(record({ decision_log_replay_ref: '' })).some((f) => /no decision_log_replay_ref/.test(f)));
});

test('a missing metric key fails (measured, though its value is not judged)', () => {
  const r = record(); delete r.metrics.pct_agent_generated;
  assert.ok(ev(r).some((f) => /metric "pct_agent_generated" not recorded/.test(f)));
});

test('a metric value is NOT judged — a high pct_agent_generated still passes', () => {
  assert.deepEqual(ev(record({ metrics: { review_minutes: 5, change_complexity: 'low', pct_agent_generated: 100, reviewer_familiarity: 'low' } })), []);
});

// ── the deterministic selector (G5) ──────────────────────────────────────────────────────────────

test('hash32 is DETERMINISTIC — the same id hashes the same twice, and in a fresh call chain', () => {
  assert.equal(hash32('CHG-42'), hash32('CHG-42'));
  const first = [...Array(5)].map(() => hash32('CHG-42'));
  assert.equal(new Set(first).size, 1);
  assert.notEqual(hash32('CHG-42'), hash32('CHG-43'));
  assert.ok(Number.isInteger(hash32('CHG-42')) && hash32('CHG-42') >= 0 && hash32('CHG-42') < 2 ** 32);
});

test('the sample decision is REPRODUCIBLE — same id + same policy → same answer, twice', () => {
  const policy = { medium_sample_rate: 0.5 };
  for (const id of ['CHG-1', 'CHG-2', 'CHG-3', 'CHG-4', 'CHG-5']) {
    assert.deepEqual(sampleReasons(id, policy), sampleReasons(id, policy));
    assert.deepEqual(
      requirement(id, { tier: 'medium', policy }),
      requirement(id, { tier: 'medium', policy }),
    );
  }
});

test('rate 1 samples every id; rate 0 samples none; an absent policy samples none', () => {
  const ids = ['CHG-1', 'CHG-2', 'CHG-3', 'CHG-4', 'CHG-5', 'CHG-6'];
  assert.ok(ids.every((id) => sampleReasons(id, { medium_sample_rate: 1 }).length > 0));
  assert.ok(ids.every((id) => sampleReasons(id, { medium_sample_rate: 0 }).length === 0));
  assert.ok(ids.every((id) => sampleReasons(id, null).length === 0));
});

test('every_nth selects roughly 1/n of ids, and the SAME ids each run', () => {
  const ids = [...Array(200)].map((_, i) => `CHG-${i}`);
  const picked = ids.filter((id) => sampleReasons(id, { every_nth: 4 }).length > 0);
  assert.ok(picked.length > 20 && picked.length < 80, `expected ~50 of 200, got ${picked.length}`);
  assert.deepEqual(picked, ids.filter((id) => sampleReasons(id, { every_nth: 4 }).length > 0));
});

test('both selectors set is a UNION — either one picking is enough', () => {
  const both = { medium_sample_rate: 1, every_nth: 1 };
  assert.deepEqual(sampleReasons('CHG-1', both), ['medium_sample_rate 1', 'every_nth 1']);
  assert.deepEqual(sampleReasons('CHG-1', { medium_sample_rate: 0, every_nth: 1 }), ['every_nth 1']);
});

// ── which changes are selected ───────────────────────────────────────────────────────────────────

test('high/critical are selected on TIER, with or without a policy', () => {
  for (const tier of ['high', 'critical']) {
    assert.deepEqual(requirement('CHG-1', { tier }), { required: true, basis: 'tier', detail: tier });
  }
});

test('low and medium are NOT selected when no policy is configured (today\'s behaviour)', () => {
  for (const tier of ['low', 'medium']) {
    assert.equal(requirement('CHG-1', { tier }).required, false);
  }
});

test('a sampled MEDIUM change is selected, and says so', () => {
  const r = requirement('CHG-1', { tier: 'medium', policy: { medium_sample_rate: 1 } });
  assert.equal(r.required, true);
  assert.equal(r.basis, 'sampled');
  assert.match(r.detail, /medium_sample_rate 1/);
});

test('sampling does NOT reach low tier — the band the second line configured is medium', () => {
  assert.equal(requirement('CHG-1', { tier: 'low', policy: { medium_sample_rate: 1, every_nth: 1 } }).required, false);
});

test('an always-comprehend capability selects at ANY tier, ahead of sampling', () => {
  const policy = { always_comprehend_capabilities: ['product_structure'] };
  const capabilities = { product_structure: { required: true } };
  const r = requirement('CHG-1', { tier: 'low', capabilities, policy });
  assert.deepEqual(r, { required: true, basis: 'always-capability', detail: 'product_structure' });
});

test('an always-comprehend capability that is NOT required by the plan selects nothing', () => {
  const policy = { always_comprehend_capabilities: ['product_structure'] };
  assert.equal(requirement('CHG-1', { tier: 'low', capabilities: { product_structure: { required: false } }, policy }).required, false);
  assert.equal(requirement('CHG-1', { tier: 'low', capabilities: {}, policy }).required, false);
});

test('tier beats every other basis — a high change is reported as tier-selected, not sampled', () => {
  const policy = { medium_sample_rate: 1, always_comprehend_capabilities: ['x'] };
  assert.equal(requirement('CHG-1', { tier: 'high', capabilities: { x: { required: true } }, policy }).basis, 'tier');
});

// ── the finding a selection produces ─────────────────────────────────────────────────────────────

test('the missing-record finding NAMES the basis that selected the change', () => {
  assert.match(evaluate('CHG-1', null, { basis: 'tier' })[0], /high-tier change has no comprehension.json/);
  assert.match(evaluate('CHG-1', null, { basis: 'sampled', detail: 'every_nth 5' })[0], /SAMPLED for comprehension \(every_nth 5/);
  assert.match(evaluate('CHG-1', null, { basis: 'sampled', detail: 'every_nth 5' })[0], /same on every run and for every reviewer/);
  assert.match(evaluate('CHG-1', null, { basis: 'always-capability', detail: 'product_structure' })[0], /always_comprehend_capabilities/);
});

// ── policy shape and the visible zero ────────────────────────────────────────────────────────────

test('an absent policy is valid and says nothing', () => {
  assert.deepEqual(policyFindings(null), []);
  assert.deepEqual(policyFindings(undefined), []);
  assert.deepEqual(policyNotices(null), []);
});

test('a malformed rate FAILS rather than degrading to silent no-sampling', () => {
  assert.match(policyFindings({ medium_sample_rate: '20%' })[0], /must be a number between 0 and 1/);
  assert.match(policyFindings({ medium_sample_rate: 20 })[0], /must be a number between 0 and 1/);
  assert.match(policyFindings({ medium_sample_rate: -1 })[0], /must be a number between 0 and 1/);
  assert.match(policyFindings({ every_nth: 0 })[0], /must be a positive integer/);
  assert.match(policyFindings({ every_nth: 2.5 })[0], /must be a positive integer/);
  assert.match(policyFindings({ always_comprehend_capabilities: 'product_structure' })[0], /must be an array of capability names/);
  assert.match(policyFindings([])[0], /must be an object/);
  assert.deepEqual(policyFindings({ medium_sample_rate: 0.2, every_nth: 5, always_comprehend_capabilities: ['a'] }), []);
});

test('a rate of 0 is a DECISION and is reported — a notice, never a finding', () => {
  assert.deepEqual(policyFindings({ medium_sample_rate: 0 }), []);
  assert.match(policyNotices({ medium_sample_rate: 0 })[0], /NO medium-tier change is sampled/);
  // …unless every_nth still selects, in which case nothing has been switched off.
  assert.deepEqual(policyNotices({ medium_sample_rate: 0, every_nth: 5 }), []);
  assert.deepEqual(policyNotices({ medium_sample_rate: 0.2 }), []);
});

// ── run(): end to end on a temp repo ─────────────────────────────────────────────────────────────

const clean = (d) => rmSync(d, { recursive: true, force: true });

/** A temp repo with one change, optional plan capabilities, optional approval-SLA policy block. */
function repo({ id = 'CHG-1', tier = 'medium', capabilities = null, policy = undefined, comprehension = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'comp-'));
  const base = join(dir, 'docs/governance/changes', id);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: id, risk_tier: tier, current_state: 'in-delivery' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: [], required_capabilities: capabilities || {} }));
  if (comprehension) writeFileSync(join(base, 'comprehension.json'), JSON.stringify(comprehension));
  if (policy !== undefined) {
    writeFileSync(join(dir, 'docs/governance/approval-sla.json'), JSON.stringify({ default_target_days: 10, comprehension: policy }));
  }
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  return dir;
}

test('STRICTLY ADDITIVE: a repo with no policy behaves exactly as before — medium is silent', () => {
  const dir = repo({ tier: 'medium' });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.count, 0);
    assert.equal(r.policy, false);
    assert.equal(r.inert, true);
  } finally { clean(dir); }
});

test('STRICTLY ADDITIVE: a high-tier change with no policy still fails without a record', () => {
  const dir = repo({ tier: 'high' });
  try {
    const r = run(dir);
    assert.equal(r.by_basis.tier, 1);
    assert.ok(r.findings.some((f) => /high-tier change has no comprehension.json/.test(f)));
  } finally { clean(dir); }
});

test('a sampled medium change with no record FAILS, naming the change id', () => {
  const dir = repo({ tier: 'medium', policy: { medium_sample_rate: 1 } });
  try {
    const r = run(dir);
    assert.equal(r.by_basis.sampled, 1);
    assert.ok(r.findings.some((f) => /^CHG-1: has no comprehension.json — this medium-tier change was SAMPLED/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('a sampled medium change WITH a complete record passes', () => {
  const dir = repo({ tier: 'medium', policy: { medium_sample_rate: 1 }, comprehension: record() });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.count, 1);
    assert.equal(r.inert, false);
  } finally { clean(dir); }
});

test('an always-comprehend capability fails a LOW-tier change with no record', () => {
  const dir = repo({
    tier: 'low',
    capabilities: { product_structure: { required: true } },
    policy: { always_comprehend_capabilities: ['product_structure'] },
  });
  try {
    const r = run(dir);
    assert.equal(r.by_basis['always-capability'], 1);
    assert.ok(r.findings.some((f) => /always_comprehend_capabilities/.test(f)));
  } finally { clean(dir); }
});

test('run() surfaces the visible-zero notice and no finding', () => {
  const dir = repo({ tier: 'medium', policy: { medium_sample_rate: 0 } });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.notices.length, 1);
    assert.match(r.notices[0], /NO medium-tier change is sampled/);
  } finally { clean(dir); }
});

test('run() fails a malformed policy even when no change is selected', () => {
  const dir = repo({ tier: 'low', policy: { medium_sample_rate: '20%' } });
  try {
    const r = run(dir);
    assert.equal(r.count, 0);
    assert.ok(r.findings.some((f) => /medium_sample_rate must be a number/.test(f)));
    assert.equal(r.inert, false);
  } finally { clean(dir); }
});

test('run() is DETERMINISTIC across runs — the same tree selects the same changes twice', () => {
  const dir = repo({ id: 'CHG-STABLE', tier: 'medium', policy: { medium_sample_rate: 0.5, every_nth: 3 } });
  try {
    const a = run(dir);
    const b = run(dir);
    assert.deepEqual(a.by_basis, b.by_basis);
    assert.deepEqual(a.findings, b.findings);
  } finally { clean(dir); }
});

test('loadPolicy reads the comprehension block from the approval-SLA file, or null', () => {
  const withPolicy = repo({ policy: { every_nth: 7 } });
  try { assert.deepEqual(loadPolicy(withPolicy), { every_nth: 7 }); } finally { clean(withPolicy); }
  const without = repo({});
  try { assert.equal(loadPolicy(without), null); } finally { clean(without); }
});

test('a repo with no changes tree is inert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comp-'));
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.inert, true);
  } finally { clean(dir); }
});

// ── saturation (comprehension-report.mjs) ────────────────────────────────────────────────────────

const row = (over = {}) => ({ change_id: 'CHG-1', stage: 'PA2', role: 'risk-second-line', age_days: 3, target_days: 5, breached: false, ...over });

test('saturation counts DISTINCT open changes per approver role, not queue rows', () => {
  const rows = [
    row({ change_id: 'CHG-1', stage: 'PA1' }),
    row({ change_id: 'CHG-1', stage: 'PA2' }),
    row({ change_id: 'CHG-2', stage: 'PA2', age_days: 40, breached: true }),
  ];
  const s = saturation(rows, [], { sla: { wip_limit_per_role: 1 } });
  const b = s.per_role['risk-second-line'];
  assert.equal(b.open_changes, 2);
  assert.equal(b.outstanding_approvals, 3);
  assert.equal(b.over_target, 1);
  assert.equal(b.oldest_days, 40);
  assert.equal(b.over_wip_limit, true);
  assert.equal(s.open_changes, 2);
  assert.equal(s.wip_limit, 1);
});

test('saturation makes a committee-cadence bottleneck visible as a number', () => {
  const rows = ['CHG-1', 'CHG-2', 'CHG-3', 'CHG-4'].map((id) => row({ change_id: id, role: 'a-committee-role' }));
  const s = saturation(rows, [], { sla: { wip_limit_per_role: 2 } });
  assert.equal(s.per_role['a-committee-role'].open_changes, 4);
  assert.equal(s.per_role['a-committee-role'].over_wip_limit, true);
});

test('saturation per reviewer counts open changes only, excluding terminal ones', () => {
  const s = saturation([], [
    { change_id: 'CHG-1', named_owner: 'eng-omar', current_state: 'in-delivery' },
    { change_id: 'CHG-2', named_owner: 'eng-omar', current_state: 'in-production' },
    { change_id: 'CHG-3', named_owner: 'eng-omar', current_state: 'closed' },
    { change_id: 'CHG-4', named_owner: 'eng-omar', current_state: 'superseded' },
    { change_id: 'CHG-5', current_state: 'in-delivery' },
  ]);
  assert.equal(s.per_reviewer['eng-omar'].open_changes, 2);
  assert.deepEqual(s.per_reviewer['eng-omar'].changes, ['CHG-1', 'CHG-2']);
  assert.equal(s.per_reviewer['(no named_owner)'].open_changes, 1);
});

test('saturation with nothing to report is empty, not an error', () => {
  assert.deepEqual(saturation(), { per_role: {}, per_reviewer: {}, wip_limit: null, open_changes: 0 });
});
