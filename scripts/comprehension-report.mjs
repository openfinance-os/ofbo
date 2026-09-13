// Comprehension telemetry (flow-plan Phase 3.5). The method names comprehension debt as its own
// standing risk — code that merged which no human on the owning team can explain or safely modify
// without the original agent session — and `scripts/comprehension-check.mjs` has collected the
// metrics for it since rc.15. Nothing read them. A metric that is written and never read is not a
// control and not even an observation; it is paperwork. This report trends `review_minutes` and
// `pct_agent_generated` per reviewer and over time, which is the shape the risk actually has:
// the number that matters is not this change's 78%, it is whether 78% is where the team has been
// heading for six months while review time fell.
//
// It is TELEMETRY, NOT A GATE — the posture of scripts/token-report.mjs, and here the reasoning is
// in the gate itself: comprehension-check already says the metrics are "REPORTED, never gated on
// their values (the objective is understanding, not throttling AI output)". Gating on
// pct_agent_generated would make the metric a target and the record a fiction. `--check` validates
// only that the metrics are well-FORMED.
//
// SATURATION (rc.41 · G5). The trend above answers "is understanding decaying?". It cannot answer
// the question that decides whether it will: IS THERE ANYBODY LEFT TO DO THE READING? The review
// gate is the one resource in an AI-SDLC loop that does not scale, and its exhaustion has a
// signature — open changes piling on one approver role, or one named reviewer, while the loop keeps
// shipping. A body that sits on a committee cadence against a flow that ships continuously is the
// canonical case, and until it is counted it is an anecdote somebody has to win an argument with.
// So it is counted, per approver role and per reviewer, and printed.
//
// It REPORTS AND DOES NOT GATE, and here that is not timidity. A saturation number that blocked a
// merge would be relieved by routing the change to a less-loaded approver — the queue would clear
// and the reading would not happen. Visibility is the only pressure that does not corrupt this
// particular measurement.
//
// Run from the repo root: `node scripts/comprehension-report.mjs` (print) or `--check` (shape).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { collect as collectOutstanding, byRole } from './approval-status.mjs';
import { TERMINAL_STATES } from '../core/compiled-requirements.mjs';

export const CHANGES_DIR = 'docs/governance/changes';
export const TRENDED = ['review_minutes', 'pct_agent_generated'];

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const num = (v) => (Number.isFinite(v) ? v : null);

function stats(values) {
  const v = values.filter((x) => x !== null);
  if (!v.length) return null;
  return {
    n: v.length,
    mean: round(v.reduce((a, b) => a + b, 0) / v.length),
    min: Math.min(...v),
    max: Math.max(...v),
  };
}

/** Per-reviewer rollup, keyed on the record's named_owner — the human accountable for explaining it. */
export function byReviewer(records = []) {
  const out = {};
  for (const r of records) {
    const owner = (typeof r?.named_owner === 'string' && r.named_owner.trim()) || '(no named_owner)';
    const b = (out[owner] ||= { records: 0, review_minutes: [], pct_agent_generated: [], post_merge_defects: 0, emergency_reversals: 0, cannot_modify_without_agent: [] });
    b.records += 1;
    b.review_minutes.push(num(r?.metrics?.review_minutes));
    b.pct_agent_generated.push(num(r?.metrics?.pct_agent_generated));
    b.post_merge_defects += num(r?.metrics?.post_merge_defects) || 0;
    b.emergency_reversals += num(r?.metrics?.emergency_reversals) || 0;
    if (r?.metrics?.team_can_modify_without_agent === false) b.cannot_modify_without_agent.push(r.change_id || '(no id)');
  }
  for (const b of Object.values(out)) {
    b.review_minutes = stats(b.review_minutes);
    b.pct_agent_generated = stats(b.pct_agent_generated);
  }
  return out;
}

/**
 * The chronological series plus a direction. `direction` compares the mean of the earlier half to
 * the mean of the later half and reports the delta — nothing cleverer, because with a handful of
 * governed changes anything cleverer would be a decorated guess. Fewer than four points reports
 * `null`: "not enough history yet" is the honest answer and the one this file will most often give.
 */
