// Tests for decision capture (Factory Floor WS5 · D5.2 — finding F1). Node built-in runner.
//
// These are written adversarially: for every control there is a test that would PASS if the control
// were deleted. The ones worth reading first are the group under "the bridge cannot manufacture a
// decision", because they are the ones where **every signature verifies** and the record is refused
// anyway — a forgery this module must catch is not a broken signature, it is a perfect signature
// made by the wrong party. If those tests ever go green with the independence checks removed, F1 is
// back and nothing else in the suite would notice.
//
// The cryptography here is REAL: fresh ed25519 key pairs are generated per run and used to sign the
// canonical payload, so the happy path proves the emitted envelope is accepted by the verifier that
// will judge it rather than proving that a hand-written shape looks plausible. Private halves never
// leave the process.
//
// What these tests do NOT prove, said here rather than in a commit message: nothing has been
// carried by a real bridge, no identity provider has minted a real step-up assertion, and WS5's
// entry gate — an independent second-line review of the workstream design — has not happened. A
// green suite means the refusals hold against the shapes modelled here. It does not mean the seam
// is active, which is exactly why every emission carries the non-authoritative label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { SCHEMA_ID, canonicalDecisionPayload, sha256, verifyApprovalAttestation } from './approval-attestations.mjs';
import { SCHEMA_ID as MAP_SCHEMA } from './identity-map.mjs';
import { signBody, verifyWebhook } from './floor-webhook.mjs';
import { identityOf, resolveApprover } from '../scripts/identity-registry-check.mjs';
import {
  AUTHORITY,
  FORBIDDEN_OPTIONS,
  NON_AUTHORITATIVE,
  REJECTIONS,
  assembleDecision,
  captureDecision,
  slotPath,
  verifyEmission,
} from './floor-decision.mjs';

// --- keys, registries, fixtures ------------------------------------------------------------------

const keys = () => generateKeyPairSync('ed25519');
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const sgn = (k, payload) => edSign(null, Buffer.from(payload, 'utf8'), k.privateKey).toString('base64');

/** The identity provider's key, and the bridge's. Two different keys is the entire contract. */
const IDP_KEY = keys();
const BRIDGE_KEY = keys();

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const DECIDED = '2026-07-26T11:58:00.000Z';
const READ = '2026-07-26T11:58:30.000Z';
const PERSON = '5d81f3a7-0c44-4e19-9b6a-2f8d1e037c55';
const SUBJECT = 'idp|8f14e45fceea167a5a36dedd4bea2543';
const SOURCE_SHA = '4b0bc5c1e2f3a495867d0c1b2a3948576e8f9012';

const REGISTRY = {
  groups: { builders: ['eng-sam', 'svc-floor-bridge'], 'second-line': ['risk-lena', 'comp-imran'] },
  identities: [
    { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'comp-imran', kind: 'human', roles: ['compliance'], groups: ['second-line'] },
    { id: 'po-fatima', kind: 'human', roles: ['product-owner'], groups: [] },
    { id: 'eng-sam', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [], groups: ['builders'] },
    // A bridge someone gave an approval role to. It fails the registry gate too; here it is a
    // fixture for the C10 refusal, which must not depend on that gate having been run.
    { id: 'svc-overreaching-bridge', kind: 'agent', roles: ['risk-second-line'], groups: ['builders'] },
  ],
};

const PLAN = {
  change_id: 'CHG-2026-0042',
  risk_tier: 'high',
  required_approver_roles: ['product-owner', 'risk-second-line', 'accountable-executive'],
  pa1_approver_roles: [],
  plan_hash: 'ca64b2e1bf1cac7c2020b255cb021a1b48efb29d79140c40af28ccd95ae86228',
};
const PASSPORT_DIGEST = sha256('{"analysis":"the passport sections, stably stringified"}');

const entry = (over = {}) => ({
  notion_person_id: PERSON,
  idp_subject: SUBJECT,
  registry_id: 'risk-lena',
  roles_at_mapping: ['risk-second-line'],
  verification: { method: 'assertion-derived', reference: 'enrolment-2026-05-04-0912Z' },
  mapped_at: '2026-05-04T09:14:11Z',
  mapped_by: 'comp-imran',
  status: 'active',
  ...over,
});
const map = (entries = [entry()]) => ({
  schema: MAP_SCHEMA,
  surface: { system: 'notion', workspace_id: 'ws-meridian' },
  idp: { issuer: 'https://idp.meridian.example/oidc', subject_claim: 'sub' },
  entries,
});
const RECON = { observed_at: '2026-07-25T00:00:00Z', observed_by: 'obs-platform', disabled_subjects: [] };

const ISSUERS = {
  issuers: [{
    id: 'bridge-key', mechanism: 'ed25519', identity: 'svc-floor-bridge',
    verify: { public_key: pem(BRIDGE_KEY) },
  }],
};
const ASSERTION_ISSUERS = {
  issuers: [{
    id: 'idp-meridian', mechanism: 'ed25519',
    verify: { public_key: pem(IDP_KEY), audience: 'loom-approval-surface', required_acr: 'urn:mace:incommon:iap:silver' },
  }],
};

const signal = (over = {}) => Object.freeze({
  event_id: 'evt-0001',
  event_type: 'page.properties_updated',
  workspace_id: 'ws-meridian',
  subscription_id: 'sub-floor-bridge',
  integration_id: 'int-floor-bridge',
  attempt: 1,
  claimed_at: '2026-07-26T11:58:20.000Z',
  refetch: Object.freeze({ kind: 'page', id: 'page-approval-row' }),
  ...over,
});

const observation = (over = {}) => ({
  entity: { kind: 'page', id: 'page-approval-row' },
  read_at: READ,
  read_by: 'svc-floor-bridge',
  data_source_id: 'ds_approvals_1',
  author: { id: PERSON, type: 'person' },
  decision: {
    change_id: 'CHG-2026-0042',
    stage: 'PA1',
    role: 'risk-second-line',
    outcome: 'approved',
    decided_at: DECIDED,
    nonce: 'n-5260375ec23371475039',
    ...over.decision,
  },
  ...over,
});

