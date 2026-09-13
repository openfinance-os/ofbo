// Tests for graceful degradation (Factory Floor WS6 · D6.4). Node built-in runner.
//
// Every control is tested twice: once for the case it must catch, and once for the case that would
// SAIL THROUGH if the control were absent. Here the negative half is unusually load-bearing, because
// the obvious over-strict implementation destroys the deliverable: a gate that FAILED on a degraded
// floor would teach adopters to stop writing observations, and the whole delivery is about breaking
// silence. A truthfully-degraded floor must pass. A floor that is degraded and says it is live must
// not, and no field may make it.
//
// The other easy mistake is collapsing the two failures. A credit-exhausted floor still MIRRORS git —
// the projector is a bank-hosted service, not a Worker — so `degraded` and `dark` call for opposite
// behaviour from a reader, and several tests exist only to keep them apart.
//
// All fixtures are synthetic: a floor nobody runs, watched by a service nobody deploys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNERS,
  CAPABILITY,
  CREDIT_STATES,
  DARK_BANNER,
  DEGRADED_BANNER,
  NOTICE_PLACEMENT,
  OBSERVATION_MAX_AGE_DAYS,
  PROJECTION_STATES,
  RECONCILIATION_MAX_AGE_DAYS,
  REJECTIONS,
  RUN_STATES,
  SCHEMA_ID,
  STATUSES,
  UNKNOWN_BANNER,
  checkCurrency,
  checkDegradation,
  checkManualFallback,
  checkNotice,
  checkReconciliation,
  degradationObservation,
  degradationRequired,
  deriveState,
  deriveStatus,
  observe,
  surfaceNotice,
  worstStatus,
} from './floor-degradation.mjs';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const DAY = 86400000;

const REGISTRY = {
  groups: { builders: 'first line', 'second-line': 'independent' },
  identities: [
    { id: 'svc-floor-watcher', kind: 'agent', display: 'Floor watcher', roles: [], groups: ['builders'] },
    { id: 'agent-floor-keeper', kind: 'agent', display: 'Floor-keeper', roles: [], groups: ['builders'] },
    { id: 'ops-dana', kind: 'human', display: 'Dana', roles: ['operations'], groups: [] },
    { id: 'infosec-noor', kind: 'human', display: 'Noor', roles: ['information-security'], groups: [] },
  ],
};

const notice = (status) => ({
  visible: true,
  dismissible: false,
  placement: NOTICE_PLACEMENT,
  severity: status,
  banner: BANNERS.get(status),
});

const live = (over = {}) => ({
  schema: SCHEMA_ID,
  observed_at: '2026-07-20T11:00:00Z',
  observed_by: 'svc-floor-watcher',
  since: '2026-07-20T11:00:00Z',
  credits: { state: 'available' },
  automation: { agents: 'running', workers: 'running' },
  projection: { state: 'current', depends_on_credits: false },
  ...over,
});

/** The D6.4 target state: the credits ran out, the automation stopped, and the floor says so. */
const degraded = (over = {}) => live({
  status: 'degraded',
  since: '2026-07-20T09:00:00Z',
  credits: { state: 'exhausted' },
  automation: { agents: 'paused', workers: 'paused' },
  notice: notice('degraded'),
  reconciliation: { ran_at: '2026-07-20T10:00:00Z', ran_by: 'ops-dana' },
  manual_fallback: { runbook: 'docs/governance/runbooks/floor-degradation.md', owner: 'ops-dana' },
  ...over,
});

const check = (record, ctx = {}) => checkDegradation(record, { registry: REGISTRY, ...ctx });
const has = (findings, code) => findings.some((f) => f.startsWith(`${code}:`));
const codes = (findings) => [...new Set(findings.map((f) => f.slice(0, 6)))].sort();

// ── the two states that must both pass ───────────────────────────────────────────────────────────

test('a live floor passes and carries no banner', () => {
  assert.deepEqual(check(live()), []);
  const s = deriveState(live());
  assert.equal(s.status, 'live');
  assert.equal(s.banner, null);
  assert.equal(surfaceNotice(live()), null);
});

