// Tests for the loop attestation types (2.1.0, plan row 2.14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REOPENED_SCHEMA, STOPPED_SCHEMA, discoveryStoppedRecord, readOutcome, reopenedDiscoveryRecord, signLoopRecord, verifyDiscoveryStopped, verifyReopenedDiscovery } from './loop-attestations.mjs';

const keys = generateKeyPairSync('ed25519');
const pem = (k, t) => k.export({ type: t, format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] };
const PRIV = pem(keys.privateKey, 'pkcs8');
const REGISTRY = { identities: [{ id: 'po-fatima', kind: 'human', roles: ['product-owner'] }, { id: 'agent-loom-delivery', kind: 'agent', roles: [] }] };
const OUTCOME_MD = `---
artifact: outcome
run: "bsi-consent-field"
outcome: stopped
decided_by: po-fatima
decided_at: 2026-08-02T09:00:00Z
reason: "The errata field is optional for the LFI journey we serve; no customer pain traces to it (S-014, S-015)."
evidence_ref: research-log.md#S-015
hypotheses:
  - id: H1
    verdict: refuted
  - id: H2
    verdict: uncertain
---

# Outcome — bsi-consent-field

Stopped after Define. The problem as framed does not exist for our segment.
`;

const withRuns = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'loop-att-'));
  try {
    mkdirSync(join(dir, 'runs/bsi-consent-field'), { recursive: true });
    writeFileSync(join(dir, 'runs/bsi-consent-field/outcome.md'), OUTCOME_MD);
    return fn(join(dir, 'runs'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('outcome.md front-matter reads back, hypotheses included', () => withRuns((runs) => {
  const o = readOutcome(join(runs, 'bsi-consent-field'));
  assert.equal(o.outcome, 'stopped'); assert.equal(o.decided_by, 'po-fatima');
  assert.deepEqual(o.hypotheses, [{ id: 'H1', verdict: 'refuted' }, { id: 'H2', verdict: 'uncertain' }]);
  assert.match(o._body, /Stopped after Define/);
  assert.equal(readOutcome(join(runs, 'nope')), null);
}));

test('a human-decided, reasoned stop builds a record that verifies once signed; unsigned it is a draft', () => withRuns((runs) => {
  const rec = discoveryStoppedRecord('bsi-consent-field', readOutcome(join(runs, 'bsi-consent-field')));
  assert.equal(rec.schema, STOPPED_SCHEMA);
  const notices = [];
  assert.deepEqual(verifyDiscoveryStopped(rec, { registry: REGISTRY, runsDir: runs, requireSignature: false, notices }), []);
  assert.ok(notices.some((n) => /unsigned draft/.test(n)));
  assert.ok(verifyDiscoveryStopped(rec, { registry: REGISTRY, runsDir: runs }).some((f) => /UNSIGNED/.test(f)));
  const signed = signLoopRecord(rec, { issuer: 'ci-runner', privateKeyPem: PRIV });
  assert.deepEqual(verifyDiscoveryStopped(signed, { registry: REGISTRY, runsDir: runs, issuers: ISSUERS }), []);
  const m = JSON.parse(JSON.stringify(signed)); m.reason = 'edited after the fact';
  assert.ok(verifyDiscoveryStopped(m, { issuers: ISSUERS }).some((f) => /payload_digest does not match/.test(f)));
}));

test('a stop decided by an agent, without a reason, with no hypotheses, or for a run that does not exist, fails', () => withRuns((runs) => {
  const base = discoveryStoppedRecord('bsi-consent-field', readOutcome(join(runs, 'bsi-consent-field')));
  const v = (over) => verifyDiscoveryStopped({ ...base, ...over }, { registry: REGISTRY, runsDir: runs, requireSignature: false });
  assert.ok(v({ decided_by: 'agent-loom-delivery' }).some((f) => /an agent may recommend stopping; a human disposes/.test(f)));
  assert.ok(v({ decided_by: 'nobody' }).some((f) => /not in the identity registry/.test(f)));
  assert.ok(v({ reason: '' }).some((f) => /no reason/.test(f)));
  assert.ok(v({ hypotheses: [] }).some((f) => /no hypotheses/.test(f)));
  assert.ok(v({ hypotheses: [{ id: 'H1', verdict: 'meh' }] }).some((f) => /verdict must be/.test(f)));
  assert.ok(v({ run: 'ghost' }).some((f) => /does not exist under/.test(f)));
  assert.ok(v({ outcome: 'handed-off' }).some((f) => /not "stopped"/.test(f)));
}));

test('a signal routed to discovery becomes a reopened-discovery record linking the change that sent it back', () => {
  const signal = { id: 'OPS-2026-003', source: 'cbuae-bulletin', type: 'regulatory', severity: 'medium', detected: '2026-07-18', summary: 'errata introduces a consent field', route: 'discovery', link: 'discovery/2026-07-18-bsi-consent-field', caused_by_change: 'CHG-2026-0042' };
  const rec = reopenedDiscoveryRecord(signal);
  assert.equal(rec.schema, REOPENED_SCHEMA);
  assert.equal(rec.reopened_run, '2026-07-18-bsi-consent-field');
  assert.equal(rec.sent_back_by_change, 'CHG-2026-0042');
  const changeIds = new Set(['CHG-2026-0042']);
  assert.deepEqual(verifyReopenedDiscovery(rec, { changeIds, requireSignature: false }), []);
  assert.ok(verifyReopenedDiscovery(rec, { changeIds: new Set(['CHG-0000']), requireSignature: false }).some((f) => /does not resolve to a governed change/.test(f)));
  const signed = signLoopRecord(rec, { issuer: 'ci-runner', privateKeyPem: PRIV });
  assert.deepEqual(verifyReopenedDiscovery(signed, { changeIds, issuers: ISSUERS }), []);
  assert.ok(verifyReopenedDiscovery(signed, { issuers: { issuers: [] } }).some((f) => /not in the allowed-issuers registry/.test(f)));
});

test('a reopen with neither a run nor triaging status is a broken edge; an unattributed one is a notice, not a finding', () => {
  const rec = reopenedDiscoveryRecord({ id: 'OPS-9', type: 'incident', severity: 'high', detected: '2026-08-01', summary: 'x', route: 'discovery', link: '' });
  assert.ok(verifyReopenedDiscovery(rec, { requireSignature: false }).some((f) => /Run→Discovery edge is broken/.test(f)));
  const notices = [];
  const triaging = reopenedDiscoveryRecord({ id: 'OPS-9', type: 'incident', severity: 'high', detected: '2026-08-01', summary: 'x', route: 'discovery', status: 'triaging' });
  assert.deepEqual(verifyReopenedDiscovery(triaging, { requireSignature: false, notices }), []);
  assert.ok(notices.some((n) => /no sent_back_by_change/.test(n)));
});
