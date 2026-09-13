import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_PLATFORM_CONTROLS, SCHEMA, evaluate, isPlaceholder, run } from './activation-readiness-check.mjs';

const REGISTRY = { identities: [
  { id: 'exec', kind: 'human', roles: ['accountable-executive'], groups: [] },
  { id: 'admin', kind: 'human', roles: ['platform-admin'], groups: ['platform-admins'] },
  { id: 'risk', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
  { id: 'audit', kind: 'human', roles: ['internal-audit'], groups: [] },
  { id: 'builder', kind: 'human', roles: ['platform-admin'], groups: ['builders'] },
] };
const document = (over = {}) => ({
  schema: SCHEMA, status: 'ready-for-pilot', activation_id: 'ACT-1',
  target: { institution: 'Bank', repository: 'org/repo', default_branch: 'main', production_environment: 'pilot', reference_change_id: 'CHG-1' },
  owners: { accountable_executive: 'exec', platform_admin: 'admin', second_line: 'risk', internal_audit: 'audit' },
  required_platform_controls: [...BASELINE_PLATFORM_CONTROLS],
  external_record: { role: 'external-record', provider: 'kosli', adapter_id: 'kosli-external-record', integration_run_ref: 'evidence:run', tamper_probe_ref: 'evidence:tamper', audit_access_ref: 'iam:audit', retention_assessment_ref: 'risk:retention' },
  consumer_ai_pilot: true,
  governed_records: { operating_model: 'docs/governance/operating-model.json', ai_governance: 'docs/governance/ai-governance.json', fairness: 'docs/governance/fairness-evaluations.json', contestability: 'docs/governance/decision-contestability.json', pilot: 'docs/governance/pilot-record.json' },
  ...over,
});
const cleanGate = { required: true, findings: [] };
const dependencies = (over = {}) => ({
  registry: REGISTRY,
  catalogIds: new Set(BASELINE_PLATFORM_CONTROLS),
  platform: { findings: [], verifiedControls: [...BASELINE_PLATFORM_CONTROLS] },
  providerSelection: { findings: [] },
  externalRecord: { mounted: true, active: true, provider: 'kosli', adapter_id: 'kosli-external-record' },
  operating: cleanGate, ai: cleanGate, fairness: cleanGate, contestability: cleanGate,
  pilot: { status: 'not-started', findings: [], joined: true, outstanding: [] },
  ...over,
});

test('a fully joined campaign can claim ready-for-pilot, with the standing observation boundary', () => {
  const result = evaluate(document(), dependencies());
  assert.deepEqual(result.findings, [], result.findings.join('\n'));
  assert.equal(result.ready, true);
  assert.ok(result.notices.some((notice) => /does not configure.*Kosli.*observe a customer/.test(notice)));
});

test('not-started is inert and activating is a non-blocking, explicit work list', () => {
  assert.equal(evaluate(document({ status: 'ADOPT: not-started | activating' }), {}).findings.length, 0);
  const activating = evaluate(document({ status: 'activating', owners: {} }), dependencies({ platform: { findings: ['unsigned'], verifiedControls: [] } }));
  assert.deepEqual(activating.findings, []);
  assert.ok(activating.notices.some((notice) => /AR-R04/.test(notice)));
  assert.ok(activating.notices.some((notice) => /AR-R07/.test(notice)));
});

test('ready-for-pilot fails without every verified platform baseline', () => {
  const result = evaluate(document(), dependencies({ platform: { findings: [], verifiedControls: ['HG-0001'] } }));
  for (const id of ['HG-0004', 'HG-0005', 'HG-0011']) assert.ok(result.findings.some((finding) => finding.includes(id)), id);
});

test('ready-for-pilot fails when Kosli is selected but not active or the plan names another provider', () => {
  const inactive = evaluate(document(), dependencies({ externalRecord: { mounted: true, active: false, provider: 'kosli', adapter_id: 'kosli-external-record' } }));
  assert.ok(inactive.findings.some((finding) => /Kosli|kosli.*not active/i.test(finding)));
  const mismatch = evaluate(document(), dependencies({ externalRecord: { mounted: true, active: true, provider: 'transparency-log', adapter_id: 'tl' } }));
  assert.ok(mismatch.findings.some((finding) => /plan names provider.*kosli.*mounted.*transparency-log/.test(finding)));
});

test('authority is four distinct, non-builder humans holding the required functions', () => {
  const duplicate = evaluate(document({ owners: { accountable_executive: 'exec', platform_admin: 'exec', second_line: 'risk', internal_audit: 'audit' } }), dependencies());
  assert.ok(duplicate.findings.some((finding) => /AR-R05/.test(finding)));
  const builder = evaluate(document({ owners: { ...document().owners, platform_admin: 'builder' } }), dependencies());
  assert.ok(builder.findings.some((finding) => /AR-R04.*non-builder/.test(finding)));
});

test('an inert governance gate cannot satisfy readiness for the reference AI change', () => {
  const result = evaluate(document(), dependencies({ ai: { required: false, findings: [] } }));
  assert.ok(result.findings.some((finding) => /AI governance is not required.*inert gate/.test(finding)));
});

test('activation and pilot states advance together and concluded requires the playbook join', () => {
  const active = evaluate(document({ status: 'pilot-active' }), dependencies());
  assert.ok(active.findings.some((finding) => /requires pilot-record status active/.test(finding)));
  const concluded = evaluate(document({ status: 'concluded' }), dependencies({ pilot: { status: 'concluded', findings: [], joined: false, outstanding: ['AX-1'] } }));
  assert.ok(concluded.findings.some((finding) => /no parsed playbook join/.test(finding)));
  assert.ok(concluded.findings.some((finding) => /AX-1/.test(finding)));
});

test('template markers are not institution evidence and absence is a clean no-op', () => {
  assert.equal(isPlaceholder('ADOPT: owner'), true);
  assert.equal(isPlaceholder('SYNTHETIC: fixture'), true);
  const dir = mkdtempSync(join(tmpdir(), 'activation-readiness-'));
  try { assert.equal(run(dir).inert, true); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
