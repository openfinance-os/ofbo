// Tests for the provenance gate CLI (2.1.0, plan row 2.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECORD_DIRS, collect, evaluate, run } from './provenance-check.mjs';
import { buildEnvelope, signEnvelope } from '../core/provenance.mjs';

const keys = generateKeyPairSync('ed25519');
const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] };
const REGISTRY = { identities: [{ id: 'agent-loom-delivery', kind: 'agent', model: { model_id: 'm@1' } }] };
const COMMIT = 'a'.repeat(40);
const env = (over = {}) => signEnvelope(buildEnvelope({ kind: 'gate', name: 'gate.x', subject: { flow: 'delivery', trail: 'CHG-1' }, commit: COMMIT, actor: { id: 'agent-loom-delivery' }, runner: { subject: 's', repository: 'r', ref: 'x', sha: COMMIT }, payload: { gate: 'scripts/x.mjs', result: 'pass', controls: ['A'] }, ...over }), { issuer: 'ci-runner', privateKeyPem: pem(keys.privateKey, 'pkcs8') });

const tree = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'provgate-'));
  mkdirSync(join(cwd, 'docs/governance'), { recursive: true });
  writeFileSync(join(cwd, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  writeFileSync(join(cwd, 'docs/governance/attestation-issuers.json'), JSON.stringify(ISSUERS));
  return cwd;
};

test('inert with no envelopes anywhere — zero checked, zero findings', () => {
  const cwd = tree();
  try { assert.deepEqual(run(cwd, []), { findings: [], count: 0 }); } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a queued envelope in the outbox and a kept copy beside the evidence are both checked; the post result is not part of the check', () => {
  const cwd = tree();
  try {
    for (const d of RECORD_DIRS) mkdirSync(join(cwd, d), { recursive: true });
    writeFileSync(join(cwd, RECORD_DIRS[0], 'a.json'), JSON.stringify({ ...env(), record: { status: 'queued', error: 'x' } }));
    writeFileSync(join(cwd, RECORD_DIRS[1], 'b.json'), JSON.stringify({ ...env({ runner: null }), record: { status: 'recorded', id: 'id-1' } }));
    writeFileSync(join(cwd, RECORD_DIRS[1], 'c.json'), '{ not json');
    const items = collect(cwd);
    assert.equal(items.length, 3);
    const r = run(cwd, []);
    assert.equal(r.count, 3);
    assert.ok(r.findings.some((f) => /records\/b\.json: PR6/.test(f)));
    assert.ok(r.findings.some((f) => /records\/c\.json: not a parseable/.test(f)));
    assert.ok(!r.findings.some((f) => /a\.json/.test(f)), 'the valid queued envelope is clean');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('--draft accepts an unsigned envelope; without it the signature is required', () => {
  const cwd = tree();
  try {
    mkdirSync(join(cwd, RECORD_DIRS[0]), { recursive: true });
    const { attestation, ...unsigned } = env(); // eslint-disable-line no-unused-vars
    writeFileSync(join(cwd, RECORD_DIRS[0], 'u.json'), JSON.stringify({ ...unsigned, attestation: null }));
    assert.ok(run(cwd, []).findings.some((f) => /unsigned/.test(f)));
    assert.deepEqual(run(cwd, ['--draft']).findings, []);
    assert.deepEqual(evaluate([{ file: 'x', envelope: env() }], { registry: REGISTRY, issuers: ISSUERS }), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
