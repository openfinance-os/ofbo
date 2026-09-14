// The Shari'ah governance gate — control SHARIAH-GOV, and the primary reader of the
// `shariah_governance` capability. Until this file existed that capability compiled into plans
// and NOTHING read it, which by the method's own rule makes it a label rather than a control.
//
// WHAT THIS GATE VERIFIES, and the list is deliberately short:
//
//   COMPOSITION  who occupies the Shari'ah seats, and that there are enough of them to be a body
//   PROVENANCE   that each seat carries appointment references somebody OUTSIDE this repository
//                issued — an approval reference, an appointing instrument, a date
//   BINDING      that the composition register and the identity registry describe the SAME body,
//                in both directions, so neither file alone can appoint a scholar
//   THE JOIN     that every engineering projection of a structure points at a real, ACTIVE row in
//                the decision register
//
// WHAT IT CANNOT AND MUST NOT VERIFY: whether any ruling is substantively correct, whether a
// structure conforms to the ruling it cites, or whether anything is permissible. A GREEN GATE OVER
// A WRONG RULING IS POSSIBLE BY DESIGN — SCHOLARS DECIDE SHARI'AH, not this file, and a version of
// this gate that appeared to rule on permissibility would be a defect, not a feature. It reads
// JSON records; it never watches a committee sit, never sees an appointment instrument, and cannot
// tell a genuine approval reference from a well-formed invention. "Structure-conformant" is the
// most this plane ever claims, and this gate does not even claim that — it checks the records that
// a claim would have to rest on.
//
// What it refuses, in order of how badly each ends:
//
//   SG-R00  a compiled plan requires the capability and there is no register at all
//   SG-R01  a committee below the CONFIGURED minimum composition, whose "approval" is not the
//           committee's however many people signed it. The floor is MOUNTED DATA with a shipped
//           default (see DEFAULT_MINIMUM_MEMBERS) — this gate counts seats against a number the
//           adopter can set, and states no jurisdiction's law
//   SG-R02  a seat that does not resolve to a HUMAN holding the committee role in the registry:
//           the register and the registry may not disagree about who sits
//   SG-R03  a seat whose provenance fields are missing or still adoption markers — an untouched
//           template must never read as an appointment
//   SG-R04  a quorum that is absent (so one member's opinion passes as the body's decision), below
//           a majority of the seats, or larger than the number of holders (an outage wearing rigour)
//   SG-R05  a SHADOW SCHOLAR: a registry holder of the committee role with no seat in the disclosed
//           register — someone who can sign approvals from outside the body
//   SG-R06  internal Shari'ah audit outsourced, in fact or in wording. It may not be.
//   SG-R07  a Shari'ah Compliance Function or internal-audit head who does not resolve to a human
//           holding the matching role
//   SG-R08  a structure in the engineering tree citing a decision that does not exist, or is no
//           longer active — the projection of a ruling nobody made, or of one that was replaced
//
// TWO REGISTERS, ONE DECISION. docs/governance/shariah-rulings.json is the DECISION record;
// docs/governance/shariah-structures/ is the engineering PROJECTION of a decision. Two registers
// that can disagree about what the committee approved is exactly the ambiguity SG-R08 closes. Where
// the rulings register is absent — OR where there is nothing to join at all, no structures tree or
// an empty one — the join is reported NOT VERIFIED: a notice, never a silent pass, because "nothing
// checked it" and "it checked out" must not look the same, and the catalogued objective claims
// coverage of a binding that an absent tree does not supply.
//
// MANDATORY-WHEN-COMPILED. Inert — no findings, no notices — for any repository whose compiled
// plans do not require `shariah_governance`; only an Islamic product or institution profile
// compiles it. A conventional adopter must NEVER be failed by a Shari'ah control. The moment a
// plan does require the capability, an absent register is a finding that names the change asking.
//
// Lane: pr. Run from the repo root: `node scripts/shariah-governance-check.mjs` (exit 1 on a finding).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry, quorumFor } from './identity-registry-check.mjs';

