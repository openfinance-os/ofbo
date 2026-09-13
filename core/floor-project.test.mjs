// Tests for the read-only projection (Factory Floor WS1 · D1.1–D1.3). Node built-in runner.
//
// The positive tests here are cheap: it is not hard to show that a backlog item becomes a card. The
// tests that carry the module are the negatives, and each of them is written as the thing that would
// PASS if the control were absent — an unlabelled payload, a field nobody put in the ceiling, an
// approval attestation mirrored onto a card, a record that quietly disappeared. Those are the four
// ways a projection stops being a stale board and starts being a false approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_FIELDS,
  CAPS,
  CLASSES,
  NON_AUTHORITATIVE,
  PROJECTOR_IDENTITY,
  SCHEMA_ID,
  WRITE_CLASS,
  canonical,
  deriveViews,
  digestOf,
  everyExceptionIsNamed,
  freezeBlock,
  project,
  scan,
  summarise,
  verifyProjection,
  verifyRecord,
} from './floor-project.mjs';

const AT = '2026-07-26T09:00:00Z';
const SRC = { sha: 'a1b2c3d4e5f6', ref: 'refs/heads/main' };
const opts = (over = {}) => ({ projectedAt: AT, source: SRC, ...over });

const BACKLOG = [
  { id: 'STORY-12', title: 'Affordability check on limit increase', state: 'pending', milestone: 'M1', discovery: 'credit-limit-review', waist_gate: 'green' },
  { id: 'STORY-13', title: 'Board timeline view', state: 'done', milestone: 'M1' },
];
const CHANGES = [
  { change_id: 'CHG-2026-0042', product_id: 'PRD-017', change_type: 'material-product-change', risk_tier: 'high', current_state: 'in-delivery', classified_at: '2026-07-18', classified_by: 'po-fatima', discovery_run: 'credit-limit-review', flags: { personal_data: true }, exemptions: [] },
];
const DECISIONS = [
  { seq: 0, at: '2026-07-20T09:02:00Z', actor: 'agent-loom-delivery', change_id: 'CHG-2026-0042', decision: 'Adopt the affordability contract from the discovery hand-off; write contract + acceptance tests RED first.', rationale: 'Spec-first is binding.', inputs_ref: 'discovery/runs/credit-limit-review/handoff.md', tool_calls: [{ tool: 'read' }], prev: 'GENESIS', seal: '4ed3b9f9' },
];

const built = (over = {}) => project({ backlog: BACKLOG, changes: CHANGES, decisions: DECISIONS }, opts(over));

// --- the payload it derives -----------------------------------------------------------------------

test('a backlog change, a change state and a decision entry all reach the board', () => {
  const { payload, findings } = built();
  assert.deepEqual(findings, []);
  assert.equal(payload.counts.records, 4);
  assert.equal(payload.counts.withheld, 0);
  const ids = payload.records.map((r) => r.id);
  assert.deepEqual(ids, ['STORY-12', 'STORY-13', 'CHG-2026-0042', 'CHG-2026-0042#0']);
  assert.deepEqual(verifyProjection(payload), [], 'what the projector derives must pass the gate that guards the projector');
});

test('the payload and EVERY record carry the non-authoritative label', () => {
  const { payload } = built();
  assert.equal(payload.authority, 'none');
  assert.equal(payload.banner, NON_AUTHORITATIVE);
  assert.equal(payload.write_class, WRITE_CLASS);
  assert.equal(payload.schema, SCHEMA_ID);
  for (const r of payload.records) {
    assert.equal(r.authority, 'none', `${r.id} lost the label`);
    assert.equal(r.banner, NON_AUTHORITATIVE, `${r.id} lost the banner — a card is what gets screenshotted`);
  }
});

