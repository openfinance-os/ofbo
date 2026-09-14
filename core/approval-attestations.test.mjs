// Tests for the approval-attestation contract. Node built-in runner: `node --test`.
//
// These are the negative tests the Factory Floor plan's goal G2 names: an agent's click is void,
// an unregistered human is refused, a service key cannot vouch for a person, a replayed decision
// is rejected, and content mutated after the decision breaks the binding. They run on REAL
// ed25519 material — a signature test that never verifies a signature is a field check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  SCHEMA_ID,
  canonicalDecisionPayload,
  verifyApprovalAttestation,
  attestationRequired,
  sha256,
  passportDigest,
  stableStringify,
  trustAnchors,
  roleBindingHash,
} from './approval-attestations.mjs';
import { resolveApprover, identityOf } from '../scripts/identity-registry-check.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- fixtures: two SEPARATE key namespaces, which is the point of the contract ---------------
const pem = (kp) => kp.publicKey.export({ type: 'spki', format: 'pem' });
const IDP = generateKeyPairSync('ed25519');       // the institution's identity provider
const BRIDGE = generateKeyPairSync('ed25519');    // the transcribing service
const ROGUE = generateKeyPairSync('ed25519');

const ASSERTION_ISSUERS = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { public_key: pem(IDP) } }] };
const SERVICE_ISSUERS = {
  issuers: [
    { id: 'svc-floor-bridge', mechanism: 'ed25519', identity: 'svc-floor-bridge', verify: { public_key: pem(BRIDGE) } },
  ],
};
// A service registry that ALSO holds the identity provider's key, under a different id — the
// shape that reduces the service/human separation to a naming convention.
const SERVICE_ISSUERS_SHARING_ANCHOR = {
  issuers: [
    ...SERVICE_ISSUERS.issuers,
    { id: 'bank-idp-service-copy', mechanism: 'ed25519', identity: 'svc-floor-bridge', verify: { public_key: pem(IDP) } },
  ],
};

const REGISTRY = {
  groups: { builders: ['eng-sam', 'svc-floor-bridge'], 'second-line': ['risk-lena'] },
  identities: [
    { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'eng-sam', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'po-fatima', kind: 'human', roles: ['product-owner'], groups: [] },
    { id: 'agent-loom-delivery', kind: 'agent', roles: [], groups: ['builders'] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [], groups: ['builders'] },
  ],
};

const PLAN = { change_id: 'CHG-2026-0117', plan_hash: 'plan-hash-abc', risk_tier: 'high' };
const PASSPORT_DIGEST = sha256('{"the":"passport as committed"}');