export const CAPABILITY = 'shariah_governance';
export const REGISTER_LOCATIONS = ['docs/governance/issc-register.json', 'issc-register.json'];
export const RULINGS_LOCATIONS = ['docs/governance/shariah-rulings.json', 'shariah-rulings.json'];
export const STRUCTURES_DIRS = ['docs/governance/shariah-structures', 'shariah-structures'];
/**
 * THE COMPOSITION FLOOR IS MOUNTED DATA WITH A SHIPPED DEFAULT — never a universal legal fact.
 *
 * Committee-size minima are set per regime. Five is the internal-committee floor in the regime this
 * harness was extracted from (CBUAE Shari'ah Governance Standard for Islamic Financial Institutions,
 * 2020); other regimes and standard-setters set it lower — three is common. A gate that hard-coded
 * five and told every adopter a smaller committee "cannot lawfully sit" would be stating ONE market's
 * rule as law from inside a generic harness, which is the defect this indirection exists to prevent:
 * hardcoded gate LOGIC, mounted DATA. An adopter under a different regime sets `minimum_members` in
 * the register and names the instrument in `minimum_members_source`; the gate then counts against
 * THEIR number and quotes it back. Counting seats is all this is — it is not a ruling on any
 * jurisdiction's law, and a register that clears its floor has cleared a number, not a regulator.
 */
export const DEFAULT_MINIMUM_MEMBERS = 5;
export const DEFAULT_MINIMUM_SOURCE = 'shipped default: CBUAE Shari\'ah Governance Standard for Islamic Financial Institutions, 2020';
export const COMMITTEE_ROLE = 'shariah-committee';
export const SCF_ROLE = 'shariah-compliance';
export const AUDIT_ROLE = 'shariah-audit';
export const SEAT_PROVENANCE_FIELDS = ['hsa_approval_ref', 'appointment_instrument', 'appointment_date'];
export const ACTIVE_STATUS = 'active';

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field, or a ref that names nothing. A shipped template is not a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^(ADOPT[\s:—-]|TODO|TBD|N\/?A$|none$|<)/i.test(v.trim());
const isNamed = (v) => nonEmpty(v) && !isPlaceholder(v);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const firstPath = (locs, cwd) => locs.map((p) => join(cwd, p)).find(existsSync) || null;
const plural = (n, one, many) => (n === 1 ? one : many);
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** Roles as an array; null where the field is present but is not one (a role list that is not a list). */
const rolesOf = (who) => (who?.roles === undefined || who?.roles === null ? [] : Array.isArray(who.roles) ? who.roles : null);

/**
 * The composition floor this register is checked against: `{ minimum, source, findings }`.
 *
 * The number is the ADOPTER'S (`minimum_members`), falling back to the shipped default. Two things
 * are refused rather than absorbed, because both turn the floor into whatever the last editor typed:
 * a `minimum_members` that is not a whole number of seats, and one that LOWERS the shipped default
 * without naming the instrument that sets it. In both cases the shipped default stands, so a
 * malformed or unattributed override cannot quietly relax the check.
 */
export function compositionFloor(register) {
  const declared = register?.minimum_members;
  const source = register?.minimum_members_source;
  const shipped = { minimum: DEFAULT_MINIMUM_MEMBERS, source: DEFAULT_MINIMUM_SOURCE, findings: [] };
  if (declared === undefined || declared === null) return shipped;
  if (!Number.isInteger(declared) || declared < 1) {
    shipped.findings.push(`SG-R01: minimum_members is ${JSON.stringify(declared)}, which is not a whole number of seats — a floor that cannot be compared against a count is not a floor, so the ${DEFAULT_MINIMUM_MEMBERS}-seat ${DEFAULT_MINIMUM_SOURCE} stands until it is corrected`);
    return shipped;
  }
  if (declared < DEFAULT_MINIMUM_MEMBERS && !isNamed(source)) {
    shipped.findings.push(`SG-R01: minimum_members lowers the composition floor to ${declared} from the shipped default of ${DEFAULT_MINIMUM_MEMBERS} and minimum_members_source names no instrument (${JSON.stringify(source)}) — a floor moved down by an unattributed number is a number somebody typed. Name the regime and edition that sets it; until then the shipped default stands`);
    return shipped;
  }
  return { minimum: declared, source: isNamed(source) ? source : 'declared in the register', findings: [] };
}

