// The knowledge-currency gate. A rule base that has silently moved is worse than one nobody
// consulted: it answers confidently, in the old world's terms. Standards editions supersede,
// authorities issue pronouncements, API specifications take errata, and an internal register
// exported last quarter is a photograph of last quarter. Code written against "the current
// version" is written against whatever its author last remembered, and nothing in the repository
// records what that was. This gate holds docs/governance/knowledge-pins.json — the file that turns
// each external rule base into an ARTIFACT: a named publisher, a named edition, an owner_role
// accountable for it, a date somebody last checked, and a max_age_days after which "last checked"
// stops counting.
//
// WHAT THIS GATE CANNOT DO, said plainly because the file's whole value depends on it being said:
// IT READS DATES OUT OF A JSON FILE. It never fetches a publisher — there is no network call
// anywhere in the harness, by design — so it cannot tell you whether the pinned edition is still
// the current one. `last_verified` is an assertion, and an assertion can be bumped by hand in the
// same commit that would otherwise have failed. What makes the date mean anything is elsewhere:
// running the pin's `check_ref` on a schedule, and having the assurance stream's confirmation
// SIGNED over the record (scripts/assurance-cycle-check.mjs, step ⑥). This gate's honest claim is
// "somebody asserted they looked, recently enough" — never "this repository is current".
// A stale pin is therefore a TRUE finding; a fresh pin is a claim about the record, not the world.
//
// NOT AN ISLAMIC MECHANISM. Pinning is generic — the shipped template's non-Islamic row is there
// to prove it — and this gate rules on nothing substantive. It never reads a pronouncement, never
// interprets one, and takes no view on permissibility: scholars decide Shari'ah, the Shari'ah
// Compliance Function owns the watch, and the harness records only whether the watch is being
// kept. A gate that appeared to rule on the CONTENT of a rule base would be a defect.
//
// MANDATORY-WHEN-COMPILED (rc.13 WS3, the feature-flag/provider-selection idiom). A repository
// with no pins file and no compiling change is SILENT — `inert`, not a vacuous green. The moment
// any change's compiled plan requires the `knowledge_currency` capability (the Islamic-product
// profile and the institution template both declare it from medium tier), the missing file is a
// finding that names the changes requiring it. A conventional adopter never fails on this.
//
// The rules, in the order each one's absence bites:
//
//   KP-R01  a mounted file with no `pins` array — a register with no register
//   KP-R02  a pin with no id, or two pins with one id (a pin nobody can cite, or can cite two ways)
//   KP-R03  a WHOLLY untouched template row — nothing is pinned. Finding when the capability is
//           compiled-required; a notice otherwise, so shipping the template does not fail a
//           conventional adopter who has no rule base to pin
//   KP-R04  a HALF-adopted row — some fields real, some still ADOPT. Always a finding: a
//           half-made decision is not a made one (PS-R07 re-entered at pin level)
//   KP-R05  no parseable `last_verified`, or one dated in the FUTURE. An unparseable placeholder
//           fails rather than passes — a pin nobody ever verified must not read as fresh — and a
//           future date is either a typo or a bound pushed out of reach
//   KP-R06  no usable `max_age_days` — a pin with no bound never goes stale, which is exactly
//           the unpinned state it was supposed to replace
//   KP-R07  STALE: age past the bound. A finding when the pin's `required_by_capability` is
//           compiled-required (or unset — an unqualified pin is unconditionally owned); a NOTICE
//           otherwise, so a row kept for a capability this repo does not compile still reports
//   KP-R08  a non-null `check_ref` that does not exist on disk — a control citing a ghost. `null`
//           is a legitimate answer (a human's calendar entry); an ADOPT placeholder is not
//   KP-R09  no owner_role — a bound nobody is accountable for is a bound nobody keeps
//   KP-R10  a `required_by_capability` NO compiled plan and NO shipped profile declares. This
//           field is the only thing that downgrades KP-R07 from a finding to a notice, so an
//           unvalidated one is a staleness failure disabled by a typo: write `knowledge_currncy`
//           and the pin's bound stops blocking, silently and forever. The recognised set is read
//           from the ADOPTER'S OWN TREE (their plans, their profiles) rather than baked in here,
//           so an institution that invents a capability is recognised the moment it declares one.
//           An unrecognised name is a finding AND the row is treated as unqualified — i.e.
//           unconditionally owned — because the downgrade is exactly what the typo bought.
//
// Lane: pr. Run from the repo root: `node scripts/knowledge-staleness-check.mjs` (exit 1 on a
// finding).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired, requiredBy } from '../core/compiled-requirements.mjs';

