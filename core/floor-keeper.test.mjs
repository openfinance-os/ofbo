// Tests for the floor-keepers (Factory Floor WS6 · D6.3). Node built-in runner.
//
// Every control is tested twice: once for the case it must catch, and once for the case that would
// SAIL THROUGH if the control were absent. The second half is the important one, and in this module
// it is unusually easy to get wrong in the flattering direction — a grant checker that refuses
// everything is trivial to write and would stop the floor-keepers doing the only job they have. The
// difficulty is refusing every grant on the approval container while leaving the prefill work alone.
//
// The centre of the file is `attemptedApproval`. D6.3's acceptance is that a floor-keeper's attempted
// approval is DEMONSTRABLY VOID — not discouraged, not logged, not merely unlikely to be read. So it
// is tested against a deliberately hostile matrix: the keeper wrongly holds a role, the container is
// wrongly authoritative, the attempt carries a signature, the surface displayed it as effective. Void
// in every one, with no argument that flips it.
//
// All fixtures are synthetic: an agent nobody runs, on a workspace nobody has, auditing containers
// that do not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_FIELDS } from './floor-project.mjs';
import {
  APPROVAL_FIELDS,
  CAPABILITY,
  GRANT_AUDIT_MAX_AGE_DAYS,
  REJECTIONS,
  SCHEMA_ID,
  VOID_NOTICE,
  WRITE_SCOPE,
  approvalFieldsOf,
  attemptedApproval,
  checkContainer,
  checkGrantAudit,
  checkGrantRegister,
  checkGrants,
  checkKeeperRoles,
  checkWriteScope,
  fieldNamesOf,
  isApprovalField,
  keepersRequired,
  normalizeFieldName,
  voidNotice,
} from './floor-keeper.mjs';

const NOW = Date.parse('2026-07-20T00:00:00Z');
const DAY = 86400000;

const REGISTRY = {
  groups: { builders: 'first line', 'second-line': 'independent', 'platform-admins': 'control plane' },
  identities: [
    { id: 'agent-floor-keeper', kind: 'agent', display: 'Floor-keeper (synthetic)', roles: [], groups: ['builders'] },
    { id: 'agent-floor-keeper-2', kind: 'agent', display: 'Second keeper', roles: [], groups: ['builders'] },
    { id: 'infosec-noor', kind: 'human', display: 'Noor', roles: ['information-security'], groups: [] },
    { id: 'risk-lena', kind: 'human', display: 'Lena', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'eng-omar', kind: 'human', display: 'Omar', roles: ['engineering'], groups: ['builders'] },
  ],
};

/** A non-authoritative container: where the keepers work. */
const DRAFTS = {
  id: 'db-prd-drafts',
  kind: 'database',
  authoritative: false,
  fields: ['Title', 'Owner role', 'Stage', 'Summary'],
  prefill: ['Stage', 'Summary'],
};

/** The authoritative container: approval properties, and no keeper holds anything on it. */
const APPROVALS = {
  id: 'db-approvals',
  kind: 'database',
  authoritative: true,
  fields: ['Change', 'PA stage', 'Approved By', 'Assertion', 'Outcome'],
};

const keeper = (over = {}) => ({
  identity: 'agent-floor-keeper',
  write_scope: ['views', 'conversation'],
  grants: [{ container: 'db-prd-drafts', level: 'can-view' }],
  ...over,
});

const audit = (over = {}) => ({
  audited_at: '2026-07-01T00:00:00Z',
  audited_by: 'infosec-noor',
  containers_enumerated: ['db-prd-drafts', 'db-approvals'],
  ...over,
});

const register = (over = {}) => ({
  schema: SCHEMA_ID,
  containers: [DRAFTS, APPROVALS],
  keepers: [keeper()],
  audit: audit(),
  ...over,
});

