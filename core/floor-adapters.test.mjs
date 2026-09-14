// Tests for the four evidence streams (Factory Floor WS5 · D5.3). Node runner: `node --test`.
//
// Every negative below is written the same way: it is the case that would PASS if the control it
// exercises were absent. That is the standard the threat model's §5 sets for the seam's negative
// suite, and it is the only kind of test that can tell a control from a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifySignatureOver } from './attestations.mjs';
import {
  CLOCK_SKEW_MINUTES,
  DEFAULT_MAX_AGE_DAYS,
  REJECTIONS,
  SCHEMA_ID,
  STREAMS,
  activationState,
  activationStates,
  badge,
  bypassProbes,
  checkAdapterDeclaration,
  checkCatalogClaims,
  checkCompiledRequirement,
  checkNegatives,
  checkObserver,
  checkStreamSeparation,
  evidenceHash,
  evidenceRecord,
  maxAgeDaysFor,
  requiredNegatives,
  satisfiedControls,
  selfDeclaresActive,
  verifyEvidence,
} from './floor-adapters.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

// The observer's key, BOUND to the observer's registry identity — the binding `checkObserver` needs
// to tell the credited observer from whoever happened to hold a key.
const ISSUERS = {
  issuers: [
    { id: 'platform-observer', mechanism: 'ed25519', identity: 'padmin-zoe', verify: { public_key: pem } },
    { id: 'bridge-key', mechanism: 'ed25519', identity: 'svc-floor-bridge', verify: { public_key: pem } },
    { id: 'demo-observer', mechanism: 'ed25519', identity: 'padmin-zoe', demo: true, verify: { public_key: pem } },
    { id: 'unbound-key', mechanism: 'ed25519', verify: { public_key: pem } },
  ],
};

// The reference registry's shape: the three seam services are agents in `builders`, the observer is
// the platform-admin, and there is a first-line human to prove the builder rule bites.
const REGISTRY = {
  groups: { builders: 'first line', 'platform-admins': 'control-plane owners' },
  identities: [
    { id: 'padmin-zoe', kind: 'human', roles: ['platform-admin'], groups: ['platform-admins'] },
    { id: 'infosec-noor', kind: 'human', roles: ['information-security'], groups: [] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [], groups: ['builders'] },
    { id: 'svc-floor-freezer', kind: 'agent', roles: [], groups: ['builders'] },
    { id: 'eng-omar', kind: 'human', roles: ['engineering'], groups: ['builders'] },
  ],
};

/** The mechanisms `scripts/platform-activation-check.mjs` owns. Agreement with the real enum is
 *  asserted in `scripts/adapter-evidence-check.test.mjs`, so this copy cannot drift silently. */
const FORGE = new Set(['branch_protection', 'rulesets', 'required_reviews', 'codeowners', 'workflow_permissions', 'environment_protection', 'oidc_subjects']);