export const PIN_LOCATIONS = ['docs/governance/knowledge-pins.json', 'knowledge-pins.json'];
export const CAPABILITY = 'knowledge_currency';
// Where profiles declare capabilities. Mirrors the compiler's profile dirs; a name only has to
// appear in one of them to be a name this repository recognises.
export const PROFILE_DIRS = ['profiles', 'profiles/jurisdictions', 'profiles/products', 'profiles/institutions'];
// The compiler family the pins ride with. Used only to NAME the changes when a per-change
// capability record is unavailable — never to decide whether this gate applies.
export const GATE_FAMILY = 'assurance-cadence';

const DAY = 86_400_000;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must never read as a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * Capability names anywhere inside a profile, added to `into`. Profiles hang a `capabilities`
 * block off each tier and may add another under a conditional, so this WALKS rather than assuming
 * a shape — a name missed here would read as unrecognised and fail a legitimate pin.
 */
function collectCapabilityNames(node, into) {
  if (Array.isArray(node)) { for (const v of node) collectCapabilityNames(v, into); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'capabilities' && v && typeof v === 'object' && !Array.isArray(v)) for (const n of Object.keys(v)) into.add(n);
    collectCapabilityNames(v, into);
  }
}

/**
 * The capability names this repository actually uses: every name its compiled plans carry, every
 * name its profiles declare, and this gate's own. NOT a taxonomy baked into the harness — it is
 * read from the adopter's tree, so an institution profile that invents a capability is recognised
 * as soon as it declares one, and a jurisdiction the harness has never heard of needs no patch.
 */
export function knownCapabilityNames(cwd = process.cwd(), agg = null) {
  const names = new Set([CAPABILITY, ...Object.keys(agg?.capabilities || {})]);
  for (const c of agg?.changes || []) for (const n of Object.keys(c?.capabilities || {})) names.add(n);
  for (const d of PROFILE_DIRS) {
    const abs = join(cwd, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.json')) collectCapabilityNames(readJson(join(abs, f)), names);
    }
  }
  return names;
}

/** Age of a pin in whole days at `now`, or null when the date is unusable. */
export function ageDays(last_verified, now = Date.now()) {
  const t = Date.parse(last_verified);
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY);
}

/**
 * Findings (fail) and notices (never do) over a parsed pins register.
 *
 * `requiredCapabilities` is the set of capability names some compiled plan demands — the ONLY
 * thing that decides finding-vs-notice for a row's currency. `knownCapabilities` is the set of
 * names this repository RECOGNISES (knownCapabilityNames); a row naming anything outside it is
 * KP-R10 and is not downgraded. Its default — this gate's capability plus everything a plan
 * requires — is the smallest set that is true by construction, so the validation is never
 * silently off. `exists(path)` resolves a `check_ref` against the repo (injected so the rule is
 * testable without a filesystem); its default answers yes, so a caller that cannot check the
 * tree never invents a ghost.
 */