const claims = (over = {}) => ({
  mechanism: 'ed25519',
  issuer: 'idp-meridian',
  subject: SUBJECT,
  audience: 'loom-approval-surface',
  acr: 'urn:mace:incommon:iap:silver',
  issued_at: '2026-07-26T11:57:30.000Z',
  expires_at: '2026-07-26T12:02:30.000Z',
  ...over,
});

const ctx = (over = {}) => ({
  now: NOW,
  seen: new Map(),
  transcriber: 'svc-floor-bridge',
  plan: PLAN,
  passportDigest: PASSPORT_DIGEST,
  registry: REGISTRY,
  issuers: ISSUERS,
  assertionIssuers: ASSERTION_ISSUERS,
  map: map(),
  reconciliation: RECON,
  resolveApprover,
  identityOf,
  ...over,
});

const base = (over = {}) => ({
  signal: signal(),
  observation: observation(),
  assertion: claims(),
  bound_to: { source_sha: SOURCE_SHA },
  ...over,
});

/** The payload a clean baseline produces — the digest an identity provider is asked to bind. */
const BASELINE = assembleDecision(base(), ctx());

/**
 * Arm an input: attach the nonce and the two signatures over the payload the module says to bind.
 *
 * When the input under test is refused at phase 1 there is no payload to bind, so the BASELINE one
 * is used — which is precisely the adversary's position: a perfectly good assertion for a decision
 * they then edited. Tests of that kind therefore see the tested code AND `DC-R31`, and asserting
 * inclusion rather than equality is the honest way to read them.
 */
function arm(input, c, { assertionKey = IDP_KEY, bridgeKey = BRIDGE_KEY, attestation, unsigned } = {}) {
  const payload = assembleDecision(input, c).payload ?? BASELINE.payload;
  const assertion = input.assertion === undefined
    ? undefined
    : { ...input.assertion, nonce: sha256(payload), ...(unsigned ? {} : { signature: sgn(assertionKey, payload) }) };
  return {
    ...input,
    ...(assertion === undefined ? {} : { assertion }),
    attestation: attestation === undefined ? { issuer: 'bridge-key', signature: sgn(bridgeKey, payload) } : attestation,
  };
}

/** Capture with the baseline, overridden by `input` / `context`, fully armed. */
function run(input = {}, context = {}, opts = {}) {
  const c = ctx(context);
  const armed = arm(base(input), c, opts);
  return captureDecision(opts.tamper ? opts.tamper(armed) : armed, c);
}

const codes = (r) => r.findings.map((f) => (f.match(/DC-R\d+/) || ['none'])[0]);
const has = (r, code) => codes(r).includes(code);

// --- the happy path, and what it is allowed to hand back -----------------------------------------

test('a fully evidenced decision emits an envelope, labelled, at a fixed path', () => {
  const r = run();
  assert.deepEqual(r.findings, []);
  assert.ok(r.envelope, 'a complete, independently asserted decision must produce an envelope');
  assert.equal(r.envelope.schema, SCHEMA_ID);
  assert.equal(r.envelope.governance.authority, AUTHORITY);
  assert.equal(r.envelope.governance.banner, NON_AUTHORITATIVE);
  assert.equal(r.path, 'approvals/pa1-risk-second-line.json');
  assert.deepEqual(r.unverified, [], 'an ed25519 assertion is verified here, so nothing is caveated');
});

test('the envelope is D2.4\'s own schema, and its own verifier accepts it', () => {
  const r = run();
  const findings = verifyApprovalAttestation(r.envelope, {
    stage: 'PA1',
    role: 'risk-second-line',
    by: 'risk-lena',
    plan: PLAN,
    passportDigest: PASSPORT_DIGEST,
    registry: REGISTRY,
    issuers: ISSUERS,
    assertionIssuers: ASSERTION_ISSUERS,
    resolveApprover,
    identityOf,
    map: map(),
    seen: new Map(),
    now: NOW,
  });
  // This is the acceptance criterion of D5.2 in one line: what the bridge assembles, the gate takes.
  assert.deepEqual(findings, [], 'the emitted envelope must satisfy the contract that will judge it');
});

test('the subject is RESOLVED through P6, and the origin records the click without carrying content', () => {
  const r = run();
  assert.equal(r.envelope.subject.registry_id, 'risk-lena');
  assert.equal(r.envelope.subject.idp_subject, SUBJECT);
  assert.equal(r.envelope.origin.person_id, PERSON);
  assert.equal(r.envelope.origin.event_id, 'evt-0001');
  assert.equal(r.envelope.origin.page_id, 'page-approval-row');
  assert.equal(r.envelope.bound_to.plan_hash, PLAN.plan_hash);
  assert.equal(r.envelope.bound_to.passport_digest, PASSPORT_DIGEST);
  assert.equal(r.envelope.transcription.by, 'svc-floor-bridge');
});

test('assembleDecision names the digest to bind, and the draft is not an envelope', () => {
  const c = ctx();
  const { draft, payload, nonce, findings } = assembleDecision(base(), c);
  assert.deepEqual(findings, []);
  assert.equal(nonce, sha256(payload));
  assert.equal(nonce, sha256(canonicalDecisionPayload(draft)));
  assert.equal(draft.subject.assertion.nonce, undefined, 'a draft cannot contain the answer to its own question');
  assert.equal(draft.subject.assertion.signature, undefined);
  assert.equal(draft.transcription.attestation, undefined);
  assert.equal(draft.governance.banner, NON_AUTHORITATIVE, 'a draft is as non-authoritative as an emission');
  // A draft is not evidence of anything and says so when read as an emission — nobody
  // authenticated it and nobody has carried it.
  assert.ok(verifyEmission(draft).some((f) => /DC-R31/.test(f)));
  assert.ok(verifyEmission(draft).some((f) => /DC-R22/.test(f)));
});

