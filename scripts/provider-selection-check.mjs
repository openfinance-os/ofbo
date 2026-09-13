// The provider-selection gate. HG-0008 says the harness names ROLES, never vendors — and the
// Loom honoured that in its prose while quietly breaking it in its layout. adapters/reference/
// holds at most ONE adapter per control (AD-R05 refuses two on the same control, and CI mounts
// the whole directory), so a role with three plausible providers had nowhere to put the second
// and third. The directory encoded "the one true instance", not "pick one", and the institution's
// choice was implicit in which file happened to sit in it.
//
// This gate is the middle link that was missing:
//
//   the PROFILE says a capability is required   (required_capabilities → compiled plan)
//   the ROLE CATALOG says which control fills it (adapters/providers/roles.json)
//   the SELECTION says which provider we chose   (docs/governance/provider-selection.json)
//   the ADAPTER says how that system reports      (docs/governance/adapters/<id>.json)
//
// What it refuses, in order of how badly each would end:
//
//   PS-R01  a selection naming a role the catalog does not define
//   PS-R02  a selection naming a provider that does not exist under that role
//   PS-R03  two providers selected for one role — AD-R05 re-entered at selection time
//   PS-R04  a provider whose adapter fills a DIFFERENT control than the role claims
//   PS-R05  a selection whose adapter was never mounted — a preference, not a choice
//   PS-R06  a compiled plan requiring a capability with no provider selected at all
//   PS-R07  a half-completed selection — some fields adopted, some still ADOPT placeholders
//
// SELECTING IS NOT INSTALLING, and installing is not activating. A mounted adapter whose
// activation_evidence is still placeholders is reported as "selected, not active" — a NOTICE,
// the honest resting state, never a green control on its own.
//
// Silent where nothing is selected AND nothing compiled requires a provider: an institution that
// has not reached this decision is not failing it. The moment a plan requires the capability,
// PS-R06 makes the absent decision a finding.
//
// Run from the repo root: `node scripts/provider-selection-check.mjs`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { isActive } from './adapter-check.mjs';

export const ROLES_LOCATIONS = ['docs/governance/adapters/providers/roles.json', 'adapters/providers/roles.json'];
export const PROVIDER_DIRS = ['docs/governance/adapters/providers', 'adapters/providers'];
export const SELECTION_LOCATIONS = ['docs/governance/provider-selection.json', 'provider-selection.json'];
export const MOUNTED_DIR = 'docs/governance/adapters';

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must not read as a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());

/**
 * Findings + notices for the selection set.
 * `catalog` maps `${role}/${provider}` → the provider declaration; `mounted` maps adapter_id →
 * the adapter mounted under docs/governance/adapters/; `requiredCapabilities` is the set of
 * capability names some compiled plan demands.
 */
