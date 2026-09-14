// The approvals surface (Factory Floor WS5 · D5.1). The approvals database and the PA approval
// page that a second-line approver actually reads: one section per COMPILED role, the evidence
// they judge on carried IN beside it, and a people-property that resolves to a registry identity
// through the P6 map rather than to whatever was typed.
//
// Three properties carry the design. Each one is the answer to a specific way an approval page
// goes wrong, and each is worth stating plainly.
//
// DERIVED, NEVER DRAWN. The sections come from the compiled control plan — `pa1Roles(plan)` for
// PA1, `required_approver_roles` for PA2 — and from nothing else. This is `core/floor-templates.mjs`'s
// discipline applied to an approval page: there, a guided form is generated from the git template
// so the form cannot ask for last month's shape; here, the page is generated from the plan so it
// cannot bind last month's roles. A hand-drawn approval page drifts from the plan silently, and
// the drift only surfaces when an approval is refused for a role NOBODY WAS ASKED ABOUT — which is
// the worst possible moment and the least legible failure. Note that PA1 and PA2 bind DIFFERENT
// role sets: the same page reused across both stages asks the wrong people at one of them.
// There is deliberately no clock here. Staleness is anchored on `plan_hash`, not on a timestamp:
// what matters is not when the page was built but WHICH compilation it was built from.
//
// EVIDENCE IS CARRIED IN, ASSEMBLED BY A FLOOR-KEEPER, NEVER BY THE APPROVER. An approver who
// assembles their own evidence pack is choosing what they are shown, and an approval over a
// self-selected pack is an opinion with a signature on it. So every field on this surface declares
// which side of that line it is on — `assembled_by` + `assembled_for` + `read_only` for the three
// evidence blocks (change summary · gate results · decision-log excerpt), `filled_by` +
// `writable_by` for the two the approver fills — and `verifyApprovalSurface` refuses a layout
// where those cross in either direction: an approver who can edit their evidence (AS-R05), or a
// floor-keeper who can write the decision (AS-R09). The second is the mirror of the first and just
// as fatal: the hand that assembles must not be the hand that records.
//
// THE PEOPLE-PROPERTY RESOLVES THROUGH P6. A name typed on a surface is not an identity. The
// approver property is a `people` property bound to `core/identity-map.mjs`'s join — surface person
// id → IdP subject → registry identity — and the surface has NO SHAPE for a free-text approver:
// `verifyApprovalSurface` refuses a text-typed approver, an approver field labelled `name` or
// `email` (§2.3: an address is a routing label an attacker can control), and a join whose pivot is
// anything but `idp_subject` (a workspace person id is reassignable).
//
// NON-AUTHORITATIVE, AND SAID WHERE IT IS READ. WS5's entry gate has NOT passed: it needs an
// independent second-line review of the workstream's design, and no such review exists. So the
// banner is verbatim, it sits on the page AND on every role section — a section is what gets
// screenshotted, pasted and quoted, not the page it sat on — and every section names where the
// real decision arrives: a signed envelope verified by `core/approval-attestations.mjs` and merged
// by a second-line human. A checkbox on a page is never an approval, and no gate reads this file.
//
// WHAT THIS DOES NOT DO, said out loud because its placement flatters it:
//
//   - It does not approve anything, and it does not make anything approvable. `product-approval-check.mjs`
//     remains the only thing that decides whether an approval resolves, and it reads git.
//   - It cannot enforce a permission on a vendor's surface. `writable_by: []` is a STATEMENT of the
//     layout the adopter must configure; whether the workspace actually withholds edit rights is a
//     platform grant, observed by an activation adapter, not a property of this file. WS6/D6.3 exists
//     because page-level grants are not property-level protection.
//   - It cannot tell whether the evidence a floor-keeper assembled is COMPLETE or HONEST. It checks
//     that the three blocks are present, assembled for this role, and not editable by the approver.
//     A truthful-looking but selective change summary passes every check here.
//   - It has no view of the identity map's contents. The join is DECLARED here and RESOLVED there;
//     an empty or stale map fails in `identity-map-check.mjs`, not on this page.
//
// Deliberately not a client of anything: no network, no clock, no vendor SDK, no token. The digest,
// canonical JSON and the authority-field list are imported from `core/floor-project.mjs` rather
// than copied — one list of the fields that make a screen look like the control, not two that drift.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AUTHORITY_FIELDS, canonical, sha256 } from './floor-project.mjs';
import { FORBIDDEN_FIELDS, IDENTITY_MAP_LOCATIONS } from './identity-map.mjs';
import { SECOND_LINE_ROLES, pa1Roles } from '../scripts/product-approval-check.mjs';

