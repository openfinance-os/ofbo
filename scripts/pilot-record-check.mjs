// The pilot-conduct gate (PILOT-CONDUCT). Read the boundary first, because this control sits
// next to one that is deliberately NOT closed:
//
//   SUPERVISED-PILOT — "a supervised production pilot on real, bounded, reversible scope" — is
//   an EVENT, and it stays `absent` in the catalog. No file makes a pilot have happened. This
//   gate does not move it and must never be read as moving it.
//
//   PILOT-CONDUCT — this control — governs the RECORD of a pilot: that a declared one stays
//   inside the bounds it published, is observed at the cadence it set, can be reversed by a
//   route somebody drilled, and cannot declare an exit while the playbook's adversarial rows
//   remain unexercised.
//
// THE HARNESS RUNS NOTHING AND OBSERVES NOTHING. Every date, exercise, observation and finding
// is written by a human and read here as a declaration. A pilot that went badly and was recorded
// tidily passes every rule below. A green run says a record is coherent, never that a pilot was
// safe, and never that the harness is fit for your institution.
//
// THE RULE THAT EARNS THE CONTROL is PL-R08, and it is a JOIN rather than a field check: the
// gate parses governance/runbooks/pilot-playbook.md — the playbook ITSELF, not a copy of it —
// and requires an exercise entry for every AX row whose status carries **live**. Adding a row to
// the playbook therefore creates an outstanding obligation on the running pilot the moment it is
// written. That is `discovery-sync.json`'s discipline applied to the pilot: a debt nobody wrote
// down is a debt nobody pays. The playbook's own exit criterion ("every live row exercised at
// least once") was, until now, tracked in no file at all.
//
// The rules:
//
//   PL-R01  a `status` outside not-started | active | concluded — an unreadable declaration
//   PL-R02  no `pilot_id`, or a `stage` that is not 1-6
//   PL-R03  STAGE MONOTONICITY: sitting at stage N with no recorded exit for some stage below.
//           A pilot that jumped from synthetic rehearsal to a production cohort is what staging
//           exists to prevent, and the jump is invisible unless the exits are enumerated
//   PL-R04  a stage exit with no date, no evidence, or an `approved_by` who does not resolve to
//           a human outside `builders` — the team running the pilot does not decide it may widen
//   PL-R05  scope bounds absent or non-numeric; a cap of ZERO at a stage where the exposure it
//           caps exists; or `financial_execution: true` before stage 4 — the playbook's own
//           staging puts real users with NO financial execution at stage 3. Zero is a legitimate
//           cap BELOW those stages, and demanding a positive one there was a defect that made
//           the honest answer unwritable (found by filling this record for a real rehearsal)
//   PL-R06  no reversibility `route`; or, at stage 4+, no `drilled_on`. Capped production
//           exposure with an unexercised rollback is precisely the R3 case
//   PL-R07  supervision: a `second_line_observer` or `accountable_executive` who does not
//           resolve, is an agent, or sits in `builders` — a pilot supervised by the team running
//           it is unsupervised. Plus a positive observation cadence
//   PL-R08  THE PLAYBOOK JOIN (see above): at `concluded`, every **live** AX row needs an
//           exercise. While `active` it is a NOTICE that names the outstanding rows — a running
//           pilot is *supposed* to have unexercised rows; that is what it is for
//   PL-R09  an exercise citing an `ax` id the playbook does not contain, with no date, with an
//           outcome outside held | failed | partial, or with no evidence
//   PL-R10  a `failed` or `partial` exercise with no matching finding — the pilot found
//           something and the record dropped it
//   PL-R11  at `concluded`, a finding that is neither resolved nor risk-accepted; or one
//           risk-accepted by anybody other than the named accountable executive
//   PL-R12  at `concluded`, no independent report, or one whose author is in `builders`
//   PL-R13  at `concluded`, no second-line confirmation that the control set OPERATED
//   PL-R14  (NOTICE ALWAYS) observations stale against the declared cadence, internal-audit
//           re-performance absent, and the standing limit that none of this observes production
//
// ARMED BY CONTENT, NOT PRESENCE — and deliberately not by a compiled capability. A pilot is not
// a property of any one change's control plan, so no plan can compile it; the declaration is
// `status: "active"`. Until then every rule is a notice and the run is `inert`, so mounting the
// template can never fail anybody (the rc.46 property, kept by a different route).
//
// Lane: pr. Run from the repo root: `node scripts/pilot-record-check.mjs` (exit 1 on a finding).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { identityOf, loadRegistry } from './identity-registry-check.mjs';

