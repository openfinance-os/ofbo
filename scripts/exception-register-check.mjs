// The exception register (flow-plan Phase 3.6). Exceptions to controls were already governed —
// an envelope exemption needs an owner, a rationale, a compensating control, an expiry and a
// second-line approval, and an expired one blocks; an assurance risk-acceptance needs the same
// and expires the same way. What did not exist was the VIEW. Each exception was visible only
// inside the artifact that carried it, so nobody could answer the two questions a second line
// actually asks:
//
//   what is about to expire?      — and it expired overnight, turning a green build blocked with
//                                   no warning, which is how a renewal gets rushed instead of
//                                   considered.
//   where are they piling up?     — four exceptions against one control is not four exceptions.
//                                   It is one control the organisation has stopped operating,
//                                   recorded four times.
//
// This gate projects every open exception in the repository into one register and reports both.
//
//   WARNING BANDS (30 / 14 / 7 days) are NOTICES. They never fail a build. The hard block stays
//   exactly where it was — at expiry — because moving it earlier would be a new control wearing
//   a warning's clothes. What the bands remove is the surprise, not the deadline.
//
//   CONCENTRATION FAILS. More than `concentration_limit` open exceptions against ONE control is
//   a systemic gap, and the register is the only place it is visible. The limit ships at 3 and
//   docs/governance/exception-policy.json may LOWER it, never raise it: a knob that could loosen
//   a shipped control is the one thing this method does not build (a file asking for 10 is itself
//   a finding, not a silent 10).
//
//   EXPIRED FAILS — restated here on purpose. The envelope gate blocks an expired exemption on
//   its own change and the assurance gate blocks an expired risk-acceptance on its own cycle; the
//   register is the repo-wide view, so a tree where every individual artifact is somehow absent
//   from a lane still fails here.
//
// Lane: scheduled. Nothing here reads a clock the adopter controls — an expiry is data the second
// line signed. Run from the repo root: `node scripts/exception-register-check.mjs` or `--json`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { TERMINAL_STATES } from '../core/compiled-requirements.mjs';

export const CHANGES_DIR = 'docs/governance/changes';
export const CYCLES_DIR = 'docs/governance/assurance-cycles';
export const POLICY_LOCATIONS = ['docs/governance/exception-policy.json', 'exception-policy.json'];
// The shipped floor. A policy file may lower it; raising it is refused, not obeyed.
export const CONCENTRATION_LIMIT = 3;
export const WARNING_BANDS = [30, 14, 7];

const DAY = 86_400_000;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * Every open exception in the tree, from both sources, in one shape.
 * Terminal changes contribute nothing: a closed change ships nothing, so its exemptions are moot
 * (the same rule the envelope gate applies when it stops re-litigating a closed change).
 */
export function project({ changes = [], cycles = [] } = {}, now = Date.now()) {
  const entries = [];
  const add = (e) => {
    const t = Date.parse(e.expires);
    entries.push({
      ...e,
      days_to_expiry: Number.isNaN(t) ? null : Math.floor((t - now) / DAY),
      state: Number.isNaN(t) ? 'undated' : (t < now ? 'expired' : 'open'),
    });
  };
  for (const c of changes) {
    if (TERMINAL_STATES.has(c?.current_state)) continue;
    for (const ex of Array.isArray(c?.exemptions) ? c.exemptions : []) {
      add({
        source: 'envelope-exemption',
        ref: c.change_id || '(no id)',
        control: ex?.control || '(unnamed control)',
        owner: ex?.owner || null,
        approved_by: ex?.approved_by || null,
        rationale: ex?.rationale || null,
        compensating_control: ex?.compensating_control || null,
        expires: ex?.expires ?? null,
      });
    }
  }
  for (const cy of cycles) {
    for (const [step, s] of Object.entries(cy?.steps || {})) {
      const ra = s?.risk_acceptance;
      if (!ra) continue;
      add({
        source: 'assurance-risk-acceptance',
        ref: `${cy.cycle_id || '(no cycle_id)'}/${step}`,
        control: `assurance-step:${step}`,
        owner: ra.accepted_by || null,
        approved_by: ra.accepted_by || null,
        rationale: ra.rationale || null,
        compensating_control: ra.compensating_control || null,
        expires: ra.expires ?? null,
      });
    }
  }
  return entries;
}

/** Open exceptions grouped by control and by owner — the aggregation the pile-up hides in. */
export function aggregate(entries = []) {
  const by_control = {};
  const by_owner = {};
  for (const e of entries) {
    if (e.state === 'expired') continue; // expired is a failure, not a pile
    (by_control[e.control] ||= []).push(e.ref);
    (by_owner[e.owner || '(unowned)'] ||= []).push(`${e.ref} · ${e.control}`);
  }
  return { by_control, by_owner };
}

/**
 * The effective concentration limit. A policy may TIGHTEN it; a policy trying to loosen it past
 * the shipped floor is reported and the floor is used — the monotonicity rule the whole harness
 * runs on, applied to the one knob this gate exposes.
 */
