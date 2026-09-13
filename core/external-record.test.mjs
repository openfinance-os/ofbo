// Tests for the external-record seam (2.1.0, plan rows 2.2–2.5; decision K9) against the Kosli fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OUTBOX_DIR, ROLE, flushOutbox, listOutbox, post, resolve, status, trailStatus } from './external-record.mjs';
import { buildEnvelope, signEnvelope } from './provenance.mjs';
import { calls, createFakeKosli, respond } from './kosli-fake.mjs';

const keys = generateKeyPairSync('ed25519');
const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] };
const PRIV = pem(keys.privateKey, 'pkcs8');
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const REGISTRY = { identities: [{ id: 'agent-loom-delivery', kind: 'agent', model: { provider: 'p', model_id: 'm@1', prompt_version: 'v1' }, harness_role: 'delivery-loop' }] };
const RUNNER = { subject: 'repo:acme/x:ref:refs/heads/main', repository: 'acme/x', ref: 'refs/heads/main', sha: COMMIT };

const envelope = (over = {}) => signEnvelope(buildEnvelope({
  kind: 'gate', name: 'gate.evidence-seal-check', subject: { flow: 'delivery', trail: 'CHG-2026-0042' }, commit: COMMIT,
  actor: { id: 'agent-loom-delivery', kind: 'agent' }, runner: RUNNER,
  payload: { gate: 'scripts/evidence-seal-check.mjs', result: 'pass', controls: ['HG-0003'] }, ...over,
}), { issuer: 'ci-runner', privateKeyPem: PRIV });

