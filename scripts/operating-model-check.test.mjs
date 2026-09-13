import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIVITIES, CAPABILITY, SCHEMA, evaluate, isPlaceholder, run } from './operating-model-check.mjs';

const REGISTRY = { identities: [
  { id: 'exec', kind: 'human', roles: ['accountable-executive'], groups: [] },
  { id: 'ops', kind: 'human', roles: ['operations'], groups: [] },
  { id: 'risk', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
  { id: 'audit', kind: 'human', roles: ['internal-audit'], groups: [] },
  { id: 'builder', kind: 'human', roles: ['engineering'], groups: ['builders'] },
  { id: 'agent', kind: 'agent', roles: [], groups: ['builders'] },
] };
const activity = (name) => ({
  activity: name,
  accountable: name === 'propose-change' ? 'builder' : 'exec',
  responsible: name === 'propose-change' ? ['agent'] : name === 'oversight-and-reperformance' ? ['audit'] : name === 'model-risk-signoff' || name === 'pilot-scope' ? ['risk'] : ['ops'],
});
const document = (over = {}) => ({
  schema: SCHEMA,
  accountable_executive: { identity_id: 'exec', mandate_ref: 'SOR-1', effective_on: '2026-01-01', regulator_reference: 'CF-1' },
  oversight: { committee: 'Board Risk', terms_of_reference: 'TOR-1', minutes_record: 'board:minutes', review_every_days: 90, event_triggers: ['cease-use'] },
  change_management: { system_of_record: 'itsm:change', ticket_required_for_production: true, promotion_gate: 'deploy:protection', rollback_owner: 'ops', cease_use_owner: 'exec', kill_switch: 'flag:disable' },
  raci: ACTIVITIES.map(activity),
  iam_bindings: [...['approve-merge', 'control-plane-change', 'production-promotion', 'cease-use']].map((name) => ({ activity: name, subject: name === 'cease-use' ? 'exec' : 'ops', provider_group: `idp:${name}`, enforcement_ref: `observation:${name}` })),
  independent_reperformance: { owner: 'audit', sample_every_days: 90, procedure: 'audit:procedure', external_evidence_route: 'external-record:kosli' },
  ...over,
});

test('a complete operating model passes and states the runtime boundary', () => {
  const result = evaluate(document(), { registry: REGISTRY, enforced: true });
  assert.deepEqual(result.findings, [], result.findings.join('\n'));
  assert.ok(result.notices.some((n) => /OM-R12.*NOT OBSERVED/.test(n)));
});

test('OM-R01-R05 — schema, appointment, oversight and change control are real fields', () => {
  const result = evaluate({ schema: 'wrong', accountable_executive: {}, oversight: {}, change_management: {} }, { registry: REGISTRY, enforced: true });
  for (const rule of ['OM-R01', 'OM-R02', 'OM-R03', 'OM-R04', 'OM-R05']) assert.ok(result.findings.some((f) => f.includes(rule)), rule);
});

test('OM-R02 — the accountable executive is a registered non-builder human holding the role', () => {
  for (const identity_id of ['missing', 'builder', 'agent']) {
    const result = evaluate(document({ accountable_executive: { ...document().accountable_executive, identity_id } }), { registry: REGISTRY, enforced: true });
    assert.ok(result.findings.some((f) => /OM-R02/.test(f)), identity_id);
  }
});

test('OM-R02 — a missing identity registry fails the authority joins closed', () => {
  const result = evaluate(document(), { registry: null, enforced: true });
  assert.ok(result.findings.some((f) => /OM-R02.*no readable identity registry/.test(f)));
});

test('OM-R06/R07 — every activity exists once and controlled decisions exclude build authority', () => {
  const missing = evaluate(document({ raci: document().raci.filter((r) => r.activity !== 'rollback') }), { registry: REGISTRY, enforced: true });
  assert.ok(missing.findings.some((f) => /OM-R06.*rollback/.test(f)));
  const duplicate = evaluate(document({ raci: [...document().raci, activity('approve-merge')] }), { registry: REGISTRY, enforced: true });
  assert.ok(duplicate.findings.some((f) => /OM-R06.*more than once/.test(f)));
  const rows = document().raci.map((r) => r.activity === 'approve-merge' ? { ...r, responsible: ['agent'] } : r);
  const agent = evaluate(document({ raci: rows }), { registry: REGISTRY, enforced: true });
  assert.ok(agent.findings.some((f) => /OM-R07.*approve-merge.*build authority/.test(f)));
});

test('OM-R08/R09 — executive accountability, rollback and cease-use are joined to the RACI', () => {
  const rows = document().raci.map((r) => r.activity === 'cease-use' ? { ...r, accountable: 'risk' } : r);
  const result = evaluate(document({ raci: rows, change_management: { ...document().change_management, rollback_owner: 'missing', cease_use_owner: 'risk' } }), { registry: REGISTRY, enforced: true });
  assert.ok(result.findings.some((f) => /OM-R08.*cease-use/.test(f)));
  assert.ok(result.findings.some((f) => /OM-R09.*rollback_owner/.test(f)));
  assert.ok(result.findings.some((f) => /OM-R09.*cease_use_owner must be/.test(f)));
});

test('OM-R10 — each protected activity has one IAM binding to a RACI subject', () => {
  const missing = evaluate(document({ iam_bindings: document().iam_bindings.slice(1) }), { registry: REGISTRY, enforced: true });
  assert.ok(missing.findings.some((f) => /OM-R10.*approve-merge.*no IAM/.test(f)));
  const foreign = document().iam_bindings.map((b) => b.activity === 'production-promotion' ? { ...b, subject: 'audit' } : b);
  const result = evaluate(document({ iam_bindings: foreign }), { registry: REGISTRY, enforced: true });
  assert.ok(result.findings.some((f) => /OM-R10.*absent from its RACI/.test(f)));
});

test('OM-R11 — independent re-performance belongs to a non-builder internal-audit human', () => {
  for (const owner of ['builder', 'risk', 'agent']) {
    const result = evaluate(document({ independent_reperformance: { ...document().independent_reperformance, owner } }), { registry: REGISTRY, enforced: true });
    assert.ok(result.findings.some((f) => /OM-R11/.test(f)), owner);
  }
});

test('OM-R11 — the audit route binds the selected external-record provider', () => {
  const missing = evaluate(document(), { registry: REGISTRY, externalRecordProvider: null, enforced: true });
  assert.ok(missing.findings.some((f) => /OM-R11.*no external-record provider/.test(f)));
  const mismatch = evaluate(document(), { registry: REGISTRY, externalRecordProvider: 'transparency-log', enforced: true });
  assert.ok(mismatch.findings.some((f) => /OM-R11.*does not bind.*transparency-log/.test(f)));
  const kosli = evaluate(document(), { registry: REGISTRY, externalRecordProvider: 'kosli', enforced: true });
  assert.deepEqual(kosli.findings, []);
});

test('ADOPT placeholders are not declarations', () => {
  assert.equal(isPlaceholder('ADOPT: somebody'), true);
  const result = evaluate(document({ accountable_executive: { ...document().accountable_executive, mandate_ref: 'ADOPT: mandate' } }), { registry: REGISTRY, enforced: true });
  assert.ok(result.findings.some((f) => /OM-R03/.test(f)));
});

test('mandatory-when-compiled: absent is inert until a plan requires the operating model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'operating-model-'));
  try {
    assert.equal(run(dir).inert, true);
    const change = join(dir, 'docs/governance/changes/CHG-1');
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery' }));
    writeFileSync(join(change, 'control-plan.json'), JSON.stringify({ required_capabilities: { [CAPABILITY]: { required: true } } }));
    const result = run(dir);
    assert.equal(result.required, true);
    assert.ok(result.findings.some((f) => /operating_model.*CHG-1.*absent/.test(f)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
