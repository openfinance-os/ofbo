// Tests for the risk-class attestation (2.1.0, plan row 2.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_ID, buildRiskClassRecord, canonicalRiskClassPayload, payloadDigest, signRiskClass, verifyRiskClass } from './risk-class-attestation.mjs';
import { compile, resolveProfileContext } from './policy-compiler.mjs';
import { draft, verifyStored } from '../scripts/risk-class-attest.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (...c) => { const p = c.map((x) => `${HARNESS}/${x}`).find(existsSync); return p ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const ENVELOPE = J('change-example/change-envelope.json', 'docs/governance/changes/CHG-2026-0042/change-envelope.json');
const PLAN = J('change-example/control-plan.json', 'docs/governance/changes/CHG-2026-0042/control-plan.json');

const keys = generateKeyPairSync('ed25519');
const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] };
const PRIV = pem(keys.privateKey, 'pkcs8');

const skip = !ENVELOPE || !PLAN ? 'worked example absent in this layout' : false;

test('the record is the compiler\'s decision, built deterministically from the envelope and its plan', { skip }, () => {
  const a = buildRiskClassRecord(ENVELOPE, PLAN, { compiledAt: '2026-07-18T10:00:00Z' });
  const b = buildRiskClassRecord(ENVELOPE, PLAN, { compiledAt: '2026-07-18T10:00:00Z' });
  assert.deepEqual(a, b);
  assert.equal(a.schema, SCHEMA_ID);
  assert.equal(a.risk_tier, PLAN.risk_tier);
  assert.equal(a.plan_hash, PLAN.plan_hash);
  assert.equal(a.profiles.length, PLAN.profile_bindings.length);
  assert.ok(a.profiles.every((p) => /^sha256:/.test(p.digest)));
  assert.deepEqual(Object.values(a.flags), Object.values(a.flags).map(() => true), 'only the flags that fired are recorded');
  assert.equal(a.classified_by, ENVELOPE.classification.classified_by);
  assert.equal(a.attestation, null);
});

test('an unsigned record is a draft: verifiable against the plan, refused as evidence', { skip }, () => {
  const rec = buildRiskClassRecord(ENVELOPE, PLAN);
  const notices = [];
  assert.deepEqual(verifyRiskClass(rec, { plan: PLAN, envelope: ENVELOPE, requireSignature: false, notices }), []);
  assert.ok(notices.some((n) => /unsigned draft/.test(n)));
  assert.ok(verifyRiskClass(rec, { plan: PLAN, issuers: ISSUERS }).some((f) => /UNSIGNED — a draft/.test(f)));
});

test('a signed record verifies for real, and any signed field moved breaks it', { skip }, () => {
  const rec = signRiskClass(buildRiskClassRecord(ENVELOPE, PLAN), { issuer: 'ci-runner', privateKeyPem: PRIV, issuedAt: '2026-07-18T10:05:00Z' });
  assert.equal(rec.attestation.mechanism, 'ed25519');
  assert.equal(rec.attestation.payload_digest, payloadDigest(rec));
  assert.deepEqual(verifyRiskClass(rec, { plan: PLAN, envelope: ENVELOPE, issuers: ISSUERS }), []);
  // JSON round trip
  assert.deepEqual(verifyRiskClass(JSON.parse(JSON.stringify(rec)), { plan: PLAN, issuers: ISSUERS }), []);
  for (const mutate of [
    (r) => { r.risk_tier = 'low'; },
    (r) => { r.plan_hash = 'a'.repeat(64); },
    (r) => { r.flags = {}; },
    (r) => { r.classified_by = 'agent-loom-delivery'; },
    (r) => { r.profiles[0].digest = 'sha256:' + 'b'.repeat(64); },
  ]) {
    const m = JSON.parse(JSON.stringify(rec)); mutate(m);
    const f = verifyRiskClass(m, { issuers: ISSUERS });
    assert.ok(f.some((x) => /payload_digest does not match|does NOT verify/.test(x)), `mutation must break the signature:\n${f.join('\n')}`);
  }
  const flipped = JSON.parse(JSON.stringify(rec));
  const sig = Buffer.from(flipped.attestation.signature, 'base64'); sig[0] ^= 0xff; flipped.attestation.signature = sig.toString('base64');
  assert.ok(verifyRiskClass(flipped, { issuers: ISSUERS }).some((x) => /does NOT verify/.test(x)));
});

