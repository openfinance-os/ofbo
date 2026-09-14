// The evidence-retention gate. The release bundle is sealed and hash-chained (HG-0003,
// scripts/evidence-seal-check.mjs), which makes it tamper-EVIDENT for exactly as long as it
// exists. Nothing anywhere said how long that is. An examination reaches back YEARS — a
// Shari'ah examiner asks which ruling authorised the structure a facility written four years ago
// was booked under, a model-risk review asks which evaluation a decision was released against, a
// data-protection complaint asks who approved what — and "CI kept the artifact for ninety days"
// is not an answer to any of them. So AN EVIDENCE TYPE WITH NO BOUNDED RETENTION ENTRY IS A GAP,
// reported as uncovered rather than assumed to inherit something sensible.
//
// THE HARNESS RECORDS THE POLICY. IT DOES NOT HOLD THE EVIDENCE. The immutable archive itself —
// a WORM store, a retention lock nobody can shorten, a timestamping authority — is the
// institution's platform, outside this repository and outside anything a gate here can reach.
// `immutable_archive: true` is a CLAIM about that platform; this gate reads the claim, checks that
// the claim at least SAYS WHERE, and can never confirm that the store exists, that the lock is
// set, or that a single byte was ever written to it. Nothing in the harness watches production.
// Reading this file green means "a policy is written down and covers what this repository
// produces" — never "the evidence is retained".
//
// NOT AN ISLAMIC CONTROL. Retention is generic and every row in the shipped template that has
// nothing to do with Islamic finance is there to prove it. The Shari'ah rows are the longest holds
// in the file because the facility lives longest, not because this gate rules on anything: it takes
// no view on permissibility, reads no ruling, and approves nothing. Scholars decide Shari'ah.
//
// MANDATORY-WHEN-COMPILED (rc.13 WS3 — the feature-flag / knowledge-pins idiom), AND THAT GOVERNS
// EVERY RULE BELOW, NOT ONLY THE MISSING FILE. No retention file and no compiling change ⇒ SILENT,
// reported as `inert` rather than as a vacuous green. The moment any change's compiled plan
// requires the `evidence_retention` capability, the missing file is a finding that NAMES the
// changes requiring it. A repository that compiles nothing never fails here.
//
// THE MOUNTED FILE IS NOT THE DECLARATION. The installer copies this template into every
// `governed`-tier adopter, so a gate armed by the file's PRESENCE arms itself in repositories that
// never asked for it — and no shipped profile declares `evidence_retention`, which means presence-
// arming could only ever fail people who did not opt in. That is the defect review found: a purely
// conventional adopter, no Islamic profile and nothing compiled, who sealed an evidence type
// outside the shipped rows — a penetration test, a DPIA, a UAT sign-off — took a hard PR-lane
// failure from ER-R03 for a capability nothing required. So every rule here is a FINDING when a
// compiled plan requires the capability and a NOTICE otherwise, and mounting the template can
// never fail anybody.
//
// The rules, in the order each one's absence bites. ER-R01 to ER-R05 and the archive rules are
// findings ONLY when the capability is compiled-required, notices otherwise; ER-R06 and ER-R08 are
// notices always:
//
//   ER-R01  a mounted file with no `types` object — a retention policy with no policy in it
//   ER-R02  a `default_retention_years` that is not a positive number — the safety net is the one
//           value an unnamed type falls through to, so an unusable one silently retains nothing
//   ER-R03  an evidence type this repository PRODUCES (sealed into a bundle, or required by a
//           compiled plan) with no entry at all. It falls through to the default, and the default
//           exists so an unnamed type is retained rather than dropped, NOT so types can go
//           unnamed: a safety net that is load-bearing is a missing entry
//   ER-R04  an entry that is not an object — a bare number or a string is not a decision
//   ER-R05  an entry with neither a positive `retention_years` NOR a justification: it says
//           neither how long nor why, which is the unretained state with extra JSON
//   ER-R06  (NOTICE ALWAYS) an unbounded entry carried on a stated justification — legitimate (a
//           statutory hold has no year count), and reported every run because the harness enforces
//           precisely nothing about it
//   ER-R07  `immutable_archive` that is not a boolean, or `true` naming no archive: neither an
//           entry `archive_ref` nor a document-level `immutable_archive_ref`. A claim about a
//           store nobody located is not a control. The location is adopter-side platform detail,
//           and a repository that has not yet decided it compiles must not be failed for the
//           shipped template's silence
//   ER-R08  (NOTICE ALWAYS) entries for types this repository does not produce — kept for a
//           product built elsewhere or not yet. Reported, never enforced
//
// Lane: pr. Run from the repo root: `node scripts/evidence-retention-check.mjs` (exit 1 on a
// finding).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired, requiredBy } from '../core/compiled-requirements.mjs';
import { MANIFEST_LOCATIONS } from './evidence-seal-check.mjs';