/** A complete, correctly-signed approval — the shape everything else deviates from. */
function validRecord(over = {}) {
  const base = {
    schema: SCHEMA_ID,
    change_id: 'CHG-2026-0117',
    stage: 'PA1',
    outcome: 'approved',
    role: 'risk-second-line',
    subject: {
      registry_id: 'risk-lena',
      idp_subject: 'idp|0f3c9a11-immutable',
      assertion: { mechanism: 'ed25519', issuer: 'bank-idp', subject: 'idp|0f3c9a11-immutable', issued_at: '2026-07-25T08:58:00Z', expires_at: '2099-01-01T00:00:00Z' },
    },
    bound_to: {
      plan_hash: 'plan-hash-abc',
      passport_digest: PASSPORT_DIGEST,
      source_sha: 'a3f9c21bd4e5f60718293a4b5c6d7e8f90123456',
    },
    origin: { system: 'notion', workspace_id: 'ws_1', page_id: 'pg_1', event_id: 'evt_1', nonce: 'nonce-1' },
    validity: { issued_at: '2026-07-25T09:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked: false },
    transcription: { by: 'svc-floor-bridge' },
  };
  // Merge the nested blocks against the DEFAULTS (a blanket spread would clobber them).
  return {
    ...base,
    ...over,
    subject: {
      ...base.subject,
      ...over.subject,
      assertion: { ...base.subject.assertion, ...over.subject?.assertion },
    },
    bound_to: { ...base.bound_to, ...over.bound_to },
    origin: { ...base.origin, ...over.origin },
    validity: { ...base.validity, ...over.validity },
    transcription: { ...base.transcription, ...over.transcription },
  };
}

/** Sign a record the way a correct pipeline would: the human binds, then the bridge transcribes. */
function signed(rec, { idpKey = IDP.privateKey, bridgeKey = BRIDGE.privateKey } = {}) {
  const withNonce = { ...rec, subject: { ...rec.subject, assertion: { ...rec.subject.assertion } } };
  withNonce.subject.assertion.nonce = sha256(canonicalDecisionPayload(withNonce));
  const payload = canonicalDecisionPayload(withNonce);
  withNonce.subject.assertion.signature = sign(null, Buffer.from(payload, 'utf8'), idpKey).toString('base64');
  withNonce.transcription = {
    ...withNonce.transcription,
    attestation: { issuer: 'svc-floor-bridge', signature: sign(null, Buffer.from(payload, 'utf8'), bridgeKey).toString('base64') },
  };
  return withNonce;
}

const ctx = (over = {}) => ({
  stage: 'PA1',
  role: 'risk-second-line',
  by: 'risk-lena',
  plan: PLAN,
  passportDigest: PASSPORT_DIGEST,
  registry: REGISTRY,
  issuers: SERVICE_ISSUERS,
  assertionIssuers: ASSERTION_ISSUERS,
  resolveApprover,
  identityOf,
  seen: new Map(),
  now: Date.parse('2026-07-25T10:00:00Z'),
  ...over,
});

const failsWith = (rec, re, c = ctx()) => {
  const findings = verifyApprovalAttestation(rec, c);
  assert.ok(findings.some((f) => re.test(f)), `expected a finding matching ${re}\ngot: ${JSON.stringify(findings, null, 2)}`);
};


// --- the narrowed per-role binding (rc.38 · flow-plan Phase 4.1) ------------------------------
//
// The whole point is a REPRICING that keeps tamper-evidence exactly where it was: a plan hash that
// moved for a reason invisible to the approver no longer invalidates their signature, and anything
// the approver actually saw still does.

const PLAN_FULL = {
  change_id: 'CHG-2026-0117',
  risk_tier: 'high',
  plan_hash: 'plan-hash-abc',
  required_gates: ['PA1', 'PA2', 'Q'],
  required_approver_roles: ['risk-second-line', 'product-owner'],
  pa1_approver_roles: ['risk-second-line'],
  pa1_sections: ['classification', 'ownership'],
  pa2_sections: ['disclosures'],
  required_capabilities: { data_risk_register: { required: true, minimum_version: '3.1' } },
  profile_bindings: [{ profile: 'regulated-bank', digest: 'sha256:aaa' }],
};
const bound = (plan = PLAN_FULL) => {
  const b = { plan_hash: plan.plan_hash, passport_digest: PASSPORT_DIGEST, source_sha: 'a3f9c21bd4e5f60718293a4b5c6d7e8f90123456' };
  b.binding_hash = roleBindingHash(plan, 'risk-second-line', b);
  return b;
};
const boundRecord = (plan = PLAN_FULL) => signed(validRecord({ bound_to: bound(plan) }));

test('a record carrying a correct binding_hash verifies exactly as before', () => {
  assert.deepEqual(verifyApprovalAttestation(boundRecord(), ctx({ plan: PLAN_FULL })), []);
});

test('a profile comment edit moves plan_hash and the approval SURVIVES — recorded, not silent', () => {
  const rec = boundRecord();
  // The one thing that changed: a profile's content digest. Nothing the approver read moved.
  const moved = { ...PLAN_FULL, plan_hash: 'plan-hash-xyz', profile_bindings: [{ profile: 'regulated-bank', digest: 'sha256:bbb' }] };
  const notices = [];
  assert.deepEqual(verifyApprovalAttestation(rec, ctx({ plan: moved, notices })), []);
  assert.ok(notices.some((n) => /per-role binding_hash still matches/.test(n)),
    'the narrowing must be SAID; an acceptance nobody can see is no check at all');
});

test('everything the approver actually saw still invalidates the signature', () => {
  const rec = boundRecord();
  const cases = {
    'a gate added to the route': { required_gates: ['PA1', 'PA2', 'Q', 'R'] },
    'a PA1 section dropped': { pa1_sections: ['classification'] },
    'a PA2 section added': { pa2_sections: ['disclosures', 'regulatory-clearance'] },
    'the role moved out of PA1': { pa1_approver_roles: [] },
    'the role dropped from the plan': { required_approver_roles: ['product-owner'] },
    'a capability strengthened': { required_capabilities: { data_risk_register: { required: true, minimum_version: '4.0' } } },
    'the tier changed': { risk_tier: 'critical' },
  };
  for (const [why, over] of Object.entries(cases)) {
    const moved = { ...PLAN_FULL, ...over, plan_hash: 'plan-hash-xyz' };
    const findings = verifyApprovalAttestation(rec, ctx({ plan: moved }));
    assert.ok(findings.some((f) => /binding_hash does not match/.test(f)), `${why} must break the binding: ${JSON.stringify(findings)}`);
  }
});

test('the binding is per ROLE — one role\'s binding does not verify for another', () => {
  const a = roleBindingHash(PLAN_FULL, 'risk-second-line', { passport_digest: PASSPORT_DIGEST });
  const b = roleBindingHash(PLAN_FULL, 'product-owner', { passport_digest: PASSPORT_DIGEST });
  assert.notEqual(a, b);
});

test('re-pointing the approved content breaks the binding as well as the digest comparison', () => {
  const rec = boundRecord();
  rec.bound_to.passport_digest = sha256('{"a different analysis":true}');
  failsWith(rec, /binding_hash does not match/, ctx({ plan: PLAN_FULL }));
});

test('a record with NO binding_hash still fails on a moved plan — and is told why', () => {
  const rec = signed(validRecord());
  failsWith(rec, /no bound_to.binding_hash, so there is no narrower binding/, ctx({ plan: { ...PLAN_FULL, plan_hash: 'plan-hash-xyz' } }));
});

test('a WRONG binding_hash is a finding even when the plan hash still matches', () => {
  const rec = signed(validRecord({ bound_to: { plan_hash: 'plan-hash-abc', passport_digest: PASSPORT_DIGEST, source_sha: 'a3f9c21bd4e5f60718293a4b5c6d7e8f90123456', binding_hash: sha256('invented') } }));
  failsWith(rec, /binding_hash does not match/, ctx({ plan: PLAN_FULL }));
});

test('the binding_hash is INSIDE the signed payload — editing it breaks the signature', () => {
  const rec = boundRecord();
  rec.bound_to.binding_hash = roleBindingHash({ ...PLAN_FULL, required_gates: ['PA1'] }, 'risk-second-line', rec.bound_to);
  const findings = verifyApprovalAttestation(rec, ctx({ plan: { ...PLAN_FULL, required_gates: ['PA1'] } }));
  assert.ok(findings.some((f) => /does NOT verify/.test(f)), `expected a signature failure, got ${JSON.stringify(findings)}`);
});

// --- the happy path --------------------------------------------------------------------------

test('a correctly signed, correctly bound approval verifies for REAL', () => {
  assert.deepEqual(verifyApprovalAttestation(signed(validRecord()), ctx()), []);
});

test('the canonical payload is deterministic and covers what was approved', () => {
  const p = canonicalDecisionPayload(validRecord());
  for (const bound of ['CHG-2026-0117', 'PA1', 'risk-lena', 'plan-hash-abc', PASSPORT_DIGEST, 'nonce-1', '2026-07-25T09:00:00Z']) {
    assert.ok(p.includes(bound), `payload must bind ${bound}`);
  }
});

test('the claimed decision time is signed — a carrier cannot back-date a decision', () => {
  const rec = signed(validRecord());
  rec.validity = { ...rec.validity, issued_at: '2026-01-01T00:00:00Z' };
  failsWith(rec, /does NOT verify/);
});

test('a newline inside a field cannot forge a different record with the same payload', () => {
  // Delimiter injection: with a bare newline join, a value containing a newline could shift the
  // remaining fields so two DIFFERENT records signed the same string. Encoding makes it one-to-one.
  const a = canonicalDecisionPayload(validRecord({ change_id: 'CHG-1\nPA1', stage: '' }));
  const b = canonicalDecisionPayload(validRecord({ change_id: 'CHG-1', stage: 'PA1' }));
  assert.notEqual(a, b, 'a newline in a field must not be able to impersonate a field boundary');
});

// --- finding F1: the signature must authenticate the HUMAN, not the worker --------------------

test('a record with no subject assertion proves only that a service wrote a file', () => {
  const rec = signed(validRecord());
  delete rec.subject.assertion;
  failsWith(rec, /subject\.assertion missing/);
});

test('a SERVICE key cannot vouch for a human — the bridge signing the assertion is refused', () => {
  const rec = signed(validRecord({ subject: { assertion: { issuer: 'svc-floor-bridge' } } }), { idpKey: BRIDGE.privateKey });
  failsWith(rec, /registered SERVICE attestation issuer|transcribes, it never vouches/);
});

test('an identity-provider key registered as a service issuer is still refused as an assertion issuer', () => {
  const rec = signed(validRecord({ subject: { assertion: { issuer: 'bank-idp-service-copy' } } }));
  failsWith(rec, /registered SERVICE attestation issuer/, ctx({ issuers: SERVICE_ISSUERS_SHARING_ANCHOR }));
});

test('separation holds on KEY MATERIAL, not on the id someone typed', () => {
  // The assertion quotes the *assertion* registry's id — the id check passes. The same key is
  // also a service issuer under another id, so quoting the right name is not enough.
  failsWith(signed(validRecord()), /one trust anchor in both registries/, ctx({ issuers: SERVICE_ISSUERS_SHARING_ANCHOR }));
});

test('a signing key not bound to a registry identity cannot credit a custodian', () => {
  const issuers = { issuers: [{ ...SERVICE_ISSUERS.issuers[0] }] };
  delete issuers.issuers[0].identity;
  failsWith(signed(validRecord()), /declares no `identity`/, ctx({ issuers }));
});

test('the credited custodian must be the identity that actually signed', () => {
  const issuers = { issuers: [{ ...SERVICE_ISSUERS.issuers[0], identity: 'svc-floor-projector' }] };
  failsWith(signed(validRecord()), /the credited custodian is not the signer/, ctx({ issuers }));
});

test('an audience or step-up level the registry pins is checked, not merely carried', () => {
  const pinned = { issuers: [{ ...ASSERTION_ISSUERS.issuers[0], verify: { public_key: pem(IDP), audience: 'loom-approvals', required_acr: 'high' } }] };
  // carried but wrong
  failsWith(signed(validRecord({ subject: { assertion: { audience: 'something-else', acr: 'high' } } })),
    /audience .* does not match/, ctx({ assertionIssuers: pinned }));
  // pinned but absent
  failsWith(signed(validRecord()), /pins audience .* but the assertion carries none/, ctx({ assertionIssuers: pinned }));
});

test('expiry, revocation, origin and custodian are all under the signature', () => {
  for (const [mutate, what] of [
    [(r) => { r.validity.revoked = false; }, 'un-revoking'],
    [(r) => { r.validity.expires_at = '2099-12-31T00:00:00Z'; }, 'extending expiry'],
    [(r) => { r.origin.system = 'notion-2'; }, 'evading the replay key'],
    [(r) => { r.origin.event_id = 'evt_other'; }, 'reattributing the event'],
    [(r) => { r.transcription.by = 'svc-floor-projector'; }, 'reattributing custody'],
  ]) {
    const rec = signed(validRecord({ validity: { revoked: true } }));
    mutate(rec);
    const findings = verifyApprovalAttestation(rec, ctx());
    assert.ok(findings.some((f) => /does NOT verify/.test(f)), `${what} must break the signature\ngot: ${findings.join('\n')}`);
  }
});

test('an unpinned identity provider is not trusted', () => {
  const rec = signed(validRecord({ subject: { assertion: { issuer: 'some-other-idp' } } }));
  failsWith(rec, /not in the assertion-issuers registry/);
});

test('a forged assertion signature does not verify — this is crypto, not a field check', () => {
  const rec = signed(validRecord(), { idpKey: ROGUE.privateKey });
  failsWith(rec, /does NOT verify/);
});

test('an AGENT cannot approve, however well signed the record is', () => {
  const rec = signed(validRecord({ subject: { registry_id: 'agent-loom-delivery' } }));
  failsWith(rec, /is an AGENT — agents prepare evidence, they never approve/, ctx({ by: 'agent-loom-delivery' }));
});

test('an unregistered human is refused', () => {
  const rec = signed(validRecord({ subject: { registry_id: 'nobody-at-all' } }));
  failsWith(rec, /not in the registry/, ctx({ by: 'nobody-at-all' }));
});

test('an approver who does not hold the role is refused', () => {
  const rec = signed(validRecord({ subject: { registry_id: 'po-fatima' } }));
  failsWith(rec, /does not hold the required role risk-second-line/, ctx({ by: 'po-fatima' }));
});

test('the transcriber may not also be the approver', () => {
  const rec = signed(validRecord({ transcription: { by: 'risk-lena' } }));
  failsWith(rec, /custody and decision must be separable/);
});

test('an unsigned transcription is a finding — custody is evidenced, not assumed', () => {
  const rec = signed(validRecord());
  delete rec.transcription.attestation;
  failsWith(rec, /no attestation/);
});

test('the immutable identity-provider subject is required — a workspace person id is not enough', () => {
  const rec = signed(validRecord());
  delete rec.subject.idp_subject;
  failsWith(rec, /idp_subject missing/);
});

// --- finding F2: bound to the exact thing approved -------------------------------------------

test('an approval whose plan hash does not match the compiled plan is refused', () => {
  const rec = signed(validRecord({ bound_to: { plan_hash: 'plan-hash-STALE' } }));
  failsWith(rec, /plan_hash does not match the compiled plan/);
});

test('content mutated after the decision breaks the binding', () => {
  const rec = signed(validRecord());
  failsWith(rec, /passport_digest does not match/, ctx({ passportDigest: sha256('{"the":"passport, edited later"}') }));
});

test('an assertion nonce that does not bind the payload could be replayed onto another decision', () => {
  const rec = signed(validRecord());
  rec.subject.assertion.nonce = sha256('a different decision entirely');
  failsWith(rec, /does not bind the decision payload/);
});

test('PA1 binds a source state; PA2 binds the built artifact, not a commit', () => {
  const noSha = signed(validRecord({ bound_to: { source_sha: '' } }));
  failsWith(noSha, /PA1 requires bound_to\.source_sha/);
  const pa2 = signed(validRecord({ stage: 'PA2' }));
  failsWith(pa2, /PA2 requires bound_to\.artifact_digest/, ctx({ stage: 'PA2' }));
});

test('the record must agree with the passport it evidences', () => {
  failsWith(signed(validRecord({ stage: 'PA2' })), /stage .* does not match/);
  failsWith(signed(validRecord({ role: 'compliance' })), /role .* does not match/);
  failsWith(signed(validRecord({ outcome: 'rejected' })), /only an approved decision evidences an approval/);
  failsWith(signed(validRecord({ subject: { registry_id: 'po-fatima' } })), /is not the approver named in the passport/);
});

// --- replay, expiry, revocation, schema ------------------------------------------------------

test('a replayed decision nonce is rejected — a nonce is single-use', () => {
  const c = ctx();
  const first = signed(validRecord());
  assert.deepEqual(verifyApprovalAttestation(first, c, 'first'), []);
  const second = signed(validRecord({ origin: { event_id: 'evt_2' } }));
  assert.ok(verifyApprovalAttestation(second, c, 'second').some((f) => /nonce replays the one already used by first/.test(f)));
});

test('a replayed webhook event id is rejected — webhooks are signals, deduplicated', () => {
  const c = ctx();
  verifyApprovalAttestation(signed(validRecord()), c, 'first');
  const replay = signed(validRecord({ origin: { nonce: 'nonce-2' } }));
  assert.ok(verifyApprovalAttestation(replay, c, 'second').some((f) => /event_id replays the one already used by first/.test(f)));
});

test('an expired or revoked attestation does not count', () => {
  failsWith(signed(validRecord({ validity: { expires_at: '2026-01-01T00:00:00Z' } })), /expired at/);
  failsWith(signed(validRecord({ validity: { revoked: true } })), /revoked/);
});

// A step-up ID token lives minutes; a gate re-verifies for years. Judging the assertion against
// VERIFICATION time would make every genuine approval rot on a timer — the contract would be
// unusable with the very mechanism it recommends. It is judged against the signed decision time.
test('a short-lived assertion stays valid long after it expired — it is judged at the decision', () => {
  const rec = signed(validRecord({
    validity: { issued_at: '2026-07-19T11:04:07Z' },
    subject: { assertion: { issued_at: '2026-07-19T11:04:00Z', expires_at: '2026-07-19T11:09:00Z' } },
  }));
  // verified a year later — still valid, because the human held a live assertion when they decided
  assert.deepEqual(verifyApprovalAttestation(rec, ctx({ now: Date.parse('2027-07-19T00:00:00Z') })), []);
});

test('an assertion that had already expired when the decision was made is refused', () => {
  const rec = signed(validRecord({
    validity: { issued_at: '2026-07-19T12:00:00Z' },
    subject: { assertion: { issued_at: '2026-07-19T11:04:00Z', expires_at: '2026-07-19T11:09:00Z' } },
  }));
  failsWith(rec, /had already expired when the decision was made/);
});

test('an assertion issued after the decision it attests is refused', () => {
  const rec = signed(validRecord({
    validity: { issued_at: '2026-07-19T11:00:00Z' },
    subject: { assertion: { issued_at: '2026-07-19T11:04:00Z', expires_at: '2026-07-19T11:09:00Z' } },
  }));
  failsWith(rec, /issued after the decision it attests/);
});

test('without a signed decision time the assertion window cannot be judged', () => {
  const rec = signed(validRecord({ validity: { issued_at: '' } }));
  failsWith(rec, /without a signed decision time/);
});

// Judging the window at the decision is only worth anything if the WINDOW cannot be edited. These
// two are the teeth of that: the bridge composes the JSON, so anything it can rewrite or delete
// without breaking the human's signature is decoration, not a control.
test('the assertion window is inside the signature — it cannot be rewritten to cover the decision', () => {
  const stale = signed(validRecord({
    validity: { issued_at: '2026-07-19T12:00:00Z' },
    subject: { assertion: { issued_at: '2026-07-19T11:04:00Z', expires_at: '2026-07-19T11:09:00Z' } },
  }));
  failsWith(stale, /had already expired when the decision was made/);
  // the same record, signature untouched, window moved to cover the decision
  const rewritten = JSON.parse(JSON.stringify(stale));
  rewritten.subject.assertion.issued_at = '2026-07-19T11:59:00Z';
  rewritten.subject.assertion.expires_at = '2026-07-19T12:04:00Z';
  failsWith(rewritten, /does NOT verify/);
});

test('deleting the assertion window is refused — no liveness evidence is not liveness proven', () => {
  for (const field of ['issued_at', 'expires_at', 'subject']) {
    const rec = JSON.parse(JSON.stringify(signed(validRecord())));
    delete rec.subject.assertion[field];
    const findings = verifyApprovalAttestation(rec, ctx());
    assert.ok(findings.some((f) => new RegExp(`subject\\.assertion\\.${field} missing`).test(f)), `deleting ${field} must be a finding, got ${findings}`);
    // and it cannot be deleted quietly: the field is signed, so the signature breaks too
    assert.ok(findings.some((f) => /does NOT verify/.test(f)), `${field} must be inside the signature`);
  }
});

test('an unparseable assertion window is a finding, not a skipped check', () => {
  failsWith(signed(validRecord({ subject: { assertion: { expires_at: 'next Tuesday' } } })), /subject\.assertion\.expires_at .* is not a parseable ISO-8601/);
});

// One click on the external surface is one decision. Keying replay on the change DIRECTORY meant
// every role inside it shared a slot, so a single webhook event could back product-owner AND
// second-line AND permission-to-launch. Keying on the (directory · stage · role) slot is exact.
test('one origin nonce cannot back two roles in the same change', () => {
  const seen = new Map();
  const site = 'CHG-2026-0117';
  const first = verifyApprovalAttestation(signed(validRecord()), ctx({ seen, site }), 'PA1 · risk-second-line');
  assert.deepEqual(first, []);
  const second = signed(validRecord({ role: 'product-owner', subject: { registry_id: 'po-fatima', idp_subject: 'idp|po' } }));
  const findings = verifyApprovalAttestation(second, ctx({ seen, site, role: 'product-owner', by: 'po-fatima' }), 'PA1 · product-owner');
  assert.ok(findings.some((f) => /origin\.nonce replays/.test(f)), `same nonce, second role: ${findings}`);
  assert.ok(findings.some((f) => /origin\.event_id replays/.test(f)));
});

test('one origin nonce cannot back both PA stages of the same change', () => {
  const seen = new Map();
  const site = 'CHG-2026-0117';
  verifyApprovalAttestation(signed(validRecord()), ctx({ seen, site }), 'PA1');
  const pa2 = signed(validRecord({ stage: 'PA2', bound_to: { artifact_digest: 'sha256:deadbeef' } }));
  const findings = verifyApprovalAttestation(pa2, ctx({ seen, site, stage: 'PA2' }), 'PA2');
  assert.ok(findings.some((f) => /origin\.nonce replays/.test(f)), `PA1 nonce reused for PA2: ${findings}`);
});

test('re-verifying the same slot is not a replay — the guard exempts exactly one thing', () => {
  const seen = new Map();
  const c = { seen, site: 'CHG-2026-0117' };
  const rec = signed(validRecord());
  assert.deepEqual(verifyApprovalAttestation(rec, ctx(c)), []);
  assert.deepEqual(verifyApprovalAttestation(rec, ctx(c)), [], 'the same record in the same slot verifies twice');
});

// An `ADOPT:` placeholder is worse than an absent pin: it reads as configured. The one thing this
// contract must never do is let an unapplied requirement read as satisfied.
test('an ADOPT: placeholder pin is reported as unconfigured, never skipped', () => {
  const unwired = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { public_key: pem(IDP), audience: 'ADOPT: the client id', required_acr: 'ADOPT: the level your policy demands' } }] };
  const weak = signed(validRecord({ subject: { assertion: { audience: 'attacker-chosen', acr: 'password-only' } } }));
  const findings = verifyApprovalAttestation(weak, ctx({ assertionIssuers: unwired }));
  for (const claim of ['audience', 'acr']) {
    assert.ok(findings.some((f) => new RegExp(`ADOPT: placeholder for ${claim}`).test(f)), `${claim}: ${findings}`);
  }
  // an explicit null records a deliberate opt-out and stays quiet
  const optedOut = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { public_key: pem(IDP), audience: null, required_acr: null } }] };
  assert.deepEqual(verifyApprovalAttestation(signed(validRecord()), ctx({ assertionIssuers: optedOut })), []);
});

