// Tests for the assurance-cycle gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cadenceBound, cadenceFindings, evaluate, cycleHash, run, streamsOf, STEPS } from './assurance-cycle-check.mjs';

// A self-contained issuer + registry so the test never depends on the shipped demo key.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const ISSUERS = { issuers: [{ id: 'test-signer', mechanism: 'ed25519', verify: { public_key: publicKey.export({ type: 'spki', format: 'pem' }) } }] };
const REGISTRY = { identities: [
  { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
  { id: 'mrm-aisha', kind: 'human', roles: ['model-validator'], groups: ['second-line'] },
  { id: 'agent-x', kind: 'agent', roles: [], groups: ['builders'] },
  { id: 'issc-scholar-1', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'] },
] };
const NOW = Date.parse('2026-07-25');

function record(over = {}) {
  const base = {
    cycle_id: 'AC-T-1', ran_at: '2026-07-20T02:00:00Z', trigger: 'schedule',
    steps: Object.fromEntries(STEPS.map((s) => [s, { status: 'pass' }])),
    findings: [{ id: 'F1', severity: 'medium', owner: 'mrm-aisha', due: '2026-08-15', status: 'open' }],
    ...over,
  };
  return base;
}
function signed(rec, { by = 'risk-lena', key = privateKey } = {}) {
  const r = { ...rec };
  r.attestation = { issuer: 'test-signer', confirmed_by: by, signature: sign(null, Buffer.from(cycleHash(rec), 'utf8'), key).toString('base64') };
  return r;
}
const opts = { issuers: ISSUERS, registry: REGISTRY, now: NOW };

test('a complete, signed, second-line-confirmed cycle passes', () => {
  assert.deepEqual(evaluate(signed(record()), opts), []);
});

test('a missing lifecycle step fails — all six run', () => {
  const rec = record();
  delete rec.steps.test;
  assert.ok(evaluate(signed(rec), opts).some((x) => /step "test" is missing/.test(x)));
});

test('an unsigned cycle is not a control', () => {
  assert.ok(evaluate(record(), opts).some((x) => /unsigned — the Confirm step is authenticated authority/.test(x)));
});

test('a tampered record fails signature verification (the sig is over the hash)', () => {
  const rec = signed(record());
  rec.steps.check.status = 'fail'; // change content after signing
  assert.ok(evaluate(rec, opts).some((x) => /does NOT verify/.test(x)));
});

test('an AGENT or a builder cannot confirm the cycle — only a second-line human', () => {
  assert.ok(evaluate(signed(record(), { by: 'agent-x' }), opts).some((x) => /not a second-line human/.test(x)));
});

test('a finding without owner/due/status is not a register; an OPEN overdue finding blocks', () => {
  const bad = record({ findings: [{ id: 'F2', severity: 'high' }] });
  const f = evaluate(signed(bad), opts);
  assert.ok(f.some((x) => /no due date/.test(x)));
  assert.ok(f.some((x) => /status must be open\|resolved\|accepted/.test(x)));
  const overdue = record({ findings: [{ id: 'F3', severity: 'high', owner: 'mrm-aisha', due: '2026-07-01', status: 'open' }] });
  assert.ok(evaluate(signed(overdue), opts).some((x) => /OPEN and overdue/.test(x)));
});

test('a finding owner outside the registry does not count', () => {
  const rec = record({ findings: [{ id: 'F4', severity: 'low', owner: 'Nobody', due: '2026-09-01', status: 'open' }] });
  assert.ok(evaluate(signed(rec), opts).some((x) => /owner "Nobody" is not a registry identity/.test(x)));
});

test('an unregistered signer does not count however valid the signature', () => {
  const { privateKey: rogue } = generateKeyPairSync('ed25519');
  assert.ok(evaluate(signed(record(), { key: rogue }), opts).some((x) => /does NOT verify|not in the allowed-issuers/.test(x)));
});

/* ---- W3: a step's status is judged, not merely recorded (closes F4) ---- */

const failStep = (extra = {}) => record({ steps: { ...Object.fromEntries(STEPS.map((s) => [s, { status: 'pass' }])), check: { status: 'fail', ...extra } } });

test('a signed cycle with a FAIL step and no risk acceptance BLOCKS', () => {
  const f = evaluate(signed(failStep()), opts);
  assert.ok(f.some((x) => /step check is FAIL with no risk acceptance/.test(x)));
});

test('a FAIL step is covered only by an unexpired, second-line risk acceptance', () => {
  const good = failStep({ risk_acceptance: { accepted_by: 'risk-lena', rationale: 'compensating control X in place', expires: '2026-09-01' } });
  assert.deepEqual(evaluate(signed(good), opts).filter((x) => /step check/.test(x)), []);
  const expired = failStep({ risk_acceptance: { accepted_by: 'risk-lena', rationale: 'r', expires: '2026-07-01' } });
  assert.ok(evaluate(signed(expired), opts).some((x) => /risk acceptance EXPIRED/.test(x)));
  const byAgent = failStep({ risk_acceptance: { accepted_by: 'agent-x', rationale: 'r', expires: '2026-09-01' } });
  assert.ok(evaluate(signed(byAgent), opts).some((x) => /not a second-line human/.test(x)));
});

test('an n/a step needs a rationale and second-line approval', () => {
  const bare = record({ steps: { ...Object.fromEntries(STEPS.map((s) => [s, { status: 'pass' }])), test: { status: 'n/a' } } });
  const f = evaluate(signed(bare), opts);
  assert.ok(f.some((x) => /n\/a with no rationale/.test(x)));
  assert.ok(f.some((x) => /n\/a is not second-line approved/.test(x)));
  const ok = record({ steps: { ...Object.fromEntries(STEPS.map((s) => [s, { status: 'pass' }])), test: { status: 'n/a', rationale: 'no code paths touched', approved_by: 'risk-lena' } } });
  assert.deepEqual(evaluate(signed(ok), opts).filter((x) => /step test/.test(x)), []);
});

/* ---- rc.46: assurance STREAMS — a second cadence, and a role-locked Confirm ---- */

// A domain stream: its own window, and step ⑥ held by the body that is accountable for it.
// Steps ①–⑤ stay agent-preparable; this is the only step an agent can never hold.
const STREAMS = {
  shariah: { cadence_days: 90, confirm_roles: ['shariah-committee'] },
  operational: { cadence_days: 14 }, // a stream with a cadence and NO role lock
};
const withStreams = { ...opts, streams: STREAMS };

test('a record with no stream is unaffected by configured streams — the global behaviour, exactly', () => {
  assert.deepEqual(evaluate(signed(record()), withStreams), []);
  assert.deepEqual(evaluate(signed(record()), opts), []);
});

test('a stream that role-locks Confirm is satisfied only by a holder of a listed role', () => {
  const rec = record({ cycle_id: 'AC-T-SH', stream: 'shariah' });
  assert.deepEqual(evaluate(signed(rec, { by: 'issc-scholar-1' }), withStreams), []);
  // risk-lena is a second-line human and still fails: the stream names the accountable body.
  const wrong = evaluate(signed(rec, { by: 'risk-lena' }), withStreams);
  assert.ok(wrong.some((x) => /stream "shariah" requires the Confirm step to be held by one of \[shariah-committee\]/.test(x)));
  assert.ok(wrong.some((x) => /the accountable body confirms it/.test(x)));
});

test('the role lock is ADDITIVE — an agent still cannot confirm, whatever roles a stream lists', () => {
  const rec = record({ stream: 'shariah' });
  const f = evaluate(signed(rec, { by: 'agent-x' }), withStreams);
  assert.ok(f.some((x) => /is not a second-line human/.test(x)));
  assert.ok(f.some((x) => /requires the Confirm step to be held by one of/.test(x)));
});

test('a stream with no confirm_roles imposes no role lock — any second-line human confirms it', () => {
  const rec = record({ stream: 'operational' });
  assert.deepEqual(evaluate(signed(rec, { by: 'risk-lena' }), withStreams), []);
});

test('a record declaring an UNCONFIGURED stream is a finding — no ghost streams', () => {
  const ghost = evaluate(signed(record({ stream: 'shariah-ish' })), withStreams);
  assert.ok(ghost.some((x) => /declares assurance stream "shariah-ish", which is not configured/.test(x)));
  // and with no streams configured at all, ANY declared stream is a ghost
  assert.ok(evaluate(signed(record({ stream: 'shariah' })), opts).some((x) => /is not configured/.test(x)));
});

test('a non-string stream is a finding, not an accidental global record', () => {
  assert.ok(evaluate(signed(record({ stream: 42 })), withStreams).some((x) => /stream must be a non-empty string \(got 42\)/.test(x)));
  assert.ok(evaluate(signed(record({ stream: '  ' })), withStreams).some((x) => /stream must be a non-empty string/.test(x)));
});

test('streamsOf() reads only a real map — a malformed streams block configures none', () => {
  assert.deepEqual(streamsOf({ streams: STREAMS }), STREAMS);
  for (const bad of [undefined, null, {}, { streams: [] }, { streams: 'shariah' }, { streams: null }]) {
    assert.deepEqual(streamsOf(bad), {}, `configures no streams: ${JSON.stringify(bad)}`);
  }
});

/* ---- rc.46: the cadence loop, global and per stream ---- */

const NOWC = Date.parse('2026-08-01T00:00:00Z');
const daysAgo = (n) => NOWC - n * 86_400_000;
const cadence = (over = {}) => cadenceFindings({ now: NOWC, ...over });

test('the global cadence is unchanged: default 30d, overridable, undated when nothing ran', () => {
  assert.deepEqual(cadence({ newest: daysAgo(10) }), []);
  assert.ok(cadence({ newest: daysAgo(45) })[0].startsWith('newest assurance cycle is 45d old, past the 30d cadence'));
  assert.ok(cadence({ config: { cadence_days: 60 }, newest: daysAgo(45) }).length === 0);
  assert.ok(cadence({}).some((x) => /newest assurance cycle is undated, past the 30d cadence/.test(x)));
});

test('each configured stream is judged on its OWN cadence, against records carrying it', () => {
  const config = { cadence_days: 30, streams: STREAMS };
  const fresh = new Map([['shariah', daysAgo(20)], ['operational', daysAgo(3)]]);
  assert.deepEqual(cadence({ config, newest: daysAgo(3), newestByStream: fresh }), []);
  const lapsed = new Map([['shariah', daysAgo(200)], ['operational', daysAgo(3)]]);
  const f = cadence({ config, newest: daysAgo(3), newestByStream: lapsed });
  assert.equal(f.length, 1);
  assert.ok(/newest "shariah"-stream assurance cycle is 200d old, past the 90d cadence/.test(f[0]));
});

test('a busy global cycle does NOT cover a stream that never ran', () => {
  const f = cadence({ config: { streams: STREAMS }, newest: daysAgo(1), newestByStream: new Map([['operational', daysAgo(1)]]) });
  assert.equal(f.length, 1);
  assert.ok(/newest "shariah"-stream assurance cycle is never run, past the 90d cadence .* assures nothing/.test(f[0]));
});

test('a malformed cadence_days is a FINDING and the window still applies — a bad number never disables the check', () => {
  // "monthly" coerced to NaN, every `age > NaN` was false, and the staleness check switched itself
  // off for exactly the repository whose config was wrong. Both limbs are asserted: it is reported,
  // AND the default still polices the window.
  for (const bad of ['monthly', '30 days', {}, [], true, '', 0, -30, NaN]) {
    const f = cadence({ config: { cadence_days: bad }, newest: daysAgo(400) });
    assert.ok(f.some((x) => /cadence_days .* is not a positive number of days/.test(x)), `${JSON.stringify(bad)}: ${f.join('\n')}`);
    assert.ok(f.some((x) => /newest assurance cycle is 400d old, past the 30d cadence/.test(x)), `${JSON.stringify(bad)}: ${f.join('\n')}`);
  }
  // A stream's malformed cadence falls back to the global one, and says which it applied.
  const s = cadence({ config: { cadence_days: 7, streams: { shariah: { cadence_days: 'quarterly' } } }, newest: daysAgo(1), newestByStream: new Map() });
  assert.ok(s.some((x) => /stream "shariah": cadence_days "quarterly" is not a positive number/.test(x)), s.join('\n'));
  assert.ok(s.some((x) => /"shariah"-stream assurance cycle is never run, past the 7d cadence/.test(x)), s.join('\n'));
  // A cadence that IS a number is untouched: no finding, and the configured window governs.
  assert.deepEqual(cadence({ config: { cadence_days: 60 }, newest: daysAgo(45) }), []);
});

test('cadenceBound: absent means "not configured", anything unusable means "configured wrong"', () => {
  assert.deepEqual(cadenceBound(undefined), { days: null, ok: true });
  assert.deepEqual(cadenceBound(null), { days: null, ok: true });
  assert.deepEqual(cadenceBound(90), { days: 90, ok: true });
  assert.deepEqual(cadenceBound(0.5), { days: 0.5, ok: true });
  for (const bad of ['90', 0, -1, Infinity, NaN, {}, [], true]) {
    assert.deepEqual(cadenceBound(bad), { days: null, ok: false }, JSON.stringify(bad));
  }
});

test('a stream with no cadence_days of its own inherits the global window', () => {
  const config = { cadence_days: 7, streams: { operational: { confirm_roles: [] } } };
  assert.ok(cadence({ config, newest: daysAgo(1), newestByStream: new Map([['operational', daysAgo(9)]]) })
    .some((x) => /"operational"-stream assurance cycle is 9d old, past the 7d cadence/.test(x)));
});

/* ---- rc.46: run() over a real tree ---- */

function repo({ config = null, cycles = [], state = 'in-production' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'assurance-'));
  const base = join(dir, 'docs/governance/changes/CHG-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: state, control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({ required_gates: [], required_evidence: [] }));
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  writeFileSync(join(dir, 'docs/governance/attestation-issuers.json'), JSON.stringify(ISSUERS));
  if (config) writeFileSync(join(dir, 'docs/governance/assurance-config.json'), JSON.stringify(config));
  const cyclesDir = join(dir, 'docs/governance/assurance-cycles');
  mkdirSync(cyclesDir, { recursive: true });
  for (const c of cycles) writeFileSync(join(cyclesDir, `${c.cycle_id}.json`), JSON.stringify(c));
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
// run() reads the real clock, so the fixture's dates are relative: a finding due a year out is
// open-but-not-overdue whenever this suite happens to run.
const cyc = (over = {}) => record({ ran_at: ago(1), findings: [{ id: 'F1', severity: 'medium', owner: 'mrm-aisha', due: ago(-365), status: 'open' }], ...over });
const cadenceOnly = (findings) => findings.filter((f) => /cadence/.test(f));

test('run(): a configured stream with no record of its own is stale even though the global cycle is fresh', () => {
  const d = repo({ config: { cadence_days: 30, streams: { shariah: { cadence_days: 90, confirm_roles: ['shariah-committee'] } } }, cycles: [signed(cyc({ cycle_id: 'AC-1' }))] });
  try {
    assert.ok(cadenceOnly(run(d).findings).some((f) => /"shariah"-stream assurance cycle is never run/.test(f)));
  } finally { clean(d); }
});

test('run(): a fresh record CARRYING the stream clears it; a lapsed one does not', () => {
  const config = { cadence_days: 30, streams: { shariah: { cadence_days: 90, confirm_roles: ['shariah-committee'] } } };
  const fresh = repo({ config, cycles: [signed(cyc({ cycle_id: 'AC-1' })), signed(cyc({ cycle_id: 'AC-SH-1', stream: 'shariah' }), { by: 'issc-scholar-1' })] });
  try {
    const r = run(fresh);
    assert.deepEqual(cadenceOnly(r.findings), []);
    assert.deepEqual(r.findings, []); // the stream record is fully valid: signed, scholar-confirmed
    assert.equal(r.count, 2);
  } finally { clean(fresh); }

  const lapsed = repo({ config, cycles: [signed(cyc({ cycle_id: 'AC-1' })), signed(cyc({ cycle_id: 'AC-SH-1', stream: 'shariah', ran_at: ago(200) }), { by: 'issc-scholar-1' })] });
  try {
    assert.ok(cadenceOnly(run(lapsed).findings).some((f) => /"shariah"-stream assurance cycle is 200d old/.test(f)));
  } finally { clean(lapsed); }
});

test('run(): with nothing in production, no cadence is owed — streams included', () => {
  const d = repo({ state: 'in-delivery', config: { streams: { shariah: { cadence_days: 90 } } }, cycles: [signed(cyc({ cycle_id: 'AC-1' }))] });
  try {
    assert.deepEqual(cadenceOnly(run(d).findings), []);
  } finally { clean(d); }
});

test('run(): a repo that configures no streams behaves exactly as before', () => {
  const stale = repo({ cycles: [signed(cyc({ cycle_id: 'AC-1', ran_at: ago(120) }))] });
  try {
    const f = cadenceOnly(run(stale).findings);
    assert.equal(f.length, 1);
    assert.ok(/newest assurance cycle is 120d old, past the 30d cadence/.test(f[0]));
  } finally { clean(stale); }
});

test('run(): the role lock reaches the record through the config, not through the test harness', () => {
  const d = repo({
    config: { streams: { shariah: { cadence_days: 90, confirm_roles: ['shariah-committee'] } } },
    cycles: [signed(cyc({ cycle_id: 'AC-SH-1', stream: 'shariah' }), { by: 'risk-lena' })],
  });
  try {
    assert.ok(run(d).findings.some((f) => /requires the Confirm step to be held by one of \[shariah-committee\]/.test(f)));
  } finally { clean(d); }
});
