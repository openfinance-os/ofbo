// Retry every record envelope queued in .loom/record-outbox/ (2.1.0, plan row 2.2). A queued
// envelope is one the provider was reached for and failed; the seam re-runs the provenance rules
// before every retry, so an envelope tampered with while it waited is REMOVED and reported, never
// posted. Unmounted, nothing moves and the reason is printed.
//
//   node scripts/record-flush-outbox.mjs [--dry-run]
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { OUTBOX_DIR, flushOutbox, listOutbox } from '../core/external-record.mjs';

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const dryRun = argv.includes('--dry-run');
  const before = listOutbox(cwd).length;
  if (before === 0) { process.stdout.write(`record outbox — empty (${OUTBOX_DIR})\n`); return 0; }
  const r = await flushOutbox({ cwd, dryRun });
  process.stdout.write(`record outbox — ${before} queued${dryRun ? ' (dry run: nothing removed)' : ''}\n`);
  for (const x of r.recorded) process.stdout.write(`  · recorded ${x.name} → ${x.id ?? '(dry run)'}\n`);
  for (const x of r.rejected) { process.stdout.write(`  · REJECTED ${x.name ?? x.file} — removed, can never post:\n`); for (const f of x.findings) process.stdout.write(`      - ${f}\n`); }
  for (const x of r.queued) process.stdout.write(`  · still queued ${x.name} — ${x.error}\n`);
  if (r.unmounted) process.stdout.write(`  external record: not mounted — ${r.unmounted}\n`);
  return r.queued.length ? 4 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
