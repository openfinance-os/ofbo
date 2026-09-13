// Expected-vs-present on the external record for one change (2.1.0, plan row 2.3; PRD F2). What
// the harness EXPECTS is derived from the control catalog — one `gate.<mechanism>` record per
// runnable pr- and release-lane mechanism, plus the fixed stages (risk-class, seal-anchor) — and
// what is PRESENT is what the provider's trail lists. Unmounted, it says so and exits 0: the
// status of a record nobody chose is "not mounted", not "missing everything".
//
//   node scripts/record-trail-status.mjs <CHG-id | run-slug> [--flow delivery|discovery] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { status, trailStatus } from '../core/external-record.mjs';

const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json', 'governance/control-catalog.template.json'];
export const FIXED_STAGES = { delivery: ['risk-class', 'seal-anchor'], discovery: ['intent', 'problem-selected', 'discovery-stopped'] };
export const gateName = (mechanism) => `gate.${String(mechanism).replace(/\.mjs$/, '').replace(/[\\/]/g, '-')}`;

/** The record names a trail in `flow` should carry, from the catalog. */
export function expectedFor(flow, catalog) {
  if (flow !== 'delivery') return [...(FIXED_STAGES[flow] || [])];
  const names = new Set();
  for (const c of catalog?.controls || []) {
    if (typeof c.mechanism_ref !== 'string' || !c.mechanism_ref.endsWith('.mjs') || c.execute === false) continue;
    if (!['pr', 'release'].includes(c.lane || 'pr')) continue;
    names.add(gateName(c.mechanism_ref));
  }
  return [...FIXED_STAGES.delivery, ...[...names].sort()];
}

export function report(expected, present) {
  const have = new Set(present.map((a) => a.name));
  return { present: expected.filter((n) => have.has(n)), missing: expected.filter((n) => !have.has(n)), extra: present.map((a) => a.name).filter((n) => !expected.includes(n)) };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const trail = argv.find((a) => !a.startsWith('--'));
  if (!trail) { process.stderr.write('usage: node scripts/record-trail-status.mjs <CHG-id | run-slug> [--flow delivery|discovery] [--json]\n'); return 2; }
  const fi = argv.indexOf('--flow'); const flow = fi >= 0 ? argv[fi + 1] : 'delivery';
  const st = status(cwd);
  if (!st.mounted) { process.stdout.write(`external record: not mounted — ${st.reason}\n`); return 0; }
  const cp = CATALOG_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const catalog = cp ? JSON.parse(readFileSync(cp, 'utf8')) : null;
  const expected = expectedFor(flow, catalog);
  const t = await trailStatus({ flow, trail }, { cwd });
  if (t.status !== 'ok') { process.stderr.write(`external record (${st.provider}): ${t.status} — ${t.reason}\n`); return 4; }
  const r = report(expected, t.present);
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify({ provider: st.provider, active: st.active, flow: t.flow, trail, compliance: t.compliance, ...r, unexpected_by_provider: t.unexpected }, null, 2) + '\n'); return r.missing.length ? 6 : 0; }
  process.stdout.write(`external record (${st.provider}${st.active ? '' : ', selected-not-active'}) — trail ${trail} on flow ${t.flow}: ${t.compliance ?? 'n/a'}\n`);
  for (const n of r.present) process.stdout.write(`  · present  ${n}\n`);
  for (const n of r.missing) process.stdout.write(`  · MISSING  ${n}\n`);
  for (const n of r.extra) process.stdout.write(`  · extra    ${n} (not expected by the catalog)\n`);
  return r.missing.length ? 6 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