// A reference key shipped in the bundle would be the same key in every adoption, and its private
// half demonstrably exists — it signed the worked example. A `description` saying "do not use this"
// is not a control, because no gate reads prose.
test('an issuer marked demo cannot evidence a decision, in either registry', () => {
  failsWith(signed(validRecord()), /is marked `"demo": true`/, ctx({
    assertionIssuers: { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', demo: true, verify: { public_key: pem(IDP) } }] },
  }));
  // rc.36 (D3): the refusal now comes from the ONE unified stack in core/attestations.mjs — the
  // message names the transcribed decision the demo key cannot underwrite.
  failsWith(signed(validRecord()), /issuer .* is marked `"demo": true`.*transcribed decision/, ctx({
    issuers: { issuers: [{ id: 'svc-floor-bridge', mechanism: 'ed25519', identity: 'svc-floor-bridge', demo: true, verify: { public_key: pem(BRIDGE) } }] },
  }));
});

test('the shipped assertion-issuers template carries no working key material', () => {
  const path = FIND('governance/assertion-issuers.template.json', 'docs/governance/assertion-issuers.json');
  if (!path) return; // absent in this layout; the shipped-example block below covers the pair
  for (const issuer of (JSON.parse(readFileSync(path, 'utf8')).issuers || [])) {
    assert.equal(trustAnchors(issuer).size, 0,
      `${issuer.id} ships usable trust material in a file copied into every adopting repository`);
  }
});

test('an unversioned record cannot be verified at all', () => {
  failsWith({ ...signed(validRecord()), schema: 'something.else/v9' }, /is not loom\.approval-attestation\/v1/);
  failsWith(null, /no approval attestation/);
});

test('platform mechanisms report UNVERIFIED-HERE rather than pretending', () => {
  const rec = signed(validRecord({ subject: { assertion: { mechanism: 'oidc-step-up' } } }));
  failsWith(rec, /UNVERIFIED-HERE/);
});

test('with no pinned identity-provider material the assertion is UNVERIFIED-HERE, never a pass', () => {
  failsWith(signed(validRecord()), /UNVERIFIED-HERE/, ctx({ assertionIssuers: null }));
});

// --- gaps a mutation review exposed: guards no test could fail ------------------------------

test('an unparseable expiry is a finding, not an approval that never expires', () => {
  failsWith(signed(validRecord({ validity: { expires_at: '31/12/2026' } })), /not a parseable ISO-8601 timestamp/);
});

// The bridge composes the record's JSON, so the bridge picks each value's TYPE. A guard that only
// inspects strings hands it the choice between "unparseable, therefore skip" (an approval that
// never expires) and Date.parse's own coercions (`0` → the year 2000, i.e. already expired).
// Neither is a judgement a human made.
test('a non-string expiry is refused too — the type is part of the check', () => {
  for (const bad of [true, 0, 1767139200000, { until: 'forever' }, ['never']]) {
    failsWith(signed(validRecord({ validity: { expires_at: bad } })), /not a parseable ISO-8601 timestamp/);
  }
});

test('a record with no origin block is refused — the replay guard is not opt-out by omission', () => {
  const rec = signed(validRecord());
  delete rec.origin;
  for (const f of ['system', 'event_id', 'nonce']) failsWith(rec, new RegExp(`origin\\.${f} missing`));
});

test('a forged CUSTODY signature does not verify either — both signatures are real crypto', () => {
  const rec = signed(validRecord(), { bridgeKey: ROGUE.privateKey });
  failsWith(rec, /does NOT verify/);
});

test('the trust anchor is the provider, not the scope — a subject pattern cannot hide an overlap', () => {
  const shared = {
    issuers: [
      SERVICE_ISSUERS.issuers[0],
      // same identity provider, narrowed by a subject pattern — still the same anchor
      { id: 'bank-approvals', mechanism: 'sigstore', identity: 'svc-floor-bridge', verify: { issuer: 'https://idp.example/oidc', subject_pattern: '*@bank.example' } },
    ],
  };
  const assertionReg = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { issuer: 'https://idp.example/oidc', public_key: pem(IDP) } }] };
  const rec = signed(validRecord({ subject: { assertion: { issuer: 'bank-idp' } } }));
  failsWith(rec, /one trust anchor in both registries/, ctx({ issuers: shared, assertionIssuers: assertionReg }));
});

