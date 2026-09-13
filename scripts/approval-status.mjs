// The approval queue / WIP report (flow-plan Phase 3.4). PA2 can require up to twelve role
// approvals, and until rc.37 nothing in the harness could answer the first question anyone in a
// bank asks about a stalled change: WHO IS IT WAITING ON, AND FOR HOW LONG? The set was already
// computed — `scripts/product-approval-check.mjs` derives the missing roles per stage on every
// run — and was thrown straight into finding strings. This report reads that same set (it imports
// `checkApprovals`; it does not re-derive "required role" against a second, drifting definition)
// and ages it against the change's own state_history.
//
// It is TELEMETRY, NOT A GATE — same posture as scripts/token-report.mjs and scripts/flow-report.mjs.
// docs/governance/approval-sla.json states a target; a breach is FLAGGED here and blocks nothing.
// That is deliberate and it is not a soft option: an approval SLA that gated a merge would gate a
// control on the clock, and the way to make that build green is to approve without reading. The
// pressure this report creates is visibility, which is the only kind that does not corrupt the
// thing it measures. `--check` validates only that the SLA file is well-FORMED.
//
// Run from the repo root: `node scripts/approval-status.mjs` (print), `--json` (machine-readable),
// or `--check` (validate the SLA shape).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from './identity-registry-check.mjs';
import { checkApprovals, pa1Roles } from './product-approval-check.mjs';
import { TERMINAL_STATES } from '../core/compiled-requirements.mjs';

export const CHANGES_DIR = 'docs/governance/changes';
export const SLA_LOCATIONS = ['docs/governance/approval-sla.json', 'approval-sla.json'];
export const DEFAULT_TARGET_DAYS = 10;

const DAY = 86_400_000;
const round = (n) => Math.round(n * 10) / 10;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** The SLA target for a role at a stage: role override → stage target → default. */
export function targetDays(sla, stage, role) {
  const r = sla?.roles?.[role]?.target_days;
  if (Number.isFinite(r)) return r;
  const s = sla?.stages?.[stage]?.target_days;
  if (Number.isFinite(s)) return s;
  return Number.isFinite(sla?.default_target_days) ? sla.default_target_days : DEFAULT_TARGET_DAYS;
}

/**
 * When the current wait started: the change entered the state it is sitting in. That is the
 * honest clock — the queue began when the change arrived, not when it was first conceived — and
 * it comes free with rc.37's state_history. With no history, fall back to the classification
 * date and SAY the age is approximate rather than silently reporting a different measurement.
 */
export function waitingSince(envelope) {
  const h = Array.isArray(envelope?.state_history) ? envelope.state_history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const t = Date.parse(h[i]?.at);
    if (!Number.isNaN(t)) return { at: t, basis: 'state_history' };
  }
  const c = Date.parse(envelope?.classification?.classified_at);
  if (!Number.isNaN(c)) return { at: c, basis: 'classified_at (approximate — no state_history)' };
  return { at: null, basis: 'undatable — no state_history and no classified_at' };
}

/**
 * The outstanding approvals for one change. Pure. Returns one row per (stage, role) still owed,
 * with its age and whether it is past the SLA target. A change whose stage decision is not yet
 * `approved` still owes every role that stage compiled — the decision is the OUTCOME of the
 * approvals, so a pending decision is a full queue, not an empty one.
 */
export function outstanding(envelope, plan, passport, { sla = null, registry = null, now = Date.now() } = {}) {
  const rows = [];
  if (!plan || TERMINAL_STATES.has(envelope?.current_state)) return rows;
  // rc.38 (flow-plan Phase 4.3): a STANDARD change riding a pre-approved pattern is not waiting on
  // anybody — its approvals were given once, on the pattern. Reporting its compiled roles as
  // outstanding would make the queue permanently and wrongly long, and the queue's only job is to
  // be believed. Whether the claim actually HOLDS is scripts/change-envelope-check.mjs's ruling; a
  // report does not re-adjudicate a gate, and a change whose claim fails cannot merge anyway.
  if (envelope?.change_class === 'standard' && envelope?.pattern_claim?.pattern_id) return rows;
  const gates = new Set(plan.required_gates || []);
  const since = waitingSince(envelope);
  const stages = [
    { stage: 'PA1', roles: pa1Roles(plan), record: passport?.pa1 },
    { stage: 'PA2', roles: plan.required_approver_roles || [], record: passport?.pa2 },
  ];
  for (const { stage, roles, record } of stages) {
    if (!gates.has(stage)) continue;
    if (record?.decision === 'rejected') continue; // a rejected stage is not a queue, it is an answer
    // An APPROVED stage can still owe a role — the product-approval gate fails exactly that case —
    // so the derivation is read, never short-circuited on the decision field.
    const { missing } = checkApprovals(record?.approvals, roles, registry, 'queue', stage, {});
    for (const role of missing) {
      const target = targetDays(sla, stage, role);
      const age_days = since.at === null ? null : round((now - since.at) / DAY);
      rows.push({
        change_id: envelope?.change_id || '(no id)',
        state: envelope?.current_state,
        stage,
        role,
        decision: record?.decision || 'pending',
        age_days,
        age_basis: since.basis,
        target_days: target,
        breached: age_days !== null && age_days > target,
      });
    }
  }
  return rows;
}