const check = (over, ctx = {}) => checkGrantRegister(register(over), { registry: REGISTRY, now: NOW, ...ctx });
const codes = (findings) => [...new Set(findings.map((f) => f.slice(0, 6)))].sort();
const has = (findings, code) => findings.some((f) => f.startsWith(`${code}:`));
const containerMap = (...cs) => new Map(cs.map((c) => [c.id, c]));

// ── the clean case, which must stay clean ─────────────────────────────────────────────────────────

// Found while building floor-keeper-example/, not by a fixture: APPROVAL_FIELDS was AUTHORITY_FIELDS
// outright, and those answer different questions. The authority set is about what would LEAK onto a
// read-only mirror (attestation, signature, plan_hash, nonce); this one is about what CARRIES an
// approval. The gap was the words a human uses, so an approvals database titled the ordinary way
// read as carrying no approval field: a keeper grant on it raised nothing, and FK-R11's vacuity
// check was satisfied by any other container that happened to match.
test('the words a human actually titles an approvals database with are DETECTED', () => {
  for (const name of ['Sign-off', 'Signed off by', 'Approver', 'Approvers', 'Verdict',
    'Countersigned by', 'Authorised by', 'Ratified by', 'Endorsed by']) {
    assert.equal(isApprovalField(name), true, `${name} must be visible — D6.3 cannot protect what it cannot see`);
  }
});

test('widening the vocabulary lost nothing the authority set already caught', () => {
  for (const name of AUTHORITY_FIELDS) assert.equal(isApprovalField(name), true, name);
  for (const name of ['Approved by', 'Attestation', 'Signature', 'Plan hash', 'Assertion nonce', 'Release hold']) {
    assert.equal(isApprovalField(name), true, name);
  }
});

test('a field that DESCRIBES a decision is not a field that RECORDS one', () => {
  // `Decision` and `Outcome` stay out on purpose. D5.1 makes a floor-keeper assemble the evidence an
  // approver reads, in its own container so the keeper CAN write it; an evidence pack naturally has a
  // `Decision` summary. Treating that as approval-carrying makes the container the keeper must write
  // the one it may not touch — D5.1 against D6.3. The worked example failed on precisely that.
  for (const name of ['Decision', 'Decisions', 'Outcome', 'Decision log']) {
    assert.equal(isApprovalField(name), false, `${name} describes; it does not record`);
  }
});

test('ordinary floor prose is still not an approval field', () => {
  for (const name of ['Owner', 'Stage', 'Status', 'Notes', 'Run', 'Summary', 'Created']) {
    assert.equal(isApprovalField(name), false, `${name} must not cost a keeper a grant`);
  }
});

test('a register whose keepers hold nothing on the approval container passes', () => {
  assert.deepEqual(check(), []);
});

test('a keeper may hold an EDIT grant on the container it is meant to prefill', () => {
  // The negative that matters most: a checker that refused every grant would be trivially "safe"
  // and would end the floor-keepers' only job. Prefill on a non-authoritative container is the
  // work, and it must pass.
  assert.deepEqual(check({ keepers: [keeper({ grants: [{ container: 'db-prd-drafts', level: 'can-edit' }] })] }), []);
});

test('a keeper with no grants at all passes — the register is not a requirement to hold something', () => {
  assert.deepEqual(check({ keepers: [keeper({ grants: [] })] }), []);
});

test('two keepers, each on the drafts container, pass', () => {
  assert.deepEqual(check({
    keepers: [keeper(), keeper({ identity: 'agent-floor-keeper-2', grants: [{ container: 'db-prd-drafts', level: 'can-comment' }] })],
  }), []);
});

test('every rejection code is documented in REJECTIONS', () => {
  // A code in a message with no entry here is a code nobody can look up. The map is the index an
  // operator reads off a red build.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.ok(REJECTIONS.has(`FK-R${String(n).padStart(2, '0')}`), `FK-R${n}`);
});

// ── FK-R03 · the headline: no grant of any kind on an approval-carrying container ─────────────────