// An entry that names a provider AND pins its keys is what a careful adopter writes. Reducing the
// entry to a single anchor meant the pinned key won and the provider-level overlap became
// invisible — the control switched itself off in its most careful configuration.
test('an issuer pinning BOTH key material and a provider still reveals a shared anchor', () => {
  const assertionReg = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { issuer: 'https://idp.example/oidc', public_key: pem(IDP) } }] };
  const svc = { issuers: [{ id: 'bank-approvals', mechanism: 'sigstore', identity: 'svc-floor-bridge', verify: { kind: 'sigstore-identity', issuer: 'https://idp.example/oidc' } }] };
  failsWith(signed(validRecord()), /one trust anchor in both registries/, ctx({ issuers: svc, assertionIssuers: assertionReg }));
  // …and a jwks_uri is material too, not decoration.
  const viaJwks = { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { public_key: pem(IDP), jwks_uri: 'https://idp.example/jwks' } }] };
  const svcJwks = { issuers: [{ id: 'bank-approvals', mechanism: 'ci-oidc', identity: 'svc-floor-bridge', verify: { jwks_uri: 'https://idp.example/jwks' } }] };
  failsWith(signed(validRecord()), /one trust anchor in both registries/, ctx({ issuers: svcJwks, assertionIssuers: viaJwks }));
});

