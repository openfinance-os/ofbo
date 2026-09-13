// The product-approval gate — PA1/PA2 and the P-gate families (Loom 2.0 §7.1). The Loom
// does not replace a bank's New Product Approval process; this gate ORCHESTRATES AND
// EVIDENCES it: the compiled control plan says which passport sections and which control
// functions a product of this risk and type needs, and the gate verifies the product
// passport carries them — with approvals that RESOLVE:
//
//   every required section is present with substance (P1–P8 as data, mounted by profile) ·
//   PA1 (permission to develop): classification-stage sections + PA1 approver roles ·
//   PA2 (permission to launch): every section + every control-function role in the plan ·
//   each approval names a registry identity that is HUMAN, holds the role, and — for
//   second-line roles — is not a builder. A text field with a name does not count.
//
// THE SHARI'AH LANE (see `shariahLane` below). Where a plan compiles `shariah-committee`, PA1 has
// two routes and the change says which one it takes: a change that creates or modifies a product
// STRUCTURE binds the full committee; a change that CONFORMS to a structure the committee already
// ruled on is cleared by the Shari'ah Compliance Function against a ruling that must RESOLVE — in
// this repository's decision register — to an active, non-template row. The gate checks
// composition, provenance and binding. It never rules on Shari'ah — scholars do that.
//
// MANDATORY-WHEN-COMPILED (Factory Floor WS2 · D2.5). When the compiled plan requires the
// `approval_attestation` capability — because the decision is made somewhere other than this
// repository — a resolvable name is no longer sufficient either. Each approval must carry an
// attestation that binds the HUMAN (an identity-provider assertion, not the carrying service's
// key) to the EXACT subject approved (plan hash, content digest, source or artifact), verified
// by `core/approval-attestations.mjs`. This path tightens the gate; it never loosens it, and a
// plan that does not compile the capability behaves exactly as before.
//
// 2.1.0 (hardening plan 4.2 · 4.4) — TWO RECORDS THAT USED TO BE PROSE.
//   DPIA: when the plan compiles the `dpia` capability (the base profile does so on the personal_data
//   flag), PA1 requires a dpia.json beside the envelope — every category it names resolves in the
//   data-lifecycle register, its residency is stated, its risks each carry a mitigation, and it is
//   signed by a data-protection HUMAN outside the builders group. The prose `pdpl-and-residency`
//   passport section it replaces could be satisfied by a paragraph.
//   MODEL OUTSOURCING: an LLM provider is a third party under the outsourcing rules like any other,
//   and the provider field in the model manifest is where that fact was hiding. PA1 on a change
//   that names model roles requires each role's provider to carry a `third_party` block: an
//   outsourcing assessment, prompt-data residency terms, an exit plan, and an assessor holding an
//   independent role. Kosli itself is a third party under the same rule.
//
// Run from the repo root: `node scripts/product-approval-check.mjs`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadRegistry, identityOf, quorumFor, resolveApprover } from './identity-registry-check.mjs';
import { loadIssuers } from '../core/attestations.mjs';
import { loadIdentityMap, mapRequired } from '../core/identity-map.mjs';
import {
  attestationRequired,
  loadApprovals,
  loadAssertionIssuers,
  passportDigest,
  verifyApprovalAttestation,
} from '../core/approval-attestations.mjs';
import { pathToFileURL } from 'node:url';

export const CHANGES_DIR = 'docs/governance/changes';
export const DPIA_FILE = 'dpia.json';
export const DPIA_CAPABILITY = 'dpia';
// Roles that may assess an outsourcing: the second-line functions plus information security.
export const OUTSOURCING_ASSESSOR_ROLES = ['compliance', 'risk-second-line', 'information-security'];
// A provider value that means "we run it ourselves" — no outsourcing to assess.
export const INTERNAL_PROVIDERS = new Set(['internal', 'in-house', 'self-hosted', 'none']);
const nonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * 2.1.0 (4.2) — the DPIA record for one change. Findings; empty ⇒ a complete, signed assessment
 * whose categories are the register's.
 */
