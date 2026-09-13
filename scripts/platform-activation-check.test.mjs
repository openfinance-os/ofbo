// Tests for the platform-activation gate (rc.12 · WS2). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, activationHash, checkGraduation, run } from './platform-activation-check.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const ISSUERS = { issuers: [{ id: 'obs', mechanism: 'ed25519', verify: { public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString() } }] };
const REGISTRY = { identities: [
  { id: 'padmin', kind: 'human', groups: ['platform-admins'] },       // outside write authority
  { id: 'agent-x', kind: 'agent', groups: ['builders'] },              // the coding agent
  { id: 'eng', kind: 'human', groups: ['builders'] },                  // a builder
] };
const NOW = Date.parse('2026-07-24T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function record(over = {}) {
  const base = {
    platform: 'github', repository: 'org/repo', satisfies_control: 'HG-0001',
    mechanism: 'branch_protection', observer_identity: 'padmin',
    observation: { required_status_checks: ['gates'], enforce_admins: true, allow_force_pushes: false },
    bypass_test: { attempted: 'direct push to main by a builder', result: 'rejected', tested_at: iso(3) },
    observed_at: iso(3),
    ...over,
  };
  base.attestation = { issuer: 'obs', signature: sign(null, Buffer.from(activationHash(base), 'utf8'), privateKey).toString('base64') };
  return base;
}
const ev = (r, over = {}) => evaluate(r, { issuers: ISSUERS, registry: REGISTRY, now: NOW, ...over });

test('a fresh, independently-signed, bypass-tested observation passes', () => {
  assert.deepEqual(ev(record()), []);
});

test('an observation signed by the coding AGENT fails — not independent', () => {
  assert.ok(ev(record({ observer_identity: 'agent-x' })).some((f) => /inside the agent's write authority/.test(f)));
});

test('an observation signed by a BUILDER fails — inside write authority', () => {
  assert.ok(ev(record({ observer_identity: 'eng' })).some((f) => /inside the agent's write authority/.test(f)));
});

test('an unresolved observer identity fails', () => {
  assert.ok(ev(record({ observer_identity: 'ghost' })).some((f) => /does not resolve/.test(f)));
});

test('a missing identity registry fails closed — observer independence is not optional', () => {
  assert.ok(evaluate(record(), { issuers: ISSUERS, registry: null, now: NOW }).some((f) => /no readable identity registry/.test(f)));
});

test('a bypass test that was NOT rejected fails — the platform did not refuse', () => {
  const r = record({ bypass_test: { attempted: 'direct push', result: 'allowed', tested_at: iso(1) } });
  assert.ok(ev(r).some((f) => /did not refuse the bypass/.test(f)));
});

test('a missing bypass test fails — an active-looking config proves nothing', () => {
  const r = record(); delete r.bypass_test;
  r.attestation = { issuer: 'obs', signature: sign(null, Buffer.from(activationHash(r), 'utf8'), privateKey).toString('base64') };
  assert.ok(ev(r).some((f) => /no bypass_test/.test(f)));
});

test('a stale observation fails (older than the window)', () => {
  assert.ok(ev(record({ observed_at: iso(400) })).some((f) => /observation is stale/.test(f)));
});

test('a stale bypass test fails', () => {
  const r = record({ bypass_test: { attempted: 'x', result: 'rejected', tested_at: iso(400) } });
  assert.ok(ev(r).some((f) => /bypass_test is stale/.test(f)));
});

test('a tampered observation fails the signature — editing after signing breaks it', () => {
  const r = record(); r.observation.allow_force_pushes = true; // change content, keep the old signature
  assert.ok(ev(r).some((f) => /does NOT verify/.test(f)));
});

test('an egress_proxy observation passes — HG-0011/HG-0012 can graduate', () => {
  assert.deepEqual(ev(record({
    platform: 'crabtrap', satisfies_control: 'HG-0011', mechanism: 'egress_proxy',
    observation: { approval_mode: 'llm', judge_unavailable_fallback: 'deny', network_policy: 'default-deny egress; proxy is the sole exception' },
    bypass_test: { attempted: 'outbound HTTPS from the agent runtime with proxy variables unset', result: 'rejected', tested_at: iso(3) },
  })), []);
});

test('an unknown mechanism fails', () => {
  assert.ok(ev(record({ mechanism: 'vibes' })).some((f) => /mechanism must be one of/.test(f)));
});

test('an empty observation fails — a signed empty object is not platform evidence', () => {
  assert.ok(ev(record({ observation: {} })).some((f) => /no non-empty observation object/.test(f)));
});

test('a valid mechanism cannot be used to activate an unrelated baseline control', () => {
  assert.ok(ev(record({ satisfies_control: 'HG-0005', mechanism: 'branch_protection' }))
    .some((f) => /cannot activate this control/.test(f)));
});

// Graduation cross-check (WS2.2).
test('a catalog control claiming platform-enforced with NO verified record fails graduation', () => {
  const catalog = { controls: [{ control_id: 'HG-0001', state: 'platform-enforced' }] };
  assert.ok(checkGraduation(catalog, new Set()).some((f) => /no VERIFIED platform-activation record/.test(f)));
});

test('a platform-enforced control WITH a verified record passes graduation', () => {
  const catalog = { controls: [{ control_id: 'HG-0001', state: 'platform-enforced' }] };
  assert.deepEqual(checkGraduation(catalog, new Set(['HG-0001'])), []);
});

test('mechanically-validated controls need no activation record', () => {
  const catalog = { controls: [{ control_id: 'X', state: 'mechanically-validated' }] };
  assert.deepEqual(checkGraduation(catalog, new Set()), []);
});

test('run reports malformed records and returns only independently verified control ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-activation-'));
  try {
    mkdirSync(join(dir, 'docs/governance/platform-activation'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/platform-activation/good.json'), JSON.stringify(record({ observed_at: new Date().toISOString(), bypass_test: { attempted: 'direct push', result: 'rejected', tested_at: new Date().toISOString() } })));
    writeFileSync(join(dir, 'docs/governance/platform-activation/broken.json'), '{');
    mkdirSync(join(dir, 'docs/governance'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
    writeFileSync(join(dir, 'docs/governance/attestation-issuers.json'), JSON.stringify(ISSUERS));
    const result = run(dir);
    assert.deepEqual(result.verifiedControls, ['HG-0001']);
    assert.ok(result.findings.some((f) => /broken.json.*not valid JSON/.test(f)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