export const RETENTION_LOCATIONS = ['docs/governance/evidence-retention.json', 'evidence-retention.json'];
export const CAPABILITY = 'evidence_retention';
// The compiler family the retention policy rides with. Used ONLY to name the changes when a
// per-change capability record is unavailable — never to decide whether this gate applies.
export const GATE_FAMILY = 'assurance-cadence';

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must never read as a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** A real, adopted reference — not absent, not an unreplaced marker. */
const located = (v) => nonEmpty(v) && !isPlaceholder(v);

/**
 * Findings (fail) and notices (never do) over a parsed retention policy.
 *
 * `produced` is a Map of evidence type → a human phrase saying WHERE this repository produces it,
 * so ER-R03 can name the source rather than assert a gap. An empty map means the types could not
 * be enumerated here; run() says so as a notice rather than reporting full coverage.
 *
 * `enforced` is whether a compiled plan requires the capability, and it is the ONLY thing that
 * decides finding-vs-notice — for every rule, not just the archive claim. MOUNTING THE FILE IS NOT
 * THE DECLARATION: the installer mounts this template by default at the `governed` tier, so a rule
 * that fires on presence fires at adopters who never opted in. Dormant ⇒ notices, exit 0.
 */
export function evaluate(doc, { produced = new Map(), enforced = false } = {}) {
  const findings = [];
  const notices = [];
  // The mandatory-when-compiled split, applied once and used by every rule below (the same idiom
  // as knowledge-staleness-check.mjs and purification-check.mjs).
  const say = (m) => (enforced ? findings : notices).push(m);
  const types = doc?.types;
  if (!types || typeof types !== 'object' || Array.isArray(types)) {
    say('ER-R01: evidence-retention.json has no `types` object — a retention policy with no per-type entries retains nothing and bounds nothing');
    return { findings, notices, count: 0 };
  }

  // ER-R02 — the safety net. Absent is allowed (every produced type must be named anyway); present
  // and unusable is not, because that is the value an unnamed type silently falls through to.
  if (doc.default_retention_years !== undefined && !positive(doc.default_retention_years)) {
    say(`ER-R02: default_retention_years is ${JSON.stringify(doc.default_retention_years)}, not a positive number — the default is what an unnamed evidence type falls through to, so an unusable one drops exactly the records nobody remembered to name`);
  }

  // ER-R03 — coverage. The gap this file exists to close, and the rule that made presence-arming a
  // defect: an adopter's evidence types are their own, so an unlisted one is only a GAP against a
  // requirement somebody compiled. Dormant, it is a notice — a conventional repository sealing a
  // penetration test or a DPIA is not failed by a policy it never asked to be held to.
  for (const [type, origin] of produced) {
    if (!Object.prototype.hasOwnProperty.call(types, type)) {
      say(`ER-R03: evidence type ${JSON.stringify(type)} is produced here (${origin}) and has NO retention entry — it falls through to default_retention_years, and the default is a safety net. A safety net that is load-bearing is a missing entry: say how long this type is kept, and why`);
    }
  }

  const docArchive = doc.immutable_archive_ref;
  for (const [type, entry] of Object.entries(types)) {
    if (type.startsWith('_')) continue; // commentary keys, as everywhere else in the harness
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      say(`ER-R04: retention entry for ${JSON.stringify(type)} is ${JSON.stringify(entry)}, not an object — an entry states a period, a justification and whether it is archived; a bare value states none of them`);
      continue;
    }
    const bounded = positive(entry.retention_years);
    const justified = located(entry.justification);
    if (!bounded) {
      if (!justified) {
        say(`ER-R05: retention entry for ${JSON.stringify(type)} has neither a positive retention_years (got ${JSON.stringify(entry.retention_years)}) nor a justification — an entry that says neither how long nor why is the unretained state with extra JSON`);
      } else {
        notices.push(`ER-R06: ${type} carries no bounded retention_years and is kept on a stated justification instead (${entry.justification.trim().slice(0, 80)}…) — legitimate where a statutory hold has no year count, and reported every run because the harness enforces nothing about it`);
      }
    }
    if (entry.immutable_archive !== undefined && typeof entry.immutable_archive !== 'boolean') {
      say(`ER-R07: ${type} declares immutable_archive as ${JSON.stringify(entry.immutable_archive)} — it is true or false; a truthy string is not a claim anyone can act on`);
    } else if (entry.immutable_archive === true && !located(entry.archive_ref) && !located(docArchive)) {
      say(`ER-R07: ${type} claims immutable_archive: true and names no archive — set archive_ref on the entry, or immutable_archive_ref once for the file. THE HARNESS CANNOT VERIFY THE STORE: it never reaches a WORM system, never confirms a retention lock and never sees a byte written, so the most it can hold is that the claim says where. A claim about a store nobody located is not a control`);
    }
  }

  // ER-R08 — rows for evidence this repository does not produce. Never a finding: an adopter who
  // deletes no rows must not be failed for the ones their product does not reach.
  if (produced.size) {
    const extra = Object.keys(types).filter((t) => !t.startsWith('_') && !produced.has(t));
    if (extra.length) {
      notices.push(`ER-R08: retention entries for evidence this repository does not produce (${extra.join(', ')}) — kept for a product built elsewhere, or not yet. Reported, never enforced`);
    }
  }

  return { findings, notices, count: Object.keys(types).filter((t) => !t.startsWith('_')).length };
}