test('the record must be the plan\'s: a foreign hash, a moved tier, a different profile set, or a stale compile all fail', { skip }, () => {
  const rec = signRiskClass(buildRiskClassRecord(ENVELOPE, PLAN), { issuer: 'ci-runner', privateKeyPem: PRIV });
  const other = { ...PLAN, plan_hash: 'c'.repeat(64) };
  assert.ok(verifyRiskClass(rec, { plan: other, issuers: ISSUERS }).some((x) => /is not the stored plan's/.test(x)));
  assert.ok(verifyRiskClass(rec, { plan: { ...PLAN, risk_tier: 'low' }, issuers: ISSUERS }).some((x) => /not the plan's low|does not match its own plan_hash/.test(x)));
  assert.ok(verifyRiskClass(rec, { plan: PLAN, freshPlan: { plan_hash: 'd'.repeat(64) }, issuers: ISSUERS }).some((x) => /does not reconcile with a fresh compile/.test(x)));
  assert.ok(verifyRiskClass(rec, { plan: PLAN, envelope: { ...ENVELOPE, risk_tier: 'critical' }, issuers: ISSUERS }).some((x) => /not the envelope's critical/.test(x)));
  // a genuinely fresh compile of the shipped example reconciles
  const context = resolveProfileContext(ENVELOPE, HARNESS);
  const fresh = compile(context.envelope, context.profiles, context.bindings).plan;
  assert.deepEqual(verifyRiskClass(rec, { plan: PLAN, freshPlan: fresh, issuers: ISSUERS }), []);
});

test('an unregistered or demo issuer is refused by the shared attestation stack', { skip }, () => {
  const rec = signRiskClass(buildRiskClassRecord(ENVELOPE, PLAN), { issuer: 'ci-runner', privateKeyPem: PRIV });
  assert.ok(verifyRiskClass(rec, { issuers: { issuers: [] } }).some((x) => /not in the allowed-issuers registry/.test(x)));
  const demo = { issuers: [{ ...ISSUERS.issuers[0], demo: true }] };
  assert.ok(verifyRiskClass(rec, { issuers: demo }).some((x) => /"demo": true/.test(x)));
  const notices = [];
  assert.deepEqual(verifyRiskClass(rec, { issuers: null, notices }), []);
  assert.ok(notices.some((n) => /NOT VERIFIED/.test(n)));
});

test('the canonical payload is stable under key order and ignores the attestation', { skip }, () => {
  const rec = buildRiskClassRecord(ENVELOPE, PLAN);
  const shuffled = Object.fromEntries(Object.entries(rec).reverse());
  assert.equal(canonicalRiskClassPayload(rec), canonicalRiskClassPayload(shuffled));
  assert.equal(canonicalRiskClassPayload(rec), canonicalRiskClassPayload({ ...rec, attestation: { issuer: 'x' } }));
});

test('the attestation CLI refuses to draft or verify when current profile policy cannot compile', { skip }, () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'loom-risk-class-'));
  try {
    const changeDir = resolve(dir, 'docs/governance/changes/CHG-X');
    mkdirSync(changeDir, { recursive: true });
    const envelope = { ...ENVELOPE, change_id: 'CHG-X', required_profiles: ['missing-profile'] };
    writeFileSync(resolve(changeDir, 'change-envelope.json'), JSON.stringify(envelope));
    writeFileSync(resolve(changeDir, 'control-plan.json'), JSON.stringify(PLAN));
    writeFileSync(resolve(changeDir, 'risk-class.json'), JSON.stringify(buildRiskClassRecord(envelope, PLAN)));
    assert.ok(draft(changeDir, { cwd: dir }).findings.some((f) => /missing-profile.*not found/.test(f)));
    assert.ok(verifyStored(changeDir, { cwd: dir, requireSignature: false }).findings.some((f) => /fresh compile blocked.*missing-profile/.test(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