export function evaluateDpia(dpia, { changeId = '(no id)', dataLifecycle = null, registry = null, notices = null } = {}) {
  const label = `${changeId} · PA1 · DPIA`;
  if (!dpia || typeof dpia !== 'object') return [`${label}: ${DPIA_FILE} is missing — the plan compiles ${DPIA_CAPABILITY} for a change touching personal data, and a passport paragraph is not an impact assessment`];
  const f = [];
  if (nonEmptyStr(dpia.change_id) && dpia.change_id !== changeId) f.push(`${label}: ${DPIA_FILE} carries change_id ${dpia.change_id} — an assessment for another change`);
  if (dpia.status !== 'complete') f.push(`${label}: status is ${JSON.stringify(dpia.status)}, not "complete" — an approval over an unfinished assessment is not an approval`);
  const cats = Array.isArray(dpia.categories) ? dpia.categories : null;
  if (!cats || cats.length === 0) f.push(`${label}: categories is empty — say which personal-data categories the change processes`);
  else if (dataLifecycle?.categories) {
    const known = new Set(dataLifecycle.categories.map((c) => c?.category));
    for (const c of cats) if (!known.has(c)) f.push(`${label}: category ${JSON.stringify(c)} does not resolve in docs/governance/data-lifecycle.json — the DPIA assesses the register's categories, not a spelling of its own`);
  } else notices?.push(`${label}: categories NOT verified against the data-lifecycle register — no docs/governance/data-lifecycle.json here`);
  for (const k of ['purpose', 'lawful_basis', 'residency', 'necessity']) if (!nonEmptyStr(dpia[k])) f.push(`${label}: no ${k}`);
  const risks = Array.isArray(dpia.risks) ? dpia.risks : null;
  if (!risks) f.push(`${label}: no risks array — a DPIA that found no risk to assess says so with an empty array and a reason, not by omitting the section`);
  else risks.forEach((r, i) => { for (const k of ['risk', 'mitigation']) if (!nonEmptyStr(r?.[k])) f.push(`${label}: risk ${i} has no ${k}`); });
  if (risks && risks.length === 0 && !nonEmptyStr(dpia.no_risk_rationale)) f.push(`${label}: risks is empty and no_risk_rationale is absent`);
  if (!nonEmptyStr(dpia.signed_at)) f.push(`${label}: no signed_at`);
  else if (Number.isNaN(Date.parse(dpia.signed_at))) f.push(`${label}: signed_at ${JSON.stringify(dpia.signed_at)} is not a parseable timestamp`);
  f.push(...resolveApprover(registry, dpia.signed_by, 'data-protection', `${label} · signed_by`, { notices }));
  if (registry && nonEmptyStr(dpia.signed_by)) {
    const who = identityOf(registry, dpia.signed_by);
    if (who && (who.groups || []).includes('builders')) f.push(`${label} · signed_by: ${dpia.signed_by} is in the builders group — the assessor of a change may never be an author of it`);
  }
  return f;
}

/**
 * 2.1.0 (4.4) — the model roles this change names, each provider assessed as an outsourcing.
 * `roles` empty with model_involved set reads as "every model in the manifest".
 */
export function evaluateModelOutsourcing(envelope, modelManifest, { registry = null, notices = null } = {}) {
  const changeId = envelope?.change_id || '(no id)';
  const label = `${changeId} · PA1 · model outsourcing`;
  const named = Array.isArray(envelope?.model_roles) ? envelope.model_roles : [];
  const involved = named.length > 0 || envelope?.flags?.model_involved === true;
  if (!involved) return [];
  if (!modelManifest) { notices?.push(`${label}: NOT verified — no docs/governance/model-manifest.json here`); return []; }
  const models = Array.isArray(modelManifest.models) ? modelManifest.models : [];
  const f = [];
  const scope = named.length ? models.filter((m) => named.includes(m?.role)) : models;
  for (const role of named) if (!models.some((m) => m?.role === role)) f.push(`${label}: envelope names model role ${JSON.stringify(role)}, which is not in the model manifest — a change on a model nobody inventoried`);
  for (const m of scope) {
    const role = m?.role || '(unnamed role)';
    const provider = nonEmptyStr(m?.provider) ? m.provider.trim() : '';
    if (!provider) { f.push(`${label}: role ${role} declares no provider — say who runs it, "internal" included`); continue; }
    if (INTERNAL_PROVIDERS.has(provider.toLowerCase())) continue;
    const tp = m.third_party;
    if (!tp || typeof tp !== 'object') { f.push(`${label}: role ${role} runs on provider ${JSON.stringify(provider)} and carries no third_party block — an LLM provider is an outsourcing, and an outsourcing is assessed before permission to develop`); continue; }
    for (const k of ['outsourcing_assessment', 'prompt_data_residency', 'exit_plan']) if (!nonEmptyStr(tp[k])) f.push(`${label}: role ${role} (${provider}) third_party has no ${k}`);
    if (!nonEmptyStr(tp.assessed_at)) f.push(`${label}: role ${role} (${provider}) third_party has no assessed_at`);
    else if (Number.isNaN(Date.parse(tp.assessed_at))) f.push(`${label}: role ${role} (${provider}) assessed_at ${JSON.stringify(tp.assessed_at)} is not a parseable timestamp`);
    if (!nonEmptyStr(tp.assessed_by)) f.push(`${label}: role ${role} (${provider}) third_party has no assessed_by`);
    else if (registry) {
      const who = identityOf(registry, tp.assessed_by);
      if (!who) f.push(`${label}: role ${role} assessed_by ${JSON.stringify(tp.assessed_by)} is not in the identity registry`);
      else {
        if (who.kind === 'agent') f.push(`${label}: role ${role} assessed_by ${tp.assessed_by} is an AGENT — a model does not assess its own provider`);
        if ((who.groups || []).includes('builders')) f.push(`${label}: role ${role} assessed_by ${tp.assessed_by} is in the builders group`);
        if (!(who.roles || []).some((r) => OUTSOURCING_ASSESSOR_ROLES.includes(r))) f.push(`${label}: role ${role} assessed_by ${tp.assessed_by} holds none of ${OUTSOURCING_ASSESSOR_ROLES.join(', ')}`);
      }
    }
  }
  if (scope.some((m) => nonEmptyStr(m?.provider) && !INTERNAL_PROVIDERS.has(m.provider.trim().toLowerCase())) && envelope?.flags?.third_party !== true) {
    f.push(`${label}: a model role in scope runs on an external provider but flags.third_party is ${JSON.stringify(envelope?.flags?.third_party ?? null)} — the provider is a third party, and the flag is what compiles the third-party route`);
  }
  return f;
}
// Roles whose approvals demand organisational independence from the builders. THIRD LINE IS IN
// HERE TOO (`shariah-audit`): the rule this set encodes is not an org chart, it is "the person who
// certifies a change may never be an author of it", and an internal Shari'ah auditor — or a scholar
// — signing work they helped build is that defect wearing a different title. Until the Shari'ah
// roles were added, a builders-group identity holding one of them signed Shari'ah approvals
// unchallenged, because the finding below only fires for roles in this set.
export const SECOND_LINE_ROLES = new Set([
  'risk-second-line', 'compliance', 'model-validator', 'credit-risk', 'data-protection',
  // Shari'ah roles — inert for any repository whose plans never compile them. `shariah-committee`
  // is the ISSC (the body); `shariah-compliance` is the Shari'ah Compliance Function head (second
  // line); `shariah-audit` is internal Shari'ah audit (third line, and it may never be outsourced).
  'shariah-committee', 'shariah-compliance', 'shariah-audit',
]);
// Third line, for the wording of the finding only — the independence rule is identical.
const THIRD_LINE_ROLES = new Set(['shariah-audit']);
export const SHARIAH_COMMITTEE_ROLE = 'shariah-committee';
export const SHARIAH_COMPLIANCE_ROLE = 'shariah-compliance';
// PA1 needs the owning + challenging functions as a FLOOR; PA2 needs every role the plan compiled.
export const PA1_CORE_ROLES = ['product-owner', 'risk-second-line'];
export const PA1_HIGH_ROLES = ['accountable-executive'];

