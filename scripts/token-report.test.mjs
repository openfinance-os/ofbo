// Tests for token telemetry. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, validate } from './token-report.mjs';

const ledger = {
  entries: [
    { iteration: 'STORY-1', milestone: 'M2', output_tokens: 1000, pr: 10 },
    { iteration: 'STORY-2', milestone: 'M2', output_tokens: 1500, pr: 11 },
    { iteration: 'STORY-3', milestone: 'M3', output_tokens: 500, pr: 12 },
  ],
};

test('aggregate totals per iteration and per milestone', () => {
  const a = aggregate(ledger);
  assert.equal(a.total_output_tokens, 3000);
  assert.equal(a.iterations, 3);
  assert.equal(a.by_milestone.M2, 2500);
  assert.equal(a.by_milestone.M3, 500);
  assert.equal(a.by_iteration['STORY-2'], 1500);
});

test('an empty ledger aggregates to zero and validates clean', () => {
  assert.deepEqual(aggregate({ entries: [] }), { total_output_tokens: 0, iterations: 0, by_iteration: {}, by_milestone: {} });
  assert.deepEqual(validate({ entries: [] }), []);
});

test('a well-formed ledger validates clean', () => {
  assert.deepEqual(validate(ledger), []);
});

test('NEGATIVE — a non-numeric output_tokens is rejected', () => {
  const f = validate({ entries: [{ iteration: 'STORY-1', output_tokens: 'lots' }] });
  assert.ok(f.some((m) => /output_tokens must be a finite, non-negative number/.test(m)));
});

test('NEGATIVE — an entry with no iteration id is rejected', () => {
  const f = validate({ entries: [{ output_tokens: 5 }] });
  assert.ok(f.some((m) => /no iteration id/.test(m)));
});

test('NEGATIVE — a negative token count is rejected', () => {
  const f = validate({ entries: [{ iteration: 'X', output_tokens: -3 }] });
  assert.ok(f.some((m) => /non-negative/.test(m)));
});

test('a ledger with no entries array is malformed', () => {
  assert.ok(validate({}).some((m) => /no `entries` array/.test(m)));
});
