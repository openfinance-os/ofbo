// Tests for the adapter-conformance gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './adapter-check.mjs';

const CONTROLS = new Set(['HG-0001', 'OPS-READINESS']);
const GOOD = {
  adapter_id: 'gh-bp', system: 'github', satisfies_control: 'HG-0001',
  capability: 'required reviews + no direct push',
  evidence: { kind: 'branch-protection', envelope_fields: ['repository', 'required_reviews', 'fetched_at'] },
  activation_evidence: { fetched_at: '2026-07-20T00:00:00Z', direct_push_probe: 'rejected' },
};

test('a well-formed, active adapter to a real control passes with no notice', () => {
  const r = evaluate(GOOD, CONTROLS);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.notices, []);
});

test('mapping a control the catalog does not have is a mapping to nothing', () => {
  const r = evaluate({ ...GOOD, satisfies_control: 'NO-SUCH' }, CONTROLS);
  assert.ok(r.findings.some((f) => /is not a control in the catalog/.test(f)));
});

test('an adapter with no evidence kind or fields fails', () => {
  const r = evaluate({ ...GOOD, evidence: {} }, CONTROLS);
  assert.ok(r.findings.some((f) => /evidence.kind missing/.test(f)));
  assert.ok(r.findings.some((f) => /envelope_fields must list/.test(f)));
});

test('a reference mapping with only ADOPT placeholders is DECLARED, not active (notice, not failure)', () => {
  const ref = { ...GOOD, activation_evidence: { fetched_at: 'ADOPT: timestamp', direct_push_probe: 'ADOPT: rejected' } };
  const r = evaluate(ref, CONTROLS);
  assert.deepEqual(r.findings, []);
  assert.ok(r.notices.some((n) => /declared, not active/.test(n)));
});

test('a partially completed activation record remains declared, not active', () => {
  const partial = { ...GOOD, activation_evidence: { fetched_at: '2026-07-20T00:00:00Z', direct_push_probe: 'ADOPT: run the negative probe' } };
  const r = evaluate(partial, new Set(['HG-1']));
  assert.ok(r.notices.some((n) => /declared, not active/.test(n)));
});

test('missing core fields are findings', () => {
  const r = evaluate({ adapter_id: 'x' }, CONTROLS);
  assert.ok(r.findings.some((f) => /no system/.test(f)));
  assert.ok(r.findings.some((f) => /no satisfies_control/.test(f)));
  assert.ok(r.findings.some((f) => /no capability/.test(f)));
});