test('the module never records anything during assembly — a preview has no side effects', () => {
  const c = ctx();
  assembleDecision(base(), c);
  assembleDecision(base(), c);
  assert.equal(c.seen.size, 0, 'asking what to bind must not consume the nonce that has not been minted yet');
});

// --- the bridge cannot manufacture a decision (the F1 teeth) --------------------------------------

// THE test. The assertion below is signed by the BRIDGE's key, registered in the assertion
// registry under an innocent-looking id. The signature verifies. The nonce binds this exact
// decision. The window covers it. Every cryptographic check passes — and the envelope is refused,
// because the material that signed the human's assertion is material the bridge holds.
test('an assertion signed by the BRIDGE is refused even though its signature verifies', () => {
  const assertionIssuers = {
    issuers: [...ASSERTION_ISSUERS.issuers, { id: 'idp-lookalike', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }],
  };
  const r = run({ assertion: claims({ issuer: 'idp-lookalike' }) }, { assertionIssuers }, { assertionKey: BRIDGE_KEY });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R27'), `expected the trust-anchor overlap refusal, got ${codes(r)}`);
  assert.ok(r.findings.some((f) => /same verification material/.test(f)));

  // The control is the ONLY thing refusing it: register a genuinely separate key under the same id
  // and the identical shape is emitted. Without DC-R27, the case above would land here.
  const other = keys();
  const separate = {
    issuers: [...ASSERTION_ISSUERS.issuers, { id: 'idp-lookalike', mechanism: 'ed25519', verify: { public_key: pem(other) } }],
  };
  const ok = run({ assertion: claims({ issuer: 'idp-lookalike' }) }, { assertionIssuers: separate }, { assertionKey: other });
  assert.deepEqual(ok.findings, []);
  assert.ok(ok.envelope);
});

test('the module cannot be coaxed into emitting an envelope the bridge could have asserted', () => {
  const bridgeAlso = {
    issuers: [...ASSERTION_ISSUERS.issuers, { id: 'bridge-key', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }],
  };
  const routes = [
    // 1 · quote the service issuer id outright.
    ['DC-R25', run({ assertion: claims({ issuer: 'bridge-key' }) }, { assertionIssuers: bridgeAlso }, { assertionKey: BRIDGE_KEY })],
    // 2 · claim the bridge's registry identity as the issuer.
    ['DC-R26', run({ assertion: claims({ issuer: 'svc-floor-bridge' }) }, {}, { assertionKey: BRIDGE_KEY })],
    // 3 · reuse the transcription attestation's own issuer.
    ['DC-R26', run({ assertion: claims({ issuer: 'bridge-key' }) }, { assertionIssuers: bridgeAlso }, { assertionKey: BRIDGE_KEY })],
    // 4 · a fresh id, the bridge's key (the realistic version: two ids, one key).
    ['DC-R27', run({ assertion: claims({ issuer: 'idp-lookalike' }) }, {
      assertionIssuers: { issuers: [...ASSERTION_ISSUERS.issuers, { id: 'idp-lookalike', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }] },
    }, { assertionKey: BRIDGE_KEY })],
    // 5 · an issuer with nothing pinned, so nothing can be told apart from the bridge's key.
    ['DC-R29', run({ assertion: claims({ issuer: 'idp-unpinned' }) }, {
      assertionIssuers: { issuers: [...ASSERTION_ISSUERS.issuers, { id: 'idp-unpinned', mechanism: 'ed25519', verify: { public_key: 'ADOPT: paste your provider key' } }] },
    })],
    // 6 · the bundle's reference issuer, whose private half signed the worked example.
    ['DC-R30', run({}, {
      assertionIssuers: { issuers: [{ ...ASSERTION_ISSUERS.issuers[0], demo: true }] },
    })],
    // 7 · no assertion at all: a transcription-only record, which is F1 verbatim.
    ['DC-R23', run({ assertion: undefined })],
  ];
  for (const [code, r] of routes) {
    assert.equal(r.envelope, null, `route ${code} emitted an envelope`);
    assert.ok(has(r, code), `route ${code} refused with ${codes(r)}`);
  }
});

test('a transcription-only record says which party it authenticates', () => {
  const r = run({ assertion: undefined });
  assert.ok(r.findings.some((f) => /the service is authentic, the approval is not/.test(f)));
});

test('editing the decision after the assertion was minted breaks the binding', () => {
  // The bridge holds a genuine assertion for "risk-second-line approved at PA1" and tries to spend
  // it on a different role. Nothing about the signature is wrong; the nonce simply no longer names
  // this decision — which is the whole reason ADR-0005 made the nonce non-negotiable.
  const c = ctx();
  const armed = arm(base(), c);
  const swapped = { ...armed, observation: observation({ decision: { role: 'product-owner' } }) };
  const r = captureDecision(swapped, c);
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R31'));
  assert.ok(r.findings.some((f) => /assembleDecision/.test(f)), 'the message must say how to do it properly');
});

test('a decision with no nonce at all is a login, not an approval', () => {
  const c = ctx();
  const armed = arm(base(), c);
  delete armed.assertion.nonce;
  const r = captureDecision(armed, c);
  assert.ok(has(r, 'DC-R31'));
  assert.ok(r.findings.some((f) => /separates an approval from a login/.test(f)));
});

