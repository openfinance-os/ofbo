// The adapter-conformance gate (Loom 2.0 §16). Adapters keep the core vendor-neutral by
// mapping an external system's state into a signed evidence envelope tied to a catalog
// control. This gate validates every adapter mounted at docs/governance/adapters/:
//
//   well-formed (adapter_id, system, evidence.kind, envelope_fields) ·
//   satisfies_control resolves to a REAL control_id in the control catalog — a mapping to a
//   control that does not exist is a mapping to nothing ·
//   unique adapter_ids.
//
// An adapter without activation_evidence is reported as "declared, not active" (a NOTICE, not
// a failure): it is a wired seam awaiting its first real fetch. This honesty keeps a reference
// mapping from masquerading as a live integration. Run from the repo root:
// `node scripts/adapter-check.mjs`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const ADAPTERS_DIR = 'docs/governance/adapters';
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Is an adapter's integration LIVE? Exported so provider-selection-check.mjs decides "active" by
 * the same rule — two gates disagreeing about what activation means is how a seam gets reported
 * green in one place and pending in another.
 */
export function isActive(adapter) {
  const ae = adapter?.activation_evidence;
  if (!ae || typeof ae !== 'object' || Array.isArray(ae)) return false;
  const values = Object.entries(ae).filter(([key]) => !key.startsWith('_')).map(([, value]) => value);
  return values.length > 0 && values.every((value) => nonEmpty(value) && !/^ADOPT[\s:—-]/i.test(value.trim()));
}

/** Findings and notices for one adapter. `controlIds` is the set of real catalog control ids. */
export function evaluate(adapter, controlIds) {
  const findings = [];
  const notices = [];
  const id = adapter?.adapter_id || '(no adapter_id)';
  if (!nonEmpty(adapter?.adapter_id)) findings.push('adapter has no adapter_id');
  if (!nonEmpty(adapter?.system)) findings.push(`${id}: no system`);
  if (!nonEmpty(adapter?.capability)) findings.push(`${id}: no capability`);
  if (!nonEmpty(adapter?.satisfies_control)) findings.push(`${id}: no satisfies_control`);
  else if (controlIds && !controlIds.has(adapter.satisfies_control)) {
    findings.push(`${id}: satisfies_control ${JSON.stringify(adapter.satisfies_control)} is not a control in the catalog — a mapping to nothing is not integration`);
  }
  if (!nonEmpty(adapter?.evidence?.kind)) findings.push(`${id}: evidence.kind missing — an adapter emits a typed envelope`);
  if (!Array.isArray(adapter?.evidence?.envelope_fields) || adapter.evidence.envelope_fields.length === 0) {
    findings.push(`${id}: evidence.envelope_fields must list the envelope's fields`);
  }
  if (!isActive(adapter)) notices.push(`${id}: declared, not active — no real activation_evidence yet (a wired seam, not a live control)`);
  return { findings, notices };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${ADAPTERS_DIR}`;
  if (!existsSync(dir)) return { findings: [], notices: [], count: 0 };
  const catPath = CATALOG_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const catalog = catPath ? readJson(catPath) : null;
  const controlIds = catalog ? new Set((catalog.controls || []).map((c) => c.control_id)) : null;
  const findings = [];
  const notices = [];
  const seen = new Set();
  let count = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    count++;
    const a = readJson(`${dir}/${name}`);
    if (!a) { findings.push(`${name}: not parseable JSON`); continue; }
    if (seen.has(a.adapter_id)) findings.push(`${a.adapter_id}: duplicate adapter_id`);
    seen.add(a.adapter_id);
    const r = evaluate(a, controlIds);
    findings.push(...r.findings);
    notices.push(...r.notices);
  }
  return { findings, notices, count };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, count } = run();
  for (const n of notices) process.stdout.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nAdapter-conformance gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nAn adapter maps a real system to a real catalog control via a typed envelope.\nSee adapters/README.md.\n');
    process.exit(1);
  }
  process.stdout.write(`Adapter-conformance gate — OK (${count} adapter${count === 1 ? '' : 's'})\n`);
}