export const SCHEMA_ID = 'loom.floor-approval-surface/v1';

/** From `core/floor-templates.mjs`'s WRITE_CLASSES: authored on the floor, decided in git. */
export const WRITE_CLASS = 'decision-routed';

/** The two product-approval stages. They bind different role sets — that is the point. */
export const STAGES = ['PA1', 'PA2'];

/**
 * The one identity permitted to assemble evidence — a constant, not a parameter, for the reason
 * `PROJECTOR_IDENTITY` is one in `core/floor-project.mjs`: assembly under a single named identity
 * is a capability that can be probed as one thing. A configurable assembler is an assembler
 * somebody eventually configures to be the approver.
 */
export const KEEPER_IDENTITY = 'svc-floor-keeper';

/**
 * The label, verbatim, on the page and on every section. A constant rather than a parameter
 * because a configurable banner is a banner someone eventually configures away, and this is the
 * sentence that has to survive contact with a screenshot.
 */
export const NON_AUTHORITATIVE = 'NON-AUTHORITATIVE · DECLARED, NOT ACTIVE — WS5\'s entry gate has not passed: it needs an independent second-line review of this workstream\'s design, and that review does not exist. Nothing on this page approves anything. The approval is a signed envelope verified by core/approval-attestations.mjs and merged by a second-line human; recording a decision here routes it, and no gate reads this page.';

/** Where the real decision arrives. Every section carries it, because every section is read alone. */
export const DECISION_ROUTE = Object.freeze({
  via: 'core/approval-attestations.mjs',
  form: 'a signed envelope (loom.approval-attestation/v1) binding the human\'s assertion to the plan hash and the content digests, merged by a second-line human',
  note: 'Recording a decision here routes it; it does not make it. If this page and the merged envelope disagree, the envelope is the approval and this page is out of date.',
});

/**
 * The P6 join, as data. The pivot is the IdP subject — never the workspace person id (reassignable)
 * and never an address (a routing label a person can change and an attacker can control). Field
 * names are the identity map's own, because a join has to name the fields it reads.
 */
export const PEOPLE_JOIN = Object.freeze({
  join: 'identity-map-join',
  map: IDENTITY_MAP_LOCATIONS[0],
  registry: 'docs/governance/identities.json',
  via: 'notion_person_id',
  pivot: 'idp_subject',
  resolves_to: 'registry_id',
  note: 'The map is the authority and this property is a claim. An unmapped human is an unknown human: there is no nearest match, no resolution by name, and no override — the route past it is a merged PR that changes the map.',
});

/**
 * The evidence D5.1 names, carried IN. Three blocks, each assembled off-page by the floor-keeper
 * and read-only where the approver reads it.
 */
export const EVIDENCE_BLOCKS = Object.freeze([
  Object.freeze({
    key: 'change_summary',
    name: 'Change summary',
    source: 'docs/governance/changes/<change>/change-envelope.json',
    help: 'What is being approved, in the envelope\'s own terms: change type, risk tier, the discovery run it came from. Assembled, not written — an approver who summarises the change for themselves has approved their own reading of it.',
  }),
  Object.freeze({
    key: 'gate_results',
    name: 'Gate results',
    source: 'the gate run for the change\'s head commit (core/gate-runner.mjs)',
    help: 'Which gates ran, on which commit, and what each returned — including the ones that were skipped and why. A green summary with the skips removed is the failure this block exists to prevent.',
  }),
  Object.freeze({
    key: 'decision_log_excerpt',
    name: 'Decision-log excerpt',
    source: 'docs/governance/decision-log.json',
    help: 'What the agent decided on the way here, as the bounded summary the log carries. The rationale, the tool calls and the hash chain stay in git — a mirror of the chain would read as the chain.',
  }),
]);

/** The default vocabulary for the one field the approver records. Reworded by an adopter; guarded below. */
export const DECISION_OPTIONS = Object.freeze([
  'not started',
  'more evidence needed',
  'recorded — routed for signature',
  'declined — routed for signature',
]);

/**
 * Verdict language refused in a decision option. An option reading `approved` makes the page the
 * approval in the only place it matters — the reader's eye — however carefully the footer is
 * worded. `approver` is not matched: naming the person is not claiming the verdict.
 */