test('one authentication backs one decision — the same nonce cannot be spent on a second slot', () => {
  const c = ctx({ site: 'docs/governance/changes/CHG-2026-0042' });
  const armed = arm(base(), c);
  assert.ok(captureDecision(armed, c).envelope, 'the first use is fine');
  // Same assertion, same nonce, a different record slot: a copied change directory, a re-launch
  // route. Refused rather than silently backing two records.
  const second = captureDecision(armed, { ...c, site: 'docs/governance/changes/CHG-2026-0042-copy' });
  assert.equal(second.envelope, null);
  assert.ok(has(second, 'DC-R32'));
  // Re-emitting the SAME slot is a replacement, not a replay, and stays available.
  assert.ok(captureDecision(armed, c).envelope, 'a re-emission of one slot must not be refused');
});

test('a REFUSED capture does not consume the authentication it refused', () => {
  // Spending a nonce on a record that was never written is a denial primitive with no upside: the
  // adopter fixes the unrelated problem, retries, and is told their assertion is used up.
  const c = ctx();
  const armed = arm(base(), c);
  const broken = captureDecision({ ...armed, attestation: null }, c);
  assert.equal(broken.envelope, null);
  assert.equal(c.seen.size, 0, 'a refused capture must leave the single-use set untouched');
  assert.ok(captureDecision(armed, c).envelope, 'the corrected retry must still be emittable');
});

test('an unpinned identity provider is not trusted', () => {
  const r = run({ assertion: claims({ issuer: 'idp-nobody-registered' }) });
  assert.ok(has(r, 'DC-R28'));
});

test('an assertion with no issuer has nothing to check independence against', () => {
  const r = run({ assertion: claims({ issuer: '' }) });
  assert.ok(has(r, 'DC-R28'));
});

test('an unknown assertion mechanism is refused, not assumed', () => {
  const r = run({ assertion: claims({ mechanism: 'trust-me' }) });
  assert.ok(has(r, 'DC-R24'));
});

test('a declared ed25519 assertion with no signature is an unsigned claim in a signed shape', () => {
  const r = run({}, {}, { unsigned: true });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R23'));
});

test('an assertion for one human cannot be spent on another\'s decision', () => {
  const r = run({ assertion: claims({ subject: 'idp|someone-else' }) });
  assert.ok(has(r, 'DC-R33'));
});

test('the assertion\'s window is judged against the SIGNED decision time, and fails closed', () => {
  const expired = run({ assertion: claims({ issued_at: '2026-07-26T11:50:00.000Z', expires_at: '2026-07-26T11:55:00.000Z' }) });
  assert.ok(has(expired, 'DC-R34'));
  assert.ok(expired.findings.some((f) => /before the decision/.test(f)));

  const later = run({ assertion: claims({ issued_at: '2026-07-26T11:59:00.000Z', expires_at: '2026-07-26T12:04:00.000Z' }) });
  assert.ok(has(later, 'DC-R34'));
  assert.ok(later.findings.some((f) => /cannot attest a decision that preceded it/.test(f)));

  // Absent is not "proven live". An assertion with no declared window would otherwise read exactly
  // like one that was verified — the absent-vs-present asymmetry this repo refuses everywhere.
  const none = run({ assertion: claims({ issued_at: undefined, expires_at: undefined }) });
  assert.ok(has(none, 'DC-R34'));
  assert.equal(none.findings.filter((f) => /DC-R34/.test(f)).length, 2, 'both halves of the window are required');
});

// --- the platform mechanisms: honest caveats, never silent passes ---------------------------------

test('an oidc-step-up assertion is emitted WITH its UNVERIFIED-HERE caveat, not silently', () => {
  const assertionIssuers = {
    issuers: [{ id: 'idp-meridian', mechanism: 'oidc-step-up', verify: { issuer: 'https://idp.meridian.example/oidc' } }],
  };
  const r = run({ assertion: claims({ mechanism: 'oidc-step-up' }) }, { assertionIssuers }, { unsigned: true });
  assert.deepEqual(r.findings, [], `ADR-0005's accepted primary mechanism must be emittable: ${r.findings}`);
  assert.ok(r.envelope);
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0], /UNVERIFIED-HERE/);
  // The partition is keyed on that marker. If the upstream wording ever changes, this caveat is
  // reclassified as a REFUSAL and the emission stops — the module gets stricter, never laxer.
  assert.match(r.unverified[0], /mechanism/);
});

test('an UNVERIFIED-HERE finding that is NOT about the mechanism is a refusal', () => {
  // An unconfigured `ADOPT:` audience pin reads as configured and enforces nothing. The contract
  // reports it as UNVERIFIED-HERE; a broad "excuse anything unverified" partition would wave it
  // through, so this pins the narrow one.
  const assertionIssuers = {
    issuers: [{ ...ASSERTION_ISSUERS.issuers[0], verify: { ...ASSERTION_ISSUERS.issuers[0].verify, audience: 'ADOPT: your approvals audience' } }],
  };
  const r = run({}, { assertionIssuers });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R35'));
  assert.ok(r.findings.some((f) => /ADOPT: placeholder/.test(f)));
});

test('a pinned claim that the assertion contradicts is refused by the self-check', () => {
  const r = run({ assertion: claims({ acr: 'urn:mace:incommon:iap:bronze' }) });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R35'));
  assert.ok(r.findings.some((f) => /acr/.test(f)));
});

test('a forged transcription signature is caught by the self-check, not shrugged off', () => {
  const wrong = keys();
  const r = run({}, {}, { bridgeKey: wrong });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R35'));
  assert.ok(r.findings.some((f) => /does NOT verify/.test(f)));
});

// --- authors: machine judgment is never laundered into human accountability -----------------------

test('a bot or agent author is refused, on the refetch as well as on the delivery', () => {
  for (const type of ['bot', 'agent']) {
    const r = run({ observation: observation({ author: { id: 'automation-1', type } }) });
    assert.equal(r.envelope, null);
    assert.ok(has(r, 'DC-R08'), `${type} author was not refused: ${codes(r)}`);
  }
});

test('an automation among the co-authors makes the row unusable, not acceptable', () => {
  const r = run({ observation: observation({ authors: [{ id: PERSON, type: 'person' }, { id: 'bot-1', type: 'bot' }] }) });
  assert.ok(has(r, 'DC-R08'));
});