export const RECORD_LOCATIONS = ['docs/governance/pilot-record.json', 'pilot-record.json'];
export const PLAYBOOK_LOCATIONS = ['docs/governance/runbooks/pilot-playbook.md', 'governance/runbooks/pilot-playbook.md', 'runbooks/pilot-playbook.md'];
export const STATUSES = new Set(['not-started', 'active', 'concluded']);
export const OUTCOMES = new Set(['held', 'failed', 'partial']);
export const DISPOSITIONS = new Set(['open', 'resolved', 'risk-accepted']);
/** The stage at which real money moves. Below it the playbook forbids financial execution. */
export const FINANCIAL_EXECUTION_STAGE = 4;
// The stage at which REAL USERS first appear. Stage 1 is synthetic and stage 2 is controlled
// internal users with no external customers, so a customer cap of 0 is correct below this.
export const CUSTOMER_EXPOSURE_STAGE = 3;
export const MAX_STAGE = 6;

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must never read as a declaration. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** A stated cap. Zero is a real answer before the exposure exists; absent is not. */
const nonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isDate = (v) => stated(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * The adversarial rows of the playbook, parsed from the markdown table.
 *
 * Returns `[{ ax, exercise, live }]`, or null when the table could not be found or read — the
 * caller reports THAT rather than reporting full coverage over an empty list, which would turn a
 * parse failure into a clean bill of health. That is the rc.46 lesson in its most literal form.
 */
export function parsePlaybook(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*(AX-\d+)\s*\|(.*)$/.exec(line.trim());
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    // exercise | control | status — a row that lost a column is not silently half-read.
    if (cells.length < 3) continue;
    const status = cells[2] || '';
    rows.push({ ax: m[1], exercise: cells[0], live: /\*\*live\*\*/i.test(status) });
  }
  return rows.length ? rows : null;
}

/** Resolve an identity that must be a real human outside the build team. Returns findings. */
function resolveSupervisor(registry, id, label) {
  if (!stated(id)) return [`${label}: no identity given`];
  if (!registry) return []; // no registry mounted: taken as stated, never invented
  const who = identityOf(registry, id);
  if (!who) return [`${label}: ${JSON.stringify(id)} is not in the identity registry — an unresolvable name supervises nothing`];
  const out = [];
  if (who.kind === 'agent') out.push(`${label}: ${id} is an AGENT — an agent observes nothing on behalf of a second line and holds no authority to stop anything`);
  if ((who.groups || []).includes('builders')) out.push(`${label}: ${id} is in \`builders\` — a pilot supervised by the team running it is unsupervised`);
  return out;
}

/**
 * Findings (fail) and notices (never do) over a parsed pilot record.
 *
 * `playbook` is the parsed AX row list — the join partner. Null means it could not be read, and
 * the caller says so rather than reporting the join as satisfied.
 *
 * `armed` is whether the record declares itself `active` or `concluded`. It is the ONLY thing
 * deciding finding-vs-notice, for every rule.
 */