export function evaluate(doc, { requiredCapabilities = new Set(), knownCapabilities = null, exists = () => true, now = Date.now() } = {}) {
  const findings = [];
  const notices = [];
  const known = knownCapabilities instanceof Set ? knownCapabilities : new Set([CAPABILITY, ...requiredCapabilities]);
  const pins = doc?.pins;
  if (!Array.isArray(pins)) {
    return { findings: [`KP-R01: knowledge-pins.json has no \`pins\` array — a register of external rule bases with no register in it pins nothing`], notices, count: 0 };
  }

  const seen = new Set();
  for (const pin of pins) {
    const id = pin?.id;
    const label = nonEmpty(id) && !isPlaceholder(id) ? id : '(unnamed pin)';
    if (!nonEmpty(id) || isPlaceholder(id)) {
      findings.push(`KP-R02: a pin has no id — a rule base nobody can cite cannot be cited by a ruling, a control or a change`);
    } else if (seen.has(id)) {
      findings.push(`KP-R02: duplicate pin id ${JSON.stringify(id)} — two rows for one rule base means one of them is stale and nothing says which`);
      continue;
    } else {
      seen.add(id);
    }

    // Whose problem is this row? A row naming a capability nobody compiles still reports, but as
    // a notice: it is a pin kept for a product this repository does not currently build. A row
    // naming NO capability is unconditionally owned — the adopter wrote it with no qualifier.
    //
    // KP-R10 first, because this field is the ONLY thing that can downgrade a staleness failure
    // and free text validated against nothing is a control with an off switch nobody guards.
    const cap = pin?.required_by_capability;
    const qualified = nonEmpty(cap);
    if (qualified && !known.has(cap)) {
      findings.push(`KP-R10: pin ${JSON.stringify(label)} claims required_by_capability ${JSON.stringify(cap)}, which no compiled plan and no profile in this repository declares — this pin says it is required by a capability nothing here has ever heard of, and since that field is what decides whether a stale pin blocks, an unrecognised one would turn this pin's bound off. The row is treated as unconditionally owned until the name is one this repository uses`);
    }
    // An unrecognised name is treated as UNQUALIFIED, not dormant: the downgrade is the thing the
    // typo bought, so it is the thing that must not be granted.
    const required = !qualified || !known.has(cap) || requiredCapabilities.has(cap);
    const say = (m) => (required ? findings : notices).push(m);

    // KP-R03 / KP-R04 — the template row, whole or half. Only the three fields the ADOPTER must
    // supply count here. `owner_role` and `max_age_days` ship REAL in the template (they are the
    // harness's opinion, not the adopter's data) and `check_ref` ships as a placeholder OR null,
    // so none of them can tell an untouched row from an adopted one. An entirely EMPTY row is not
    // an untouched row — it carries no placeholder to have been left — and falls through to the
    // field rules below, where it fails unconditionally.
    const authored = ['publisher', 'pinned_version', 'last_verified'].map((f) => pin?.[f]);
    if (authored.some(isPlaceholder) && authored.every((v) => v === undefined || isPlaceholder(v))) {
      say(`KP-R03: pin ${JSON.stringify(label)} is still the shipped template row — publisher, edition and last_verified are all ADOPT placeholders, so nothing is pinned and nothing can go stale`);
      continue;
    }

    for (const f of ['publisher', 'pinned_version', 'owner_role']) {
      const v = pin?.[f];
      if (isPlaceholder(v)) findings.push(`KP-R04: pin ${JSON.stringify(label)} has ${f} still as an ADOPT placeholder while the rest of the row is adopted — a half-made decision is not a made one`);
      else if (!nonEmpty(v)) {
        if (f === 'owner_role') findings.push(`KP-R09: pin ${JSON.stringify(label)} has no owner_role — a re-verification bound nobody is accountable for is a bound nobody keeps`);
        else findings.push(`KP-R04: pin ${JSON.stringify(label)} has no ${f} — a pin without a named ${f === 'publisher' ? 'publisher' : 'edition'} is the "current version" problem with extra JSON`);
      }
    }

    // KP-R05 — dates are load-bearing. Unparseable FAILS (a pin nobody ever verified must not read
    // as fresh); a future date fails too, because it buys currency the check never performed.
    const age = ageDays(pin?.last_verified, now);
    if (age === null) {
      findings.push(`KP-R05: pin ${JSON.stringify(label)} has no parseable last_verified (got ${JSON.stringify(pin?.last_verified)}) — an undated pin is not a fresh pin, it is an unverified one`);
      continue;
    }
    if (age < 0) {
      findings.push(`KP-R05: pin ${JSON.stringify(label)} is last_verified ${pin.last_verified}, which is in the FUTURE (${-age}d) — a check that has not happened yet cannot be evidence that it did`);
      continue;
    }

    // KP-R06 / KP-R07 — the bound, and the age against it.
    const max = pin?.max_age_days;
    if (!(typeof max === 'number' && Number.isFinite(max) && max > 0)) {
      findings.push(`KP-R06: pin ${JSON.stringify(label)} has no usable max_age_days (got ${JSON.stringify(max)}) — a pin with no bound never goes stale, which is the unpinned state it was meant to replace`);
    } else if (age > max) {
      say(`KP-R07: pin ${JSON.stringify(label)} was last verified ${pin.last_verified} (${age}d ago), past its ${max}d bound — ${required ? 'a compiled plan is built on this rule base, and nobody has checked whether it moved' : `no compiled plan requires ${JSON.stringify(cap)} here, so this is reported rather than blocking`}`);
    }

    // KP-R08 — a control citing a ghost. null is a legitimate answer (the template says so
    // explicitly: a human's calendar entry beats a script that does not exist); an ADOPT marker
    // is the one thing it may not stay.
    const ref = pin?.check_ref;
    if (isPlaceholder(ref)) {
      findings.push(`KP-R04: pin ${JSON.stringify(label)} has check_ref still as an ADOPT placeholder — name the scheduled job, or write null and own the bound by calendar. Undecided is not one of the two`);
    } else if (ref !== null && ref !== undefined) {
      if (!nonEmpty(ref)) findings.push(`KP-R08: pin ${JSON.stringify(label)} has a check_ref that is neither a path nor null (got ${JSON.stringify(ref)})`);
      else if (!exists(ref)) findings.push(`KP-R08: pin ${JSON.stringify(label)} names check_ref ${JSON.stringify(ref)}, which does not exist in this repository — a pin citing a job nobody wrote reports currency that nothing produces`);
    }
  }

  return { findings, notices, count: pins.length };
}