/**
 * Findings (fail) and notices (never do) over the parsed composition register.
 *
 * `registry` is the identity registry (null ⇒ nothing resolves, and that is itself a finding rather
 * than a quiet skip: a register of names nobody can resolve is free text with a schema).
 * `rulings` is the parsed decision register, or null for "no register present" — the difference
 * between an unresolvable citation and an unverifiable one, which the join reports differently.
 * `structures` is the flattened structures tree, or null where the repository has none.
 */
export function evaluate({ register, registry = null, rulings = null, structures = null } = {}) {
  const findings = [];
  const notices = [];
  // MALFORMED GOVERNANCE JSON IS ORDINARY, and a stack trace out of a gate is fail-closed but tells
  // an operator nothing. Every shape the rest of this function relies on is established once, here,
  // and anything else becomes a finding that names the file and the field.
  const rawIdentities = Array.isArray(registry?.identities) ? registry.identities : null;
  const identities = rawIdentities ? rawIdentities.filter(isObject) : [];
  const canResolve = Boolean(registry) && rawIdentities !== null;
  const resolvable = canResolve ? { ...registry, identities } : null;
  if (!registry) {
    findings.push('SG-R02: no identity registry to resolve the Shari\'ah seats against — an ISSC register whose members resolve to nothing is a list of names, and a name is not an approver (see governance/identities.template.json)');
  } else if (rawIdentities === null) {
    findings.push(`SG-R02: the identity registry carries no \`identities\` array (${JSON.stringify(registry.identities)}) — nothing in it can be resolved, so every seat below is an unchecked name`);
  } else if (identities.length !== rawIdentities.length) {
    findings.push(`SG-R02: the identity registry carries ${rawIdentities.length - identities.length} ${plural(rawIdentities.length - identities.length, 'entry that is', 'entries that are')} not an identity object — an entry this gate cannot read is a holder it cannot see, and an unseen holder of ${COMMITTEE_ROLE} is exactly the shadow SG-R05 exists to catch`);
  }

  /* ── SG-R01/R02/R03 — the seats ─────────────────────────────────────────────────────────── */
  const floor = compositionFloor(register);
  findings.push(...floor.findings);
  const members = Array.isArray(register?.members) ? register.members : null;
  if (!members) {
    findings.push(`SG-R01: the ISSC register carries no \`members\` array — a composition register with no composition answers the one question it exists to answer with silence, and the quorum is then checked against nothing`);
  } else {
    if (members.length < floor.minimum) {
      findings.push(`SG-R01: the register carries ${members.length} ${plural(members.length, 'seat', 'seats')} against a composition minimum of ${floor.minimum} (${floor.source}) — a body below the minimum it is held to is not the committee whose approval is attributed to it, however many people signed. This gate counts seats against configured data and rules on no jurisdiction's law: where your regime sets a different floor, declare minimum_members and name the instrument in minimum_members_source`);
    }
    const seen = new Set();
    for (const m of members) {
      const id = m?.identity_id;
      const label = nonEmpty(id) ? id : '(unnamed seat)';
      if (!nonEmpty(id)) {
        findings.push('SG-R02: a seat names no identity_id — an empty seat still counts toward the composition, which is how a committee of four is made to look like five');
      } else {
        if (seen.has(id)) {
          findings.push(`SG-R02: ${id} occupies two seats — one person counted twice inflates the composition: ${members.length} ${plural(members.length, 'seat is', 'seats are')} not ${members.length} ${plural(members.length, 'person', 'people')}, which is how a register clears a minimum it does not meet`);
        }
        seen.add(id);
        if (canResolve) {
          const who = identityOf(resolvable, id);
          if (!who) {
            findings.push(`SG-R02: seat ${id} does not resolve in the identity registry — the two files may not disagree about who sits, and an unresolvable member cannot be the person whose approval was counted`);
          } else {
            if (who.kind !== 'human') {
              findings.push(`SG-R02: seat ${id} is an ${who.kind} identity — agents prepare evidence and never approve; scholars decide Shari'ah, and a committee seat is a person`);
            }
            const roles = rolesOf(who);
            // roles === null (a role list that is not a list) is reported ONCE, in the registry scan
            // below — per-seat repetition of the same malformed field adds noise, not information.
            if (roles !== null && !roles.includes(COMMITTEE_ROLE)) {
              findings.push(`SG-R02: seat ${id} does not hold ${COMMITTEE_ROLE} in the identity registry — approvals resolve against the registry, so a seat here that carries no role there is a member who cannot sign and a signer nobody appointed`);
            }
          }
        }
      }
      for (const field of SEAT_PROVENANCE_FIELDS) {
        const v = m?.[field];
        if (!nonEmpty(v)) {
          findings.push(`SG-R03: seat ${label} carries no ${field} — this is the trail an auditor follows from a signature back to an approved appointment, and a seat without it is an assertion that someone sits`);
        } else if (isPlaceholder(v)) {
          findings.push(`SG-R03: seat ${label}: ${field} is still an adoption marker (${JSON.stringify(v)}) — an untouched template must never read as an appointment`);
        }
      }
    }
  }

  /* ── SG-R04/R05 — quorum, and the body's edges ──────────────────────────────────────────── */
  if (canResolve) {
    for (const i of identities) {
      if (rolesOf(i) === null) {
        findings.push(`SG-R02: identity ${i.id} carries a \`roles\` field that is not an array (${JSON.stringify(i.roles)}) — this gate cannot tell whether they hold ${COMMITTEE_ROLE}, so a holder with no seat could hide behind the malformed field`);
      }
    }
    const holders = identities.filter((i) => i.kind === 'human' && (rolesOf(i) || []).includes(COMMITTEE_ROLE));
    const seats = members ? members.length : 0;
    const majority = Math.floor(seats / 2) + 1;
    const declared = registry.quorum?.[COMMITTEE_ROLE];
    if (!Number.isInteger(declared) || declared < 1) {
      findings.push(`SG-R04: the identity registry declares no quorum for ${COMMITTEE_ROLE} (got ${JSON.stringify(declared)}) — the default is ONE, and one member's signature is a member's opinion, never the committee's decision. Quorum lives in the identity registry so there is exactly one number to disagree about`);
    } else {
      const effective = quorumFor(registry, COMMITTEE_ROLE);
      if (seats > 0 && effective < majority) {
        findings.push(`SG-R04: the quorum for ${COMMITTEE_ROLE} is ${effective} of ${seats} ${plural(seats, 'seat', 'seats')}; a majority is ${majority} — a minority quorum lets the smaller half of a committee speak for the whole of it`);
      }
      if (declared > holders.length) {
        findings.push(`SG-R04: the quorum for ${COMMITTEE_ROLE} is ${declared} but only ${holders.length} human ${plural(holders.length, 'identity holds', 'identities hold')} the role — an unsatisfiable quorum blocks every Islamic change forever, which reads as rigour and functions as an outage`);
      }
    }
    if (members) {
      const seated = new Set(members.map((m) => m?.identity_id).filter(nonEmpty));
      for (const h of holders) {
        if (nonEmpty(h.id) && seated.has(h.id)) continue;
        findings.push(`SG-R05: ${nonEmpty(h.id) ? h.id : '(an identity carrying no id)'} holds ${COMMITTEE_ROLE} in the identity registry but occupies no seat in the ISSC register — a scholar who can sign approvals from outside the disclosed body is exactly the hole the register exists to close. Seat them, or remove the role`);
      }
    }
  }

  /* ── SG-R06 — internal Shari'ah audit may not be outsourced ─────────────────────────────── */
  const ia = register?.internal_audit;
  if (ia?.outsourced !== false) {
    findings.push(`SG-R06: internal_audit.outsourced is ${JSON.stringify(ia?.outsourced)} and must be literally false — internal Shari'ah audit MAY NOT be outsourced. Absent, "false" as a string, and "co-sourced" are the three ways that rule is broken while looking answered`);
  }
  if (canResolve && nonEmpty(ia?.lead_identity_id)) {
    const lead = identityOf(resolvable, ia.lead_identity_id);
    if (lead?.external === true) {
      findings.push(`SG-R06: internal_audit lead ${ia.lead_identity_id} is declared external:true in the identity registry — a co-sourced firm's partner in the third-line slot is the outsourcing the rule forbids, wearing an employee's label`);
    }
  }

  /* ── SG-R07 — the two standing desks ────────────────────────────────────────────────────── */
  for (const line of [
    { key: 'scf', role: SCF_ROLE, what: 'the Shari\'ah Compliance Function (second line, continuous monitoring)' },
    { key: 'internal_audit', role: AUDIT_ROLE, what: 'internal Shari\'ah audit (third line)' },
  ]) {
    const id = register?.[line.key]?.lead_identity_id;
    if (!isNamed(id)) {
      findings.push(`SG-R07: ${line.key}.lead_identity_id names nobody (${JSON.stringify(id)}) — ${line.what} with no named head is a box on an org chart, and the records it is supposed to file have no owner`);
      continue;
    }
    if (!canResolve) continue; // already reported once; per-desk repetition adds noise, not information
    const who = identityOf(resolvable, id);
    if (!who) {
      findings.push(`SG-R07: ${line.key} lead ${id} does not resolve in the identity registry — ${line.what} headed by an unresolvable name`);
      continue;
    }
    if (who.kind !== 'human') {
      findings.push(`SG-R07: ${line.key} lead ${id} is an ${who.kind} identity — ${line.what} is held by a person who can be asked what they found`);
    }
    const roles = rolesOf(who); // null ⇒ malformed, reported once in the registry scan above
    if (roles !== null && !roles.includes(line.role)) {
      findings.push(`SG-R07: ${line.key} lead ${id} does not hold ${line.role} in the identity registry — the desk and the role must be the same claim, or an approval demanding ${line.role} is satisfied by somebody this register never named`);
    }
  }

  /* ── SG-R08 — the two-registers join ────────────────────────────────────────────────────── */
  // Read this block as three separate questions, because collapsing them is how the objective came
  // to overstate the join: (1) which entries could not be read at all — findings, whatever else is
  // true; (2) is there anything to join — an absent or empty tree is NOT VERIFIED, not a pass, and
  // the catalogued objective claims a binding that nothing here supplied; (3) does each entry that
  // could be read resolve to an ACTIVE ruling.
  const rows = Array.isArray(structures) ? structures : [];
  for (const s of rows) {
    if (s?.unreadable) {
      findings.push(`SG-R08: structure ${s.label} is not readable JSON — an unparseable structure entry is not a bound one, and a gate that skipped it would report the binding as checked`);
    } else if (s?.malformed) {
      findings.push(`SG-R08: structure entry ${s.label} is not a shape this gate reads (${s.malformed}) — a structures file is one structure object, a \`structures\` array, or a top-level array of structures; anything else is UNCHECKED, and an unchecked entry that looked like a pass is the silence this rule exists to break`);
    }
  }
  const joinable = rows.filter((s) => s && !s.unreadable && !s.malformed);
  if (joinable.length === 0) {
    if (rows.length === 0) {
      notices.push(`the two-registers join is NOT VERIFIED: ${structures === null ? `there is no ${STRUCTURES_DIRS[0]}/ tree` : `${STRUCTURES_DIRS[0]}/ projects no structure entries`}, so nothing in this repository binds an engineering structure to a ruling. This is not a pass — the capability is compiled, and an empty tree is evidence that no structure is DECLARED here, never evidence that none is being built`);
    }
    // else: every entry is already a finding above, and a notice about them would restate it.
  } else if (rulings === null) {
    notices.push(`the two-registers join is NOT VERIFIED: ${joinable.length} structure ${plural(joinable.length, 'entry cites', 'entries cite')} an ISSC decision and there is no ${RULINGS_LOCATIONS[0]} to resolve them against. This is not a pass — nothing here has checked that the committee ever issued what these structures implement`);
  } else {
    const rulingRows = isObject(rulings) && Array.isArray(rulings.rulings) ? rulings.rulings : null;
    if (rulingRows === null) {
      findings.push(`SG-R08: ${RULINGS_LOCATIONS[0]} carries no \`rulings\` array (${Array.isArray(rulings) ? 'the file is a top-level array' : `\`rulings\` is ${JSON.stringify(rulings?.rulings)}`}) — the decision register is unreadable in the one shape every reader of it expects, so the ${joinable.length} citation${joinable.length === 1 ? '' : 's'} below resolve against nothing`);
    } else {
      const byId = new Map(rulingRows.filter((r) => nonEmpty(r?.ruling_id)).map((r) => [r.ruling_id, r]));
      for (const s of joinable) {
        const ref = s.issc_decision_ref;
        if (!isNamed(ref)) {
          findings.push(`SG-R08: structure ${s.label} names no issc_decision_ref (${JSON.stringify(ref)}) — a structure in the engineering tree with no ruling behind it is an implementation of nobody's decision`);
          continue;
        }
        const ruling = byId.get(ref);
        if (!ruling) {
          findings.push(`SG-R08: structure ${s.label} cites ISSC decision ${JSON.stringify(ref)}, which is no ruling_id in ${RULINGS_LOCATIONS[0]} — the rulings register is the DECISION record and this tree is the PROJECTION of a decision; a projection of nothing is precisely the ambiguity this join closes`);
          continue;
        }
        if (ruling.status !== ACTIVE_STATUS) {
          // superseded and withdrawn are not the same failure: one moved, the other is gone.
          const replacement = [...byId.values()].find((r) => r.supersedes === ref || (Array.isArray(r.supersedes) && r.supersedes.includes(ref)));
          const next = replacement
            ? ` ${replacement.ruling_id} replaces it — re-bind this structure to that ruling.`
            : ' Nothing in the register replaces it, so this structure is bound to a decision that no longer stands.';
          findings.push(`SG-R08: structure ${s.label} cites ruling ${ref}, whose status is ${JSON.stringify(ruling.status)}, not ${JSON.stringify(ACTIVE_STATUS)} —${next}`);
        }
      }
    }
  }

  return { findings, notices };
}

