// Tests for the WS6 floor gate (Factory Floor D6.3 + D6.4). Node built-in runner.
//
// Two things are being tested that the core modules cannot test themselves:
//
//   SILENCE WHERE UNADOPTED. Most repositories that install this harness will never run a
//   collaboration surface. They must see nothing — not a warning, not a skipped-check line. A gate
//   that nagged them would be switched off, and it would be switched off in the same file as the one
//   that matters.
//
//   THE ABSENCE THAT IS A FINDING. The interesting wiring rule is that declaring floor-keepers
//   without ever observing the floor's liveness is itself refused. Keepers run on metered
//   automation; metered automation stops; and a floor nobody watches is the one it stops on
//   quietly. Nothing in either core module can see that, because it is a fact about which files
//   exist.
//
// Fixture trees are written to a temp directory and removed; nothing here touches the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_ID as KEEPER_SCHEMA_ID } from '../core/floor-keeper.mjs';
import { BANNERS, NOTICE_PLACEMENT, SCHEMA_ID as DEGRADATION_SCHEMA_ID } from '../core/floor-degradation.mjs';
import { evaluate, run } from './floor-keeper-check.mjs';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const DAY = 86400000;

const REGISTRY = {
  groups: { builders: 'first line', 'second-line': 'independent' },
  identities: [
    { id: 'agent-floor-keeper', kind: 'agent', display: 'Floor-keeper', roles: [], groups: ['builders'] },
    { id: 'svc-floor-watcher', kind: 'agent', display: 'Floor watcher', roles: [], groups: ['builders'] },
    { id: 'ops-dana', kind: 'human', display: 'Dana', roles: ['operations'], groups: [] },
    { id: 'infosec-noor', kind: 'human', display: 'Noor', roles: ['information-security'], groups: [] },
  ],
};

const DRAFTS = { id: 'db-prd-drafts', kind: 'database', authoritative: false, fields: ['Title', 'Stage'], prefill: ['Stage'] };
const APPROVALS = { id: 'db-approvals', kind: 'database', authoritative: true, fields: ['Change', 'Approved By'] };

const REGISTER = {
  schema: KEEPER_SCHEMA_ID,
  containers: [DRAFTS, APPROVALS],
  keepers: [{ identity: 'agent-floor-keeper', write_scope: ['views', 'conversation'], grants: [{ container: 'db-prd-drafts', level: 'can-edit' }] }],
  audit: { audited_at: '2026-07-15T00:00:00Z', audited_by: 'infosec-noor', containers_enumerated: ['db-prd-drafts', 'db-approvals'] },
};

const observation = (over = {}) => ({
  schema: DEGRADATION_SCHEMA_ID,
  observed_at: new Date(NOW - 3600_000).toISOString(),
  observed_by: 'svc-floor-watcher',
  credits: { state: 'available' },
  automation: { agents: 'running', workers: 'running' },
  projection: { state: 'current', depends_on_credits: false },
  ...over,
});

const degradedObservation = (over = {}) => observation({
  since: new Date(NOW - 7200_000).toISOString(),
  credits: { state: 'exhausted' },
  automation: { agents: 'paused', workers: 'paused' },
  notice: { visible: true, dismissible: false, placement: NOTICE_PLACEMENT, severity: 'degraded', banner: BANNERS.get('degraded') },
  reconciliation: { ran_at: new Date(NOW - 5400_000).toISOString(), ran_by: 'ops-dana' },
  manual_fallback: { runbook: 'docs/governance/runbooks/floor-degradation.md', owner: 'ops-dana' },
  ...over,
});

/** A repository tree. Pass `register: null` or `observations: []` to leave that half out. */
function repo({ register = REGISTER, observations = [observation()], registry = REGISTRY, raw = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fk-'));
  mkdirSync(join(dir, 'docs/governance'), { recursive: true });
  if (registry) writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(registry));
  if (register) writeFileSync(join(dir, 'docs/governance/floor-keepers.json'), raw ?? JSON.stringify(register));
  if (observations.length || raw !== null) {
    mkdirSync(join(dir, 'docs/governance/floor-degradation'), { recursive: true });
    for (const [i, o] of observations.entries()) {
      writeFileSync(join(dir, `docs/governance/floor-degradation/${String(i).padStart(3, '0')}.json`), JSON.stringify(o));
    }
  }
  return dir;
}

const withRepo = (opts, fn) => { const dir = repo(opts); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const has = (findings, code) => findings.some((f) => f.startsWith(`${code}:`));

// ── silence where unadopted ──────────────────────────────────────────────────────────────────────

test('a repository with no register and no observation is silent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fk-'));
  try {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.adopted, false);
    assert.equal(r.keepers, 0);
    assert.equal(r.observations, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repository with only an identity registry is still silent — the floor is the trigger', () => {
  withRepo({ register: null, observations: [] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.adopted, false);
  });
});

// ── the adopted, clean case ──────────────────────────────────────────────────────────────────────

test('a register with keepers and a fresh liveness observation passes', () => {
  withRepo({}, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.adopted, true);
    assert.equal(r.keepers, 1);
    assert.equal(r.observations, 1);
    assert.equal(r.worst.status, 'live');
  });
});