export function trend(records = []) {
  const series = records
    .map((r) => ({
      change_id: r?.change_id || '(no id)',
      at: r?.at || null,
      owner: r?.named_owner || null,
      review_minutes: num(r?.metrics?.review_minutes),
      pct_agent_generated: num(r?.metrics?.pct_agent_generated),
    }))
    .sort((a, b) => (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0));
  const direction = {};
  for (const metric of TRENDED) {
    const v = series.map((s) => s[metric]).filter((x) => x !== null);
    if (v.length < 4) { direction[metric] = null; continue; }
    const half = Math.floor(v.length / 2);
    const early = v.slice(0, half);
    const late = v.slice(v.length - half);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    direction[metric] = { earlier_mean: round(mean(early)), later_mean: round(mean(late)), delta: round(mean(late) - mean(early)) };
  }
  return { series, direction };
}

/**
 * The review resource, saturated — two denominators, because the bottleneck has two shapes.
 *
 *   per_role      open changes waiting on each approver role. Built on approval-status's `byRole`
 *                 rather than a second aggregation, so "waiting on" has ONE definition in the
 *                 harness; the addition here is the DISTINCT-CHANGE count, because twelve
 *                 outstanding approvals across two changes and across twelve changes are the same
 *                 row count and very different problems.
 *   per_reviewer  open changes whose comprehension record names this human as the owner — the
 *                 person who has to be able to explain them, later, without the agent session.
 *
 * HONEST DENOMINATOR: per_reviewer counts only changes that HAVE a comprehension record, because a
 * change without one has no reviewer to attribute it to. Those changes are not invisible — they are
 * in per_role, and if they were selected and unrecorded, comprehension-check already failed them.
 * Terminal (closed/superseded) changes are excluded from both: they are not open work.
 *
 * Pure. `rows` are approval-status `outstanding()` rows; `records` are `collect()` records.
 */
export function saturation(rows = [], records = [], { sla = null } = {}) {
  const per_role = {};
  for (const [role, b] of Object.entries(byRole(rows, sla))) {
    per_role[role] = {
      open_changes: new Set(rows.filter((r) => r.role === role).map((r) => r.change_id)).size,
      outstanding_approvals: b.waiting,
      over_target: b.breached,
      oldest_days: b.oldest_days,
      over_wip_limit: b.over_wip_limit,
      queue: b.changes,
    };
  }
  const per_reviewer = {};
  for (const rec of records) {
    if (TERMINAL_STATES.has(rec?.current_state)) continue;
    const owner = (typeof rec?.named_owner === 'string' && rec.named_owner.trim()) || '(no named_owner)';
    const b = (per_reviewer[owner] ||= { open_changes: 0, changes: [] });
    const id = rec?.change_id || '(no id)';
    if (b.changes.includes(id)) continue;
    b.changes.push(id);
    b.open_changes += 1;
  }
  return {
    per_role,
    per_reviewer,
    wip_limit: Number.isFinite(sla?.wip_limit_per_role) ? sla.wip_limit_per_role : null,
    open_changes: new Set(rows.map((r) => r.change_id)).size,
  };
}

/** Findings if the metrics are malformed. Empty ⇒ well-formed (an absent metric block is valid). */
export function validate(records = []) {
  const findings = [];
  for (const r of records) {
    const id = r?.change_id || '(no id)';
    const m = r?.metrics;
    if (m === undefined) continue;
    if (!m || typeof m !== 'object' || Array.isArray(m)) { findings.push(`${id}: metrics is not an object`); continue; }
    for (const k of TRENDED) {
      if (m[k] === undefined) continue;
      if (!(Number.isFinite(m[k]) && m[k] >= 0)) findings.push(`${id}: metrics.${k} must be a finite, non-negative number (got ${JSON.stringify(m[k])})`);
    }
    if (m.pct_agent_generated !== undefined && Number.isFinite(m.pct_agent_generated) && m.pct_agent_generated > 100) {
      findings.push(`${id}: metrics.pct_agent_generated is ${m.pct_agent_generated} — a percentage above 100 is a units error, not a trend`);
    }
    if (r?.named_owner !== undefined && !(typeof r.named_owner === 'string' && r.named_owner.trim())) {
      findings.push(`${id}: named_owner is not an identity id — the series cannot be grouped by reviewer`);
    }
  }
  return findings;
}