test('an unknown or absent author type fails closed — the allow-list is the point', () => {
  for (const author of [undefined, {}, { id: 'x', type: 'workspace' }, { id: 'x', type: 'automation' }, { type: 'person' }]) {
    const r = run({ observation: observation({ author }) });
    assert.ok(has(r, 'DC-R09'), `author ${JSON.stringify(author)} was accepted`);
  }
});

test('the webhook layer refuses a bot author too, so neither layer is load-bearing alone', () => {
  const body = JSON.stringify({
    id: 'evt-0002',
    timestamp: '2026-07-26T11:59:30.000Z',
    workspace_id: 'ws-meridian',
    authors: [{ id: 'bot-1', type: 'bot' }],
    entity: { id: 'page-approval-row', type: 'page' },
    type: 'page.properties_updated',
  });
  const w = verifyWebhook(body, { 'X-Notion-Signature': signBody(body, 'tok') }, { secret: 'tok', now: NOW, seen: new Map() });
  assert.equal(w.signal, null, 'WH-R17 must stop this before D5.2 is reached');
  assert.ok(w.findings.some((f) => /^WH-R17/.test(f)));
  // …and if it did reach here, null is not permission to record anything.
  assert.ok(has(captureDecision(base({ signal: w.signal }), ctx()), 'DC-R05'));
});

// --- signal discipline: a decision starts from a signal and is read from the source of truth ------

test('a real verified delivery produces a signal this module accepts — the shapes actually fit', () => {
  const body = JSON.stringify({
    id: 'evt-0003',
    timestamp: '2026-07-26T11:58:20.000Z',
    workspace_id: 'ws-meridian',
    subscription_id: 'sub-floor-bridge',
    authors: [{ id: PERSON, type: 'person' }],
    attempt_number: 1,
    entity: { id: 'page-approval-row', type: 'page' },
    type: 'page.properties_updated',
    data: { parent: { id: 'ds_approvals_1', type: 'data_source' } },
  });
  const w = verifyWebhook(body, { 'X-Notion-Signature': signBody(body, 'tok') }, { secret: 'tok', now: NOW, seen: new Map() });
  assert.deepEqual(w.findings, []);
  const r = run({ signal: w.signal });
  assert.deepEqual(r.findings, []);
  assert.equal(r.envelope.origin.event_id, 'evt-0003');
});

test('a duplicate, a refusal and a hand-waved signal are all null-shaped and all refused', () => {
  for (const s of [undefined, null, {}, { event_id: 'e' }, { refetch: { kind: 'page', id: 'p' } }, 'evt-1']) {
    assert.ok(has(run({ signal: s }), 'DC-R05'), `signal ${JSON.stringify(s)} was accepted`);
  }
});

test('a signal naming something other than a page cannot carry a decision', () => {
  const r = run({ signal: signal({ refetch: { kind: 'comment', id: 'cmt-1' } }) });
  assert.ok(has(r, 'DC-R06'));
});

test('the observation must describe the entity the signal named', () => {
  const r = run({ observation: observation({ entity: { kind: 'page', id: 'page-somewhere-else' } }) });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R06'));
});

test('content hung on the signal is never read — the decision comes from the refetch', () => {
  // A caller (or a compromised delivery path) attaching the decision to the signal must not be able
  // to influence one field of the record. This is D4.3's guarantee restated at the capture boundary.
  const loaded = { ...signal(), decision: { role: 'accountable-executive', outcome: 'approved' }, data: { properties: { Decision: 'Approved' } } };
  const r = run({ signal: loaded });
  assert.deepEqual(r.findings, []);
  assert.equal(r.envelope.role, 'risk-second-line');
  assert.equal(r.envelope.subject.registry_id, 'risk-lena');
  assert.equal(JSON.stringify(r.envelope).includes('accountable-executive'), false);
});

test('a read with no evidence, an impossible read, and someone else\'s read are all refused', () => {
  const cases = [
    observation({ read_at: undefined }),
    observation({ read_at: 'yesterday' }),
    observation({ read_at: '2026-07-26T12:05:00.000Z' }),   // after `now`, beyond skew
    observation({ read_by: 'risk-lena' }),                   // the approver read it, not the bridge
    observation({ read_by: undefined }),
    observation({ read_at: '2026-07-26T11:50:00.000Z' }),    // before the decision it reports
  ];
  for (const obs of cases) {
    const r = run({ observation: obs });
    assert.equal(r.envelope, null);
    assert.ok(has(r, 'DC-R07'), `observation ${JSON.stringify(obs.read_at)}/${obs.read_by} was accepted`);
  }
  assert.ok(has(run({ observation: undefined }), 'DC-R07'));
});

// --- what the caller may not decide --------------------------------------------------------------

test('a caller who NAMES the approver is refused — that field is F1 as a convenience', () => {
  const r = run({ subject: { registry_id: 'risk-lena', idp_subject: SUBJECT } });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R12'));
  // Even naming the correct person is refused: the point is that the bridge does not get to answer.
  assert.ok(r.findings.some((f) => /resolved|P6/.test(f)));
});

test('the caller cannot bind the decision to a plan that is not the one in force', () => {
  const forged = run({ bound_to: { source_sha: SOURCE_SHA, plan_hash: 'a-plan-that-suits-me' } });
  assert.ok(has(forged, 'DC-R13'));
  assert.ok(has(run({ bound_to: { passport_digest: 'sha256:whatever' } }), 'DC-R13'));
  assert.ok(has(run({ bound_to: { source_sha: SOURCE_SHA, notes: 'looks fine to me' } }), 'DC-R13'));
});