/** The change_ids whose compiled plans require the capability — so a finding can name WHO asked. */
export const requiringChanges = (agg) =>
  (agg?.changes || []).filter((c) => c.capabilities?.[CAPABILITY]?.required).map((c) => c.change_id);

/**
 * The structures tree, flattened to `[{ label, issc_decision_ref }]`, or null where absent.
 *
 * THREE shapes an adopter reaches for, all read: one structure per file, a file holding a
 * `structures` array, and a file that IS a top-level array. A fourth shape does not exist — anything
 * else comes back carrying `malformed` (or `unreadable`) and becomes an SG-R08 finding, because the
 * defect this replaced was exactly a silent one: a top-level array fell through the object branch,
 * contributed nothing, and a tree of unchecked structures was reported as a checked one. Comment-only
 * files (every key underscore-prefixed) are still skipped: a header is not a structure.
 */
export function loadStructures(cwd = process.cwd()) {
  const dir = firstPath(STRUCTURES_DIRS, cwd);
  if (!dir) return null;
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch (e) {
    // A file, a symlink to nowhere, an unreadable directory: the tree cannot be enumerated, which
    // is not the same as being empty and must not read as it.
    return [{ label: STRUCTURES_DIRS[0], malformed: `the structures location cannot be listed (${e.code || e.message})` }];
  }
  const out = [];
  for (const name of names) {
    const full = join(dir, name);
    let doc;
    try {
      if (!statSync(full).isFile()) continue;
      doc = JSON.parse(readFileSync(full, 'utf8'));
    } catch { out.push({ label: name, unreadable: true }); continue; }
    const rows = Array.isArray(doc) ? doc
      : isObject(doc) && Array.isArray(doc.structures) ? doc.structures
        : isObject(doc) ? [doc]
          : null;
    if (rows === null) { out.push({ label: name, malformed: `the file is ${doc === null ? 'null' : `a top-level ${typeof doc}`}, not a structure object or an array of them` }); continue; }
    rows.forEach((s, i) => {
      const at = rows.length > 1 ? `${name}#${i}` : name;
      if (!isObject(s)) { out.push({ label: at, malformed: `entry ${i} is ${Array.isArray(s) ? 'an array' : JSON.stringify(s)}, not a structure object` }); return; }
      if (Object.keys(s).every((k) => k.startsWith('_'))) return;
      out.push({ label: nonEmpty(s.structure_id) ? s.structure_id : at, issc_decision_ref: s.issc_decision_ref });
    });
  }
  return out;
}

