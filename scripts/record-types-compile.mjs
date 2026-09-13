// The record-type compiler (2.1.0, hardening plan row 2.9; PRD F6; decision K3). One record TYPE
// per gate family the catalog declares (Q, A, D, PA1, PA2, R, product-eval, assurance-cadence,
// decision-log, brainkit-conformance) plus the generic `gate` and the fixed stages — each with the
// JSON schema of the envelope payload it carries and its pass condition as DATA, so a provider can
// evaluate "is this record compliant" from the record alone. Provider-neutral JSON; the mounted
// provider renders it (Kosli: one custom attestation type per entry — schema + jq rule). Carries
// the catalog's sha256; `--verify` fails when the catalog moved.
//
//   node scripts/record-types-compile.mjs [--render | --verify | --stdout]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { CATALOG_LOCATIONS, loadCatalog, sha256 } from './record-policy-compile.mjs';
import { status as recordStatus } from '../core/external-record.mjs';

export const SCHEMA_ID = 'loom.record-types/v1';
export const TYPES_PATH = 'docs/governance/record-types.json';
export { CATALOG_LOCATIONS };

const GATE_PAYLOAD = {
  type: 'object',
  required: ['gate', 'result', 'controls'],
  properties: {
    gate: { type: 'string', pattern: '\\.mjs$' },
    result: { type: 'string', enum: ['pass', 'pass-cached', 'fail', 'timeout', 'error'] },
    controls: { type: 'array', minItems: 1, items: { type: 'string' } },
    lane: { type: 'string' },
  },
};
const GATE_PASS = { field: 'payload.result', in: ['pass', 'pass-cached'] };

export function compileTypes(catalog, catalogText) {
  const families = new Map();
  for (const c of catalog?.controls || []) {
    if (!c.gate_family) continue;
    const f = families.get(c.gate_family) || { family: c.gate_family, controls: [] };
    f.controls.push(c.control_id);
    families.set(c.gate_family, f);
  }
  const types = [
    { name: 'loom-gate', kind: 'gate', family: null, controls: [], schema: GATE_PAYLOAD, pass: GATE_PASS, description: 'A gate-runner result for one mechanism (core/gate-runner.mjs --record)' },
    ...[...families.values()].sort((a, b) => a.family.localeCompare(b.family)).map((f) => ({
      name: `loom-gate-${f.family.toLowerCase()}`, kind: 'gate', family: f.family, controls: f.controls.sort(), schema: GATE_PAYLOAD, pass: GATE_PASS,
      description: `A gate-runner result for a mechanism in family ${f.family} (${f.controls.sort().join(', ')})`,
    })),
    { name: 'loom-risk-class', kind: 'risk-class', family: null, controls: ['POLICY-COMPILER'], description: 'The compiled tier and plan hash (core/risk-class-attestation.mjs)',
      schema: { type: 'object', required: ['risk_tier', 'plan_hash'], properties: { risk_tier: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, plan_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
      pass: { field: 'payload.plan_hash', matches: '^[0-9a-f]{64}$' } },
    { name: 'loom-seal-anchor', kind: 'seal-anchor', family: null, controls: ['HG-0003'], description: 'The final seal of the evidence chain (scripts/seal-evidence.mjs --record)',
      schema: { type: 'object', required: ['anchor', 'release_commit', 'entries'], properties: { anchor: { type: 'string', pattern: '^[0-9a-f]{64}$' }, release_commit: { type: 'string', pattern: '^[0-9a-f]{40}$' }, entries: { type: 'integer', minimum: 1 } } },
      pass: { field: 'payload.anchor', matches: '^[0-9a-f]{64}$' } },
  ];
  return { schema: SCHEMA_ID, catalog_sha256: sha256(catalogText), compiled_at: null, envelope_schema: 'loom.record-envelope/v1', types };
}
const stable = (t) => { const { compiled_at, ...rest } = t; return JSON.stringify(rest); }; // eslint-disable-line no-unused-vars

export function verify(cwd = process.cwd()) {
  const stored = join(cwd, TYPES_PATH);
  if (!existsSync(stored)) return { findings: [], inert: true };
  const cat = loadCatalog(cwd);
  if (!cat) return { findings: [`${TYPES_PATH} exists but no control catalog does`], inert: false };
  let types;
  try { types = JSON.parse(readFileSync(stored, 'utf8')); } catch { return { findings: [`${TYPES_PATH} is not parseable JSON`], inert: false }; }
  const fresh = compileTypes(cat.catalog, cat.text);
  const findings = [];
  if (types.catalog_sha256 !== fresh.catalog_sha256) findings.push(`${TYPES_PATH} was compiled from catalog ${String(types.catalog_sha256).slice(0, 12)}… but the catalog is now ${fresh.catalog_sha256.slice(0, 12)}… — recompile (node scripts/record-types-compile.mjs)`);
  else if (stable(types) !== stable(fresh)) findings.push(`${TYPES_PATH} does not match what the catalog compiles to — edited by hand; recompile`);
  return { findings, inert: false };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  if (argv.includes('--verify')) {
    const { findings, inert } = verify(cwd);
    if (findings.length) { process.stderr.write('\nRecord-types gate — FAIL\n\n'); for (const f of findings) process.stderr.write(`  - ${f}\n`); return 1; }
    process.stdout.write(inert ? `Record-types gate — OK (no ${TYPES_PATH}; nothing compiled, nothing stale)\n` : 'Record-types gate — OK (types match the catalog)\n');
    return 0;
  }
  const cat = loadCatalog(cwd);
  if (!cat) { process.stderr.write('no control catalog found — nothing to compile\n'); return 2; }
  const types = compileTypes(cat.catalog, cat.text);
  types.compiled_at = new Date().toISOString();
  if (argv.includes('--stdout')) { process.stdout.write(JSON.stringify(types, null, 2) + '\n'); return 0; }
  const out = join(cwd, TYPES_PATH);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(types, null, 2) + '\n');
  process.stdout.write(`record types → ${TYPES_PATH} (${types.types.length} types, catalog ${types.catalog_sha256.slice(0, 12)}…)\n`);
  if (argv.includes('--render')) {
    const st = recordStatus(cwd);
    if (!st.mounted) { process.stdout.write(`  render: external record not mounted — ${st.reason}\n`); return 0; }
    const provider = await import(st.module);
    if (typeof provider.renderTypes !== 'function') { process.stdout.write(`  render: provider ${st.provider} renders no type form\n`); return 0; }
    for (const [rel, text] of Object.entries(provider.renderTypes(types))) { const p = join(cwd, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); process.stdout.write(`  rendered (${st.provider}) → ${rel}\n`); }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