test('two unwired ADOPT: stubs do not collide — a placeholder is not trust material', () => {
  const stub = (id, extra) => ({ id, mechanism: 'sigstore', identity: 'svc-floor-bridge', ...extra, verify: { issuer: 'ADOPT: your identity provider' } });
  const assertionReg = { issuers: [{ ...stub('bank-idp'), mechanism: 'ed25519', verify: { issuer: 'ADOPT: your identity provider', public_key: pem(IDP) } }] };
  const svc = { issuers: [stub('bank-approvals')] };
  const findings = verifyApprovalAttestation(signed(validRecord()), ctx({ issuers: svc, assertionIssuers: assertionReg }));
  assert.ok(!findings.some((f) => /one trust anchor in both registries/.test(f)), `false positive: ${findings}`);
});

test('an assertion issuer with no verification material at all is reported, not trusted', () => {
  failsWith(signed(validRecord()), /declares no verification material/, ctx({
    assertionIssuers: { issuers: [{ id: 'bank-idp', mechanism: 'ed25519', verify: { kind: 'oidc' } }] },
  }));
});

test('stableStringify sorts at every depth — nested material cannot collide', () => {
  assert.notEqual(stableStringify({ verify: { kind: 'x', cfg: { a: 1 } } }), stableStringify({ verify: { kind: 'x', cfg: { a: 2 } } }));
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});

