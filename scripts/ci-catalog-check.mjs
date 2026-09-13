// The CI-catalog closure gate. The control catalog is the STATE OF RECORD — bank-grade-gap.md
// says so in as many words ("where they disagree, the catalog wins"). Two things read it and
// nothing was checking that it was complete:
//
//   core/gate-runner.mjs   selects ONLY catalogued controls. A gate the CI workflow runs but the
//                          catalog does not carry is a gate that DISAPPEARS the moment an adopter
//                          takes ci.yml's own advice and switches to the risk-proportionate
//                          runner. Not skipped-with-a-reason — never considered.
//   scripts/generate-scorecard.mjs  counts the catalog. An uncatalogued gate is a control the
//                          method enforces and does not claim, which is the honest direction to
//                          be wrong in, but still wrong.
//
// This gate makes that divergence a build failure, in one direction: **every gate the workflow
// runs must be in the catalog.** The converse is deliberately NOT checked — a catalogued control
// may legitimately run in another lane, on a schedule, or via another gate (`execute: false`),
// and control-catalog-check already refuses a mechanism_ref that cites a ghost.
//
//   node scripts/ci-catalog-check.mjs [--ci <path>]
//
// REPORTS ARE EXEMPT, EXPLICITLY AND LOUDLY. The Loom's rule is that cost is a signal for humans
// and never a merge control, so `token-report.mjs` runs in CI and has no catalog entry — correctly,
// because a catalog entry would assert it is a control. That exemption is a named list below and
// it is PRINTED on every run, pass or fail. A silent exemption list is how the thing this gate
// exists to prevent comes back wearing a different hat.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// An adopted repo carries the workflow at the GitHub path; the bundle carries the reference copy.
export const CI_LOCATIONS = ['.github/workflows/ci.yml', resolve(HARNESS, 'ci/ci.yml')];
export const CATALOG_LOCATIONS = [
  'docs/governance/control-catalog.json',
  'control-catalog.json',
  resolve(HARNESS, 'governance/control-catalog.template.json'),
];

// Report-only tools: run by CI, deliberately NOT controls. Each carries its reason, and both the
// name and the reason are printed on every run.
export const REPORT_ONLY = new Map([
  ['scripts/token-report.mjs', 'cost telemetry — a report, never a merge gate (delivery-harness.md §Record)'],
  // rc.37 (flow-plan Phase 3) — the flow instruments. Same rule, same reason: a merge gated on a
  // duration is a merge gated on the clock, and the cheapest way to make that build green is to
  // stop reading before approving. They create pressure by being VISIBLE, which is the only kind
  // of pressure that does not corrupt the number it measures.
  ['scripts/flow-report.mjs', 'flow telemetry (lead time, stage residency, deployment frequency, CFR, MTTR, gate wall-clock) — a report, never a merge gate'],
  ['scripts/approval-status.mjs', 'approval queue / WIP telemetry — an approval SLA breach is FLAGGED, never gated (flow-plan §1: nothing gates on time or cost)'],
  ['scripts/comprehension-report.mjs', 'comprehension telemetry — the metrics comprehension-check already declares "REPORTED, never gated on their values"'],
  ['scripts/obligation-report.mjs', 'obligation → risk → control → maturity view (2.1.0) — a report for the second line and the examiner, never a merge gate; obligations-check is the control'],
]);

/** Every `node <path>.mjs` invocation in a workflow, in file order, de-duplicated. */
export function gatesInWorkflow(yaml) {
  const found = new Set();
  for (const m of yaml.matchAll(/^\s*(?:-\s*)?node\s+((?:scripts|core|discovery)\/[A-Za-z0-9._/-]+\.mjs)/gm)) {
    found.add(m[1]);
  }
  // Also catch gates invoked mid-line in a multi-command `run:` block.
  for (const m of yaml.matchAll(/(?:^|\s|&&\s*)node\s+((?:scripts|core|discovery)\/[A-Za-z0-9._/-]+\.mjs)/g)) {
    found.add(m[1]);
  }
  return [...found];
}

/**
 * Findings (one per uncatalogued gate). Pure: takes the workflow text and the parsed catalog.
 * A gate counts as catalogued when ANY control names it as its mechanism_ref.
 */
export function evaluate(yaml, catalog) {
  const controls = Array.isArray(catalog?.controls) ? catalog.controls : [];
  const mechanisms = new Set(controls.map((c) => c && c.mechanism_ref).filter((r) => typeof r === 'string'));
  const findings = [];
  for (const gate of gatesInWorkflow(yaml)) {
    if (mechanisms.has(gate)) continue;
    if (REPORT_ONLY.has(gate)) continue;
    findings.push(
      `${gate} is run by the CI workflow but has no control-catalog entry — core/gate-runner.mjs ` +
        `selects only catalogued controls, so this gate would not run at all on the risk-proportionate ` +
        `path. Add a control with mechanism_ref "${gate}" (and its lane/paths), or add it to REPORT_ONLY ` +
        `in scripts/ci-catalog-check.mjs with the reason it is not a control.`,
    );
  }
  return findings;
}