/**
 * Which roles must have signed by PA1 — permission to develop.
 *
 * The core set is a floor, never a ceiling. It used to be the whole answer, and that was a defect
 * with a very specific shape: a compiled plan could name twelve approver roles while PA1 checked
 * three, and the flat `required_approver_roles` list gave a reader — or an auditor — no way to
 * tell which was which. A profile that adds `shariah-committee` AND a `shariah-applicability`
 * PA1 section plainly means the Shariah function to be involved at PA1; the gate ignored it.
 *
 * So a profile now declares `pa1_approver_roles` for the roles it wants bound at PA1, the compiler
 * unions them into the plan, and the plan says out loud which roles bind where. Roles compiled
 * into `required_approver_roles` but not into this set bind at PA2 — deliberately, and visibly.
 */
export function pa1Roles(plan) {
  const required = plan?.required_approver_roles || [];
  const wanted = [
    ...PA1_CORE_ROLES,
    ...(['high', 'critical'].includes(plan?.risk_tier) ? PA1_HIGH_ROLES : []),
    ...(plan?.pa1_approver_roles || []),
  ];
  return [...new Set(wanted)].filter((r) => required.includes(r)).sort();
}

/** A ruling id somebody actually wrote: not empty, not a marker nobody replaced. */
const isNamedRef = (v) => typeof v === 'string' && v.trim() !== ''
  && !/^(ADOPT[\s:—-]|TODO|TBD|N\/?A$|none$|<)/i.test(v.trim());

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// Where the Shari'ah DECISION register lives, and the one status that counts as standing. Declared
// here, as scripts/shariah-governance-check.mjs and scripts/profit-distribution-check.mjs each
// declare them, so a gate does not fail to load because a sibling gate was refactored. The strings
// are the register's schema and are asserted identical by the cross-gate test below.
export const RULINGS_LOCATIONS = ['docs/governance/shariah-rulings.json', 'shariah-rulings.json'];
export const ACTIVE_STATUS = 'active';

// The fields that make a rulings row a DECISION rather than a shipped example. governance/
// shariah-rulings.template.json ships three rows with `"status": "active"` and ADOPT markers in
// exactly these fields; without this list, an adopter who mounts that template unedited unlocks the
// quorum relaxation by citing SR-0001.
const RULING_PROVENANCE_FIELDS = ['issued_by', 'issued_at', 'evidence_path'];

/**
 * The decision register as a three-state handle: `{ present, doc }`.
 *
 * Absent, present-but-unreadable and readable are three different answers, and the lane treats
 * them differently — collapsing them to `doc || null` is how "nothing checked it" comes to look
 * like "it checked out". Reading the file is inert: a repository with no register and no compiled
 * `shariah-committee` never reaches any of this.
 */