export function run(cwd = process.cwd(), { agg = null } = {}) {
  const aggregate = agg || aggregateRequirements(cwd);
  const required = capabilityRequired(aggregate, CAPABILITY);
  const path = firstPath(REGISTER_LOCATIONS, cwd);
  // INERT. An institution with no Islamic product in flight is not failing this control — it is
  // not subject to it. Nothing is read, nothing is said, and that silence is the whole reason a
  // generic adopter can carry this gate at all.
  if (!required) return { inert: true, required: false, present: Boolean(path), members: 0, findings: [], notices: [] };

  const who = requiringChanges(aggregate);
  const asked = who.join(', ') || 'unknown change';
  if (!path) {
    return {
      inert: false, required, present: false, members: 0, notices: [],
      findings: [`SG-R00: a compiled plan requires the ${CAPABILITY} capability [${asked}] and there is no ${REGISTER_LOCATIONS[0]} — the route says an Islamic product is in flight and nothing in this repository says who the Shari'ah committee is, so no approval it carries can be attributed to a body`],
    };
  }
  const register = readJson(path);
  if (!register) {
    return { inert: false, required, present: true, members: 0, notices: [], findings: [`SG-R00: ${REGISTER_LOCATIONS[0]} is not valid JSON — an unreadable composition register is an absent one [${asked}]`] };
  }
  const rulingsPath = firstPath(RULINGS_LOCATIONS, cwd);
  const rulings = rulingsPath ? readJson(rulingsPath) : null;
  // loadRegistry parses without a net: an identities.json with a trailing comma would otherwise
  // throw a SyntaxError out of the gate. Fail closed AND legibly — nothing resolves, and the
  // operator is told which file to fix rather than handed a stack trace.
  let registry = null;
  let registryUnreadable = false;
  try { registry = loadRegistry(cwd); } catch { registryUnreadable = true; }
  const { findings, notices } = evaluate({
    register,
    registry,
    rulings,
    structures: loadStructures(cwd),
  });
  if (registryUnreadable) {
    // Replace the generic "no registry" line rather than adding to it: one cause, one finding.
    const specific = `SG-R02: the identity registry is present but is not valid JSON — every Shari'ah seat resolves against nothing, so the composition register is a list of names [${asked}]`;
    const generic = findings.findIndex((f) => f.startsWith('SG-R02: no identity registry'));
    if (generic >= 0) findings[generic] = specific; else findings.unshift(specific);
  }
  if (rulingsPath && rulings === null) {
    findings.unshift(`SG-R08: ${RULINGS_LOCATIONS[0]} is present but is not valid JSON — the decision register cannot be read, so every citation of it is unresolved rather than resolved`);
  }
  return {
    inert: false, required, present: true,
    members: Array.isArray(register.members) ? register.members.length : 0,
    findings, notices,
  };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { inert, findings, notices, members } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nShari\'ah governance gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThis gate checks COMPOSITION, PROVENANCE and BINDING records. It rules on no Shari\'ah\nquestion: scholars decide Shari\'ah, and a green gate over a wrong ruling is possible by design.\nSee governance/issc-register.template.json and governance/shariah-rulings.template.json.\n');
    process.exit(1);
  }
  if (inert) {
    process.stdout.write(`Shari'ah governance gate — inert (no compiled plan requires ${CAPABILITY}; nothing read)\n`);
    process.exit(0);
  }
  process.stdout.write(`Shari'ah governance gate — OK (${members} seat${members === 1 ? '' : 's'} recorded${notices.length ? `, ${notices.length} notice(s)` : ''}; composition and provenance only — no Shari'ah question is answered here)\n`);
}
