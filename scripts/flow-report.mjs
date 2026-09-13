// Flow telemetry (flow-plan Phase 3.2) — the value stream, measured from the artifacts the
// harness already produces. The control frame was strong and honest and the flow was invisible:
// grep the tree before rc.37 and there is no lead time, no cycle time, no deployment frequency,
// no change-failure rate and no MTTR anywhere. A bank adopting this could not answer "did
// governance get faster or slower?" — the question that decides whether the programme survives.
//
// It is TELEMETRY, NOT A GATE — the same posture as scripts/token-report.mjs, and for the same
// reason. Nothing here blocks a merge. A lead time is a signal for humans; treating a duration as
// a control would be a category error and would immediately corrupt the numbers it measures (the
// first thing a gated metric buys you is a repo that games it). `--check` validates only that the
// inputs are well-FORMED, never that any duration, rate or count is under any threshold.
//
// What it reads, all of it already there:
//   lead time + stage residency   change-envelope state_history (rc.37)
//   deployment frequency          state_history transitions into `in-production`, plus the
//                                 sealed release records (evidence manifest, release-subject)
//   change-failure rate + MTTR    operations-signal.json `caused_by_change` / `resolved_at` (rc.37)
//   gate wall-clock per lane      gate-run-*.json `executed[].ms` (the runner has recorded it
//                                 since rc.34; nothing read it)
//
// Every figure names its denominator and says when it cannot be computed. "No completed changes
// yet" is a real answer; a confident zero over an empty set is not.
//
// Run from the repo root: `node scripts/flow-report.mjs` (print) or `--check` (validate shape).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const CHANGES_DIR = 'docs/governance/changes';
export const SIGNAL_LOCATIONS = ['docs/governance/operations-signal.json', 'operations-signal.json'];
export const MANIFEST_LOCATIONS = ['docs/governance/evidence/manifest.json', 'evidence/manifest.json'];
export const SUBJECT_LOCATIONS = ['docs/governance/release-subject.json', 'release-subject.json'];
// Signal types that count as a CHANGE FAILURE when they are attributed to a change. A regulatory
// bulletin or a customer signal is not a failure of the change that shipped last.
export const FAILURE_TYPES = new Set(['incident', 'slo-breach', 'risk-materialised', 'near-miss']);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const parsed = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/** Ordered, dated history entries for one change — the only thing every figure below reads. */
function timeline(change) {
  return (Array.isArray(change?.state_history) ? change.state_history : [])
    .map((e) => ({ state: e?.state, at: parsed(e?.at), by: e?.by }))
    .filter((e) => typeof e.state === 'string' && e.at !== null)
    .sort((a, b) => a.at - b.at);
}

/**
 * Lead time per change: `classified` → `in-production`. Changes that have not reached production
 * are reported separately as in-flight rather than folded in at zero — an unfinished change is
 * not a fast one.
 */
export function leadTimes(changes = []) {
  const completed = [];
  const in_flight = [];
  for (const c of changes) {
    const t = timeline(c);
    if (!t.length) continue;
    const start = t.find((e) => e.state === 'classified');
    const end = t.find((e) => e.state === 'in-production');
    if (!start) continue;
    const id = c.change_id || '(no id)';
    if (end) completed.push({ change_id: id, days: round((end.at - start.at) / DAY), classified_at: new Date(start.at).toISOString(), in_production_at: new Date(end.at).toISOString() });
    else in_flight.push({ change_id: id, state: t[t.length - 1].state, age_days: round((Date.now() - start.at) / DAY) });
  }
  completed.sort((a, b) => a.days - b.days);
  const days = completed.map((c) => c.days);
  return {
    completed,
    in_flight,
    n: completed.length,
    mean_days: days.length ? round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    median_days: days.length ? round(days[Math.floor((days.length - 1) / 2)]) : null,
  };
}

