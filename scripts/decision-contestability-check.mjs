// The decision-contestability gate (AI-EXPLAINABILITY). Until 2.0.0 this control was catalogued
// ABSENT, and its note described exactly what shipped: the ai-decision-system profile compiles an
// `explainability-and-contestability` PA2 section, so a plan must SAY how a decision is explained
// and contested, and product-approval-check verifies the section is present and approved. That is
// "a REQUIREMENT TO SAY" — a section a human writes, joined to nothing.
//
// This gate is the join. It is not an explanation engine and nothing below moves it closer to one.
//
// WHAT THIS GATE DOES NOT DO: it does not generate a reason code, does not render a letter, does
// not judge whether a reason is intelligible to the person who received it, does not route a
// contest to anybody, and never observes whether an SLA was met. The explanation surface and the
// contest path are the adopter's runtime; every gate in this harness is a BUILD-time mechanism and
// none of them execute in the serving path.
//
// WHAT IT DOES HOLD — composition, provenance, binding and coverage:
//
//   CT-R01  no `surfaces` — nothing declares how any decision is explained or contested
//   CT-R02  THE COVERAGE RULE: a model role in the manifest at a covered tier with no surface
//           entry. This is the property the PA2 section alone could never hold — a plan could
//           satisfy `explainability-and-contestability` in prose while a model shipped that the
//           prose never mentioned. Silence is not a pass
//   CT-R03  a surface naming a role that is not in the manifest — a route for a model nobody ships
//   CT-R04  no `decision` stated — the field a reviewer checks the rest of the row against
//   CT-R05  no `reason_surface.where` — a reason that exists only in a log is not a reason anybody
//           was given
//   CT-R06  no `reason_surface.reason_source` — what the shown reason is derived from. THE GATE
//           CANNOT TELL WHETHER WHAT THIS FIELD SAYS IS TRUE; a reason composed from a rules layer
//           that did not make the decision is a plausible sentence about a different process, and
//           the most this gate holds is that somebody had to write down which it is
//   CT-R07  no `contest_route.how` — "contact us" is not a route
//   CT-R08  no bounded response time, per surface or by file default, or one that is not a positive
//           number. Unbounded, the decision stands while nobody is obliged to look
//   CT-R09  an `authority` who does not resolve to a human in the registry, is an agent, or sits
//           inside `builders`. A contest that arrives somewhere that cannot act on it is an inbox
//   CT-R10  no `overturns_recorded_in` — overturns are the highest-signal evidence a model is wrong
//           about a group, and if they land nowhere the runtime monitoring can never see them
//   CT-R11  (NOTICE ALWAYS) the standing limit: no reason is generated, judged or delivered here,
//           and no contest is routed. Reported every run for every covered surface, because a
//           record this gate passes is a record, not a working contest path
//
// MANDATORY-WHEN-COMPILED (the rc.13 WS3 idiom with rc.46's correction — arming on the file's
// PRESENCE is a defect, since the installer mounts the template). No compiling change ⇒ every rule
// is a NOTICE and the run is `inert`. The moment a change's compiled plan requires the
// `decision_contestability` capability, the same rules are findings naming the changes requiring it.
//
// Lane: pr. Run from the repo root: `node scripts/decision-contestability-check.mjs` (exit 1 on a
// finding).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired, requiredBy, modelRolesRequiredByCapability } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry } from './identity-registry-check.mjs';

