// Q2 — SAST output validation. "The scanner ran" is not a control; the control is that the
// scanner's OUTPUT exists, is real SARIF from a named tool, and clears the policy threshold.
// This gate validates the semantics of the SARIF report the Q2 seam produces (Snyk Code,
// CodeQL, Semgrep — any SARIF producer):
//
//   report present · parseable · at least one run by a named tool · error-level findings
//   ≤ MAX_ERRORS · warning-level findings ≤ MAX_WARNINGS.
//
// A missing report FAILS: an unfilled seam is a gap, not a pass.
//
// Run from the repo root: `node scripts/sast-check.mjs [path/to/report.sarif]`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SARIF_LOCATIONS = ['docs/governance/evidence/sast.sarif', 'sast.sarif'];
// ADOPT: your severity policy. Zero errors is the floor for a regulated release.
export const MAX_ERRORS = 0;
export const MAX_WARNINGS = 20;

const levelOf = (r, run) => {
  if (r.level) return r.level;
  const rule = (run.tool?.driver?.rules || []).find((x) => x.id === r.ruleId);
  return rule?.defaultConfiguration?.level || 'warning'; // SARIF default
};

/** Findings (one per violation). Empty ⇒ the SAST output is real and within policy. */
export function evaluate(sarif, { maxErrors = MAX_ERRORS, maxWarnings = MAX_WARNINGS } = {}) {
  const findings = [];
  const runs = sarif && sarif.runs;
  if (!Array.isArray(runs) || runs.length === 0) {
    return ['SARIF has no runs — the SAST seam produced no evidence (Q2)'];
  }
  let errors = 0, warnings = 0;
  const samples = [];
  for (const run of runs) {
    const tool = run.tool?.driver?.name;
    if (!tool) findings.push('a SARIF run names no tool — evidence must identify what produced it');
    for (const r of run.results || []) {
      const level = levelOf(r, run);
      if (level === 'error') { errors++; if (samples.length < 5) samples.push(`${r.ruleId || '?'}: ${r.message?.text || ''}`.slice(0, 120)); }
      if (level === 'warning') warnings++;
    }
  }
  if (errors > maxErrors) findings.push(`${errors} error-level finding(s) exceed the policy maximum of ${maxErrors} — e.g. ${samples.join(' · ')}`);
  if (warnings > maxWarnings) findings.push(`${warnings} warning-level findings exceed the policy maximum of ${maxWarnings}`);
  return findings;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const path = arg || SARIF_LOCATIONS.map((p) => `${process.cwd()}/${p}`).find(existsSync);
  let findings;
  if (!path || !existsSync(path)) {
    findings = [`no SARIF report found (looked in ${SARIF_LOCATIONS.join(', ')}) — the Q2 seam is unfilled, which is a gap, not a pass`];
  } else {
    try { findings = evaluate(JSON.parse(readFileSync(path, 'utf8'))); }
    catch (e) { findings = [`SARIF is not valid JSON: ${e.message}`]; }
  }
  if (findings.length) {
    process.stderr.write('\nSAST output gate (Q2) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nFill the Q2 seam with a real SARIF producer and clear the policy threshold.\nSee ../loom/references/supply-chain-security.md.\n');
    process.exit(1);
  }
  process.stdout.write('SAST output gate (Q2) — OK\n');
}