const NOW = Date.parse('2026-07-26T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();

/** Stream 1 — the PA decision stream, verified here. */
function paAdapter(over = {}) {
  return {
    adapter_id: 'notion-pa-decision',
    system: 'notion',
    capability: 'a subject-bound human decision arrives authenticated',
    satisfies_control: 'PA-GATES',
    mechanism: 'human_decision_assertion',
    activation_source: 'adapter-evidence',
    evidence: {
      kind: 'human-decision',
      envelope_fields: ['change_id', 'stage', 'role', 'subject', 'observed_at'],
      observes_identities: ['svc-floor-bridge'],
      required_negatives: ['agent-or-bot-approval', 'unregistered-human', 'replay', 'post-decision-mutation'],
    },
    ...over,
  };
}

/** Stream 3 — a forge stream, verification delegated to the platform-activation gate. */
function holdAdapter(over = {}) {
  return {
    adapter_id: 'github-codeowners-hold',
    system: 'github',
    capability: 'neither freezer nor bridge can alter release-hold.json',
    satisfies_control: 'HG-0002',
    mechanism: 'codeowners',
    activation_source: 'platform-activation',
    evidence: { kind: 'codeowners-protection', envelope_fields: ['path', 'owners', 'fetched_at'], observes_identities: ['svc-floor-freezer', 'svc-floor-bridge'] },
    ...over,
  };
}

const probe = (negative, over = {}) => ({ negative, attempted: `attempted ${negative}`, result: 'rejected', tested_at: iso(1), ...over });
const ALL_PROBES = ['agent-or-bot-approval', 'unregistered-human', 'replay', 'post-decision-mutation'].map((n) => probe(n));

/** A fully valid stream-1 observation, signed over its own canonical hash. */
function evidence(over = {}, issuer = 'platform-observer') {
  const base = {
    schema: SCHEMA_ID,
    adapter_id: 'notion-pa-decision',
    satisfies_control: 'PA-GATES',
    mechanism: 'human_decision_assertion',
    observation: { surface: 'notion', authenticated_decisions: 3, bot_authors_dropped: 2 },
    bypass_tests: ALL_PROBES,
    observer_identity: 'padmin-zoe',
    observed_at: iso(1),
    ...over,
  };
  base.attestation = { issuer, signature: sign(null, Buffer.from(evidenceHash(base), 'utf8'), privateKey).toString('base64') };
  return base;
}

const ctx = (over = {}) => ({
  registry: REGISTRY, issuers: ISSUERS, verify: verifySignatureOver, now: NOW, delegatedMechanisms: FORGE, ...over,
});
const ver = (rec, adapter = paAdapter(), over = {}) => verifyEvidence(rec, { ...ctx(over), adapter }, 'ev');
const has = (findings, code) => findings.some((f) => f.startsWith(`${code}:`) || f.includes(` ${code}:`));

// ---------------------------------------------------------------------------------------------
// The happy path, and the shape of the four streams.
// ---------------------------------------------------------------------------------------------

test('a fresh, independently-signed, fully bypass-tested observation verifies', () => {
  assert.deepEqual(ver(evidence()), []);
});

test('D5.3 declares exactly four streams, each naming exactly one control, all distinct', () => {
  assert.equal(STREAMS.length, 4);
  const controls = STREAMS.map((s) => s.satisfies_control);
  assert.equal(new Set(controls).size, 4, 'four streams, four controls — sharing one would make them fungible');
  for (const s of STREAMS) {
    assert.equal(typeof s.satisfies_control, 'string');
    assert.ok(s.required_negatives.length >= 1, `${s.adapter_id} declares at least one negative`);
  }
  assert.deepEqual(STREAMS.map((s) => s.adapter_id).sort(),
    ['github-branch-protection', 'github-codeowners-hold', 'notion-activation', 'notion-pa-decision']);
});

test('every rejection code used by the module is documented in REJECTIONS', () => {
  // The codes are the operator's index into a red build; an undocumented one is a dead end.
  const cases = [
    ver(evidence({ satisfies_control: ['PA-GATES', 'HG-0002'] })),
    ver(evidence({ adapter_id: 'notion-activation' })),
    ver(evidence({ observed_at: iso(90) })),
    ver(evidence({ observer_identity: 'svc-floor-bridge' })),
    checkAdapterDeclaration(paAdapter({ satisfies_controls: ['A'] }), ctx()),
    checkAdapterDeclaration(paAdapter({ satisfies_control: undefined }), ctx()),
    checkAdapterDeclaration(paAdapter({ mechanism: 'vibes' }), ctx()),
    checkAdapterDeclaration(holdAdapter({ mechanism: 'seam_liveness' }), ctx()),
    checkAdapterDeclaration(paAdapter({ mechanism: 'codeowners' }), ctx()),
    checkAdapterDeclaration(paAdapter({ activation_source: 'trust-me' }), ctx()),
    checkStreamSeparation([paAdapter(), holdAdapter({ satisfies_control: 'PA-GATES' })]),
  ].flat();
  assert.ok(cases.length > 0);
  for (const f of cases) {
    const code = f.match(/AD-R\d\d/)?.[0];
    assert.ok(code, `finding carries a rejection code: ${f}`);
    assert.ok(REJECTIONS.has(code), `${code} is documented`);
  }
});

// ---------------------------------------------------------------------------------------------
// F4 · one adapter names exactly one control. Each of these would pass if the rule were absent.
// ---------------------------------------------------------------------------------------------

test('AD-R02 — an adapter carrying a PLURAL claim field is refused (the F4 shape)', () => {
  // `satisfies_controls` beside a valid singular `satisfies_control` passes adapter-check.mjs, which
  // only checks the singular field is a non-empty string. This is the second claim nobody reads.
  const f = checkAdapterDeclaration(paAdapter({ satisfies_controls: ['PA-GATES', 'HG-0002'] }), ctx());
  assert.ok(has(f, 'AD-R02'));
  assert.match(f.join('\n'), /satisfies_controls/);
});

test('AD-R02 — satisfies_control as an ARRAY is refused', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ satisfies_control: ['PA-GATES', 'HG-0002'] }), ctx()), 'AD-R02'));
});