/**
 * How long changes sit in each state — the histogram that says whether the machinery or the
 * waiting is the cost. The last state of an unfinished change accrues residency to NOW (that is
 * exactly the WIP a queue report wants), and is counted as still open.
 */
export function stageResidency(changes = [], now = Date.now()) {
  const by = {};
  for (const c of changes) {
    const t = timeline(c);
    for (let i = 0; i < t.length; i++) {
      const to = i + 1 < t.length ? t[i + 1].at : now;
      const open = i + 1 >= t.length;
      const b = (by[t[i].state] ||= { n: 0, open: 0, total_days: 0, max_days: 0 });
      const d = Math.max(0, (to - t[i].at) / DAY);
      b.n += 1;
      if (open) b.open += 1;
      b.total_days = round(b.total_days + d, 2);
      b.max_days = round(Math.max(b.max_days, d), 2);
    }
  }
  for (const b of Object.values(by)) b.mean_days = round(b.total_days / b.n, 2);
  return by;
}

/**
 * Deployment frequency. Two independent sightings, deliberately reported side by side rather
 * than merged: DATED production transitions (from state_history) give a rate; sealed release
 * records give a count of releases that were actually evidenced. Where they disagree, that
 * disagreement is the finding a human wants to see, so nothing here averages them away.
 */
export function deployments(changes = [], releases = [], now = Date.now()) {
  const dates = [];
  for (const c of changes) for (const e of timeline(c)) if (e.state === 'in-production') dates.push(e.at);
  dates.sort((a, b) => a - b);
  const span_days = dates.length ? Math.max(1, (now - dates[0]) / DAY) : null;
  return {
    production_transitions: dates.length,
    first: dates.length ? new Date(dates[0]).toISOString() : null,
    last: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
    per_week: span_days ? round((dates.length / span_days) * 7, 2) : null,
    release_records: releases.length,
    dated_release_records: releases.filter((r) => parsed(r.at) !== null).length,
  };
}

/**
 * Change-failure rate and MTTR from the operations log. CFR's denominator is the number of
 * changes that reached production — named in the output, because a rate whose denominator is
 * invisible is a number people argue about instead of act on. Unattributed signals are counted
 * and reported: they are the reason a CFR from this data is a FLOOR, never a ceiling.
 */
export function operationsFlow(signals = [], changes = []) {
  const produced = new Set();
  for (const c of changes) if (timeline(c).some((e) => e.state === 'in-production')) produced.add(c.change_id);
  const failures = signals.filter((s) => FAILURE_TYPES.has(s?.type));
  const attributed = new Set();
  let unattributed = 0;
  for (const s of failures) {
    if (typeof s.caused_by_change === 'string' && s.caused_by_change.trim()) attributed.add(s.caused_by_change);
    else unattributed += 1;
  }
  const durations = [];
  for (const s of signals) {
    const d = parsed(s?.detected);
    const r = parsed(s?.resolved_at);
    if (d !== null && r !== null && r >= d) durations.push((r - d) / HOUR);
  }
  return {
    changes_in_production: produced.size,
    failure_signals: failures.length,
    unattributed_failure_signals: unattributed,
    changes_implicated: attributed.size,
    change_failure_rate: produced.size ? round(attributed.size / produced.size, 3) : null,
    resolved_signals: durations.length,
    open_signals: signals.length - durations.length,
    mttr_hours: durations.length ? round(durations.reduce((a, b) => a + b, 0) / durations.length, 2) : null,
  };
}

