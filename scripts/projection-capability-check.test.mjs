// Tests for the projection-capability gate (Factory Floor WS1 acceptance). Node built-in runner.
//
// The claim on trial is a negative one — "the projector's credentials cannot write git" — and a
// negative is the easiest thing in the world to assert and the hardest to evidence. So every test
// below is written against the version of this gate that trusts what it is told: a record that
// simply DECLARES read-only, a probe nobody ran, a probe the projector ran on itself, a probe from
// last year. Each of those passes if the corresponding control is absent, and each is the ordinary
// case rather than the malicious one — which is why they are gates and not conventions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NON_AUTHORITATIVE, project } from '../core/floor-project.mjs';
import {
  ALLOWED,
  DEFAULT_MAX_AGE_DAYS,
  FORBIDDEN,
  SCHEMA_ID,
  capabilityHash,
  evaluate,
  run,
} from './projection-capability-check.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUERS = { issuers: [
  { id: 'obs', mechanism: 'ed25519', verify: { public_key: PEM } },
  // An issuer that belongs to the subject — the self-signed case, expressed as a registry linkage.
  { id: 'svc-floor-projector-key', mechanism: 'ed25519', identity: 'svc-floor-projector', verify: { public_key: PEM } },
] };
const REGISTRY = { identities: [
  { id: 'svc-floor-projector', kind: 'agent', roles: [], groups: ['builders'] },
  { id: 'padmin-zoe', kind: 'human', roles: ['platform-admin'], groups: ['platform-admins'] },  // the independent observer
  { id: 'eng-omar', kind: 'human', roles: ['engineering'], groups: ['builders'] },              // inside write authority
  { id: 'agent-loom-delivery', kind: 'agent', roles: [], groups: ['builders'] },
] };

