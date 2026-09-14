// The identity-map gate (Factory Floor P6 · D0.4 part 2). It answers one question the approval
// contract deliberately leaves open: the record says a human decided AND names a registry
// identity, both under one signature — but who says those are the same person?
//
// Until this gate existed, nothing did. `core/approval-attestations.mjs` names that as its first
// residual: "a compromised bridge with a valid assertion for subject A could name registry
// identity B, and every check here would still pass." This gate is the independent assertion,
// resolved at CI time from the committed file, with no network and no bridge involvement.
//
//   node scripts/identity-map-check.mjs
//
// It runs in two halves, and the split matters. The FILE half checks the map's own soundness —
// schema, uniqueness, no service identities, no forbidden fields, a fresh reconciliation
// observation. The RESOLUTION half is performed inside the product-approval gate, per approval,
// because a mapping is only meaningful against a decision it is resolving.
//
// Mandatory-when-compiled, like every capability here: a plan that does not compile
// `identity_map` behaves exactly as it did before this file existed. Where the map IS present it
// is checked regardless — an unsound map that nobody compiled is still an unsound map, and
// leaving it unread would let it rot until the day it is switched on.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  CAPABILITY,
  checkMapInvariants,
  loadIdentityMap,
  mapRequired,
} from '../core/identity-map.mjs';
import { loadRegistry } from './identity-registry-check.mjs';

export const CHANGES_DIR = 'docs/governance/changes';
export const RECONCILIATION_LOCATIONS = [
  'docs/governance/identity-map-reconciliation.json',
  'identity-map-reconciliation.json',
];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function loadReconciliation(cwd = process.cwd()) {
  const path = RECONCILIATION_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  return path ? readJson(path) : null;
}

/** Changes whose compiled plan requires the mapping join. */
export function changesRequiringMap(cwd) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const envelope = readJson(`${dir}/${name}/change-envelope.json`);
    if (!envelope) continue;
    const plan = readJson(`${dir}/${name}/${envelope.control_plan || 'control-plan.json'}`);
    if (plan && mapRequired(plan)) out.push(name);
  }
  return out;
}

/**
 * Findings for the map file itself. `[]` ⇒ the map is sound and current; it says nothing about
 * any particular approval, which is resolved per-record by `verifyMapping`.
 */
export function evaluate(map, registry, { now = Date.now(), reconciliation = null, required = [] } = {}) {
  const active = (map?.entries || []).filter((e) => e?.status === 'active').length;
  // A map that is absent, or copied-but-empty, is UNADOPTED — not a finding on its own. The
  // mapping is a Factory Floor capability and a repository that has not adopted the floor has no
  // surface to map. But a plan that COMPILES the capability and finds nothing to resolve against
  // is a plan defect, reported rather than exited quietly: a requirement with nowhere to apply
  // reads as satisfied, which is the silent pass this whole programme is written against.
  if (!map || active === 0) {
    return required.map((id) => `${id}: the plan requires the ${CAPABILITY} capability but the identity map ${map ? 'has no active entries' : 'does not exist'} — every approval on this change is bound but not joined, which is exactly the residual the capability exists to close`);
  }
  return checkMapInvariants(map, registry, { now, reconciliation });
}

export function run(cwd = process.cwd()) {
  const map = loadIdentityMap(cwd);
  const required = changesRequiringMap(cwd);
  const findings = evaluate(map, loadRegistry(cwd), { reconciliation: loadReconciliation(cwd), required });
  const active = (map?.entries || []).filter((e) => e?.status === 'active').length;
  return { findings, present: Boolean(map), active, required: required.length };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, present, active, required } = run();
  if (findings.length) {
    process.stderr.write('\nIdentity-map gate (P6) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe map is the authority for who a signed subject IS. It is owned by the second\nline, changed only by pull request, and never written by a service — the bridge\nthat transcribes a decision must not also decide who may make one.\nSee docs/notion-floor-identity-mapping.md.\n');
    process.exit(1);
  }
  process.stdout.write(present
    ? `Identity-map gate (P6) — OK (${active} active mapping${active === 1 ? '' : 's'}${required ? `, required by ${required} change${required === 1 ? '' : 's'}` : ''})\n`
    : 'Identity-map gate (P6) — no identity map present, and no compiled plan requires one\n');
}