test('AD-R02 — two control ids packed into one STRING are refused', () => {
  for (const packed of ['PA-GATES, HG-0002', 'PA-GATES;HG-0002', 'PA-GATES|HG-0002', 'PA-GATES and HG-0002']) {
    assert.ok(has(checkAdapterDeclaration(paAdapter({ satisfies_control: packed }), ctx()), 'AD-R02'), packed);
  }
});

test('AD-R01 — an adapter naming no control is refused', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ satisfies_control: undefined }), ctx()), 'AD-R01'));
});

test('AD-R05 — two adapters claiming the SAME control is F4 re-entered from the other side', () => {
  const f = checkStreamSeparation([paAdapter(), holdAdapter({ satisfies_control: 'PA-GATES' })]);
  assert.ok(has(f, 'AD-R05'));
  assert.match(f.join('\n'), /github-codeowners-hold, notion-pa-decision/);
});

test('four distinct streams pass separation', () => {
  assert.deepEqual(checkStreamSeparation(STREAMS.map((s) => ({ ...s }))), []);
});

test('a valid declaration of each shipped stream shape passes', () => {
  assert.deepEqual(checkAdapterDeclaration(paAdapter(), ctx()), []);
  assert.deepEqual(checkAdapterDeclaration(holdAdapter(), ctx()), []);
});

// ---------------------------------------------------------------------------------------------
// F4 · evidence for adapter A can never count for adapter B.
// ---------------------------------------------------------------------------------------------

test('AD-R13 — a record bound to another adapter, offered for this one, is refused', () => {
  const foreign = evidence({ adapter_id: 'notion-activation', satisfies_control: 'FLOOR-SEAM', mechanism: 'seam_liveness' });
  const f = ver(foreign, paAdapter(), { adapters: [paAdapter(), { adapter_id: 'notion-activation', satisfies_control: 'FLOOR-SEAM' }] });
  assert.ok(has(f, 'AD-R13'));
});

test('AD-R13 — activationState does not silently drop a foreign record, it names it', () => {
  const state = activationState(paAdapter(), [{ label: 'seam.json', record: evidence({ adapter_id: 'notion-activation' }) }], ctx());
  assert.equal(state.status, 'declared', 'a borrowed record activates nothing');
  assert.ok(has(state.findings, 'AD-R13'));
});

test('AD-R13 — a record naming ANOTHER declared adapter\'s control is named as the borrow', () => {
  const adapters = [paAdapter(), holdAdapter()];
  const f = ver(evidence({ satisfies_control: 'HG-0002' }), paAdapter(), { adapters });
  assert.ok(has(f, 'AD-R13'));
  assert.match(f.join('\n'), /github-codeowners-hold/);
});

test('AD-R14 — a record whose control is nobody\'s is still refused', () => {
  assert.ok(has(ver(evidence({ satisfies_control: 'MADE-UP' }), paAdapter(), { adapters: [paAdapter()] }), 'AD-R14'));
});

test('AD-R12 — a record naming TWO controls is a finding', () => {
  assert.ok(has(ver(evidence({ satisfies_control: ['PA-GATES', 'HG-0002'] })), 'AD-R12'));
  assert.ok(has(ver(evidence({ satisfies_control: 'PA-GATES, HG-0002' })), 'AD-R12'));
});

test('AD-R15 — a record observing a different mechanism than its stream declares is refused', () => {
  assert.ok(has(ver(evidence({ mechanism: 'seam_liveness' })), 'AD-R15'));
});

// ---------------------------------------------------------------------------------------------
// Declared is the default, and it must never read as active.
// ---------------------------------------------------------------------------------------------

test('an adapter with NO observation reports declared — the default, not an error', () => {
  const state = activationState(paAdapter(), [], ctx());
  assert.equal(state.status, 'declared');
  assert.deepEqual(state.findings, [], 'an unobserved stream is honest, not broken');
  assert.match(badge(state), /DECLARED, NOT ACTIVE/);
});

test('a verified observation makes the stream active, and the badge says so in lower case', () => {
  const state = activationState(paAdapter(), [{ label: 'pa.json', record: evidence() }], ctx());
  assert.equal(state.status, 'active');
  assert.equal(state.verified, 1);
  assert.match(badge(state), /^ {2}active as of /);
  assert.doesNotMatch(badge(state), /DECLARED/);
});

