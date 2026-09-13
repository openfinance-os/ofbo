// Activation-readiness gate — coordinates the adopter's path from installed Loom machinery to a
// supervised bank pilot. It joins existing verifiers; it does not create a second evidence ledger.
// `activating` is a non-blocking work list. ready-for-pilot and later states fail closed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { status as readExternalRecordStatus } from '../core/external-record.mjs';
import { loadRegistry } from './identity-registry-check.mjs';
import { run as platformActivation } from './platform-activation-check.mjs';
import { run as providerSelection } from './provider-selection-check.mjs';
import { run as operatingModel } from './operating-model-check.mjs';
import { run as aiGovernance } from './ai-governance-check.mjs';
import { run as fairness } from './fairness-evaluation-check.mjs';
import { run as contestability } from './decision-contestability-check.mjs';
import { run as pilot } from './pilot-record-check.mjs';

export const SCHEMA = 'loom.activation-plan/v1';
export const LOCATIONS = ['docs/governance/activation-plan.json', 'activation-plan.json'];
export const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];
export const STATUSES = ['not-started', 'activating', 'ready-for-pilot', 'pilot-active', 'concluded'];
export const ARMED = new Set(['ready-for-pilot', 'pilot-active', 'concluded']);
export const BASELINE_PLATFORM_CONTROLS = ['HG-0001', 'HG-0004', 'HG-0005', 'HG-0011'];
export const OWNER_RULES = {
  accountable_executive: { role: 'accountable-executive' },
  platform_admin: { role: 'platform-admin' },
  second_line: { group: 'second-line' },
  internal_audit: { role: 'internal-audit' },
};

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
export const isPlaceholder = (v) => nonEmpty(v) && /^(ADOPT|SYNTHETIC)[\s:—-]/i.test(v.trim());
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function evaluate(doc, dependencies = {}) {
  const findings = [];
  const notices = [];
  const rawStatus = stated(doc?.status) ? doc.status.trim() : 'not-started';
  if (!STATUSES.includes(rawStatus)) {
    return { status: 'unreadable', armed: false, findings: [`AR-R01: status must be one of ${STATUSES.join('|')}; got ${JSON.stringify(doc?.status)}`], notices, ready: false };
  }
  if (rawStatus === 'not-started') {
    notices.push('AR-R12: activation is not started; no platform, provider, pilot or organisational control is claimed');
    return { status: rawStatus, armed: false, findings, notices, ready: false };
  }

  const armed = ARMED.has(rawStatus);
  const say = (message) => (armed ? findings : notices).push(message);
  if (doc?.schema !== SCHEMA) say(`AR-R01: schema must be ${SCHEMA}; got ${JSON.stringify(doc?.schema)}`);
  if (!stated(doc?.activation_id)) say('AR-R02: activation_id is not stated');
  for (const field of ['institution', 'repository', 'default_branch', 'production_environment', 'reference_change_id']) {
    if (!stated(doc?.target?.[field])) say(`AR-R03: target.${field} is not stated`);
  }

  const registry = dependencies.registry;
  if (!registry) say('AR-R04: no readable identity registry — activation authority cannot be joined to people');
  const ownerIds = [];
  for (const [field, rule] of Object.entries(OWNER_RULES)) {
    const id = doc?.owners?.[field];
    if (!stated(id)) { say(`AR-R04: owners.${field} is not stated`); continue; }
    ownerIds.push(id);
    if (!registry) continue;
    const who = (registry.identities || []).find((identity) => identity.id === id);
    if (!who || who.kind !== 'human' || (who.groups || []).includes('builders')) {
      say(`AR-R04: owners.${field} ${JSON.stringify(id)} must resolve to a non-builder human`);
      continue;
    }
    if (rule.role && !(who.roles || []).includes(rule.role)) say(`AR-R04: owners.${field} ${id} does not hold ${rule.role}`);
    if (rule.group && !(who.groups || []).includes(rule.group)) say(`AR-R04: owners.${field} ${id} is not in ${rule.group}`);
  }
  if (new Set(ownerIds).size !== ownerIds.length) say('AR-R05: activation owners must be distinct people — platform, executive, second-line and audit authority cannot collapse into one actor');

  const catalogIds = dependencies.catalogIds || new Set();
  const requested = Array.isArray(doc?.required_platform_controls) ? doc.required_platform_controls : [];
  if (new Set(requested).size !== requested.length) say('AR-R06: required_platform_controls contains duplicates');
  for (const control of BASELINE_PLATFORM_CONTROLS) if (!requested.includes(control)) say(`AR-R06: required_platform_controls omits bank activation baseline ${control}`);
  for (const control of requested) if (!catalogIds.has(control)) say(`AR-R06: required platform control ${JSON.stringify(control)} is not in the control catalog`);
  const platform = dependencies.platform || { findings: [], verifiedControls: [] };
  for (const f of platform.findings || []) say(`AR-R07: platform activation: ${f}`);
  const verified = new Set(platform.verifiedControls || []);
  for (const control of requested) if (!verified.has(control)) say(`AR-R07: ${control} has no fresh, independently signed activation observation with a rejected bypass test`);

  const ext = doc?.external_record || {};
  if (ext.role !== 'external-record') say('AR-R08: external_record.role must be external-record');
  for (const field of ['provider', 'adapter_id', 'integration_run_ref', 'tamper_probe_ref', 'audit_access_ref', 'retention_assessment_ref']) {
    if (!stated(ext[field])) say(`AR-R08: external_record.${field} is not stated with institution evidence`);
  }
  for (const f of dependencies.providerSelection?.findings || []) say(`AR-R08: provider selection: ${f}`);
  const record = dependencies.externalRecord || { mounted: false, reason: 'no external-record provider mounted' };
  if (!record.mounted) say(`AR-R08: ${record.reason || 'external-record provider is not mounted'}`);
  else {
    if (record.provider !== ext.provider) say(`AR-R08: plan names provider ${JSON.stringify(ext.provider)} but the mounted external record is ${JSON.stringify(record.provider)}`);
    if (record.adapter_id !== ext.adapter_id) say(`AR-R08: plan names adapter ${JSON.stringify(ext.adapter_id)} but the mounted adapter is ${JSON.stringify(record.adapter_id)}`);
    if (!record.active) say(`AR-R08: ${record.provider} is selected and mounted but not active — complete every activation-evidence field`);
  }

  const governed = [
    ['operating model', dependencies.operating, true],
    ['AI governance', dependencies.ai, doc?.consumer_ai_pilot === true],
    ['fairness evaluation', dependencies.fairness, doc?.consumer_ai_pilot === true],
    ['decision contestability', dependencies.contestability, doc?.consumer_ai_pilot === true],
  ];
  if (doc?.consumer_ai_pilot !== true) say('AR-R09: consumer_ai_pilot must be true for this bank AI activation pack');
  for (const [label, result, required] of governed) {
    if (!required) continue;
    if (!result?.required) say(`AR-R09: ${label} is not required by the reference change — an inert gate is not readiness`);
    for (const f of result?.findings || []) say(`AR-R09: ${label}: ${f}`);
  }

  const pilotResult = dependencies.pilot || { status: 'not-started', findings: [] };
  for (const f of pilotResult.findings || []) say(`AR-R10: pilot record: ${f}`);
  const expectedPilot = rawStatus === 'ready-for-pilot' ? 'not-started' : rawStatus === 'pilot-active' ? 'active' : rawStatus === 'concluded' ? 'concluded' : null;
  if (expectedPilot && pilotResult.status !== expectedPilot) say(`AR-R10: activation status ${rawStatus} requires pilot-record status ${expectedPilot}; got ${pilotResult.status}`);
  if (rawStatus === 'concluded') {
    if (!pilotResult.joined) say('AR-R10: concluded pilot has no parsed playbook join');
    if ((pilotResult.outstanding || []).length) say(`AR-R10: concluded pilot still has live adversarial rows outstanding: ${pilotResult.outstanding.join(', ')}`);
  }

  for (const [field, expected] of Object.entries({
    operating_model: 'docs/governance/operating-model.json', ai_governance: 'docs/governance/ai-governance.json',
    fairness: 'docs/governance/fairness-evaluations.json', contestability: 'docs/governance/decision-contestability.json', pilot: 'docs/governance/pilot-record.json',
  })) if (doc?.governed_records?.[field] !== expected) say(`AR-R11: governed_records.${field} must point to ${expected}`);

  notices.push('AR-R12: readiness joins repository records only; it does not configure a platform, connect Kosli, observe a customer, move money, appoint an owner or perform an audit');
  return { status: rawStatus, armed, findings, notices, ready: armed && findings.length === 0 };
}