export function loadRulings(cwd = process.cwd()) {
  const rel = RULINGS_LOCATIONS.find((p) => existsSync(`${cwd}/${p}`));
  if (!rel) return { present: false, doc: null, path: null };
  return { present: true, doc: readJson(`${cwd}/${rel}`), path: rel };
}

/**
 * Does `ref` name a ruling this repository can actually produce, and does it still stand?
 *
 * Returns `{ bound, ruling, why, coverage }`. `why` is the reason fragment the caller puts in a
 * finding, because "the register has no such row", "it was withdrawn" and "that row is still the
 * shipped template" are three different problems with three different fixes.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. The conforming lane drops the committee's whole PA1 quorum
 * in favour of one compliance signature. The whole test on the ruling that buys that
 * relaxation used to be "a non-empty string that is not an ADOPT marker" — so a typo, a ruling
 * withdrawn last year, or an id nobody ever issued bought it exactly as well as a real decision.
 *
 * WHAT IS STILL NOT CHECKED, and no gate can check it: whether this change actually conforms to
 * the ruling. That is a Shari'ah judgement. This resolves a citation; scholars decide Shari'ah.
 */
export function resolveRulingBinding(ref, rulings, productId) {
  const rows = Array.isArray(rulings?.doc?.rulings) ? rulings.doc.rulings : [];
  const want = String(ref).trim();
  const ruling = rows.find((r) => typeof r?.ruling_id === 'string' && r.ruling_id.trim() === want);
  if (!ruling) {
    return { bound: false, ruling: null, why: `no row in ${RULINGS_LOCATIONS[0]} carries that ruling_id — a citation the decision register cannot resolve is a ruling nobody can produce`, coverage: null };
  }
  if (ruling.status !== ACTIVE_STATUS) {
    // superseded and withdrawn are not the same failure: one moved, the other is gone.
    const replacement = rows.find((r) => r?.supersedes === ruling.ruling_id
      || (Array.isArray(r?.supersedes) && r.supersedes.includes(ruling.ruling_id)));
    const next = replacement
      ? ` ${replacement.ruling_id} replaces it — cite that instead, or declare the structure delta`
      : ' nothing in the register replaces it, so there is no standing decision left to conform to';
    return { bound: false, ruling, why: `its status is ${JSON.stringify(ruling.status)}, not ${JSON.stringify(ACTIVE_STATUS)};${next}`, coverage: null };
  }
  const untouched = RULING_PROVENANCE_FIELDS.filter((f) => !isNamedRef(ruling[f]));
  if (untouched.length) {
    return { bound: false, ruling, why: `that row is still an adoption template (${untouched.join(', ')} ${untouched.length === 1 ? 'is' : 'are'} unset or an ADOPT marker) — a shipped example row is not a decision, however active it says it is`, coverage: null };
  }
  // COVERAGE, and only where both sides say something. A ruling that lists the products it governs
  // does not govern a product it omits. Where the row declares no product scope (an institution-wide
  // filing does not), or the envelope names no product, nothing here has checked coverage and the
  // notice says so rather than implying it did.
  const governs = (ruling.product_ids || []).filter((p) => isNamedRef(p)).map((p) => p.trim());
  if (isNamedRef(productId) && governs.length && !governs.includes(String(productId).trim())) {
    return { bound: false, ruling, why: `that ruling governs ${governs.join(', ')} and this change is against product ${productId} — a ruling on another product does not clear this one`, coverage: null };
  }
  const coverage = isNamedRef(productId) && governs.length
    ? `product ${String(productId).trim()} is listed in that ruling's product_ids`
    : 'coverage NOT checked — the ruling declares no product scope, or the envelope names no product_id';
  return { bound: true, ruling, why: null, coverage };
}

/**
 * Which Shari'ah lane a change takes — 'structure-delta' or 'conforming'.
 *
 * WHY THERE ARE TWO LANES. An ISSC sits on a committee cadence (governance/approval-sla.template.json
 * ships a 14-day target, and that target is honest about why: it reflects when the body actually
 * sits) and its quorum is 3 distinct scholars. Binding the full committee at PA1 to EVERY change
 * that touches an Islamic product queues the institution's whole change flow behind a fortnightly
 * meeting — the governance would be defeated by its own SLA data, and what follows is the thing
 * governance cannot survive: people routing around it. The established practice is already two
 * lanes, and this is that practice mechanised. THE COMMITTEE APPROVES STRUCTURES. The Shari'ah
 * Compliance Function — second line, and under the CBUAE Shari'ah Compliance Function standard a
 * CONTINUOUS monitoring function, not a periodic one — clears changes that CONFORM to a structure
 * the committee has already ruled on. The committee is expected to ratify the conforming flow at
 * its cadence; that expectation is an organisational obligation, and NO gate in this harness
 * verifies that any ratification ever happened.
 *
 * The lane is DECLARED, on the change envelope, as `flags.structure_delta` (true ⇒ this change
 * creates or modifies a Shari'ah product structure). Undeclared reads as conforming, which buys
 * nothing by itself: the conforming lane only substitutes when the envelope ALSO names a ruling
 * that RESOLVES to an active row of the decision register — see `conformingLanePa1`.
 *
 * WHAT THIS CANNOT SEE, and no gate can: whether a change that says it conforms actually does.
 * That is a Shari'ah judgement, and no agent makes one. The harness reads a declared flag, resolves
 * the cited ruling, and checks who signed; it checks composition, provenance and binding, never
 * substance. A mis-declared lane is meant to surface afterwards, when the committee RATIFIES what
 * flowed through the conforming lane — an organisational obligation on the assurance stream that
 * this gate does NOT verify, and that nothing else in the harness verifies either. It is written
 * here as an obligation, not as a compensating control that has been shown to operate.
 */
