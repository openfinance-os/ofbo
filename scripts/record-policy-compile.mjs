// The route-policy compiler (2.1.0, hardening plan row 2.9; PRD F6; decision K3). Gate definitions
// have ONE source — docs/governance/control-catalog.json — and the external record's policy is
// compiled from it, never hand-written: one required record per runnable pr- and release-lane
// mechanism, plus the fixed stages (risk-class, seal-anchor), each of which must be PRESENT and
// COMPLIANT on a change's trail. The compiled policy is provider-neutral JSON; the mounted
// provider renders it (Kosli: a Rego file for `kosli evaluate trail`). Both carry the catalog's
// sha256, and `--verify` fails when the catalog moved since — a stale policy is the second gate
// list ci-catalog-check already refuses.
//
// The enforcement of record stays the CI gate and the sealed bundle; the provider policy is a
// second check on the RECORD, never the only one (PRD F6).
//
//   node scripts/record-policy-compile.mjs                 write docs/governance/record-policy.json
//   node scripts/record-policy-compile.mjs --render        also render the mounted provider's form
//   node scripts/record-policy-compile.mjs --verify        fail if the stored policy is stale (pr lane)
//   node scripts/record-policy-compile.mjs --stdout        print, write nothing
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { status as recordStatus } from '../core/external-record.mjs';

export const SCHEMA_ID = 'loom.record-policy/v1';
export const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json', 'governance/control-catalog.template.json'];
export const POLICY_PATH = 'docs/governance/record-policy.json';
export const FIXED_STAGES = ['risk-class', 'seal-anchor'];
export const gateName = (mechanism) => `gate.${String(mechanism).replace(/\.mjs$/, '').replace(/[\\/]/g, '-')}`;
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Compile the policy from a parsed catalog (+ its raw text for the digest). Pure. */
export function compilePolicy(catalog, catalogText) {
  const byName = new Map();
  for (const c of catalog?.controls || []) {
    if (typeof c.mechanism_ref !== 'string' || !c.mechanism_ref.endsWith('.mjs') || c.execute === false) continue;
    const lane = c.lane || 'pr';
    if (!['pr', 'release'].includes(lane)) continue;
    const name = gateName(c.mechanism_ref);
    const e = byName.get(name) || { name, kind: 'gate', mechanism: c.mechanism_ref, lane, controls: [] };
    e.controls.push(c.control_id);
    byName.set(name, e);
  }
  const required = [
    ...FIXED_STAGES.map((n) => ({ name: n, kind: n, mechanism: null, lane: n === 'seal-anchor' ? 'release' : 'pr', controls: n === 'seal-anchor' ? ['HG-0003'] : ['POLICY-COMPILER'] })),
    ...[...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ ...e, controls: e.controls.sort() })),
  ];
  return {
    schema: SCHEMA_ID,
    catalog_sha256: sha256(catalogText),
    compiled_at: null, // stamped by the writer; excluded from the digest so a recompile of an unchanged catalog is byte-stable
    rule: 'every required record is PRESENT on the trail and COMPLIANT (a gate record whose result is not pass/pass-cached is non-compliant); an unexpected record is reported, never fatal',
    required,
  };
}

/** Bytes that must not change between compiles of one catalog (everything but the stamp). */
export const stablePolicy = (p) => { const { compiled_at, ...rest } = p; return JSON.stringify(rest); }; // eslint-disable-line no-unused-vars

export function loadCatalog(cwd = process.cwd()) {
  const p = CATALOG_LOCATIONS.map((x) => join(cwd, x)).find(existsSync);
  if (!p) return null;
  const text = readFileSync(p, 'utf8');
  return { path: p, text, catalog: JSON.parse(text) };
}

/** --verify: the stored policy must be the one this catalog compiles to. Findings. */
export function verify(cwd = process.cwd()) {
  const stored = join(cwd, POLICY_PATH);
  if (!existsSync(stored)) return { findings: [], inert: true };
  const cat = loadCatalog(cwd);
  if (!cat) return { findings: [`${POLICY_PATH} exists but no control catalog does — a policy with no source`], inert: false };
  let policy;
  try { policy = JSON.parse(readFileSync(stored, 'utf8')); } catch { return { findings: [`${POLICY_PATH} is not parseable JSON`], inert: false }; }
  const fresh = compilePolicy(cat.catalog, cat.text);
  const findings = [];
  if (policy.catalog_sha256 !== fresh.catalog_sha256) findings.push(`${POLICY_PATH} was compiled from catalog ${String(policy.catalog_sha256).slice(0, 12)}… but the catalog is now ${fresh.catalog_sha256.slice(0, 12)}… — recompile (node scripts/record-policy-compile.mjs); a policy behind its catalog is a second gate list`);
  else if (stablePolicy(policy) !== stablePolicy(fresh)) findings.push(`${POLICY_PATH} does not match what the catalog compiles to (same catalog digest, different policy) — it was edited by hand; recompile`);
  return { findings, inert: false, policy: fresh };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  if (argv.includes('--verify')) {
    const { findings, inert } = verify(cwd);
    if (findings.length) { process.stderr.write('\nRecord-policy gate — FAIL\n\n'); for (const f of findings) process.stderr.write(`  - ${f}\n`); return 1; }
    process.stdout.write(inert ? `Record-policy gate — OK (no ${POLICY_PATH}; nothing compiled, nothing stale)\n` : 'Record-policy gate — OK (policy matches the catalog)\n');
    return 0;
  }
  const cat = loadCatalog(cwd);
  if (!cat) { process.stderr.write('no control catalog found — nothing to compile\n'); return 2; }
  const policy = compilePolicy(cat.catalog, cat.text);
  policy.compiled_at = new Date().toISOString();
  if (argv.includes('--stdout')) { process.stdout.write(JSON.stringify(policy, null, 2) + '\n'); return 0; }
  const out = join(cwd, POLICY_PATH);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(policy, null, 2) + '\n');
  process.stdout.write(`record policy → ${POLICY_PATH} (${policy.required.length} required records, catalog ${policy.catalog_sha256.slice(0, 12)}…)\n`);
  if (argv.includes('--render')) {
    const st = recordStatus(cwd);
    if (!st.mounted) { process.stdout.write(`  render: external record not mounted — ${st.reason}; the neutral policy stands alone\n`); return 0; }
    const provider = await import(st.module);
    if (typeof provider.renderPolicy !== 'function') { process.stdout.write(`  render: provider ${st.provider} renders no policy form\n`); return 0; }
    const files = provider.renderPolicy(policy);
    for (const [rel, text] of Object.entries(files)) { const p = join(cwd, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); process.stdout.write(`  rendered (${st.provider}) → ${rel}\n`); }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
