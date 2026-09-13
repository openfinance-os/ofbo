// The provenance gate (2.1.0, hardening plan row 2.6; PRD loom-kosli F5). Applies core/provenance.mjs
// rules PR1–PR6 to every record envelope the tree still holds:
//
//   .loom/record-outbox/*.json                — queued for retry; a queued envelope that the rules
//                                               refuse must be seen failing, not flushed later
//   docs/governance/evidence/records/*.json   — the copies the gate runner keeps beside the evidence
//                                               it sealed (decision K1: the bundle is the outbox)
//
// The same rules run INSIDE the seam before anything is posted, so this gate can never find an
// envelope the provider already holds — it finds the ones that would have been refused and are
// still sitting in the tree claiming to be records. Inert when there are none: "OK (no record
// envelopes present)", which is the honest resting state of an adopter who has not mounted a
// provider, never a vacuous green.
//
//   node scripts/provenance-check.mjs [--dir <extra dir>] [--draft]
//   --draft: accept unsigned envelopes (a shape check on drafts, never evidence)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { evaluateProvenance } from '../core/provenance.mjs';
import { OUTBOX_DIR, loadIssuers, loadRegistry } from '../core/external-record.mjs';

export const RECORD_DIRS = [OUTBOX_DIR, 'docs/governance/evidence/records'];

/** Every envelope under the record dirs: [{ file, envelope }]. An unparseable file is an envelope of null. */
export function collect(cwd = process.cwd(), dirs = RECORD_DIRS) {
  const out = [];
  for (const d of dirs) {
    const p = join(cwd, d);
    if (!existsSync(p)) continue;
    for (const n of readdirSync(p).filter((x) => x.endsWith('.json')).sort()) {
      let envelope = null;
      try { envelope = JSON.parse(readFileSync(join(p, n), 'utf8')); } catch { envelope = null; }
      out.push({ file: join(d, n), envelope });
    }
  }
  return out;
}

export function evaluate(items, { registry, issuers, requireSignature = true, now = Date.now() } = {}) {
  const findings = [];
  for (const { file, envelope } of items) {
    if (!envelope || typeof envelope !== 'object') { findings.push(`${file}: not a parseable record envelope`); continue; }
    const { record, ...env } = envelope; // eslint-disable-line no-unused-vars
    for (const f of evaluateProvenance(env, { registry, issuers, requireSignature, now })) findings.push(`${file}: ${f}`);
  }
  return findings;
}

export function run(cwd = process.cwd(), argv = process.argv.slice(2)) {
  const extra = []; const i = argv.indexOf('--dir'); if (i >= 0 && argv[i + 1]) extra.push(argv[i + 1]);
  const items = collect(cwd, [...RECORD_DIRS, ...extra]);
  const findings = evaluate(items, { registry: loadRegistry(cwd), issuers: loadIssuers(cwd), requireSignature: !argv.includes('--draft') });
  return { findings, count: items.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, count } = run();
  if (findings.length) {
    process.stderr.write('\nProvenance gate (PR1–PR6) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA record leaves the tree only when a tool produced it, its actor is not its author, it is not\nnarrated past intent, acceptance is human, its timestamps hold, and the runner that produced it is\nnamed. See core/provenance.mjs and ../loom/references/kosli-seam.md.\n');
    process.exit(1);
  }
  if (count === 0) process.stdout.write('Provenance gate (PR1–PR6) — OK (no record envelopes present)\n');
  else process.stdout.write(`Provenance gate (PR1–PR6) — OK (${count} envelope${count === 1 ? '' : 's'} checked)\n`);
}