export function evaluate(doc, { playbook = null, registry = null } = {}) {
  const findings = [];
  const notices = [];
  const status = stated(doc?.status) ? doc.status.trim() : 'not-started';
  const armed = status === 'active' || status === 'concluded';
  const concluded = status === 'concluded';
  const say = (m) => (armed ? findings : notices).push(m);

  if (stated(doc?.status) && !STATUSES.has(status)) {
    // An unreadable status is reported in the dormant channel: a record nobody can classify has
    // not declared a pilot, and failing closed on a typo would arm a gate nobody opted into.
    notices.push(`PL-R01: status ${JSON.stringify(doc.status)} is not one of ${[...STATUSES].join(' | ')} — the declaration cannot be read, so no pilot is taken to be running`);
    return { findings, notices, status, armed: false, exercised: 0, outstanding: [] };
  }

  if (!stated(doc?.pilot_id)) say('PL-R02: no `pilot_id` — the evidence this pilot produces has nothing to cite');
  const stage = doc?.stage;
  const stageOk = Number.isInteger(stage) && stage >= 1 && stage <= MAX_STAGE;
  if (!stageOk) say(`PL-R02: stage is ${JSON.stringify(stage)}, not an integer 1-${MAX_STAGE} — the staged cohorts are the pilot's whole shape`);

  // PL-R03 / PL-R04 — the stages actually exited.
  const exits = Array.isArray(doc?.stage_exits) ? doc.stage_exits.filter((e) => e && typeof e === 'object' && Number.isInteger(e.stage)) : [];
  const exited = new Set(exits.map((e) => e.stage));
  if (stageOk) {
    const missing = [];
    for (let s = 1; s < stage; s++) if (!exited.has(s)) missing.push(s);
    if (missing.length) {
      say(`PL-R03: the pilot sits at stage ${stage} with no recorded exit for stage${missing.length === 1 ? '' : 's'} ${missing.join(', ')} — a pilot that advanced without exiting the stage below it skipped the criteria that stage existed to test, and the jump is invisible unless the exits are enumerated`);
    }
  }
  for (const e of exits) {
    if (!isDate(e.exited_on)) say(`PL-R04: stage ${e.stage} exit has no \`exited_on\` date (YYYY-MM-DD)`);
    if (!stated(e.exit_evidence)) say(`PL-R04: stage ${e.stage} exit cites no \`exit_evidence\` — an advance nobody can point at is an advance nobody reviewed`);
    for (const f of resolveSupervisor(registry, e.approved_by, `PL-R04: stage ${e.stage} exit \`approved_by\``)) say(f);
  }

  // PL-R05 — what makes it bounded.
  //
  // ZERO IS A LEGITIMATE CAP, AND REQUIRING A POSITIVE ONE WAS A DEFECT (found by filling this
  // record for a real stage-1 rehearsal). A synthetic rehearsal has no customers and moves no
  // money — that is what makes it synthetic — and stage 2 is internal users with no external
  // customers. Demanding a positive number there left an adopter two options: fabricate one, or
  // not declare the pilot. A rule that makes the honest answer impossible manufactures the
  // dishonesty it was meant to prevent, which is the same failure as a retention entry claiming
  // an archive nobody could name.
  //
  // So the cap must be STATED at every stage — an absent or non-numeric one is still a finding,
  // because an unstated ceiling is not a bound — and must be POSITIVE only from the stage at
  // which the exposure it caps actually exists. Below that, a non-zero cap is reported: it
  // usually means the stage number is wrong, which is worth a look and never worth a block.
  const scope = doc?.scope_bound && typeof doc.scope_bound === 'object' ? doc.scope_bound : null;
  for (const [key, from, what] of [
    ['max_customers', CUSTOMER_EXPOSURE_STAGE, 'real users first appear at stage 3 (staff/customer beta); stages 1-2 are synthetic and internal'],
    ['max_transaction_value', FINANCIAL_EXECUTION_STAGE, `money first moves at stage ${FINANCIAL_EXECUTION_STAGE} (capped production cohort); stage 3 is explicitly no financial execution`],
  ]) {
    const v = scope?.[key];
    if (!nonNegative(v)) {
      say(`PL-R05: scope_bound.${key} is ${JSON.stringify(v)} — state a number. Zero is a legitimate and expected answer before stage ${from}; absent is not, because an unstated ceiling is not a bound`);
    } else if (stageOk && stage >= from && v === 0) {
      say(`PL-R05: scope_bound.${key} is 0 at stage ${stage}, where the exposure it caps exists — ${what}. A zero cap here says the pilot is bounded to nothing while it is demonstrably not`);
    } else if (stageOk && stage < from && v > 0) {
      notices.push(`PL-R05: scope_bound.${key} is ${v} at stage ${stage}, before the exposure it caps exists — ${what}. Reported, never enforced: it usually means the stage number is behind what the pilot is actually doing`);
    }
  }
  if (!stated(scope?.scope_note)) say('PL-R05: scope_bound.scope_note is empty — say what the pilot covers and, more usefully, what it explicitly does not');
  if (scope?.financial_execution === true && stageOk && stage < FINANCIAL_EXECUTION_STAGE) {
    say(`PL-R05: the pilot claims financial_execution at stage ${stage} — the playbook's staging puts real users with NO financial execution at stage 3, and money moves at stage ${FINANCIAL_EXECUTION_STAGE}. Either the stage is wrong or the pilot has outrun its own plan`);
  }

  // PL-R06 — reversible means drilled.
  const rev = doc?.reversibility && typeof doc.reversibility === 'object' ? doc.reversibility : null;
  if (!stated(rev?.route)) say('PL-R06: no reversibility.route — name the kill-switch, flag or manual fallback. "Reversible" without a named mechanism is an intention');
  if (stageOk && stage >= FINANCIAL_EXECUTION_STAGE && !isDate(rev?.drilled_on)) {
    say(`PL-R06: the pilot is at stage ${stage} with no reversibility.drilled_on date — capped PRODUCTION exposure with a rollback nobody has exercised is exactly the case the R3 drill exists for. An undrilled route is a plan`);
  }

  // PL-R07 — supervision, the word in the control's name.
  const sup = doc?.supervision && typeof doc.supervision === 'object' ? doc.supervision : null;
  for (const f of resolveSupervisor(registry, sup?.second_line_observer, 'PL-R07: supervision.second_line_observer')) say(f);
  for (const f of resolveSupervisor(registry, sup?.accountable_executive, 'PL-R07: supervision.accountable_executive')) say(f);
  const cadence = sup?.observation_cadence_days;
  if (!positive(cadence)) say(`PL-R07: supervision.observation_cadence_days is ${JSON.stringify(cadence)}, not a positive number — "embedded oversight" with no stated rhythm cannot be found to have lapsed`);
  const observations = Array.isArray(sup?.observations) ? sup.observations.filter((o) => o && typeof o === 'object' && isDate(o.observed_on)) : [];
  if (armed && !observations.length) {
    say('PL-R07: the pilot is declared and NO observation has been recorded — supervision that left no trace is indistinguishable from none');
  }

  // PL-R08 / PL-R09 / PL-R10 — the playbook join and the exercises.
  const exercises = Array.isArray(doc?.exercises) ? doc.exercises.filter((e) => e && typeof e === 'object' && stated(e.ax)) : [];
  const byAx = new Map(exercises.map((e) => [e.ax.trim(), e]));
  let outstanding = [];
  if (playbook) {
    const known = new Set(playbook.map((r) => r.ax));
    const live = playbook.filter((r) => r.live).map((r) => r.ax);
    outstanding = live.filter((ax) => !byAx.has(ax));
    if (outstanding.length) {
      const msg = `PL-R08: ${outstanding.length} of ${live.length} adversarial rows carrying a **live** obligation have no exercise recorded — ${outstanding.join(', ')}. The playbook's own exit criterion is that every one is exercised at least once with its evidence retained`;
      // A RUNNING pilot is supposed to have unexercised rows — that is what it is for. Only a
      // pilot claiming to be finished is failed by them.
      if (concluded) findings.push(msg);
      else notices.push(`${msg} (reported, not enforced: a pilot in flight is expected to carry outstanding rows — this becomes a finding at \`concluded\`)`);
    }
    for (const ax of byAx.keys()) {
      if (!known.has(ax)) say(`PL-R09: an exercise cites ${JSON.stringify(ax)}, which is not a row in the pilot playbook — an exercise of nothing. Cite rows by the ids in runbooks/pilot-playbook.md`);
    }
  }
  const findingIds = new Set((Array.isArray(doc?.findings) ? doc.findings : []).filter((f) => f && stated(f.id)).map((f) => f.id.trim()));
  for (const e of exercises) {
    const ax = e.ax.trim();
    if (!isDate(e.exercised_on)) say(`PL-R09: exercise ${ax} has no \`exercised_on\` date (YYYY-MM-DD)`);
    const outcome = stated(e.outcome) ? e.outcome.trim() : null;
    if (!outcome || !OUTCOMES.has(outcome)) {
      say(`PL-R09: exercise ${ax} has outcome ${JSON.stringify(e.outcome)} — one of ${[...OUTCOMES].join(' | ')}`);
    }
    if (!stated(e.evidence)) say(`PL-R09: exercise ${ax} cites no \`evidence\` — a declared exercise with nothing behind it is a claim, which is the one thing this whole harness refuses`);
    // PL-R10 — a pilot exists to find failures; losing them is the defect.
    if (outcome === 'failed' || outcome === 'partial') {
      const linked = (Array.isArray(doc?.findings) ? doc.findings : []).some((f) => f && (f.ax === ax || (stated(f.id) && stated(e.finding) && f.id.trim() === e.finding.trim())));
      if (!linked && !findingIds.size) {
        say(`PL-R10: exercise ${ax} came back ${JSON.stringify(outcome)} and the record carries NO findings — the pilot found something and the record dropped it. A pilot reporting that every control held on first contact is the least believable record there is`);
      } else if (!linked) {
        say(`PL-R10: exercise ${ax} came back ${JSON.stringify(outcome)} with no matching finding — link it by setting \`ax\` on the finding, or \`finding\` on the exercise`);
      }
    }
  }

  // PL-R11 — findings dispositioned, and risk accepted by the one role that may.
  const findingsList = Array.isArray(doc?.findings) ? doc.findings.filter((f) => f && typeof f === 'object' && stated(f.id)) : [];
  for (const f of findingsList) {
    const d = stated(f.disposition) ? f.disposition.trim() : null;
    if (!d || !DISPOSITIONS.has(d)) {
      say(`PL-R11: finding ${f.id} has disposition ${JSON.stringify(f.disposition)} — one of ${[...DISPOSITIONS].join(' | ')}`);
      continue;
    }
    if (d === 'open' && concluded) {
      findings.push(`PL-R11: finding ${f.id} is still open and the pilot claims to be concluded — every material finding is resolved or formally risk-accepted before the pilot ends`);
    }
    if (d === 'risk-accepted') {
      const accepter = f.risk_accepted_by;
      if (!stated(accepter)) {
        say(`PL-R11: finding ${f.id} is risk-accepted by nobody — acceptance is an act with a name on it`);
      } else if (stated(sup?.accountable_executive) && accepter.trim() !== sup.accountable_executive.trim()) {
        say(`PL-R11: finding ${f.id} is risk-accepted by ${accepter}, who is not the accountable executive (${sup.accountable_executive}) — risk acceptance is that role's act and nobody else's. A finding accepted by anyone else is an unresolved finding with better paperwork`);
      }
    }
  }

  // PL-R12 / PL-R13 — the exit criteria that can be made mechanical.
  if (concluded) {
    const exit = doc?.exit && typeof doc.exit === 'object' ? doc.exit : null;
    if (!stated(exit?.independent_report)) findings.push('PL-R12: the pilot is concluded with no `exit.independent_report` — the criterion is a report that exists, authored outside the build team');
    const authorFindings = resolveSupervisor(registry, exit?.report_author, 'PL-R12: exit.report_author');
    for (const f of authorFindings) findings.push(`${f} — "independent" is the entire content of this criterion`);
    for (const f of resolveSupervisor(registry, exit?.second_line_confirmation, 'PL-R13: exit.second_line_confirmation')) findings.push(f);
    if (!stated(exit?.internal_audit_reperformance)) {
      notices.push("PL-R14: no internal-audit re-performance recorded — REPORTED, never blocking: audit's schedule is not the pilot's to command, and blocking on it would push adopters to fabricate the field. The playbook still lists it as an exit criterion and a human has to judge it");
    }
  }

  // PL-R14 — the notices that are always true while a pilot is declared.
  if (armed) {
    if (positive(cadence) && observations.length) {
      const latest = observations.map((o) => Date.parse(o.observed_on)).filter((t) => !Number.isNaN(t)).sort((a, b) => b - a)[0];
      if (latest !== undefined) {
        const days = Math.floor((Date.now() - latest) / 86400000);
        if (days > cadence) {
          notices.push(`PL-R14: the most recent observation is ${days} days old against a declared cadence of ${cadence} — REPORTED, because the harness cannot know whether the pilot paused, the observer was away, or supervision lapsed. A stale log is the visible part of an unsupervised pilot`);
        }
      }
    }
    notices.push('PL-R14: nothing in this gate observed production. Every date, exercise, observation and finding above was written by a human and is read here as a declaration — a pilot that went badly and was recorded tidily passes every rule. SUPERVISED-PILOT stays ABSENT in the control catalog until a pilot has actually run');
  }

  return { findings, notices, status, armed, exercised: byAx.size, outstanding };
}