export const CONTESTABILITY_LOCATIONS = ['docs/governance/decision-contestability.json', 'decision-contestability.json'];
export const MANIFEST_LOCATIONS = ['docs/governance/model-manifest.json', 'model-manifest.json'];
export const CAPABILITY = 'decision_contestability';
// The compiler family this record rides with. Used ONLY to name the changes when a per-change
// capability record is unavailable — never to decide whether this gate applies.
export const GATE_FAMILY = 'PA2';
// Which manifest risk tiers are taken to decide about a person materially, and therefore must carry
// a contest route. ADOPT: medium and high, the same default the eval, validation and fairness rules
// use — a low-tier model is optional here.
export const COVERED_TIERS = new Set(['high', 'medium']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must never read as a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
/** A real, adopted value — present and not an unreplaced marker. */
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * Findings (fail) and notices (never do) over a parsed contestability record.
 *
 * `models` is the manifest's model list — the join partner. Without it the coverage rule (CT-R02)
 * cannot run, and the caller reports that as UNCOVERED rather than as a clean pass.
 *
 * `enforced` is whether a compiled plan requires the capability, and it is the ONLY thing deciding
 * finding-vs-notice — for every rule. Mounting the template is not the declaration.
 */
export function evaluate(doc, { models = null, coveredRoles = null, registry = null, enforced = false } = {}) {
  const findings = [];
  const notices = [];
  const say = (m) => (enforced ? findings : notices).push(m);

  const surfaces = Array.isArray(doc?.surfaces)
    ? doc.surfaces.filter((s) => s && typeof s === 'object' && stated(s.role))
    : [];
  const byRole = new Map(surfaces.map((s) => [s.role.trim(), s]));

  // CT-R01 — nothing declared at all. Still runs the coverage rule below, because "no surfaces AND
  // three customer-deciding models" is a more useful message than either half alone.
  if (!surfaces.length) {
    say('CT-R01: no `surfaces` with a stated role — nothing in this repository declares how any automated decision is explained to the person it was made about, or how they challenge it');
  }

  const defaultSla = doc?.response_sla_days;

  // CT-R02 / CT-R03 — the join with the model manifest, in both directions.
  if (Array.isArray(models)) {
    const manifestRoles = new Map(models.filter((m) => m && nonEmpty(m.role)).map((m) => [m.role.trim(), m]));
    for (const [role, m] of manifestRoles) {
      if ((!coveredRoles || coveredRoles.has(role)) && COVERED_TIERS.has(m.risk_tier) && !byRole.has(role)) {
        say(`CT-R02: model role ${JSON.stringify(role)} is ${m.risk_tier}-tier in the model manifest and declares NO contest route here — a plan can satisfy its explainability-and-contestability section in prose while a model ships that the prose never mentioned, and this is the rule that catches it. Silence is not a pass`);
      }
    }
    for (const role of byRole.keys()) {
      if (!manifestRoles.has(role)) {
        say(`CT-R03: a contest route is declared for role ${JSON.stringify(role)}, which is not in the model manifest — a route for a model this repository does not ship`);
      }
    }
  }

  for (const s of surfaces) {
    const role = s.role.trim();
    if (!stated(s.decision)) {
      say(`CT-R04: surface ${JSON.stringify(role)} states no \`decision\` — say what is decided about the person, in the words they would recognise. It is the field a reviewer checks the rest of the row against`);
    }
    const reason = s.reason_surface && typeof s.reason_surface === 'object' ? s.reason_surface : null;
    if (!stated(reason?.where)) {
      say(`CT-R05: surface ${JSON.stringify(role)} names no \`reason_surface.where\` — the letter, screen or script where the person is actually told. A reason that exists only in a log is not a reason anybody was given`);
    }
    if (!stated(reason?.reason_source)) {
      say(`CT-R06: surface ${JSON.stringify(role)} states no \`reason_surface.reason_source\` — say what the shown reason is derived from: the model's attributions, a rules layer in front of it, or a human's write-up. THE GATE CANNOT TELL WHETHER THE ANSWER IS TRUE; it holds only that somebody had to write down which it is`);
    }
    const route = s.contest_route && typeof s.contest_route === 'object' ? s.contest_route : null;
    if (!stated(route?.how)) {
      say(`CT-R07: surface ${JSON.stringify(role)} names no \`contest_route.how\` — the form, number or address, and what the person has to supply. "Contact us" is not a route`);
    }
    // CT-R08 — the bound. Per-surface overrides the file default; one of them must be usable.
    const sla = route?.sla_days !== undefined ? route.sla_days : defaultSla;
    if (!positive(sla)) {
      say(`CT-R08: surface ${JSON.stringify(role)} has no bounded response time (contest_route.sla_days ${JSON.stringify(route?.sla_days)}, file default ${JSON.stringify(defaultSla)}) — a positive number of days, per surface or once for the file. Unbounded, the decision stands while nobody is obliged to look. NOTHING HERE OBSERVES WHETHER THE BOUND WAS MET`);
    }
    // CT-R09 — somebody who can actually change the outcome.
    if (!stated(s.authority)) {
      say(`CT-R09: surface ${JSON.stringify(role)} names no \`authority\` — the human who can OVERTURN the decision, not the one who receives the complaint`);
    } else if (registry) {
      const who = identityOf(registry, s.authority);
      if (!who) {
        say(`CT-R09: surface ${JSON.stringify(role)} names authority ${JSON.stringify(s.authority)}, who is not in the identity registry — a contest routed to an unresolvable name arrives nowhere`);
      } else {
        if (who.kind === 'agent') {
          say(`CT-R09: surface ${JSON.stringify(role)} routes contests to ${s.authority}, an AGENT — the whole point of a contest is that a human reconsiders a machine's decision, and an agent overturning an agent is the same decision twice`);
        }
        // `builders` is a GROUP on the identity — the same membership test identity-registry-check
        // uses for second-line disjointness.
        if ((who.groups || []).includes('builders')) {
          say(`CT-R09: surface ${JSON.stringify(role)} routes contests to ${s.authority}, who is in \`builders\` — the team that shipped the model is not the independent look the person was promised`);
        }
      }
    }
    if (!stated(s.overturns_recorded_in)) {
      say(`CT-R10: surface ${JSON.stringify(role)} says nowhere that overturns are recorded — an overturn is the highest-signal evidence a model is wrong about a group, and one that lands nowhere can never reach the runtime monitoring the manifest declares`);
    }
    // CT-R11 — the standing limit, restated per covered surface, every run, in both postures.
    notices.push(`CT-R11: ${JSON.stringify(role)} — the harness generates no reason, judges no reason's intelligibility, delivers nothing to a customer and routes no contest. This record being complete says a path was DESIGNED, never that it works`);
  }

  return { findings, notices, surfaces: surfaces.length };
}

/**
 * The change_ids whose compiled plan requires the capability. Prefers the per-change capability
 * record; falls back to the gate family the capability rides with, so a message still names
 * somebody when a plan predates per-change capability records.
 */
export function requiringChanges(agg) {
  const byCapability = (agg?.changes || [])
    .filter((c) => c?.capabilities?.[CAPABILITY]?.required)
    .map((c) => c.change_id);
  return byCapability.length ? byCapability : requiredBy(agg, GATE_FAMILY);
}

export function run(cwd = process.cwd()) {
  const path = CONTESTABILITY_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  if (!path) {
    if (!required) return { present: false, required, findings: [], notices: [], surfaces: 0, inert: true, joined: false };
    const who = requiringChanges(agg);
    return {
      present: false,
      required,
      // Name the source template and its tier — see the same note in fairness-evaluation-check.mjs.
      findings: [`a compiled plan requires the ${CAPABILITY} capability [${who.join(', ') || 'unknown change'}] and there is no ${CONTESTABILITY_LOCATIONS[0]} — the route says this change ships a model that decides about people, and nothing in the repository says how any of them are told why, or how they get it looked at again. The template is governance/decision-contestability.template.json and it installs at the GOVERNED tier; a core-tier adoption that compiles this capability has to raise its tier to receive it`],
      notices: [],
      surfaces: 0,
      inert: false,
      joined: false,
    };
  }
  const doc = readJson(path);
  if (!doc) {
    const m = `${CONTESTABILITY_LOCATIONS[0]} is not valid JSON — nothing in it can be read, so nothing in it routes anything`;
    return { present: true, required, findings: required ? [m] : [], notices: required ? [] : [m], surfaces: 0, inert: false, joined: false };
  }
  const manifestPath = MANIFEST_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const manifest = manifestPath ? readJson(manifestPath) : null;
  const models = Array.isArray(manifest?.models) ? manifest.models : null;
  const { findings, notices, surfaces } = evaluate(doc, {
    models,
    coveredRoles: modelRolesRequiredByCapability(agg, CAPABILITY),
    registry: loadRegistry(cwd),
    enforced: required,
  });
  const joinNotices = models ? [] : [
    `no model manifest found (looked in ${MANIFEST_LOCATIONS.join(', ')}) — THE COVERAGE RULE (CT-R02) could not run, so this record is checked for internal soundness only and the models it fails to cover are UNCOVERED rather than confirmed absent`,
  ];
  return { present: true, required, findings, notices: [...joinNotices, ...notices], surfaces, inert: false, joined: Boolean(models) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, required, findings, notices, surfaces, joined } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nDecision-contestability gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery model that decides about a person names where the reason appears, how the decision is\nchallenged, and a human who can overturn it.\nTHE HARNESS EXPLAINS NOTHING AND ROUTES NOTHING — it reads the record.\nSee governance/decision-contestability.template.json.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Decision-contestability gate — no ${CONTESTABILITY_LOCATIONS[0]}; no compiled plan requires ${CAPABILITY} (nothing to check)\n`);
    process.exit(0);
  }
  // "record read", never "the customer can contest" — kept in the success line, where it is read most.
  const posture = required
    ? `, ${CAPABILITY} required by a compiled plan`
    : `; no compiled plan requires ${CAPABILITY}, so every rule above is REPORTED, not enforced`;
  process.stdout.write(`Decision-contestability gate — OK (${surfaces} surface${surfaces === 1 ? '' : 's'}${joined ? ', joined to the model manifest' : ', NOT joined — no manifest'}; record read, no reason generated and no contest routed here${posture}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