export function shariahLane(plan, envelope) {
  // The envelope is where the flags live and where the compiler reads them from; a plan that
  // carries its own copy is honoured so the helper answers for a plan handed over on its own.
  const flags = envelope?.flags ?? plan?.flags ?? {};
  return flags.structure_delta === true ? 'structure-delta' : 'conforming';
}

/**
 * The PA1 role set after the Shari'ah lane is applied, and the record of which lane that was.
 *
 * Returns `{ roles, lane, substituted, ref, findings, notices }`. Inert — `lane: null`, roles
 * unchanged, nothing said — for any stage that does not bind `shariah-committee`, which is every
 * change in a repository with no Islamic product in flight.
 *
 * On the conforming lane the committee's PA1 quorum is satisfied INSTEAD by a `shariah-compliance`
 * approval plus an `issc_decision_ref` that RESOLVES, in the repository's decision register, to an
 * ACTIVE, non-template ruling this change's product is within. All of it is required: the signature
 * without a ruling is a second-line clearance of nothing in particular; a ruling id that resolves
 * to nothing, to a superseded or withdrawn row, or to a shipped example row is a citation of a
 * decision this repository cannot produce. Anything missing, or a declared structure delta, and the
 * full committee binding applies exactly as before this lane existed.
 *
 * `rulings` is the register handle from `loadRulings` — `{ present, doc }`. WHEN THE REGISTER IS
 * ABSENT (or unreadable) THE LANE IS REFUSED, not opened with a caveat. The committee quorum (a
 * number the identity registry declares, not one this file knows) is the most expensive control in
 * the Shari'ah plane, and relaxing it on a claim nothing in the
 * repository can resolve is the exact shape of defect this harness exists to catch: it would let
 * the least-governed repository take the most-relaxed route. Mounting the register is one file; a
 * NOT-VERIFIED notice over a dropped quorum is a green gate nobody checked. The cost of refusing is
 * that an Islamic adopter without a register falls back to the committee binding — which is the
 * behaviour they had before this lane existed, and it is announced, so it is not a silent failure.
 *
 * The lane taken is always announced. A silent lane switch is precisely the defect this design
 * would otherwise introduce: an auditor reading a green PA1 must be able to see whether three
 * scholars bound this change or one compliance officer did, and against which ruling.
 *
 * PA2 is untouched. Permission to LAUNCH keeps the full committee binding — the lane exists to
 * keep development flowing between sittings, not to launch a product the committee has not seen.
 */
