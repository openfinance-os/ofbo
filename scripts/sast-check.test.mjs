// Tests for the Q2 SAST output gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './sast-check.mjs';

const sarif = (results = [], rules = []) => ({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'demo-sast', rules } }, results }],
});

test('a clean report from a named tool passes', () => {
  assert.deepEqual(evaluate(sarif([])), []);
});

test('warnings within policy pass', () => {
  assert.deepEqual(evaluate(sarif([{ ruleId: 'r1', level: 'warning', message: { text: 'w' } }])), []);
});

test('an error-level finding fails the policy', () => {
  const findings = evaluate(sarif([{ ruleId: 'sqli', level: 'error', message: { text: 'SQL injection' } }]));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /1 error-level finding.*sqli: SQL injection/);
});

test('a result with no level inherits the rule default', () => {
  const rules = [{ id: 'hard', defaultConfiguration: { level: 'error' } }];
  const findings = evaluate(sarif([{ ruleId: 'hard', message: { text: 'x' } }], rules));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /error-level/);
});

test('too many warnings fail the policy', () => {
  const results = Array.from({ length: 3 }, (_, i) => ({ ruleId: `w${i}`, level: 'warning', message: { text: 'w' } }));
  const findings = evaluate(sarif(results), { maxWarnings: 2 });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /3 warning-level findings exceed/);
});

test('no runs, or an unnamed tool, is not evidence', () => {
  assert.match(evaluate({ runs: [] })[0], /no runs/);
  const anon = { runs: [{ tool: { driver: {} }, results: [] }] };
  assert.match(evaluate(anon)[0], /names no tool/);
});