export function effectiveLimit(policy) {
  const findings = [];
  const v = policy?.concentration_limit;
  if (v === undefined || v === null) return { limit: CONCENTRATION_LIMIT, findings };
  if (!(Number.isInteger(v) && v > 0)) {
    findings.push(`exception-policy.json concentration_limit must be a positive integer (got ${JSON.stringify(v)}) — falling back to the shipped floor of ${CONCENTRATION_LIMIT}`);
    return { limit: CONCENTRATION_LIMIT, findings };
  }
  if (v > CONCENTRATION_LIMIT) {
    findings.push(`exception-policy.json sets concentration_limit ${v}, above the shipped floor of ${CONCENTRATION_LIMIT} — this knob may TIGHTEN and never loosen; the floor is being applied`);
    return { limit: CONCENTRATION_LIMIT, findings };
  }
  return { limit: v, findings };
}

/**
 * Findings (fail the build) and notices (never do). Split on purpose: everything about a date in
 * the FUTURE is a notice, and everything about a date in the past, or about a pile, is a finding.
 */
export function evaluate(entries = [], { policy = null } = {}) {
  const { limit, findings } = effectiveLimit(policy);
  const notices = [];
  for (const e of entries) {
    const label = `${e.ref} · ${e.control}`;
    if (e.state === 'undated') {
      findings.push(`${label}: no parseable expiry (${JSON.stringify(e.expires)}) — an exception without an end date is a policy change nobody approved`);
      continue;
    }
    if (e.state === 'expired') {
      findings.push(`${label}: EXPIRED ${e.expires} (${-e.days_to_expiry}d ago) — an expired exception is not an exception, it is an uncontrolled gap`);
      continue;
    }
    // The TIGHTEST band that still contains it — 13 days out is a 14-day warning, not a 30-day one.
    const band = [...WARNING_BANDS].sort((a, b) => a - b).find((b) => e.days_to_expiry <= b);
    if (band !== undefined) {
      notices.push(`${label}: expires ${e.expires} — ${e.days_to_expiry}d left (${band}-day band). Renewal is a NEW exception with a fresh second-line signature, not an edited date. Owner: ${e.owner || '(unowned)'}`);
    }
  }
  const { by_control } = aggregate(entries);
  for (const [control, refs] of Object.entries(by_control)) {
    if (refs.length > limit) {
      findings.push(`CONCENTRATION: ${refs.length} open exceptions against ${control} (limit ${limit}) — ${refs.join(', ')}. That is not ${refs.length} exceptions, it is one control the organisation has stopped operating, recorded ${refs.length} times`);
    }
  }
  return { findings, notices, limit };
}

/** Read both sources plus the optional policy from an adopted (or bundle) tree. */
export function collect(cwd = process.cwd()) {
  const changes = [];
  const cdir = `${cwd}/${CHANGES_DIR}`;
  if (existsSync(cdir)) {
    for (const name of readdirSync(cdir)) {
      const env = readJson(`${cdir}/${name}/change-envelope.json`);
      if (env) changes.push(env);
    }
  }
  const cycles = [];
  const ydir = `${cwd}/${CYCLES_DIR}`;
  if (existsSync(ydir)) {
    for (const name of readdirSync(ydir).filter((n) => n.endsWith('.json'))) {
      const cy = readJson(`${ydir}/${name}`);
      if (cy) cycles.push(cy);
    }
  }
  const ppath = POLICY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  return { changes, cycles, policy: ppath ? readJson(ppath) : null };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { changes, cycles, policy } = collect();
  const entries = project({ changes, cycles });
  const { findings, notices, limit } = evaluate(entries, { policy });
  const agg = aggregate(entries);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ entries, aggregate: agg, limit, findings, notices }, null, 2)}\n`);
    process.exit(findings.length ? 1 : 0);
  }
  const open = entries.filter((e) => e.state === 'open');
  process.stdout.write(`\nException register — ${entries.length} exception(s) projected (${open.length} open), concentration limit ${limit}\n\n`);
  for (const e of entries) {
    process.stdout.write(`  ${e.state.toUpperCase().padEnd(8)} ${e.ref.padEnd(22)} ${String(e.control).padEnd(26)} ${e.expires ?? '(no expiry)'}  owner ${e.owner || '(unowned)'}\n`);
  }
  if (Object.keys(agg.by_owner).length) {
    process.stdout.write('\n  by owner:\n');
    for (const [owner, refs] of Object.entries(agg.by_owner).sort()) process.stdout.write(`    ${owner.padEnd(16)} ${refs.length}\n`);
  }
  for (const n of notices) process.stdout.write(`\nWARNING: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nException register — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nAn exception is a control you are not operating, with an end date and a name against it.\nExpired means uncontrolled; concentrated means systemic. See ../loom/references/governance.md.\n');
    process.exit(1);
  }
  process.stdout.write(`\nException register — OK (${notices.length} expiry warning(s); warnings never fail a build)\n`);
}