test('AD-R09 — an adapter that SELF-DECLARES activation with nothing behind it fails', () => {
  // The exact shape F4 found: a hand-filled activation_evidence block reading as a live integration.
  const a = paAdapter({ activation_evidence: { fetched_at: '2026-07-20T00:00:00Z', probe: 'rejected' } });
  const state = activationState(a, [], ctx());
  assert.equal(state.status, 'declared');
  assert.ok(has(state.findings, 'AD-R09'));
});

test('a populated activation_evidence block with REAL evidence behind it is fine', () => {
  const a = paAdapter({ activation_evidence: { fetched_at: iso(1) } });
  const state = activationState(a, [{ label: 'pa.json', record: evidence() }], ctx());
  assert.equal(state.status, 'active');
  assert.deepEqual(state.findings, []);
});

test('ADOPT placeholders do not count as self-declared activation', () => {
  assert.equal(selfDeclaresActive(paAdapter({ activation_evidence: { fetched_at: 'ADOPT: your timestamp', _comment: 'x' } })), false);
  assert.equal(selfDeclaresActive(paAdapter({ activation_evidence: { fetched_at: '2026-01-01T00:00:00Z' } })), true);
  assert.equal(selfDeclaresActive(paAdapter()), false);
});

test('satisfiedControls returns ACTIVE streams only — a declared stream satisfies nothing', () => {
  const active = activationState(paAdapter(), [{ label: 'pa.json', record: evidence() }], ctx());
  const declared = activationState(holdAdapter(), [], ctx());
  const set = satisfiedControls([active, declared]);
  assert.ok(set.has('PA-GATES'));
  assert.equal(set.has('HG-0002'), false, 'the declared stream contributes no control id');
  assert.equal(set.size, 1);
});

test('AD-R10 — a catalog control citing a DECLARED adapter fails; citing an active one passes', () => {
  const declared = activationState(paAdapter(), [], ctx());
  const active = activationState(paAdapter(), [{ label: 'pa.json', record: evidence() }], ctx());
  const catalog = { controls: [{ control_id: 'PA-GATES', state: 'platform-enforced', adapter_ref: 'notion-pa-decision' }] };
  assert.ok(has(checkCatalogClaims(catalog, [declared]), 'AD-R10'));
  assert.deepEqual(checkCatalogClaims(catalog, [active]), []);
});

test('AD-R10 — a catalog control citing an adapter that does not exist is a mapping to nothing', () => {
  const catalog = { controls: [{ control_id: 'X', state: 'platform-enforced', adapter_ref: 'ghost' }] };
  assert.ok(has(checkCatalogClaims(catalog, []), 'AD-R10'));
});

test('a catalog with no adapter_ref anywhere is silent — the hook ships unused', () => {
  const catalog = { controls: [{ control_id: 'HG-0001', state: 'platform-enforced' }, { control_id: 'X', state: 'defined' }] };
  assert.deepEqual(checkCatalogClaims(catalog, []), []);
  assert.deepEqual(checkCatalogClaims(null, []), []);
});

// ---------------------------------------------------------------------------------------------
// The observation's own refusals.
// ---------------------------------------------------------------------------------------------

test('AD-R19 — an observation signed by the identity it OBSERVES is self-attestation', () => {
  // The bridge is what this stream makes a claim about. A bridge-signed observation of the bridge
  // would pass every other check here: it is fresh, bypass-tested and cryptographically sound.
  const f = ver(evidence({ observer_identity: 'svc-floor-bridge' }, 'bridge-key'));
  assert.ok(has(f, 'AD-R19'));
});

test('AD-R19 — crediting someone else does not launder a self-signed observation', () => {
  const rec = evidence({ observer_identity: 'padmin-zoe' }, 'bridge-key');
  const f = ver(rec);
  assert.ok(has(f, 'AD-R19'), 'the signer is an observed identity, whoever is credited');
  assert.ok(has(f, 'AD-R18'), 'and the credited observer is not the signer');
});

test('AD-R20 — an AGENT observer is inside the write authority it vouches for', () => {
  assert.ok(has(ver(evidence({ observer_identity: 'svc-floor-freezer' })), 'AD-R20'));
});

test('AD-R20 — a BUILDER observer is refused', () => {
  assert.ok(has(ver(evidence({ observer_identity: 'eng-omar' })), 'AD-R20'));
});

test('AD-R20 — an unregistered observer has no independence to assess', () => {
  assert.ok(has(ver(evidence({ observer_identity: 'ghost' })), 'AD-R20'));
});

