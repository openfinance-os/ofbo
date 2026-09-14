// Token telemetry — the macro ring's first instrument (enterprise-rings.md). The Loom's
// Limits are honest that "the cost/moat curve is illustrative"; this is the machinery that
// makes it MEASURABLE on the worked example. Each build-loop iteration records its output-token
// spend to docs/governance/token-ledger.json (an append-only ledger the loop writes at step 5,
// Record); this report aggregates it per iteration and per milestone.
//
// It is TELEMETRY, NOT A GATE. Spend never blocks a merge — cost is a signal for humans, not a
// control, and treating it as a control would be a category error (the review gate is the
// control; see delivery-harness.md). `--check` validates only that the ledger is well-FORMED
// (so a malformed ledger is caught), never that spend is under any threshold.
//
// Run from the repo root: `node scripts/token-report.mjs` (print) or `--check` (validate shape).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const LEDGER_LOCATIONS = ['docs/governance/token-ledger.json', 'token-ledger.json'];

/** Aggregate spend across the ledger. Pure. */
export function aggregate(ledger) {
  const entries = (ledger && ledger.entries) || [];
  const by_iteration = {};
  const by_milestone = {};
  let total = 0;
  for (const e of entries) {
    const t = Number.isFinite(e.output_tokens) ? e.output_tokens : 0;
    total += t;
    by_iteration[e.iteration] = (by_iteration[e.iteration] || 0) + t;
    if (e.milestone) by_milestone[e.milestone] = (by_milestone[e.milestone] || 0) + t;
  }
  return { total_output_tokens: total, iterations: entries.length, by_iteration, by_milestone };
}

/** Findings if the ledger is malformed. Empty ⇒ well-formed (an empty ledger is valid). */
export function validate(ledger) {
  const entries = ledger && ledger.entries;
  if (!Array.isArray(entries)) return ['token-ledger.json has no `entries` array'];
  const findings = [];
  entries.forEach((e, i) => {
    if (!(typeof e.iteration === 'string' && e.iteration.trim())) findings.push(`entry ${i}: no iteration id`);
    if (!(typeof e.output_tokens === 'number' && Number.isFinite(e.output_tokens) && e.output_tokens >= 0)) {
      findings.push(`entry ${i}: output_tokens must be a finite, non-negative number (got ${JSON.stringify(e.output_tokens)})`);
    }
    if (e.milestone !== undefined && typeof e.milestone !== 'string') findings.push(`entry ${i}: milestone must be a string`);
  });
  return findings;
}

function loadLedger(cwd = process.cwd()) {
  const path = LEDGER_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ledger = loadLedger();
  if (!ledger) { process.stdout.write('Token telemetry — no token-ledger.json yet. OK\n'); process.exit(0); }
  if (process.argv.includes('--check')) {
    const findings = validate(ledger);
    if (findings.length) {
      process.stderr.write('\nToken telemetry — malformed ledger\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    process.stdout.write('Token telemetry — ledger well-formed. OK\n');
    process.exit(0);
  }
  const a = aggregate(ledger);
  process.stdout.write(`\nToken spend — ${a.iterations} iterations, ${a.total_output_tokens.toLocaleString()} output tokens total\n\n  by milestone:\n`);
  for (const [m, t] of Object.entries(a.by_milestone).sort()) process.stdout.write(`    ${m.padEnd(10)} ${t.toLocaleString()}\n`);
  process.stdout.write('\n  (telemetry, not a gate — cost never blocks a merge)\n');
}