export const VERDICT_LANGUAGE = /\b(?:approved|approve|authoris(?:e|ed)|authoriz(?:e|ed)|signed[ -]off|sign[ -]off|granted|released?|production-authoriz(?:e|ed)|production-authoris(?:e|ed))\b/i;

/** Keys that would turn a page into a claim of authority, refused wherever they appear. */
export const CLAIM_KEYS = new Set(['decides', 'authoritative', 'binding', 'gate_input', 'grants', 'enforced']);

/**
 * The one asymmetry in the authority-field rule, and it is deliberate. `plan_hash` is an
 * authority field: mirrored onto a card beside a green tick it is indistinguishable from the
 * control that produced it, which is why `core/floor-project.mjs` refuses it inside a projected
 * RECORD. The surface ENVELOPE is not a card — it is build metadata, and the plan hash is what
 * makes this derivation checkable against the compilation it came from, exactly as
 * `source_digest` does in `core/floor-templates.mjs`. So the exemption is granted here, at the
 * envelope, and nowhere else: a SECTION — the thing an approver actually reads — carries no
 * authority field of any kind, with no exemptions and no allow-list to edit.
 */
export const ENVELOPE_ANCHORS = new Set(['plan_hash']);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** A label, reduced to the shape the forbidden-field list is written in. */
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** An approver field asked for as text — the shape that accepts a typed name. */
const APPROVER_TEXT = /^(?:approver|approved_by|approvers?_[a-z_]*|decision_maker|signatory|signed_by|who_approved)$/;

/**
 * Which roles a stage binds. PA1 is `pa1Roles(plan)` — the compiler's own answer, never re-derived
 * here, because two implementations of "which roles bind at PA1" is one more than the number of
 * answers a plan can have. PA2 binds every role the plan compiled.
 */
export function rolesFor(plan, stage) {
  if (stage === 'PA1') return pa1Roles(plan);
  if (stage === 'PA2') return [...new Set(plan?.required_approver_roles || [])].sort();
  return null;
}

/** The approver property for one role: a people-property, bound to the P6 join, and nothing else. */
export function peopleProperty(role) {
  return {
    name: 'Approver',
    type: 'people',
    required: true,
    free_text: false,
    role,
    filled_by: 'approver',
    writable_by: ['approver'],
    resolves_through: { ...PEOPLE_JOIN },
    help: `The person holding ${role}, resolved through the identity map. A typed name is not an identity and this property has no shape for one.`,
  };
}

/** One evidence block, assembled for one role. */
export function evidenceField(block, role) {
  return {
    name: block.name,
    kind: 'evidence',
    evidence: block.key,
    source: block.source,
    read_only: true,
    assembled_by: KEEPER_IDENTITY,
    assembled_for: role,
    writable_by: [],
    help: block.help,
  };
}

/** One section per compiled role: the evidence carried in, the two fields the approver fills. */
export function roleSection(role) {
  return {
    role,
    name: `Approval · ${role}`,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    decision_arrives_as: { ...DECISION_ROUTE },
    second_line: SECOND_LINE_ROLES.has(role),
    assembled_by: KEEPER_IDENTITY,
    approver: peopleProperty(role),
    evidence: EVIDENCE_BLOCKS.map((b) => evidenceField(b, role)),
    fields: [
      {
        name: 'Recorded decision',
        type: 'select',
        required: true,
        options: [...DECISION_OPTIONS],
        filled_by: 'approver',
        writable_by: ['approver'],
        help: 'What this approver decided, as something to be routed. The wording is deliberate: nothing here is an approval until the envelope is merged.',
      },
      {
        name: 'Reasoning',
        type: 'rich_text',
        required: true,
        filled_by: 'approver',
        writable_by: ['approver'],
        help: 'Why — against the evidence carried in above, which is the evidence of record for this decision. If the pack is insufficient, that is a decision too: ask for more, do not go and find it.',
      },
    ],
    note: SECOND_LINE_ROLES.has(role)
      ? `${role} is a second-line role: a builder may not fill it. That separation is enforced where it can be — in git, by scripts/product-approval-check.mjs — and cannot be enforced by this page.`
      : null,
  };
}

/**
 * Derive the surface for one stage of one compiled plan.
 *
 * Returns { surface, findings, notices }. `surface` is null when there are findings: a page that
 * cannot say which compilation it binds, or that binds a stage the plan did not compile, is not
 * published in a reduced form — an approval page for a gate nothing will check is worse than no
 * page, because someone will fill it in.
 */