test('the decision must name the change, stage, role and instant the plan compiles', () => {
  const cases = [
    ['DC-R10', observation({ decision: { change_id: 'CHG-9999-0001' } })],
    ['DC-R10', observation({ decision: { stage: 'PA3' } })],
    ['DC-R10', observation({ decision: { role: undefined } })],
    ['DC-R10', observation({ decision: { role: 'shariah-committee' } })],   // real role, not compiled here
    ['DC-R10', observation({ decision: { decided_at: 'sometime tuesday' } })],
    ['DC-R10', observation({ decision: { nonce: undefined } })],
  ];
  for (const [code, obs] of cases) {
    const r = run({ observation: obs });
    assert.equal(r.envelope, null);
    assert.ok(has(r, code), `${JSON.stringify(obs.decision)} was accepted`);
  }
  assert.ok(has(run({ expires_at: 'never' }), 'DC-R10'));
});

test('only an approval has a shape in this schema', () => {
  for (const outcome of ['rejected', 'abstained', 'approved-with-conditions', undefined]) {
    const r = run({ observation: observation({ decision: { outcome } }) });
    assert.equal(r.envelope, null);
    assert.ok(has(r, 'DC-R11'), `outcome ${outcome} was emitted`);
  }
});

// --- P6: an unmapped human is an unknown human ---------------------------------------------------

test('an unmapped surface person id resolves to nobody, and there is no fallback', () => {
  const r = run({ observation: observation({ author: { id: 'person-never-enrolled', type: 'person' } }) });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R15'));
  assert.ok(r.findings.some((f) => /no fallback|merged PR/.test(f)));
});

test('two active mappings for one account refuse rather than pick one', () => {
  const dup = map([entry(), entry({ registry_id: 'po-fatima', idp_subject: 'idp|other' })]);
  const r = run({}, { map: dup });
  assert.ok(has(r, 'DC-R16'));
});

test('a revoked mapping grants nothing, and a decision predating the mapping is not authorised', () => {
  const revoked = map([entry({
    status: 'revoked', revoked_at: '2026-07-01T00:00:00Z', revoked_by: 'comp-imran', revocation_class: 'departed',
  })]);
  // A revoked entry is not active at all, so the account resolves to nobody.
  assert.ok(has(run({}, { map: revoked }), 'DC-R15'));

  const later = map([entry({ mapped_at: '2026-07-26T11:59:00Z' })]);
  const r = run({}, { map: later });
  assert.ok(has(r, 'DC-R17'));
  assert.ok(r.findings.some((f) => /cannot authorise a click that predates it/.test(f)));
});

test('an unsound or stale map resolves nobody', () => {
  // §2.3: the map has no field for an address. Carrying one is refused, not ignored.
  const byEmail = map([{ ...entry(), email: 'lena@meridian.example' }]);
  assert.ok(has(run({}, { map: byEmail }), 'DC-R14'));

  // Currency is observed, not declared.
  assert.ok(has(run({}, { reconciliation: null }), 'DC-R03'), 'an absent observation is a configuration refusal');
  const stale = { ...RECON, observed_at: '2026-06-01T00:00:00Z' };
  assert.ok(has(run({}, { reconciliation: stale }), 'DC-R14'));

  // The directory is authoritative over the map.
  const disabled = { ...RECON, disabled_subjects: [SUBJECT] };
  assert.ok(has(run({}, { reconciliation: disabled }), 'DC-R14'));
});

test('the resolved human must hold the role the decision claims', () => {
  const wrongPerson = map([entry({ registry_id: 'po-fatima', roles_at_mapping: ['product-owner'] })]);
  const r = run({}, { map: wrongPerson });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R18'));
  assert.ok(r.findings.some((f) => /does not hold the required role/.test(f)));
});

// --- the bridge holds no approval role ----------------------------------------------------------

test('a transcriber holding an approval role is refused — C10 says every machine row is `no`', () => {
  const r = run({}, {
    transcriber: 'svc-overreaching-bridge',
    issuers: { issuers: [{ id: 'bridge-key', mechanism: 'ed25519', identity: 'svc-overreaching-bridge', verify: { public_key: pem(BRIDGE_KEY) } }] },
    // the observation's read_by must still match the transcriber, or DC-R07 answers first
  }, { tamper: (a) => ({ ...a, observation: observation({ read_by: 'svc-overreaching-bridge' }) }) });
  assert.equal(r.envelope, null);
  assert.ok(has(r, 'DC-R20'));
  assert.ok(r.findings.some((f) => /signs what it READ, never what a human DECIDED/.test(f)));
});

test('an unregistered or human transcriber cannot be credited with custody', () => {
  const unregistered = run({}, { transcriber: 'svc-not-in-the-registry' },
    { tamper: (a) => ({ ...a, observation: observation({ read_by: 'svc-not-in-the-registry' }) }) });
  assert.ok(has(unregistered, 'DC-R19'));

  const human = run({}, {
    transcriber: 'eng-sam',
    issuers: { issuers: [{ id: 'bridge-key', mechanism: 'ed25519', identity: 'eng-sam', verify: { public_key: pem(BRIDGE_KEY) } }] },
  }, { tamper: (a) => ({ ...a, observation: observation({ read_by: 'eng-sam' }) }) });
  assert.ok(has(human, 'DC-R19'));
});

test('custody and decision must be separable — the bridge may not be the approver', () => {
  const bridgeIsMapped = map([entry({ registry_id: 'svc-floor-bridge' })]);
  const r = run({}, { map: bridgeIsMapped });
  assert.equal(r.envelope, null);
  // IM-R20 (a service has no clicks to attest to) and DC-R21 both fire; either alone is enough.
  // Three independent refusals fire, and any one of them is enough: the map refuses to bind a
  // service at all (IM-R20 via DC-R14), the service holds no approver role (DC-R18), and custody
  // and decision have collapsed into one identity (DC-R21).
  assert.ok(has(r, 'DC-R21'), codes(r).join(', '));
  assert.ok(has(r, 'DC-R14'));
  assert.ok(has(r, 'DC-R18'));
  assert.ok(r.findings.some((f) => /svc-floor-bridge/.test(f)));
});