// The contract has to survive its own use case: a high-tier change needs up to twelve approvals,
// each recorded into the passport as it arrives. Binding the whole passport would invalidate every
// signature already given, so sequential approval would be impossible.
test('a second approval does not invalidate the first — the binding is over the ANALYSIS', () => {
  const passport = {
    sections: { classification: { materiality: 'material' }, ownership: { product_owner: 'po-fatima' } },
    pa1: { decision: 'approved', approvals: [{ role: 'risk-second-line', by: 'risk-lena' }] },
  };
  const digestOf = (p) => sha256(stableStringify(p.sections));
  const first = signed(validRecord({ bound_to: { passport_digest: digestOf(passport) } }));
  const c = ctx({ passportDigest: digestOf(passport) });
  assert.deepEqual(verifyApprovalAttestation(first, c), []);

  // …the next role signs, and the passport grows. The analysis has not changed.
  passport.pa1.approvals.push({ role: 'compliance', by: 'comp-imran' });
  assert.deepEqual(verifyApprovalAttestation(first, ctx({ passportDigest: digestOf(passport) })), [],
    'an earlier approval must survive a later one being recorded');

  // …but editing the ANALYSIS still breaks it.
  passport.sections.classification.materiality = 'non-material';
  assert.ok(verifyApprovalAttestation(first, ctx({ passportDigest: digestOf(passport) }))
    .some((f) => /passport_digest does not match/.test(f)));
});

