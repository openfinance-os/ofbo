// Operating-model gate — the mechanically validated institution-owned frame around the Loom.
//
// This turns the governance-and-accountability runbook's proposed seam into a real, compiled
// requirement. It checks declarations and joins them to the identity registry. It cannot appoint
// an executive, convene a committee, inspect IAM, stop a deployment or prove audit re-performance.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry } from './identity-registry-check.mjs';

export const CAPABILITY = 'operating_model';
export const SCHEMA = 'loom.operating-model/v1';
export const LOCATIONS = ['docs/governance/operating-model.json', 'operating-model.json'];
export const SELECTION_LOCATIONS = ['docs/governance/provider-selection.json', 'provider-selection.json'];
export const ACTIVITIES = [
  'propose-change', 'approve-merge', 'control-plane-change', 'production-promotion', 'rollback',
  'cease-use', 'model-risk-signoff', 'pilot-scope', 'oversight-and-reperformance',
];
export const CONTROL_ACTIVITIES = new Set(ACTIVITIES.filter((a) => a !== 'propose-change'));
export const IAM_ACTIVITIES = new Set(['approve-merge', 'control-plane-change', 'production-promotion', 'cease-use']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
export const isPlaceholder = (v) => nonEmpty(v) && /^ADOPT[\s:—-]/i.test(v.trim());
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const isoDate = (v) => stated(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const positiveInteger = (v) => Number.isInteger(v) && v > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const human = (registry, id) => identityOf(registry, id);

export function evaluate(doc, { registry = null, externalRecordProvider = undefined, enforced = false } = {}) {
  const findings = [];
  const notices = [];
  const say = (m) => (enforced ? findings : notices).push(m);
  if (doc?.schema !== SCHEMA) say(`OM-R01: schema must be ${SCHEMA}; got ${JSON.stringify(doc?.schema)}`);
  if (!registry) say('OM-R02: no readable identity registry — appointments and RACI authority cannot be joined to people');

  const executiveId = doc?.accountable_executive?.identity_id;
  if (!stated(executiveId)) say('OM-R02: accountable_executive.identity_id is not stated');
  else if (registry) {
    const who = human(registry, executiveId);
    if (!who) say(`OM-R02: accountable executive ${JSON.stringify(executiveId)} is not in the identity registry`);
    else {
      if (who.kind !== 'human') say(`OM-R02: accountable executive ${executiveId} is not human`);
      if ((who.groups || []).includes('builders')) say(`OM-R02: accountable executive ${executiveId} is in builders`);
      if (!(who.roles || []).includes('accountable-executive')) say(`OM-R02: ${executiveId} does not hold accountable-executive`);
    }
  }
  const appointment = doc?.accountable_executive || {};
  if (!stated(appointment.mandate_ref)) say('OM-R03: the accountable executive has no approved mandate reference');
  if (!isoDate(appointment.effective_on)) say('OM-R03: accountable_executive.effective_on must be an ISO date');
  if (!stated(appointment.regulator_reference)) say('OM-R03: the accountable executive has no regulator/controlled-function reference');

  const oversight = doc?.oversight || {};
  for (const field of ['committee', 'terms_of_reference', 'minutes_record']) {
    if (!stated(oversight[field])) say(`OM-R04: oversight.${field} is not stated`);
  }
  if (!positiveInteger(oversight.review_every_days)) say('OM-R04: oversight.review_every_days must be a positive integer');
  if (!Array.isArray(oversight.event_triggers) || !oversight.event_triggers.some(stated)) say('OM-R04: oversight has no event trigger');

  const change = doc?.change_management || {};
  if (!stated(change.system_of_record)) say('OM-R05: change_management.system_of_record is not stated');
  if (change.ticket_required_for_production !== true) say('OM-R05: production promotion must require an approved change ticket');
  for (const field of ['promotion_gate', 'kill_switch']) if (!stated(change[field])) say(`OM-R05: change_management.${field} is not stated`);

  const raciRows = Array.isArray(doc?.raci) ? doc.raci.filter((r) => r && typeof r === 'object') : [];
  const byActivity = new Map();
  for (const row of raciRows) {
    if (!ACTIVITIES.includes(row.activity)) { say(`OM-R06: unknown RACI activity ${JSON.stringify(row.activity)}`); continue; }
    if (byActivity.has(row.activity)) { say(`OM-R06: RACI activity ${row.activity} appears more than once — exactly one accountable owner is required`); continue; }
    byActivity.set(row.activity, row);
  }
  for (const activity of ACTIVITIES) if (!byActivity.has(activity)) say(`OM-R06: RACI has no ${activity} row`);

  for (const [activity, row] of byActivity) {
    if (!stated(row.accountable)) say(`OM-R07: ${activity} has no single accountable identity`);
    const responsible = Array.isArray(row.responsible) ? row.responsible.filter(stated) : [];
    if (!responsible.length) say(`OM-R07: ${activity} has no responsible identity`);
    for (const id of [row.accountable, ...responsible].filter(stated)) {
      if (!registry) continue;
      const who = human(registry, id);
      if (!who) { say(`OM-R07: ${activity} identity ${JSON.stringify(id)} is not in the identity registry`); continue; }
      if (id === row.accountable && who.kind !== 'human') say(`OM-R07: ${activity} accountable ${id} is an agent — agents approve nothing`);
      if (CONTROL_ACTIVITIES.has(activity) && (who.kind === 'agent' || (who.groups || []).includes('builders'))) {
        say(`OM-R07: ${activity} assigns ${id} from the build authority — controlled decisions must remain outside builders`);
      }
    }
  }
  for (const activity of ['production-promotion', 'cease-use', 'model-risk-signoff', 'pilot-scope', 'oversight-and-reperformance']) {
    const owner = byActivity.get(activity)?.accountable;
    if (stated(executiveId) && stated(owner) && owner !== executiveId) say(`OM-R08: ${activity} is accountable to ${owner}, not the named accountable executive ${executiveId}`);
  }

  for (const [field, activity] of [['rollback_owner', 'rollback'], ['cease_use_owner', 'cease-use']]) {
    const id = change[field];
    if (!stated(id)) say(`OM-R09: change_management.${field} is not stated`);
    else if (registry) {
      const who = human(registry, id);
      if (!who || who.kind !== 'human' || (who.groups || []).includes('builders')) say(`OM-R09: ${field} ${JSON.stringify(id)} must resolve to a non-builder human`);
    }
    const row = byActivity.get(activity);
    if (stated(id) && row && id !== row.accountable && !(row.responsible || []).includes(id)) say(`OM-R09: ${field} ${id} is absent from the ${activity} RACI row`);
  }
  if (stated(executiveId) && stated(change.cease_use_owner) && executiveId !== change.cease_use_owner) {
    say(`OM-R09: cease_use_owner must be the accountable executive ${executiveId}`);
  }

  const bindings = Array.isArray(doc?.iam_bindings) ? doc.iam_bindings : [];
  const bindingByActivity = new Map();
  for (const binding of bindings) {
    if (!IAM_ACTIVITIES.has(binding?.activity)) { say(`OM-R10: IAM binding names unsupported activity ${JSON.stringify(binding?.activity)}`); continue; }
    if (bindingByActivity.has(binding.activity)) { say(`OM-R10: IAM activity ${binding.activity} has more than one binding`); continue; }
    bindingByActivity.set(binding.activity, binding);
  }
  for (const activity of IAM_ACTIVITIES) {
    const binding = bindingByActivity.get(activity);
    if (!binding) { say(`OM-R10: ${activity} has no IAM enforcement binding`); continue; }
    for (const field of ['subject', 'provider_group', 'enforcement_ref']) if (!stated(binding[field])) say(`OM-R10: ${activity} IAM binding has no ${field}`);
    const row = byActivity.get(activity);
    if (row && stated(binding.subject) && binding.subject !== row.accountable && !(row.responsible || []).includes(binding.subject)) {
      say(`OM-R10: ${activity} IAM subject ${binding.subject} is absent from its RACI row`);
    }
  }

  const audit = doc?.independent_reperformance || {};
  if (!stated(audit.owner)) say('OM-R11: independent_reperformance.owner is not stated');
  else if (registry) {
    const who = human(registry, audit.owner);
    if (!who || who.kind !== 'human' || (who.groups || []).includes('builders') || !(who.roles || []).includes('internal-audit')) {
      say(`OM-R11: independent re-performance owner ${JSON.stringify(audit.owner)} must be a non-builder human holding internal-audit`);
    }
  }
  if (!positiveInteger(audit.sample_every_days)) say('OM-R11: independent_reperformance.sample_every_days must be a positive integer');
  if (!stated(audit.procedure)) say('OM-R11: independent_reperformance.procedure is not stated');
  if (!stated(audit.external_evidence_route)) say('OM-R11: independent_reperformance.external_evidence_route is not stated');
  if (externalRecordProvider === null) say('OM-R11: no external-record provider is selected — independent re-performance has no independent trail to query');
  else if (stated(externalRecordProvider) && stated(audit.external_evidence_route)
    && !audit.external_evidence_route.startsWith(`external-record:${externalRecordProvider}`)) {
    say(`OM-R11: external_evidence_route does not bind the selected external-record provider ${JSON.stringify(externalRecordProvider)}`);
  }

  notices.push('OM-R12: this gate validates a declaration and identity joins only; appointments, committee decisions, IAM enforcement, promotion refusal, cease-use and independent re-performance are NOT OBSERVED');
  return { findings, notices, activities: byActivity.size };
}

export function requiringChanges(agg) {
  return (agg?.changes || []).filter((c) => c?.capabilities?.[CAPABILITY]?.required).map((c) => c.change_id);
}

export function run(cwd = process.cwd()) {
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  const path = LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  if (!path) {
    if (!required) return { present: false, required, inert: true, findings: [], notices: [], activities: 0 };
    return { present: false, required, inert: false, findings: [`a compiled plan requires ${CAPABILITY} [${requiringChanges(agg).join(', ') || 'unknown change'}] but ${LOCATIONS[0]} is absent`], notices: [], activities: 0 };
  }
  const doc = readJson(path);
  if (!doc) {
    const message = `${LOCATIONS[0]} is not valid JSON`;
    return { present: true, required, inert: false, findings: required ? [message] : [], notices: required ? [] : [message], activities: 0 };
  }
  let registry = null;
  try { registry = loadRegistry(cwd); } catch { /* evaluate reports the unreadable join fail-closed */ }
  const selectionPath = SELECTION_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const selection = selectionPath ? readJson(selectionPath) : null;
  const externalRecordProvider = (selection?.selections || []).find((s) => s?.role === 'external-record')?.provider || null;
  return { present: true, required, inert: false, ...evaluate(doc, { registry, externalRecordProvider, enforced: required }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run();
  for (const notice of result.notices) process.stdout.write(`NOTICE: ${notice}\n`);
  if (result.findings.length) {
    process.stderr.write('\nOperating-model gate — FAIL\n\n');
    for (const finding of result.findings) process.stderr.write(`  - ${finding}\n`);
    process.exit(1);
  }
  if (!result.present) process.stdout.write(`Operating-model gate — inert (no compiled plan requires ${CAPABILITY})\n`);
  else process.stdout.write(`Operating-model gate — OK (${result.activities} RACI activities; declaration checked, institution operation not observed)\n`);
}