test('the transcription attestation must be present, registered, and signed for the transcriber', () => {
  const cases = [
    ['DC-R22', undefined],
    ['DC-R22', { issuer: 'bridge-key' }],
    ['DC-R22', { issuer: 'unregistered-key', signature: 'AAAA' }],
  ];
  for (const [code, attestation] of cases) {
    const r = run({}, {}, { attestation: attestation === undefined ? null : attestation });
    assert.equal(r.envelope, null);
    assert.ok(has(r, code), `attestation ${JSON.stringify(attestation)} was accepted`);
  }
  // A registered key that signs for someone else must not be able to credit the bridge.
  const misattributed = run({}, {
    issuers: { issuers: [{ id: 'bridge-key', mechanism: 'ed25519', identity: 'svc-overreaching-bridge', verify: { public_key: pem(BRIDGE_KEY) } }] },
  });
  assert.ok(has(misattributed, 'DC-R22'));
  // …and one bound to no identity at all leaves the custodian uncheckable.
  const unbound = run({}, {
    issuers: { issuers: [{ id: 'bridge-key', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }] },
  });
  assert.ok(has(unbound, 'DC-R22'));
});

// --- the label: there is no knob, and it cannot be stripped in place ------------------------------

test('every option that would switch the label off is refused on sight', () => {
  for (const knob of FORBIDDEN_OPTIONS) {
    const viaInput = run({ [knob]: knob === 'authoritative' ? true : 'yes please' });
    assert.ok(has(viaInput, 'DC-R04'), `input.${knob} was accepted`);
    const viaCtx = run({}, { [knob]: false });
    assert.ok(has(viaCtx, 'DC-R04'), `ctx.${knob} was accepted`);
  }
  // The refusal comes FIRST: asking for an unlabelled envelope is not answered with a list of
  // other problems, because it is the one request this module cannot fulfil.
  const alsoBroken = run({ governance: { authority: 'full' }, signal: null, observation: undefined });
  assert.deepEqual(codes(alsoBroken), ['DC-R04']);
});

test('the emitted envelope cannot be stripped of its label in place', () => {
  const r = run();
  assert.throws(() => { delete r.envelope.governance; }, TypeError);
  assert.throws(() => { r.envelope.governance.banner = 'looks approved to me'; }, TypeError);
  assert.throws(() => { r.envelope.subject.assertion.signature = 'x'; }, TypeError);
  assert.equal(r.envelope.governance.banner, NON_AUTHORITATIVE);
});

test('verifyEmission accepts what was emitted and refuses a relabelled copy', () => {
  const r = run();
  assert.deepEqual(verifyEmission(r.envelope), []);
  const stripped = { ...r.envelope, governance: undefined };
  assert.ok(verifyEmission(stripped).some((f) => /DC-R36/.test(f)));
  // A paraphrase is not the sentence. This is the same stance floor-project.mjs takes.
  const paraphrased = { ...r.envelope, governance: { authority: AUTHORITY, banner: NON_AUTHORITATIVE.replace('NON-AUTHORITATIVE', 'Non-authoritative') } };
  assert.ok(verifyEmission(paraphrased).some((f) => /DC-R36/.test(f)));
  const promoted = { ...r.envelope, governance: { authority: 'active', banner: NON_AUTHORITATIVE } };
  assert.ok(verifyEmission(promoted).some((f) => /DC-R36/.test(f)));
  assert.ok(verifyEmission(null).some((f) => /DC-R36/.test(f)));
  assert.ok(verifyEmission({ ...r.envelope, schema: 'something/v9' }).some((f) => /DC-R35/.test(f)));
});

// --- configuration fails closed ------------------------------------------------------------------

test('no clock, no single-use set, no context — each refuses rather than defaulting', () => {
  assert.ok(has(captureDecision(base(), ctx({ now: undefined })), 'DC-R01'));
  assert.ok(has(captureDecision(base(), ctx({ now: 'noon' })), 'DC-R01'));
  assert.ok(has(captureDecision(base(), ctx({ seen: undefined })), 'DC-R02'));
  assert.ok(has(captureDecision(base(), ctx({ seen: {} })), 'DC-R02'));
  for (const key of ['transcriber', 'plan', 'passportDigest', 'registry', 'issuers', 'assertionIssuers', 'map', 'reconciliation', 'resolveApprover', 'identityOf']) {
    const r = captureDecision(base(), ctx({ [key]: undefined }));
    assert.ok(has(r, 'DC-R03'), `${key} was defaulted`);
    assert.ok(r.findings.some((f) => f.includes(`\`${key}\``)), `${key} is not named in its own refusal`);
  }
  // A non-function passed where the identity gate's function belongs is not "configured".
  assert.ok(has(captureDecision(base(), ctx({ identityOf: 'identityOf' })), 'DC-R03'));
  // `seen` is not required to ASK what to bind — only to spend it.
  assert.deepEqual(assembleDecision(base(), ctx({ seen: undefined })).findings, []);
});

// --- structural claims about the module itself ---------------------------------------------------

const SOURCE = readFileSync(new URL('./floor-decision.mjs', import.meta.url), 'utf8');