test('the derivation is deterministic — same input, same bytes, same digest', () => {
  const a = built().payload;
  const b = project({ decisions: DECISIONS, changes: CHANGES, backlog: BACKLOG }, opts()).payload;
  assert.equal(canonical(a), canonical(b), 'input key order must not change the payload');
  assert.equal(a.digest, b.digest);
  assert.equal(a.digest, digestOf(a));
});

test('the module has no clock and no default source — both are the caller\'s', () => {
  assert.match(project({}, { source: SRC }).findings[0], /PJ-R06: no ISO-8601 `projectedAt`/);
  assert.match(project({}, { projectedAt: AT }).findings[0], /PJ-R06: no source commit sha/);
  assert.equal(project({}, { source: SRC }).payload, null, 'a projection that cannot be anchored is not published in a reduced form');
});

test('a repository that projects nothing derives a clean, empty, still-labelled payload', () => {
  const { payload, findings, notices } = project({}, opts());
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
  assert.deepEqual(payload.counts, { records: 0, projected: 0, withheld: 0 });
  assert.deepEqual(verifyProjection(payload), []);
});

// --- the content ceiling --------------------------------------------------------------------------

test('a field with no entry in the ceiling never reaches the payload, and is SIGNALLED', () => {
  const { payload, notices } = built();
  const change = payload.records.find((r) => r.class === 'change');
  assert.equal(change.fields.flags, undefined, 'flags has no entry — deny by default');
  assert.equal(change.fields.exemptions, undefined);
  assert.deepEqual(change.withheld_fields, ['exemptions', 'flags']);
  assert.ok(notices.some((n) => /withheld as outside the ceiling: exemptions, flags/.test(n)),
    'a schema change upstream must produce a withheld field and a signal, not a silent new disclosure');
});

test('the agent\'s free-text rationale, tool calls and hash chain never leave git', () => {
  const { payload } = built();
  const d = payload.records.find((r) => r.class === 'decision_log');
  assert.deepEqual(Object.keys(d.fields).sort(), ['actor', 'at', 'change_id', 'seq', 'summary']);
  assert.deepEqual(d.withheld_fields, ['inputs_ref', 'prev', 'rationale', 'seal', 'tool_calls']);
  assert.ok(d.fields.summary.length <= CAPS.summary);
});

test('a summary field is rendered through the bounded transform, never passed through verbatim', () => {
  const long = `${'word '.repeat(200)}see /repo/src/affordability.ts`;
  const { payload } = project({ decisions: [{ seq: 1, at: AT, actor: 'a', change_id: 'C', decision: long }] }, opts());
  const s = payload.records[0].fields.summary;
  assert.ok(s.length <= CAPS.summary, `summary is ${s.length} chars`);
  assert.ok(s.endsWith(' …'), 'elision must be visible');
  assert.equal(summarise('a  b\n\nc'), 'a b c');
  assert.equal(summarise('see /repo/src/x.ts now'), 'see ⟨path⟩ now');
  assert.equal(summarise('x'), summarise('x'), 'no clock, no locale, no randomness');
});

test('every fidelity above its class ceiling carries a written exception — and there is exactly one', () => {
  assert.deepEqual(everyExceptionIsNamed(), []);
  const verbatim = Object.entries(CLASSES).flatMap(([c, d]) => d.fields.filter((f) => f.fidelity === 'full-text').map((f) => `${c}.${f.name}`));
  assert.deepEqual(verbatim, ['backlog.title'], 'a second verbatim field must be a visible act in a diff');
});

// NEGATIVE — this is what an edited allow-list looks like. Without the check it would project.
test('a field added to a payload but not to the ceiling is refused', () => {
  const { payload } = built();
  payload.records[0].fields.customer_note = 'she called twice about the fee';
  payload.digest = digestOf(payload);
  assert.ok(verifyProjection(payload).some((f) => /PJ-R02.*`customer_note` has no entry/.test(f)));
});

