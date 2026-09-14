// Tests for flow telemetry. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployments, gateWallClock, leadTimes, operationsFlow, stageResidency, validate } from './flow-report.mjs';

const DONE = {
  change_id: 'CHG-1',
  state_history: [
    { state: 'classified', at: '2026-01-01T00:00:00Z' },
    { state: 'permission-to-develop', at: '2026-01-03T00:00:00Z' },
    { state: 'in-delivery', at: '2026-01-04T00:00:00Z' },
    { state: 'in-production', at: '2026-01-11T00:00:00Z' },
  ],
};
const OPEN = {
  change_id: 'CHG-2',
  state_history: [
    { state: 'classified', at: '2026-01-05T00:00:00Z' },
    { state: 'permission-to-develop', at: '2026-01-06T00:00:00Z' },
  ],
};

test('lead time is classified → in-production, and an unfinished change is NOT folded in at zero', () => {
  const l = leadTimes([DONE, OPEN]);
  assert.equal(l.n, 1);
  assert.equal(l.completed[0].days, 10);
  assert.equal(l.mean_days, 10);
  assert.equal(l.median_days, 10);
  assert.equal(l.in_flight.length, 1);
  assert.equal(l.in_flight[0].change_id, 'CHG-2');
  assert.equal(l.in_flight[0].state, 'permission-to-develop');
});

test('no completed change is reported as "none", never as a confident zero', () => {
  const l = leadTimes([OPEN]);
  assert.equal(l.n, 0);
  assert.equal(l.mean_days, null);
  assert.equal(l.median_days, null);
});

test('stage residency measures each interval; the last state of an open change accrues to now', () => {
  const now = Date.parse('2026-01-11T00:00:00Z');
  const s = stageResidency([DONE], now);
  assert.equal(s.classified.total_days, 2);
  assert.equal(s['permission-to-develop'].total_days, 1);
  assert.equal(s['in-delivery'].total_days, 7);
  assert.equal(s['in-production'].open, 1);
  const open = stageResidency([OPEN], Date.parse('2026-01-09T00:00:00Z'));
  assert.equal(open['permission-to-develop'].total_days, 3);
  assert.equal(open['permission-to-develop'].open, 1);
});

test('deployment frequency counts dated production transitions AND sealed release records, separately', () => {
  const d = deployments([DONE, OPEN], [{ kind: 'evidence-manifest', at: null }, { kind: 'release-subject', at: '2026-01-11T00:00:00Z' }], Date.parse('2026-01-18T00:00:00Z'));
  assert.equal(d.production_transitions, 1);
  assert.equal(d.release_records, 2);
  assert.equal(d.dated_release_records, 1);
  assert.equal(d.per_week, 1); // one transition over a seven-day span
});

test('change-failure rate names its denominator, and is null rather than zero when there is none', () => {
  const signals = [
    { id: 'S1', type: 'incident', detected: '2026-01-12T00:00:00Z', resolved_at: '2026-01-12T04:00:00Z', caused_by_change: 'CHG-1' },
    { id: 'S2', type: 'slo-breach', detected: '2026-01-13T00:00:00Z' },
    { id: 'S3', type: 'regulatory', detected: '2026-01-14T00:00:00Z' },
  ];
  const o = operationsFlow(signals, [DONE, OPEN]);
  assert.equal(o.changes_in_production, 1);
  assert.equal(o.failure_signals, 2);          // the regulatory signal is not a change failure
  assert.equal(o.unattributed_failure_signals, 1);
  assert.equal(o.change_failure_rate, 1);
  assert.equal(o.mttr_hours, 4);
  assert.equal(o.open_signals, 2);
  assert.equal(operationsFlow(signals, [OPEN]).change_failure_rate, null);
});

test('gate wall-clock aggregates per lane from the runner\'s own ms', () => {
  const runs = [
    { lane: 'pr', executed: [{ mechanism: 'a.mjs', ms: 300 }, { mechanism: 'b.mjs', ms: 1200 }], skipped: [{ id: 'X', reason: 'r' }] },
    { lane: 'pr', executed: [{ mechanism: 'a.mjs', ms: 100 }], skipped: [] },
    { lane: 'release', executed: [{ mechanism: 'c.mjs', ms: 50 }], skipped: [] },
  ];
  const c = gateWallClock(runs);
  assert.equal(c.pr.runs, 2);
  assert.equal(c.pr.mechanisms, 3);
  assert.equal(c.pr.total_ms, 1600);
  assert.equal(c.pr.skipped, 1);
  assert.equal(c.pr.slowest[0].mechanism, 'b.mjs');
  assert.equal(c.release.total_ms, 50);
});

test('--check validates SHAPE ONLY — an empty tree is valid, a slow gate is not a finding', () => {
  assert.deepEqual(validate({}), []);
  assert.deepEqual(validate({ changes: [DONE, OPEN], signals: [{ id: 'S', type: 'incident' }], runs: [{ lane: 'pr', executed: [{ mechanism: 'a.mjs', ms: 9_000_000 }] }] }), []);
});

test('NEGATIVE — malformed inputs are findings: unparseable at, bad resolved_at, missing ms', () => {
  assert.ok(validate({ changes: [{ change_id: 'X', state_history: [{ state: 'classified', at: 'someday' }] }] })
    .some((f) => /is not a timestamp/.test(f)));
  assert.ok(validate({ changes: [{ change_id: 'X', state_history: {} }] })
    .some((f) => /state_history is not an array/.test(f)));
  assert.ok(validate({ signals: [{ id: 'S', resolved_at: 'eventually' }] })
    .some((f) => /resolved_at .* is not a timestamp/.test(f)));
  assert.ok(validate({ signals: [{ id: 'S', caused_by_change: 7 }] })
    .some((f) => /caused_by_change is not a change id/.test(f)));
  assert.ok(validate({ runs: [{ lane: 'pr', executed: [{ mechanism: 'a.mjs' }] }] })
    .some((f) => /no numeric ms/.test(f)));
});

test('a change with no state_history is skipped, not counted as instantaneous', () => {
  const l = leadTimes([{ change_id: 'CHG-0' }]);
  assert.equal(l.n, 0);
  assert.equal(l.in_flight.length, 0);
  assert.deepEqual(validate({ changes: [{ change_id: 'CHG-0' }] }), []);
});
