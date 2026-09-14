// Tests for the operations → discovery feedback gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NOTIFICATION_SEVERITIES,
  ROUTES,
  checkRegulatorNotification,
  SHARIAH_ROUTES,
  TYPES,
  assuranceCaseIds,
  evaluate,
  purificationRecordIds,
} from './operations-signal-check.mjs';

const BASE = { id: 'OPS-1', source: 'pagerduty', type: 'incident', severity: 'medium', summary: 'x', route: 'spec-fix', link: 'PR-1234' };
const RN_OK = { required: true, authority: 'CBUAE', deadline: '2026-07-16T00:00:00Z', sent_at: '2026-07-15T10:00:00Z', reference: 'IR-2026-0031' };
const HIGH = (rn, over = {}) => ({ ...BASE, severity: 'high', detected: '2026-07-14', evidence_ref: 'x.md', regulator_notification: rn, ...over });
const one = (over) => ({ signals: [{ ...BASE, ...over }] });

test('a valid, triaged, traceable signal passes', () => {
  assert.deepEqual(evaluate(one()), []);
});

test('an empty operations log is valid (Run may not have started)', () => {
  assert.deepEqual(evaluate({ signals: [] }), []);
});

test('a signal with no route is untriaged — the failure this gate prevents', () => {
  assert.match(evaluate(one({ route: undefined }))[0], /not triaged|fall on the floor/);
});

test('an unknown type is rejected', () => {
  assert.ok(evaluate(one({ type: 'meteor' })).some((x) => /type must be one of/.test(x)));
});

test('a bad severity is rejected', () => {
  assert.ok(evaluate(one({ severity: 'spicy' })).some((x) => /severity must be/.test(x)));
});

test('discovery route needs a linked run unless triaging', () => {
  assert.ok(evaluate(one({ route: 'discovery', link: '', status: 'resolved' })).some((x) => /Run→Discovery edge is broken/.test(x)));
  assert.deepEqual(evaluate(one({ route: 'discovery', link: 'revoke-latency' })), []);
  assert.deepEqual(evaluate(one({ route: 'discovery', link: '', status: 'triaging' })), []);
});

test('register route must cite a DR-* risk', () => {
  assert.ok(evaluate(one({ route: 'register', link: 'something' })).some((x) => /cite a DR-\* risk/.test(x)));
  assert.deepEqual(evaluate(one({ route: 'register', link: 'DR-1' })), []);
});

test('spec-fix route must link a PR / spec-change', () => {
  assert.ok(evaluate(one({ route: 'spec-fix', link: '' })).some((x) => /links no PR/.test(x)));
});

test('accepted (no-op) needs a justification', () => {
  assert.ok(evaluate(one({ route: 'accepted', link: '', justification: '' })).some((x) => /needs a justification/.test(x)));
  assert.deepEqual(evaluate(one({ route: 'accepted', justification: 'within error budget' })), []);
});

test('a high/critical signal needs an evidence_ref', () => {
  assert.ok(evaluate(one({ severity: 'critical', evidence_ref: '' })).some((x) => /needs an evidence_ref/.test(x)));
  assert.deepEqual(evaluate(one({ severity: 'critical', evidence_ref: 'incident/4471.md', regulator_notification: RN_OK })), []);
});

test('a missing signals array is a finding', () => {
  assert.match(evaluate({})[0], /no `signals` array/);
});

test('an empty log is valid before launch — and a finding once anything is in production (1.12)', () => {
  assert.deepEqual(evaluate({ signals: [] }), []);
  assert.deepEqual(evaluate({ signals: [] }, { inProduction: false }), []);
  const f = evaluate({ signals: [] }, { inProduction: true });
  assert.equal(f.length, 1);
  assert.match(f[0], /EMPTY while a governed change is in production/);
});

/* ---- rc.37 · flow-plan Phase 3.3: the two fields that make Run measurable ---- */