export function deriveApprovalSurface(plan, { stage = 'PA1' } = {}) {
  const findings = [];
  if (!STAGES.includes(stage)) findings.push(`AS-R10: stage ${JSON.stringify(stage)} is not one of ${STAGES.join(' | ')} — an approval surface belongs to a product-approval gate or to nothing`);
  if (!isObj(plan) || !isStr(plan.change_id)) findings.push('AS-R10: no compiled control plan with a change_id — this surface is DERIVED from the plan, and there is nothing here to derive it from');
  else if (STAGES.includes(stage) && !(plan.required_gates || []).includes(stage)) {
    findings.push(`AS-R10: ${plan.change_id}: the plan does not compile ${stage} (gates: ${(plan.required_gates || []).join(', ') || 'none'}) — a page for a gate nobody compiled asks people to approve something no gate will read`);
  }
  if (findings.length) return { surface: null, findings, notices: [] };

  const roles = rolesFor(plan, stage);
  if (!roles.length) {
    return { surface: null, findings: [`AS-R10: ${plan.change_id} · ${stage}: the plan compiles no approver role for this stage — there is nothing to bind, and an empty approval page reads as an approved one`], notices: [] };
  }

  const notices = [];
  const other = stage === 'PA1' ? 'PA2' : 'PA1';
  const otherRoles = rolesFor(plan, other) || [];
  if (otherRoles.length !== roles.length) {
    notices.push(`${stage} binds ${roles.length} role(s); ${other} binds ${otherRoles.length}. The two stages bind DIFFERENT sets — one page reused across both asks the wrong people at one of them.`);
  }
  const secondLine = roles.filter((r) => SECOND_LINE_ROLES.has(r));
  if (secondLine.length) {
    notices.push(`${secondLine.length} of these sections are second-line (${secondLine.join(', ')}): a builder may not fill them. That is checked in git, never here.`);
  }

  const surface = {
    _comment: 'GENERATED by core/floor-approval-surface.mjs from the compiled control plan — do not hand-edit. NON-AUTHORITATIVE: nothing here approves anything, and no gate reads this file. Regenerate when the plan recompiles; scripts/approval-surface-check.mjs fails when this file and the plan disagree, so the page cannot bind a role set the plan no longer compiles.',
    schema: SCHEMA_ID,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    write_class: WRITE_CLASS,
    stage,
    change_id: plan.change_id,
    plan_hash: plan.plan_hash ?? null,
    decision_arrives_as: { ...DECISION_ROUTE },
    assembled_by: KEEPER_IDENTITY,
    evidence_note: 'Every evidence block on this page is assembled by the floor-keeper and read-only to the approver. An approver who assembles their own pack has chosen what they are shown.',
    roles: [...roles],
    sections: roles.map(roleSection),
  };
  surface.digest = digestOf(surface);
  return { surface, findings: [], notices };
}

/** The surface's digest over everything but itself. Same plan, same bytes, same digest. */
export function digestOf(surface) {
  const { digest, ...rest } = surface || {};
  return sha256(canonical(rest));
}

// --- refusing a surface that is not one -----------------------------------------------------------

/**
 * The gate over a surface, whoever built it. `deriveApprovalSurface` cannot emit a bad one; this is
 * what catches the ones it did not build — a page drawn by hand in a workspace, a definition from a
 * newer derivation, a section added for a role somebody thought ought to be involved.
 *
 * Rejection codes:
 *   AS-R01  unlabelled — no schema, `authority` ≠ "none", banner missing or altered (page or
 *           section), wrong write class, or no statement of where the real decision arrives
 *   AS-R02  the surface claims authority — an authority-shaped field, a claim key, or a decision
 *           option written in verdict language
 *   AS-R03  a compiled role has no section (or there is no plan to check coverage against)
 *   AS-R04  a section for a role the plan did not compile
 *   AS-R05  approver-supplied evidence — an evidence block the approver can write, or one
 *           assembled by anyone but the floor-keeper
 *   AS-R06  a free-text approver — not a people-property, or a field that asks for a name
 *   AS-R07  a people-property that does not resolve through the P6 join
 *   AS-R08  a required evidence block missing, or assembled for a different role
 *   AS-R09  the assembler decides — a floor-keeper who can write what the approver records
 *   AS-R10  incoherent — unknown stage, a stage the plan did not compile, a stale plan_hash, a
 *           digest that does not match, duplicate or missing sections
 */
