// Data governance (PDPL/GDPR retention & right-to-erasure) — the data-lifecycle gate. A
// harness that only tags risks can still hoard data forever and have no answer to an erasure
// request. This gate makes the *disposition* a merge condition, read from a data-lifecycle
// manifest: every data category the solution touches must declare a classification, a lawful
// basis (for personal data), a BOUNDED retention (or a justified indefinite hold), an erasure
// method (right-to-erasure — or a justified legal-hold exemption), and a residency.
//
// It enforces that the disposition is DECLARED and bounded — not that it is executed. The
// crypto-shred / tokenization / deletion jobs that carry it out are the adopter's data
// platform (see governance/data-protection-runbook.md); this gate stops a release that never
// decided how long it keeps data or how it honours erasure.
//
// Run from the repo root: `node scripts/data-lifecycle-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const MANIFEST_LOCATIONS = ['docs/governance/data-lifecycle.json', 'data-lifecycle.json'];

const CLASSES = new Set(['personal', 'sensitive', 'non-personal']);
const PERSONAL = new Set(['personal', 'sensitive']);
// ADOPT: values that are not a real bounded retention.
const BAD_PERIOD = new Set(['', 'indefinite', 'forever', 'permanent', 'n/a', 'none']);

// A real ISO-8601 duration: P[nY][nM][nW][nD][T[nH][nM][nS]] with at least one component.
// The lookaheads reject bare "P", a "PT" with no time part, and prose like "perpetual"
// or "pending" that merely starts with "p" (the old /^p\w/ accepted those and let an
// unbounded hold pass the right-to-erasure gate).
const ISO8601_DURATION = /^p(?=[0-9t])(\d+y)?(\d+m)?(\d+w)?(\d+d)?(t(?=[0-9])(\d+h)?(\d+m)?(\d+s)?)?$/;

/** A bounded retention period: an ISO-8601 duration (P…) or "<N> days|months|years". */
export function validPeriod(p) {
  if (typeof p !== 'string') return false;
  const s = p.trim().toLowerCase();
  if (BAD_PERIOD.has(s)) return false;
  if (ISO8601_DURATION.test(s)) return true;
  return /^\d+\s*(d|m|y|day|days|month|months|year|years)$/.test(s);
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** Findings (one per violation). Empty ⇒ every data category has a bounded, erasable disposition. */
export function evaluate(manifest) {
  const cats = manifest && manifest.categories;
  if (!Array.isArray(cats) || cats.length === 0) {
    return ['data-lifecycle manifest has no `categories` — the data inventory and its dispositions are undeclared'];
  }
  const findings = [];
  for (const c of cats) {
    const name = (c && c.category) || '(unnamed category)';
    if (!CLASSES.has(c.classification)) {
      findings.push(`${name}: classification must be personal|sensitive|non-personal (got ${JSON.stringify(c.classification)})`);
      continue; // classification drives the rest
    }
    const personal = PERSONAL.has(c.classification);
    if (personal && !nonEmpty(c.lawful_basis)) findings.push(`${name}: personal data needs a lawful_basis`);

    const r = c.retention || {};
    const bounded = validPeriod(r.period);
    const justifiedIndefinite = r.indefinite === true && nonEmpty(r.justification);
    if (!bounded && !justifiedIndefinite) {
      findings.push(`${name}: retention must be a bounded period or a justified indefinite hold (got ${JSON.stringify(r)})`);
    }

    if (personal) {
      const e = c.erasure || {};
      const method = nonEmpty(e.method) ? e.method.trim().toLowerCase() : '';
      if (!method) findings.push(`${name}: personal data needs an erasure method (right-to-erasure)`);
      else if (method === 'none' && !nonEmpty(e.exemption)) findings.push(`${name}: erasure method 'none' needs a legal-hold exemption`);
      if (!nonEmpty(c.residency)) findings.push(`${name}: personal data needs a declared residency`);
    }
  }
  return findings;
}

function run(cwd = process.cwd()) {
  const path = MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return [`no data-lifecycle manifest found (looked in ${MANIFEST_LOCATIONS.join(', ')}) — data retention & erasure are undeclared`];
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return [`data-lifecycle manifest is not valid JSON: ${e.message}`]; }
  return evaluate(manifest);
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = run();
  if (findings.length) {
    process.stderr.write('\nData-lifecycle gate (retention & right-to-erasure) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery data category must declare a bounded retention and an erasure disposition.\nSee ../loom/references/bank-grade-gap.md (cluster D) and governance/data-protection-runbook.md.\n');
    process.exit(1);
  }
  process.stdout.write('Data-lifecycle gate (retention & right-to-erasure) — OK\n');
}
