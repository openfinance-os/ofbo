// Tests for the trail-status report (2.1.0, plan row 2.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_STAGES, expectedFor, gateName, report } from './record-trail-status.mjs';

const CATALOG = { controls: [
  { control_id: 'A', mechanism_ref: 'scripts/a-check.mjs', lane: 'pr' },
  { control_id: 'B', mechanism_ref: 'scripts/b-check.mjs', lane: 'release' },
  { control_id: 'C', mechanism_ref: 'scripts/c-check.mjs', lane: 'deploy' },
  { control_id: 'D', mechanism_ref: 'scripts/a-check.mjs', lane: 'pr' },
  { control_id: 'E', mechanism_ref: 'scripts/e-check.mjs', lane: 'pr', execute: false },
  { control_id: 'F', mechanism_ref: 'docs/policy.md' },
] };

test('expected delivery records: the fixed stages plus one gate record per runnable pr/release mechanism, deduped, sorted', () => {
  assert.deepEqual(expectedFor('delivery', CATALOG), [...FIXED_STAGES.delivery, 'gate.scripts-a-check', 'gate.scripts-b-check']);
  assert.deepEqual(expectedFor('discovery', CATALOG), FIXED_STAGES.discovery);
  assert.equal(gateName('scripts/evidence-seal-check.mjs'), 'gate.scripts-evidence-seal-check');
});

test('report splits present, missing and extra by name', () => {
  const r = report(['risk-class', 'gate.x', 'gate.y'], [{ name: 'gate.x' }, { name: 'stray' }]);
  assert.deepEqual(r, { present: ['gate.x'], missing: ['risk-class', 'gate.y'], extra: ['stray'] });
});
