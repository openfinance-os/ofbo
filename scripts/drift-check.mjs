// The drift gate (Factory Floor WS4 · D4.2). The freeze-stamp gate (D4.1) catches a frozen file
// edited in the repository. This one catches the other side of the same seam: the floor PAGE edited
// after the freeze, so that the record and the surface people are actually reading have quietly
// parted company.
//
//   node scripts/drift-check.mjs
//
// WHAT IT BLOCKS AND WHAT IT REFUSES TO BLOCK is the entire delivery, and the split is stated in
// `core/floor-drift.mjs`'s header at length. In one line: drift blocks NEW claims dated at or after
// the instant it was observed, and never reaches back to a record already merged.
//
// DRIFT ALONE DOES NOT FAIL THE BUILD. This is the judgement in here most worth arguing about, so
// it is stated plainly rather than buried: a page that has drifted with no new claim against it is
// REPORTED — the badge, printed on every run including green ones, and rendered display-only on the
// floor (D1.3) — but it does not exit 1. Failing the build on drift alone would make a red pipeline
// the normal consequence of someone typing on a page, and the cheapest way back to green would be to
// re-freeze reflexively. A re-freeze changes the record. It must be a deliberate act taken because
// the new content is right, never a chore performed to unblock a build. The moment a claim is made —
// a second freeze, an approval citing the artifact — the block is hard and the build fails.
//
// SILENT WHERE UNADOPTED, twice over. A repository that has frozen nothing is untouched. A
// repository that has frozen something but wired no watcher has nothing observed, and the gate says
// so rather than inventing a verdict — until a compiled plan requires the `freeze_drift` capability,
// at which point an unwatched page is unproven currency (DR-F04). Same mandatory-when-compiled shape
// as every other capability in the harness.
//
// Observations live in `docs/governance/floor-drift/`, one file per observation, written by the
// adopter's watcher and never overwritten — the instant drift became known is what decides which
// claims are blocked, and rewriting it would relax the block in the one direction that must not
// relax. The watcher is a separate identity from the freezer (P4's independent observer): a freezer
// that corroborates its own freeze is reported and not counted (DR-F06).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  CAPABILITY,
  checkApprovalClaim,
  checkCurrency,
  checkObservation,
  driftRequired,
  driftState,
} from '../core/floor-drift.mjs';
import { loadApprovals } from '../core/approval-attestations.mjs';
import { RUNS_DIR, loadStamps } from './freeze-stamp-check.mjs';

/** Where the watcher commits its observations. One file per observation; never rewritten. */
export const DRIFT_DIR = 'docs/governance/floor-drift';
export const CHANGES_DIR = 'docs/governance/changes';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** Every freeze stamp in the repository: [{ slug, name, stamp }]. */
export function loadFreezeStamps(cwd = process.cwd()) {
  const dir = `${cwd}/${RUNS_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const slug of readdirSync(dir).sort()) {
    const runDir = `${dir}/${slug}`;
    if (!statSync(runDir).isDirectory()) continue;
    for (const { name, stamp } of loadStamps(runDir)) out.push({ slug, name, stamp });
  }
  return out;
}

/**
 * Every committed observation: [{ name, observation }]. A file may hold one observation or
 * `{ observations: [...] }` — a watcher that batches a sweep into one commit is doing the right
 * thing, as long as it never rewrites a file it has already written.
 */
export function loadObservations(cwd = process.cwd()) {
  const dir = `${cwd}/${DRIFT_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const body = readJson(`${dir}/${name}`);
    if (Array.isArray(body?.observations)) {
      body.observations.forEach((o, i) => out.push({ name: `${name}[${i}]`, observation: o }));
    } else out.push({ name, observation: body });
  }
  return out;
}

/** Every approval attestation across every change: [{ change, file, record }]. */
export function loadClaims(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const change of readdirSync(dir).sort()) {
    const base = `${dir}/${change}`;
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const { file, record } of loadApprovals(base)) out.push({ change, file, record });
  }
  return out;
}

/** Changes whose compiled plan requires proven freeze currency. */
export function changesRequiringDrift(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const envelope = readJson(`${dir}/${name}/change-envelope.json`);
    if (!envelope) continue;
    const plan = readJson(`${dir}/${name}/${envelope.control_plan || 'control-plan.json'}`);
    if (plan && driftRequired(plan)) out.push(name);
  }
  return out;
}

/**
 * The pure half. `stamps` [{ slug, name, stamp }] · `observations` [{ name, observation }] ·
 * `approvals` [{ change, file, record }] · `required` the change ids whose plans compile the
 * capability.
 *
 * Returns `{ findings, states, … }`. `states` is the badge — always returned, including on a clean
 * run, because "drift is always visible" is a goal in its own right (G6) and a state nobody prints
 * is not visible.
 */