test('a truthfully-degraded floor PASSES — representing degradation honestly is the deliverable', () => {
  // The negative that matters most. A gate that failed here would make the honest record the
  // expensive one, and adopters would stop writing observations — which is the silence D6.4 exists
  // to break.
  assert.deepEqual(check(degraded()), []);
  assert.equal(deriveState(degraded()).status, 'degraded');
});

test('every rejection code is documented in REJECTIONS', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(REJECTIONS.has(`DG-R0${n}`), `DG-R0${n}`);
});

// ── DG-R02 · a paused floor may not be represented as a live one ─────────────────────────────────

test('a paused floor declaring itself live is refused', () => {
  // The headline. If this control were absent, the cheapest way to a calm-looking board would be to
  // write `status: "live"` and let the derivation go unread.
  const f = check(degraded({ status: 'live' }));
  assert.ok(has(f, 'DG-R02'), f.join('\n'));
  assert.ok(f.some((x) => /the more reassuring of the two/.test(x)), f.join('\n'));
});

test('the status is DERIVED — there is no field that makes a paused floor live', () => {
  for (const status of ['live', 'degraded', 'dark', 'unknown', undefined, null, 'fine']) {
    assert.equal(deriveState(degraded({ status })).status, 'degraded', String(status));
  }
});

test('exhausted credits with the agents reported running is refused as an optimistic contradiction', () => {
  const f = check(degraded({ automation: { agents: 'running', workers: 'running' } }));
  assert.ok(has(f, 'DG-R02'), f.join('\n'));
  // …and the derivation still refuses to call it live.
  assert.equal(deriveStatus({ credits: 'exhausted', agents: 'running', workers: 'running', projection: 'current' }), 'degraded');
});

test('a declared status that is merely pessimistic is still reported — the derivation is what renders', () => {
  const f = check(live({ status: 'degraded', notice: notice('degraded'), reconciliation: { ran_at: '2026-07-20T10:00:00Z', ran_by: 'ops-dana' }, manual_fallback: { runbook: 'r.md', owner: 'ops-dana' } }));
  assert.ok(has(f, 'DG-R02'), f.join('\n'));
  assert.ok(f.some((x) => /decoration/.test(x)));
});

test('a record with no declared status at all passes — the derivation is enough', () => {
  assert.deepEqual(check(degraded({ status: undefined })), []);
});

// ── the derivation, exhaustively ─────────────────────────────────────────────────────────────────

test('the precedence is dark, then degraded, then unknown, then live', () => {
  const r = (credits, agents, workers, projection) => deriveStatus({ credits, agents, workers, projection });
  assert.equal(r('available', 'running', 'running', 'current'), 'live');
  assert.equal(r('low', 'running', 'running', 'current'), 'live');
  assert.equal(r('exhausted', 'paused', 'paused', 'current'), 'degraded');
  assert.equal(r('available', 'paused', 'running', 'current'), 'degraded');
  assert.equal(r('available', 'running', 'paused', 'current'), 'degraded');
  // Stale projection outranks everything: the floor is misrepresenting the RECORD, not the labour.
  assert.equal(r('available', 'running', 'running', 'stale'), 'dark');
  assert.equal(r('exhausted', 'paused', 'paused', 'stale'), 'dark');
  // Unobserved is never live.
  assert.equal(r('available', 'unknown', 'running', 'current'), 'unknown');
  assert.equal(r('unknown', 'running', 'running', 'current'), 'unknown');
  assert.equal(r('available', 'running', 'running', 'unknown'), 'unknown');
  assert.equal(r('nonsense', 'running', 'running', 'current'), 'unknown');
  assert.equal(deriveStatus({}), 'unknown');
  assert.equal(deriveStatus(), 'unknown');
});

test('an unobserved limb never reads as a working one', () => {
  const s = deriveState(live({ automation: { agents: 'unknown', workers: 'running' } }));
  assert.equal(s.status, 'unknown');
  assert.equal(s.banner, UNKNOWN_BANNER);
  assert.ok(s.has_stopped.some((x) => /nobody knows/.test(x)));
});

test('the severity ordering puts live first and dark last', () => {
  assert.deepEqual(STATUSES, ['live', 'unknown', 'degraded', 'dark']);
});

// ── the asymmetry: the mirror survives the credits ───────────────────────────────────────────────

