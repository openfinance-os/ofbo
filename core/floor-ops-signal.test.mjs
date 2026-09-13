// Tests for operations-signal intake (Factory Floor WS6 · D6.1). Node built-in runner.
//
// The positive tests are cheap: it is not hard to show that a filed card becomes a log entry. The
// tests that carry the module are the negatives, and every one of them is written as the thing that
// would PASS if the control were absent — a card that routes itself, an adjudication that inherits
// the filer's rating by saying nothing, a "triaged" record with nobody's name on the verdict, a row
// copied into the log with its provenance left behind. Each of those is the ordinary case rather
// than the malicious one, which is why they are checks and not conventions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUTES,
  SEVERITIES,
  TYPES,
  evaluate as evaluateOperationsSignalLog,
} from '../scripts/operations-signal-check.mjs';
import {
  LOG_PATH,
  NON_AUTHORITATIVE,
  REJECTIONS,
  SCHEMA_ID,
  STATES,
  TRANSCRIBER_IDENTITY,
  WRITE_CLASS,
  entryFrom,
  filedClaim,
  filedDigest,
  intake,
  reclassifiedBetween,
  roundTrip,
  verifyEntryTraceability,
  verifyIntake,
} from './floor-ops-signal.mjs';

const FILED = {
  id: 'OPS-2026-101',
  source: 'pagerduty',
  surface_ref: 'card-9f21',
  filed_by: 'ops-dana',
  filed_at: '2026-07-20T02:14:00Z',
  type: 'incident',
  severity: 'high',
  summary: 'Consent-token refresh returned 500s for about twelve minutes during the certificate rotation window.',
  evidence_ref: 'incidents/INC-4821-postmortem.md',
};
const ADJ = {
  adjudicated_by: 'risk-lena',
  adjudicated_at: '2026-07-20T09:00:00Z',
  type: 'incident',
  severity: 'high',
  route: 'spec-fix',
  link: 'https://git.example.invalid/app/pull/1487',
  // 2.1.0 (4.7): a high signal states its regulator-notification position at adjudication.
  regulator_notification: { required: false, rationale: 'contained inside the reporting window; no customer data exposed' },
};

const filed = (over = {}) => ({ ...FILED, ...over });
const adj = (over = {}) => ({ ...ADJ, ...over });
const run = (f = FILED, a = ADJ, opts) => intake({ filed: f, adjudication: a }, opts);
const has = (findings, re) => findings.some((f) => re.test(f));

// --- the round trip, end to end -------------------------------------------------------------------

test('a filed, adjudicated signal exits triage as an entry the existing gate accepts', () => {
  const { record, entry, findings } = run();
  assert.deepEqual(findings, []);
  assert.equal(record.state, 'triaged');
  assert.deepEqual(verifyIntake(record), []);
  assert.deepEqual(verifyEntryTraceability(entry), []);
  // The acceptance criterion is the gate's verdict, not this module's opinion of it.
  assert.deepEqual(evaluateOperationsSignalLog({ signals: [entry] }), []);

  const { proposal, findings: tripFindings } = roundTrip({ _comment: 'mine', signals: [] }, [record]);
  assert.deepEqual(tripFindings, []);
  assert.equal(proposal.path, LOG_PATH);
  assert.deepEqual(proposal.added, ['OPS-2026-101']);
  assert.equal(proposal.log._comment, 'mine', 'the round trip proposes an addition, never a replacement');
  assert.deepEqual(evaluateOperationsSignalLog(proposal.log), [], 'the proposed file must pass the gate it is proposed into');
});

test('the entry carries enough to follow the signal back to what was filed, by whom, and what changed', () => {
  const { entry, record } = run(filed({ severity: 'critical' }), adj({ severity: 'medium' }));
  const t = entry.intake;
  assert.equal(t.filed_by, 'ops-dana');
  assert.equal(t.filed_at, '2026-07-20T02:14:00Z');
  assert.equal(t.surface_ref, 'card-9f21', 'the card the claim was filed on is the far end of the trail');
  assert.equal(t.adjudicated_by, 'risk-lena');
  assert.equal(t.adjudicated_at, '2026-07-20T09:00:00Z');
  assert.equal(t.filed_digest, record.filed_digest);
  assert.deepEqual(t.reclassified, [{ field: 'severity', filed: 'critical', adjudicated: 'medium' }]);
  assert.deepEqual(verifyEntryTraceability(entry), []);
});

