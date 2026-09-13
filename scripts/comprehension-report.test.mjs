// Tests for comprehension telemetry. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byReviewer, trend, validate } from './comprehension-report.mjs';

const rec = (change_id, at, named_owner, review_minutes, pct_agent_generated, extra = {}) => ({
  change_id, at, named_owner, metrics: { review_minutes, pct_agent_generated, ...extra },
});
const RECORDS = [
  rec('CHG-1', '2026-01-10', 'eng-omar', 120, 40, { post_merge_defects: 0, emergency_reversals: 0 }),
  rec('CHG-2', '2026-02-10', 'eng-omar', 100, 55),
  rec('CHG-3', '2026-03-10', 'arch-tariq', 60, 70, { post_merge_defects: 2, emergency_reversals: 1, team_can_modify_without_agent: false }),
  rec('CHG-4', '2026-04-10', 'eng-omar', 40, 85),
];

test('per-reviewer rollup groups on the human accountable for explaining the change', () => {
  const b = byReviewer(RECORDS);
  assert.equal(b['eng-omar'].records, 3);
  assert.equal(b['eng-omar'].review_minutes.mean, 86.7);
  assert.equal(b['eng-omar'].pct_agent_generated.max, 85);
  assert.equal(b['arch-tariq'].post_merge_defects, 2);
  assert.equal(b['arch-tariq'].emergency_reversals, 1);
  assert.deepEqual(b['arch-tariq'].cannot_modify_without_agent, ['CHG-3']);
});

test('the trend is chronological and reports a direction on both metrics', () => {
  const t = trend(RECORDS);
  assert.deepEqual(t.series.map((s) => s.change_id), ['CHG-1', 'CHG-2', 'CHG-3', 'CHG-4']);
  assert.equal(t.direction.review_minutes.earlier_mean, 110);
  assert.equal(t.direction.review_minutes.later_mean, 50);
  assert.equal(t.direction.review_minutes.delta, -60);
  assert.equal(t.direction.pct_agent_generated.delta, 30); // 47.5 → 77.5: less review, more agent
});

test('too little history reports NULL rather than a decorated guess', () => {
  const t = trend(RECORDS.slice(0, 3));
  assert.equal(t.direction.review_minutes, null);
  assert.equal(t.direction.pct_agent_generated, null);
});

test('a missing metric is skipped, never counted as zero', () => {
  const b = byReviewer([rec('CHG-9', '2026-05-10', 'ops-dana', undefined, 30)]);
  assert.equal(b['ops-dana'].review_minutes, null);
  assert.equal(b['ops-dana'].pct_agent_generated.mean, 30);
  const t = trend([rec('CHG-9', '2026-05-10', 'ops-dana', undefined, 30)]);
  assert.equal(t.series[0].review_minutes, null);
});

test('--check validates SHAPE ONLY — a 100% agent-generated change is not a finding', () => {
  assert.deepEqual(validate(RECORDS), []);
  assert.deepEqual(validate([rec('CHG-X', '2026-01-01', 'eng-omar', 5, 100)]), []);
  assert.deepEqual(validate([{ change_id: 'CHG-Y' }]), []);
});

test('NEGATIVE — malformed metrics are findings, including the units error', () => {
  assert.ok(validate([rec('CHG-X', '2026-01-01', 'eng-omar', 'ages', 40)]).some((f) => /review_minutes must be a finite/.test(f)));
  assert.ok(validate([rec('CHG-X', '2026-01-01', 'eng-omar', 5, -1)]).some((f) => /pct_agent_generated must be a finite/.test(f)));
  assert.ok(validate([rec('CHG-X', '2026-01-01', 'eng-omar', 5, 780)]).some((f) => /units error/.test(f)));
  assert.ok(validate([{ change_id: 'CHG-X', metrics: [] }]).some((f) => /metrics is not an object/.test(f)));
  assert.ok(validate([{ change_id: 'CHG-X', named_owner: '', metrics: {} }]).some((f) => /cannot be grouped by reviewer/.test(f)));
});
