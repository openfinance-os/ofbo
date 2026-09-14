// Tests for the decision-log gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, buildChain } from './decision-log-check.mjs';

const REGISTRY = { identities: [
  { id: 'agent-x', kind: 'agent', roles: [], groups: ['builders'] },
  { id: 'eng-omar', kind: 'human', roles: ['engineering'], groups: ['builders'] },
] };
const raw = (n) => Array.from({ length: n }, (_, i) => ({
  seq: i, at: `2026-07-20T0${i}:00:00Z`, actor: 'agent-x', change_id: 'CHG-1',
  decision: `decision ${i}`, rationale: `because ${i}`, inputs_ref: `in-${i}.md`, tool_calls: [{ tool: 'read', target: 'x' }],
}));
const log = (n) => ({ entries: buildChain(raw(n)) });
const opts = { registry: REGISTRY };

test('a well-formed, contiguous, chained log passes', () => {
  assert.deepEqual(evaluate(log(3), opts), []);
});

test('an empty log is valid (the agent has not acted yet)', () => {
  assert.deepEqual(evaluate({ entries: [] }, opts), []);
});

test('APPEND-ONLY — editing an entry after logging breaks its seal', () => {
  const l = log(3);
  l.entries[1].decision = 'rewritten after the fact';
  assert.ok(evaluate(l, opts).some((x) => /seal mismatch/.test(x)));
});

test('field-boundary shuffle cannot forge a colliding seal (canonical encoding)', () => {
  // decision:"A\nB",rationale:"" vs decision:"A",rationale:"B" collided under a plain "\n".join.
  const base = { seq: 0, at: 't', actor: 'agent-x', change_id: 'CHG-1', inputs_ref: 'i', tool_calls: [] };
  const [x] = buildChain([{ ...base, decision: 'A\nB', rationale: '' }]);
  const [y] = buildChain([{ ...base, decision: 'A', rationale: 'B' }]);
  assert.notEqual(x.seal, y.seal, 'moving text across a field boundary must change the seal');
});

test('reordering entries breaks the chain', () => {
  const l = log(3);
  [l.entries[1], l.entries[2]] = [l.entries[2], l.entries[1]];
  assert.ok(evaluate(l, opts).some((x) => /broken chain|seal mismatch|sequence gap/.test(x)));
});

test('a dropped entry is a sequence gap, not a convenience', () => {
  const l = log(3);
  l.entries.splice(1, 1); // remove the middle decision
  assert.ok(evaluate(l, opts).some((x) => /sequence gap/.test(x)));
});

test('an entry that cannot be reconstructed (no rationale / inputs) fails', () => {
  const r = raw(1);
  delete r[0].rationale; delete r[0].inputs_ref;
  assert.ok(evaluate({ entries: buildChain(r) }, opts).some((x) => /no rationale/.test(x)));
});

test('the actor must be an AGENT identity — the log records the model’s reasoning', () => {
  const r = raw(1); r[0].actor = 'eng-omar';
  assert.ok(evaluate({ entries: buildChain(r) }, opts).some((x) => /is not an agent/.test(x)));
  const r2 = raw(1); r2[0].actor = 'ghost';
  assert.ok(evaluate({ entries: buildChain(r2) }, opts).some((x) => /not a registry identity/.test(x)));
});

test('tool_calls must be present as an array — what the agent DID', () => {
  const r = raw(1); delete r[0].tool_calls;
  assert.ok(evaluate({ entries: buildChain(r) }, opts).some((x) => /tool_calls must be an array/.test(x)));
});