test('a keeper holding can-edit on the approval container is refused', () => {
  const f = check({ keepers: [keeper({ grants: [{ container: 'db-approvals', level: 'can-edit' }] })] });
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
  assert.ok(f.some((x) => /Approved By/.test(x)), f.join('\n'));
});

test('EVERY grant level on the approval container is refused, can-view included', () => {
  // The control that would be absent here is the one everybody writes instead: refuse edit, allow
  // read. D6.3 says NO GRANT AT ALL, and a read grant is both outside the capability matrix's
  // floor-keeper row and the first step of the creep that ends in an edit grant.
  for (const level of ['full-access', 'can-edit', 'can-edit-content', 'can-comment', 'can-view']) {
    const f = check({ keepers: [keeper({ grants: [{ container: 'db-approvals', level }] })] });
    assert.ok(has(f, 'FK-R03'), `${level}: ${f.join('\n')}`);
  }
});

test('a grant on a container the register does not declare is refused, not assumed harmless', () => {
  const f = check({ keepers: [keeper({ grants: [{ container: 'db-somewhere-else', level: 'can-view' }] })] });
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
  assert.ok(f.some((x) => /does not declare this container/.test(x)));
});

test('a grant at an unrecognised level is refused rather than weighed', () => {
  const f = check({ keepers: [keeper({ grants: [{ container: 'db-prd-drafts', level: 'read-only-ish' }] })] });
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
});

test('a grant on a container declared authoritative is refused even with no approval fields on it', () => {
  // The container is the unit of protection, so "authoritative but harmless-looking" is not a
  // category. Without this the separation would depend on somebody having listed every property.
  const bare = { id: 'db-decisions', kind: 'database', authoritative: true, fields: ['Change', 'Outcome'] };
  const f = check({
    containers: [DRAFTS, APPROVALS, bare],
    keepers: [keeper({ grants: [{ container: 'db-decisions', level: 'can-view' }] })],
    audit: audit({ containers_enumerated: ['db-prd-drafts', 'db-approvals', 'db-decisions'] }),
  });
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
});

test('an approval property is recognised through a human-written title', () => {
  // Property titles are prose. A checker matching only schema keys would pass every real workspace.
  for (const title of ['Approved By', 'approved-by', 'PA1 Approval', 'Risk Sign-off Signature', 'Release Hold state', 'Attestation ✓']) {
    assert.equal(isApprovalField(title), true, title);
  }
  for (const title of ['Title', 'Owner role', 'Stage', 'Summary', 'Outcome', 'PA stage', 'Change']) {
    assert.equal(isApprovalField(title), false, title);
  }
});

test('a container whose approval property is titled in prose still refuses the grant', () => {
  const prose = { id: 'db-signoff', kind: 'database', authoritative: true, fields: ['Change', 'Second-line Approval'] };
  const f = check({
    containers: [DRAFTS, prose],
    keepers: [keeper({ grants: [{ container: 'db-signoff', level: 'can-comment' }] })],
    audit: audit({ containers_enumerated: ['db-prd-drafts', 'db-signoff'] }),
  });
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
  assert.ok(f.some((x) => /Second-line Approval/.test(x)));
});

test('the approval-field list is the projection module\'s, not a copy', () => {
  // Two lists would drift, and the drift would be silent — so this asserts DERIVATION, not contents.
  //
  // It used to assert `APPROVAL_FIELDS === AUTHORITY_FIELDS`, and that identity was itself the
  // defect. The authority set answers "would this field LEAK onto a read-only mirror" — attestation,
  // signature, plan_hash, nonce. It does not answer "does this container CARRY an approval", and the
  // difference turned out to be every word a human titles an approvals database with: `Approver`,
  // `Sign-off`, `Signed off by`, `Decision` all matched nothing. The test's real intent survives:
  // the approval set is built FROM the authority set rather than transcribed beside it.
  for (const name of AUTHORITY_FIELDS) {
    assert.ok(APPROVAL_FIELDS.has(name), `${name}: every authority field is still an approval field`);
  }
  assert.ok(APPROVAL_FIELDS.size > AUTHORITY_FIELDS.size, 'and the approval vocabulary is added on top');
  assert.notEqual(APPROVAL_FIELDS, AUTHORITY_FIELDS, 'a derived superset, not the same object');
});