/** Per-role aggregation — the WIP view. `wip_limit_per_role` breaches are flagged, never gated. */
export function byRole(rows, sla = null) {
  const limit = Number.isFinite(sla?.wip_limit_per_role) ? sla.wip_limit_per_role : null;
  const out = {};
  for (const r of rows) {
    const b = (out[r.role] ||= { waiting: 0, breached: 0, oldest_days: 0, changes: [] });
    b.waiting += 1;
    if (r.breached) b.breached += 1;
    if (r.age_days !== null) b.oldest_days = Math.max(b.oldest_days, r.age_days);
    b.changes.push(`${r.change_id}/${r.stage}`);
  }
  for (const b of Object.values(out)) b.over_wip_limit = limit !== null && b.waiting > limit;
  return out;
}

/** Findings if the SLA file is malformed. Empty ⇒ well-formed (an absent SLA is valid). */
export function validate(sla) {
  if (sla === null || sla === undefined) return [];
  const findings = [];
  const positive = (v, label) => {
    if (v === undefined) return;
    if (!(Number.isFinite(v) && v > 0)) findings.push(`${label} must be a positive number of days (got ${JSON.stringify(v)})`);
  };
  positive(sla.default_target_days, 'default_target_days');
  for (const [stage, s] of Object.entries(sla.stages || {})) positive(s?.target_days, `stages.${stage}.target_days`);
  for (const [role, r] of Object.entries(sla.roles || {})) positive(r?.target_days, `roles.${role}.target_days`);
  if (sla.wip_limit_per_role !== undefined && !(Number.isInteger(sla.wip_limit_per_role) && sla.wip_limit_per_role > 0)) {
    findings.push(`wip_limit_per_role must be a positive integer (got ${JSON.stringify(sla.wip_limit_per_role)})`);
  }
  return findings;
}

export function loadSla(cwd = process.cwd()) {
  const p = SLA_LOCATIONS.map((l) => `${cwd}/${l}`).find(existsSync);
  return p ? readJson(p) : null;
}

/** Walk the governed changes and produce every outstanding row. */
export function collect(cwd = process.cwd(), now = Date.now()) {
  const sla = loadSla(cwd);
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return { sla, rows: [], changes: 0 };
  const registry = loadRegistry(cwd);
  const rows = [];
  let changes = 0;
  let patterned = 0;
  for (const name of readdirSync(dir)) {
    const base = `${dir}/${name}`;
    const envelope = readJson(`${base}/change-envelope.json`);
    if (!envelope) continue;
    changes++;
    if (envelope.change_class === 'standard' && envelope.pattern_claim?.pattern_id) patterned++;
    const plan = readJson(`${base}/${envelope.control_plan || 'control-plan.json'}`);
    rows.push(...outstanding(envelope, plan, readJson(`${base}/product-passport.json`), { sla, registry, now }));
  }
  return { sla, rows, changes, patterned };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const findings = validate(loadSla());
    if (findings.length) {
      process.stderr.write('\nApproval queue — malformed approval-sla.json (shape only; no target is judged)\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.exit(1);
    }
    process.stdout.write('Approval queue — approval-sla.json well-formed (or absent). OK\n');
    process.exit(0);
  }
  const { sla, rows, changes, patterned } = collect();
  const roles = byRole(rows, sla);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ changes, patterned, rows, by_role: roles }, null, 2)}\n`);
    process.exit(0);
  }
  const out = process.stdout;
  out.write(`\nApproval queue — ${rows.length} outstanding approval(s) across ${changes} governed change(s)\n\n`);
  if (!sla) out.write('  (no docs/governance/approval-sla.json — targets fall back to the shipped default)\n\n');
  // Said out loud, never subtracted in silence: these changes are not in the queue because their
  // approval was given once, in advance, on a second-line-owned pattern.
  if (patterned) out.write(`  ${patterned} change(s) ride a PRE-APPROVED PATTERN and are queued on nobody (flow-plan Phase 4.3)\n\n`);
  if (!rows.length) out.write('  nothing is waiting on an approver\n');
  for (const r of rows.sort((a, b) => (b.age_days || 0) - (a.age_days || 0))) {
    const age = r.age_days === null ? '  ?' : `${String(r.age_days).padStart(5)}d`;
    out.write(`  ${r.change_id.padEnd(18)} ${r.stage}  ${r.role.padEnd(24)} ${age} / ${r.target_days}d target${r.breached ? '  ⚠ OVER TARGET' : ''}\n`);
    if (r.age_basis !== 'state_history') out.write(`      age basis: ${r.age_basis}\n`);
  }
  const concentrated = Object.entries(roles).filter(([, b]) => b.over_wip_limit);
  if (concentrated.length) {
    out.write('\n  QUEUE CONCENTRATION (a capacity problem in a governance costume)\n');
    for (const [role, b] of concentrated) out.write(`    ${role}: ${b.waiting} waiting (limit ${sla.wip_limit_per_role}), oldest ${b.oldest_days}d\n`);
  }
  out.write('\n  (telemetry, not a gate — an approval SLA never blocks a merge; approving without reading is not speed)\n');
}
