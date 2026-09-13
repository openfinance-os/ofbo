// Tests for the identity-map join (Factory Floor P6). Node built-in runner: `node --test`.
//
// The claim under test is narrow and load-bearing: the approval contract proves a record is
// authentic and immutable, and this proves the signed subject IS the claimed person. So the
// tests that matter most are the ones where the cryptography is PERFECT and the mapping is wrong
// — a valid assertion for subject A naming registry identity B is the exact attack the contract
// could not refuse before this existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_ID,
  checkMapInvariants,
  checkReconciliation,
  mapRequired,
  mappingActiveAt,
  verifyMapping,
} from './identity-map.mjs';

const REGISTRY = {
  groups: { builders: ['eng-sam', 'svc-floor-bridge'], 'second-line': ['risk-lena'] },
  identities: [
    { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'comp-imran', kind: 'human', roles: ['compliance'], groups: [] },
    { id: 'po-fatima', kind: 'human', roles: ['product-owner'], groups: [] },
    { id: 'eng-sam', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'svc-floor-bridge', kind: 'agent', roles: [], groups: ['builders'] },
  ],
};

const entry = (over = {}) => ({
  notion_person_id: '5d81f3a7-0c44-4e19-9b6a-2f8d1e037c55',
  idp_subject: 'u:4ae2c018',
  registry_id: 'comp-imran',
  roles_at_mapping: ['compliance'],
  verification: { method: 'assertion-derived', reference: 'enrolment-2026-05-04-0912Z' },
  mapped_at: '2026-05-04T09:14:11Z',
  mapped_by: 'risk-lena',
  status: 'active',
  ...over,
});
const map = (entries, over = {}) => ({
  schema: SCHEMA_ID,
  surface: { system: 'notion', workspace_id: 'ws_1' },
  idp: { issuer: 'https://idp.example/oidc', subject_claim: 'sub' },
  entries,
  ...over,
});
const RECON = { observed_at: '2026-07-24T00:00:00Z', observed_by: 'obs-platform', disabled_subjects: [] };
const NOW = Date.parse('2026-07-25T00:00:00Z');

/** A record whose cryptography is assumed already verified — this module runs after that. */
const rec = (over = {}) => ({
  subject: { registry_id: 'comp-imran', idp_subject: 'u:4ae2c018', ...over.subject },
  origin: { system: 'notion', person_id: '5d81f3a7-0c44-4e19-9b6a-2f8d1e037c55', ...over.origin },
  validity: { issued_at: '2026-06-01T10:00:00Z', ...over.validity },
});
const ctx = (over = {}) => ({ map: map([entry()]), registry: REGISTRY, role: 'compliance', ...over });
// --- the join itself: the residual this exists to close -----------------------------------------

test('a correct mapping resolves clean', () => {
  assert.deepEqual(verifyMapping(rec(), ctx()), []);
});

// THE test. Everything in the attestation contract can be perfect — real signature, live
// assertion, bound payload — and this is still a forgery if the map disagrees.
test('a valid assertion for one subject cannot name a DIFFERENT registry identity', () => {
  const forged = rec({ subject: { registry_id: 'po-fatima' } });
  const f = verifyMapping(forged, ctx());
  assert.equal(f.length, 1);
  assert.match(f[0], /IM-R11/);
  assert.match(f[0], /the map is the authority, the record is a claim/);
});

test('an unmapped subject is refused — there is no fallback to resolve by anything else', () => {
  const f = verifyMapping(rec({ subject: { idp_subject: 'u:never-mapped' } }), ctx());
  assert.match(f[0], /IM-R09/);
  assert.match(f[0], /no nearest match|no fallback/);
});

test('two active mappings for one subject refuse rather than pick one', () => {
  const dup = map([entry(), entry({ registry_id: 'po-fatima', notion_person_id: 'other-person' })]);
  assert.match(verifyMapping(rec(), ctx({ map: dup }))[0], /IM-R10/);
});

test('the click and the mapping must be the same workspace account', () => {
  const f = verifyMapping(rec({ origin: { person_id: 'a-different-account' } }), ctx());
  assert.match(f[0], /IM-R12/);
});

test('a record with no idp_subject has nothing to resolve', () => {
  assert.match(verifyMapping(rec({ subject: { idp_subject: '' } }), ctx())[0], /IM-R07/);
});

// --- lifecycle: authority must have existed when it was exercised --------------------------------

test('a decision made before the mapping existed is refused', () => {
  const early = rec({ validity: { issued_at: '2026-01-01T00:00:00Z' } });
  assert.match(verifyMapping(early, ctx())[0], /IM-R14/);
});

test('a decision made after revocation is refused, and names the class', () => {
  const revoked = entry({ status: 'revoked', revoked_at: '2026-05-20T00:00:00Z', revoked_by: 'risk-lena', revocation_class: 'departed' });
  const f = verifyMapping(rec(), ctx({ map: map([revoked]) }));
  // status revoked ⇒ no ACTIVE entry at all, so the subject resolves to nothing
  assert.match(f[0], /IM-R09/);
});

// A leaver does not unmake March's decisions. This is the same narrowing the plan applies to
// freeze drift: block new claims, never rewrite history that was sound when it was made.
test('revocation does not retroactively invalidate a decision made while the mapping was live', () => {
  const e = entry({ status: 'revoked', revoked_at: '2026-06-30T16:00:00Z', revoked_by: 'risk-lena', revocation_class: 'departed' });
  assert.equal(mappingActiveAt(e, Date.parse('2026-06-01T10:00:00Z')), true, 'live at the decision');
  assert.equal(mappingActiveAt(e, Date.parse('2026-07-01T10:00:00Z')), false, 'not live afterwards');
});

