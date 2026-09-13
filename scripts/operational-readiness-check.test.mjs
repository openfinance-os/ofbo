// Tests for the operational-readiness gate (R1–R6). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { drillHash, evaluate, STRATEGIES, verifyDrillObservation, verifyProgressiveDelivery, WINDOWS } from './operational-readiness-check.mjs';

const NOW = Date.parse('2026-07-22');
const days = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const READY = {
  service_id: 'svc-x',
  criticality: 'critical',
  owner: 'ops-dana',
  on_call: 'rotation-1',
  rto_minutes: 240,
  rpo_minutes: 15,
  bcp_dr: { plan_ref: 'dr.md', last_exercised: days(30) },
  rollback: { procedure_ref: 'rb.md', last_drilled: days(20) },
  kill_switch: { owner: 'ops-dana', last_tested: days(10) },
  capacity: { stress_test_ref: 'stress.md', last_run: days(40) },
  third_parties: [{ name: 'bureau', continuity: 'cache-degrade', exit_strategy: 'secondary contract' }],
  reconciliation: 'daily',
  failed_transaction_recovery: 'replay from audit',
  complaints_readiness: 'scripts published',
  regulatory_notification_triggers: 'outage > 2h',
};

test('a fresh, complete readiness file passes', () => {
  assert.deepEqual(evaluate(READY, NOW), []);
});

test('FRESHNESS — an expired DR exercise, stale rollback drill, or old kill-switch test blocks', () => {
  const staleDr = evaluate({ ...READY, bcp_dr: { ...READY.bcp_dr, last_exercised: days(WINDOWS.bcp_dr + 10) } }, NOW);
  assert.ok(staleDr.some((x) => /BCP\/DR exercise.*STALE/.test(x)));
  const staleRb = evaluate({ ...READY, rollback: { ...READY.rollback, last_drilled: days(WINDOWS.rollback + 1) } }, NOW);
  assert.ok(staleRb.some((x) => /rollback drill.*STALE/.test(x)));
  const staleKs = evaluate({ ...READY, kill_switch: { ...READY.kill_switch, last_tested: days(WINDOWS.kill_switch + 1) } }, NOW);
  assert.ok(staleKs.some((x) => /kill-switch test.*STALE/.test(x)));
});

test('the unadopted template placeholder dates fail — copied is not exercised', () => {
  const f = evaluate({ ...READY, kill_switch: { owner: 'x', last_tested: 'ADOPT: date of your last test' } }, NOW);
  assert.ok(f.some((x) => /not a date \(unadopted template\?\)/.test(x)));
});

test('a missing kill-switch owner, RTO, or on-call is a finding', () => {
  const f = evaluate({ ...READY, kill_switch: { last_tested: days(5) }, rto_minutes: undefined, on_call: '' }, NOW);
  assert.ok(f.some((x) => /kill-switch has no owner/.test(x)));
  assert.ok(f.some((x) => /rto_minutes must be a number/.test(x)));
  assert.ok(f.some((x) => /no on_call/.test(x)));
});

test('a critical service needs third-party continuity AND an exit strategy', () => {
  const f = evaluate({ ...READY, third_parties: [{ name: 'bureau', continuity: 'cache' }] }, NOW);
  assert.ok(f.some((x) => /missing exit_strategy.*without an exit is a trap/.test(x)));
  const std = evaluate({ ...READY, criticality: 'standard', third_parties: undefined }, NOW);
  assert.deepEqual(std, []);
});

test('R6 customer/financial fields are required', () => {
  const f = evaluate({ ...READY, reconciliation: '', complaints_readiness: undefined }, NOW);
  assert.ok(f.some((x) => /no reconciliation/.test(x)));
  assert.ok(f.some((x) => /no complaints_readiness/.test(x)));
});

/* ---- rc.36 (flow-plan Phase 2.4): drills as SIGNED OBSERVATIONS ---- */

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'drill-observer-key', mechanism: 'ed25519', verify: { public_key: PEM } }] };
const REGISTRY = {
  identities: [
    { id: 'ops-omar', kind: 'human', roles: ['operations'], groups: [] },
    { id: 'eng-build', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'agent-x', kind: 'agent', roles: [], groups: ['builders'] },
  ],
};

function observation({ observedDaysAgo = 5, observer = 'ops-omar', result = 'rejected', mutateAfterSigning = null, ...rest } = {}) {
  const rec = {
    observed_at: days(observedDaysAgo),
    observation: { note: 'rolled back to vN-1 in 6m; limits reconciled' },
    negative_test: { attempted: 'writes against the rolled-back schema', result, tested_at: days(observedDaysAgo) },
    observer_identity: observer,
    ...rest,
  };
  rec.attestation = { issuer: 'drill-observer-key', signature: sign(null, Buffer.from(drillHash(rec), 'utf8'), privateKey).toString('base64') };
  if (mutateAfterSigning) mutateAfterSigning(rec);
  return rec;
}

const CTX = { registry: REGISTRY, issuers: ISSUERS };
const drillOpts = { label: 'svc-x: rollback drill', windowDays: WINDOWS.rollback, now: NOW, ...CTX };