test('a non-builder human outside the observed set is an acceptable observer', () => {
  const rec = evidence({ observer_identity: 'infosec-noor' });
  const f = ver(rec);
  // Only the issuer binding should complain — the key here is bound to padmin-zoe.
  assert.ok(has(f, 'AD-R18'));
  assert.equal(has(f, 'AD-R20'), false);
  assert.equal(has(f, 'AD-R19'), false);
});

test('AD-R18 — an issuer with no `identity` binding leaves the credit unverifiable', () => {
  assert.ok(has(ver(evidence({}, 'unbound-key')), 'AD-R18'));
});

test('AD-R17 — a `demo: true` anchor cannot underwrite a real observation', () => {
  assert.ok(has(ver(evidence({}, 'demo-observer')), 'AD-R17'));
});

test('AD-R16 — an unsigned observation is refused', () => {
  const rec = evidence();
  delete rec.attestation;
  assert.ok(has(ver(rec), 'AD-R16'));
});

test('AD-R16 — an unregistered issuer is refused', () => {
  const rec = evidence();
  rec.attestation = { issuer: 'nobody', signature: rec.attestation.signature };
  assert.ok(has(ver(rec), 'AD-R16'));
});

test('AD-R16 — editing the observation after signing breaks it', () => {
  const rec = evidence();
  rec.observation.authenticated_decisions = 99;
  assert.ok(has(ver(rec), 'AD-R16'));
});

test('AD-R16 — a missing signature primitive reports UNVERIFIED-HERE, never a silent pass', () => {
  const f = verifyEvidence(evidence(), { ...ctx({ verify: undefined }), adapter: paAdapter() }, 'ev');
  assert.ok(has(f, 'AD-R16'));
  assert.match(f.join('\n'), /UNVERIFIED-HERE/);
});

test('AD-R21 — a stale observation is refused, on the SEAM window not the forge one', () => {
  // 30 days would sail through platform-activation-check's 365-day default. That is threat-model G-2.
  const f = ver(evidence({ observed_at: iso(30) }));
  assert.ok(has(f, 'AD-R21'));
  assert.ok(DEFAULT_MAX_AGE_DAYS < 365);
});

test('AD-R22 — a FUTURE-dated observation is refused', () => {
  assert.ok(has(ver(evidence({ observed_at: new Date(NOW + 3 * 86_400_000).toISOString() })), 'AD-R22'));
});

test('a few minutes of clock skew is tolerated, a day is not', () => {
  assert.deepEqual(ver(evidence({ observed_at: new Date(NOW + (CLOCK_SKEW_MINUTES - 1) * 60_000).toISOString() })), []);
  assert.ok(has(ver(evidence({ observed_at: new Date(NOW + 86_400_000).toISOString() })), 'AD-R22'));
});

test('AD-R11 — an unreadable record is refused rather than ignored', () => {
  assert.ok(has(ver(null), 'AD-R11'));
  assert.ok(has(ver({ schema: 'something-else' }), 'AD-R11'));
  assert.ok(has(ver(evidence({ observed_at: true })), 'AD-R11'), 'a boolean instant is not a timestamp');
  assert.ok(has(ver(evidence({ observation: undefined })), 'AD-R11'));
  const noId = evidence();
  delete noId.adapter_id;
  assert.ok(has(ver(noId), 'AD-R11'));
});

// ---------------------------------------------------------------------------------------------
// The negatives — one probe may not stand in for four.
// ---------------------------------------------------------------------------------------------

test('AD-R23 — a stream declaring four negatives is NOT active on one probe', () => {
  const rec = evidence({ bypass_tests: [probe('replay')] });
  const f = ver(rec);
  assert.ok(has(f, 'AD-R23'));
  for (const missing of ['agent-or-bot-approval', 'unregistered-human', 'post-decision-mutation']) {
    assert.match(f.join('\n'), new RegExp(missing), `${missing} is named as uncovered`);
  }
  assert.doesNotMatch(f.filter((x) => /has no executed/.test(x)).join('\n'), /"replay"/);
});

test('AD-R23 — a probe that was NOT rejected proves nothing', () => {
  const rec = evidence({ bypass_tests: [...ALL_PROBES.slice(1), probe('agent-or-bot-approval', { result: 'allowed' })] });
  const f = ver(rec);
  assert.ok(has(f, 'AD-R23'));
  assert.match(f.join('\n'), /did not refuse the bypass/);
});

test('AD-R23 — no probe at all is refused', () => {
  assert.ok(has(ver(evidence({ bypass_tests: [] })), 'AD-R23'));
});