test('a degraded floor states that the mirror is still current — the asymmetry D6.4 requires', () => {
  const s = deriveState(degraded());
  assert.ok(s.still_works.some((x) => /still mirrors git/.test(x)), s.still_works.join('\n'));
  assert.ok(s.has_stopped.some((x) => /prefill/.test(x)));
  assert.ok(s.has_stopped.some((x) => /routing and triage/.test(x)));
  assert.ok(!s.has_stopped.some((x) => /no longer a current mirror/.test(x)));
});

test('a dark floor says the opposite, and its banner tells the reader not to decide from the screen', () => {
  const dark = degraded({ status: 'dark', projection: { state: 'stale', depends_on_credits: false }, notice: notice('dark') });
  assert.deepEqual(check(dark), []);
  const s = deriveState(dark);
  assert.equal(s.status, 'dark');
  assert.equal(s.banner, DARK_BANNER);
  assert.ok(/Do not take a decision from this screen/.test(s.banner));
  assert.ok(s.has_stopped.some((x) => /no longer a current mirror/.test(x)));
  assert.ok(!s.still_works.some((x) => /still mirrors git/.test(x)));
});

test('the two banners are different sentences — conflating them teaches readers to ignore banners', () => {
  assert.notEqual(DEGRADED_BANNER, DARK_BANNER);
  assert.ok(/mirror of git is still current/.test(DEGRADED_BANNER));
  assert.ok(/stopped mirroring the record/.test(DARK_BANNER));
});

test('a projection declared dependent on credits is refused', () => {
  const f = check(degraded({ projection: { state: 'current', depends_on_credits: true } }));
  assert.ok(has(f, 'DG-R05'), f.join('\n'));
});

test('a projection recorded as paused BY credits is refused', () => {
  const f = check(degraded({ projection: { state: 'stale', depends_on_credits: false, paused_by: 'credit exhaustion' }, notice: notice('dark') }));
  assert.ok(has(f, 'DG-R05'), f.join('\n'));
});

test('a projection paused for its own reason is NOT DG-R05 — only the credit claim is', () => {
  // The negative. The projector can be down; that is a `dark` floor and an honest record. Refusing
  // every paused projection would make the honest record impossible to write.
  const f = check(degraded({ status: 'dark', projection: { state: 'stale', depends_on_credits: false, paused_by: 'service deploy rollback' }, notice: notice('dark') }));
  assert.deepEqual(f, []);
});

// ── DG-R03 / DG-R04 · loud, on every view, verbatim ──────────────────────────────────────────────

test('a paused floor with no surface notice is refused', () => {
  const f = check(degraded({ notice: undefined }));
  assert.ok(has(f, 'DG-R03'), f.join('\n'));
  assert.ok(f.some((x) => /this is the whole of D6.4/.test(x)));
});

test('a dismissible notice is refused', () => {
  const f = check(degraded({ notice: { ...notice('degraded'), dismissible: true } }));
  assert.ok(has(f, 'DG-R03'), f.join('\n'));
});

test('a notice scoped to less than every view is refused', () => {
  for (const placement of ['home', 'status-page', 'board', undefined]) {
    const f = check(degraded({ notice: { ...notice('degraded'), placement } }));
    assert.ok(has(f, 'DG-R03'), `${placement}: ${f.join('\n')}`);
  }
});

test('an invisible notice is refused', () => {
  const f = check(degraded({ notice: { ...notice('degraded'), visible: false } }));
  assert.ok(has(f, 'DG-R03'), f.join('\n'));
});

test('an altered banner is refused — it is verbatim or it is a finding', () => {
  const f = check(degraded({ notice: { ...notice('degraded'), banner: 'Some automation is temporarily paused. No action needed.' } }));
  assert.ok(has(f, 'DG-R04'), f.join('\n'));
});

test('a notice carrying the wrong status\'s banner is refused', () => {
  const f = check(degraded({ notice: { ...notice('degraded'), banner: DARK_BANNER } }));
  assert.ok(has(f, 'DG-R04'), f.join('\n'));
});

test('a notice underselling its own severity is refused', () => {
  const f = check(degraded({ notice: { ...notice('degraded'), severity: 'unknown' } }));
  assert.ok(has(f, 'DG-R04'), f.join('\n'));
});