// NEGATIVE — free text taking a field granted for a reference. Passes trivially without the cap.
test('a reference+status field carrying prose or a newline is refused', () => {
  const { payload } = built();
  payload.records[0].fields.state = 'pending\nbecause the customer complained';
  payload.digest = digestOf(payload);
  assert.ok(verifyProjection(payload).some((f) => /PJ-R03.*carries a newline/.test(f)));

  const { payload: p2 } = built();
  p2.records[0].fields.milestone = 'x'.repeat(CAPS['reference+status'] + 1);
  p2.digest = digestOf(p2);
  assert.ok(verifyProjection(p2).some((f) => /PJ-R03.*above the reference\+status cap/.test(f)));
});

test('a content class nobody listed has fidelity `never`', () => {
  assert.ok(verifyRecord({ class: 'product_passport', id: 'PRD-017', authority: 'none', banner: NON_AUTHORITATIVE, fields: {} })
    .some((f) => /PJ-R05.*is not in the ceiling/.test(f)));
});

// --- personal data --------------------------------------------------------------------------------

// NEGATIVE — the record the filter exists for. Absent the scan this projects a customer identifier.
test('personal data in a projected field withholds the WHOLE record, visibly', () => {
  const { payload, notices } = project({
    backlog: [{ id: 'STORY-99', title: 'Chase 784-1990-1234567-1 about the fee', state: 'pending' }],
  }, opts());
  const r = payload.records[0];
  assert.equal(r.withheld, true);
  assert.equal(r.reason, 'withheld — filter hit');
  assert.equal(r.filter, 'emirates-id');
  assert.equal(r.fields, undefined, 'withholding is whole-record — a half-projected record reads as complete');
  assert.equal(payload.counts.withheld, 1);
  assert.equal(payload.counts.records, 1, 'the record is withheld, never omitted');
  assert.ok(notices.some((n) => /withheld — filter hit \(emirates-id\)/.test(n)));
  assert.deepEqual(verifyProjection(payload), []);
});

test('separators cannot walk an identifier past the filter, and the other shapes are caught too', () => {
  assert.equal(scan('784.1990.1234567.1').id, 'emirates-id');
  assert.equal(scan('784 1990 1234567 1').id, 'emirates-id');
  assert.equal(scan('AE070331234567890123456').id, 'uae-iban');
  assert.equal(scan('AE070001234567890123456'), null, 'synthetic IBANs (bank code 000) are fine');
  assert.equal(scan('fatima@example.ae').id, 'email-address');
  // The PEM header only, with no key material after it — it is the input that proves the projection
  // filter catches a private-key block, so the string has to appear literally. The marker below is
  // line-scoped (it must sit ON the matching line) and exempts nothing else in this file.
  assert.equal(scan('-----BEGIN OPENSSH PRIVATE KEY-----').id, 'private-key'); // loom-allow-secret
  assert.equal(scan('ghp_abcdefghijklmnopqrstuvwxyz01').id, 'bearer-token');
  assert.equal(scan('STORY-12 pending M1'), null);
});

test('the scan runs AFTER the transform — a summary cannot smuggle what its source contained', () => {
  const { payload } = project({
    decisions: [{ seq: 0, at: AT, actor: 'a', change_id: 'C', decision: 'Contacted noor@example.ae for the fixture.' }],
  }, opts());
  assert.equal(payload.records[0].withheld, true);
  assert.equal(payload.records[0].filter, 'email-address');
});

// NEGATIVE — a hand-built payload that skipped the projector entirely.
test('a prohibited shape in a hand-built payload is refused at the gate too', () => {
  const { payload } = built();
  payload.records[0].fields.title = 'Refund to AE070331234567890123456';
  payload.digest = digestOf(payload);
  assert.ok(verifyProjection(payload).some((f) => /PJ-R04.*real-shaped UAE IBAN/.test(f)));
});

// --- no governance authority ----------------------------------------------------------------------