export function run(cwd = process.cwd()) {
  const path = LOCATIONS.map((location) => join(cwd, location)).find(existsSync);
  if (!path) return { present: false, status: 'not-started', armed: false, ready: false, findings: [], notices: [], inert: true };
  const doc = readJson(path);
  if (!doc) return { present: true, status: 'unreadable', armed: false, ready: false, findings: [`${LOCATIONS[0]} is not valid JSON`], notices: [], inert: false };
  let registry = null;
  try { registry = loadRegistry(cwd); } catch { /* evaluate reports the failed join */ }
  const catalogPath = CATALOG_LOCATIONS.map((location) => join(cwd, location)).find(existsSync);
  const catalog = catalogPath ? readJson(catalogPath) : null;
  const result = evaluate(doc, {
    registry,
    catalogIds: new Set((catalog?.controls || []).map((control) => control.control_id)),
    platform: platformActivation(cwd),
    providerSelection: providerSelection(cwd),
    externalRecord: readExternalRecordStatus(cwd),
    operating: operatingModel(cwd),
    ai: aiGovernance(cwd),
    fairness: fairness(cwd),
    contestability: contestability(cwd),
    pilot: pilot(cwd),
  });
  return { present: true, inert: result.status === 'not-started', ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run();
  for (const notice of result.notices) process.stdout.write(`NOTICE: ${notice}\n`);
  if (result.findings.length) {
    process.stderr.write('\nActivation-readiness gate — FAIL\n\n');
    for (const finding of result.findings) process.stderr.write(`  - ${finding}\n`);
    process.exit(1);
  }
  if (!result.present || result.status === 'not-started') process.stdout.write('Activation-readiness gate — inert (no activation campaign declared)\n');
  else if (result.status === 'activating') process.stdout.write(`Activation-readiness gate — activating (${result.notices.length} notice(s); no readiness claimed)\n`);
  else process.stdout.write(`Activation-readiness gate — OK (${result.status}; repository evidence joined, runtime and organisation not observed here)\n`);
}
