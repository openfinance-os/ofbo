// Tests for the product-eval gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './product-eval-check.mjs';

const SHA = 'a'.repeat(40);
const SEALED = { ref: 'evidence/product-eval.json', sha256: 'b'.repeat(64) };
const product = (over = {}) => ({
  product_id: 'PRD-1',
  discovery: 'credit-limit-review',
  success_measures: [
    { id: 'SM-1', statement: 'time-to-decision under 5s at p95', threshold: '<5s', result: 'pass', threshold_met: true },
  ],
  eval: {
    evaluated_commit: SHA, dataset_version: 'ds-3', runner_version: 'r-2', ran_at: '2026-07-20',
    result: 'pass', threshold_met: true, report: SEALED,
  },
  ...over,
});
const manifest = (p = product()) => ({ products: [p] });

test('a fresh, discovery-linked, all-green product eval passes', () => {
  assert.deepEqual(evaluate(manifest(), { shippingCommit: SHA }), []);
});

test('a present manifest with no products is a finding', () => {
  const f = evaluate({ products: [] }, {});
  assert.ok(f.some((m) => /declares no products/.test(m)));
});

test('NEGATIVE — a product with no discovery link fails (Loom-native: measures come from D1)', () => {
  const f = evaluate(manifest(product({ discovery: '' })), { shippingCommit: SHA });
  assert.ok(f.some((m) => /no discovery link/.test(m)));
});

test('NEGATIVE — a regressed success measure blocks the release', () => {
  const p = product({ success_measures: [{ id: 'SM-1', statement: 's', threshold: 't', result: 'fail', threshold_met: false }] });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /a regression blocks the release/.test(m)));
});

test('NEGATIVE — an eval run against a different commit is stale', () => {
  const p = product({ eval: { ...product().eval, evaluated_commit: 'c'.repeat(40) } });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /stale eval/.test(m)));
});

test('NEGATIVE — an eval with no evaluated_commit cannot be proven fresh', () => {
  const p = product({ eval: { ...product().eval, evaluated_commit: '' } });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /declares no evaluated_commit/.test(m)));
});

test('NEGATIVE — a failing eval verdict fails', () => {
  const p = product({ eval: { ...product().eval, result: 'fail', threshold_met: false } });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /eval did not pass its threshold/.test(m)));
});

test('NEGATIVE — an unsealed eval report fails', () => {
  const p = product({ eval: { ...product().eval, report: { ref: 'x', sha256: 'nope' } } });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /must be sealed/.test(m)));
});

test('NEGATIVE — a missing eval identity field (ran_at) fails', () => {
  const p = product({ eval: { ...product().eval, ran_at: '' } });
  const f = evaluate(manifest(p), { shippingCommit: SHA });
  assert.ok(f.some((m) => /declares no ran_at/.test(m)));
});

test('no shippingCommit → commit-match is skipped but the rest still binds', () => {
  assert.deepEqual(evaluate(manifest(), {}), []);
  const p = product({ eval: { ...product().eval, result: 'fail', threshold_met: false } });
  assert.ok(evaluate(manifest(p), {}).length > 0);
});

test('a manifest with no products array fails', () => {
  assert.ok(evaluate({}, {}).some((m) => /no `products` array/.test(m)));
});
