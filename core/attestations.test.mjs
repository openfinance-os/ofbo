// Tests for attestation verification. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attestationValidityFindings, issuerPolicyFindings, verifyAnchorAttestation, verifySignatureOver } from './attestations.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (...candidates) => {
  const p = candidates.map((c) => `${HARNESS}/${c}`).find(existsSync);
  return JSON.parse(readFileSync(p, 'utf8'));
};

// A REAL, non-demo issuer generated per test run — the strong-stack positive path. The bundle
// deliberately ships no usable non-demo trust material (a working reference key in every adopting
// repo would be a live root of trust), so the positive path signs with a key that never persists.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const issuerEntry = (extra = {}) => ({ id: 'run-anchor-signer', mechanism: 'ed25519', verify: { public_key: PEM }, ...extra });
const signedOver = (payload, extra = {}) => ({ issuer: 'run-anchor-signer', signature: sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64'), ...extra });

// The evidence manifest resolves in BOTH layouts: the bundle (evidence-example/) and an adopted
// repo that mounted it (docs/governance/evidence/). In a BARE adoption it is in neither, so skip
// cleanly rather than crash at module load.
//
// The `attestation` check is load-bearing, not defensive. These three tests exercise the SHIPPED
// EXAMPLE's signed anchor — they need the example's own signature to verify against. An adopter
// who follows the adoption guide ("adapt evidence-example/ into docs/governance/evidence/") and
// then assembles a REAL bundle from their own release has a manifest at that path with a
// different anchor and, until they sign it, no attestation at all. Resolving on existence alone
// pointed these tests at that bundle and failed a repository for doing exactly what it was told:
// one assertion failure and two TypeErrors on `MANIFEST.attestation.signature`.
//
// So: run when the manifest carries an attestation to verify, skip when it does not. A mounted
// copy of the example still runs them; an adopter's own unsigned bundle is not this suite's
// business. Found by assembling a real bundle in an adopted repo.
const MANIFEST_PATH = ['evidence-example/manifest.json', 'docs/governance/evidence/manifest.json']
  .map((c) => `${HARNESS}/${c}`).find(existsSync);
const HAS_ATTESTATION = MANIFEST_PATH
  && JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).attestation !== undefined;
if (!HAS_ATTESTATION) {
  test('attestation verification (no attested manifest resolved — nothing to verify against)', { skip: true }, () => {});
} else {
const MANIFEST = J('evidence-example/manifest.json', 'docs/governance/evidence/manifest.json');
const ISSUERS = J('governance/attestation-issuers.template.json', 'docs/governance/attestation-issuers.json');

// rc.36 (flow-plan D3): the shipped example anchor is signed by the bundle's demo key — and a
// demo key is exactly what the strong stack refuses. The dry-run re-seals and re-signs the
// example with a per-run, non-demo key (evidence-example/regenerate.mjs); the COMMITTED example
// stays demo-signed on purpose so this refusal is demonstrated, not just claimed. If the manifest
// under test is already re-signed by a non-demo issuer, the refusal has been paid and the
// signature must verify clean instead.
const anchorIssuer = (ISSUERS.issuers || []).find((i) => i.id === MANIFEST.attestation?.issuer);
if (anchorIssuer?.demo === true) {
  test('a demo-signed anchor is REFUSED — the weak stack that let it pass is gone (D3)', () => {
    const f = verifyAnchorAttestation(MANIFEST, ISSUERS);
    assert.ok(f.some((x) => /is marked `"demo": true`/.test(x)), `expected the demo refusal, got ${JSON.stringify(f)}`);
    // The crypto itself still checks out — refusal is about authority, not the maths — so the
    // ONLY finding is the demo refusal. Any other finding means the example itself broke.
    assert.deepEqual(f.filter((x) => !/is marked `"demo": true`/.test(x)), []);
  });
} else {
  test('the re-signed (non-demo) anchor attestation verifies clean', () => {
    assert.deepEqual(verifyAnchorAttestation(MANIFEST, ISSUERS), []);
  });
}

test('a registered NON-demo issuer verifies the anchor for REAL (ed25519)', () => {
  const m = { ...MANIFEST, attestation: signedOver(MANIFEST.anchor) };
  assert.deepEqual(verifyAnchorAttestation(m, { issuers: [issuerEntry()] }), []);
});

test('a flipped signature byte fails — this is crypto, not a field check', () => {
  const att = signedOver(MANIFEST.anchor);
  const sig = Buffer.from(att.signature, 'base64');
  sig[0] ^= 0xff;
  const doctored = { ...MANIFEST, attestation: { ...att, signature: sig.toString('base64') } };
  assert.ok(verifyAnchorAttestation(doctored, { issuers: [issuerEntry()] }).some((f) => /does NOT verify/.test(f)));
});

test('a recomputed anchor no longer matches the signature', () => {
  const doctored = { ...MANIFEST, anchor: 'a'.repeat(64), attestation: signedOver(MANIFEST.anchor) };
  assert.ok(verifyAnchorAttestation(doctored, { issuers: [issuerEntry()] }).some((f) => /does NOT verify/.test(f)));
});

test('an unregistered issuer does not count, however valid its signature', () => {
  const { privateKey: rogueKey } = generateKeyPairSync('ed25519');
  const signature = sign(null, Buffer.from(MANIFEST.anchor), rogueKey).toString('base64');
  const rogue = { ...MANIFEST, attestation: { issuer: 'rogue-signer', signature } };
  assert.ok(verifyAnchorAttestation(rogue, ISSUERS).some((f) => /not in the allowed-issuers registry/.test(f)));
});

test('a missing attestation or anchor is a finding, not a silent pass', () => {
  assert.match(verifyAnchorAttestation({ anchor: 'x' }, ISSUERS)[0], /no attestation/);
  assert.match(verifyAnchorAttestation({ attestation: { issuer: 'demo-anchor-signer' } }, ISSUERS)[0], /no anchor/);
});

test('platform mechanisms report UNVERIFIED-HERE rather than pretending', () => {
  const m = { ...MANIFEST, attestation: { issuer: 'bank-ci', signature: 'whatever' } };
  assert.ok(verifyAnchorAttestation(m, ISSUERS).some((f) => /UNVERIFIED-HERE/.test(f)));
});

/* ---- rc.36 (D3): issuer policy — demo, revocation, validity window ---- */

test('a REVOKED issuer is refused even though its signature verifies', () => {
  const f = verifySignatureOver('payload', signedOver('payload'), { issuers: [issuerEntry({ revoked: true })] });
  assert.ok(f.some((x) => /REVOKED in the allowed-issuers registry/.test(x)), JSON.stringify(f));
  assert.ok(!f.some((x) => /does NOT verify/.test(x)), 'the maths still checks; refusal is about authority');
});

test('an issuer outside its validity window is refused — judged at the attested instant, not now', () => {
  const reg = { issuers: [issuerEntry({ valid_from: '2020-01-01T00:00:00Z', valid_until: '2021-01-01T00:00:00Z' })] };
  // Signed inside the window (validity.issued_at declares when) — the issuer was valid THEN.
  const inWindow = signedOver('payload', { validity: { issued_at: '2020-06-01T00:00:00Z' } });
  assert.deepEqual(verifySignatureOver('payload', inWindow, reg), []);
  // No declared instant ⇒ judged at verification time, which is past valid_until.
  assert.ok(verifySignatureOver('payload', signedOver('payload'), reg).some((x) => /no longer valid/.test(x)));
  // Before valid_from.
  const early = signedOver('payload', { validity: { issued_at: '2019-06-01T00:00:00Z' } });
  assert.ok(verifySignatureOver('payload', early, reg).some((x) => /not yet valid/.test(x)));
});

test('an unreadable issuer window fails closed, never silently', () => {
  const f = issuerPolicyFindings(issuerEntry({ valid_until: 'when we get to it' }));
  assert.ok(f.some((x) => /not a parseable ISO-8601 timestamp/.test(x)));
});

/* ---- rc.36 (D3): per-attestation validity, honoured when present ---- */

test('an attestation declaring no validity behaves exactly as before', () => {
  assert.deepEqual(attestationValidityFindings(undefined), []);
  assert.deepEqual(verifySignatureOver('payload', signedOver('payload'), { issuers: [issuerEntry()] }), []);
});

test('an expired or revoked attestation is refused; an unreadable expiry fails closed', () => {
  const reg = { issuers: [issuerEntry()] };
  const expired = signedOver('payload', { validity: { issued_at: '2020-01-01T00:00:00Z', expires_at: '2020-02-01T00:00:00Z' } });
  assert.ok(verifySignatureOver('payload', expired, reg).some((x) => /expired at 2020-02-01/.test(x)));
  const revoked = signedOver('payload', { validity: { revoked: true } });
  assert.ok(verifySignatureOver('payload', revoked, reg).some((x) => /REVOKED/.test(x)));
  const unreadable = signedOver('payload', { validity: { expires_at: true } });
  assert.ok(verifySignatureOver('payload', unreadable, reg).some((x) => /not an attestation that never expires/.test(x)));
});
}