export function conformingLanePa1(plan, envelope, roles, label, rulings) {
  const findings = [];
  const notices = [];
  const out = [...(roles || [])];
  if (!out.includes(SHARIAH_COMMITTEE_ROLE)) return { roles: out, lane: null, substituted: false, ref: null, findings, notices };
  const lane = shariahLane(plan, envelope);
  const ref = envelope?.issc_decision_ref;
  const stands = `The ${SHARIAH_COMMITTEE_ROLE} binding stands meanwhile.`;
  if (lane === 'structure-delta') {
    notices.push(`${label}: Shari'ah lane = STRUCTURE-DELTA (envelope flags.structure_delta) — this change creates or modifies a product structure, so the full ${SHARIAH_COMMITTEE_ROLE} quorum binds here. Only the committee approves a structure.`);
    return { roles: out, lane, substituted: false, ref: null, findings, notices };
  }
  if (!isNamedRef(ref)) {
    findings.push(`${label}: the change takes the CONFORMING Shari'ah lane (envelope flags.structure_delta is not set) but names no issc_decision_ref — "this conforms to something the committee already approved" without saying WHAT is an assertion, not a route. Name the ruling, or declare the structure delta and bind the committee. ${stands}`);
    return { roles: out, lane, substituted: false, ref: null, findings, notices };
  }
  if (!rulings?.present) {
    findings.push(`${label}: the conforming lane would drop the ${SHARIAH_COMMITTEE_ROLE} quorum on ISSC decision ${JSON.stringify(ref)}, and this repository carries no ${RULINGS_LOCATIONS[0]} to resolve it against — the relaxation is REFUSED rather than granted on a citation nothing here can check. Mount the decision register, or declare the structure delta. ${stands}`);
    return { roles: out, lane, substituted: false, ref, findings, notices };
  }
  if (!rulings.doc) {
    findings.push(`${label}: ${RULINGS_LOCATIONS[0]} is present but is not valid JSON, so ISSC decision ${JSON.stringify(ref)} resolves to nothing — an unreadable decision register unlocks no quorum relaxation. ${stands}`);
    return { roles: out, lane, substituted: false, ref, findings, notices };
  }
  const bound = resolveRulingBinding(ref, rulings, envelope?.product_id);
  if (!bound.bound) {
    findings.push(`${label}: the conforming lane cites ISSC decision ${JSON.stringify(ref)} — ${bound.why}. A quorum of scholars is not relaxed to one signature against a ruling this repository cannot stand behind. ${stands}`);
    return { roles: out, lane, substituted: false, ref, findings, notices };
  }
  if (!(plan?.required_approver_roles || []).includes(SHARIAH_COMPLIANCE_ROLE)) {
    findings.push(`${label}: the conforming lane clears a change through ${SHARIAH_COMPLIANCE_ROLE} against ISSC decision ${JSON.stringify(ref)}, and this plan compiles no ${SHARIAH_COMPLIANCE_ROLE} role — a lane with nobody in it is not a lane, so the ${SHARIAH_COMMITTEE_ROLE} binding stands.`);
    return { roles: out, lane, substituted: false, ref, findings, notices };
  }
  const next = out.filter((r) => r !== SHARIAH_COMMITTEE_ROLE);
  if (!next.includes(SHARIAH_COMPLIANCE_ROLE)) next.push(SHARIAH_COMPLIANCE_ROLE);
  notices.push(`${label}: Shari'ah lane = CONFORMING against ISSC decision ${JSON.stringify(ref)} — the ${SHARIAH_COMMITTEE_ROLE} PA1 quorum is satisfied by ${SHARIAH_COMPLIANCE_ROLE} instead. CHECKED: that ruling resolves in ${RULINGS_LOCATIONS[0]} to a row whose status is ${JSON.stringify(ACTIVE_STATUS)}, carrying issuer/date/evidence provenance rather than adoption markers (${bound.coverage}); and that the Shari'ah Compliance Function signed. NOT CHECKED, here or anywhere in the harness: whether this change conforms to that ruling — scholars decide Shari'ah, and this gate resolves a citation. Committee ratification of what flows through this lane is an organisational obligation NO gate here verifies.`);
  return { roles: next.sort(), lane, substituted: true, ref, findings, notices };
}

/**
 * One stage's approvals against the roles the plan compiled.
 *
 * Returns `{ findings, missing }`. `missing` used to be computed here and thrown away into a
 * finding string, which is why nothing in the harness could answer "who is this change waiting
 * on?" — the set existed, once per run, and was immediately unreadable. It is now returned, and
 * scripts/approval-status.mjs (telemetry) reads it rather than reimplementing the derivation
 * against a second, drifting idea of what a required role is.
 */
export function checkApprovals(approvals, requiredRoles, registry, label, stage, att) {
  const findings = [];
  const missing = [];
  // rc.38 (flow-plan Phase 4.5): approvals group into a LIST per role, not one entry. A quorum
  // role needs K distinct holders, and collapsing the list to one would have silently accepted
  // the first name and discarded the rest — a quorum that reads as configured and counts to one.
  const byRole = new Map();
  for (const a of approvals || []) byRole.set(a.role, [...(byRole.get(a.role) || []), a]);
  for (const role of requiredRoles) {
    const given = byRole.get(role) || [];
    const k = quorumFor(registry, role);
    const distinct = new Set(given.map((a) => a.by).filter((b) => typeof b === 'string' && b.trim()));
    if (given.length === 0) { missing.push(role); findings.push(`${label}: no approval for required role ${role}`); continue; }
    if (distinct.size < k) {
      missing.push(role);
      findings.push(`${label}: role ${role} needs a quorum of ${k} distinct holders — ${distinct.size} recorded (${[...distinct].join(', ') || 'none resolvable'})`);
    }
    for (const a of given) {
      findings.push(...checkOne(a, role, registry, label, att));
      if (!att?.required) continue;
      // The attestation for THIS approver. Matching on (stage, role) alone was sufficient while a
      // role meant one signature; under quorum it would let one record evidence two people.
      const forRole = (att.records || []).filter((r) => r?.stage === stage && r?.role === role);
      const rec = forRole.find((r) => r?.subject?.registry_id === a.by)
        ?? (forRole.length === 1 && given.length === 1 ? forRole[0] : null);
      findings.push(...verifyApprovalAttestation(rec, {
        stage,
        role,
        by: a.by,
        plan: att.plan,
        passportDigest: att.passportDigest,
        registry,
        issuers: att.issuers,
        assertionIssuers: att.assertionIssuers,
        resolveApprover,
        identityOf,
        seen: att.seen,
        site: att.site,
        now: att.now,
        // rc.38 (flow-plan Phase 4.1) — where the narrowed per-role binding lets an approval
        // survive a plan hash that moved outside the approver's scope, that acceptance is
        // RECORDED here and printed. A narrowing nobody can see is a narrowing nobody agreed to.
        notices: att.notices,
        map: att.map,
        mapRequired: att.mapRequired,
      }, `${label} · ${role}`));
    }
  }
  // Every approval the passport RECORDS is resolved, not only the ones this stage demands. Without
  // this, a role the stage does not require could name an agent, a builder, or an identity that
  // does not exist, and the gate would say OK — which at PA1 was nine of twelve compiled roles,
  // including every Shariah role. A recorded approval is a claim the record makes about a person.
  // "Agents approve nothing" is the method's loudest promise, and an agent's name sitting in an
  // approval slot under a green gate contradicts it whether or not this stage asked for it.
  for (const [role, given] of byRole) {
    if (requiredRoles.includes(role)) continue; // checked above
    for (const a of given) findings.push(...checkOne(a, role, registry, `${label} (recorded, not required at this stage)`, att));
  }
  return { findings, missing };
}