export function evaluate({ stamps = [], observations = [], approvals = [], required = [], now = Date.now() } = {}) {
  const findings = [];
  const frozen = stamps.filter((s) => s?.stamp && typeof s.stamp === 'object');
  const isRequired = required.length > 0;

  // UNADOPTED, first sense: nothing has been frozen from a floor page, so there is no photograph for
  // the page to have moved away from. A plan that compiles the capability and finds nothing to apply
  // it to is a plan defect, reported rather than passed quietly — a requirement with nowhere to land
  // reads as satisfied, which is the silent pass this programme is written against.
  if (!frozen.length) {
    return {
      findings: required.map((id) => `DR-F04: ${id}: the plan requires the ${CAPABILITY} capability but nothing has been frozen from a floor page — there is no freeze whose currency could be proven`),
      states: [], observed: 0, drifted: 0, claims: 0, sources: 0,
    };
  }

  const good = [];
  for (const { name, observation } of observations) {
    const f = checkObservation(observation, name);
    if (f.length) { findings.push(...f); continue; }
    good.push(observation);
  }

  const bySource = new Map();
  for (const { slug, name, stamp } of frozen) {
    if (!isStr(stamp.source)) {
      // A stamp that does not say which page it came from can never be watched. Only worth saying
      // where currency is actually required; elsewhere it is D4.1's business, not this gate's.
      if (isRequired) findings.push(`DR-F04: ${slug} · ${name}: the freeze stamp names no source page, so the live page can never be observed and its currency can never be proven`);
      continue;
    }
    if (!bySource.has(stamp.source)) bySource.set(stamp.source, []);
    bySource.get(stamp.source).push({ ...stamp, file: `${slug}/${stamp.file || name}` });
  }

  const states = [];
  for (const source of [...bySource.keys()].sort()) {
    const mine = good.filter((o) => o.source === source);
    // UNADOPTED, second sense: a freeze exists but no watcher has ever looked at this page. There is
    // no observation, so there is nothing to compare and nothing honest to say. Under a compiled
    // requirement that silence becomes a finding instead.
    if (!mine.length && !isRequired) continue;
    const state = driftState({ source, stamps: bySource.get(source), observations: mine });
    states.push(state);
    findings.push(...state.findings);
    if (isRequired) findings.push(...checkCurrency(source, mine, { now }));
  }

  const byName = new Map(states.map((s) => [s.source, s]));
  const allStamps = frozen.map(({ name, stamp }) => ({ ...stamp, file: stamp.file || name }));
  for (const { change, file, record } of approvals) {
    if (!record) continue; // an unreadable approval is the approval gate's finding, not this one's
    findings.push(...checkApprovalClaim(record, { states: byName, stamps: allStamps }, `${change} · ${file}`));
  }

  return {
    findings,
    states,
    sources: states.length,
    observed: good.length,
    drifted: states.filter((s) => s.status === 'drifted').length,
    claims: approvals.length,
  };
}

export function run(cwd = process.cwd()) {
  return evaluate({
    stamps: loadFreezeStamps(cwd),
    observations: loadObservations(cwd),
    approvals: loadClaims(cwd),
    required: changesRequiringDrift(cwd),
  });
}

/** The badge line for one source — printed on green runs too, because drift must stay visible. */
export const badge = (s) => {
  const mark = { drifted: 'DRIFTED', 'in-sync': 'in sync', unobserved: 'not observed since freeze', unknown: 'UNKNOWN' }[s.status] || s.status;
  const when = s.status === 'drifted' ? ` since ${s.drifted_since}` : s.observed_at ? ` as of ${s.observed_at}` : '';
  return `  ${mark}${when} — ${s.source}${s.file ? ` (${s.file})` : ''}`;
};

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, states, sources, observed, drifted, claims } = run();
  for (const s of states) process.stdout.write(`${badge(s)}\n`);
  if (findings.length) {
    process.stderr.write('\nDrift gate (D4.2) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nDrift never invalidates a record already merged: a decision made against the\nfreeze that existed at the time is still a decision. What it does block is a NEW\nclaim against a page that has moved on — another freeze, or an approval citing\nthe frozen artifact. Re-freeze from the floor and re-issue the claim against the\nnew freeze; do not re-stamp the old bytes to clear the block.\n');
    process.exit(1);
  }
  process.stdout.write(sources
    ? `Drift gate (D4.2) — OK (${sources} watched page${sources === 1 ? '' : 's'}, ${drifted} drifted, ${observed} observation${observed === 1 ? '' : 's'}, ${claims} claim${claims === 1 ? '' : 's'} judged)\n`
    : 'Drift gate (D4.2) — nothing frozen from a floor page has been observed (no drift detection wired, and no compiled plan requires it)\n');
}
