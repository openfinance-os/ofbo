// Tests for the adoption-attestation gate (rc.14 · WS5 · finding F7).
//
// The gate shipped with no test file and runs in no CI workflow. Its central rule — a signed
// adoption report cannot be produced while ANY mandatory item is adopt-pending — is the whole answer
// to F7, and nothing exercised it. That rule is easy to get subtly wrong in a way no reviewer would
// catch by reading: reorder two lines and an adopt-pending repo with a valid signature passes.
//
// Every key below is generated per-run and discarded with the process. No fixture in this file
// carries usable trust material, and every identity is from the shipped DEMO registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { attestationHash, evaluate } from './adoption-attest.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const ISSUERS = { issuers: [{ id: 'org-signer', mechanism: 'ed25519', verify: { public_key: PEM } }] };
const REGISTRY = {
  identities: [
    { id: 'exec-rashid', kind: 'human', roles: ['accountable-executive'] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [] },
  ],
};

const CLEAN = { adoptPending: false, unresolved: [] };
const PENDING = { adoptPending: true, unresolved: Array.from({ length: 23 }, (_, i) => `docs/governance/f${i}.json`) };

/** A well-formed attestation, signed for real over its own canonical hash. */
function attest(overrides = {}, { issuer = 'org-signer', key = privateKey } = {}) {
  const rec = {
    schema: 'loom.adoption-attestation/v1',
    repository: 'dryrun-bank/service',
    stage: 'organisation',
    attested_by: 'exec-rashid',
    attested_at: new Date().toISOString(),
    ...overrides,
  };
  const h = attestationHash(rec);
  rec.attestation = { issuer, signature: cryptoSign(null, Buffer.from(h, 'utf8'), key).toString('base64') };
  return rec;
}

const opts = { issuers: ISSUERS, registry: REGISTRY };

// --- the positive path, which had never been exercised ------------------------------------------

test('a fully-configured repo with a fresh, human, registered signature passes', () => {
  assert.deepEqual(evaluate(CLEAN, attest(), opts), []);
});

// --- F7: the rule the gate exists for -----------------------------------------------------------

test('F7 — an adopt-pending repo is refused even with a PERFECTLY valid signature', () => {
  // The signature here is genuine. That is the point: authenticity is not adoption, and a gate that
  // checked only the signature would hand out a green for a half-configured repo.
  const f = evaluate(PENDING, attest(), opts);
  assert.ok(f.some((x) => /adoption is not complete — 23 item\(s\) still adopt-pending/.test(x)));
  assert.ok(f.length > 1, 'the pending items must be named, not merely counted');
});

test('the adopt-pending inventory is capped at ten so the failure stays readable', () => {
  const named = evaluate(PENDING, attest(), opts).filter((x) => /^ {2}adopt-pending: /.test(x));
  assert.equal(named.length, 10);
});

test('installation without attestation is refused, and says what to do', () => {
  const f = evaluate(CLEAN, null, opts);
  assert.deepEqual(f, ['no adoption-attestation.json — create and sign one for the fully-configured repo, then run `attest-adoption` to verify it']);
});

// --- an agent cannot certify its own adoption ---------------------------------------------------

test('an AGENT attester is refused', () => {
  const f = evaluate(CLEAN, attest({ attested_by: 'svc-floor-bridge' }), opts);
  assert.ok(f.some((x) => /does not resolve to a human identity/.test(x)),
    'the whole method rests on agents not certifying their own work');
});

test('an attester who is not in the registry at all is refused', () => {
  const f = evaluate(CLEAN, attest({ attested_by: 'nobody-at-all' }), opts);
  assert.ok(f.some((x) => /does not resolve to a human identity/.test(x)));
});

test('an attestation naming no attester is refused', () => {
  const f = evaluate(CLEAN, attest({ attested_by: '' }), opts);
  assert.ok(f.some((x) => /names no attested_by/.test(x)));
});

