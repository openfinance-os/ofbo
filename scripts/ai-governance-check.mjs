// AI governance gate (AI-GOVERNANCE) — the build-time join for consumer-impacting AI.
//
// The CBUAE's February 2026 guidance treats governance, transparency, privacy/security,
// continuous monitoring, meaningful human oversight and third-party control as one operating
// system. The Loom already holds fairness and contestability in their own records. This gate
// closes the remaining structural gap: it binds each implicated shipping model role to an
// accountable human, an intervention and non-AI route, bilingual disclosure, monitoring,
// incident response and re-hashed stress-test evidence.
//
// It observes none of those controls in production. A complete record is mechanically validated,
// never platform- or organisationally-enforced.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired, modelRolesRequiredByCapability } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry } from './identity-registry-check.mjs';

export const CAPABILITY = 'ai_governance';
export const GOVERNANCE_LOCATIONS = ['docs/governance/ai-governance.json', 'ai-governance.json'];
export const MANIFEST_LOCATIONS = ['docs/governance/model-manifest.json', 'model-manifest.json'];
export const SCHEMA = 'loom.ai-governance/v1';
export const COVERED_TIERS = new Set(['medium', 'high']);
export const OVERSIGHT_MODES = new Set(['human-in-the-loop', 'human-on-the-loop', 'human-out-of-the-loop']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const positiveInteger = (v) => Number.isInteger(v) && v > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Structural and semantic checks over one AI governance record. */
export function evaluate(doc, { models = null, requiredRoles = null, registry = null, baseDir = null, enforced = false } = {}) {
  const findings = [];
  const notices = [];
  const say = (m) => (enforced ? findings : notices).push(m);

  if (doc?.schema !== SCHEMA) say(`AG-R01: schema must be ${SCHEMA}; got ${JSON.stringify(doc?.schema)}`);
  if (!registry) say('AG-R07: no readable identity registry — accountable ownership cannot be joined to a human authority');
  const systems = Array.isArray(doc?.systems)
    ? doc.systems.filter((s) => s && typeof s === 'object' && stated(s.role))
    : [];
  if (!systems.length) say('AG-R02: no AI systems with a stated model role — nothing is governed');
  const byRole = new Map();
  for (const system of systems) {
    const role = system.role.trim();
    if (byRole.has(role)) say(`AG-R02: AI system role ${JSON.stringify(role)} appears more than once — governance cannot have competing records`);
    else byRole.set(role, system);
  }

  const manifestRoles = Array.isArray(models)
    ? new Map(models.filter((m) => m && stated(m.role)).map((m) => [m.role.trim(), m]))
    : null;
  if (!manifestRoles) say('AG-R03: no readable model manifest — role coverage and shipping-pin binding cannot be verified');
  if (manifestRoles) {
    for (const [role, model] of manifestRoles) {
      const inScope = requiredRoles ? requiredRoles.has(role) : COVERED_TIERS.has(model.risk_tier);
      if (inScope && !byRole.has(role)) {
        say(`AG-R03: implicated model role ${JSON.stringify(role)} has no AI governance entry — silence is not oversight`);
      }
    }
    for (const role of byRole.keys()) {
      if (!manifestRoles.has(role)) say(`AG-R04: AI governance entry ${JSON.stringify(role)} names no model in the manifest`);
    }
  }

  for (const [role, system] of byRole) {
    const model = manifestRoles?.get(role);
    if (model && (system.model_id !== model.model_id || system.prompt_version !== model.prompt_version)) {
      say(`AG-R05: STALE AI governance record for ${JSON.stringify(role)} — record binds ${JSON.stringify(system.model_id)}/${JSON.stringify(system.prompt_version)} but the manifest ships ${JSON.stringify(model.model_id)}/${JSON.stringify(model.prompt_version)}`);
    }
    if (!stated(system.use_case)) say(`AG-R06: ${JSON.stringify(role)} has no consumer-recognisable use_case`);
    if (!['material-decision', 'high-impact-decision'].includes(system.consumer_impact)) {
      say(`AG-R06: ${JSON.stringify(role)} consumer_impact must be material-decision or high-impact-decision; got ${JSON.stringify(system.consumer_impact)}`);
    }

    if (!stated(system.accountable_owner)) {
      say(`AG-R07: ${JSON.stringify(role)} has no accountable_owner`);
    } else if (registry) {
      const owner = identityOf(registry, system.accountable_owner);
      if (!owner) say(`AG-R07: ${JSON.stringify(role)} accountable_owner ${JSON.stringify(system.accountable_owner)} is not in the identity registry`);
      else {
        if (owner.kind !== 'human') say(`AG-R07: ${JSON.stringify(role)} accountable_owner must be human, not ${owner.kind || 'unknown'}`);
        if ((owner.groups || []).includes('builders')) say(`AG-R07: ${JSON.stringify(role)} accountable_owner is in builders — builders cannot own the decision control they implement`);
        if (!(owner.roles || []).includes('accountable-executive')) say(`AG-R07: ${JSON.stringify(role)} accountable_owner does not hold accountable-executive`);
      }
    }

    const oversight = system.human_oversight && typeof system.human_oversight === 'object' ? system.human_oversight : {};
    if (!OVERSIGHT_MODES.has(oversight.mode)) {
      say(`AG-R08: ${JSON.stringify(role)} has no recognised human oversight mode`);
    } else if (oversight.mode === 'human-out-of-the-loop') {
      say(`AG-R08: ${JSON.stringify(role)} materially affects a consumer but declares human-out-of-the-loop — that mode is reserved for low-risk non-material processes`);
    }
    for (const [field, label] of [
      ['operator_role', 'trained operator role'],
      ['intervention_path', 'pause/reject/override path'],
      ['alternative_arrangement', 'non-AI alternative arrangement'],
      ['customer_review_path', 'customer route to human review'],
      ['overrides_recorded_in', 'override record feeding monitoring'],
    ]) if (!stated(oversight[field])) say(`AG-R09: ${JSON.stringify(role)} has no ${label} (human_oversight.${field})`);

    const disclosure = system.disclosure && typeof system.disclosure === 'object' ? system.disclosure : {};
    if (!stated(disclosure.english_surface)) say(`AG-R10: ${JSON.stringify(role)} names no English AI-use disclosure surface`);
    if (!stated(disclosure.arabic_surface)) say(`AG-R10: ${JSON.stringify(role)} names no Arabic AI-use disclosure surface`);

    const monitoring = system.monitoring && typeof system.monitoring === 'object' ? system.monitoring : {};
    const metrics = Array.isArray(monitoring.metrics) ? monitoring.metrics.filter(stated) : [];
    if (!metrics.length) say(`AG-R11: ${JSON.stringify(role)} has no stated runtime monitoring metric`);
    if (!positiveInteger(monitoring.review_every_days)) say(`AG-R11: ${JSON.stringify(role)} monitoring.review_every_days must be a positive integer`);
    if (!stated(monitoring.incident_runbook)) say(`AG-R11: ${JSON.stringify(role)} names no AI incident runbook`);
    if (!stated(system.privacy_security_assessment)) say(`AG-R12: ${JSON.stringify(role)} names no privacy/security assessment`);
    if (model?.third_party && !stated(system.third_party_assessment)) {
      say(`AG-R13: ${JSON.stringify(role)} uses an external model provider but names no third_party_assessment`);
    }

    const report = system.stress_test;
    if (!report || typeof report !== 'object' || !stated(report.ref) || !/^[0-9a-f]{64}$/.test(report.sha256 || '')) {
      say(`AG-R14: ${JSON.stringify(role)} has no stress_test {ref, sha256} evidence`);
    } else if (baseDir) {
      const path = join(baseDir, report.ref);
      if (!existsSync(path)) say(`AG-R14: stress-test report ${report.ref} for ${JSON.stringify(role)} does not exist`);
      else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== report.sha256) {
        say(`AG-R14: stress-test report ${report.ref} for ${JSON.stringify(role)} does not match its declared sha256`);
      }
    }
    notices.push(`AG-R15: ${JSON.stringify(role)} — this gate reads design records and re-hashes evidence; it does not observe a production decision, intervention, disclosure, monitoring alert or customer review`);
  }
  return { findings, notices, systems: systems.length, joined: Boolean(manifestRoles) };
}