export function verifyApprovalSurface(surface, plan, label = 'approval surface') {
  if (!isObj(surface)) return [`AS-R01: ${label}: not an object — there is nothing here to label, and an unlabelled approval page is read as the approval`];
  const findings = [];

  if (surface.schema !== SCHEMA_ID) findings.push(`AS-R01: ${label}: schema ${JSON.stringify(surface.schema)} is not ${SCHEMA_ID} — an unversioned surface cannot be read, and what cannot be read cannot be shown to be non-authoritative`);
  if (surface.authority !== 'none') findings.push(`AS-R01: ${label}: authority is ${JSON.stringify(surface.authority)}, not "none" — an approval page carries none until WS5's entry gate passes, and even then the envelope carries it, not the page`);
  if (surface.banner !== NON_AUTHORITATIVE) findings.push(`AS-R01: ${label}: the non-authoritative banner is missing or altered — it is verbatim or it is a finding. This sentence is the only thing standing between a tidy approval page and a decision nobody signed`);
  if (surface.write_class !== WRITE_CLASS) findings.push(`AS-R01: ${label}: write_class is ${JSON.stringify(surface.write_class)}, not ${JSON.stringify(WRITE_CLASS)} — the decision is authored here and made in git; any other class mis-states that to the person reading it`);
  findings.push(...checkRoute(surface.decision_arrives_as, label));
  findings.push(...checkAuthorityShape(surface, label, ENVELOPE_ANCHORS));
  if (surface.assembled_by !== KEEPER_IDENTITY) findings.push(`AS-R05: ${label}: assembled_by is ${JSON.stringify(surface.assembled_by)}, not ${KEEPER_IDENTITY} — evidence is assembled under one named identity so that capability can be probed as one thing`);

  if (!STAGES.includes(surface.stage)) findings.push(`AS-R10: ${label}: stage ${JSON.stringify(surface.stage)} is not one of ${STAGES.join(' | ')}`);
  if (surface.digest !== undefined && surface.digest !== digestOf(surface)) {
    findings.push(`AS-R10: ${label}: the digest does not match the content — this is not the surface that was derived`);
  }

  if (!Array.isArray(surface.sections)) {
    findings.push(`AS-R10: ${label}: no sections array — an approval page with no sections and a broken one must not look alike`);
    return findings;
  }

  const seen = new Map();
  for (const [i, s] of surface.sections.entries()) {
    const at = `${label} · section[${i}]${isStr(s?.role) ? ` (${s.role})` : ''}`;
    findings.push(...verifySection(s, at));
    if (!isStr(s?.role)) continue;
    if (seen.has(s.role)) findings.push(`AS-R10: ${at}: a second section for ${s.role} — two places to record one role's decision means one of them is not the record`);
    else seen.set(s.role, i);
  }

  // Coverage. Derived means derived: the section list is the plan's role list, and nothing else.
  if (!isObj(plan)) {
    findings.push(`AS-R03: ${label}: no compiled control plan supplied — "one section per compiled role" cannot be checked against nothing, and a surface nobody checked against a plan is a hand-drawn one`);
    return findings;
  }
  if (isStr(plan.change_id) && surface.change_id !== plan.change_id) {
    findings.push(`AS-R10: ${label}: names change ${JSON.stringify(surface.change_id)} but was checked against ${JSON.stringify(plan.change_id)}`);
  }
  if (plan.plan_hash && surface.plan_hash && surface.plan_hash !== plan.plan_hash) {
    findings.push(`AS-R10: ${label}: derived from plan_hash ${JSON.stringify(surface.plan_hash)}, but the plan now compiles ${JSON.stringify(plan.plan_hash)} — the page binds a role set that is no longer the plan's. Regenerate it; a stale approval page is how a role nobody was asked about gets discovered at the gate`);
  }
  if (!STAGES.includes(surface.stage)) return findings;
  if (!(plan.required_gates || []).includes(surface.stage)) {
    findings.push(`AS-R10: ${label}: the plan does not compile ${surface.stage} (gates: ${(plan.required_gates || []).join(', ') || 'none'}) — this page collects decisions no gate will read`);
  }

  const required = rolesFor(plan, surface.stage) || [];
  for (const role of required) {
    if (!seen.has(role)) findings.push(`AS-R03: ${label}: no section for compiled role ${role} — the plan binds it at ${surface.stage} and this page never asks. The refusal then arrives at the gate, for a role nobody was asked about`);
  }
  for (const role of seen.keys()) {
    if (!required.includes(role)) {
      findings.push(`AS-R04: ${label}: a section for ${role}, which the plan does not compile at ${surface.stage} (compiled: ${required.join(', ') || 'none'}) — a page that invents an approver teaches the institution a role set the compiler never agreed to, and an approval recorded there evidences nothing`);
    }
  }
  return findings;
}