/** Gate wall-clock per lane, from the runner's own per-mechanism `ms`. */
export function gateWallClock(runs = []) {
  const by = {};
  for (const r of runs) {
    const lane = typeof r?.lane === 'string' ? r.lane : '(no lane)';
    const b = (by[lane] ||= { runs: 0, mechanisms: 0, total_ms: 0, skipped: 0, slowest: [] });
    b.runs += 1;
    b.skipped += Array.isArray(r?.skipped) ? r.skipped.length : 0;
    for (const e of Array.isArray(r?.executed) ? r.executed : []) {
      const ms = Number.isFinite(e?.ms) ? e.ms : 0;
      b.mechanisms += 1;
      b.total_ms += ms;
      b.slowest.push({ mechanism: e?.mechanism || '(unnamed)', ms });
    }
  }
  for (const b of Object.values(by)) {
    b.slowest.sort((a, c) => c.ms - a.ms);
    b.slowest = b.slowest.slice(0, 5);
  }
  return by;
}

/**
 * Findings if the INPUTS are malformed. Empty ⇒ well-formed (an empty tree is valid — a repo
 * that has governed nothing yet has nothing to measure, which is not an error).
 */
export function validate({ changes = [], signals = [], runs = [] } = {}) {
  const findings = [];
  for (const c of changes) {
    const id = c?.change_id || '(no id)';
    if (c?.state_history === undefined) continue;
    if (!Array.isArray(c.state_history)) { findings.push(`${id}: state_history is not an array — flow figures cannot be computed from it`); continue; }
    c.state_history.forEach((e, i) => {
      if (!e || typeof e !== 'object') { findings.push(`${id}: state_history[${i}] is not an object`); return; }
      if (typeof e.state !== 'string' || !e.state.trim()) findings.push(`${id}: state_history[${i}] has no state`);
      if (parsed(e.at) === null) findings.push(`${id}: state_history[${i}].at ${JSON.stringify(e.at)} is not a timestamp`);
    });
  }
  signals.forEach((s, i) => {
    if (!s || typeof s !== 'object') { findings.push(`operations signal [${i}] is not an object`); return; }
    if (s.resolved_at !== undefined && parsed(s.resolved_at) === null) findings.push(`${s.id || `signal [${i}]`}: resolved_at ${JSON.stringify(s.resolved_at)} is not a timestamp`);
    if (s.caused_by_change !== undefined && !(typeof s.caused_by_change === 'string' && s.caused_by_change.trim())) {
      findings.push(`${s.id || `signal [${i}]`}: caused_by_change is not a change id`);
    }
  });
  runs.forEach((r, i) => {
    const label = r?.lane ? `gate-run [${r.lane}]` : `gate-run [${i}]`;
    if (r?.executed !== undefined && !Array.isArray(r.executed)) { findings.push(`${label}: executed is not an array`); return; }
    for (const e of r?.executed || []) {
      if (!Number.isFinite(e?.ms)) findings.push(`${label}: ${e?.mechanism || 'a mechanism'} has no numeric ms — wall-clock is not derivable`);
    }
  });
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const firstJson = (cwd, locs) => { const p = locs.map((l) => `${cwd}/${l}`).find(existsSync); return p ? readJson(p) : null; };

/** Gather every input from an adopted (or bundle) tree. Missing inputs are simply absent. */
export function collect(cwd = process.cwd()) {
  const changes = [];
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const env = readJson(`${dir}/${name}/change-envelope.json`);
      if (env) changes.push(env);
    }
  }
  const signalDoc = firstJson(cwd, SIGNAL_LOCATIONS);
  const signals = Array.isArray(signalDoc?.signals) ? signalDoc.signals : [];
  const releases = [];
  const manifest = firstJson(cwd, MANIFEST_LOCATIONS);
  if (manifest) releases.push({ kind: 'evidence-manifest', ref: manifest.release || manifest.release_commit || null, at: null });
  const subject = firstJson(cwd, SUBJECT_LOCATIONS);
  if (subject) releases.push({ kind: 'release-subject', ref: subject.source?.commit || null, at: subject.build?.built_at || null });
  const runs = [];
  for (const name of readdirSync(cwd).filter((n) => /^gate-run.*\.json$/.test(n))) {
    const r = readJson(`${cwd}/${name}`);
    if (r) runs.push(r);
  }
  return { changes, signals, releases, runs };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = collect();
  if (process.argv.includes('--check')) {
    const findings = validate(input);
    if (findings.length) {
      process.stderr.write('\nFlow telemetry — malformed input (shape only; no duration, rate or count is judged)\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    process.stdout.write(`Flow telemetry — inputs well-formed (${input.changes.length} change(s), ${input.signals.length} signal(s), ${input.runs.length} gate run(s)). OK\n`);
    process.exit(0);
  }
  const lead = leadTimes(input.changes);
  const stages = stageResidency(input.changes);
  const dep = deployments(input.changes, input.releases);
  const ops = operationsFlow(input.signals, input.changes);
  const clock = gateWallClock(input.runs);
  const out = process.stdout;

  out.write('\nFlow telemetry — the value stream, from the artifacts the harness already writes\n\n');

  out.write('  LEAD TIME (classified → in-production)\n');
  if (!lead.n) out.write('    no completed changes yet — nothing has reached in-production with a recorded history\n');
  else {
    out.write(`    ${lead.n} completed · mean ${lead.mean_days}d · median ${lead.median_days}d\n`);
    for (const c of lead.completed) out.write(`      ${c.change_id.padEnd(18)} ${String(c.days).padStart(6)}d\n`);
  }
  for (const c of lead.in_flight) out.write(`    in flight: ${c.change_id} — ${c.age_days}d since classification, now ${c.state}\n`);

  out.write('\n  STAGE RESIDENCY (where the time actually goes)\n');
  const rows = Object.entries(stages).sort((a, b) => b[1].total_days - a[1].total_days);
  if (!rows.length) out.write('    no state_history recorded on any change — add it and this fills in with zero new ceremony\n');
  for (const [state, b] of rows) {
    out.write(`    ${state.padEnd(22)} n=${String(b.n).padStart(3)}  mean ${String(b.mean_days).padStart(7)}d  max ${String(b.max_days).padStart(7)}d${b.open ? `  (${b.open} still open)` : ''}\n`);
  }

  out.write('\n  DEPLOYMENT FREQUENCY\n');
  out.write(`    ${dep.production_transitions} production transition(s)${dep.per_week !== null ? ` · ${dep.per_week}/week since ${dep.first?.slice(0, 10)}` : ''}\n`);
  out.write(`    ${dep.release_records} sealed release record(s) (${dep.dated_release_records} dated)\n`);

  out.write('\n  CHANGE-FAILURE RATE + MTTR (a FLOOR — unattributed signals are counted, not assumed away)\n');
  out.write(`    ${ops.failure_signals} failure signal(s), ${ops.unattributed_failure_signals} unattributed\n`);
  out.write(ops.change_failure_rate === null
    ? '    change-failure rate: not computable — no change has reached in-production\n'
    : `    change-failure rate: ${ops.changes_implicated}/${ops.changes_in_production} = ${ops.change_failure_rate}\n`);
  out.write(ops.mttr_hours === null
    ? `    MTTR: not computable — no signal carries both detected and resolved_at (${ops.open_signals} open)\n`
    : `    MTTR: ${ops.mttr_hours}h over ${ops.resolved_signals} resolved signal(s) (${ops.open_signals} open)\n`);

  out.write('\n  GATE WALL-CLOCK PER LANE (from gate-run-*.json)\n');
  const lanes = Object.entries(clock);
  if (!lanes.length) out.write('    no gate-run records here — run the gate runner with --out to record them\n');
  for (const [lane, b] of lanes) {
    out.write(`    ${lane.padEnd(12)} ${b.runs} run(s) · ${b.mechanisms} mechanism(s) · ${round(b.total_ms / 1000, 1)}s · ${b.skipped} skipped\n`);
    for (const s of b.slowest) out.write(`        ${String(s.ms).padStart(7)}ms  ${s.mechanism}\n`);
  }

  out.write('\n  (telemetry, not a gate — no duration, rate or count blocks a merge)\n');
}