export function evaluate({ roles, selections, catalog, mounted, requiredCapabilities = new Set() }) {
  const findings = [];
  const notices = [];
  const byRole = new Map((roles || []).map((r) => [r.role, r]));
  const chosen = new Map(); // role → selection

  for (const s of selections || []) {
    const fields = [s?.role, s?.provider, s?.adapter_id];
    if (fields.every(isPlaceholder)) continue;          // an untouched template row, not a decision
    if (fields.some(isPlaceholder)) {
      findings.push(`PS-R07: selection for role ${JSON.stringify(s?.role)} is half-completed — some fields are still ADOPT placeholders, and a half-made decision is not a made one`);
      continue;
    }
    if (!nonEmpty(s?.role) || !nonEmpty(s?.provider)) { findings.push('PS-R07: a selection names no role/provider'); continue; }

    const role = byRole.get(s.role);
    if (!role) { findings.push(`PS-R01: selection names role ${JSON.stringify(s.role)}, which the role catalog does not define — a choice for a role that does not exist fills nothing`); continue; }
    if (chosen.has(s.role)) {
      findings.push(`PS-R03: role ${JSON.stringify(s.role)} has two providers selected (${chosen.get(s.role).provider}, ${s.provider}) — one role, one provider. Two make their evidence interchangeable, which is AD-R05 re-entered at selection time`);
      continue;
    }
    chosen.set(s.role, s);

    const provider = catalog?.get(`${s.role}/${s.provider}`);
    if (!provider) { findings.push(`PS-R02: role ${JSON.stringify(s.role)} selects provider ${JSON.stringify(s.provider)}, which does not exist under adapters/providers/${s.role}/`); continue; }
    if (provider.satisfies_control !== role.control) {
      findings.push(`PS-R04: provider ${s.provider} fills control ${JSON.stringify(provider.satisfies_control)} but role ${JSON.stringify(s.role)} claims ${JSON.stringify(role.control)} — the selection would evidence a control nobody asked it to`);
    }
    const adapter = mounted?.get(s.adapter_id);
    if (!adapter) {
      findings.push(`PS-R05: role ${JSON.stringify(s.role)} selects ${s.provider} but its adapter ${JSON.stringify(s.adapter_id)} is not mounted at ${MOUNTED_DIR}/ — selecting is not installing, and an unmounted choice is a preference`);
    } else if (!isActive(adapter)) {
      notices.push(`${s.role} → ${s.provider}: selected, not active — the adapter is mounted but its activation_evidence is still placeholders`);
    }
  }

  // PS-R06 — mandatory-when-compiled. An institution that has not reached this decision is not
  // failing it; one whose plan REQUIRES the capability and never made it is.
  for (const role of roles || []) {
    if (!role?.capability || !requiredCapabilities.has(role.capability)) continue;
    if (!chosen.has(role.role)) {
      findings.push(`PS-R06: a compiled plan requires capability ${JSON.stringify(role.capability)} but no provider is selected for role ${JSON.stringify(role.role)} — a required capability with no chosen provider is an unfilled seam, not a pass`);
    }
  }

  return { findings, notices, selected: chosen.size };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const firstPath = (locs, cwd) => locs.map((p) => join(cwd, p)).find(existsSync) || null;

/** Load every provider declaration under the catalog → Map `${role}/${provider}`. */
export function loadCatalog(cwd = process.cwd()) {
  const dir = PROVIDER_DIRS.map((p) => join(cwd, p)).find(existsSync);
  const catalog = new Map();
  if (!dir) return catalog;
  for (const roleDir of readdirSync(dir)) {
    const rp = join(dir, roleDir);
    if (!statSync(rp).isDirectory()) continue;
    for (const name of readdirSync(rp).filter((n) => n.endsWith('.json'))) {
      const p = readJson(join(rp, name));
      if (p) catalog.set(`${roleDir}/${p.provider || name.replace(/\.json$/, '')}`, p);
    }
  }
  return catalog;
}

const loadMounted = (cwd) => {
  const dir = join(cwd, MOUNTED_DIR);
  const mounted = new Map();
  if (!existsSync(dir)) return mounted;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const a = readJson(join(dir, name));
    if (a?.adapter_id) mounted.set(a.adapter_id, a);
  }
  return mounted;
};

export function run(cwd = process.cwd()) {
  const rolesPath = firstPath(ROLES_LOCATIONS, cwd);
  const selPath = firstPath(SELECTION_LOCATIONS, cwd);
  const agg = aggregateRequirements(cwd);
  const roles = rolesPath ? (readJson(rolesPath)?.roles || []) : [];
  const requiredCapabilities = new Set(roles.filter((r) => capabilityRequired(agg, r.capability)).map((r) => r.capability));
  const selections = selPath ? (readJson(selPath)?.selections || []) : [];
  // Nothing chosen and nothing demanding a choice — a clean no-op, not a vacuous green.
  if (!selections.length && requiredCapabilities.size === 0) return { findings: [], notices: [], selected: 0, inert: true };
  return evaluate({ roles, selections, catalog: loadCatalog(cwd), mounted: loadMounted(cwd), requiredCapabilities });
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, selected } = run();
  for (const n of notices) process.stdout.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nProvider-selection gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA role is a choice the institution makes and records, not a vendor the harness picks.\nSee adapters/providers/roles.json and ../loom/references/supply-chain-security.md.\n');
    process.exit(1);
  }
  // No findings and nothing chosen can only mean nothing demanded a choice — PS-R06 would have
  // fired otherwise. Say that, rather than reporting a confident "0 selected" that reads as work
  // done. An untouched template lands here, which is the honest resting state of a fresh adoption.
  if (selected === 0) process.stdout.write('Provider-selection gate — OK (no provider roles selected, none required)\n');
  else process.stdout.write(`Provider-selection gate — OK (${selected} role${selected === 1 ? '' : 's'} selected)\n`);
}