const NOW = Date.parse('2026-07-26T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();

/** A fully-probed, independently-observed, freshly-signed capability record. */
function record(over = {}, { issuer = 'obs', probeOver = {} } = {}) {
  const base = {
    schema: SCHEMA_ID,
    subject_identity: 'svc-floor-projector',
    surface: 'collaboration-workspace',
    observer_identity: 'padmin-zoe',
    observed_at: iso(2),
    granted: ['read_git', 'read_surface', 'write_surface_projection'],
    probes: [...FORBIDDEN.keys()].map((capability) => ({
      capability,
      attempted: `${capability.replace(/_/g, ' ')} attempted with the projector's live credential`,
      result: 'refused',
      observed: 'HTTP 403 — resource not accessible by integration',
      tested_at: iso(2),
      ...probeOver,
    })),
    ...over,
  };
  base.attestation = { issuer, signature: sign(null, Buffer.from(capabilityHash(base), 'utf8'), privateKey).toString('base64') };
  return base;
}
const ev = (r, over = {}) => evaluate(r, { issuers: ISSUERS, registry: REGISTRY, now: NOW, ...over });
const has = (findings, re) => findings.some((f) => re.test(f));

// --- the observation that counts --------------------------------------------------------------------

test('a fresh, independently-signed record with every forbidden capability probed and refused passes', () => {
  assert.deepEqual(ev(record()), []);
});

test('the matrix row is complete — eight no-cells probed, three yes-cells granted', () => {
  assert.equal(FORBIDDEN.size, 8);
  assert.deepEqual([...ALLOWED.keys()], ['read_git', 'read_surface', 'write_surface_projection']);
  for (const cap of FORBIDDEN.keys()) assert.ok(!ALLOWED.has(cap), `${cap} cannot be both`);
});

// --- a record that CLAIMS git write ---------------------------------------------------------------

// NEGATIVE — the whole point of WS1's acceptance. A gate that only checked the probes would pass a
// credential that openly holds the write, because its probes would still all be refusals of
// something else.
test('a record whose credential HOLDS git write is refused', () => {
  const f = ev(record({ granted: ['read_git', 'write_git_branch', 'write_surface_projection'] }));
  assert.ok(has(f, /PJ-R21.*HOLDS `write_git_branch`/));
  assert.ok(has(f, /not a one-way projection any more/));
});

test('a credential holding merge, control-plane write or approval assertion is refused', () => {
  for (const cap of ['merge_pr', 'write_control_plane', 'issue_approval_assertion', 'read_webhooks']) {
    assert.ok(has(ev(record({ granted: ['read_git', cap] })), new RegExp(`PJ-R21.*HOLDS \`${cap}\``)), cap);
  }
});

test('a capability the matrix does not name is refused, not assumed harmless', () => {
  assert.ok(has(ev(record({ granted: ['read_git', 'write_comments'] })), /PJ-R21.*`write_comments` is not a capability the matrix names/));
});

test('a record that states no grants at all is refused — an unstated grant is an unreviewed one', () => {
  const r = record(); delete r.granted;
  assert.ok(has(ev(r), /PJ-R21.*`granted` must list what the credential actually holds/));
});

// --- self-signed, self-observed --------------------------------------------------------------------

// NEGATIVE — a credential reporting on its own limits is exactly the declaration this gate replaces.
test('a record the subject observed itself is refused', () => {
  assert.ok(has(ev(record({ observer_identity: 'svc-floor-projector' })), /PJ-R22.*the subject observed itself/));
});

test('a record signed by the subject\'s own issuer is refused', () => {
  assert.ok(has(ev(record({}, { issuer: 'svc-floor-projector-key' })), /PJ-R22.*belongs to the subject — self-signed/));
  assert.ok(has(ev(record({ }, { issuer: 'svc-floor-projector' })), /PJ-R22|PJ-R25/));
});

test('an observer inside the write authority being probed is refused', () => {
  assert.ok(has(ev(record({ observer_identity: 'eng-omar' })), /PJ-R22.*inside the write authority being probed/));
  assert.ok(has(ev(record({ observer_identity: 'agent-loom-delivery' })), /PJ-R22.*is kind "agent" — a probe is witnessed by a person/));
});

test('an unresolved or absent observer is refused', () => {
  assert.ok(has(ev(record({ observer_identity: 'ghost' })), /PJ-R22.*does not resolve/));
  const r = record(); delete r.observer_identity;
  assert.ok(has(ev(r), /PJ-R22.*no observer_identity/));
});

// --- staleness --------------------------------------------------------------------------------------

// NEGATIVE — a year-old probe of a token widened in March proves nothing about April.
test('a stale observation is refused', () => {
  assert.ok(has(ev(record({ observed_at: iso(45) })), /PJ-R23.*observation is 45 days old \(limit 30\)/));
});

test('a stale probe is refused even when the observation is fresh', () => {
  assert.ok(has(ev(record({}, { probeOver: { tested_at: iso(120) } })), /PJ-R23.*probed 120 days ago/));
});

test('the window is 30 days, not the platform gate\'s 365 — the seam\'s freshness target is minutes', () => {
  assert.equal(DEFAULT_MAX_AGE_DAYS, 30);
  assert.deepEqual(ev(record({ observed_at: iso(200) }, { probeOver: { tested_at: iso(200) } }), { maxAgeDays: 365 }), []);
});

test('an observation or a probe dated in the future is refused', () => {
  assert.ok(has(ev(record({ observed_at: iso(-3) })), /PJ-R23.*observed_at.*is in the future/));
  assert.ok(has(ev(record({}, { probeOver: { tested_at: iso(-3) } })), /PJ-R23.*is in the future/));
});

test('an unparseable timestamp is refused rather than skipped', () => {
  assert.ok(has(ev(record({ observed_at: 'last Tuesday' })), /PJ-R23.*no ISO-8601 observed_at/));
});

// --- the probes themselves ---------------------------------------------------------------------------

// NEGATIVE — the config-file version of this control: it says read-only, so it must be read-only.
test('a record with no probes at all is refused — the matrix is asserted, not observed', () => {
  const r = record(); delete r.probes;
  const f = ev(r);
  assert.ok(has(f, /PJ-R27.*no probes array/));
  for (const cap of FORBIDDEN.keys()) assert.ok(has(f, new RegExp(`PJ-R27.*\`${cap}\` was never probed`)), cap);
  assert.ok(has(f, /Asserted separation is documentation; probed separation is a control/));
});

test('a partial probe set is refused — probing seven of eight discharges seven', () => {
  const r = record();
  r.probes = r.probes.filter((p) => p.capability !== 'merge_pr');
  assert.ok(has(ev(r), /PJ-R27.*`merge_pr` was never probed/));
});

test('a probe whose result is not "refused" is refused', () => {
  assert.ok(has(ev(record({}, { probeOver: { result: 'allowed' } })), /PJ-R24.*result is "allowed", not "refused"/));
  assert.ok(has(ev(record({}, { probeOver: { result: 'not applicable' } })), /PJ-R24.*the platform did not refuse the write/));
});

test('a probe that names no attempted action is refused — "we checked" is not a probe', () => {
  const r = record();
  for (const p of r.probes) delete p.attempted;
  assert.ok(has(ev(r), /PJ-R24.*names no attempted action/));
});

test('probing something the matrix does not forbid does not discharge what it does', () => {
  const r = record();
  r.probes.push({ capability: 'read_git', attempted: 'read', result: 'refused', tested_at: iso(1) });
  assert.ok(has(ev(r), /PJ-R24.*is not one of the capabilities the matrix forbids/));
});

// --- authenticity -------------------------------------------------------------------------------------

test('a tampered record fails the signature — widening `granted` after signing breaks it', () => {
  const r = record();
  r.granted.push('merge_pr');
  const f = ev(r);
  assert.ok(has(f, /PJ-R25.*does NOT verify/));
  assert.ok(has(f, /PJ-R21.*HOLDS `merge_pr`/));
});

test('an unsigned record, or one from an unregistered issuer, is refused', () => {
  const r = record(); delete r.attestation;
  assert.ok(has(ev(r), /PJ-R25.*no attestation/));
  assert.ok(has(ev(record({}, { issuer: 'someone-else' })), /PJ-R25.*not in the allowed-issuers registry/));
});

// --- the subject ----------------------------------------------------------------------------------------

test('a record about any identity but the projector is refused', () => {
  assert.ok(has(ev(record({ subject_identity: 'svc-floor-freezer' })), /PJ-R26.*subject_identity must be svc-floor-projector/));
});

test('a projector that holds a role in the registry is refused', () => {
  const registry = { identities: [{ id: 'svc-floor-projector', kind: 'agent', roles: ['product-owner'], groups: ['builders'] }, ...REGISTRY.identities.slice(1)] };
  assert.ok(has(ev(record(), { registry }), /PJ-R26.*holds roles.*a service with an approval role/));
});

test('a projector missing from the registry, a wrong schema and a nameless surface are each refused', () => {
  assert.ok(has(ev(record(), { registry: { identities: [] } }), /PJ-R26.*does not resolve in the identity registry/));
  assert.ok(has(ev(record({ schema: 'other/v1' })), /PJ-R26.*is not loom\.projection-capability\/v1/));
  const r = record(); delete r.surface;
  assert.ok(has(ev(r), /PJ-R26.*names no surface/));
});

// --- the filesystem half -----------------------------------------------------------------------------------

/** A repository laid out the way an adopter's would be. */
function repo({ capability = null, payloads = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pj-'));
  const gov = join(dir, 'docs/governance');
  mkdirSync(gov, { recursive: true });
  writeFileSync(join(gov, 'attestation-issuers.json'), JSON.stringify(ISSUERS));
  writeFileSync(join(gov, 'identities.json'), JSON.stringify(REGISTRY));
  if (capability) {
    mkdirSync(join(gov, 'projection-capability'), { recursive: true });
    writeFileSync(join(gov, 'projection-capability/svc-floor-projector.json'), JSON.stringify(capability));
  }
  if (payloads.length) {
    mkdirSync(join(gov, 'projection'), { recursive: true });
    payloads.forEach((p, i) => writeFileSync(join(gov, `projection/cycle-${i}.json`), typeof p === 'string' ? p : JSON.stringify(p)));
  }
  return dir;
}
const withRepo = (opts, fn) => { const dir = repo(opts); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

const PAYLOAD = project(
  { backlog: [{ id: 'STORY-12', title: 'Affordability check', state: 'pending' }] },
  { projectedAt: '2026-07-26T09:00:00Z', source: { sha: 'a1b2c3' } },
).payload;

// Silence where unadopted: an adopter running no external surface must not be handed a red gate for
// a capability they may never switch on.
test('a repository that projects nothing is a clean no-op', () => {
  withRepo({}, (dir) => {
    assert.deepEqual(run(dir, { now: NOW }), { findings: [], records: 0, payloads: 0, adopted: false });
  });
});

test('a repository with a projection AND a verified capability record passes', () => {
  withRepo({ capability: record(), payloads: [PAYLOAD] }, (dir) => {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.equal(r.records, 1);
    assert.equal(r.payloads, 1);
    assert.equal(r.adopted, true);
  });
});

// NEGATIVE — the state every adoption passes through, and the one that must not stay quiet.
test('a projection with no capability record is refused — declared read-only, never observed', () => {
  withRepo({ payloads: [PAYLOAD] }, (dir) => {
    assert.ok(has(run(dir, { now: NOW }).findings, /PJ-R20.*DECLARED read-only and has never been observed/));
  });
});

test('a capability record with no projection yet is fine — probed before publishing', () => {
  withRepo({ capability: record() }, (dir) => {
    assert.deepEqual(run(dir, { now: NOW }).findings, []);
  });
});

// NEGATIVE — the payload half. Without this the gate would bless a board that reads as the record.
test('an unlabelled payload committed under the projection directory is refused', () => {
  const stripped = { ...PAYLOAD };
  delete stripped.banner;
  withRepo({ capability: record(), payloads: [stripped] }, (dir) => {
    assert.ok(has(run(dir, { now: NOW }).findings, /PJ-R01.*banner is missing or altered/));
  });
});

test('a payload carrying personal data or a field outside the ceiling is refused at the gate', () => {
  const leaky = JSON.parse(JSON.stringify(PAYLOAD));
  leaky.records[0].fields.title = 'chase 784-1990-1234567-1';
  leaky.records[0].fields.customer_note = 'called twice';
  withRepo({ capability: record(), payloads: [leaky] }, (dir) => {
    const f = run(dir, { now: NOW }).findings;
    assert.ok(has(f, /PJ-R04.*Emirates-ID-shaped literal/));
    assert.ok(has(f, /PJ-R02.*`customer_note` has no entry/));
  });
});

test('a file in the projection directory that is not JSON is refused, not skipped', () => {
  withRepo({ capability: record(), payloads: ['{ not json'] }, (dir) => {
    assert.ok(has(run(dir, { now: NOW }).findings, /PJ-R01.*not a labelled projection/));
  });
});

test('an unreadable capability record is a finding, not a skip', () => {
  withRepo({ capability: record() }, (dir) => {
    writeFileSync(join(dir, 'docs/governance/projection-capability/svc-floor-projector.json'), '{ nope');
    assert.ok(has(run(dir, { now: NOW }).findings, /PJ-R26.*not readable as JSON/));
  });
});

test('the shipped payload label survives the round trip through disk', () => {
  assert.equal(PAYLOAD.banner, NON_AUTHORITATIVE);
  withRepo({ capability: record(), payloads: [PAYLOAD] }, (dir) => {
    assert.deepEqual(run(dir, { now: NOW }).findings, []);
  });
});
