// Tests for the release-attestation cross-binding gate (rc.11 · WS1). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { evaluate } from './release-attestation-check.mjs';

const DIGEST = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const COMMIT = '7e3f9c2a4b6d8e0f1a2c3b4d5e6f7a8b9c0d1e2f';
const ANCHOR = 'f1e2d3c4b5a6079880716253647589a0b1c2d3e4f5061728394a5b6c7d8e9f00';

// A real ed25519 issuer so the anchor genuinely verifies (this is crypto, not a field check).
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const ISSUERS = { issuers: [{ id: 'demo', mechanism: 'ed25519', verify: { public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString() } }] };
const signed = (anchor) => ({ issuer: 'demo', signature: sign(null, Buffer.from(anchor, 'utf8'), privateKey).toString('base64') });

const subject = () => ({
  schema_version: '1.0',
  source: { repository: 'org/repo', commit: COMMIT, tree_digest: 'sha256:' + 'a'.repeat(64) },
  artifact: { name: 'img', uri: `registry/img@${DIGEST}`, digest: DIGEST },
  build: { builder_identity: 'gha://org/repo/wf', workflow_ref: 'org/repo/wf@ref', run_id: '1', built_at: '2026-07-20T09:10:00Z' },
});
const manifest = () => ({ release_commit: COMMIT, anchor: ANCHOR, attestation: signed(ANCHOR), entries: [{ type: 'provenance', ref: 'provenance.json' }] });
const provenanceArtifact = () => ({ subject: [{ name: 'img', digest: { sha256: DIGEST.replace('sha256:', '') } }] });
const productEvals = () => ({ products: [{ product_id: 'PRD-1', eval: { evaluated_artifact: DIGEST } }] });

const ctx = (over = {}) => ({ subject: subject(), manifest: manifest(), provenanceArtifact: provenanceArtifact(), productEvals: productEvals(), issuers: ISSUERS, ...over });

test('a fully bound source→artifact→evals→anchor chain passes', () => {
  assert.deepEqual(evaluate(ctx()), []);
});

test('reusing evidence whose commit differs from the subject fails', () => {
  const m = manifest(); m.release_commit = 'b'.repeat(40);
  assert.ok(evaluate(ctx({ manifest: { ...m, attestation: signed(ANCHOR) } })).some((f) => /is not the subject's source/.test(f)));
});

test('evidence for a DIFFERENT artifact digest fails (one byte changed)', () => {
  const pa = { subject: [{ name: 'img', digest: { sha256: 'a'.repeat(64) } }] };
  assert.ok(evaluate(ctx({ provenanceArtifact: pa })).some((f) => /evidence for a different build/.test(f)));
});

test('a product eval bound to no artifact fails — F1: a commit-only eval predates the build', () => {
  assert.ok(evaluate(ctx({ productEvals: { products: [{ product_id: 'PRD-1', eval: {} }] } })).some((f) => /no evaluated_artifact/.test(f)));
});

test('a product eval bound to the WRONG artifact digest fails', () => {
  const pe = { products: [{ product_id: 'PRD-1', eval: { evaluated_artifact: 'sha256:' + 'c'.repeat(64) } }] };
  assert.ok(evaluate(ctx({ productEvals: pe })).some((f) => /a stale\/other-build eval/.test(f)));
});

test('a tampered anchor signature fails — crypto, not a field check', () => {
  const m = manifest(); const sig = Buffer.from(m.attestation.signature, 'base64'); sig[0] ^= 0xff;
  m.attestation.signature = sig.toString('base64');
  assert.ok(evaluate(ctx({ manifest: m })).some((f) => /does NOT verify/.test(f)));
});

test('no release-subject is OK for a generic repo', () => {
  assert.deepEqual(evaluate({ subject: null, anyInProduction: false }), []);
});

test('no release-subject FAILS once a change is in production', () => {
  assert.ok(evaluate({ subject: null, anyInProduction: true }).some((f) => /must be bound to an immutable artifact/.test(f)));
});
