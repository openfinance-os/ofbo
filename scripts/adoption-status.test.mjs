// Tests for the adoption state machine (rc.14 · WS5). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStatus, unresolvedMarkers, runMechanism } from './adoption-status.mjs';
import { evaluate, attestationHash } from './adoption-attest.mjs';
import { activationHash } from './platform-activation-check.mjs';

// A tiny adopted repo: a catalog + some governance files (optionally still carrying ADOPT markers).
function repo({ controls, files = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'ad-'));
  mkdirSync(join(dir, 'docs/governance'), { recursive: true });
  writeFileSync(join(dir, 'docs/governance/control-catalog.json'), JSON.stringify({ controls }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

test('unresolvedMarkers finds ADOPT / @your-org / draft markers', () => {
  const dir = repo({ controls: [], files: { 'docs/governance/x.json': '{"owner":"@your-org/team"}', 'docs/governance/y.json': '{"ok":true}' } });
  try {
    const u = unresolvedMarkers(dir);
    assert.ok(u.includes('docs/governance/x.json'));
    assert.ok(!u.includes('docs/governance/y.json'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('computeStatus projects the five stages from the catalog; a validated code control is installed+validated', () => {
  const dir = repo({ controls: [{ control_id: 'A', state: 'mechanically-validated', mechanism_ref: 'scripts/a.mjs' }] });
  try {
    const s = computeStatus(dir);
    const a = s.capabilities.find((c) => c.control_id === 'A');
    assert.equal(a.installed, true);
    assert.equal(a.validated, true);
    assert.equal(a.platform, false);       // bundle ships 0 platform-enforced
    assert.equal(a.organisation, false);
    assert.equal(s.adoptPending, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- the catalog grade is not a repository verdict (the `passing` column) ------------------
//
// The bug these cover: `validated` reads the CATALOG, so a fresh adoption with nine red gates
// still printed a full column of "yes". Both facts are true and only one is a green board, so
// `passing` must be a separate, EXECUTED answer that can never be inferred from the grade.

const spawnStub = (byRef) => (_exec, [ref]) => ({ status: byRef[ref] ?? 0 });

test('passing is undefined unless --run — the projection never implies it asked', () => {
  const dir = repo({ controls: [{ control_id: 'A', state: 'mechanically-validated', mechanism_ref: 'scripts/a.mjs' }] });
  try {
    const a = computeStatus(dir).capabilities[0];
    assert.equal(a.validated, true);
    assert.equal(a.passing, undefined);
    assert.equal(computeStatus(dir).ran, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--run reports a FAILING gate whose catalog grade is mechanically-validated', () => {
  // The exact shape of the original defect, asserted: graded yes, passing NO, in one row.
  const dir = repo({
    controls: [{ control_id: 'A', state: 'mechanically-validated', mechanism_ref: 'scripts/a.mjs' }],
    files: { 'scripts/a.mjs': '// present so it is runnable\n' },
  });
  try {
    const s = computeStatus(dir, { run: true, spawn: spawnStub({ 'scripts/a.mjs': 1 }) });
    const a = s.capabilities[0];
    assert.equal(a.validated, true, 'the catalog still grades it validated');
    assert.equal(a.passing, false, 'but it does NOT pass in this repository');
    assert.deepEqual(s.failing, ['A']);
    assert.equal(s.ran, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--run reports a passing gate as passing', () => {
  const dir = repo({
    controls: [{ control_id: 'A', state: 'mechanically-validated', mechanism_ref: 'scripts/a.mjs' }],
    files: { 'scripts/a.mjs': '\n' },
  });
  try {
    const s = computeStatus(dir, { run: true, spawn: spawnStub({ 'scripts/a.mjs': 0 }) });
    assert.equal(s.capabilities[0].passing, true);
    assert.deepEqual(s.failing, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing runnable to ask returns null, never true — "not asked" must not look like "passed"', () => {
  const never = () => { throw new Error('must not spawn'); };
  // A documented control (no mechanism), a shell hook, a mechanism file that is not present,
  // and an execute:false control enforced via another gate: all null, none of them true.
  assert.equal(runMechanism({ control_id: 'D', doc_ref: 'docs/x.md' }, '/nowhere', never), null);
  assert.equal(runMechanism({ mechanism_ref: '.claude/hooks/pii-guard.sh' }, '/nowhere', never), null);
  assert.equal(runMechanism({ mechanism_ref: 'scripts/absent.mjs' }, '/nowhere', never), null);
  const dir = repo({ controls: [], files: { 'scripts/a.mjs': '\n' } });
  try {
    assert.equal(runMechanism({ mechanism_ref: 'scripts/a.mjs', execute: false }, dir, never), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a spawn that cannot run is null, not a pass — a crashed probe never reads as green', () => {
  const dir = repo({ controls: [], files: { 'scripts/a.mjs': '\n' } });
  try {
    assert.equal(runMechanism({ mechanism_ref: 'scripts/a.mjs' }, dir, () => ({ error: new Error('ENOENT') })), null);
    assert.equal(runMechanism({ mechanism_ref: 'scripts/a.mjs' }, dir, () => ({ status: null })), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a control whose governed path still has a marker is installed but NOT configured', () => {
  const dir = repo({
    controls: [{ control_id: 'B', state: 'mechanically-validated', mechanism_ref: 'scripts/b.mjs', paths: ['docs/governance/b.json'] }],
    files: { 'docs/governance/b.json': '{"team":"@your-org/x"}' },
  });
  try {
    const s = computeStatus(dir);
    const b = s.capabilities.find((c) => c.control_id === 'B');
    assert.equal(b.installed, true);
    assert.equal(b.configured, false);
    assert.equal(s.adoptPending, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unsigned platform-activation claim cannot advance the Platform column', () => {
  const dir = repo({ controls: [{ control_id: 'HG-0001', state: 'defined', doc_ref: 'runbook.md' }] });
  try {
    mkdirSync(join(dir, 'docs/governance/platform-activation'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/platform-activation/x.json'), JSON.stringify({ satisfies_control: 'HG-0001' }));
    writeFileSync(join(dir, 'docs/governance/adoption-attestation.json'), JSON.stringify({ approved_controls: ['HG-0001'] }));
    const status = computeStatus(dir);
    const c = status.capabilities.find((x) => x.control_id === 'HG-0001');
    assert.equal(c.platform, false);
    assert.equal(c.organisation, false);
    assert.ok(status.activationFindings.length > 0);
    assert.ok(status.organisationFindings.length > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh signed and independently observed platform record advances the Platform column', () => {
  const dir = repo({ controls: [{ control_id: 'HG-0001', state: 'defined', doc_ref: 'runbook.md' }] });
  const keys = generateKeyPairSync('ed25519');
  try {
    const now = new Date().toISOString();
    const rec = {
      platform: 'github', repository: 'org/repo', satisfies_control: 'HG-0001', mechanism: 'branch_protection',
      observer_identity: 'padmin', observation: { enforce_admins: true },
      bypass_test: { attempted: 'direct push', result: 'rejected', tested_at: now }, observed_at: now,
    };
    rec.attestation = { issuer: 'observer', signature: sign(null, Buffer.from(activationHash(rec), 'utf8'), keys.privateKey).toString('base64') };
    mkdirSync(join(dir, 'docs/governance/platform-activation'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/platform-activation/x.json'), JSON.stringify(rec));
    writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify({ identities: [{ id: 'padmin', kind: 'human', groups: ['platform-admins'] }] }));
    writeFileSync(join(dir, 'docs/governance/attestation-issuers.json'), JSON.stringify({ issuers: [{ id: 'observer', mechanism: 'ed25519', verify: { public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() } }] }));
    const status = computeStatus(dir);
    assert.equal(status.capabilities.find((x) => x.control_id === 'HG-0001').platform, true);
    assert.deepEqual(status.activationFindings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- attest-adoption ----
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const ISSUERS = { issuers: [{ id: 'org', mechanism: 'ed25519', verify: { public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString() } }] };
const REGISTRY = { identities: [{ id: 'exec', kind: 'human' }, { id: 'agent-x', kind: 'agent' }] };
const clean = { adoptPending: false, unresolved: [] };
function attestation(over = {}) {
  const rec = { attested_at: new Date(Date.parse('2026-07-24T00:00:00Z')).toISOString(), attested_by: 'exec', approved_controls: ['A'], ...over };
  rec.attestation = { issuer: 'org', signature: sign(null, Buffer.from(attestationHash(rec), 'utf8'), privateKey).toString('base64') };
  return rec;
}
const NOW = Date.parse('2026-07-24T00:00:00Z');
const ev = (status, att, over = {}) => evaluate(status, att, { issuers: ISSUERS, registry: REGISTRY, now: NOW, ...over });

test('a verified adoption attestation advances only its approved controls to Organisation', () => {
  const dir = repo({ controls: [{ control_id: 'A', state: 'mechanically-validated', mechanism_ref: 'scripts/a.mjs' }] });
  try {
    const signed = attestation();
    writeFileSync(join(dir, 'docs/governance/adoption-attestation.json'), JSON.stringify(signed));
    writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
    writeFileSync(join(dir, 'docs/governance/attestation-issuers.json'), JSON.stringify(ISSUERS));
    const status = computeStatus(dir);
    assert.equal(status.capabilities[0].organisation, true);
    assert.deepEqual(status.organisationFindings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('attest — a clean, signed, human-attested adoption verifies', () => {
  assert.deepEqual(ev(clean, attestation()), []);
});

test('attest — CANNOT sign while adopt-pending (the F7 rule)', () => {
  const f = ev({ adoptPending: true, unresolved: ['docs/governance/x.json'] }, attestation());
  assert.ok(f.some((x) => /adoption is not complete/.test(x)));
});

test('attest — an agent cannot certify its own adoption', () => {
  assert.ok(ev(clean, attestation({ attested_by: 'agent-x' })).some((x) => /an agent cannot certify/.test(x)));
});

test('attest — a tampered signature fails', () => {
  const a = attestation(); const sig = Buffer.from(a.attestation.signature, 'base64'); sig[0] ^= 0xff;
  a.attestation.signature = sig.toString('base64');
  assert.ok(ev(clean, a).some((x) => /does NOT verify/.test(x)));
});

test('attest — a missing attestation is not attested', () => {
  assert.ok(ev(clean, null).some((x) => /no adoption-attestation/.test(x)));
});