export function run(cwd = process.cwd()) {
  const path = RECORD_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  if (!path) {
    // No record at all is the resting state of every repository that is not piloting anything.
    return { present: false, armed: false, status: 'not-started', findings: [], notices: [], inert: true, joined: false, exercised: 0, outstanding: [] };
  }
  const doc = readJson(path);
  if (!doc) {
    // Unparseable: reported, never blocking. A broken file has declared no pilot, and arming on
    // it would fail a repository that never opted in.
    return { present: true, armed: false, status: 'unreadable', findings: [], notices: [`${RECORD_LOCATIONS[0]} is not valid JSON — nothing in it can be read, so no pilot is taken to be declared`], inert: false, joined: false, exercised: 0, outstanding: [] };
  }
  const pbPath = PLAYBOOK_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const playbook = pbPath ? parsePlaybook(readFileSync(pbPath, 'utf8')) : null;
  const { findings, notices, status, armed, exercised, outstanding } = evaluate(doc, { playbook, registry: loadRegistry(cwd) });
  // Say plainly when the join could not run. PL-R08 is the rule that earns this control, and
  // reporting the rest as a clean pass without it would be the overclaim the whole design avoids.
  const joinNotices = playbook ? [] : [
    `the pilot playbook could not be read or its adversarial table could not be parsed (looked in ${PLAYBOOK_LOCATIONS.join(', ')}) — THE LIVE-ROW OBLIGATION (PL-R08) could not be computed at all, so the exercises here are checked for internal soundness only and coverage is UNKNOWN rather than complete`,
  ];
  return { present: true, armed, status, findings, notices: [...joinNotices, ...notices], inert: !armed, joined: Boolean(playbook), exercised, outstanding };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, armed, status, findings, notices, exercised, outstanding, joined } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nPilot-conduct gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA declared pilot stays inside the bounds it published, is observed by somebody who is not\nrunning it, can be reversed by a route somebody drilled, and does not conclude while the\nplaybook\'s live rows are unexercised.\nTHE HARNESS RUNS NOTHING AND OBSERVES NOTHING — it reads the record.\nSee governance/pilot-record.template.json and runbooks/pilot-playbook.md.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Pilot-conduct gate — no ${RECORD_LOCATIONS[0]}; no pilot declared (nothing to check)\n`);
    process.exit(0);
  }
  // Never "the pilot is going well" — the distinction this control was built around, kept in the
  // line that gets read most often.
  const posture = armed
    ? `status ${status}, ${exercised} exercise(s) recorded${outstanding.length ? `, ${outstanding.length} live row(s) outstanding` : ''}`
    : `status ${status}, so every rule above is REPORTED, not enforced`;
  process.stdout.write(`Pilot-conduct gate — OK (${posture}${joined ? '' : '; playbook NOT parsed, live-row coverage unknown'}; record read, no pilot ever observed here${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
