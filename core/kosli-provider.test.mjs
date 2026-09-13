// Tests for the Kosli provider adapter (2.1.0, plan rows 2.2–2.3) — every argv it builds, against the fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FLOWS, beginTrail, flowName, globalArgs, post, readTrail, resolve, trailStatus } from './providers/kosli.mjs';
import { calls, createFakeKosli, respond } from './kosli-fake.mjs';

const withFake = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'kosli-prov-'));
  try { const { bin } = createFakeKosli(dir); return await fn({ dir, env: { ...process.env, KOSLI_BIN: bin } }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};
const ENVELOPE = { schema: 'loom.record-envelope/v1', kind: 'gate', name: 'gate.x', subject: { flow: 'delivery', trail: 'CHG-1' }, commit: 'a'.repeat(40), compliant: false, actor: { id: 'agent-loom-delivery' }, attachments: ['docs/governance/evidence/gate-run.json'], payload: {} };
const trail = (rows) => ({ name: 'CHG-1', compliance_status: { status: 'INCOMPLETE', is_compliant: false, attestations_statuses: rows, artifacts_statuses: { app: { attestations_statuses: [{ attestation_name: 'sbom', attestation_type: 'generic', attestation_id: 'art-1', status: 'COMPLETE', is_compliant: true, unexpected: false }] } } }, events: [{ type: 'trail_reported', timestamp: 1 }] });

test('global args carry org and a non-default host, never a placeholder and never a token', () => {
  assert.deepEqual(globalArgs({ org: 'acme', host: 'https://app.kosli.com' }), ['--org', 'acme']);
  assert.deepEqual(globalArgs({ org: 'acme', host: 'https://kosli.bank.internal' }), ['--org', 'acme', '--host', 'https://kosli.bank.internal']);
  assert.deepEqual(globalArgs({ org: 'ADOPT: your org' }), []);
  assert.deepEqual(globalArgs({}), []);
});

test('the flow name maps through config, then the defaults, then passes through', () => {
  assert.equal(flowName({ flow: 'delivery' }, { flows: { delivery: 'bank-delivery' } }), 'bank-delivery');
  assert.equal(flowName({ flow: 'discovery' }, {}), DEFAULT_FLOWS.discovery);
  assert.equal(flowName({ flow: 'custom' }, {}), 'custom');
});

test('post: begin trail (idempotent) → attest generic with user-data, compliant flag, annotations, commit, attachments → id from get trail', () => withFake(async ({ dir, env }) => {
  respond(dir, ['get', 'trail'], { stdout: trail([{ attestation_name: 'gate.x', attestation_type: 'generic', attestation_id: 'id-7', status: 'COMPLETE', is_compliant: false, unexpected: false }]) });
  const r = await post(ENVELOPE, { env, config: { org: 'acme' } });
  assert.deepEqual(r, { ok: true, id: 'id-7', ref: { provider: 'kosli', flow: 'loom-delivery', trail: 'CHG-1', name: 'gate.x', id: 'id-7' } });
  const [begin, attest, get] = calls(dir).map((c) => c.argv);
  assert.deepEqual(begin.slice(0, 5), ['begin', 'trail', 'CHG-1', '--flow', 'loom-delivery']);
  assert.ok(begin.includes('--commit') && begin.includes('a'.repeat(40)));
  assert.equal(attest[0], 'attest'); assert.equal(attest[1], 'generic');
  assert.equal(attest[attest.indexOf('--name') + 1], 'gate.x');
  assert.equal(attest[attest.indexOf('--trail') + 1], 'CHG-1');
  assert.ok(attest.includes('--user-data'), 'the envelope travels as user-data');
  assert.ok(attest.includes('--compliant=false'));
  assert.ok(attest.includes('loom_kind=gate') && attest.includes('loom_actor=agent-loom-delivery'));
  assert.equal(attest[attest.indexOf('--attachments') + 1], 'docs/governance/evidence/gate-run.json');
  assert.deepEqual(attest.slice(-2), ['--org', 'acme']);
  assert.deepEqual(get.slice(0, 7), ['get', 'trail', 'CHG-1', '--flow', 'loom-delivery', '--output', 'json']);
}));

test('post fails at the stage that failed, with the CLI\'s own stderr — begin, attest, or the id read-back', () => withFake(async ({ dir, env }) => {
  respond(dir, ['begin'], { exit: 1, stderr: 'Error: org is required' });
  const a = await post(ENVELOPE, { env });
  assert.equal(a.ok, false); assert.equal(a.stage, 'begin-trail'); assert.match(a.error, /org is required/);
  respond(dir, ['get', 'trail'], { stdout: trail([]) });
  const { writeFileSync } = await import('node:fs'); writeFileSync(join(dir, 'responses.json'), '[]\n');
  respond(dir, ['get', 'trail'], { stdout: trail([]) });
  const b = await post(ENVELOPE, { env });
  assert.equal(b.ok, false); assert.equal(b.stage, 'read-id'); assert.match(b.error, /lists no id/);
}));

test('a dry run passes --dry-run to begin and attest and skips the read-back', () => withFake(async ({ dir, env }) => {
  const r = await post(ENVELOPE, { env, dryRun: true });
  assert.equal(r.ok, true); assert.equal(r.dry_run, true); assert.equal(r.id, null);
  assert.deepEqual(calls(dir).map((c) => c.argv[0]), ['begin', 'attest']);
  assert.ok(calls(dir).every((c) => c.argv.includes('--dry-run')));
}));

test('readTrail flattens trail-level and artifact-level attestations; trailStatus splits present/missing/unexpected', () => withFake(async ({ dir, env }) => {
  respond(dir, ['get', 'trail'], { stdout: trail([
    { attestation_name: 'gate.x', attestation_type: 'generic', attestation_id: 'id-1', status: 'COMPLETE', is_compliant: true, unexpected: false },
    { attestation_name: 'gate.y', attestation_type: 'generic', attestation_id: null, status: 'MISSING', is_compliant: null, unexpected: false },
    { attestation_name: 'stray', attestation_type: 'generic', attestation_id: 'id-9', status: 'COMPLETE', is_compliant: true, unexpected: true },
  ]) });
  const t = readTrail({ flow: 'f', trail: 'CHG-1' }, { env });
  assert.equal(t.ok, true); assert.equal(t.attestations.length, 4);
  assert.equal(t.attestations.find((a) => a.name === 'sbom').artifact, 'app');
  const s = await trailStatus({ flow: 'delivery', trail: 'CHG-1' }, { env });
  assert.deepEqual(s.present.map((a) => a.name), ['gate.x', 'stray', 'sbom']);
  assert.deepEqual(s.missing, ['gate.y']);
  assert.deepEqual(s.unexpected, ['stray']);
  assert.equal(s.compliance, 'INCOMPLETE');
}));

test('readTrail: a CLI failure is an error; a missing binary is unavailable; non-JSON output is unavailable', () => withFake(async ({ dir, env }) => {
  respond(dir, ['get', 'trail', 'nope'], { exit: 1, stderr: 'Error: trail not found' });
  respond(dir, ['get', 'trail', 'prose'], { stdout: 'not json' });
  assert.match(readTrail({ flow: 'f', trail: 'nope' }, { env }).error, /not found/);
  assert.equal(readTrail({ flow: 'f', trail: 'prose' }, { env }).unavailable, true);
  assert.equal(readTrail({ flow: 'f', trail: 'x' }, { env: { ...process.env, KOSLI_BIN: '/nowhere' } }).unavailable, true);
}));

test('resolve by id checks the name when one is given; resolve by trail+name reads the trail; a bare ref is refused', () => withFake(async ({ dir, env }) => {
  respond(dir, ['get', 'attestation', '--attestation-id', 'id-1'], { stdout: { attestation_name: 'gate.x', attestation_type: 'generic', is_compliant: true, created_at: 1, html_url: 'u' } });
  respond(dir, ['get', 'trail'], { stdout: trail([{ attestation_name: 'gate.x', attestation_type: 'generic', attestation_id: 'id-1', status: 'COMPLETE', is_compliant: true, unexpected: false }]) });
  assert.equal((await resolve({ id: 'id-1', name: 'gate.x' }, { env })).ok, true);
  assert.match((await resolve({ id: 'id-1', name: 'gate.z' }, { env })).error, /is "gate.x", not "gate.z"/);
  assert.equal((await resolve({ trail: 'CHG-1', name: 'gate.x' }, { env })).record.attestation_id, 'id-1');
  assert.match((await resolve({ trail: 'CHG-1', name: 'gate.q' }, { env })).error, /holds no attestation named/);
  assert.match((await resolve({}, { env })).error, /needs an id/);
}));

test('beginTrail carries description and commit, and nothing else it was not given', () => withFake(async ({ dir, env }) => {
  beginTrail({ flow: 'f', trail: 't' }, { env });
  beginTrail({ flow: 'f', trail: 't', description: 'd', commit: 'c'.repeat(40) }, { env, config: { org: 'o' } });
  const [a, b] = calls(dir).map((c) => c.argv);
  assert.deepEqual(a, ['begin', 'trail', 't', '--flow', 'f']);
  assert.deepEqual(b, ['begin', 'trail', 't', '--flow', 'f', '--description', 'd', '--commit', 'c'.repeat(40), '--org', 'o']);
}));

/* ---- 2.1.0 rows 2.9/2.10: renderings and the snapshot ---- */
import { environmentSnapshot } from './providers/kosli.mjs';

test('environmentSnapshot reads `get snapshot ENV --output json` as a list or an {artifacts} object; failures are told apart', () => withFake(async ({ dir, env }) => {
  respond(dir, ['get', 'snapshot', 'prod'], { stdout: [{ artifact: 'app:1', fingerprint: 'ab'.repeat(32), flow: 'f', git_commit: 'c', replicas: 1, running_since: 's' }] });
  respond(dir, ['get', 'snapshot', 'stage'], { stdout: { artifacts: [{ artifact: 'app:2', fingerprint: 'cd'.repeat(32) }] } });
  respond(dir, ['get', 'snapshot', 'gone'], { exit: 1, stderr: 'Error: environment not found' });
  const p = environmentSnapshot('prod', { env, config: { org: 'o' } });
  assert.equal(p.ok, true); assert.equal(p.artifacts[0].fingerprint, 'ab'.repeat(32));
  assert.deepEqual(calls(dir)[0].argv, ['get', 'snapshot', 'prod', '--output', 'json', '--org', 'o']);
  assert.equal(environmentSnapshot('stage', { env }).artifacts[0].artifact, 'app:2');
  assert.match(environmentSnapshot('gone', { env }).error, /not found/);
  assert.equal(environmentSnapshot('x', { env: { ...process.env, KOSLI_BIN: '/nowhere' } }).unavailable, true);
}));