/**
 * The evidence types this repository actually produces, each with the phrase naming where it came
 * from. Two sources, both read from the repo rather than assumed:
 *
 *   the SEALED BUNDLE   — every `entries[].type` in the evidence manifest. What shipped.
 *   the COMPILED PLANS  — every `required_evidence` entry in the aggregate. What is about to.
 *
 * The bundle wins where both name a type: it is the stronger statement (it exists). A repository
 * with neither returns an empty map, and the caller reports that as unenumerable rather than clean.
 */
export function producedTypes(cwd = process.cwd(), agg = null) {
  const produced = new Map();
  const requirements = agg || aggregateRequirements(cwd);
  for (const e of requirements.evidence) produced.set(e, 'required by a compiled control plan');
  const manifestPath = MANIFEST_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const manifest = manifestPath ? readJson(manifestPath) : null;
  for (const entry of manifest?.entries || []) {
    if (nonEmpty(entry?.type)) produced.set(entry.type, `sealed into the evidence bundle at ${manifestPath.slice(cwd.length + 1)}`);
  }
  return produced;
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
  const path = RETENTION_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  if (!path) {
    // Absence is the resting state of a repository that has not written a retention policy, and
    // that is not a failure here — until a compiled plan says this change's evidence must outlive
    // the pipeline that produced it.
    if (!required) return { present: false, required, findings: [], notices: [], count: 0, inert: true };
    const who = requiringChanges(agg);
    return {
      present: false,
      required,
      findings: [`a compiled plan requires the ${CAPABILITY} capability [${who.join(', ') || 'unknown change'}] and there is no ${RETENTION_LOCATIONS[0]} — the route says this change's evidence must be answerable years from now, and nothing in the repository says for how long or where`],
      notices: [],
      count: 0,
      inert: false,
    };
  }
  const doc = readJson(path);
  if (!doc) {
    // Same split as every rule: an unparseable file the adopter never opted into being held to is
    // reported, not blocking. A mounted file is not a declaration, and that includes a broken one.
    const m = `${RETENTION_LOCATIONS[0]} is not valid JSON — nothing in it can be read, so nothing in it bounds anything`;
    return { present: true, required, findings: required ? [m] : [], notices: required ? [] : [m], count: 0, inert: false, covered: 0 };
  }
  const produced = producedTypes(cwd, agg);
  const { findings, notices, count } = evaluate(doc, { produced, enforced: required });
  const originNotices = produced.size ? [] : [
    'this repository has no sealed evidence bundle and no compiled plan requiring evidence, so the types produced HERE cannot be enumerated — the policy is checked for internal soundness only, and its coverage is UNCOVERED rather than confirmed',
  ];
  return { present: true, required, findings, notices: [...originNotices, ...notices], count, inert: false, covered: produced.size };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, required, findings, notices, count, covered } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nEvidence-retention gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery evidence type this repository produces names how long it is kept and why.\nThe harness records the POLICY; the immutable store is the institution\'s platform and\nnothing here can verify it. See governance/evidence-retention.template.json.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Evidence-retention gate — no ${RETENTION_LOCATIONS[0]}; no compiled plan requires ${CAPABILITY} (nothing to check)\n`);
    process.exit(0);
  }
  // "policy read", not "evidence retained": the gate compared a JSON file against the types this
  // repository produces. Whether anything was actually kept is the institution's archive to answer.
  // And say which posture it read in — a green with everything reported as notices is a different
  // statement from a green that enforced, and printing them identically would overclaim.
  const posture = required
    ? `, ${CAPABILITY} required by a compiled plan`
    : `; no compiled plan requires ${CAPABILITY}, so every rule above is REPORTED, not enforced`;
  process.stdout.write(`Evidence-retention gate — OK (${count} type${count === 1 ? '' : 's'} in the policy, ${covered} produced here; policy read, retention never verified${posture}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