/** Every comprehension record in the tree, stamped with the change's classification date. */
export function collect(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const record = readJson(`${dir}/${name}/comprehension.json`);
    if (!record) continue;
    const envelope = readJson(`${dir}/${name}/change-envelope.json`);
    out.push({
      ...record,
      change_id: record.change_id || envelope?.change_id || name,
      risk_tier: envelope?.risk_tier || null,
      // Carried for the saturation view: open work is what a reviewer still owes an explanation for.
      current_state: envelope?.current_state || null,
      // Order the series by when the change was judged — the one date every envelope carries.
      at: envelope?.classification?.classified_at || null,
    });
  }
  return out;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records = collect();
  if (process.argv.includes('--check')) {
    const findings = validate(records);
    if (findings.length) {
      process.stderr.write('\nComprehension telemetry — malformed metrics (shape only; no value is judged)\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    process.stdout.write(`Comprehension telemetry — ${records.length} record(s), metrics well-formed. OK\n`);
    process.exit(0);
  }
  const out = process.stdout;
  if (!records.length) {
    out.write('\nComprehension telemetry — no comprehension.json records yet (they are required at high/critical tiers). OK\n');
    process.exit(0);
  }
  const per = byReviewer(records);
  const t = trend(records);
  out.write(`\nComprehension telemetry — ${records.length} record(s) across ${Object.keys(per).length} reviewer(s)\n\n`);
  out.write('  PER REVIEWER\n');
  for (const [owner, b] of Object.entries(per).sort()) {
    const rm = b.review_minutes ? `review ${b.review_minutes.mean}min (min ${b.review_minutes.min}, max ${b.review_minutes.max})` : 'review time not recorded';
    const pc = b.pct_agent_generated ? `${b.pct_agent_generated.mean}% agent-generated` : 'agent share not recorded';
    out.write(`    ${owner.padEnd(16)} ${b.records} record(s) · ${rm} · ${pc}\n`);
    if (b.post_merge_defects || b.emergency_reversals) {
      out.write(`        ${b.post_merge_defects} post-merge defect(s), ${b.emergency_reversals} emergency reversal(s)\n`);
    }
    if (b.cannot_modify_without_agent.length) {
      out.write(`        ⚠ team CANNOT modify without the agent: ${b.cannot_modify_without_agent.join(', ')} — this is comprehension debt, named\n`);
    }
  }
  out.write('\n  TREND (oldest first)\n');
  for (const s of t.series) {
    out.write(`    ${(s.at || '(undated)').padEnd(12)} ${s.change_id.padEnd(18)} ${String(s.review_minutes ?? '?').padStart(5)}min  ${String(s.pct_agent_generated ?? '?').padStart(4)}% agent  ${s.owner || ''}\n`);
  }
  for (const metric of TRENDED) {
    const d = t.direction[metric];
    out.write(d
      ? `    ${metric}: ${d.earlier_mean} → ${d.later_mean} (${d.delta > 0 ? '+' : ''}${d.delta})\n`
      : `    ${metric}: not enough history to trend (needs 4 records)\n`);
  }

  // SATURATION — the review resource, counted. Reported; never gated (see the header).
  const { sla, rows } = collectOutstanding();
  const sat = saturation(rows, records, { sla });
  out.write(`\n  SATURATION — ${sat.open_changes} change(s) waiting on an approver${sat.wip_limit === null ? '' : ` (WIP limit ${sat.wip_limit}/role)`}\n`);
  const roles = Object.entries(sat.per_role).sort((a, b) => b[1].open_changes - a[1].open_changes);
  if (!roles.length) out.write('    no approver role is carrying open work\n');
  for (const [role, b] of roles) {
    out.write(`    ${role.padEnd(24)} ${String(b.open_changes).padStart(3)} open change(s), ${b.outstanding_approvals} approval(s), oldest ${b.oldest_days}d${b.over_target ? `, ${b.over_target} over target` : ''}${b.over_wip_limit ? '  ⚠ OVER WIP LIMIT' : ''}\n`);
  }
  const reviewers = Object.entries(sat.per_reviewer).sort((a, b) => b[1].open_changes - a[1].open_changes);
  if (reviewers.length) {
    out.write('    per reviewer (open changes carrying a comprehension record they own)\n');
    for (const [owner, b] of reviewers) out.write(`      ${owner.padEnd(22)} ${String(b.open_changes).padStart(3)} open change(s)\n`);
  }

  out.write('\n  (telemetry, not a gate — the objective is understanding, not throttling AI output)\n');
}