test('checkGrants needs no register: it is a pure function over a container map', () => {
  const f = checkGrants(keeper({ grants: [{ container: 'db-approvals', level: 'full-access' }] }), containerMap(DRAFTS, APPROVALS), 'k');
  assert.ok(has(f, 'FK-R03'));
  assert.deepEqual(checkGrants(keeper(), containerMap(DRAFTS, APPROVALS), 'k'), []);
});

test('a keeper with no grants array is refused — unstated is not narrow', () => {
  const f = checkGrants({ identity: 'agent-floor-keeper' }, containerMap(DRAFTS), 'k');
  assert.ok(has(f, 'FK-R03'), f.join('\n'));
});

// ── FK-R05 · property-level scope does not exist ──────────────────────────────────────────────────

test('a grant claiming a property is refused, even on a harmless container', () => {
  // If the control were absent this would read as the tightest configuration in the file, and it is
  // the only one that is certainly fictional.
  for (const key of ['property', 'properties', 'field', 'fields', 'column', 'columns']) {
    const f = check({ keepers: [keeper({ grants: [{ container: 'db-prd-drafts', level: 'can-edit', [key]: 'Stage' }] })] });
    assert.ok(has(f, 'FK-R05'), `${key}: ${f.join('\n')}`);
  }
});

test('a grant with scope "property" is refused', () => {
  const f = check({ keepers: [keeper({ grants: [{ container: 'db-prd-drafts', level: 'can-edit', scope: 'property' }] })] });
  assert.ok(has(f, 'FK-R05'), f.join('\n'));
});

test('a grant with no scope key at all is fine — absence is the honest state', () => {
  assert.deepEqual(check(), []);
});

// ── FK-R02 · a floor-keeper holds no role ────────────────────────────────────────────────────────

test('a keeper whose registry identity holds a role is refused', () => {
  const registry = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'agent-floor-keeper' ? { ...i, roles: ['risk-second-line'] } : i)) };
  const f = checkGrantRegister(register(), { registry, now: NOW });
  assert.ok(has(f, 'FK-R02'), f.join('\n'));
});

test('a register that merely ASKS for a role is refused where it is written', () => {
  const f = check({ keepers: [keeper({ roles: ['product-owner'] })] });
  assert.ok(has(f, 'FK-R02'), f.join('\n'));
});

test('a keeper in the second-line or platform-admins group is refused', () => {
  for (const group of ['second-line', 'platform-admins']) {
    const registry = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'agent-floor-keeper' ? { ...i, groups: [group] } : i)) };
    const f = checkGrantRegister(register(), { registry, now: NOW });
    assert.ok(has(f, 'FK-R02'), `${group}: ${f.join('\n')}`);
  }
});

test('a keeper in builders is NOT a finding — first-line labour is the job', () => {
  // The negative. Over-refusing here would push adopters to leave keepers out of the registry
  // altogether, which is strictly worse: an unregistered agent is outside every other rule too.
  assert.deepEqual(check(), []);
  assert.deepEqual(checkKeeperRoles(keeper(), REGISTRY, 'k'), []);
});

test('the role check reads the KEEPER\'s identity, not everybody\'s', () => {
  // Humans in this registry hold roles and belong to the second line. The register is clean anyway:
  // a check that swept the whole registry would fail every real repository on its first run.
  assert.deepEqual(check(), []);
  // And a human wrongly filed as a keeper does trip it, by holding a role at all.
  const f = checkKeeperRoles({ identity: 'risk-lena' }, REGISTRY, 'k');
  assert.ok(has(f, 'FK-R02'), f.join('\n'));
});