/**
 * The change_ids whose compiled plan requires the capability. Prefers the per-change capability
 * record; falls back to the gate family the capability rides with, so the message still names
 * somebody when a plan predates per-change capability records.
 */
export function requiringChanges(agg) {
  const byCapability = (agg?.changes || [])
    .filter((c) => c?.capabilities?.[CAPABILITY]?.required)
    .map((c) => c.change_id);
  return byCapability.length ? byCapability : requiredBy(agg, GATE_FAMILY);
}

export function run(cwd = process.cwd(), { now = Date.now() } = {}) {
  const path = PIN_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  if (!path) {
    // Absence is the resting state of a repository that pins nothing, and pinning nothing is not
    // a failure — until a compiled plan says this change is built on somebody else's rule base.
    if (!required) return { present: false, required, findings: [], notices: [], count: 0, inert: true };
    const who = requiringChanges(agg);
    return {
      present: false,
      required,
      findings: [`a compiled plan requires the ${CAPABILITY} capability [${who.join(', ') || 'unknown change'}] and there is no ${PIN_LOCATIONS[0]} — the route says this change is built on an external rule base, and nothing in the repository records which edition of it`],
      notices: [],
      count: 0,
      inert: false,
    };
  }
  const doc = readJson(path);
  if (!doc) return { present: true, required, findings: [`${PIN_LOCATIONS[0]} is not valid JSON`], notices: [], count: 0, inert: false };
  // Only capabilities a plan actually compiles count. A row naming an uncompiled capability is
  // reported, never enforced — that is the whole dormancy contract.
  const names = new Set((doc.pins || []).map((p) => p?.required_by_capability).filter(nonEmpty));
  const requiredCapabilities = new Set([...names].filter((n) => capabilityRequired(agg, n)));
  const { findings, notices, count } = evaluate(doc, {
    requiredCapabilities,
    knownCapabilities: knownCapabilityNames(cwd, agg),
    exists: (p) => existsSync(join(cwd, p)),
    now,
  });
  return { present: true, required, findings, notices, count, inert: false };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, required, findings, notices, count } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nKnowledge-currency gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA pinned rule base names its publisher, its edition, an owner and a re-verification bound.\nThis gate reads dates; running the check_ref on a schedule is what makes a date mean anything.\nSee governance/knowledge-pins.template.json and ../loom/references/continuous-assurance.md.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Knowledge-currency gate — no ${PIN_LOCATIONS[0]}; no compiled plan requires ${CAPABILITY} (nothing to check)\n`);
    process.exit(0);
  }
  // "read against their bounds", not "verified": the gate compared dates in a file. Whether the
  // rule bases actually moved is what the check_refs and the assurance stream answer.
  process.stdout.write(`Knowledge-currency gate — OK (${count} pin${count === 1 ? '' : 's'} read against their bounds; dates asserted, never fetched${required ? `, ${CAPABILITY} required by a compiled plan` : ''}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