/** Findings for one role section. */
export function verifySection(section, label = 'section') {
  if (!isObj(section)) return [`AS-R10: ${label}: not an object`];
  const findings = [];
  if (!isStr(section.role)) findings.push(`AS-R10: ${label}: names no role — a section that cannot say whose decision it collects collects nobody's`);
  if (section.authority !== 'none') findings.push(`AS-R01: ${label}: authority is ${JSON.stringify(section.authority)}, not "none" — the label lives on every section, because a section is what gets screenshotted, pasted and quoted, not the page it sat on`);
  if (section.banner !== NON_AUTHORITATIVE) findings.push(`AS-R01: ${label}: the non-authoritative banner is missing or altered — an approver reads their own section, not the page header`);
  findings.push(...checkRoute(section.decision_arrives_as, label));
  findings.push(...checkAuthorityShape(section, label));
  if (section.assembled_by !== KEEPER_IDENTITY) {
    findings.push(`AS-R05: ${label}: assembled_by is ${JSON.stringify(section.assembled_by)}, not ${KEEPER_IDENTITY} — the evidence in a section is assembled by a floor-keeper, never by the approver reading it`);
  }

  findings.push(...checkApprover(section.approver, section.role, label));

  // The evidence carried in: present, assembled for THIS role, and out of the approver's reach.
  const evidence = Array.isArray(section.evidence) ? section.evidence : [];
  if (!Array.isArray(section.evidence)) {
    findings.push(`AS-R08: ${label}: no evidence array — "evidence carried in" is the whole of D5.1; a section without it asks for a decision on whatever the approver happens to know`);
  }
  const byKey = new Map();
  for (const [i, e] of evidence.entries()) {
    const at = `${label} · evidence[${i}]${isStr(e?.evidence) ? ` (${e.evidence})` : ''}`;
    if (!isObj(e)) { findings.push(`AS-R08: ${at}: not an object`); continue; }
    byKey.set(e.evidence, e);
    if (e.read_only !== true) findings.push(`AS-R05: ${at}: not read_only — an evidence block the approver can edit is an evidence block the approver assembled`);
    if (e.assembled_by !== KEEPER_IDENTITY) findings.push(`AS-R05: ${at}: assembled_by is ${JSON.stringify(e.assembled_by)}, not ${KEEPER_IDENTITY}`);
    if (e.filled_by !== undefined) findings.push(`AS-R05: ${at}: carries filled_by ${JSON.stringify(e.filled_by)} — evidence is ASSEMBLED, not filled in. The two words are the control: one names a hand off the page, the other names the person deciding`);
    if (!Array.isArray(e.writable_by) || e.writable_by.length > 0) {
      findings.push(`AS-R05: ${at}: writable_by is ${JSON.stringify(e.writable_by)} — an evidence block is writable by nobody on this surface. If it is wrong, the pack is reassembled; it is not corrected in place by the person judging it`);
    }
    if (isStr(section.role) && e.assembled_for !== section.role) {
      findings.push(`AS-R08: ${at}: assembled_for is ${JSON.stringify(e.assembled_for)}, not ${JSON.stringify(section.role)} — an approver shown a pack assembled for someone else is judging someone else's question`);
    }
    findings.push(...checkFieldLabel(e.name, at));
  }
  for (const b of EVIDENCE_BLOCKS) {
    if (!byKey.has(b.key)) {
      findings.push(`AS-R08: ${label}: no ${b.key} evidence block — D5.1 carries in the change summary, the gate results AND the decision-log excerpt. A missing block is not a smaller pack, it is an approver filling the gap from memory`);
    }
  }

  // The fields the approver fills. The mirror of AS-R05: the hand that assembles must not decide.
  const fields = Array.isArray(section.fields) ? section.fields : [];
  if (!Array.isArray(section.fields)) findings.push(`AS-R10: ${label}: no fields array — a section with nothing for the approver to record is not an approval section`);
  let decisions = 0;
  for (const [i, f] of fields.entries()) {
    const at = `${label} · field[${i}]${isStr(f?.name) ? ` (${f.name})` : ''}`;
    if (!isObj(f)) { findings.push(`AS-R10: ${at}: not an object`); continue; }
    findings.push(...checkFieldLabel(f.name, at));
    if (f.kind === 'evidence' || f.evidence !== undefined) {
      findings.push(`AS-R05: ${at}: an evidence block sitting among the approver's own fields — evidence is carried in beside the decision, never collected with it`);
    }
    if (f.filled_by !== 'approver') {
      findings.push(`AS-R09: ${at}: filled_by is ${JSON.stringify(f.filled_by)}, not "approver" — this is what the approver records. A field the floor-keeper fills is the assembler deciding, which is the same defect as approver-assembled evidence read from the other end`);
    }
    findings.push(...checkWritableByApproverOnly(f.writable_by, at));
    if (f.type === 'select') {
      decisions++;
      for (const o of Array.isArray(f.options) ? f.options : []) {
        if (VERDICT_LANGUAGE.test(String(o))) {
          findings.push(`AS-R02: ${at}: the option ${JSON.stringify(o)} is written as a verdict — on this page a decision is RECORDED and ROUTED, and an option reading like an approval makes the page the approval in the only place that matters, which is the reader's eye`);
        }
      }
    }
  }
  if (Array.isArray(section.fields) && decisions === 0) {
    findings.push(`AS-R10: ${label}: no select field for the approver's decision — a section that carries evidence and collects nothing is a reading exercise`);
  }
  return findings;
}