test('a LIVE floor carrying a banner is refused — a reassuring banner is how readers learn to skip them', () => {
  const f = check(live({ notice: notice('degraded') }));
  assert.ok(has(f, 'DG-R04'), f.join('\n'));
  assert.deepEqual(checkNotice(null, 'live'), []);
});

test('surfaceNotice produces exactly what checkNotice demands', () => {
  // The gate's verdict and the surface's banner come from one derivation, or they diverge silently.
  for (const record of [degraded(), degraded({ projection: { state: 'stale', depends_on_credits: false } }), live({ automation: { agents: 'unknown', workers: 'running' } })]) {
    const n = surfaceNotice(record);
    assert.deepEqual(checkNotice(n, deriveStatus({
      credits: record.credits.state,
      agents: record.automation.agents,
      workers: record.automation.workers,
      projection: record.projection.state,
    })), []);
    assert.equal(n.dismissible, false);
    assert.equal(n.placement, NOTICE_PLACEMENT);
    assert.equal(n.authority, 'none');
  }
});

// ── DG-R06 · the reconciliation ──────────────────────────────────────────────────────────────────

test('a paused floor with no reconciliation is refused', () => {
  const f = check(degraded({ reconciliation: undefined }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
});

test('a reconciliation lagging the observation past its window is refused', () => {
  const f = check(degraded({
    since: '2026-07-10T00:00:00Z',
    reconciliation: { ran_at: '2026-07-15T10:00:00Z', ran_by: 'ops-dana' },
  }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
  assert.ok(f.some((x) => /day\(s\) before this observation/.test(x)));
});

test('a reconciliation from before the degradation began reconciles nothing about it', () => {
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T08:00:00Z', ran_by: 'ops-dana' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
  assert.ok(f.some((x) => /before the degradation began/.test(x)));
});

test('a reconciliation dated after the observation is refused', () => {
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T23:00:00Z', ran_by: 'ops-dana' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
});

test('a reconciliation run by the observer is self-signed and refused', () => {
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T10:00:00Z', ran_by: 'svc-floor-watcher' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
  assert.ok(f.some((x) => /one party asserting twice/.test(x)));
});

test('a reconciliation run by the paused automation itself is refused', () => {
  // The automation is what stopped. A machine on the paused platform vouching that nothing was
  // missed is the silence signing its own alibi — and without this control it is the cheapest way
  // to satisfy DG-R06.
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T10:00:00Z', ran_by: 'agent-floor-keeper' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
  assert.ok(f.some((x) => /signing its own alibi/.test(x)));
});

test('a reconciliation naming an unregistered identity is refused', () => {
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T10:00:00Z', ran_by: 'someone-else' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
});

test('a reconciliation with no runner is refused', () => {
  const f = check(degraded({ reconciliation: { ran_at: '2026-07-20T10:00:00Z' } }));
  assert.ok(has(f, 'DG-R06'), f.join('\n'));
});

test('a LIVE floor needs no reconciliation — a running floor reconciles by running', () => {
  assert.deepEqual(checkReconciliation(live(), 'live', { registry: REGISTRY }), []);
  assert.deepEqual(check(live()), []);
});

test('the reconciliation check is clock-free — both operands are committed instants', () => {
  // Re-derivable forever: the same record yields the same verdict on any machine on any date, which
  // is what makes a degradation record evidence rather than weather.
  const record = degraded();
  const a = checkReconciliation(record, 'degraded', { registry: REGISTRY });
  const b = checkReconciliation(record, 'degraded', { registry: REGISTRY });
  assert.deepEqual(a, b);
  assert.deepEqual(a, []);
  assert.equal(RECONCILIATION_MAX_AGE_DAYS, 1);
});

// ── DG-R07 · the manual fallback ─────────────────────────────────────────────────────────────────

test('a paused floor with no manual fallback is refused', () => {
  const f = check(degraded({ manual_fallback: undefined }));
  assert.ok(has(f, 'DG-R07'), f.join('\n'));
});

test('an ADOPT: placeholder is not a runbook and not an owner', () => {
  const f = check(degraded({ manual_fallback: { runbook: 'ADOPT: your degradation runbook', owner: 'ADOPT: who owns this' } }));
  assert.ok(has(f, 'DG-R07'), f.join('\n'));
  assert.equal(f.filter((x) => x.startsWith('DG-R07')).length, 2);
  assert.ok(f.some((x) => /text nobody replaced/.test(x)));
});

test('a fallback with a runbook but no owner is refused — a procedure with no owner is nobody\'s job', () => {
  const f = check(degraded({ manual_fallback: { runbook: 'runbooks/floor.md' } }));
  assert.ok(has(f, 'DG-R07'), f.join('\n'));
});

test('a LIVE floor needs no fallback declared', () => {
  assert.deepEqual(checkManualFallback(live(), 'live'), []);
});

// ── DG-R01 / DG-R09 · readability and vocabulary ─────────────────────────────────────────────────

test('an unreadable observation is refused, never mistaken for a clean bill of health', () => {
  for (const bad of [null, undefined, 'degraded', [], 7]) {
    assert.ok(has(checkDegradation(bad), 'DG-R01'), JSON.stringify(bad));
  }
});

test('a wrong-schema observation is refused before anything else is read', () => {
  assert.deepEqual(codes(checkDegradation({ schema: 'loom.floor-degradation/v0' })), ['DG-R01']);
});

test('an observation with no instant or no observer is refused', () => {
  assert.ok(has(check(live({ observed_at: undefined })), 'DG-R01'));
  assert.ok(has(check(live({ observed_at: 'last Tuesday' })), 'DG-R01'));
  assert.ok(has(check(live({ observed_by: undefined })), 'DG-R01'));
  assert.ok(has(check(live({ since: 'recently' })), 'DG-R01'));
});

test('a state outside the vocabulary is refused rather than coerced to the nearest reassuring one', () => {
  assert.ok(has(check(live({ credits: { state: 'plenty' } })), 'DG-R09'));
  assert.ok(has(check(live({ automation: { agents: 'ok', workers: 'running' } })), 'DG-R09'));
  assert.ok(has(check(live({ automation: { agents: 'running', workers: 'fine' } })), 'DG-R09'));
  assert.ok(has(check(live({ projection: { state: 'fresh' } })), 'DG-R09'));
  assert.deepEqual([...RUN_STATES].sort(), ['paused', 'running', 'unknown']);
  assert.deepEqual([...PROJECTION_STATES].sort(), ['current', 'stale', 'unknown']);
  assert.deepEqual([...CREDIT_STATES].sort(), ['available', 'exhausted', 'low', 'unknown']);
});

test('an out-of-vocabulary state derives UNKNOWN, so it can never render as live', () => {
  const s = deriveState(live({ automation: { agents: 'ok', workers: 'running' } }));
  assert.equal(s.status, 'unknown');
  assert.equal(s.banner, UNKNOWN_BANNER);
});

// ── DG-R08 · currency, the only clock, and it judges the watcher ─────────────────────────────────

test('a floor nobody has observed is a finding against the watcher', () => {
  const f = checkCurrency([], { now: NOW });
  assert.ok(has(f, 'DG-R08'), f.join('\n'));
  assert.ok(f.some((x) => /nobody looked/.test(x)));
});

test('a stale newest observation is refused; a fresh one is not', () => {
  const at = (ms) => live({ observed_at: new Date(ms).toISOString() });
  assert.deepEqual(checkCurrency([at(NOW - 3600_000)], { now: NOW }), []);
  assert.ok(has(checkCurrency([at(NOW - (OBSERVATION_MAX_AGE_DAYS + 2) * DAY)], { now: NOW }), 'DG-R08'));
});

test('an old observation does not go red just because a newer one exists', () => {
  // Observations accumulate. An old file describing a past outage is correct history, and a check
  // that aged every record would turn a truthful archive red as time passed.
  const old = live({ observed_at: '2026-01-01T00:00:00Z' });
  const now = live({ observed_at: new Date(NOW - 3600_000).toISOString() });
  assert.deepEqual(checkCurrency([old, now], { now: NOW }), []);
  assert.deepEqual(check(old), []);
});

test('an observation dated in the future is refused', () => {
  const f = checkCurrency([live({ observed_at: new Date(NOW + 2 * DAY).toISOString() })], { now: NOW });
  assert.ok(has(f, 'DG-R08'), f.join('\n'));
});

test('checkDegradation reads no clock — the same record verifies identically forever', () => {
  const record = degraded();
  assert.deepEqual(checkDegradation(record, { registry: REGISTRY }), checkDegradation(record, { registry: REGISTRY }));
  assert.deepEqual(checkDegradation(record, { registry: REGISTRY }), []);
});

// ── the worst reading decides ────────────────────────────────────────────────────────────────────

test('the worst status across observations decides, never the newest', () => {
  // A later, cheerier reading must not clear a notice a still-unresolved one raised — the same
  // asymmetry drift uses, for the same reason.
  const cheerful = live({ observed_at: '2026-07-20T11:59:00Z' });
  const bad = degraded({ observed_at: '2026-07-20T09:00:00Z' });
  const w = worstStatus([cheerful, bad]);
  assert.equal(w.status, 'degraded');
  assert.equal(worstStatus([]), null);
  assert.equal(worstStatus([{ schema: 'other' }]), null);
  assert.equal(worstStatus([live()]).status, 'live');
});

// ── the observation builder and the injected reader ──────────────────────────────────────────────

test('degradationObservation builds a record the checker accepts', () => {
  const rec = degradationObservation({
    credits: 'available', agents: 'running', workers: 'running', projection: 'current',
    observedAt: '2026-07-20T11:00:00Z', observedBy: 'svc-floor-watcher',
  });
  assert.deepEqual(check(rec), []);
  assert.equal(rec.projection.depends_on_credits, false);
  assert.equal(rec.since, '2026-07-20T11:00:00Z');
});

test('an unattributed or undated observation the builder produced is still refused', () => {
  assert.ok(has(check(degradationObservation({ credits: 'available', agents: 'running', workers: 'running', projection: 'current' })), 'DG-R01'));
});

test('observe() needs an injected reader — this module makes no network call', async () => {
  await assert.rejects(() => observe({ observedAt: '2026-07-20T11:00:00Z', observedBy: 'svc-floor-watcher' }), /injected reader/);
});

test('observe() throws rather than writing a partial observation', async () => {
  // A placeholder observation would be indistinguishable, later, from a floor that was fine — which
  // is the exact silence this delivery exists to break.
  await assert.rejects(
    () => observe({ observedAt: '2026-07-20T11:00:00Z', observedBy: 'svc-floor-watcher' }, async () => ({ credits: 'available', agents: 'running' })),
    /not a complete reading/,
  );
});

test('observe() returns a checkable observation from a complete reading', async () => {
  const rec = await observe(
    { observedAt: '2026-07-20T11:00:00Z', observedBy: 'svc-floor-watcher', since: '2026-07-20T09:00:00Z' },
    async () => ({ credits: 'exhausted', agents: 'paused', workers: 'paused', projection: 'current' }),
  );
  assert.equal(deriveStatus({ credits: 'exhausted', agents: 'paused', workers: 'paused', projection: 'current' }), 'degraded');
  // It is a reading, not a full record: the notice, reconciliation and fallback are the operator's
  // half, and their absence is reported rather than assumed.
  const f = check(rec);
  assert.deepEqual(codes(f).sort(), ['DG-R03', 'DG-R06', 'DG-R07']);
});

test('mandatory-when-compiled reads the capability off the plan', () => {
  assert.equal(degradationRequired({ required_capabilities: { [CAPABILITY]: { required: true } } }), true);
  assert.equal(degradationRequired({ required_capabilities: { [CAPABILITY]: { required: false } } }), false);
  assert.equal(degradationRequired({}), false);
  assert.equal(degradationRequired(null), false);
});

test('the alert flag reports what was observed, not a threshold this module invented', () => {
  assert.equal(deriveState(live()).alert, false);
  assert.equal(deriveState(live({ credits: { state: 'low' } })).alert, true);
  assert.equal(deriveState(degraded()).alert, true);
  // `low` is a warning, not a pause: the floor is still live, and the threshold that produced "low"
  // is the adopter's (AWAITING in the threat model), never this module's.
  assert.equal(deriveState(live({ credits: { state: 'low' } })).status, 'live');
});