// NEGATIVE — the failure this module is arranged against: a card that reads as the control.
test('an authority field is refused even when someone adds it to the allow-list', () => {
  const { payload } = built();
  // Simulate the edit that grants it: put it in the ceiling AND in the payload.
  CLASSES.change.fields.push({ name: 'attestation', from: 'attestation', fidelity: 'reference+status' });
  try {
    assert.ok(everyExceptionIsNamed().some((f) => /attestation: is an authority field/.test(f)),
      'the ceiling table itself must refuse it');
    payload.records[2].fields.attestation = 'sig:MEUCIQ…';
    payload.digest = digestOf(payload);
    const f = verifyProjection(payload);
    assert.ok(f.some((x) => /PJ-R10.*`attestation` is refused wherever it appears/.test(x)),
      'an allow-list is an editable file; this refusal is the part an edit cannot reach');
  } finally { CLASSES.change.fields.pop(); }
  assert.deepEqual(everyExceptionIsNamed(), []);
});

test('the seal, the plan hash and the release hold are all in the refused set', () => {
  for (const k of ['seal', 'prev', 'plan_hash', 'release_hold', 'signature', 'approved_by', 'token']) {
    assert.ok(AUTHORITY_FIELDS.has(k), `${k} must be refused wherever it appears`);
  }
});

// NEGATIVE — a payload that lost its label. Without PJ-R01 this is indistinguishable from the record.
test('an unlabelled projection is refused, at the payload and at the record', () => {
  for (const strip of ['authority', 'banner', 'write_class', 'schema']) {
    const { payload } = built();
    delete payload[strip];
    assert.ok(verifyProjection(payload).some((f) => /^PJ-R01/.test(f)), `stripping ${strip} must be a finding`);
  }
  const { payload } = built();
  delete payload.records[1].banner;
  assert.ok(verifyProjection(payload).some((f) => /PJ-R01.*record\[1\].*banner is missing or altered/.test(f)));
});

test('a softened banner is refused — the sentence is verbatim or it is a finding', () => {
  const { payload } = built();
  payload.banner = 'Read-only view of the repo.';
  assert.ok(verifyProjection(payload).some((f) => /PJ-R01.*banner is missing or altered/.test(f)));
});

test('a projection attributed to any identity but the projector is refused', () => {
  assert.match(project({}, opts({ projectedBy: 'svc-floor-freezer' })).findings[0], /PJ-R08/);
  const { payload } = built();
  payload.projected_by = 'agent-loom-delivery';
  assert.ok(verifyProjection(payload).some((f) => /PJ-R08/.test(f)));
});

// --- withholding is visible -----------------------------------------------------------------------

// NEGATIVE — the quiet failure. A shorter board looks like a shorter backlog.
test('a record dropped between derivation and publication is caught by the counts', () => {
  const { payload } = built();
  payload.records.splice(1, 1); // the record nobody would miss
  assert.ok(verifyProjection(payload).some((f) => /PJ-R07.*counts do not reconcile/.test(f)));
});

test('a withheld record that still carries fields is refused', () => {
  const { payload } = built();
  payload.records[0] = { ...payload.records[0], withheld: true, reason: 'withheld — filter hit', filter: 'x' };
  assert.ok(verifyProjection(payload).some((f) => /PJ-R07.*still carries fields/.test(f)));
});

test('a withheld record that does not say so in the words a reader sees is refused', () => {
  const { payload } = built();
  const r = payload.records[0];
  payload.records[0] = { class: r.class, id: r.id, authority: 'none', banner: NON_AUTHORITATIVE, withheld: true, reason: 'n/a', filter: 'x' };
  assert.ok(verifyProjection(payload).some((f) => /PJ-R07.*words a reader will see/.test(f)));
});

// --- attachments and the freeze block (D1.3) --------------------------------------------------------