/**
 * One recorded approval: resolves to a human holding the role, and second line ∩ builders = ∅.
 * A DEPUTY (rc.38) resolves through the same call and inherits both rules — the delegation
 * supplies the role, and the builders check below is applied to the person actually approving.
 */
function checkOne(a, role, registry, label, att) {
  const findings = [...resolveApprover(registry, a.by, role, `${label} · ${role}`, { notices: att?.notices, now: att?.now })];
  if (registry && SECOND_LINE_ROLES.has(role)) {
    const who = identityOf(registry, a.by);
    if (who && (who.groups || []).includes('builders')) {
      findings.push(`${label} · ${role}: ${a.by} is in the builders group — a builder cannot issue ${THIRD_LINE_ROLES.has(role) ? 'third-line' : 'second-line'} approval (the person who certifies a change may never be an author of it)`);
    }
  }
  return findings;
}

const hasSubstance = (s) => s && typeof s === 'object' && Object.keys(s).length > 0;

/**
 * Findings for one passport against its compiled plan.
 * `att` carries the attestation material when the plan compiles the capability:
 * { records, issuers, assertionIssuers, passportDigest, seen, now }. It also carries `envelope` —
 * the change envelope — because the Shari'ah lane is DECLARED there (flags.structure_delta,
 * issc_decision_ref) and a passport cannot answer for a route the change chose; and `rulings`, the
 * decision-register handle the cited ruling must resolve in. An absent `rulings` reads as "no
 * register", which REFUSES the conforming lane — a caller that supplies no register has shown
 * nothing, and the relaxation is not granted on nothing.
 */
export function evaluate(passport, plan, registry, att = {}) {
  const findings = [];
  const id = plan?.change_id || '(no id)';
  if (!passport) return [`${id}: product passport missing — a product change without a passport is blocked`];
  const gates = new Set(plan?.required_gates || []);
  // Either PA gate is a product-approval route, and each is evaluated on its OWN presence below.
  // Testing PA1 alone here meant a plan compiling PA2 without PA1 — which the compiler can emit,
  // since a conditional profile may add PA2 to a lower-tier change — returned early and skipped
  // EVERYTHING: ownership, the PA2 section set, the approver roles and every attestation on the
  // one gate that grants permission to launch.
  if (!gates.has('PA1') && !gates.has('PA2')) {
    // No product-approval route compiled at all. If the plan nonetheless requires attestation-backed
    // approvals, say so rather than exiting quietly: a requirement with nowhere to apply reads as
    // satisfied, and a silently inert control is the failure this whole contract exists to avoid.
    return attestationRequired(plan)
      ? [`${id}: the plan requires the ${'approval_attestation'} capability but compiles neither PA1 nor PA2 (gates: ${(plan?.required_gates || []).join(', ') || 'none'}) — the requirement has nothing to apply to, which is a plan defect, not a pass`]
      : [];
  }
  // Mandatory-when-compiled: the attestation path activates from the plan, never from a flag.
  const attCtx = { ...att, required: attestationRequired(plan), plan, seen: att.seen || new Map() };

  // Ownership is named and resolvable, always.
  const own = passport.sections?.ownership;
  for (const [field, role] of [['product_owner', 'product-owner'], ['accountable_executive', 'accountable-executive']]) {
    findings.push(...resolveApprover(registry, own?.[field], role, `${id} · ownership.${field}`, { notices: attCtx.notices, now: attCtx.now }));
  }

  // PA1 — permission to develop.
  const pa1Required = pa1Roles(plan);
  if (gates.has('PA1')) {
    if (passport.pa1?.decision === 'approved') {
      for (const section of plan.pa1_sections || []) {
        if (!hasSubstance(passport.sections?.[section])) {
          findings.push(`${id} · PA1: required section ${section} is missing or empty — an approval over absent analysis is not an approval`);
        }
      }
      // The Shari'ah lane. Silent and role-preserving unless the plan binds `shariah-committee` at
      // PA1, which is every change in a repository with no Islamic product in flight.
      const lane = conformingLanePa1(plan, attCtx.envelope, pa1Required, `${id} · PA1`, attCtx.rulings);
      findings.push(...lane.findings);
      for (const n of lane.notices) attCtx.notices?.push(n);
      findings.push(...checkApprovals(passport.pa1.approvals, lane.roles, registry, `${id} · PA1`, 'PA1', attCtx).findings);
      // 2.1.0 (4.2) — the DPIA record, mandatory-when-compiled.
      if (plan?.required_capabilities?.[DPIA_CAPABILITY]?.required) {
        findings.push(...evaluateDpia(att.dpia, { changeId: id, dataLifecycle: att.dataLifecycle, registry, notices: attCtx.notices }));
      }
      // 2.1.0 (4.4) — every external model provider the change touches is an assessed outsourcing.
      if (att.envelope) findings.push(...evaluateModelOutsourcing(att.envelope, att.modelManifest, { registry, notices: attCtx.notices }));
    } else if (passport.pa1?.decision && passport.pa1.decision !== 'pending' && passport.pa1.decision !== 'rejected') {
      findings.push(`${id} · PA1: decision must be approved|pending|rejected (got ${JSON.stringify(passport.pa1.decision)})`);
    }
  }

  // PA2 — permission to launch: the full section set, every compiled control function. The
  // Shari'ah lane deliberately does NOT reach here: it exists so development keeps moving between
  // committee sittings, not so a product launches on a structure the committee has not approved.
  if (gates.has('PA2') && passport.pa2?.decision === 'approved') {
    for (const section of [...(plan.pa1_sections || []), ...(plan.pa2_sections || [])]) {
      if (!hasSubstance(passport.sections?.[section])) {
        findings.push(`${id} · PA2: required section ${section} is missing or empty`);
      }
    }
    findings.push(...checkApprovals(passport.pa2.approvals, plan.required_approver_roles || [], registry, `${id} · PA2`, 'PA2', attCtx).findings);
  }
  return findings;
}