test('a fresh, signed, independently observed drill with a refused negative test passes', () => {
  assert.deepEqual(verifyDrillObservation(observation(), drillOpts), []);
  const r = { ...READY, rollback: { procedure_ref: 'rb.md', last_drilled: observation() } };
  assert.deepEqual(evaluate(r, NOW, CTX), []);
});

test('a stale observation blocks, same windows as before', () => {
  const f = verifyDrillObservation(observation({ observedDaysAgo: WINDOWS.rollback + 3 }), drillOpts);
  assert.ok(f.some((x) => /STALE/.test(x)));
});

test('a negative test the mechanism did not REFUSE proves nothing', () => {
  const f = verifyDrillObservation(observation({ result: 'succeeded' }), drillOpts);
  assert.ok(f.some((x) => /not "rejected"/.test(x)));
  const none = observation();
  delete none.negative_test;
  assert.ok(verifyDrillObservation(none, drillOpts).some((x) => /no negative_test/.test(x)));
});

test('the observer must be OUTSIDE the builders\' write authority, and must resolve', () => {
  assert.ok(verifyDrillObservation(observation({ observer: 'eng-build' }), drillOpts).some((x) => /inside the builders' write authority/.test(x)));
  assert.ok(verifyDrillObservation(observation({ observer: 'agent-x' }), drillOpts).some((x) => /inside the builders' write authority/.test(x)));
  assert.ok(verifyDrillObservation(observation({ observer: 'nobody' }), drillOpts).some((x) => /does not resolve/.test(x)));
  assert.ok(verifyDrillObservation(observation(), { ...drillOpts, registry: null }).some((x) => /no identity registry/.test(x)));
});

test('the signature is real crypto over the whole record — edit anything after signing and it fails', () => {
  const doctored = observation({ mutateAfterSigning: (r) => { r.observation.note = 'a better story'; } });
  assert.ok(verifyDrillObservation(doctored, drillOpts).some((x) => /does NOT verify/.test(x)));
  const unsigned = observation();
  delete unsigned.attestation;
  assert.ok(verifyDrillObservation(unsigned, drillOpts).some((x) => /no attestation/.test(x)));
});

test('a demo-marked issuer cannot witness a drill either — the unified stack refuses it (D3)', () => {
  const demoReg = { issuers: [{ ...ISSUERS.issuers[0], demo: true }] };
  assert.ok(verifyDrillObservation(observation(), { ...drillOpts, issuers: demoReg }).some((x) => /is marked `"demo": true`/.test(x)));
});

test('a bare-date drill still passes THIS release, with a deprecation NOTICE — never silently', () => {
  const notices = [];
  assert.deepEqual(evaluate(READY, NOW, { ...CTX, notices }), []);
  assert.ok(notices.length >= 4, 'each bare-date drill field must say it is deprecated');
  assert.ok(notices.every((n) => /DEPRECATED \(rc\.36\)/.test(n)));
});

/* ---- rc.37 · flow-plan Phase 3.6: freshness WARNING BANDS ---- */

test('WARNING BAND — at 80% of a window the gate still PASSES and says how long is left', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
  const findings = [];
  const notices = [];
  // The kill-switch window is 90d: 75d in is inside the band, still valid.
  verifyDrillObservationBand(findings, notices, daysAgo(75), now);
  assert.deepEqual(findings, [], 'a drill inside its window must not fail');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /75d of the 90d window used, 15d left/);
  assert.match(notices[0], /BLOCKS production/);
  // 60d in (below 72d = 80% of 90) is silent.
  const quiet = { findings: [], notices: [] };
  verifyDrillObservationBand(quiet.findings, quiet.notices, daysAgo(60), now);
  assert.deepEqual(quiet.notices, []);
  // 91d in is the block, unmoved.
  const blocked = { findings: [], notices: [] };
  verifyDrillObservationBand(blocked.findings, blocked.notices, daysAgo(91), now);
  assert.ok(blocked.findings.some((f) => /STALE/.test(f)));
  assert.deepEqual(blocked.notices, [], 'a stale drill is a finding, not a warning');
});

// Exercise the band through the public observation verifier, ignoring the signature findings
// (this test is about the clock, and the signature path is covered above).
function verifyDrillObservationBand(findings, notices, observed_at, now) {
  const f = verifyDrillObservation(
    { observed_at, observation: { note: 'x' }, negative_test: { attempted: 'y', result: 'rejected', tested_at: observed_at }, observer_identity: 'ops-dana' },
    { label: 'svc: kill-switch test', windowDays: WINDOWS.kill_switch, now, registry: { identities: [{ id: 'ops-dana', kind: 'human' }] }, issuers: null, notices },
  );
  findings.push(...f.filter((x) => /window|STALE/.test(x)));
}

/* ---- rc.39 · flow-plan Phase 5.3: R3b — progressive delivery ---- */

const PD = () => ({
  strategy: 'canary',
  stages: [
    { name: 'internal', traffic_pct: 1, bake_minutes: 60, slo_refs: ['err-rate'] },
    { name: 'capped', traffic_pct: 10, bake_minutes: 240, slo_refs: ['err-rate', 'p99'] },
    { name: 'full', traffic_pct: 100, bake_minutes: 0, slo_refs: ['err-rate'] },
  ],
  automated_rollback: { trigger_slo: 'err-rate', last_tested: observation({ observedDaysAgo: 5 }) },
  feature_flag_ref: 'credit.decisioning.enabled',
});
const pdOpts = { label: 'svc-x: progressive delivery', now: NOW, ...CTX };

test('R3b — a complete progressive-delivery block passes', () => {
  assert.deepEqual(verifyProgressiveDelivery(PD(), pdOpts), []);
});

test('R3b is OPTIONAL until a compiled plan requires exposure_control, then it is MANDATORY', () => {
  assert.deepEqual(evaluate(READY, NOW, CTX), [], 'a service not doing staged exposure is not failing');
  const required = evaluate(READY, NOW, { ...CTX, exposureRequired: true });
  assert.ok(required.some((f) => /progressive_delivery is not an object/.test(f)), required.join('\n'));
  // Declaring one opts in even without the capability — a half-written ramp is not ignored.
  const halfWritten = evaluate({ ...READY, progressive_delivery: { strategy: 'canary' } }, NOW, CTX);
  assert.ok(halfWritten.some((f) => /no stages/.test(f)));
});

test('R3b — the strategy vocabulary is closed', () => {
  for (const s of STRATEGIES) assert.deepEqual(verifyProgressiveDelivery({ ...PD(), strategy: s }, pdOpts), []);
  assert.ok(verifyProgressiveDelivery({ ...PD(), strategy: 'big-bang' }, pdOpts).some((f) => /strategy must be/.test(f)));
});

test('R3b — a ramp must GO somewhere: strictly increasing, ending at 100', () => {
  const flat = PD();
  flat.stages[1].traffic_pct = 1;
  assert.ok(verifyProgressiveDelivery(flat, pdOpts).some((f) => /does not increase/.test(f)));
  const reversed = PD();
  reversed.stages = [reversed.stages[2], reversed.stages[1], reversed.stages[0]];
  assert.ok(verifyProgressiveDelivery(reversed, pdOpts).some((f) => /flattens or reverses/.test(f)));
  const unfinished = PD();
  unfinished.stages.pop();
  assert.ok(verifyProgressiveDelivery(unfinished, pdOpts).some((f) => /never reaches 100%/.test(f)));
});

test('R3b — every stage bakes while WATCHING something', () => {
  const noBake = PD();
  delete noBake.stages[0].bake_minutes;
  assert.ok(verifyProgressiveDelivery(noBake, pdOpts).some((f) => /a stage with no bake is a stage nobody watched/.test(f)));
  const blind = PD();
  blind.stages[0].slo_refs = [];
  assert.ok(verifyProgressiveDelivery(blind, pdOpts).some((f) => /baking without watching anything is waiting/.test(f)));
});

test('R3b — the automated rollback fires on an SLO the ramp actually observes', () => {
  const orphan = PD();
  orphan.automated_rollback.trigger_slo = 'cost-per-decision';
  assert.ok(verifyProgressiveDelivery(orphan, pdOpts).some((f) => /is not among the SLOs the stages watch/.test(f)));
  const none = PD();
  delete none.automated_rollback;
  assert.ok(verifyProgressiveDelivery(none, pdOpts).some((f) => /rolls back at human speed/.test(f)));
});

test('R3b — the rollback trigger test is a SIGNED OBSERVATION on a 90-day window', () => {
  assert.equal(WINDOWS.progressive_rollback, 90);
  const stale = PD();
  stale.automated_rollback.last_tested = observation({ observedDaysAgo: WINDOWS.progressive_rollback + 5 });
  assert.ok(verifyProgressiveDelivery(stale, pdOpts).some((f) => /automated-rollback trigger test.*STALE/.test(f)));
  const bareDate = PD();
  bareDate.automated_rollback.last_tested = days(5);
  assert.ok(verifyProgressiveDelivery(bareDate, pdOpts).some((f) => /observation has no observed_at/.test(f)),
    'a bare date is NOT accepted here — this field was born in the signed world');
  const forged = PD();
  forged.automated_rollback.last_tested = observation({ mutateAfterSigning: (r) => { r.observation.note = 'it went fine'; } });
  assert.ok(verifyProgressiveDelivery(forged, pdOpts).some((f) => /does NOT verify/.test(f)));
});

test('R3b — the warning band applies to the rollback window too (80% of 90d)', () => {
  const notices = [];
  const warm = PD();
  warm.automated_rollback.last_tested = observation({ observedDaysAgo: 75 });
  assert.deepEqual(verifyProgressiveDelivery(warm, { ...pdOpts, notices }), []);
  assert.ok(notices.some((n) => /75d of the 90d window used, 15d left/.test(n)), notices.join('\n'));
});

test('R3b — the ramp and the exposure register must name the SAME switch', () => {
  const unlinked = PD();
  delete unlinked.feature_flag_ref;
  assert.ok(verifyProgressiveDelivery(unlinked, pdOpts).some((f) => /no feature_flag_ref/.test(f)));
});