export function requiringChanges(agg) {
  return (agg?.changes || []).filter((c) => c?.capabilities?.[CAPABILITY]?.required).map((c) => c.change_id);
}

export function run(cwd = process.cwd()) {
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  const path = GOVERNANCE_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  if (!path) {
    if (!required) return { present: false, required, findings: [], notices: [], systems: 0, inert: true, joined: false };
    return {
      present: false,
      required,
      findings: [`a compiled plan requires ${CAPABILITY} [${requiringChanges(agg).join(', ') || 'unknown change'}] but ${GOVERNANCE_LOCATIONS[0]} is absent — raise the adoption to GOVERNED and adopt governance/ai-governance.template.json`],
      notices: [], systems: 0, inert: false, joined: false,
    };
  }
  const doc = readJson(path);
  if (!doc) {
    const message = `${GOVERNANCE_LOCATIONS[0]} is not valid JSON`;
    return { present: true, required, findings: required ? [message] : [], notices: required ? [] : [message], systems: 0, inert: false, joined: false };
  }
  const manifestPath = MANIFEST_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const manifest = manifestPath ? readJson(manifestPath) : null;
  const models = Array.isArray(manifest?.models) ? manifest.models : null;
  let registry = null;
  try { registry = loadRegistry(cwd); } catch { /* evaluate reports the unreadable join fail-closed */ }
  const result = evaluate(doc, {
    models,
    requiredRoles: modelRolesRequiredByCapability(agg, CAPABILITY),
    registry,
    baseDir: cwd,
    enforced: required,
  });
  return { present: true, required, inert: false, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run();
  for (const notice of result.notices) process.stdout.write(`NOTICE: ${notice}\n`);
  if (result.findings.length) {
    process.stderr.write('\nAI-governance gate — FAIL\n\n');
    for (const finding of result.findings) process.stderr.write(`  - ${finding}\n`);
    process.exit(1);
  }
  if (!result.present) process.stdout.write(`AI-governance gate — inert (no compiled plan requires ${CAPABILITY})\n`);
  else process.stdout.write(`AI-governance gate — OK (${result.systems} system${result.systems === 1 ? '' : 's'}; records read, runtime not observed${result.required ? ', capability required' : ', capability not required'})\n`);
}