export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return { findings: [], notices: [], count: 0 };
  const registry = loadRegistry(cwd);
  // Attestation material is loaded once; `seen` spans every change, so a decision nonce
  // replayed across changes is caught, not just one replayed within a change.
  const issuers = loadIssuers(cwd);
  const identityMap = loadIdentityMap(cwd);
  const assertionIssuers = loadAssertionIssuers(cwd);
  // The decision register, read once. Inert for a repository that has none and never takes the
  // conforming lane; the handle keeps "absent" distinguishable from "unreadable".
  const rulings = loadRulings(cwd);
  // 2.1.0 — the repository-wide records the DPIA and the model-outsourcing rules read.
  const dataLifecycle = readJson(`${cwd}/docs/governance/data-lifecycle.json`);
  const modelManifest = readJson(`${cwd}/docs/governance/model-manifest.json`);
  const seen = new Map();
  const findings = [];
  const notices = [];
  let count = 0;
  for (const name of readdirSync(dir)) {
    const base = `${dir}/${name}`;
    const envelope = readJson(`${base}/change-envelope.json`);
    if (!envelope) continue; // the envelope gate reports this
    const plan = readJson(`${base}/${envelope.control_plan || 'control-plan.json'}`);
    if (!plan) continue; // ditto
    // A plan that requires attestation but compiles no PA gate is still reported (evaluate says
    // so) — skipping it here would restore exactly the silent pass that check exists to close.
    // Either PA gate brings a change into scope: a PA2-only plan is a launch approval to check,
    // not a change to walk past.
    const compiled = plan.required_gates || [];
    if (!compiled.includes('PA1') && !compiled.includes('PA2') && !attestationRequired(plan)) continue;
    count++;
    const att = {
      records: loadApprovals(base).map((a) => a.record),
      issuers,
      assertionIssuers,
      passportDigest: passportDigest(base),
      seen,
      site: name, // the change DIRECTORY — two directories may carry one change_id
      // The P6 join. Loaded once, applied per approval: the map says who a signed subject IS,
      // and the record's own registry_id is only a claim until the two agree.
      map: identityMap,
      mapRequired: mapRequired(plan),
      notices,
      // The envelope decides the Shari'ah lane (flags.structure_delta, issc_decision_ref). It is
      // already read above; passing it in is what stops evaluate() guessing the route from the
      // passport, which cannot know it.
      envelope,
      // …and the register the cited ruling has to resolve in, or the lane does not open.
      rulings,
      // 2.1.0 — the per-change DPIA and the two registers it and the outsourcing rule resolve in.
      dpia: readJson(`${base}/${DPIA_FILE}`),
      dataLifecycle,
      modelManifest,
    };
    findings.push(...evaluate(readJson(`${base}/product-passport.json`), plan, registry, att));
  }
  return { findings, notices, count };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, count } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nProduct-approval gate (PA1/PA2) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe Loom orchestrates and evidences the bank’s product approval — it does not\nreplace it. Approvals must resolve to human identities holding the required role.\n');
    process.exit(1);
  }
  process.stdout.write(`Product-approval gate — OK (${count} product change${count === 1 ? '' : 's'})\n`);
}