// ── FK-R04 · views + conversation ────────────────────────────────────────────────────────────────

test('a write scope beyond views + conversation is refused', () => {
  for (const scope of ['properties', 'page-content', 'comments', 'database-schema', 'approve']) {
    const f = check({ keepers: [keeper({ write_scope: ['views', scope] })] });
    assert.ok(has(f, 'FK-R04'), `${scope}: ${f.join('\n')}`);
  }
});

test('views alone, conversation alone, and an empty scope all pass', () => {
  assert.deepEqual([...WRITE_SCOPE].sort(), ['conversation', 'views']);
  for (const write_scope of [['views'], ['conversation'], []]) {
    assert.deepEqual(checkWriteScope(keeper({ write_scope }), 'k'), [], JSON.stringify(write_scope));
  }
});

test('an absent write scope is refused, not assumed narrow', () => {
  const f = checkWriteScope({ identity: 'agent-floor-keeper' }, 'k');
  assert.ok(has(f, 'FK-R04'), f.join('\n'));
});

// ── FK-R06 · a registered agent, and nothing else ────────────────────────────────────────────────

test('a human filed as a floor-keeper is refused', () => {
  const f = check({ keepers: [keeper({ identity: 'eng-omar' })], audit: audit({ audited_by: 'infosec-noor' }) });
  assert.ok(has(f, 'FK-R06'), f.join('\n'));
});

test('an unregistered keeper is refused', () => {
  const f = check({ keepers: [keeper({ identity: 'agent-nobody-registered' })] });
  assert.ok(has(f, 'FK-R06'), f.join('\n'));
});

test('a keeper declared twice is refused — its grants would be whichever entry a reader stops at', () => {
  const f = check({ keepers: [keeper(), keeper()] });
  assert.ok(has(f, 'FK-R06'), f.join('\n'));
});

test('a keeper with no identity is refused', () => {
  const f = check({ keepers: [{ write_scope: [], grants: [] }] });
  assert.ok(has(f, 'FK-R06'), f.join('\n'));
});

// ── FK-R07 / FK-R08 · the container declarations ─────────────────────────────────────────────────

test('a container mixing approval fields with prefillable ones is refused with no grants involved', () => {
  // The deep one. Today nobody holds a grant on it, so every grant rule passes — and the separation
  // is still not EXPRESSIBLE there, so the first prefill will break it. Without this control the
  // register would go green on a design that cannot work.
  const mixed = { id: 'db-mixed', kind: 'database', authoritative: true, fields: ['Stage', 'Approved By'], prefill: ['Stage'] };
  const f = check({ containers: [DRAFTS, mixed], keepers: [keeper()], audit: audit({ containers_enumerated: ['db-prd-drafts', 'db-mixed'] }) });
  assert.ok(has(f, 'FK-R07'), f.join('\n'));
  assert.ok(!has(f, 'FK-R03'), 'no grant rule fired — that is the point');
});

test('splitting the mixed container into two clears the finding', () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(checkContainer(DRAFTS, 'c'), []);
  assert.deepEqual(checkContainer(APPROVALS, 'c'), []);
});

test('a container carrying approval fields but declaring itself non-authoritative is refused', () => {
  const mislabelled = { ...APPROVALS, authoritative: false };
  const f = check({ containers: [DRAFTS, mislabelled] });
  assert.ok(has(f, 'FK-R08'), f.join('\n'));
});

test('a container that does not say whether it is authoritative is refused', () => {
  const f = checkContainer({ id: 'db-x', kind: 'database', fields: ['Stage'] }, 'c');
  assert.ok(has(f, 'FK-R08'), f.join('\n'));
});