/**
 * rc.33 — two controls sharing one mechanism_ref with DIFFERENT mechanism_args is a silent
 * misexecution: the runner de-duplicates by mechanism and takes the args of whichever control it
 * encountered first, while REPORTING both as executed. The second control's arguments never ran.
 * Pure over the parsed catalog; one finding per colliding mechanism.
 */
export function mechanismArgCollisions(catalog) {
  const byMechanism = new Map(); // mechanism_ref → Map(argsJson → [control_id])
  for (const c of Array.isArray(catalog?.controls) ? catalog.controls : []) {
    if (!c || typeof c.mechanism_ref !== 'string') continue;
    const variants = byMechanism.get(c.mechanism_ref) || new Map();
    const key = JSON.stringify(c.mechanism_args || []);
    variants.set(key, [...(variants.get(key) || []), c.control_id]);
    byMechanism.set(c.mechanism_ref, variants);
  }
  const findings = [];
  for (const [mechanism, variants] of byMechanism) {
    if (variants.size < 2) continue;
    const detail = [...variants.entries()].map(([args, ids]) => `${ids.join('+')} → ${args}`).join(' vs ');
    findings.push(
      `${mechanism} is claimed by controls with DIFFERENT mechanism_args (${detail}) — the gate runner ` +
        `de-duplicates by mechanism and would execute only one variant while reporting all controls as ` +
        `run. Give each variant its own mechanism (a wrapper script), or align the args.`,
    );
  }
  return findings;
}

const firstExisting = (paths) => paths.find((p) => existsSync(p)) || null;

export function main(argv = process.argv.slice(2)) {
  const ciFlag = argv.indexOf('--ci');
  const ciPath = ciFlag >= 0 ? argv[ciFlag + 1] : firstExisting(CI_LOCATIONS);
  const catalogPath = firstExisting(CATALOG_LOCATIONS);

  process.stdout.write('\nCI-catalog closure gate — every enforced gate is in the state of record\n\n');

  if (!ciPath || !existsSync(ciPath)) {
    // No workflow is not a failure: an adoption may not have wired CI yet. Say so.
    process.stdout.write(`  no CI workflow found (looked in ${CI_LOCATIONS.join(', ')}) — nothing to close over\n\n`);
    return 0;
  }
  if (!catalogPath) {
    process.stdout.write('CI-catalog closure gate — FAIL\n\n  - no control catalog found — there is no state of record to close over\n\n');
    return 1;
  }

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (err) {
    process.stdout.write(`CI-catalog closure gate — FAIL\n\n  - ${catalogPath} is not valid JSON: ${err.message}\n\n`);
    return 1;
  }

  const yaml = readFileSync(ciPath, 'utf8');
  const findings = [...evaluate(yaml, catalog), ...mechanismArgCollisions(catalog)];
  const gates = gatesInWorkflow(yaml);

  // The exemptions are printed whether or not anything failed — never a silent carve-out.
  const exempt = gates.filter((g) => REPORT_ONLY.has(g));
  if (exempt.length) {
    process.stdout.write('  report-only, deliberately not controls:\n');
    for (const g of exempt) process.stdout.write(`    · ${g} — ${REPORT_ONLY.get(g)}\n`);
    process.stdout.write('\n');
  }

  // rc.33 — the `execute: false` escape hatch, printed on every run in the same posture as the
  // report-only list. Each entry is a control the runner will never spawn, on the strength of its
  // own note. ci.yml says this list "is short ON PURPOSE"; printing it is what keeps that claim
  // checkable rather than a comment.
  const unexecuted = (Array.isArray(catalog?.controls) ? catalog.controls : [])
    .filter((c) => c && c.execute === false && typeof c.mechanism_ref === 'string');
  if (unexecuted.length) {
    process.stdout.write('  execute:false — the runner never spawns these; each rides its stated note:\n');
    for (const c of unexecuted) process.stdout.write(`    · ${c.control_id} (${c.mechanism_ref}) — ${c.execute_note || 'NO NOTE'}\n`);
    process.stdout.write('\n');
  }

  if (findings.length) {
    process.stdout.write('CI-catalog closure gate — FAIL\n\n');
    for (const f of findings) process.stdout.write(`  - ${f}\n`);
    process.stdout.write('\nThe catalog is the state of record; a gate outside it is enforced but unclaimed,\nand invisible to the gate runner and the scorecard. See core/gate-runner.mjs.\n\n');
    return 1;
  }

  process.stdout.write(
    `  ${gates.length - exempt.length} gate(s) in ${ciPath} — all present in ${catalogPath}\n\n` +
      'CI-catalog closure gate — OK\n\n',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main());
