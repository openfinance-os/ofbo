// Tests for the change-envelope gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGE_CLASSES, EMERGENCY_RETROSPECTIVE_MAX_DAYS, EMERGENCY_STATE, PIR_MAX_DAYS, UAT_STATE, checkPostImplementationReview, checkRequiredInstitutions, checkStateHistory, checkUatSignoff, corroborateFlags, evaluate, loadInstitutionProfiles, STATES, stateHistoryRequired } from './change-envelope-check.mjs';
import { collectPatterns } from '../core/change-patterns.mjs';
import { compile, resolveBindings, resolveProfileContext } from '../core/policy-compiler.mjs';

import { existsSync } from 'node:fs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Fixtures resolve in BOTH layouts: the bundle (change-example/, governance/) and an
// adopted repo (docs/governance/changes/CHG-2026-0042/, docs/governance/).
const J = (...candidates) => {
  const p = candidates.map((c) => `${HARNESS}/${c}`).find(existsSync);
  if (!p) throw new Error(`fixture not found: ${candidates.join(' | ')}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};
const EX = (f) => J(`change-example/${f}`, `docs/governance/changes/CHG-2026-0042/${f}`);
// In a BARE adoption the worked-example change is in neither layout; skip cleanly rather than
// throw at module load. The pure evaluate() logic still runs wherever the example is mounted.
const EXAMPLE_PRESENT = ['change-example/control-plan.json', 'docs/governance/changes/CHG-2026-0042/control-plan.json']
  .some((c) => existsSync(`${HARNESS}/${c}`));
if (!EXAMPLE_PRESENT) {
  test('change-envelope gate (worked-example change is bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const ENVELOPE = EX('change-envelope.json');
const PLAN = EX('control-plan.json');
const PASSPORT = EX('product-passport.json');
const REGISTRY = J('governance/identities.template.json', 'docs/governance/identities.json');
// 2.4: a fresh compile must resolve automatic profiles as production does. Building this fixture
// from the explicit list would silently test the old classifier-remembers-the-route behaviour.
const fresh = (env = ENVELOPE) => {
  const context = resolveProfileContext(env, HARNESS);
  return compile(context.envelope, context.profiles, context.bindings).plan;
};

const ok = (over = {}, ctx = {}) => evaluate({ ...ENVELOPE, ...over }, {
  plan: PLAN, passport: PASSPORT, architectureExists: true, registry: REGISTRY, freshPlan: fresh(), ...ctx,
});

// rc.37 — moving a change's state means RECORDING the transition: the history's last entry is
// current_state, so a test that advances the state advances the record with it (exactly what an
// envelope author now has to do).
const advance = (state, at = '2026-07-30T10:00:00Z', by = 'po-fatima') => ({
  current_state: state,
  state_history: [...ENVELOPE.state_history, { state, at, by }],
});

test('the shipped worked example passes end to end', () => {
  assert.deepEqual(ok(), []);
});

test('TERMINAL — a closed change is valid without plan reconciliation or receipts, but keeps its classifier (rc.34)', () => {
  // A closed change's profiles may have moved on; it must not go red because a profile did,
  // and it must not demand PA receipts for work it abandoned. It contributes nothing to the
  // compiled-requirements aggregate (asserted in core/compiled-requirements.test.mjs).
  const closed = evaluate({ ...ENVELOPE, ...advance('closed') }, { plan: null, freshPlan: null, passport: null, architectureExists: false });
  assert.deepEqual(closed, [], `a closed change must not be re-litigated:\n${closed.join('\n')}`);
  const superseded = evaluate({ ...ENVELOPE, ...advance('superseded') }, {});
  assert.deepEqual(superseded, []);
  // The record of who judged it survives its closure.
  const anonymous = evaluate({ ...ENVELOPE, ...advance('closed'), classification: {} }, {});
  assert.equal(anonymous.length, 1);
  assert.match(anonymous[0], /classified_by/);
});

test('RECONCILIATION — a hand-edited plan fails even when it keeps its old hash', () => {
  // PA1 edited out, plan_hash left untouched: content no longer matches its own hash.
  const doctored = { ...PLAN, required_gates: PLAN.required_gates.filter((g) => g !== 'PA1') };
  const f = ok({}, { plan: doctored });
  assert.ok(f.some((x) => /does not match its own plan_hash/.test(x)));
});

test('RECONCILIATION — a stale stored plan (hash differs from fresh compile) fails', () => {
  const f = evaluate({ ...ENVELOPE, flags: { ...ENVELOPE.flags, islamic: true } }, {
    plan: PLAN, passport: PASSPORT, architectureExists: true, registry: REGISTRY,
    freshPlan: fresh({ ...ENVELOPE, flags: { ...ENVELOPE.flags, islamic: true } }),
  });
  assert.ok(f.some((x) => /does not reconcile with a fresh compile/.test(x)));
});

test('EXIT CRITERION — a high-risk change cannot be past permission-to-develop without PA1', () => {
  const noPa1 = { ...PASSPORT, pa1: { decision: 'pending' } };
  const f = ok({}, { passport: noPa1 });
  assert.ok(f.some((x) => /requires PA1 approved/.test(x)));
});

test('permission-to-launch without PA2 fails', () => {
  const f = ok({ current_state: 'permission-to-launch' });
  assert.ok(f.some((x) => /requires PA2 approved/.test(x)));
});

test('in-delivery without architecture assurance fails when the plan requires A', () => {
  const f = ok({}, { architectureExists: false });
  assert.ok(f.some((x) => /architecture-assurance\.json is missing/.test(x)));
});

test('an AGENT cannot be the classifier; nor can a role-less human', () => {
  const agent = ok({ classification: { ...ENVELOPE.classification, classified_by: 'agent-loom-delivery' } });
  assert.ok(agent.some((x) => /is an AGENT — the agent cannot set or lower the risk tier/.test(x)));
  const engineer = ok({ classification: { ...ENVELOPE.classification, classified_by: 'eng-omar' } });
  assert.ok(engineer.some((x) => /holds none of the classification roles/.test(x)));
});

/* ---- 1.12: compound production authorization ---- */

// This gate sequences on pa2.decision; the full approval/section validation is the
// product-approval gate's job (tested there).
const PA2_OK = { ...PASSPORT, pa2: { decision: 'approved' } };
const READY = { missing: [], findings: [] };
const HOLD_RELEASED = { change_id: 'CHG-2026-0042', status: 'released', by: 'risk-lena', at: '2026-07-21' };
const EVIDENCE_OK = { anchor: 'abc123', attestationFindings: [] };
// 2.1.0 (4.1) — the business accepted the exact commit the release subject names.
const SHA = '7e3f9c2a4b6d8e0f1a2c3b4d5e6f7a8b9c0d1e2f';
const UAT_OK = { change_id: 'CHG-2026-0042', status: 'accepted', by: 'po-fatima', at: '2026-07-28T09:00:00Z', release_commit: SHA, scope: 'limit-review journeys A–C against the PRD acceptance criteria' };
const SUBJECT = { source: { commit: SHA } };
const prod = (ctx = {}) => ok(advance('production-authorized'), {
  passport: PA2_OK, readiness: READY, hold: HOLD_RELEASED, evidence: EVIDENCE_OK, uat: UAT_OK, releaseSubject: SUBJECT, ...ctx,
});

/* ---- 2.1.0 (hardening plan 4.1): UAT acceptance ---- */

test('UAT — the state sits between delivery-complete and permission-to-launch', () => {
  assert.equal(STATES[STATES.indexOf('delivery-complete') + 1], UAT_STATE);
  assert.equal(STATES[STATES.indexOf(UAT_STATE) + 1], 'permission-to-launch');
});

test('UAT — from uat-accepted onward the acceptance is a receipt: missing, pending, or unbound fails', () => {
  assert.ok(ok(advance(UAT_STATE)).some((x) => /uat-signoff.json is missing/.test(x)));
  assert.ok(ok(advance('permission-to-launch'), { uat: { ...UAT_OK, status: 'pending' } }).some((x) => /status is "pending", not "accepted"/.test(x)));
  assert.ok(ok(advance(UAT_STATE), { uat: { ...UAT_OK, release_commit: 'main' } }).some((x) => /not a 40-hex commit sha/.test(x)));
  const { scope: _s, ...noScope } = UAT_OK;
  assert.ok(ok(advance(UAT_STATE), { uat: noScope }).some((x) => /has no scope/.test(x)));
  // before the state it is not owed
  assert.ok(!ok(advance('delivery-complete')).some((x) => /UAT/.test(x)));
});

test('UAT — the business accepts: not a builder, not an agent, and a holder of a business role', () => {
  assert.ok(checkUatSignoff({ ...ENVELOPE, current_state: UAT_STATE }, { ...UAT_OK, by: 'eng-omar' }, { registry: REGISTRY }).some((x) => /in the builders group/.test(x)));
  assert.ok(checkUatSignoff({ ...ENVELOPE, current_state: UAT_STATE }, { ...UAT_OK, by: 'agent-loom-delivery' }, { registry: REGISTRY }).some((x) => /is an AGENT/.test(x)));
  assert.ok(checkUatSignoff({ ...ENVELOPE, current_state: UAT_STATE }, { ...UAT_OK, by: 'risk-lena' }, { registry: REGISTRY }).some((x) => /holds none of the business roles/.test(x)));
  assert.deepEqual(checkUatSignoff({ ...ENVELOPE, current_state: UAT_STATE }, UAT_OK, { registry: REGISTRY }), []);
});

test('UAT — at production authorization the accepted commit must be the release subject\'s', () => {
  assert.deepEqual(prod(), []);
  const other = prod({ releaseSubject: { source: { commit: 'a'.repeat(40) } } });
  assert.ok(other.some((x) => /what the business accepted is not what is being released/.test(x)));
  // before production authorization the subject is not yet bound
  assert.ok(!ok(advance(UAT_STATE), { uat: UAT_OK, releaseSubject: { source: { commit: 'a'.repeat(40) } } }).some((x) => /not what is being released/.test(x)));
});

/* ---- 2.1.0 (hardening plan 4.5): post-implementation review ---- */

const LIVE_AT = '2026-08-10T08:00:00Z';
const live = (pir, ctx = {}) => evaluate({ ...ENVELOPE, ...advance('in-production', LIVE_AT, 'ops-dana'), post_implementation_review: pir }, {
  plan: PLAN, passport: PA2_OK, architectureExists: true, registry: REGISTRY, freshPlan: fresh(), readiness: READY, hold: HOLD_RELEASED, evidence: EVIDENCE_OK, uat: UAT_OK, releaseSubject: SUBJECT, now: Date.parse('2026-08-20T00:00:00Z'), ...ctx,
});
const PIR_OK = { due: '2026-09-09T08:00:00Z' };

test('PIR — a change in production carries a review date; an open one is a NOTICE, a missing one a finding', () => {
  const notices = [];
  assert.deepEqual(live(PIR_OK, { notices }), []);
  assert.ok(notices.some((n) => /post-implementation review due by 2026-09-09/.test(n)));
  assert.ok(live(undefined).some((x) => /requires a post_implementation_review block/.test(x)));
  assert.ok(live({ due: 'soon' }).some((x) => /not a parseable ISO-8601 timestamp/.test(x)));
});

test('PIR — the MOMENT the due date passes with no completed review, it is a finding', () => {
  assert.ok(live(PIR_OK, { now: Date.parse('2026-09-10T00:00:00Z') }).some((x) => /has PASSED with no completed review/.test(x)));
});

test('PIR — a completed review names a second-line human, an outcome and evidence; late completion is noticed, not blocked', () => {
  const done = { ...PIR_OK, completed_at: '2026-09-01T00:00:00Z', reviewed_by: 'risk-lena', outcome: 'as-expected', evidence_ref: 'reviews/CHG-2026-0042-pir.md' };
  assert.deepEqual(live(done), []);
  assert.ok(live({ ...done, reviewed_by: 'eng-omar' }).some((x) => /not a second-line HUMAN/.test(x)));
  assert.ok(live({ ...done, evidence_ref: undefined }).some((x) => /has no evidence_ref/.test(x)));
  const notices = [];
  assert.deepEqual(live({ ...done, completed_at: '2026-09-12T00:00:00Z' }, { notices, now: Date.parse('2026-09-13T00:00:00Z') }), []);
  assert.ok(notices.some((n) => /completed 3 day\(s\) after its due date/.test(n)));
});

test('PIR — the due date is bounded from the moment the change went live', () => {
  const far = new Date(Date.parse(LIVE_AT) + (PIR_MAX_DAYS + 1) * 86400000).toISOString();
  assert.ok(live({ due: far }).some((x) => `${x}`.includes(`the ceiling is ${PIR_MAX_DAYS}`)));
  assert.ok(live({ due: '2026-08-01T00:00:00Z' }).some((x) => /does not follow the in-production transition/.test(x)));
  assert.ok(checkPostImplementationReview({ ...ENVELOPE, current_state: 'in-production' }, { now: 0 }).some((x) => /requires a post_implementation_review block/.test(x)));
});

/* ---- 2.1.0 (hardening plan 4.6): the threat model at medium ---- */

test('THREAT MODEL — a plan that compiles threat_model without the A gate still owes architecture-assurance.json in delivery', () => {
  const medium = { ...PLAN, required_gates: PLAN.required_gates.filter((g) => g !== 'A'), required_capabilities: { ...(PLAN.required_capabilities || {}), threat_model: { required: true } } };
  const f = evaluate(ENVELOPE, { plan: medium, freshPlan: medium, passport: PASSPORT, architectureExists: false, registry: REGISTRY });
  assert.ok(f.some((x) => /requires a threat model \(A2\)/.test(x)), f.join('\n'));
  const withA2 = evaluate(ENVELOPE, { plan: medium, freshPlan: medium, passport: PASSPORT, architectureExists: true, registry: REGISTRY });
  assert.ok(!withA2.some((x) => /threat model/.test(x)));
});

test('the full compound authorization passes: PA2 + readiness + hold released + anchored evidence', () => {
  assert.deepEqual(prod(), []);
});

test('FAIL CLOSED — a missing release hold means held', () => {
  assert.ok(prod({ hold: null }).some((x) => /missing hold means HELD/.test(x)));
});

test('a held release blocks; a hold released by a builder or an agent does not count', () => {
  assert.ok(prod({ hold: { ...HOLD_RELEASED, status: 'held' } }).some((x) => /release hold is "held"/.test(x)));
  assert.ok(prod({ hold: { ...HOLD_RELEASED, by: 'eng-omar' } }).some((x) => /only by a second-line HUMAN/.test(x)));
  assert.ok(prod({ hold: { ...HOLD_RELEASED, by: 'agent-loom-delivery' } }).some((x) => /only by a second-line HUMAN/.test(x)));
});

test('a high-tier authorization requires anchored, issuer-verified evidence', () => {
  assert.ok(prod({ evidence: { anchor: null } }).some((x) => /no anchor/.test(x)));
  const badSig = prod({ evidence: { anchor: 'abc', attestationFindings: ['attestation signature does NOT verify'] } });
  assert.ok(badSig.some((x) => /does NOT verify/.test(x)));
});

test('unready services block: missing readiness file or R-gate findings', () => {
  assert.ok(prod({ readiness: { missing: ['credit-origination'], findings: [] } })
    .some((x) => /requires operational readiness for service credit-origination/.test(x)));
  assert.ok(prod({ readiness: { missing: [], findings: ['credit-origination: kill-switch test: STALE'] } })
    .some((x) => /kill-switch test: STALE/.test(x)));
});

test('an exemption must be owned, reasoned, compensated, expiring, and second-line approved', () => {
  const bare = ok({ exemptions: [{ control: 'Q2-SAST' }] });
  for (const field of ['owner', 'rationale', 'compensating_control', 'expires', 'approved_by']) {
    assert.ok(bare.some((x) => new RegExp(`missing ${field}`).test(x)), `expected missing ${field}`);
  }
  const expired = ok({ exemptions: [{ control: 'Q2-SAST', owner: 'po-fatima', rationale: 'r', compensating_control: 'c', expires: '2020-01-01', approved_by: 'risk-lena' }] });
  assert.ok(expired.some((x) => /EXPIRED/.test(x)));
  const builderApproved = ok({ exemptions: [{ control: 'Q2-SAST', owner: 'po-fatima', rationale: 'r', compensating_control: 'c', expires: '2999-01-01', approved_by: 'eng-omar' }] });
  assert.ok(builderApproved.some((x) => /not a second-line identity/.test(x)));
});

test('an unknown state is rejected; the state enum matches the plan', () => {
  assert.ok(ok({ current_state: 'shipped' }).some((x) => /current_state must be one of/.test(x)));
  assert.equal(STATES[0], 'classified');
  assert.equal(STATES[STATES.length - 1], 'in-production');
});

/* ---- rc.37 · flow-plan Phase 3.1: state_history, the append-only transition record ---- */

const H = ENVELOPE.state_history;

test('STATE-HISTORY — the shipped worked example carries a well-formed history', () => {
  assert.ok(Array.isArray(H) && H.length >= 3, 'the worked example must demonstrate the field');
  assert.deepEqual(checkStateHistory(ENVELOPE, { registry: REGISTRY }), []);
  assert.equal(H[H.length - 1].state, ENVELOPE.current_state);
});

test('STATE-HISTORY — it must advance in the STATES order; a backwards or repeated state fails', () => {
  const back = checkStateHistory({ ...ENVELOPE, ...advance('classified') }, {});
  assert.ok(back.some((x) => /does not advance the lifecycle/.test(x)), back.join('\n'));
  const repeat = checkStateHistory({ ...ENVELOPE, ...advance('in-delivery') }, {});
  assert.ok(repeat.some((x) => /does not advance the lifecycle/.test(x)));
});

test('STATE-HISTORY — APPEND-ONLY: a timestamp earlier than its predecessor fails', () => {
  const f = checkStateHistory({ ...ENVELOPE, ...advance('delivery-complete', '2026-07-19T00:00:00Z') }, {});
  assert.ok(f.some((x) => /APPEND-ONLY/.test(x)), f.join('\n'));
});

test('STATE-HISTORY — nothing follows a terminal state; closure is not a pause', () => {
  const resumed = {
    current_state: 'in-production',
    state_history: [...H, { state: 'closed', at: '2026-08-01T00:00:00Z' }, { state: 'in-production', at: '2026-08-09T00:00:00Z' }],
  };
  const f = checkStateHistory({ ...ENVELOPE, ...resumed }, {});
  assert.ok(f.some((x) => /recorded after the terminal state closed/.test(x)), f.join('\n'));
});

test('STATE-HISTORY — the history may not be a parallel account: the last entry IS current_state', () => {
  const f = checkStateHistory({ ...ENVELOPE, current_state: 'in-production' }, {});
  assert.ok(f.some((x) => /not a parallel account/.test(x)));
});

test('STATE-HISTORY — an undated transition, an unknown state, and an unresolvable actor all fail', () => {
  const undated = checkStateHistory({ ...ENVELOPE, state_history: [{ state: 'classified', at: 'soon' }], current_state: 'classified' }, {});
  assert.ok(undated.some((x) => /is not an ISO-8601 timestamp/.test(x)));
  const unknown = checkStateHistory({ ...ENVELOPE, state_history: [{ state: 'vibing', at: '2026-07-18T00:00:00Z' }], current_state: 'in-delivery' }, {});
  assert.ok(unknown.some((x) => /is not one of/.test(x)));
  const ghost = checkStateHistory({ ...ENVELOPE, state_history: [...H.slice(0, 2), { ...H[2], by: 'nobody-here' }] }, { registry: REGISTRY });
  assert.ok(ghost.some((x) => /is not in the identity registry/.test(x)), ghost.join('\n'));
});

test('STATE-HISTORY — it must begin where every governed change begins', () => {
  const f = checkStateHistory({ ...ENVELOPE, state_history: H.slice(1) }, {});
  assert.ok(f.some((x) => /begins at "permission-to-develop"/.test(x)), f.join('\n'));
});

test('STATE-HISTORY — REQUIRED at high/critical from the cutover, OPTIONAL before it (no retroactive red)', () => {
  const { state_history, ...noHistory } = ENVELOPE;
  // Classified before the cutover: grandfathered — a NOTICE, never a finding.
  const notices = [];
  assert.deepEqual(checkStateHistory(noHistory, { notices }), []);
  assert.ok(notices.some((n) => /grandfathered/.test(n)), 'a grandfathered high-tier change must be said out loud');
  assert.equal(stateHistoryRequired(noHistory), false);
  // Classified on or after it: required.
  const fresh = { ...noHistory, classification: { ...ENVELOPE.classification, classified_at: '2026-08-01' } };
  assert.equal(stateHistoryRequired(fresh), true);
  assert.ok(checkStateHistory(fresh, {}).some((x) => /requires state_history/.test(x)));
  // A low-tier change is never required to carry one, whenever it was classified.
  assert.equal(stateHistoryRequired({ ...fresh, risk_tier: 'low' }), false);
  assert.deepEqual(checkStateHistory({ ...fresh, risk_tier: 'low' }, {}), []);
  // An unparseable classification date fails toward MORE control, not less.
  assert.equal(stateHistoryRequired({ ...noHistory, classification: {} }), true);
});

// --- change classes (rc.38 · flow-plan Phase 4.2) ---------------------------------------------

const NOW = Date.parse('2026-08-05T00:00:00Z');
const HELD_CTX = { plan: PLAN, passport: PASSPORT, architectureExists: true, registry: REGISTRY, freshPlan: fresh() };
// production-authorized with NOTHING released: the full compound authorization is outstanding.
const PROD = { ...advance('production-authorized', '2026-08-01T10:00:00Z', 'risk-lena') };
const EMERGENCY = (em, over = {}) => ({
  ...ENVELOPE,
  change_class: 'emergency',
  current_state: EMERGENCY_STATE,
  state_history: [...ENVELOPE.state_history, { state: EMERGENCY_STATE, at: '2026-08-01T10:00:00Z', by: 'risk-lena' }],
  emergency: em,
  ...over,
});
const EM_OK = {
  authorized_by: 'risk-lena',
  authorized_at: '2026-08-01T10:00:00Z',
  rationale: 'Live incident: the affordability service is rejecting every application; the fix is the model pin rollback.',
  retrospective_deadline: '2026-08-08T10:00:00Z',
};

test('change_class defaults to normal, and an unknown class is a finding rather than a fallback', () => {
  assert.deepEqual(ok(), []);                       // no change_class on the shipped example
  assert.deepEqual(ok({ change_class: 'normal' }), []);
  assert.ok(ok({ change_class: 'emergancy' }).some((f) => new RegExp(`change_class must be one of ${CHANGE_CLASSES.join('\\\\|')}`).test(f)));
});

test('the emergency STATE is reachable only by a declared emergency change', () => {
  const f = evaluate({ ...ENVELOPE, current_state: EMERGENCY_STATE, state_history: [...ENVELOPE.state_history, { state: EMERGENCY_STATE, at: '2026-08-01T10:00:00Z', by: 'risk-lena' }] }, HELD_CTX);
  assert.ok(f.some((x) => /reachable only by a change classified change_class "emergency"/.test(x)));
});

test('normal production authorization with nothing released still FAILS — the baseline is unmoved', () => {
  assert.ok(evaluate({ ...ENVELOPE, ...PROD }, HELD_CTX).some((f) => /no release-hold.json/.test(f)));
});

test('an emergency BEFORE its deadline defers the receipts and lists every one of them', () => {
  const notices = [];
  const findings = evaluate(EMERGENCY(EM_OK), { ...HELD_CTX, notices, now: NOW });
  assert.deepEqual(findings, []);
  const n = notices.find((x) => /EMERGENCY —/.test(x));
  assert.ok(n, `expected the outstanding receipts to be reported: ${JSON.stringify(notices)}`);
  assert.ok(/no release-hold.json/.test(n), 'the deferred receipt must be NAMED, not counted');
  assert.ok(/due by 2026-08-08T10:00:00Z/.test(n));
});

test('the MOMENT the deadline passes with receipts owed, every one of them fires', () => {
  const past = Date.parse('2026-08-09T00:00:00Z');
  const findings = evaluate(EMERGENCY(EM_OK), { ...HELD_CTX, now: past });
  assert.ok(findings.some((f) => /retrospective deadline .* has PASSED with \d+ receipt\(s\) still outstanding/.test(f)));
  assert.ok(findings.some((f) => /no release-hold.json/.test(f)), 'the deferral is over, so the receipts themselves are findings again');
});

test('an emergency with NO block defers nothing — a clock is what makes it not a waiver', () => {
  const findings = evaluate(EMERGENCY(undefined), { ...HELD_CTX, now: NOW });
  assert.ok(findings.some((f) => /requires an `emergency` block/.test(f)));
  assert.ok(findings.some((f) => /no release-hold.json/.test(f)));
});

test('an unreadable deadline defers nothing either', () => {
  const findings = evaluate(EMERGENCY({ ...EM_OK, retrospective_deadline: 'soon' }), { ...HELD_CTX, now: NOW });
  assert.ok(findings.some((f) => /is not a parseable ISO-8601 timestamp/.test(f)));
  assert.ok(findings.some((f) => /no release-hold.json/.test(f)));
});

test('a deadline beyond the ceiling is a waiver spelled as a deadline', () => {
  const far = new Date(Date.parse(EM_OK.authorized_at) + (EMERGENCY_RETROSPECTIVE_MAX_DAYS + 1) * 86400000).toISOString();
  assert.ok(evaluate(EMERGENCY({ ...EM_OK, retrospective_deadline: far }), { ...HELD_CTX, now: NOW })
    .some((f) => `${f}`.includes(`the ceiling is ${EMERGENCY_RETROSPECTIVE_MAX_DAYS}`)));
});

test('only a second-line HUMAN authorises an emergency — the release hold’s own rule', () => {
  for (const who of ['eng-omar', 'agent-loom-delivery', 'po-fatima']) {
    assert.ok(evaluate(EMERGENCY({ ...EM_OK, authorized_by: who }), { ...HELD_CTX, now: NOW })
      .some((f) => /is not a second-line HUMAN identity/.test(f)), who);
  }
});

// --- pre-approved patterns, wired through the gate (rc.38 · Phase 4.3) ------------------------

test('a standard change with no pattern_id is just a normal change, and is told so', () => {
  assert.ok(ok({ change_class: 'standard' }).some((f) => /requires pattern_claim.pattern_id/.test(f)));
});

test('a pattern_claim on a non-standard change is a claim nobody checks', () => {
  assert.ok(ok({ pattern_claim: { pattern_id: 'x' } }).some((f) => /only change_class "standard" rides a pattern/.test(f)));
});

// The pattern example is a SECOND worked change (CHG-2026-0055), and like the first it is bundle
// demonstration data the installer does not ship — so in an adopted layout it is absent and this
// fixture test skips. The pure pattern logic above and in core/change-patterns.test.mjs runs in
// both layouts; only the "the shipped example is sound" assertion needs the shipped example.
const PATTERN_EXAMPLE_PRESENT = ['change-pattern-example/change-envelope.json', 'docs/governance/changes/CHG-2026-0055/change-envelope.json']
  .some((c) => existsSync(`${HARNESS}/${c}`));

test('the shipped pattern example rides its pattern, and loses coverage the moment it expires', { skip: PATTERN_EXAMPLE_PRESENT ? false : 'pattern example is bundle-only — absent in an adopted layout' }, () => {
  const env = J('change-pattern-example/change-envelope.json', 'docs/governance/changes/CHG-2026-0055/change-envelope.json');
  const plan = J('change-pattern-example/control-plan.json', 'docs/governance/changes/CHG-2026-0055/control-plan.json');
  const passport = J('change-pattern-example/product-passport.json', 'docs/governance/changes/CHG-2026-0055/product-passport.json');
  const base = J('profiles/regulated-bank.json');
  const ctx = { plan, passport, architectureExists: true, registry: REGISTRY, freshPlan: plan, patterns: collectPatterns([base]).patterns, notices: [] };
  assert.deepEqual(evaluate(env, ctx), []);
  assert.ok(ctx.notices.some((n) => /rides PRE-APPROVED pattern/.test(n)));

  // Expire the pattern: coverage drops and the change owes PA1 in full — the FULL route.
  const expired = structuredClone(base);
  expired.patterns[0].expires = '2026-01-01';
  const after = evaluate(env, { ...ctx, patterns: collectPatterns([expired]).patterns, notices: [] });
  assert.ok(after.some((f) => /EXPIRED/.test(f)));
  assert.ok(after.some((f) => /requires PA1 approved/.test(f)), 'a lapsed pre-approval means the change owes its approvals again');
});

test('THREAT MODEL — the shipped pattern example (medium, standard) owes no per-instance model while its claim holds, and owes one the moment it does not', { skip: PATTERN_EXAMPLE_PRESENT ? false : 'pattern example absent' }, () => {
  const env = J('change-pattern-example/change-envelope.json', 'docs/governance/changes/CHG-2026-0055/change-envelope.json');
  const plan = J('change-pattern-example/control-plan.json', 'docs/governance/changes/CHG-2026-0055/control-plan.json');
  const passport = J('change-pattern-example/product-passport.json', 'docs/governance/changes/CHG-2026-0055/product-passport.json');
  const profiles = [J('profiles/regulated-bank.json')];
  const bindings = resolveBindings(env.required_profiles, HARNESS).bindings;
  const freshPlan = compile(env, profiles, bindings).plan;
  const { patterns } = collectPatterns(profiles);
  const ctx = { plan, freshPlan, passport, architectureExists: false, registry: REGISTRY, patterns, now: Date.parse('2026-08-01T00:00:00Z'), diff: { paths: env.pattern_claim.changed_paths, lines: env.pattern_claim.diff_lines } };
  assert.ok(plan.required_capabilities?.threat_model?.required, 'the medium plan compiles threat_model');
  assert.ok(!evaluate(env, ctx).some((x) => /threat model/.test(x)), 'covered: the pattern carried the model');
  const off = evaluate(env, { ...ctx, diff: { paths: ['src/auth/login.mjs'], lines: 12 } });
  assert.ok(off.some((x) => /requires a threat model \(A2\)/.test(x)), `uncovered: the instance owes it:\n${off.join('\n')}`);
});

// --- flag corroboration (rc.38 · Phase 4.7) ---------------------------------------------------

const LIFECYCLE = { categories: [{ category: 'customer_contact_details', classification: 'personal' }] };
const MANIFEST = { models: [{ role: 'delivery-loop', model_id: 'x@1' }] };

test('personal_data: false against a register that classifies personal data is a finding', () => {
  const env = { ...ENVELOPE, flags: { ...ENVELOPE.flags, personal_data: false } };
  assert.ok(corroborateFlags(env, { dataLifecycle: LIFECYCLE }).some((f) => /classifies 1 category as personal/.test(f)));
  assert.deepEqual(corroborateFlags(ENVELOPE, { dataLifecycle: LIFECYCLE }), []);
});

test('model_involved: false against a non-empty model manifest is a finding', () => {
  const env = { ...ENVELOPE, flags: { ...ENVELOPE.flags, model_involved: false } };
  assert.ok(corroborateFlags(env, { modelManifest: MANIFEST }).some((f) => /declares 1 model/.test(f)));
});

test('third_party: false against a passport naming third parties is a finding', () => {
  const env = { ...ENVELOPE, flags: { ...ENVELOPE.flags, third_party: false } };
  assert.ok(corroborateFlags(env, { passport: PASSPORT }).some((f) => /the analysis and the flag disagree/.test(f)));
});

test('an ABSENT flag is corroborated exactly like a false one — the compiler reads both the same', () => {
  const env = { ...ENVELOPE, flags: {} };
  const f = corroborateFlags(env, { dataLifecycle: LIFECYCLE, modelManifest: MANIFEST, passport: PASSPORT });
  assert.equal(f.length, 3);
});

test('a missing corroborating record is NOT VERIFIED, never a quiet pass', () => {
  const notices = [];
  corroborateFlags({ ...ENVELOPE, flags: {} }, { notices });
  assert.ok(notices.some((n) => /data-lifecycle.json to corroborate it against — NOT VERIFIED/.test(n)));
  assert.ok(notices.some((n) => /model-manifest.json to corroborate it against — NOT VERIFIED/.test(n)));
});

// --- the institution flag-assertion contract --------------------------------------------------
//
// A route-deciding flag that states a fact about the INSTITUTION has no per-change register to
// corroborate it against, so an envelope could leave it false and route around a whole body of
// governance. The contract is generic: the gate never knows which flag it is checking. `islamic`
// is used here only because it is the flag the shipped worked example carries.

const INST = (data, name = 'alpha-islamic-bank') => ({ name, path: `profiles/institutions/${name}.json`, data: { profile: name, kind: 'institution', ...data } });
const ASSERTING = [INST({ asserts_flags: { islamic: true } })];
// The stored plan reconciled against ITSELF: these tests are about the institution contract, so
// they must not also be a second assertion that the worked example's plan is freshly compiled
// (that is the reconciliation tests' job, and it fails for its own reasons when a profile moves).
const ICTX = { plan: PLAN, passport: PASSPORT, architectureExists: true, registry: REGISTRY, freshPlan: PLAN };

test('INSTITUTION — a flag the institution profile asserts cannot be left false by an envelope', () => {
  const env = { ...ENVELOPE, flags: { ...ENVELOPE.flags, islamic: false } };
  const f = corroborateFlags(env, { institutions: ASSERTING });
  assert.equal(f.length, 1, f.join('\n'));
  assert.match(f[0], /profiles\/institutions\/alpha-islamic-bank\.json asserts islamic: true/);
  assert.match(f[0], /not a tier reduction/);
  // An ABSENT flag is the same case — the compiler reads absent and false identically.
  assert.equal(corroborateFlags({ ...ENVELOPE, flags: {} }, { institutions: ASSERTING })
    .filter((x) => /institution profile/.test(x)).length, 1);
});

test('INSTITUTION — an envelope that agrees with the assertion is clean, and only `true` asserts', () => {
  const env = { ...ENVELOPE, flags: { ...ENVELOPE.flags, islamic: true } };
  assert.deepEqual(corroborateFlags(env, { institutions: ASSERTING }), []);
  // Asserting a flag false asserts nothing the compiler does not already assume.
  assert.deepEqual(corroborateFlags(ENVELOPE, { institutions: [INST({ asserts_flags: { islamic: false } })] }), []);
});

test('INSTITUTION — the assertion is read from EVERY institution profile, not the ones the envelope named', () => {
  // The envelope names regulated-bank, uae-bank, lending: no institution profile at all. That is
  // precisely the case the contract exists for, so the finding must still fire.
  assert.equal(ENVELOPE.required_profiles.includes('alpha-islamic-bank'), false);
  const f = evaluate({ ...ENVELOPE, flags: { ...ENVELOPE.flags, islamic: false } }, { ...ICTX, institutions: ASSERTING });
  assert.equal(f.length, 1, f.join('\n'));
  assert.match(f[0], /asserts islamic: true/);
});

test('INSTITUTION — required_for_all_changes: a profile a change can decline to name governs nothing', () => {
  const required = [INST({ required_for_all_changes: true })];
  const f = checkRequiredInstitutions(ENVELOPE, required);
  assert.equal(f.length, 1, f.join('\n'));
  assert.match(f[0], /declares required_for_all_changes but is not in required_profiles/);
  // Named — bare, or directory-qualified the way the compiler also resolves it.
  for (const named of ['alpha-islamic-bank', 'institutions/alpha-islamic-bank']) {
    assert.deepEqual(checkRequiredInstitutions({ ...ENVELOPE, required_profiles: [...ENVELOPE.required_profiles, named] }, required), [], named);
  }
  // Declared false or absent: nothing is required of anyone.
  assert.deepEqual(checkRequiredInstitutions(ENVELOPE, [INST({ required_for_all_changes: false }), INST({})]), []);
});

test('INSTITUTION — the profiles this harness actually ships assert nothing: no findings, no notices', () => {
  // DORMANCY. meridian-trust.json declares neither field, and the ADOPT: template — whose example
  // values would otherwise assert over every envelope in every adopting repository — is skipped.
  const shipped = loadInstitutionProfiles(HARNESS);
  assert.equal(shipped.some((p) => /template/.test(p.path) || /^ADOPT:/.test(p.data.profile || '')), false,
    `an uninstantiated template is not an institutional declaration: ${shipped.map((p) => p.path).join(', ')}`);
  const notices = [];
  assert.deepEqual(evaluate(ENVELOPE, { ...ICTX, institutions: shipped, notices }), []);
  assert.deepEqual(notices, []);
  assert.deepEqual(checkRequiredInstitutions(ENVELOPE, shipped), []);
});
}