test('a container of an unknown kind is refused — the grant model is per page or per database', () => {
  const f = checkContainer({ id: 'db-x', kind: 'workspace', authoritative: false, fields: [] }, 'c');
  assert.ok(has(f, 'FK-R01'), f.join('\n'));
});

test('a duplicate container id is refused — ambiguity resolves to refusal, never to a pick', () => {
  const f = check({ containers: [DRAFTS, DRAFTS, APPROVALS] });
  assert.ok(has(f, 'FK-R01'), f.join('\n'));
});

test('prefill naming a field the container does not declare is refused', () => {
  const f = checkContainer({ id: 'db-x', kind: 'database', authoritative: false, fields: ['Stage'], prefill: ['Summary'] }, 'c');
  assert.ok(has(f, 'FK-R01'), f.join('\n'));
});

test('field declarations may be strings or objects', () => {
  assert.deepEqual(fieldNamesOf({ fields: ['A', { name: 'B' }, null, 42] }), ['A', 'B']);
  assert.deepEqual(approvalFieldsOf({ fields: ['Stage', { name: 'Approved By' }] }), ['Approved By']);
  assert.equal(normalizeFieldName('  Approved By (2nd line) '), 'approved_by_2nd_line');
});

// ── FK-R09 · the grant audit ─────────────────────────────────────────────────────────────────────

test('a register with keepers and no audit is refused', () => {
  const f = check({ audit: undefined });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
});

test('a stale audit is refused; one inside the window is not', () => {
  const fresh = new Date(NOW - (GRANT_AUDIT_MAX_AGE_DAYS - 1) * DAY).toISOString();
  const stale = new Date(NOW - (GRANT_AUDIT_MAX_AGE_DAYS + 1) * DAY).toISOString();
  assert.deepEqual(check({ audit: audit({ audited_at: fresh }) }), []);
  assert.ok(has(check({ audit: audit({ audited_at: stale }) }), 'FK-R09'));
});