test('the filed rating stays distinguishable from the adjudicated one, and a downgrade is visible', () => {
  const { record, entry, notices } = run(filed({ severity: 'critical', type: 'incident' }), adj({ severity: 'low', type: 'slo-breach' }));
  assert.equal(record.filed.severity, 'critical', 'the claim is preserved exactly as filed');
  assert.equal(record.filed.type, 'incident');
  assert.equal(entry.severity, 'low', 'the log carries the ADJUDICATED rating — a rating is an input, the verdict is the adjudication');
  assert.equal(entry.type, 'slo-breach');
  assert.deepEqual(record.reclassified.map((r) => r.field).sort(), ['severity', 'type']);
  assert.ok(notices.some((n) => /re-rated in triage by risk-lena/.test(n)),
    'a downgrade is a visible act with a name against it, not a quiet edit');
  assert.deepEqual(reclassifiedBetween({ type: 'cve', severity: 'high' }, { type: 'cve', severity: 'high' }), []);
});

test('an unadjudicated signal derives NO entry — there is no shape in which it reads as routed', () => {
  const { record, entry, findings, notices } = intake({ filed: FILED });
  assert.deepEqual(findings, [], 'a filed-but-untriaged signal is a legitimate state, not a finding');
  assert.equal(record.state, 'filed');
  assert.equal(record.adjudication, null);
  assert.equal(entry, null, 'not a reduced entry, not a draft entry — none');
  assert.ok(notices.some((n) => /filed, not routed/.test(n)));
  assert.deepEqual(verifyIntake(record), []);
});