/** The approver property: a people-property, resolving through P6, with no room for a typed name. */
function checkApprover(approver, role, label) {
  if (!isObj(approver)) return [`AS-R06: ${label}: no approver property — a section that does not say who decides accepts anyone who types`];
  const findings = [];
  if (approver.type !== 'people') {
    findings.push(`AS-R06: ${label} · approver: type is ${JSON.stringify(approver.type)}, not "people" — a name typed into a text field is not an identity, and this surface has no shape for one`);
  }
  if (approver.free_text !== false) {
    findings.push(`AS-R06: ${label} · approver: free_text is ${JSON.stringify(approver.free_text)} — it is \`false\` or it is a finding. A people-property that also accepts a new name accepts an unmapped human`);
  }
  if (isStr(role) && approver.role !== role) {
    findings.push(`AS-R06: ${label} · approver: bound to role ${JSON.stringify(approver.role)} in a section for ${JSON.stringify(role)} — the property must name the role it resolves for, or it resolves for whoever is asked`);
  }
  findings.push(...checkFieldLabel(approver.name, `${label} · approver`));
  findings.push(...checkWritableByApproverOnly(approver.writable_by, `${label} · approver`));

  const j = approver.resolves_through;
  if (!isObj(j)) {
    findings.push(`AS-R07: ${label} · approver: no resolves_through — a people-property that resolves through nothing resolves to a workspace account, and a workspace account is reassignable`);
    return findings;
  }
  if (j.join !== PEOPLE_JOIN.join) findings.push(`AS-R07: ${label} · approver: join is ${JSON.stringify(j.join)}, not ${JSON.stringify(PEOPLE_JOIN.join)} — the P6 map is the only join that turns a bound subject into a proven one`);
  if (j.pivot !== PEOPLE_JOIN.pivot) {
    findings.push(`AS-R07: ${label} · approver: pivot is ${JSON.stringify(j.pivot)}, not ${JSON.stringify(PEOPLE_JOIN.pivot)} — the pivot is the identity-provider subject. A workspace person id is reassignable and an address is a routing label; neither is an identity, and comparing addresses is refused at review, not at runtime`);
  }
  if (j.map !== PEOPLE_JOIN.map) findings.push(`AS-R07: ${label} · approver: map is ${JSON.stringify(j.map)}, not ${JSON.stringify(PEOPLE_JOIN.map)} — the second-line-owned map, or nothing`);
  if (j.resolves_to !== PEOPLE_JOIN.resolves_to) findings.push(`AS-R07: ${label} · approver: resolves_to is ${JSON.stringify(j.resolves_to)}, not ${JSON.stringify(PEOPLE_JOIN.resolves_to)} — the join ends at a registry identity or it ends nowhere a gate can read`);
  for (const f of FORBIDDEN_FIELDS) {
    if (f in j) findings.push(`AS-R07: ${label} · approver: the join carries \`${f}\` — the map has no field for it, and a join that can compare display names or addresses will be made to`);
  }
  return findings;
}