test('an audit dated in the future is refused', () => {
  const f = check({ audit: audit({ audited_at: new Date(NOW + DAY).toISOString() }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
});

test('an audit signed by one of the keepers being audited is refused', () => {
  const f = check({ audit: audit({ audited_by: 'agent-floor-keeper' }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
  assert.ok(f.some((x) => /reporting on its own grants/.test(x)));
});

test('an audit run by any machine is refused — a grant audit is a person reading the sharing dialog', () => {
  const f = check({ audit: audit({ audited_by: 'agent-floor-keeper-2' }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
});

test('an audit that skipped a container is refused', () => {
  // The failure mode is not a wrong answer; it is a container nobody thought to open — which is
  // exactly where the wrongly-filed approval page is.
  const f = check({ audit: audit({ containers_enumerated: ['db-prd-drafts'] }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
  assert.ok(f.some((x) => /db-approvals/.test(x)));
});

test('an audit that lists a container the register does not declare is refused', () => {
  const f = check({ audit: audit({ containers_enumerated: ['db-prd-drafts', 'db-approvals', 'db-ghost'] }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
});

test('an audit with no enumeration list is refused — "we audited the grants" is not an audit', () => {
  const f = check({ audit: audit({ containers_enumerated: undefined }) });
  assert.ok(has(f, 'FK-R09'), f.join('\n'));
});

test('a register with NO keepers demands no audit — nothing to audit is not overdue an audit', () => {
  const f = checkGrantRegister(register({ keepers: [], audit: undefined }), { registry: REGISTRY, now: NOW });
  assert.deepEqual(f, []);
  assert.ok(checkGrantAudit({ keepers: [keeper()] }, { registry: REGISTRY, now: NOW }).length > 0);
});

// ── FK-R11 · the register must describe the thing it separates ───────────────────────────────────

test('a register with keepers but no approval-carrying container is refused as vacuous', () => {
  // Without this, the cheapest way to a green gate is to leave the approvals database out of the
  // register — and the gate would then certify a separation it never looked at.
  const f = check({ containers: [DRAFTS], audit: audit({ containers_enumerated: ['db-prd-drafts'] }) });
  assert.ok(has(f, 'FK-R11'), f.join('\n'));
});

test('a floor that honestly routes no approvals says so and passes', () => {
  const f = check({ containers: [DRAFTS], routes_approvals: false, audit: audit({ containers_enumerated: ['db-prd-drafts'] }) });
  assert.deepEqual(f, []);
});

// ── the register's own readability ───────────────────────────────────────────────────────────────

test('an unreadable register is refused, never read as describing no grants', () => {
  for (const bad of [null, undefined, 'a register', [], 42]) {
    const f = checkGrantRegister(bad, { registry: REGISTRY, now: NOW });
    assert.ok(has(f, 'FK-R01'), JSON.stringify(bad));
  }
});

test('a wrong-schema register is refused before anything else is read', () => {
  const f = checkGrantRegister({ schema: 'loom.floor-keeper-grants/v0', keepers: [] }, { registry: REGISTRY, now: NOW });
  assert.deepEqual(codes(f), ['FK-R01']);
});

test('a register with no keepers array is refused', () => {
  const f = checkGrantRegister({ schema: SCHEMA_ID, containers: [DRAFTS] }, { registry: REGISTRY, now: NOW });
  assert.ok(has(f, 'FK-R06'), f.join('\n'));
});

test('mandatory-when-compiled reads the capability off the plan', () => {
  assert.equal(keepersRequired({ required_capabilities: { [CAPABILITY]: { required: true } } }), true);
  assert.equal(keepersRequired({ required_capabilities: { [CAPABILITY]: { required: false } } }), false);
  assert.equal(keepersRequired({}), false);
  assert.equal(keepersRequired(null), false);
});

// ── the attempt is VOID — the D6.3 acceptance ────────────────────────────────────────────────────

test('a floor-keeper\'s attempted approval is void', () => {
  const v = attemptedApproval({ actor: 'agent-floor-keeper', at: '2026-07-20T10:00:00Z' }, { registry: REGISTRY });
  assert.equal(v.void, true);
  assert.equal(v.gate_readable, false);
  assert.equal(v.record, null);
  assert.ok(v.reasons.some((r) => /is an AGENT/.test(r)), v.reasons.join('\n'));
});

test('void survives every hostile arrangement, including the ones that are themselves findings', () => {
  // The acceptance test, stated adversarially. If void-ness depended on the register being correct,
  // then a misconfigured register would make an approval effective — which is precisely the
  // situation the acceptance criterion is about. Each of these is a finding elsewhere in this file
  // and NONE of them makes the attempt count.
  const roled = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'agent-floor-keeper' ? { ...i, roles: ['risk-second-line'], groups: ['second-line'] } : i)) };
  const hostile = [
    ['a keeper wrongly granted a second-line role', { actor: 'agent-floor-keeper' }, { registry: roled }],
    ['a keeper masquerading as a registered human', { actor: 'risk-lena' }, { registry: REGISTRY }],
    ['an attempt carrying a signature', { actor: 'agent-floor-keeper', signature: 'ed25519:deadbeef' }, { registry: REGISTRY }],
    ['an attempt carrying a full attestation', { actor: 'agent-floor-keeper', attestation: { issuer: 'bank-idp' } }, { registry: REGISTRY }],
    ['an attempt naming itself approved_by', { actor: 'agent-floor-keeper', approved_by: 'risk-lena' }, { registry: REGISTRY }],
    ['an attempt presented as effective', { actor: 'agent-floor-keeper', presented_as: { effective: true } }, { registry: REGISTRY }],
    ['an attempt labelled authoritative', { actor: 'agent-floor-keeper', presented_as: { authority: 'authoritative' } }, { registry: REGISTRY }],
    ['an attempt handed to a gate', { actor: 'agent-floor-keeper', presented_as: { gate_readable: true } }, { registry: REGISTRY }],
    ['an attempt with no actor at all', {}, { registry: REGISTRY }],
    ['an attempt with no registry to resolve against', { actor: 'agent-floor-keeper' }, {}],
    ['an empty attempt with no context', undefined, undefined],
  ];
  for (const [why, attempt, ctx] of hostile) {
    const v = attemptedApproval(attempt, ctx);
    assert.equal(v.void, true, why);
    assert.equal(v.gate_readable, false, why);
    assert.equal(v.record, null, why);
    assert.ok(v.reasons.length >= 3, `${why}: ${v.reasons.length} reasons — a single-reason voidance is one refactor from a bug`);
  }
});

test('the reasons holding it void are independent — removing one leaves the rest', () => {
  const roled = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'agent-floor-keeper' ? { ...i, roles: ['risk-second-line'] } : i)) };
  const withRole = attemptedApproval({ actor: 'agent-floor-keeper' }, { registry: roled });
  // The "holds no role" reason is gone, because it now holds one. It is still void.
  assert.ok(!withRole.reasons.some((r) => /holds no role/.test(r)));
  assert.equal(withRole.void, true);
  assert.ok(withRole.reasons.some((r) => /no gate anywhere reads a floor page/.test(r)));
  assert.ok(withRole.reasons.some((r) => /subject-bound assertion/.test(r)));
});

test('presenting the attempt as effective is FK-R10 — the void-ness is not the finding, the display is', () => {
  const quiet = attemptedApproval({ actor: 'agent-floor-keeper' }, { registry: REGISTRY });
  assert.deepEqual(quiet.findings, []); // an attempt refused at the surface is a non-event
  for (const presented_as of [{ effective: true }, { authority: 'authoritative' }, { gate_readable: true }]) {
    const loud = attemptedApproval({ actor: 'agent-floor-keeper', presented_as }, { registry: REGISTRY });
    assert.ok(has(loud.findings, 'FK-R10'), JSON.stringify(presented_as));
  }
});

test('authority "none" on the presentation is not a finding — that is the correct label', () => {
  const v = attemptedApproval({ actor: 'agent-floor-keeper', presented_as: { authority: 'none', effective: false } }, { registry: REGISTRY });
  assert.deepEqual(v.findings, []);
});

test('an attempt dressed in approval cryptography is FK-R10 whatever the presentation says', () => {
  for (const key of ['signature', 'attestation', 'assertion', 'approved_by', 'Approved By', 'seal', 'plan_hash']) {
    const v = attemptedApproval({ actor: 'agent-floor-keeper', [key]: 'x' }, { registry: REGISTRY });
    assert.ok(has(v.findings, 'FK-R10'), key);
  }
});

test('the void notice is verbatim, visible and not dismissible', () => {
  const n = voidNotice({ actor: 'agent-floor-keeper', at: '2026-07-20T10:00:00Z' });
  assert.equal(n.banner, VOID_NOTICE);
  assert.equal(n.visible, true);
  assert.equal(n.dismissible, false);
  assert.equal(n.authority, 'none');
  assert.equal(n.actor, 'agent-floor-keeper');
  assert.ok(n.reasons.length >= 3);
});

test('a human second-line approver attempting on the floor is ALSO void — the surface, not the actor', () => {
  // The negative that keeps the reasoning honest. It is tempting to read the voidance as "because
  // it was a machine". It is not: it is because it happened on the floor. A real approver's real
  // click on a floor page approves nothing either, which is why D5.1/D5.2 route decisions through a
  // subject-bound assertion instead of reading the page.
  const v = attemptedApproval({ actor: 'risk-lena' }, { registry: REGISTRY });
  assert.equal(v.void, true);
  assert.ok(!v.reasons.some((r) => /is an AGENT/.test(r)));
  assert.ok(v.reasons.some((r) => /no gate anywhere reads a floor page/.test(r)));
});