// --- freshness ----------------------------------------------------------------------------------

test('a stale attestation is refused; the boundary is the configured max age', () => {
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  assert.ok(evaluate(CLEAN, attest({ attested_at: old }), opts).some((x) => /stale — re-attest/.test(x)));
  // Just inside the window still passes, so the check is a window and not a constant.
  const recent = new Date(Date.now() - 300 * 86_400_000).toISOString();
  assert.deepEqual(evaluate(CLEAN, attest({ attested_at: recent }), opts), []);
});

test('a non-ISO or absent attested_at is refused rather than treated as fresh', () => {
  assert.ok(evaluate(CLEAN, attest({ attested_at: 'last Tuesday' }), opts).some((x) => /no ISO-8601 attested_at/.test(x)));
  assert.ok(evaluate(CLEAN, attest({ attested_at: '' }), opts).some((x) => /no ISO-8601 attested_at/.test(x)));
});

// --- the signature itself -----------------------------------------------------------------------

test('a record edited after signing no longer verifies', () => {
  const rec = attest();
  rec.stage = 'platform'; // one field, after the signature was computed
  assert.ok(evaluate(CLEAN, rec, opts).some((x) => /signature does NOT verify/.test(x)));
});

test('an UNREGISTERED issuer does not count, however valid the signature', () => {
  const rogue = generateKeyPairSync('ed25519');
  const rec = attest({}, { issuer: 'not-in-registry', key: rogue.privateKey });
  assert.ok(evaluate(CLEAN, rec, opts).some((x) => /not in the allowed-issuers registry/.test(x)));
});

test('a registered issuer signing with the WRONG key is refused', () => {
  const rogue = generateKeyPairSync('ed25519');
  const rec = attest({}, { issuer: 'org-signer', key: rogue.privateKey });
  assert.ok(evaluate(CLEAN, rec, opts).some((x) => /signature does NOT verify/.test(x)));
});

test('an unsigned attestation is refused', () => {
  const rec = attest();
  delete rec.attestation;
  assert.ok(evaluate(CLEAN, rec, opts).some((x) => /unsigned/.test(x)));
});

// --- the hash ------------------------------------------------------------------------------------

test('attestationHash excludes the attestation block, so signing does not change what was signed', () => {
  const rec = attest();
  const { attestation, ...rest } = rec;
  assert.equal(attestationHash(rec), attestationHash(rest));
});

test('attestationHash is canonical — key order does not change it, content does', () => {
  const a = { schema: 's', repository: 'r', stage: 'organisation' };
  const b = { stage: 'organisation', repository: 'r', schema: 's' };
  assert.equal(attestationHash(a), attestationHash(b));
  assert.notEqual(attestationHash(a), attestationHash({ ...a, stage: 'platform' }));
});

/* ---- rc.37 · flow-plan Phase 3.6: the freshness WARNING BAND ---- */

test('WARNING BAND — at 80% of the window the attestation still PASSES, with a NOTICE naming the days left', () => {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();
  const notices = [];
  // 300d of a 365d window: valid, inside the band (0.8 × 365 = 292).
  assert.deepEqual(evaluate(CLEAN, attest({ attested_at: daysAgo(300) }), { ...opts, now, notices }), []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /300d old of a 365d window — 65d left/);
  // 200d: below the band, silent.
  const quiet = [];
  assert.deepEqual(evaluate(CLEAN, attest({ attested_at: daysAgo(200) }), { ...opts, now, notices: quiet }), []);
  assert.deepEqual(quiet, []);
  // 400d: the block, exactly where it was — and a stale attestation is a finding, never a warning.
  const blocked = [];
  const findings = evaluate(CLEAN, attest({ attested_at: daysAgo(400) }), { ...opts, now, notices: blocked });
  assert.ok(findings.some((f) => /stale — re-attest/.test(f)));
  assert.deepEqual(blocked, []);
});