test('the derivation is deterministic and has no clock of its own', () => {
  const a = run().record;
  const b = run().record;
  assert.equal(a.filed_digest, b.filed_digest);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // Every instant in here is one somebody recorded. A clock would make the same two records order
  // differently on two machines, and the filed-before-adjudicated comparison is the whole point.
  const src = readFileSync(new URL('./floor-ops-signal.mjs', import.meta.url), 'utf8');
  assert.ok(!/Date\.now\s*\(/.test(src), 'no clock');
  assert.ok(!/new Date\s*\(/.test(src), 'no clock');
  assert.ok(!/\bfetch\s*\(|node:https?|require\(/.test(src), 'no network');
});

test('a repository with no operations log yet proposes an empty, valid one — silent where unadopted', () => {
  const { proposal, findings, notices } = roundTrip(null, []);
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
  assert.deepEqual(proposal.log.signals, []);
  assert.deepEqual(evaluateOperationsSignalLog(proposal.log), [], 'an empty log is valid before anything runs');
});

test('the round trip is idempotent — a re-filed card is a no-op, not a second row', () => {
  const { record } = run();
  const first = roundTrip({ signals: [] }, [record]);
  const second = roundTrip(first.proposal.log, [record]);
  assert.deepEqual(second.findings, []);
  assert.deepEqual(second.proposal.added, []);
  assert.deepEqual(second.proposal.unchanged, ['OPS-2026-101']);
  assert.equal(second.proposal.log.signals.length, 1);
  assert.ok(second.notices.some((n) => /byte-identical/.test(n)));
});

// --- the taxonomy is the gate's, and there is only one of it ---------------------------------------

// A few types constrain which routes they may take (the gate owns that rule — see
// operations-signal-check.mjs). The default route here is `spec-fix`, so those types need a route
// they are actually allowed, or this test would be asserting the constraint away.
const ROUTE_FOR_TYPE = { 'shariah-non-compliance': 'issc-escalation' };

test('every type and severity the gate knows is accepted here, and nothing else is', () => {
  for (const type of TYPES) {
    const route = ROUTE_FOR_TYPE[type];
    const over = route ? { type, route } : { type };
    assert.deepEqual(run(filed({ type }), adj(over)).findings, [], `${type} must be accepted`);
  }
  for (const severity of SEVERITIES) {
    assert.deepEqual(run(filed({ severity }), adj({ severity })).findings, [], `${severity} must be accepted`);
  }
  assert.ok(has(run(filed({ type: 'vibes' }), adj({ type: 'vibes' })).findings, /OS-R03.*filed type "vibes"/));
  assert.ok(has(run(filed({ severity: 'spicy' }), adj({ severity: 'spicy' })).findings, /OS-R03.*filed severity "spicy"/));
  assert.ok(has(run(FILED, adj({ route: 'someone-will-look' })).findings, /OS-R03.*route "someone-will-look"/));
});

// This is the test that proves there is ONE route table rather than two that agree today. Widen the
// gate's set at runtime and this module widens with it, because it is reading that very object.
test('the route vocabulary is the gate\'s object, not a copy of it', () => {
  ROUTES.add('experimental-route');
  try {
    const { entry, findings } = run(FILED, adj({ route: 'experimental-route' }));
    assert.deepEqual(findings, [], 'a route added to the gate is a route this module accepts — one table, not two');
    assert.equal(entry.route, 'experimental-route');
  } finally { ROUTES.delete('experimental-route'); }
  assert.ok(has(run(FILED, adj({ route: 'experimental-route' })).findings, /OS-R03/), 'and removing it removes it here too');
});

// --- a claim is not a verdict ----------------------------------------------------------------------

// NEGATIVE — the card that routes itself. Absent this refusal it lands as a triaged signal whose
// verdict is the filer's, and nothing downstream can tell the difference.
test('a card that arrives already routed is refused, not quietly unrouted', () => {
  assert.ok(has(intake({ filed: filed({ route: 'accepted' }) }).findings, /OS-R05.*the filed card already carries route "accepted"/));
  assert.ok(has(intake({ filed: filed({ status: 'triaging' }) }).findings, /OS-R05.*already carries status "triaging"/));
  assert.equal(intake({ filed: filed({ route: 'accepted' }) }).record, null, 'no reduced form');
});

// NEGATIVE — silence as agreement. Without OS-R01/R02 the adjudication inherits the filed rating,
// and a filed `critical` becomes an adjudicated `critical` because nobody typed anything.
test('an adjudication that states no type or no rating has not adjudicated one', () => {
  const noType = run(FILED, { adjudicated_by: 'risk-lena', adjudicated_at: ADJ.adjudicated_at, severity: 'high', route: 'spec-fix', link: 'x' });
  assert.ok(has(noType.findings, /OS-R01.*the adjudication states no type/));
  assert.equal(noType.entry, null);
  const noRating = run(filed({ severity: 'critical' }), { adjudicated_by: 'risk-lena', adjudicated_at: ADJ.adjudicated_at, type: 'incident', route: 'spec-fix', link: 'x' });
  assert.ok(has(noRating.findings, /OS-R02.*the adjudication states no rating/));
  assert.equal(noRating.entry, null, 'the filed `critical` must not reach the log by default');
});

test('a signal filed with no type or no rating is refused', () => {
  const { id, source, surface_ref, filed_by, filed_at, summary } = FILED;
  assert.ok(has(intake({ filed: { id, source, surface_ref, filed_by, filed_at, summary, severity: 'high' } }).findings, /OS-R01.*filed with no type/));
  assert.ok(has(intake({ filed: { id, source, surface_ref, filed_by, filed_at, summary, type: 'incident' } }).findings, /OS-R02.*filed with no rating/));
});

// NEGATIVE — the shape this module exists to make unavailable. Without the state/adjudication
// coupling, "triaged" is a string anybody can type over an unadjudicated claim.
test('a record presented as triaged with no adjudication is refused', () => {
  const { record } = intake({ filed: FILED });
  const forged = { ...record, state: 'triaged' };
  assert.ok(has(verifyIntake(forged), /OS-R05.*state is "triaged" with no adjudication/));
  const routed = { ...record, state: 'routed' };
  assert.ok(has(verifyIntake(routed), /OS-R05.*state is "routed", not/), 'there is no third state to hide in');
  const both = { ...record, adjudication: { ...ADJ } };
  assert.ok(has(verifyIntake(both), /OS-R05.*state is "filed" but an adjudication is attached/));
  assert.deepEqual(STATES, ['filed', 'triaged']);
});

// NEGATIVE — one pair of eyes twice. Passes trivially if nobody compares the two names.
test('the filer may not be the adjudicator', () => {
  const self = run(FILED, adj({ adjudicated_by: 'ops-dana' }));
  assert.ok(has(self.findings, /OS-R06.*ops-dana filed it and adjudicated it/));
  assert.equal(self.record, null);
  // …and at the gate, for a record this module did not build.
  const { record } = run();
  const forged = { ...record, adjudication: { ...record.adjudication, adjudicated_by: 'ops-dana' } };
  assert.ok(has(verifyIntake(forged), /OS-R06/));
  assert.ok(has(verifyEntryTraceability({ ...entryFrom(forged), route: 'spec-fix' }), /OS-R06/));
});

// NEGATIVE — a verdict that predates its claim. Both instants are recorded, so this is decidable
// offline and forever; without the comparison it reads as an ordinary triaged signal.
test('an adjudication dated before the filing it judges is not an adjudication of it', () => {
  assert.ok(has(run(FILED, adj({ adjudicated_at: '2026-07-19T00:00:00Z' })).findings, /OS-R05.*BEFORE it was filed/));
  assert.ok(has(run(FILED, adj({ adjudicated_at: 'last tuesday' })).findings, /OS-R05.*adjudicated_at is missing or not a parseable/));
  assert.ok(has(run(FILED, adj({ adjudicated_by: undefined })).findings, /OS-R05.*names no adjudicator/));
});

// NEGATIVE — writing an untriaged signal into the log. It becomes a row beside triaged ones, and a
// reader scanning the file cannot tell which of them anybody decided.
test('a filed-only record may not be written into the log', () => {
  const { record } = intake({ filed: FILED });
  const { proposal, findings } = roundTrip({ signals: [] }, [record]);
  assert.equal(proposal, null);
  assert.ok(has(findings, /OS-R05.*a filed signal may not be written into the log/));
});

// --- traceability ---------------------------------------------------------------------------------

// NEGATIVE — the copied row. Without OS-R07 the entry is a perfectly valid operations signal that
// nobody can trace back to a card, a filer or a decision.
test('a log entry that lost its intake block is refused', () => {
  const { entry } = run();
  const { intake: _dropped, ...stripped } = entry;
  assert.ok(has(verifyEntryTraceability(stripped), /OS-R07.*no `intake` block/));
  for (const field of ['filed_digest', 'filed_by', 'filed_at', 'surface_ref', 'adjudicated_by', 'adjudicated_at']) {
    const partial = { ...entry, intake: { ...entry.intake, [field]: undefined } };
    assert.ok(has(verifyEntryTraceability(partial), new RegExp(`OS-R07.*carries no ${field}`)), field);
  }
  const noList = { ...entry, intake: { ...entry.intake, reclassified: undefined } };
  assert.ok(has(verifyEntryTraceability(noList), /OS-R07.*`reclassified` is not an array/),
    'absent must never read as "the rating was unchanged"');
});

test('a signal filed with no filer, card reference, source or instant cannot be followed back', () => {
  for (const [field, re] of [['filed_by', /no filer/], ['surface_ref', /no surface_ref/], ['source', /no source/], ['filed_at', /filed_at is missing/], ['id', /carries no id/]]) {
    const broken = { ...FILED };
    delete broken[field];
    assert.ok(has(intake({ filed: broken }).findings, re), field);
  }
  assert.ok(has(intake({}).findings, /OS-R07.*no filed signal/));
});

// NEGATIVE — the edited card. `filed_digest` exists precisely so that editing the claim after triage
// is detectable; without the re-derivation the record simply carries a stale hash nobody checks.
test('a filed claim edited after the fact no longer matches the digest that fixed it', () => {
  const { record } = run();
  const tampered = { ...record, filed: { ...record.filed, summary: 'Minor blip, nothing to see.' } };
  assert.ok(has(verifyIntake(tampered), /OS-R07.*filed_digest does not match the claim/));
  assert.equal(filedDigest(filedClaim(FILED)), record.filed_digest);
  assert.notEqual(filedDigest(filedClaim(filed({ severity: 'low' }))), record.filed_digest);
});

// NEGATIVE — hiding a downgrade by rewriting the list that describes it.
test('a reclassified list that does not describe the actual re-rating is refused', () => {
  const { record } = run(filed({ severity: 'critical' }), adj({ severity: 'low' }));
  const hidden = { ...record, reclassified: [] };
  assert.ok(has(verifyIntake(hidden), /OS-R07.*`reclassified` does not describe the difference/));
  const invented = { ...run().record, reclassified: [{ field: 'type', filed: 'cve', adjudicated: 'incident' }] };
  assert.ok(has(verifyIntake(invented), /OS-R07.*`reclassified` does not describe the difference/));
});

test('signal_id and the filed claim must be about the same signal', () => {
  const { record } = run();
  assert.ok(has(verifyIntake({ ...record, signal_id: 'OPS-9999' }), /OS-R07.*does not match the filed id/));
});

// --- personal data, in the one direction the content ceiling cannot see ---------------------------

// NEGATIVE — the whole reason this scan is here. floor-project's ceiling governs git → floor; this
// is floor → git, where a human types prose about a customer and a merge makes it permanent.
test('a personal-data shape in floor-authored free text refuses the intake', () => {
  const f = run(filed({ summary: 'Customer 784-1990-1234567-1 called three times about the fee.' }));
  assert.ok(has(f.findings, /OS-R08.*national-identifier-shaped string/));
  assert.equal(f.record, null, 'nothing is proposed — a merge cannot be recalled');
  const j = run(FILED, adj({ route: 'accepted', link: undefined, justification: 'Spoke to noor@bank.example.ae; transient, inside the error budget.' }));
  assert.ok(has(j.findings, /OS-R08.*email address/), 'the adjudicator\'s justification is free text too');
});

test('a synthetic marker is reported, never suppressed — and no hit is not a clearance', () => {
  const { record, notices } = run(filed({ summary: 'Fixture customer 999-1990-1234567-1 in the replay.' }));
  assert.ok(record, 'this repository\'s synthetic convention does not refuse');
  assert.ok(notices.some((n) => /synthetic marker/.test(n) && /never certifies text as clean/.test(n)),
    'the disclaimer travels with the notice, because the notice is where somebody would read a pass');
  // The shape-matcher cannot see this at all, and the module must not imply otherwise.
  assert.deepEqual(run(filed({ summary: 'She rang again about her husband\'s overdraft; she is the only teacher in that branch\'s segment.' })).findings, []);
});

// --- non-authoritative, and attributed --------------------------------------------------------------

test('the record and the proposal both carry the label, verbatim', () => {
  const { record } = run();
  const { proposal } = roundTrip(null, [record]);
  for (const [what, obj] of [['record', record], ['proposal', proposal]]) {
    assert.equal(obj.schema, SCHEMA_ID, what);
    assert.equal(obj.authority, 'none', what);
    assert.equal(obj.banner, NON_AUTHORITATIVE, what);
    assert.equal(obj.write_class, WRITE_CLASS, what);
  }
  assert.equal(WRITE_CLASS, 'decision-routed');
});

// NEGATIVE — a record that lost its label. Without OS-R10 it is indistinguishable from a finding.
test('an unlabelled intake record, or one wearing governance authority, is refused', () => {
  const { record } = run();
  for (const strip of ['schema', 'authority', 'banner', 'write_class']) {
    const broken = { ...record };
    delete broken[strip];
    assert.ok(has(verifyIntake(broken), /^OS-R10/m), `stripping ${strip} must be a finding`);
  }
  assert.ok(has(verifyIntake({ ...record, banner: 'Triage queue.' }), /OS-R10.*banner is missing or altered/));
  assert.ok(has(verifyIntake({ ...record, approved_by: 'risk-lena' }), /OS-R10.*would read as governance authority/),
    'a triage card that mirrors an approval is indistinguishable from one on a screen');
  assert.ok(has(verifyEntryTraceability({ ...run().entry, attestation: 'sig:MEUCIQ…' }), /OS-R10.*would read as governance authority/));
  assert.ok(has(verifyIntake(null), /OS-R10.*not an object/));
});

test('only the bridge transcribes', () => {
  assert.equal(TRANSCRIBER_IDENTITY, 'svc-floor-bridge');
  assert.ok(has(run(FILED, ADJ, { transcribedBy: 'ops-dana' }).findings, /OS-R11.*not svc-floor-bridge/));
  const { record } = run();
  assert.ok(has(verifyIntake({ ...record, transcribed_by: 'agent-loom-delivery' }), /OS-R11/));
  assert.ok(has(roundTrip(null, [], { transcribedBy: 'svc-floor-freezer' }).findings, /OS-R11/));
});

// --- the log, and the gate that owns it -----------------------------------------------------------

// NEGATIVE — the silent overwrite. Without OS-R04 a re-filed card with a different route replaces
// the decision triage already made, and the diff looks like an ordinary update.
test('a signal id already in the log with different content is refused, never overwritten', () => {
  const first = roundTrip({ signals: [] }, [run().record]);
  const rerouted = run(FILED, adj({ route: 'accepted', link: undefined, justification: 'Decided later that no change is needed.' })).record;
  const second = roundTrip(first.proposal.log, [rerouted]);
  assert.equal(second.proposal, null);
  assert.ok(has(second.findings, /OS-R04.*already in the log with different content/));
  assert.equal(first.proposal.log.signals[0].route, 'spec-fix', 'what triage decided is still there');
});

// NEGATIVE — the traceability rules per route belong to the gate. If this module re-implemented
// them, these would pass here and fail in CI.
test('an entry the gate would reject is refused here, by calling the gate', () => {
  const noLink = run(FILED, { ...adj(), link: undefined });
  assert.ok(has(noLink.findings, /OS-R09.*routed to spec-fix but links no PR/));
  const badRegister = run(FILED, adj({ route: 'register', link: 'PR-482' }));
  assert.ok(has(badRegister.findings, /OS-R09.*does not cite a DR-\* risk/));
  const acceptedNoWhy = run(FILED, adj({ route: 'accepted', link: undefined }));
  assert.ok(has(acceptedNoWhy.findings, /OS-R09.*accepted \(no action\) needs a justification/));
  const noEvidence = run({ ...filed({ severity: 'critical' }), evidence_ref: undefined }, adj({ severity: 'critical' }));
  assert.ok(has(noEvidence.findings, /OS-R09.*critical signal needs an evidence_ref/));
  // …and the route that resolves.
  assert.deepEqual(run(FILED, adj({ route: 'register', link: 'DR-1.1-001' })).findings, []);
  assert.deepEqual(run(FILED, adj({ route: 'discovery', link: undefined, status: 'triaging' })).findings, []);
});

test('the gate\'s post-launch rule reaches the round trip too', () => {
  const { proposal, findings } = roundTrip({ signals: [] }, [], { inProduction: true });
  assert.equal(proposal, null);
  assert.ok(has(findings, /OS-R09.*operations log is EMPTY while a governed change is in production/));
});

test('a malformed existing log is reported rather than appended to', () => {
  assert.ok(has(roundTrip({ signals: 'none' }, []).findings, /OS-R09.*has no `signals` array/));
});

// --- shape hygiene --------------------------------------------------------------------------------

test('filedClaim drops surface noise and keeps a canonical shape', () => {
  const claim = filedClaim({ ...FILED, assignee: 'someone', emoji: '🔥', last_edited_by: 'bot' });
  assert.deepEqual(Object.keys(claim).sort(), ['evidence_ref', 'filed_at', 'filed_by', 'id', 'severity', 'source', 'summary', 'surface_ref', 'type']);
  assert.equal(filedDigest(claim), filedDigest(filedClaim(FILED)), 'noise must not move the digest');
  assert.throws(() => { claim.severity = 'low'; }, TypeError, 'the claim is frozen');
});

test('the log entry is exactly the gate\'s fields plus ONE named provenance block', () => {
  const { entry } = run();
  assert.deepEqual(Object.keys(entry).sort(), ['detected', 'evidence_ref', 'id', 'intake', 'link', 'regulator_notification', 'route', 'severity', 'source', 'summary', 'type']);
  assert.equal(entry.detected, '2026-07-20', 'detected is the day it was FILED — triage does not get to move it');
});

// --- the contract is documented, and the documentation is checked ----------------------------------

test('every rejection code the module can emit is documented, and every documented code is reachable', () => {
  const source = readFileSync(new URL('./floor-ops-signal.mjs', import.meta.url), 'utf8');
  const used = new Set(source.match(/OS-R\d+/g) || []);
  for (const code of used) assert.ok(REJECTIONS.has(code), `${code} is emitted but not documented in REJECTIONS`);
  for (const code of REJECTIONS.keys()) {
    const occurrences = (source.match(new RegExp(code, 'g')) || []).length;
    assert.ok(occurrences >= 2, `${code} is documented but never emitted (${occurrences} occurrence)`);
    assert.ok(REJECTIONS.get(code).length > 20, `${code} needs a reason, not a label`);
  }
  assert.equal(used.size, REJECTIONS.size);
});