test('AD-R23 — a stale probe does not cover its negative', () => {
  const rec = evidence({ bypass_tests: [...ALL_PROBES.slice(1), probe('agent-or-bot-approval', { tested_at: iso(400) })] });
  const f = ver(rec);
  assert.ok(has(f, 'AD-R23'));
  assert.match(f.join('\n'), /days old/);
});

test('AD-R22 — a FUTURE-dated probe is refused', () => {
  const rec = evidence({ bypass_tests: [...ALL_PROBES.slice(1), probe('agent-or-bot-approval', { tested_at: new Date(NOW + 86_400_000).toISOString() })] });
  assert.ok(has(ver(rec), 'AD-R22'));
});

test('a single `bypass_test` object is read alongside a `bypass_tests` array', () => {
  const rec = evidence({ bypass_tests: ALL_PROBES.slice(1), bypass_test: probe('agent-or-bot-approval') });
  assert.equal(bypassProbes(rec).length, 4);
  assert.deepEqual(ver(rec), []);
});

test('requiredNegatives falls back to the D5.3 table when the adapter names none', () => {
  assert.deepEqual(requiredNegatives({ adapter_id: 'notion-activation' }), ['seam-bypass']);
  assert.deepEqual(requiredNegatives({ adapter_id: 'unknown-stream' }), []);
  assert.deepEqual(requiredNegatives(paAdapter()).length, 4);
});

test('checkNegatives on an unknown adapter with one rejected probe is satisfied', () => {
  const rec = evidence({ bypass_tests: [probe('anything')] });
  assert.deepEqual(checkNegatives(rec, { adapter_id: 'unknown-stream' }, { now: NOW }), []);
});

// ---------------------------------------------------------------------------------------------
// Verifier routing — one mechanism, one verifier (do not fork platform-activation-check).
// ---------------------------------------------------------------------------------------------

test('AD-R07 — delegating a mechanism the forge gate cannot verify would strand the evidence', () => {
  const f = checkAdapterDeclaration(holdAdapter({ mechanism: 'seam_liveness' }), ctx());
  assert.ok(has(f, 'AD-R07'));
  assert.match(f.join('\n'), /G-2/);
});

test('AD-R08 — re-verifying a forge mechanism here would fork the verifier of record', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ mechanism: 'codeowners' }), ctx()), 'AD-R08'));
});

test('AD-R04 — a mechanism no verifier owns is refused', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ mechanism: 'vibes' }), ctx()), 'AD-R04'));
  assert.ok(has(checkAdapterDeclaration(paAdapter({ mechanism: undefined }), ctx()), 'AD-R04'));
});

test('AD-R03 — an unknown activation_source means nobody verifies the stream', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ activation_source: 'trust-me' }), ctx()), 'AD-R03'));
});

test('a delegated stream activates on the forge gate\'s verdict, and is credited to it', () => {
  const delegations = [{ satisfies_control: 'HG-0002', mechanism: 'codeowners', observed_at: iso(2), observer_identity: 'padmin-zoe' }];
  const state = activationState(holdAdapter(), [], ctx({ delegations }));
  assert.equal(state.status, 'active');
  assert.equal(state.verified_by, 'scripts/platform-activation-check.mjs');
});

test('a delegation for ANOTHER control cannot activate this stream — the binding F4 was missing', () => {
  const delegations = [{ satisfies_control: 'HG-0001', mechanism: 'branch_protection', observed_at: iso(2), observer_identity: 'padmin-zoe' }];
  const state = activationState(holdAdapter(), [], ctx({ delegations }));
  assert.equal(state.status, 'declared', 'a branch-protection receipt does not evidence CODEOWNERS protection');
});

test('a delegation for the right control but the WRONG mechanism does not activate', () => {
  const delegations = [{ satisfies_control: 'HG-0002', mechanism: 'rulesets', observed_at: iso(2), observer_identity: 'padmin-zoe' }];
  assert.equal(activationState(holdAdapter(), [], ctx({ delegations })).status, 'declared');
});

test('AD-R07 — an adapter-evidence record filed for a DELEGATED stream is read by nothing, and says so', () => {
  const rec = evidence({ adapter_id: 'github-codeowners-hold', satisfies_control: 'HG-0002', mechanism: 'codeowners' });
  const state = activationState(holdAdapter(), [{ label: 'hold.json', record: rec }], ctx());
  assert.equal(state.status, 'declared');
  assert.ok(has(state.findings, 'AD-R07'));
});

