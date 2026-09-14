// Tests for the control-catalog gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, STATES } from './control-catalog-check.mjs';

const EXISTS = () => true;
const base = {
  control_id: 'HG-0002',
  objective: 'The agent cannot change its own guardrails without four-eyes',
  owner_role: 'platform-admin',
  line: 1,
  state: 'mechanically-validated',
  mechanism_ref: 'scripts/control-plane-check.mjs',
  test_ref: 'scripts/control-plane-check.test.mjs',
};
const cat = (c) => ({ controls: [{ ...base, ...c }] });

test('a well-formed mechanically-validated control passes', () => {
  assert.deepEqual(evaluate(cat({}), EXISTS), []);
});

test('the five states are exactly the plan §3 states', () => {
  assert.deepEqual(STATES, ['absent', 'defined', 'mechanically-validated', 'platform-enforced', 'organisationally-enforced']);
});

test('an unknown state is rejected', () => {
  assert.ok(evaluate(cat({ state: 'enforced' }), EXISTS).some((x) => /state must be one of/.test(x)));
});

test('mechanically-validated without a mechanism is an overstated catalog', () => {
  const f = evaluate(cat({ mechanism_ref: undefined }), EXISTS);
  assert.ok(f.some((x) => /no mechanism_ref/.test(x)));
});

test('platform-enforced demands a bypass test AND activation evidence', () => {
  const f = evaluate(cat({ state: 'platform-enforced', test_ref: undefined, activation_evidence: undefined }), EXISTS);
  assert.ok(f.some((x) => /no test_ref/.test(x)));
  assert.ok(f.some((x) => /no activation_evidence/.test(x)));
});

test('organisationally-enforced demands a named independent owner', () => {
  const f = evaluate(cat({ state: 'organisationally-enforced', activation_evidence: 'x', independent_owner: undefined }), EXISTS);
  assert.ok(f.some((x) => /no independent_owner/.test(x)));
});

test('absent must be named, defined must cite its document', () => {
  assert.ok(evaluate(cat({ state: 'absent', mechanism_ref: undefined, note: undefined }), EXISTS).some((x) => /no note/.test(x)));
  assert.ok(evaluate(cat({ state: 'defined', doc_ref: undefined }), EXISTS).some((x) => /no doc_ref/.test(x)));
});

test('a cited file that does not exist is a ghost — and fails', () => {
  const f = evaluate(cat({}), (p) => p !== 'scripts/control-plane-check.mjs');
  assert.ok(f.some((x) => /cites a ghost/.test(x)));
});

test('duplicate ids and an empty catalog are findings', () => {
  const dup = { controls: [{ ...base }, { ...base }] };
  assert.ok(evaluate(dup, EXISTS).some((x) => /duplicate control_id/.test(x)));
  assert.match(evaluate({ controls: [] }, EXISTS)[0], /no control state of record/);
});

/* ---- rc.40 (flow-plan Phase 6.1): depends_on, the runner's wave ordering ---- */

const two = (a, b) => ({ controls: [{ ...base, control_id: 'A', ...a }, { ...base, control_id: 'B', ...b }] });

test('a well-formed depends_on edge between two real controls passes', () => {
  assert.deepEqual(evaluate(two({}, { depends_on: ['A'] }), EXISTS), []);
});

test('depends_on must be an array of control_ids, and may not name itself', () => {
  assert.ok(evaluate(cat({ depends_on: 'HG-0001' }), EXISTS).some((x) => /must be an array of control_ids/.test(x)));
  assert.ok(evaluate(cat({ depends_on: [''] }), EXISTS).some((x) => /must be an array of control_ids/.test(x)));
  assert.ok(evaluate(cat({ depends_on: ['HG-0002'] }), EXISTS).some((x) => /names itself/.test(x)));
});

test('a depends_on edge to a control that does not exist is a barrier that can never be satisfied', () => {
  const f = evaluate(cat({ depends_on: ['NO-SUCH'] }), EXISTS);
  assert.ok(f.some((x) => /no such control_id/.test(x)));
});

test('a depends_on CYCLE fails the catalog — the runner refuses to execute one', () => {
  const f = evaluate(two({ depends_on: ['B'] }, { depends_on: ['A'] }), EXISTS);
  assert.ok(f.some((x) => /depends_on cycle/.test(x)), `expected a cycle finding, got ${JSON.stringify(f)}`);
});

test('a longer cycle is caught too, and a diamond is not a cycle', () => {
  const mk = (id, deps) => ({ ...base, control_id: id, ...(deps ? { depends_on: deps } : {}) });
  const cycle = { controls: [mk('A', ['C']), mk('B', ['A']), mk('C', ['B'])] };
  assert.ok(evaluate(cycle, EXISTS).some((x) => /depends_on cycle/.test(x)));
  const diamond = { controls: [mk('A'), mk('B', ['A']), mk('C', ['A']), mk('D', ['B', 'C'])] };
  assert.deepEqual(evaluate(diamond, EXISTS), []);
});