test('the bridge cannot commit: this module has no filesystem and no network', () => {
  // "The bridge opens the PR and a second-line human merges" is a claim about capability, so it is
  // checked rather than promised. A module that could write could write an approval. The check
  // reads the IMPORTS, not the prose — the header talks about `node:fs` precisely to say it is
  // absent, and a substring search over the whole file would fail on its own honesty.
  const imports = SOURCE.split('\n').filter((l) => /^\s*(import|const .* = (await )?import)\b/.test(l)).join('\n');
  assert.equal(/node:fs|node:http|node:https|node:net|node:dgram|node:child_process/.test(imports), false, imports);
  assert.equal(/\b(writeFileSync|appendFileSync|execSync|spawnSync|fetch)\s*\(/.test(SOURCE), false);
});

test('every rejection code the module can emit is documented, and every documented code is reachable', () => {
  const used = new Set(SOURCE.match(/DC-R\d+/g) || []);
  for (const code of used) assert.ok(REJECTIONS.has(code), `${code} is emitted but not documented in REJECTIONS`);
  for (const code of REJECTIONS.keys()) {
    const occurrences = (SOURCE.match(new RegExp(code, 'g')) || []).length;
    assert.ok(occurrences >= 2, `${code} is documented but never emitted (${occurrences} occurrence)`);
    assert.ok(REJECTIONS.get(code).length > 20, `${code} needs a reason, not a label`);
  }
  assert.equal(used.size, REJECTIONS.size);
});

test('every documented code is actually reachable through the API, not just present in the source', () => {
  // The reachability check above reads the source; this one is behavioural. Between them, a code
  // cannot be decoration — it is documented, it is emitted, and a test has seen it emitted.
  const seen = new Set();
  const collect = (r) => { for (const c of codes(r)) seen.add(c); };
  collect(captureDecision(base(), ctx({ now: undefined })));
  collect(captureDecision(base(), ctx({ seen: undefined })));
  collect(captureDecision(base(), ctx({ plan: undefined })));
  collect(run({ governance: {} }));
  collect(run({ signal: null }));
  collect(run({ signal: signal({ refetch: { kind: 'block', id: 'b' } }) }));
  collect(run({ observation: undefined }));
  collect(run({ observation: observation({ author: { id: 'b', type: 'bot' } }) }));
  collect(run({ observation: observation({ author: { id: 'x', type: 'workspace' } }) }));
  collect(run({ observation: observation({ decision: { stage: 'PA3' } }) }));
  collect(run({ observation: observation({ decision: { outcome: 'rejected' } }) }));
  collect(run({ subject: {} }));
  collect(run({ bound_to: { plan_hash: 'x' } }));
  collect(run({}, { reconciliation: { ...RECON, observed_at: '2026-01-01T00:00:00Z' } }));
  collect(run({ observation: observation({ author: { id: 'nobody', type: 'person' } }) }));
  collect(run({}, { map: map([entry(), entry({ registry_id: 'po-fatima', idp_subject: 'idp|other' })]) }));
  collect(run({}, { map: map([entry({ mapped_at: '2026-07-26T11:59:00Z' })]) }));
  collect(run({}, { map: map([entry({ registry_id: 'po-fatima', roles_at_mapping: [] })]) }));
  collect(run({}, { transcriber: 'svc-not-registered' }));
  collect(run({}, { transcriber: 'svc-overreaching-bridge', issuers: { issuers: [{ id: 'bridge-key', mechanism: 'ed25519', identity: 'svc-overreaching-bridge', verify: { public_key: pem(BRIDGE_KEY) } }] } },
    { tamper: (a) => ({ ...a, observation: observation({ read_by: 'svc-overreaching-bridge' }) }) }));
  collect(run({}, { map: map([entry({ registry_id: 'svc-floor-bridge' })]) }));
  collect(run({}, {}, { attestation: null }));
  collect(run({ assertion: undefined }));
  collect(run({ assertion: claims({ mechanism: 'trust-me' }) }));
  collect(run({ assertion: claims({ issuer: 'bridge-key' }) }, { assertionIssuers: { issuers: [...ASSERTION_ISSUERS.issuers, { id: 'bridge-key', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }] } }));
  collect(run({ assertion: claims({ issuer: 'svc-floor-bridge' }) }));
  collect(run({ assertion: claims({ issuer: 'idp-lookalike' }) }, { assertionIssuers: { issuers: [...ASSERTION_ISSUERS.issuers, { id: 'idp-lookalike', mechanism: 'ed25519', verify: { public_key: pem(BRIDGE_KEY) } }] } }));
  collect(run({ assertion: claims({ issuer: 'idp-nobody' }) }));
  collect(run({ assertion: claims({ issuer: 'idp-unpinned' }) }, { assertionIssuers: { issuers: [{ id: 'idp-unpinned', mechanism: 'ed25519', verify: {} }] } }));
  collect(run({}, { assertionIssuers: { issuers: [{ ...ASSERTION_ISSUERS.issuers[0], demo: true }] } }));
  collect(run({ assertion: claims({ subject: 'idp|else' }) }));
  collect(run({ assertion: claims({ expires_at: '2026-07-26T11:00:00.000Z' }) }));
  collect(run({}, {}, { bridgeKey: keys() }));
  const c = ctx({ site: 'slot-a' });
  const armed = arm(base(), c);
  captureDecision(armed, c);
  collect(captureDecision(armed, { ...c, site: 'slot-b' }));
  const tampered = captureDecision({ ...armed, observation: observation({ decision: { role: 'product-owner' } }) }, ctx());
  collect(tampered);
  collect(verifyEmission(null).length ? { findings: verifyEmission(null) } : { findings: [] });

  for (const code of REJECTIONS.keys()) {
    assert.ok(seen.has(code), `${code} is documented but no test has seen it emitted`);
  }
});

test('the label and the identifiers are values, not decoration', () => {
  assert.match(NON_AUTHORITATIVE, /NON-AUTHORITATIVE · DECLARED, NOT ACTIVE/);
  assert.match(NON_AUTHORITATIVE, /second-line review/);
  assert.equal(AUTHORITY, 'none');
  assert.equal(slotPath('PA1', 'risk-second-line'), 'pa1-risk-second-line.json');
  assert.equal(slotPath(undefined, undefined), 'unknown-unknown.json');
  // One file per slot: two roles cannot collide, and one role cannot become two approvals.
  assert.notEqual(slotPath('PA1', 'product-owner'), slotPath('PA2', 'product-owner'));
});