test('an unanchored decision cannot be tested against a lifecycle', () => {
  assert.match(verifyMapping(rec({ validity: { issued_at: '' } }), ctx())[0], /IM-R15/);
});

// --- the map is not a second role registry ------------------------------------------------------

test('a role held only in roles_at_mapping is called out, never honoured', () => {
  // comp-imran no longer holds `compliance` in the registry, but the snapshot still says so.
  const stale = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'comp-imran' ? { ...i, roles: [] } : i)) };
  const f = verifyMapping(rec(), ctx({ registry: stale }));
  assert.match(f[0], /IM-R22/);
  assert.match(f[0], /never an authorisation source/);
});

// --- the map's own soundness --------------------------------------------------------------------

test('a sound map produces no findings', () => {
  assert.deepEqual(checkMapInvariants(map([entry()]), REGISTRY, { now: NOW, reconciliation: RECON }), []);
});

test('an unversioned map cannot be read at all', () => {
  const f = checkMapInvariants(map([entry()], { schema: 'something/v9' }), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.equal(f.length, 1);
  assert.match(f[0], /IM-R23/);
});

// The schema has no field for an address. Carrying one is what makes the shortcut available, so
// the refusal is of the FIELD, not of its use.
test('an entry carrying an email or display name is refused on sight', () => {
  for (const field of ['email', 'display_name', 'title', 'workspace_group']) {
    const f = checkMapInvariants(map([entry({ [field]: 'x' })]), REGISTRY, { now: NOW, reconciliation: RECON });
    assert.ok(f.some((x) => new RegExp(`carries \`${field}\``).test(x)), `${field} must be refused: ${f}`);
  }
});

test('a service identity may never be a mapped human subject', () => {
  const f = checkMapInvariants(map([entry({ registry_id: 'svc-floor-bridge' })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /IM-R20/.test(x) && /no clicks to attest to/.test(x)), f.join('\n'));
});

test('nobody attests to their own binding', () => {
  const f = checkMapInvariants(map([entry({ mapped_by: 'comp-imran' })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /mapped_by is the subject itself/.test(x)), f.join('\n'));
});

test('a builder cannot verify a binding', () => {
  const f = checkMapInvariants(map([entry({ mapped_by: 'eng-sam' })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /is a builder/.test(x)), f.join('\n'));
});

test('uniqueness is checked on all three axes, and only among ACTIVE entries', () => {
  const axes = {
    idp_subject: entry({ registry_id: 'po-fatima', notion_person_id: 'p2' }),
    notion_person_id: entry({ registry_id: 'po-fatima', idp_subject: 'u:other' }),
    registry_id: entry({ idp_subject: 'u:other', notion_person_id: 'p2' }),
  };
  for (const [axis, second] of Object.entries(axes)) {
    const f = checkMapInvariants(map([entry(), second]), REGISTRY, { now: NOW, reconciliation: RECON });
    assert.ok(f.some((x) => /IM-R10/.test(x) && x.includes(axis)), `${axis}: ${f.join('\n')}`);
  }
  // …a revoked predecessor is history, not a duplicate — the append-only invariant depends on it.
  const superseded = entry({ status: 'revoked', revoked_at: '2026-05-01T00:00:00Z', revoked_by: 'risk-lena', revocation_class: 'account-reprovisioned' });
  assert.deepEqual(checkMapInvariants(map([superseded, entry()]), REGISTRY, { now: NOW, reconciliation: RECON }), []);
});

test('a revocation without its class or moment is incomplete', () => {
  const f = checkMapInvariants(map([entry({ status: 'revoked' })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /revoked_at/.test(x)));
  assert.ok(f.some((x) => /revocation_class/.test(x)));
});

test('status has exactly two values — there is no pending', () => {
  const f = checkMapInvariants(map([entry({ status: 'pending' })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /an unmerged entry is not an entry/.test(x)), f.join('\n'));
});

test('a binding with no verification reference cannot be audited', () => {
  const f = checkMapInvariants(map([entry({ verification: { method: 'assertion-derived' } })]), REGISTRY, { now: NOW, reconciliation: RECON });
  assert.ok(f.some((x) => /verification.reference missing/.test(x)));
});

// --- reconciliation: observed, not declared -----------------------------------------------------

test('no reconciliation observation means the map is unproven, not trusted', () => {
  const f = checkReconciliation(null, map([entry()]), { now: NOW });
  assert.match(f[0], /IM-R24/);
  assert.match(f[0], /observed, not declared/);
});

test('a stale observation is refused, and says how stale', () => {
  const old = { ...RECON, observed_at: '2026-06-01T00:00:00Z' };
  const f = checkReconciliation(old, map([entry()]), { now: NOW });
  assert.ok(f.some((x) => /IM-R24/.test(x) && /54 days old/.test(x)), f.join('\n'));
});

// The directory outranks the file: landing a revocation PR takes a human, and in the meantime the
// entry still reads `active`. The observation is what closes that window.
test('a subject disabled at the IdP is refused even while its entry still reads active', () => {
  const r = { ...RECON, disabled_subjects: ['u:4ae2c018'] };
  const f = checkReconciliation(r, map([entry()]), { now: NOW });
  assert.ok(f.some((x) => /IM-R25/.test(x) && /the directory is authoritative over the map/.test(x)), f.join('\n'));
});

// --- mandatory-when-compiled --------------------------------------------------------------------

test('the mapping join is required only when the compiled plan says so', () => {
  assert.equal(mapRequired({ required_capabilities: { identity_map: { required: true } } }), true);
  assert.equal(mapRequired({ required_capabilities: { identity_map: { required: false } } }), false);
  assert.equal(mapRequired({}), false);
  assert.equal(mapRequired(null), false);
});