test('FLOW — caused_by_change must resolve to a governed change; a ghost id fails', () => {
  const ids = new Set(['CHG-2026-0042']);
  assert.deepEqual(evaluate(one({ caused_by_change: 'CHG-2026-0042' }), { changeIds: ids }), []);
  const f = evaluate(one({ caused_by_change: 'CHG-9999-0001' }), { changeIds: ids });
  assert.ok(f.some((x) => /does not resolve to a governed change/.test(x)), f.join('\n'));
  assert.ok(evaluate(one({ caused_by_change: 42 }), { changeIds: ids }).some((x) => /must be a change_id string/.test(x)));
});

test('FLOW — with no changes tree the attribution is NOT verified, and says so (never a silent pass)', () => {
  const notices = [];
  assert.deepEqual(evaluate(one({ caused_by_change: 'CHG-2026-0042' }), { changeIds: null, notices }), []);
  assert.ok(notices.some((n) => /NOT verified/.test(n)), notices.join('\n'));
});

test('FLOW — resolved_at must parse, and may not precede detection', () => {
  const withDates = (over) => one({ detected: '2026-07-14T00:00:00Z', ...over });
  assert.deepEqual(evaluate(withDates({ resolved_at: '2026-07-14T04:00:00Z' })), []);
  assert.ok(evaluate(withDates({ resolved_at: 'later' })).some((x) => /is not a timestamp/.test(x)));
  assert.ok(evaluate(withDates({ resolved_at: '2026-07-13T00:00:00Z' })).some((x) => /precedes detected/.test(x)));
});

test('FLOW — both fields stay OPTIONAL: a signal without them is unchanged', () => {
  assert.deepEqual(evaluate(one(), { changeIds: new Set() }), []);
});

/* ---- rc.46 · Shari'ah workstream: a Shari'ah breach must have somewhere to go ----
   The gate validates the LOG. The runtime screening that writes the entry is the institution's,
   and none of these tests — or the gate — say anything about whether a structure is Shari'ah
   compliant. They say whether a declared breach was routed somewhere a scholar can decide. */

const shariah = (over) => one({ type: 'shariah-non-compliance', severity: 'medium', evidence_ref: 'shariah/SC-1.md', route: 'purification', link: 'PUR-1', ...over });

test('SHARIAH — the taxonomy grew and nothing was removed', () => {
  for (const t of ['incident', 'slo-breach', 'drift', 'cve', 'regulatory', 'near-miss', 'customer-signal', 'risk-materialised']) {
    assert.ok(TYPES.has(t), `${t} must still be a type`);
  }
  assert.ok(TYPES.has('shariah-non-compliance'));
  for (const r of ['spec-fix', 'register', 'discovery', 'accepted']) assert.ok(ROUTES.has(r), `${r} must still be a route`);
  assert.ok(ROUTES.has('purification') && ROUTES.has('issc-escalation'));
});

test('SHARIAH — the whole thing is DORMANT for a repo with no Islamic signal', () => {
  // Every pre-existing shape stays green with no purification/case trees anywhere.
  assert.deepEqual(evaluate(one(), { purificationIds: null, caseIds: null }), []);
  assert.deepEqual(evaluate(one({ severity: 'low', evidence_ref: undefined })), []);
});

test('PURIFICATION — the link must be a PUR-* id', () => {
  assert.ok(evaluate(shariah({ link: 'refunded it' })).some((x) => /does not cite a PUR-\* purification record/.test(x)));
  assert.ok(evaluate(shariah({ link: '' })).some((x) => /does not cite a PUR-\* purification record/.test(x)));
});