// ---------------------------------------------------------------------------------------------
// The freshness window may be tightened, never widened.
// ---------------------------------------------------------------------------------------------

test('AD-R06 — an adapter cannot widen its own freshness window', () => {
  assert.ok(has(checkAdapterDeclaration(paAdapter({ evidence: { ...paAdapter().evidence, max_age_days: 365 } }), ctx()), 'AD-R06'));
  assert.ok(has(checkAdapterDeclaration(paAdapter({ evidence: { ...paAdapter().evidence, max_age_days: 0 } }), ctx()), 'AD-R06'));
  assert.ok(has(checkAdapterDeclaration(paAdapter({ evidence: { ...paAdapter().evidence, max_age_days: '7' } }), ctx()), 'AD-R06'));
});

test('an adapter CAN tighten its window, and the tighter bound is what bites', () => {
  const tight = paAdapter({ evidence: { ...paAdapter().evidence, max_age_days: 1 } });
  assert.deepEqual(checkAdapterDeclaration(tight, ctx()), []);
  assert.equal(maxAgeDaysFor(tight), 1);
  assert.equal(maxAgeDaysFor(paAdapter()), DEFAULT_MAX_AGE_DAYS);
  // Three days old: fine on the 7-day default, stale on the adapter's own 1-day bound.
  assert.deepEqual(ver(evidence({ observed_at: iso(3) })), []);
  assert.ok(has(ver(evidence({ observed_at: iso(3) }), tight), 'AD-R21'));
});

// ---------------------------------------------------------------------------------------------
// The whole-set path, and mandatory-when-compiled.
// ---------------------------------------------------------------------------------------------

test('activationStates routes each record to its own stream and reports both badges', () => {
  const { states, findings } = activationStates({
    adapters: [paAdapter(), holdAdapter()],
    records: [{ label: 'pa.json', record: evidence() }],
    delegations: [],
    ...ctx(),
  });
  assert.deepEqual(states.map((s) => [s.adapter_id, s.status]), [
    ['github-codeowners-hold', 'declared'],
    ['notion-pa-decision', 'active'],
  ]);
  assert.deepEqual(findings, []);
});

test('AD-R11 — an orphan record naming no declared adapter is reported, not dropped', () => {
  const { findings } = activationStates({
    adapters: [paAdapter()],
    records: [{ label: 'stray.json', record: evidence({ adapter_id: 'renamed-stream' }) }],
    ...ctx(),
  });
  assert.ok(has(findings, 'AD-R11'));
});

test('a compiled plan requiring the capability fails while any stream is declared', () => {
  const declaredOnly = activationStates({ adapters: [paAdapter()], records: [], ...ctx() });
  const f = checkCompiledRequirement(declaredOnly.states, ['CHG-1']);
  assert.ok(has(f, 'AD-R09'));
  assert.match(f.join('\n'), /DECLARED, NOT ACTIVE/);
});

test('a compiled plan names every D5.3 stream that is missing entirely', () => {
  const f = checkCompiledRequirement([], ['CHG-1']);
  for (const s of STREAMS) assert.match(f.join('\n'), new RegExp(s.adapter_id));
});

test('no compiled requirement means no findings — mandatory-when-compiled, both halves', () => {
  assert.deepEqual(checkCompiledRequirement([{ adapter_id: 'x', status: 'declared' }], []), []);
});

// ---------------------------------------------------------------------------------------------
// The record builder and the hash.
// ---------------------------------------------------------------------------------------------

test('evidenceRecord builds a record the verifier accepts once signed', () => {
  const base = evidenceRecord({
    adapterId: 'notion-pa-decision',
    control: 'PA-GATES',
    mechanism: 'human_decision_assertion',
    observation: { surface: 'notion' },
    bypassTests: ALL_PROBES,
    observedAt: iso(1),
    observedBy: 'padmin-zoe',
  });
  base.attestation = { issuer: 'platform-observer', signature: sign(null, Buffer.from(evidenceHash(base), 'utf8'), privateKey).toString('base64') };
  assert.deepEqual(ver(base), []);
});

test('evidenceHash excludes the attestation and covers every nested field', () => {
  const a = evidence();
  const before = evidenceHash(a);
  a.attestation.signature = 'different';
  assert.equal(evidenceHash(a), before, 'the signature is not part of what is signed');
  a.observation.nested = { deep: 1 };
  assert.notEqual(evidenceHash(a), before, 'a nested edit changes the hash');
});

