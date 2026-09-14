// Tests for the doc-integrity gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlock, run, TARGETS } from './doc-integrity-check.mjs';

test('extractBlock reads content between markers, null when absent', () => {
  const text = 'before\n<!-- LOOM:X:START -->\nhello\n<!-- LOOM:X:END -->\nafter';
  assert.equal(extractBlock(text, 'X'), 'hello');
  assert.equal(extractBlock('no markers here', 'X'), null);
});

test('the shipped canon is in sync — every generated block matches its generator', async () => {
  // This is the gate itself: if a generator changed and the doc was not re-fixed, this fails.
  assert.deepEqual(await run(false), []);
});

test('the targets cover the copy table, the scorecard and the guardrail matrix', () => {
  const blocks = TARGETS.map((t) => t.block).sort();
  assert.deepEqual(blocks, ['COPY-TABLE', 'GUARDRAIL-MATRIX', 'SCORECARD']);
});