test('PURIFICATION — an unresolvable PUR-* id is a finding; a resolving one passes', () => {
  const ids = new Set(['PUR-2026-014']);
  assert.deepEqual(evaluate(shariah({ link: 'PUR-2026-014' }), { purificationIds: ids }), []);
  assert.ok(evaluate(shariah({ link: 'PUR-9999-001' }), { purificationIds: ids })
    .some((x) => /does not resolve under docs\/governance\/purification\//.test(x)));
});

test('PURIFICATION — with no purification tree the link is NOT verified, and says so (never a silent pass)', () => {
  const notices = [];
  assert.deepEqual(evaluate(shariah({ link: 'PUR-2026-014' }), { purificationIds: null, notices }), []);
  assert.ok(notices.some((n) => /NOT verified/.test(n) && /purification/.test(n)), notices.join('\n'));
});

test('ESCALATION — the link must name a resolving assurance case, or the signal is triaging', () => {
  const cases = new Set(['AC-2026-007']);
  const esc = (over) => shariah({ route: 'issc-escalation', link: 'AC-2026-007', ...over });
  assert.deepEqual(evaluate(esc(), { caseIds: cases }), []);
  assert.ok(evaluate(esc({ link: 'AC-9999-001' }), { caseIds: cases })
    .some((x) => /does not resolve under docs\/governance\/assurance-cases\//.test(x)));
  // logged before the case was cut
  assert.deepEqual(evaluate(esc({ link: '', status: 'triaging' }), { caseIds: cases }), []);
  assert.ok(evaluate(esc({ link: '', status: 'resolved' }), { caseIds: cases })
    .some((x) => /reaches no case reaches no committee/.test(x)));
});

test('ESCALATION — with no assurance-case tree the citation is NOT verified, not assumed good', () => {
  const notices = [];
  assert.deepEqual(evaluate(shariah({ route: 'issc-escalation', link: 'AC-2026-007' }), { caseIds: null, notices }), []);
  assert.ok(notices.some((n) => /NOT verified/.test(n) && /assurance-case/.test(n)), notices.join('\n'));
});

test('SHARIAH — an evidence_ref is required at EVERY severity, not only high/critical', () => {
  for (const severity of ['low', 'medium']) {
    assert.ok(evaluate(shariah({ severity, evidence_ref: '' }))
      .some((x) => /needs an evidence_ref at EVERY severity/.test(x)), `${severity} must demand evidence`);
  }
  assert.deepEqual(evaluate(shariah({ severity: 'low' })), []);
  // high/critical are still covered by the pre-existing rule, and reported once, not twice.
  const f = evaluate(shariah({ severity: 'critical', evidence_ref: '' })).filter((x) => /evidence_ref/.test(x));
  assert.equal(f.length, 1, f.join('\n'));
});

test('SHARIAH — routing a breach to `accepted` is a finding; a triager does not waive one', () => {
  const f = evaluate(shariah({ route: 'accepted', link: '', justification: 'immaterial amount' }));
  assert.ok(f.some((x) => /may route only to/.test(x) && /Shari'ah body's decision/.test(x)), f.join('\n'));
  // spec-fix and discovery are refused for the same reason — the destination has no scholar in it.
  for (const route of ['spec-fix', 'discovery']) {
    assert.ok(evaluate(shariah({ route, link: 'PR-1' })).some((x) => /may route only to/.test(x)), route);
  }
  // and the three permitted routes are permitted
  assert.deepEqual([...SHARIAH_ROUTES], ['purification', 'issc-escalation', 'register']);
  assert.deepEqual(evaluate(shariah({ route: 'register', link: 'DR-1.1' })), []);
});

test('SHARIAH — the route restriction only bites the Shari\'ah type', () => {
  assert.deepEqual(evaluate(one({ route: 'accepted', link: '', justification: 'within error budget' })), []);
});

/* ---- the two resolvers: absent tree ⇒ null (unverified), present tree ⇒ ids ---- */

test('RESOLVERS — an absent tree returns null; a present one returns filename AND declared id', () => {
  const root = mkdtempSync(join(tmpdir(), 'ops-signal-'));
  try {
    assert.equal(purificationRecordIds(root), null, 'no purification tree ⇒ null, which evaluate reports as unverified');
    assert.equal(assuranceCaseIds(root), null);

    mkdirSync(join(root, 'docs/governance/purification'), { recursive: true });
    writeFileSync(join(root, 'docs/governance/purification/PUR-2026-014.json'), JSON.stringify({ purification_id: 'PUR-2026-014-A' }));
    writeFileSync(join(root, 'docs/governance/purification/broken.json'), '{not json');
    const pur = purificationRecordIds(root);
    assert.ok(pur.has('PUR-2026-014') && pur.has('PUR-2026-014-A'), [...pur].join(','));
    assert.ok(pur.has('broken'), 'an unparseable record still resolves by name — its own gate reports it');
    assert.ok(!pur.has(undefined));

    mkdirSync(join(root, 'docs/governance/assurance-cases'), { recursive: true });
    writeFileSync(join(root, 'docs/governance/assurance-cases/AC-1.json'), JSON.stringify({ case_id: 'AC-2026-007' }));
    const cases = assuranceCaseIds(root);
    assert.ok(cases.has('AC-1') && cases.has('AC-2026-007'), [...cases].join(','));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ---- 2.1.0 (hardening plan 4.7): regulator notification ---- */

test('NOTIFICATION — a high or critical signal must state its position; low and medium need not', () => {
  assert.deepEqual([...NOTIFICATION_SEVERITIES].sort(), ['critical', 'high']);
  assert.ok(evaluate(one(HIGH(undefined))).some((x) => /must say whether the regulator is notified/.test(x)));
  assert.ok(!evaluate(one({ severity: 'medium' })).some((x) => /regulator/.test(x)));
  assert.deepEqual(evaluate(one(HIGH(RN_OK))), []);
});

test('NOTIFICATION — required:false carries a rationale; required:true carries an authority and a deadline', () => {
  assert.ok(evaluate(one(HIGH({ required: false }))).some((x) => /required is false with no rationale/.test(x)));
  assert.deepEqual(evaluate(one(HIGH({ required: false, rationale: 'below the reporting threshold; contained' }))), []);
  assert.ok(evaluate(one(HIGH({ required: true }))).some((x) => /deadline .* is not a parseable timestamp/.test(x)));
  assert.ok(evaluate(one(HIGH({ required: true, deadline: '2026-07-16' }))).some((x) => /no authority/.test(x)));
  assert.ok(evaluate(one(HIGH({ required: 'yes' }))).some((x) => /required must be true or false/.test(x)));
});

test('NOTIFICATION — before the deadline an unsent notification is a NOTICE; after it, a finding', () => {
  const pending = { required: true, authority: 'CBUAE', deadline: '2026-07-16T00:00:00Z' };
  const notices = [];
  assert.deepEqual(evaluate(one(HIGH(pending)), { notices, now: Date.parse('2026-07-15T00:00:00Z') }), []);
  assert.ok(notices.some((n) => /due by 2026-07-16/.test(n)));
  assert.ok(evaluate(one(HIGH(pending)), { now: Date.parse('2026-07-17T00:00:00Z') }).some((x) => /has PASSED and no notification was sent/.test(x)));
});

test('NOTIFICATION — a sent notification carries its reference; a late one is noticed, not blocked', () => {
  assert.ok(evaluate(one(HIGH({ ...RN_OK, reference: undefined }))).some((x) => /sent with no reference/.test(x)));
  const notices = [];
  assert.deepEqual(checkRegulatorNotification(HIGH({ ...RN_OK, sent_at: '2026-07-18T00:00:00Z' }), { notices, now: Date.parse('2026-07-20T00:00:00Z') }), []);
  assert.ok(notices.some((n) => /after its deadline/.test(n)));
  assert.ok(evaluate(one(HIGH({ ...RN_OK, deadline: '2026-07-01' }))).some((x) => /precedes detected/.test(x)));
});