test('a truthfully-degraded floor passes the gate and reports its status', () => {
  // D6.4 working, not failing. A gate that failed here would make the honest record the expensive
  // one, and the honest record is the deliverable.
  withRepo({ observations: [degradedObservation()] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.worst.status, 'degraded');
  });
});

// ── the absence that is a finding ────────────────────────────────────────────────────────────────

test('keepers declared with no liveness observation at all is refused', () => {
  // The wiring rule neither core module can see. Without it, the way to a green gate is to declare
  // the keepers and never look at whether they are running — which is T-13 exactly.
  withRepo({ observations: [] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'DG-R08'), r.findings.join('\n'));
    assert.ok(r.findings.some((f) => /metered automation/.test(f)));
  });
});

test('an observation with no register is checked on its own', () => {
  // The other direction: a floor can be watched before any keeper is declared, and that is fine.
  withRepo({ register: null, observations: [observation()] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.adopted, true);
    assert.equal(r.keepers, 0);
  });
});

test('a stale newest observation is refused where keepers are declared', () => {
  withRepo({ observations: [observation({ observed_at: new Date(NOW - 5 * DAY).toISOString() })] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'DG-R08'), r.findings.join('\n'));
  });
});

test('an older observation alongside a fresh one does not go red', () => {
  withRepo({ observations: [observation({ observed_at: '2026-01-01T00:00:00Z' }), observation()] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.observations, 2);
  });
});

// ── the grant findings reach the gate ────────────────────────────────────────────────────────────

test('a grant on the approval container fails the gate', () => {
  const bad = { ...REGISTER, keepers: [{ ...REGISTER.keepers[0], grants: [{ container: 'db-approvals', level: 'can-view' }] }] };
  withRepo({ register: bad }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'FK-R03'), r.findings.join('\n'));
  });
});

test('a stale grant audit fails the gate, and --max-age-days moves the window', () => {
  const old = { ...REGISTER, audit: { ...REGISTER.audit, audited_at: new Date(NOW - 60 * DAY).toISOString() } };
  withRepo({ register: old }, (dir) => {
    assert.ok(has(run(dir, { now: NOW }).findings, 'FK-R09'));
    assert.deepEqual(run(dir, { now: NOW, maxAgeDays: 90 }).findings, []);
  });
});

test('the registry is read from the repository, so a keeper holding a role fails the gate', () => {
  const registry = { ...REGISTRY, identities: REGISTRY.identities.map((i) => (i.id === 'agent-floor-keeper' ? { ...i, roles: ['risk-second-line'] } : i)) };
  withRepo({ registry }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'FK-R02'), r.findings.join('\n'));
  });
});

test('a register that is not JSON is refused, not read as empty', () => {
  withRepo({ raw: '{ not json' }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'FK-R01'), r.findings.join('\n'));
    assert.equal(r.adopted, true);
  });
});

test('an observation file that is not JSON is refused', () => {
  const dir = repo({ observations: [] });
  try {
    mkdirSync(join(dir, 'docs/governance/floor-degradation'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/floor-degradation/000.json'), '{ nope');
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'DG-R01'), r.findings.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a degraded observation that claims to be live fails the gate', () => {
  withRepo({ observations: [degradedObservation({ status: 'live' })] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'DG-R02'), r.findings.join('\n'));
  });
});

test('a paused floor with no visible notice fails the gate', () => {
  withRepo({ observations: [degradedObservation({ notice: undefined })] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.ok(has(r.findings, 'DG-R03'), r.findings.join('\n'));
  });
});

// ── evaluate() without a filesystem ─────────────────────────────────────────────────────────────

test('evaluate() takes loaded objects, so the wiring rule is testable without a tree', () => {
  const nothing = evaluate({ register: REGISTER, observations: [], registry: REGISTRY }, { now: NOW });
  assert.ok(has(nothing.findings, 'DG-R08'));
  const ok = evaluate({ register: REGISTER, observations: [{ name: 'a.json', record: observation() }], registry: REGISTRY }, { now: NOW });
  assert.deepEqual(ok.findings, []);
  assert.equal(ok.keepers, 1);
  assert.equal(ok.worst.status, 'live');
});

test('evaluate() with an empty register demands no observation — an empty floor is not an unwatched one', () => {
  const r = evaluate({ register: { ...REGISTER, keepers: [] }, observations: [], registry: REGISTRY }, { now: NOW });
  assert.deepEqual(r.findings, []);
  assert.equal(r.worst, null);
});

test('the gate names the WORST observation, not the newest', () => {
  const r = evaluate({
    register: REGISTER,
    registry: REGISTRY,
    observations: [
      { name: 'a.json', record: degradedObservation({
        observed_at: new Date(NOW - 7200_000).toISOString(),
        since: new Date(NOW - 10800_000).toISOString(),
        reconciliation: { ran_at: new Date(NOW - 9000_000).toISOString(), ran_by: 'ops-dana' },
      }) },
      { name: 'b.json', record: observation() },
    ],
  }, { now: NOW });
  assert.deepEqual(r.findings, []);
  assert.equal(r.worst.status, 'degraded');
});