/** An adopted tree in a tmp dir: registry, issuers, and (optionally) a mounted Kosli selection. */
function tree({ mount = true, provider = 'kosli', adapterId = 'kosli-external-record' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'xrec-'));
  mkdirSync(join(cwd, 'docs/governance/adapters'), { recursive: true });
  writeFileSync(join(cwd, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  writeFileSync(join(cwd, 'docs/governance/attestation-issuers.json'), JSON.stringify(ISSUERS));
  if (mount) {
    writeFileSync(join(cwd, 'docs/governance/provider-selection.json'), JSON.stringify({ selections: [{ role: ROLE, provider, adapter_id: adapterId, decided_by: 'x', decided_at: '2026-09-13', source: 'y' }] }));
    writeFileSync(join(cwd, 'docs/governance/adapters/kosli.json'), JSON.stringify({ role: ROLE, provider, adapter_id: adapterId, config: { org: 'acme', flows: { delivery: 'acme-delivery' } }, activation_evidence: { tamper_probe: 'ADOPT: not yet' } }));
  }
  const fake = createFakeKosli(join(cwd, 'fake'));
  return { cwd, fake: fake.dir, env: { ...process.env, KOSLI_BIN: fake.bin } };
}
const trailJson = (id) => ({ name: 'CHG-2026-0042', compliance_status: { status: 'COMPLETE', is_compliant: true, attestations_statuses: [
  { attestation_name: 'gate.evidence-seal-check', attestation_type: 'generic', attestation_id: id, status: 'COMPLETE', is_compliant: true, unexpected: false },
  { attestation_name: 'gate.control-plane-check', attestation_type: 'generic', attestation_id: null, status: 'MISSING', is_compliant: null, unexpected: false },
] } });

test('unmounted: status names the missing selection and post is a NAMED no-op that never reaches a binary', async () => {
  const t = tree({ mount: false });
  try {
    const st = status(t.cwd);
    assert.equal(st.mounted, false); assert.match(st.reason, /no provider selected for role external-record/);
    const r = await post(envelope(), { cwd: t.cwd, env: t.env });
    assert.equal(r.status, 'unmounted');
    assert.deepEqual(calls(t.fake), []);
    assert.equal(existsSync(join(t.cwd, OUTBOX_DIR)), false, 'nothing queued for nobody');
    assert.equal((await resolve({ provider: 'kosli', id: 'x' }, { cwd: t.cwd, env: t.env })).status, 'unmounted');
    assert.equal((await trailStatus({ flow: 'delivery', trail: 'CHG-2026-0042' }, { cwd: t.cwd, env: t.env })).status, 'unmounted');
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('selected but not mounted, or a provider with no adapter module, is unmounted with the reason', () => {
  const a = tree({ mount: true }); rmSync(join(a.cwd, 'docs/governance/adapters/kosli.json'));
  try { assert.match(status(a.cwd).reason, /not mounted at docs\/governance\/adapters/); } finally { rmSync(a.cwd, { recursive: true, force: true }); }
  const b = tree({ mount: true, provider: 'worm-store' });
  try { assert.match(status(b.cwd).reason, /ships no adapter module/); } finally { rmSync(b.cwd, { recursive: true, force: true }); }
});

test('a rejected envelope is refused BEFORE anything is mounted or called — the call log stays empty and nothing is queued', async () => {
  const t = tree();
  try {
    const r = await post(envelope({ runner: null }), { cwd: t.cwd, env: t.env });
    assert.equal(r.status, 'rejected'); assert.ok(r.findings.some((f) => /^PR6/.test(f)));
    assert.deepEqual(calls(t.fake), []);
    assert.deepEqual(listOutbox(t.cwd), []);
    const u = await post(buildEnvelope({ kind: 'gate', name: 'x', subject: { flow: 'delivery', trail: 'T' }, commit: COMMIT, actor: { id: 'agent-loom-delivery' }, runner: RUNNER, payload: { gate: 'scripts/x.mjs', result: 'pass', controls: ['A'] } }), { cwd: t.cwd, env: t.env });
    assert.equal(u.status, 'rejected'); assert.ok(u.findings.some((f) => /unsigned/.test(f)));
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('mounted: post begins the trail, attests with the envelope as user-data, reads the id back, and never puts the token on argv', async () => {
  const t = tree();
  try {
    respond(t.fake, ['get', 'trail'], { stdout: trailJson('att-123') });
    const r = await post(envelope(), { cwd: t.cwd, env: { ...t.env, KOSLI_API_TOKEN: 'secret-token' } });
    assert.equal(r.status, 'recorded'); assert.equal(r.provider, 'kosli'); assert.equal(r.id, 'att-123');
    assert.deepEqual(r.ref, { provider: 'kosli', flow: 'acme-delivery', trail: 'CHG-2026-0042', name: 'gate.evidence-seal-check', id: 'att-123' });
    const log = calls(t.fake);
    assert.deepEqual(log.map((c) => c.argv.slice(0, 2)), [['begin', 'trail'], ['attest', 'generic'], ['get', 'trail']]);
    const attest = log[1].argv;
    assert.ok(attest.includes('--user-data') && attest.includes('--org') && attest.includes('acme'));
    assert.ok(attest.includes('--flow') && attest[attest.indexOf('--flow') + 1] === 'acme-delivery', 'the flow is mapped through the adapter config');
    assert.ok(!log.some((c) => c.argv.join(' ').includes('secret-token')), 'the token never appears on argv');
    assert.equal(attest[attest.indexOf('--compliant=true')], '--compliant=true');
    assert.deepEqual(listOutbox(t.cwd), []);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('a failing provider call queues the envelope to the outbox; flush retries it and clears it on success', async () => {
  const t = tree();
  try {
    respond(t.fake, ['attest'], { stderr: 'Error: 503 upstream', exit: 1 });
    const r = await post(envelope(), { cwd: t.cwd, env: t.env });
    assert.equal(r.status, 'queued'); assert.match(r.error, /503/); assert.ok(existsSync(r.file));
    const q = listOutbox(t.cwd);
    assert.equal(q.length, 1); assert.equal(q[0].envelope.record.status, 'queued');
    // Recover: the outbox file is the envelope, still signed, still verifiable after the round trip.
    writeFileSync(join(t.fake, 'responses.json'), '[]\n');
    respond(t.fake, ['get', 'trail'], { stdout: trailJson('att-9') });
    const f = await flushOutbox({ cwd: t.cwd, env: t.env });
    assert.equal(f.recorded.length, 1); assert.equal(f.recorded[0].id, 'att-9');
    assert.deepEqual(listOutbox(t.cwd), []);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('flush removes an envelope that can never post (rejected) and reports it; unmounted leaves the queue intact', async () => {
  const t = tree();
  try {
    respond(t.fake, ['attest'], { exit: 1, stderr: 'down' });
    await post(envelope(), { cwd: t.cwd, env: t.env });
    const [{ file }] = listOutbox(t.cwd);
    const bad = JSON.parse(readFileSync(file, 'utf8')); bad.payload.result = 'fail'; // tamper the queued envelope
    writeFileSync(file, JSON.stringify(bad));
    const f = await flushOutbox({ cwd: t.cwd, env: t.env });
    assert.equal(f.rejected.length, 1); assert.ok(f.rejected[0].findings.some((x) => /payload_digest does not match|does NOT verify/.test(x)));
    assert.deepEqual(listOutbox(t.cwd), []);
    // unmounted flush
    await post(envelope(), { cwd: t.cwd, env: t.env });
    rmSync(join(t.cwd, 'docs/governance/provider-selection.json'));
    const g = await flushOutbox({ cwd: t.cwd, env: t.env });
    assert.equal(g.queued.length, 1); assert.match(g.unmounted, /no provider selected/);
    assert.equal(listOutbox(t.cwd).length, 1);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('resolve: a held id resolves; an unknown id is unresolved; a ref naming another provider is a mismatch', async () => {
  const t = tree();
  try {
    respond(t.fake, ['get', 'attestation', '--attestation-id', 'att-123'], { stdout: { attestation_name: 'gate.evidence-seal-check', attestation_type: 'generic', is_compliant: true, created_at: 1757764800, html_url: 'https://app.kosli.com/x' } });
    respond(t.fake, ['get', 'attestation', '--attestation-id', 'forged'], { exit: 1, stderr: 'Error: attestation not found' });
    const ok = await resolve({ provider: 'kosli', id: 'att-123', name: 'gate.evidence-seal-check' }, { cwd: t.cwd, env: t.env });
    assert.equal(ok.status, 'resolved'); assert.equal(ok.record.attestation_name, 'gate.evidence-seal-check');
    const no = await resolve({ provider: 'kosli', id: 'forged' }, { cwd: t.cwd, env: t.env });
    assert.equal(no.status, 'unresolved'); assert.match(no.reason, /not found/);
    const mm = await resolve({ provider: 'worm-store', id: 'att-123' }, { cwd: t.cwd, env: t.env });
    assert.equal(mm.status, 'mismatch');
    const wrongName = await resolve({ provider: 'kosli', id: 'att-123', name: 'gate.other' }, { cwd: t.cwd, env: t.env });
    assert.equal(wrongName.status, 'unresolved');
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('a provider that cannot be started is unavailable, not unresolved — an outage reads differently from a forged id', async () => {
  const t = tree();
  try {
    const r = await resolve({ provider: 'kosli', id: 'att-1' }, { cwd: t.cwd, env: { ...process.env, KOSLI_BIN: '/nowhere/kosli' } });
    assert.equal(r.status, 'unavailable'); assert.match(r.reason, /not found — set KOSLI_BIN/);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('trailStatus reports present, missing and unexpected by name', async () => {
  const t = tree();
  try {
    respond(t.fake, ['get', 'trail'], { stdout: trailJson('att-1') });
    const s = await trailStatus({ flow: 'delivery', trail: 'CHG-2026-0042' }, { cwd: t.cwd, env: t.env });
    assert.equal(s.status, 'ok'); assert.equal(s.flow, 'acme-delivery');
    assert.deepEqual(s.present.map((a) => a.name), ['gate.evidence-seal-check']);
    assert.deepEqual(s.missing, ['gate.control-plane-check']);
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

test('--dry-run reaches the binary with --dry-run and records nothing, queues nothing', async () => {
  const t = tree();
  try {
    const r = await post(envelope(), { cwd: t.cwd, env: t.env, dryRun: true });
    assert.equal(r.status, 'recorded'); assert.equal(r.dry_run, true); assert.equal(r.id, null);
    const log = calls(t.fake);
    assert.ok(log.every((c) => c.argv.includes('--dry-run')));
    assert.ok(!log.some((c) => c.argv[0] === 'get'), 'no read-back on a dry run');
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});

/* ---- 2.1.0 row 2.10: the snapshot through the seam ---- */
import { environmentSnapshot } from './external-record.mjs';

test('environmentSnapshot: unmounted is named; mounted reads the provider; an unreachable provider is unavailable', async () => {
  const u = tree({ mount: false });
  try { assert.equal((await environmentSnapshot('prod', { cwd: u.cwd, env: u.env })).status, 'unmounted'); } finally { rmSync(u.cwd, { recursive: true, force: true }); }
  const t = tree();
  try {
    respond(t.fake, ['get', 'snapshot', 'prod'], { stdout: [{ artifact: 'app:1', fingerprint: 'ab'.repeat(32) }] });
    const s = await environmentSnapshot('prod', { cwd: t.cwd, env: t.env });
    assert.equal(s.status, 'ok'); assert.equal(s.provider, 'kosli'); assert.equal(s.artifacts.length, 1);
    assert.equal((await environmentSnapshot('prod', { cwd: t.cwd, env: { ...process.env, KOSLI_BIN: '/nowhere' } })).status, 'unavailable');
  } finally { rmSync(t.cwd, { recursive: true, force: true }); }
});
