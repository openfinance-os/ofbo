// Tests for the architecture-assurance gate (A1–A5). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, SECTIONS, scopeOf } from './architecture-assurance-check.mjs';

import { existsSync } from 'node:fs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The fixture resolves in BOTH layouts: the bundle (change-example/) and an adopted repo that
// mounted the worked example (docs/governance/changes/CHG-2026-0042/). In a BARE adoption it is
// in neither, so skip cleanly rather than crash at module load — the pure evaluate() logic is
// covered by the negative cases against the mounted example wherever it exists.
const GOOD_PATH = ['change-example/architecture-assurance.json', 'docs/governance/changes/CHG-2026-0042/architecture-assurance.json']
  .map((c) => `${HARNESS}/${c}`).find(existsSync);
if (!GOOD_PATH) {
  test('architecture-assurance gate (worked-example fixture is bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const GOOD = JSON.parse(readFileSync(GOOD_PATH, 'utf8'));

test('the shipped worked example passes A1–A5', () => {
  assert.deepEqual(evaluate(GOOD, 'CHG-X'), []);
});

test('a missing artifact blocks when the plan requires A', () => {
  assert.match(evaluate(null, 'CHG-X')[0], /architecture-assurance\.json missing/);
});

test('each missing or incomplete section is its own finding', () => {
  const { 'A3-operational-resilience': _, ...rest } = GOOD;
  const f = evaluate(rest, 'CHG-X');
  assert.ok(f.some((x) => /A3-operational-resilience: section missing/.test(x)));
  const stale = { ...GOOD, 'A4-model-risk': { ...GOOD['A4-model-risk'], status: 'draft' } };
  assert.ok(evaluate(stale, 'CHG-X').some((x) => /A4-model-risk: status is "draft"/.test(x)));
});

test('TRACEABILITY — a threat without a control or a test fails', () => {
  const a2 = { ...GOOD['A2-security-threat-model'], threats: [{ threat: 'evidence forgery', control: '', test: '' }] };
  const f = evaluate({ ...GOOD, 'A2-security-threat-model': a2 }, 'CHG-X');
  assert.ok(f.some((x) => /no control/.test(x)));
  assert.ok(f.some((x) => /no test/.test(x)));
});

test('an empty threat list is not a threat model', () => {
  const a2 = { ...GOOD['A2-security-threat-model'], threats: [] };
  assert.ok(evaluate({ ...GOOD, 'A2-security-threat-model': a2 }, 'CHG-X').some((x) => /name them/.test(x)));
});

test('a material OPEN finding blocks backlog creation; accepted or minor does not', () => {
  const open = { ...GOOD, findings: [{ id: 'AF-9', materiality: 'material', status: 'open' }] };
  assert.ok(evaluate(open, 'CHG-X').some((x) => /material finding AF-9 is OPEN/.test(x)));
  const accepted = { ...GOOD, findings: [{ id: 'AF-9', materiality: 'material', status: 'accepted' }] };
  assert.deepEqual(evaluate(accepted, 'CHG-X'), []);
});

test('the section set is exactly A1–A5', () => {
  assert.equal(SECTIONS.length, 5);
  assert.ok(SECTIONS.every((s) => /^A[1-5]-/.test(s)));
});

/* ---- 2.1.0 (hardening plan 4.6): A2 alone at medium ---- */

test('A2 SCOPE — a plan with the threat_model capability and no A gate is in scope for A2 alone', () => {
  assert.equal(scopeOf({ required_gates: ['A'] }), 'A');
  assert.equal(scopeOf({ required_gates: ['PA1', 'PA2'], required_capabilities: { threat_model: { required: true } } }), 'A2');
  assert.equal(scopeOf({ required_gates: ['PA1'] }), null);
});

test('A2 SCOPE — the threat model alone is judged: a missing artifact fails, missing A1/A3–A5 do not, an untraced threat still does', () => {
  assert.match(evaluate(null, 'CHG-M', { scope: 'A2' })[0], /A2 threat model is owed/);
  const a2Only = { change_id: 'CHG-M', 'A2-security-threat-model': GOOD['A2-security-threat-model'] };
  assert.deepEqual(evaluate(a2Only, 'CHG-M', { scope: 'A2' }), []);
  assert.ok(evaluate(a2Only, 'CHG-M').some((x) => /A1-data-privacy: section missing/.test(x)), 'the full scope still demands every section');
  const untraced = { ...a2Only, 'A2-security-threat-model': { status: 'complete', threats: [{ threat: 'prompt injection', control: 'pii-guard' }] } };
  assert.ok(evaluate(untraced, 'CHG-M', { scope: 'A2' }).some((x) => /no test — every threat traces to a control and a test/.test(x)));
});
}