test('an attachment, a binary or an evidence payload never projects', () => {
  const { payload } = built();
  payload.records[0].fields.title = { url: 'https://files.example/evidence.pdf' };
  payload.digest = digestOf(payload);
  assert.ok(verifyProjection(payload).some((f) => /PJ-R09.*is not a scalar/.test(f)));
  // …and the projector refuses to build one in the first place.
  const { payload: p2 } = project({ backlog: [{ id: 'S-1', title: { url: 'x' }, state: 'pending' }] }, opts());
  assert.equal(p2.records[0].fields.title, undefined);
});

test('the freeze/drift block renders display-only', () => {
  const { payload } = project({ backlog: [{ id: 'S-1', title: 't', state: 'pending', freeze: { frozenAt: 'abc123', version: 'v2', drift: 'draft ahead of record' } }] }, opts());
  const fz = payload.records[0].freeze;
  assert.equal(fz.display_only, true);
  assert.equal(fz.read_only, true);
  assert.equal(fz.drift, 'draft ahead of record');
  assert.deepEqual(verifyProjection(payload), []);
});

// NEGATIVE — a drift badge that looks operable is a control that does not exist.
test('a freeze block that is not display-only, or carries an invented drift state, is refused', () => {
  const { payload } = project({ backlog: [{ id: 'S-1', title: 't', state: 'pending', freeze: {} }] }, opts());
  payload.records[0].freeze.display_only = false;
  payload.digest = digestOf(payload);
  assert.ok(verifyProjection(payload).some((f) => /PJ-R10.*not marked display_only/.test(f)));

  const bad = { ...freezeBlock(), drift: 'resolved by ops' };
  assert.ok(verifyRecord({ class: 'backlog', id: 'S-1', authority: 'none', banner: NON_AUTHORITATIVE, fields: {}, freeze: bad })
    .some((f) => /PJ-R03.*drift is "resolved by ops"/.test(f)));
});

// --- integrity ------------------------------------------------------------------------------------

test('a payload edited after derivation no longer matches its own digest', () => {
  const { payload } = built();
  payload.records[0].fields.state = 'done';
  assert.ok(verifyProjection(payload).some((f) => /PJ-R06.*digest does not match/.test(f)));
});

test('an unknown record key is refused rather than passed through', () => {
  assert.ok(verifyRecord({ class: 'backlog', id: 'S-1', authority: 'none', banner: NON_AUTHORITATIVE, fields: {}, comment_thread: 'x' })
    .some((f) => /PJ-R02.*`comment_thread` is not part of a projection record/.test(f)));
});

// --- the views (D1.2) -------------------------------------------------------------------------------

test('the board, timeline, activity feed and MI derive from the payload only', () => {
  const { payload } = built();
  const v = deriveViews(payload);
  assert.deepEqual(Object.keys(v.board.columns).sort(), ['done', 'pending']);
  assert.equal(v.timeline.rows[0].id, 'CHG-2026-0042');
  assert.equal(v.activity.entries[0].actor, 'agent-loom-delivery');
  assert.equal(v.mi.records, 4);
  assert.deepEqual(v.mi.backlog_by_state, { done: 1, pending: 1 });
  for (const view of Object.values(v)) {
    assert.equal(view.authority, 'none');
    assert.equal(view.banner, NON_AUTHORITATIVE, 'a view is a projection too');
    assert.equal(view.source_sha, SRC.sha, 'a board that cannot name its commit cannot be told from a current one');
  }
});

// NEGATIVE — the board is where "withheld" would be easiest to render as "absent".
test('a withheld record still appears on the board, as a withheld card', () => {
  const { payload } = project({ backlog: [{ id: 'STORY-99', title: 'call 784-1990-1234567-1', state: 'pending' }] }, opts());
  const v = deriveViews(payload);
  assert.deepEqual(Object.keys(v.board.columns), ['withheld']);
  assert.equal(v.board.columns.withheld[0].label, 'withheld — filter hit');
  assert.equal(v.mi.withheld, 1);
});

test('the projector identity is the one D1.1 names', () => {
  assert.equal(PROJECTOR_IDENTITY, 'svc-floor-projector');
});