// ---------------------------------------------------------------------------------------------
// The stream contract is opt-in — a pre-D5.3 adapter must not acquire a red build it cannot clear.
// ---------------------------------------------------------------------------------------------

/** The shipped reference mapping, verbatim in shape: no mechanism, no activation_source. */
const LEGACY = {
  adapter_id: 'grc-control-register',
  system: 'servicenow-grc',
  satisfies_control: 'OPS-READINESS',
  capability: "the enterprise control register's live status",
  evidence: { kind: 'control-register', envelope_fields: ['service_id', 'controls'] },
  activation_evidence: { _comment: 'ADOPT', fetched_at: 'ADOPT: timestamp of your GRC export' },
};

test('a pre-D5.3 adapter declares no stream and collects no findings', () => {
  assert.equal(selfDeclaresActive(LEGACY), false);
  assert.deepEqual(checkAdapterDeclaration(LEGACY, ctx()), []);
  const state = activationState(LEGACY, [], ctx());
  assert.equal(state.stream, false);
  assert.equal(state.status, 'declared');
  assert.deepEqual(state.findings, []);
  assert.match(badge(state), /not an evidence stream/);
});

test('a pre-D5.3 adapter can never be ACTIVATED here — the omission is fail-closed', () => {
  // Even with a perfectly good record on offer: no mechanism means no verifier, so nothing activates.
  const rec = evidence({ adapter_id: 'grc-control-register', satisfies_control: 'OPS-READINESS' });
  const state = activationState(LEGACY, [{ label: 'grc.json', record: rec }], ctx());
  assert.equal(state.status, 'declared');
  assert.equal(satisfiedControls([state]).size, 0);
});

test('a pre-D5.3 adapter with populated activation_evidence is NOT AD-R09 — no route to green', () => {
  const filled = { ...LEGACY, activation_evidence: { fetched_at: iso(1), reconciled: 'true' } };
  assert.equal(selfDeclaresActive(filled), true);
  assert.deepEqual(activationState(filled, [], ctx()).findings, []);
});

test('a pre-D5.3 adapter is exempt from a compiled seam requirement', () => {
  const legacy = activationState(LEGACY, [], ctx());
  const f = checkCompiledRequirement([legacy], ['CHG-1']);
  assert.equal(f.some((x) => /grc-control-register/.test(x)), false);
});

test('the plural-claim rule is UNIVERSAL — a pre-D5.3 adapter gets no exemption from F4', () => {
  assert.ok(has(checkAdapterDeclaration({ ...LEGACY, satisfies_controls: ['A', 'B'] }, ctx()), 'AD-R02'));
  assert.ok(has(checkAdapterDeclaration({ ...LEGACY, satisfies_control: 'A, B' }, ctx()), 'AD-R02'));
  assert.ok(has(checkStreamSeparation([LEGACY, { ...paAdapter(), satisfies_control: 'OPS-READINESS' }]), 'AD-R05'));
});

test('a D5.3 stream that names no mechanism is silent until a plan compiles the capability', () => {
  // The shipped `adapters/reference/github-branch-protection.json` is exactly this shape: one of the
  // four ids, no mechanism, because the contract did not exist when it was written. Opting it in by
  // name would fail a shipped reference file against a shipped gate.
  const sparse = { adapter_id: 'github-branch-protection', system: 'github', satisfies_control: 'HG-0001' };
  assert.deepEqual(checkAdapterDeclaration(sparse, ctx()), []);
  const state = activationState(sparse, [], ctx());
  assert.equal(state.stream, false);
  assert.deepEqual(state.findings, []);
  // …but completeness for the named four is enforced where it matters: under a compiled requirement
  // it cannot be active, and it is not exempt the way an unrelated pre-D5.3 adapter is.
  const f = checkCompiledRequirement([state], ['CHG-1']);
  assert.ok(has(f, 'AD-R09'));
  assert.match(f.join('\n'), /github-branch-protection/);
});

test('checkObserver on an adapter listing nobody falls back to the not-agent-not-builder rule', () => {
  // G-5 is narrowed, not closed: with no `observes_identities` the older, weaker rule is all there is.
  const bare = { adapter_id: 'x', satisfies_control: 'Y', evidence: {} };
  assert.deepEqual(checkObserver(evidence(), bare, { registry: REGISTRY, issuers: ISSUERS }, 'ev'), []);
  assert.ok(has(checkObserver(evidence({ observer_identity: 'eng-omar' }), bare, { registry: REGISTRY, issuers: ISSUERS }, 'ev'), 'AD-R20'));
});