/** Where the real decision arrives — on the page and in every section. */
function checkRoute(route, label) {
  if (!isObj(route)) return [`AS-R01: ${label}: no decision_arrives_as — the surface must say where the real decision arrives, in the place an approver actually reads. A page that omits it is read as the decision`];
  if (route.via !== DECISION_ROUTE.via) {
    return [`AS-R01: ${label}: decision_arrives_as.via is ${JSON.stringify(route.via)}, not ${JSON.stringify(DECISION_ROUTE.via)} — the decision arrives as a signed envelope, never as a checkbox on a page`];
  }
  return [];
}

/**
 * Nothing on this surface may be shaped like the control it is not. `allow` is the envelope's
 * build-anchor exemption (see ENVELOPE_ANCHORS) and is passed for the surface envelope only —
 * every section is checked with no exemption at all.
 */
function checkAuthorityShape(node, label, allow = new Set()) {
  const findings = [];
  for (const k of Object.keys(node)) {
    if (AUTHORITY_FIELDS.has(k) && !allow.has(k)) {
      findings.push(`AS-R02: ${label}: \`${k}\` would read as governance authority on a surface that has none — the cryptography that makes an approval an approval stays in the envelope, and a copy of it on a page is indistinguishable on screen from the thing itself`);
    }
    if (CLAIM_KEYS.has(k)) {
      findings.push(`AS-R02: ${label}: \`${k}\` claims this surface decides, gates or grants something. It does not, and WS5's entry gate has not passed`);
    }
  }
  return findings;
}

/** A field label that asks for a person by name, an address, or a routing label. */
function checkFieldLabel(name, label) {
  const s = slug(name);
  if (!s) return [`AS-R10: ${label}: no name — an unnamed field on an approval page is a field nobody can be asked about`];
  if (FORBIDDEN_FIELDS.includes(s)) {
    return [`AS-R06: ${label}: the field ${JSON.stringify(name)} asks for a \`${s}\` — a display name, a title or an address is a routing label, not an identity. Ask through the people-property, which resolves, or do not ask`];
  }
  if (APPROVER_TEXT.test(s) && s !== 'approver') {
    return [`AS-R06: ${label}: the field ${JSON.stringify(name)} is a second place to say who approved — a form that offers a text field beside the people-property will be given a typed name, and a typed name resolves to nobody`];
  }
  if (VERDICT_LANGUAGE.test(String(name))) {
    return [`AS-R02: ${label}: the field ${JSON.stringify(name)} is named as a verdict — a field label is read before any banner, and one that says "sign-off" has told the reader this page grants something`];
  }
  return [];
}

/** The approver's own fields are writable by the approver and by nobody else — least of all the keeper. */
function checkWritableByApproverOnly(writableBy, label) {
  if (!Array.isArray(writableBy)) {
    return [`AS-R09: ${label}: writable_by is ${JSON.stringify(writableBy)} — a field that does not say who may write it is a field anyone may write, including the service that assembled the evidence`];
  }
  const findings = [];
  for (const w of writableBy) {
    if (w === 'approver') continue;
    findings.push(w === KEEPER_IDENTITY
      ? `AS-R09: ${label}: writable_by includes ${KEEPER_IDENTITY} — the hand that assembles the evidence must not be the hand that records the decision. A floor-keeper holds no registry role and must hold no grant here`
      : `AS-R09: ${label}: writable_by includes ${JSON.stringify(w)} — only the approver writes what the approver decided`);
  }
  if (!writableBy.includes('approver')) {
    findings.push(`AS-R09: ${label}: writable_by does not include the approver — a decision field the approver cannot write is a decision somebody else records on their behalf`);
  }
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// CLI: derive the surface for one stage of one compiled plan, so an adopter can see exactly which
// roles their page would bind — and watch PA1 and PA2 bind different sets.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  const stage = process.argv[3] || 'PA1';
  if (!path) {
    process.stderr.write('usage: node core/floor-approval-surface.mjs <control-plan.json> [PA1|PA2]\n');
    process.exit(2);
  }
  const plan = readJson(path);
  if (!plan) { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const { surface, findings, notices } = deriveApprovalSurface(plan, { stage });
  for (const n of notices) process.stderr.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write(`\nDerivation ABORTED — no surface is emitted.\n\n  - ${findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  const verdict = verifyApprovalSurface(surface, plan);
  if (verdict.length) {
    process.stderr.write(`\nThe derived surface does not verify — this is a bug in the derivation, not in your plan.\n\n  - ${verdict.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
}