// --- mandatory-when-compiled -----------------------------------------------------------------

test('attestation-backed approval is required only when the compiled plan says so', () => {
  assert.equal(attestationRequired({ required_capabilities: { 'approval_attestation': { required: true } } }), true);
  assert.equal(attestationRequired({ required_capabilities: { 'approval_attestation': { required: false } } }), false);
  assert.equal(attestationRequired({}), false);
  assert.equal(attestationRequired(null), false);
});

// --- the SHIPPED worked example ---------------------------------------------------------------
// The bundled record is signed against the bundled plan and passport. Verifying it here is what
// keeps the example honest: if the passport is edited and the example is not re-signed, this
// fails — which is the same binding the gate enforces for a real approval.

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Fixtures resolve in BOTH layouts: the bundle, and an adopted repo that mounted them elsewhere.
const FIND = (...candidates) => candidates.map((c) => `${HARNESS}/${c}`).find(existsSync) || null;
const CHANGE = 'docs/governance/changes/CHG-2026-0042';
const SRC = {
  example: FIND('approval-attestation-example/pa1-risk-second-line.json'),
  plan: FIND('change-example/control-plan.json', `${CHANGE}/control-plan.json`),
  passport: FIND('change-example/product-passport.json', `${CHANGE}/product-passport.json`),
  identities: FIND('governance/identities.template.json', 'docs/governance/identities.json'),
  // The example's issuer registries live BESIDE the example, not in governance/: a working
  // reference key in a file that gets copied into every adopting repository would be the same key
  // in every adoption. These two are bundle-only and marked `demo: true`, which the gate refuses.
  attIssuers: FIND('approval-attestation-example/attestation-issuers.example.json'),
  asrIssuers: FIND('approval-attestation-example/assertion-issuers.example.json'),
};
if (Object.values(SRC).some((p) => !p)) {
  test('shipped approval-attestation example (fixtures absent in this layout — skipped)', { skip: true }, () => {});
} else {
  const EXAMPLE = SRC.example;
  const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const exampleCtx = () => ({
    stage: 'PA1',
    role: 'risk-second-line',
    by: 'risk-lena',
    plan: J(SRC.plan),
    passportDigest: passportDigest(dirname(SRC.passport)),
    registry: J(SRC.identities),
    issuers: J(SRC.attIssuers),
    assertionIssuers: J(SRC.asrIssuers),
    resolveApprover,
    identityOf,
    seen: new Map(),
    now: Date.parse('2026-07-25T00:00:00Z'),
  });

  /** The demo-anchor refusals are the example's whole point being demonstrated; nothing else may survive. */
  const beyondTheDemoRefusal = (findings) => findings.filter((f) => !/is marked `"demo": true`/.test(f));

  test('the shipped approval attestation verifies for REAL against the bundled plan and passport', () => {
    const findings = verifyApprovalAttestation(JSON.parse(readFileSync(EXAMPLE, 'utf8')), exampleCtx());
    assert.deepEqual(beyondTheDemoRefusal(findings), [], 'the example must verify: real ed25519 over the real payload');
    // …and the two demo anchors must be refused, which is the other half of what it demonstrates.
    assert.equal(findings.length, 2, `expected exactly the two demo refusals, got ${JSON.stringify(findings)}`);
  });

  test('editing the approved passport breaks the shipped example — the binding is live, not decorative', () => {
    const c = exampleCtx();
    c.passportDigest = sha256('{"the analysis":"as edited after the decision"}');
    assert.ok(verifyApprovalAttestation(JSON.parse(readFileSync(EXAMPLE, 'utf8')), c)
      .some((f) => /passport_digest does not match/.test(f)));
  });

  test('a flipped byte in the shipped assertion signature fails — real crypto, not a field check', () => {
    const rec = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    const sig = Buffer.from(rec.subject.assertion.signature, 'base64');
    sig[0] ^= 0xff;
    rec.subject.assertion.signature = sig.toString('base64');
    assert.ok(verifyApprovalAttestation(rec, exampleCtx()).some((f) => /does NOT verify/.test(f)));
  });
}
