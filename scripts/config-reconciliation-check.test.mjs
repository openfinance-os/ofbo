// Tests for the config-reconciliation gate (rc.12 · WS2.4). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './config-reconciliation-check.mjs';

const baseline = () => ({
  branch_protection: { required_status_checks_include: ['gates'], enforce_admins: true, allow_force_pushes: false, min_required_reviews: 1, require_code_owner_reviews: true },
  workflow_permissions: 'read',
  oidc_issuer: 'https://token.actions.githubusercontent.com',
});
const goodObs = () => ([{ mechanism: 'branch_protection', observation: { required_status_checks: ['gates'], enforce_admins: true, allow_force_pushes: false, required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: true } } }]);
const registry = (extra = []) => ({ identities: [{ id: 'risk-lena', kind: 'human', groups: ['second-line'] }, ...extra] });
const ev = (over = {}) => evaluate({ baseline: baseline(), observations: goodObs(), registry: registry(), envelope: { suspended: false }, ...over });

test('an in-baseline configuration reconciles with no drift', () => {
  assert.deepEqual(ev().findings, []);
});

test('a removed required status check is drift', () => {
  const o = goodObs(); o[0].observation.required_status_checks = [];
  assert.ok(ev({ observations: o }).findings.some((f) => /required check was removed/.test(f)));
});

test('re-enabled force pushes is drift', () => {
  const o = goodObs(); o[0].observation.allow_force_pushes = true;
  assert.ok(ev({ observations: o }).findings.some((f) => /history can be rewritten/.test(f)));
});

test('disabled enforce_admins is drift', () => {
  const o = goodObs(); o[0].observation.enforce_admins = false;
  assert.ok(ev({ observations: o }).findings.some((f) => /admins can now bypass/.test(f)));
});

test('weakened CODEOWNERS review requirement is drift', () => {
  const o = goodObs(); o[0].observation.required_pull_request_reviews.require_code_owner_reviews = false;
  assert.ok(ev({ observations: o }).findings.some((f) => /CODEOWNERS was weakened/.test(f)));
});

test('fewer required reviews is drift', () => {
  const o = goodObs(); o[0].observation.required_pull_request_reviews.required_approving_review_count = 0;
  assert.ok(ev({ observations: o }).findings.some((f) => /required approving reviews dropped/.test(f)));
});

test('a widened workflow token permission is drift', () => {
  const o = [...goodObs(), { mechanism: 'workflow_permissions', observation: { default_permissions: 'write' } }];
  assert.ok(ev({ observations: o }).findings.some((f) => /widened to write/.test(f)));
});

test('a changed OIDC issuer is drift', () => {
  const o = [...goodObs(), { mechanism: 'oidc_subjects', observation: { issuer: 'https://evil.example/oidc' } }];
  assert.ok(ev({ observations: o }).findings.some((f) => /trust anchor moved/.test(f)));
});

test('an AI identity added to an approval group is drift', () => {
  const r = registry([{ id: 'agent-x', kind: 'agent', groups: ['second-line'] }]);
  assert.ok(ev({ registry: r }).findings.some((f) => /must never hold approval authority/.test(f)));
});

test('an AI identity granted an approver role is drift', () => {
  const r = registry([{ id: 'agent-x', kind: 'agent', groups: ['builders'], roles: ['risk-second-line'] }]);
  assert.ok(ev({ registry: r }).findings.some((f) => /must hold no approver role/.test(f)));
});

test('drift present but routine autonomy NOT suspended adds a finding', () => {
  const o = goodObs(); o[0].observation.allow_force_pushes = true;
  const f = ev({ observations: o, envelope: { suspended: false } }).findings;
  assert.ok(f.some((x) => /routine auto-merge must be suspended/.test(x)));
});

test('drift present WITH routine autonomy suspended does not add the suspension finding', () => {
  const o = goodObs(); o[0].observation.allow_force_pushes = true;
  const f = ev({ observations: o, envelope: { suspended: true } }).findings;
  assert.ok(!f.some((x) => /routine auto-merge must be suspended/.test(x)));
  assert.ok(f.some((x) => /history can be rewritten/.test(x))); // the underlying drift still fails
});

test('a missing observation for a baselined mechanism is drift', () => {
  assert.ok(ev({ observations: [] }).findings.some((f) => /has the mechanism been removed/.test(f)));
});
