// The change-envelope gate (Loom 2.0 §4–5). The envelope is the governed change object —
// the root of the traceability chain from mandate to outcome. This gate enforces, for every
// change under docs/governance/changes/<id>/:
//
//   classification is complete (an unclassified change is blocked) ·
//   the stored control plan RECONCILES with a fresh compile (plan_hash match — a stale or
//   hand-edited plan fails, so classification-time rigor survives to execution time) ·
//   the classifier is a HUMAN with classification authority (the agent cannot set or lower
//   a risk tier; the envelope directory is CODEOWNERS-owned by a non-builder group) ·
//   state transitions carry their receipts (PA1 before develop, A before delivery,
//   PA2 before launch) · production authorization is COMPOUND (1.12): PA2 + R-gate-green
//   readiness for every declared service + the second-line release hold RELEASED by a
//   second-line human (missing hold = held, fail closed) + externally-anchored, issuer-
//   verified evidence at high/critical tiers ·
//   exemptions have an owner, rationale, compensating control, expiry, second-line approval ·
//   state_history (rc.37) is an APPEND-ONLY record of the transitions that got the change here ·
//   2.1.0: the BUSINESS accepts before launch (uat-accepted, a non-builder signature bound to the
//   release commit — hardening plan 4.1), a medium tier owes its threat model (4.6), and a change in
//   production owes a post-implementation review on the retrospective's clock (4.5).
//
// STATE_HISTORY (flow-plan Phase 3.1). The lifecycle had eight states and no timestamps, so the
// value stream was unmeasurable from its own artifacts: no lead time, no stage residency, no
// queue age. One field fixes that with zero new ceremony — `[{state, at, by}]`, appended as the
// change moves. This gate validates it: states advance in the STATES order (a history that goes
// backwards is not a history), `at` never moves backwards, nothing follows a terminal state,
// `by` resolves in the registry when present, and the last entry IS current_state — so the
// history cannot become a parallel account of a change that went somewhere else.
//
// The requirement is split rather than retroactive: OPTIONAL wherever it is absent today, and
// REQUIRED at high/critical tiers for changes classified on or after STATE_HISTORY_REQUIRED_FROM.
// Demanding it retroactively would turn every existing tree red for a record nobody can go back
// and write. A grandfathered high-tier change is NOTICED on every run — never silently excused.
//
// CHANGE CLASSES (rc.38 · flow-plan Phase 4.2). `change_class` is standard | normal | emergency,
// defaulting to normal. It compiles the SAME requirement set in every class — the compiler never
// reads it — and changes only the SEQUENCING:
//
//   normal     the route as it has always been.
//   standard   rides a second-line-approved PRE-APPROVED PATTERN (core/change-patterns.mjs): the
//              approval was given once, on the pattern, and this change's PA receipts are
//              satisfied by it while every one of the pattern's conditions holds.
//   emergency  may enter `emergency-authorized` — production with receipts still owed — and must
//              then carry a `retrospective_deadline`. Every deferred receipt is listed on every
//              run, and the MOMENT the deadline passes with any of them still outstanding, all of
//              them fire as findings. Nothing is dropped; it is reordered with a hard expiry.
//
// FLAG CORROBORATION (rc.38 · flow-plan Phase 4.7). `flags` drive the conditional profile rules,
// so a flag left false is a tier reduction nobody has to argue for. Each one is now cross-checked
// against the repository's OWN governance data — the data-lifecycle register, the model manifest,
// the passport's third-parties section — and a CONTRADICTED flag is a finding.
//
// INSTITUTION ASSERTIONS. Some flags state a fact about the INSTITUTION rather than about the
// change, and those have no per-change register to corroborate them against: an envelope can leave
// one false and route around a whole body of governance without anyone having to argue for it. An
// institution profile may therefore declare `asserts_flags: { "<flag>": true }` — this flag is
// true of every change in this repository — and `required_for_all_changes: true` — every envelope
// must name this profile, because a profile a change can decline to name governs only the changes
// that agreed to be governed. Both are read from EVERY profile in profiles/institutions/, not
// merely the ones the envelope named: the record that contradicts an envelope is precisely the one
// the envelope left out. The mechanism is generic — this gate does not know which flags exist —
// and a repository whose institution profiles declare neither field is entirely unaffected.
//
// Run from the repo root: `node scripts/change-envelope-check.mjs [--base <ref>]`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { compile, resolveProfileContext, planHash } from '../core/policy-compiler.mjs';
import { TERMINAL_STATES } from '../core/compiled-requirements.mjs';
import { collectPatterns, evaluateClaim } from '../core/change-patterns.mjs';
import { loadRegistry, identityOf, resolveAcceptor } from './identity-registry-check.mjs';
import { evaluate as evaluateReadiness, SERVICES_DIR } from './operational-readiness-check.mjs';
import { loadIssuers, verifyAnchorAttestation } from '../core/attestations.mjs';
import { pathToFileURL } from 'node:url';

export const CHANGES_DIR = 'docs/governance/changes';
export const STATES = ['classified', 'permission-to-develop', 'in-delivery', 'delivery-complete',
  'uat-accepted', 'permission-to-launch', 'operationally-ready', 'production-authorized', 'in-production'];
// 2.1.0 (hardening plan 4.1) — the business accepts what was built BEFORE permission to launch is
// asked for. `delivery-complete` is the builders' word that the work is done; `uat-accepted` is
// the business's, bound to the exact commit it accepted. A history may still step straight from
// delivery-complete to permission-to-launch (the state is a checkpoint, not a queue), but from
// uat-accepted onward the receipt below is owed, so the skip changes nothing about what must exist.
export const UAT_STATE = 'uat-accepted';
export const UAT_SIGNOFF_FILE = 'uat-signoff.json';
// The roles that may accept on the business's behalf live in the identity registry gate
// (ACCEPTOR_ROLES) since 2.1.0 row 2.1; re-exported here for the envelope's callers.
export { ACCEPTOR_ROLES as UAT_ROLES } from './identity-registry-check.mjs';
// 2.1.0 (hardening plan 4.5) — the ceiling on a post-implementation review date, days after the
// change went live. The same reasoning as the emergency retrospective: a review date far enough
// out is a review that never happens, spelled as a date.
export const PIR_MAX_DAYS = 90;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
// rc.34 — terminal states (see core/compiled-requirements.mjs TERMINAL_STATES). A closed or
// superseded change ships nothing: it stops contributing compiled requirements, its plan is no
// longer reconciled (profiles move on; a closed change must not go red because a profile did),
// and state receipts no longer apply. What it keeps is its classification — the record of who
// judged it — and its envelope, which stays in the tree as the traceability record.
export { TERMINAL_STATES };
export const CLASSIFIER_ROLES = ['product-owner', 'risk-second-line'];
export const ANCHOR_REQUIRED_TIERS = new Set(['high', 'critical']);
// rc.37 — the tiers that must carry state_history, and the version cutover that makes it
// required. A change classified BEFORE this date keeps passing without one (grandfathered, and
// said out loud); one classified on or after it must record how it moved. An unparseable or
// missing classified_at counts as ON OR AFTER — an unknown input fails toward more control.
export const STATE_HISTORY_REQUIRED_TIERS = new Set(['high', 'critical']);
export const STATE_HISTORY_REQUIRED_FROM = '2026-07-28';
// rc.38 (flow-plan Phase 4.2) — the ITIL change classes. `normal` is the default and the shape of
// every change that existed before this field; naming a class never compiles a different plan.
export const CHANGE_CLASSES = ['standard', 'normal', 'emergency'];
export const DEFAULT_CHANGE_CLASS = 'normal';
// The emergency state sits at the SAME rank as production-authorized — it IS production
// authorization, taken with receipts owed rather than receipts held. It is not a ninth step, and
// it is reachable only by a change that declared change_class "emergency" before it was needed.
export const EMERGENCY_STATE = 'emergency-authorized';
// The ceiling on how far out a retrospective may be pushed. Without it, "emergency" plus a
// deadline in 2099 is a permanent waiver spelled as a deadline.
export const EMERGENCY_RETROSPECTIVE_MAX_DAYS = 10;
// The classifications in docs/governance/data-lifecycle.json that contradict personal_data: false.
export const PERSONAL_CLASSIFICATIONS = new Set(['personal', 'sensitive', 'sensitive-personal', 'special-category']);
// Where the repository keeps its institution profiles (policy-compiler.mjs PROFILE_DIRS).
export const INSTITUTIONS_DIR = 'profiles/institutions';

const at = (state) => STATES.indexOf(state === EMERGENCY_STATE ? 'production-authorized' : state);
const known = (state) => STATES.includes(state) || TERMINAL_STATES.has(state) || state === EMERGENCY_STATE;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const DAY = 86_400_000;

/** True when this envelope must carry state_history (tier + classified on/after the cutover). */
export function stateHistoryRequired(envelope, from = STATE_HISTORY_REQUIRED_FROM) {
  if (!STATE_HISTORY_REQUIRED_TIERS.has(envelope?.risk_tier)) return false;
  const t = Date.parse(envelope?.classification?.classified_at);
  return Number.isNaN(t) || t >= Date.parse(from);
}

/**
 * The append-only transition record. Findings ([] ⇒ well-formed, or absent where it may be);
 * `notices` collects the grandfathering notice — a high-tier change from before the cutover with
 * no history is not a failure, but it is not measurable either, and silence about that is how a
 * "temporary" exemption becomes permanent.
 */
export function checkStateHistory(envelope, { registry = null, notices = null } = {}) {
  const findings = [];
  const id = envelope?.change_id || '(no id)';
  const history = envelope?.state_history;
  const required = stateHistoryRequired(envelope);

  if (history === undefined || history === null) {
    if (required) {
      findings.push(`${id}: ${envelope.risk_tier}-tier change classified on/after ${STATE_HISTORY_REQUIRED_FROM} requires state_history — an append-only [{state, at, by}] record of how it reached ${JSON.stringify(envelope.current_state)} (flow-plan Phase 3.1)`);
    } else if (STATE_HISTORY_REQUIRED_TIERS.has(envelope?.risk_tier)) {
      notices?.push(`${id}: no state_history — grandfathered (classified ${JSON.stringify(envelope?.classification?.classified_at)}, before the ${STATE_HISTORY_REQUIRED_FROM} cutover). Lead time and stage residency are NOT measurable for this change`);
    }
    return findings;
  }
  if (!Array.isArray(history)) return [`${id}: state_history must be an ARRAY of {state, at, by} entries (got ${typeof history})`];
  if (history.length === 0) {
    return required ? [`${id}: state_history is empty — a classified change has at least its own classification transition`] : [];
  }

  let prevIdx = -1;
  let prevAt = -Infinity;
  let terminal = null;
  history.forEach((e, i) => {
    const label = `${id}: state_history[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { findings.push(`${label} must be an object {state, at, by}`); return; }
    if (!known(e.state)) {
      findings.push(`${label}: state ${JSON.stringify(e.state)} is not one of ${STATES.join('|')}|${EMERGENCY_STATE}|${[...TERMINAL_STATES].join('|')}`);
    }
    const t = Date.parse(e.at);
    if (!(typeof e.at === 'string') || Number.isNaN(t)) {
      findings.push(`${label}: at ${JSON.stringify(e.at)} is not an ISO-8601 timestamp — an undated transition cannot be ordered or measured`);
    } else {
      if (t < prevAt) findings.push(`${label}: at ${e.at} precedes the previous entry — state_history is APPEND-ONLY, in transition order`);
      prevAt = Math.max(prevAt, t);
    }
    if (terminal) {
      findings.push(`${label}: ${JSON.stringify(e.state)} recorded after the terminal state ${terminal} — a closed change is closed; resuming work takes a NEW envelope from ${STATES[0]}`);
    }
    if (known(e.state)) {
      if (TERMINAL_STATES.has(e.state)) terminal = e.state;
      else {
        const idx = at(e.state);
        if (idx <= prevIdx) {
          findings.push(`${label}: ${e.state} does not advance the lifecycle (previous ${STATES[prevIdx]}) — the history records forward transitions in the STATES order, never a re-entry or a rewrite`);
        }
        prevIdx = Math.max(prevIdx, idx);
      }
    }
    if (e.by !== undefined) {
      if (!(typeof e.by === 'string' && e.by.trim())) findings.push(`${label}: by must be an identity id from the registry`);
      else if (registry && !identityOf(registry, e.by)) findings.push(`${label}: by ${JSON.stringify(e.by)} is not in the identity registry — an unresolvable actor is not an actor`);
    }
  });

  if (history[0] && history[0].state !== STATES[0]) {
    findings.push(`${id}: state_history begins at ${JSON.stringify(history[0].state)} — every governed change begins at ${STATES[0]}`);
  }
  const last = history[history.length - 1];
  if (last && last.state !== envelope.current_state) {
    findings.push(`${id}: state_history ends at ${JSON.stringify(last.state)} but current_state is ${JSON.stringify(envelope.current_state)} — the history is the record of how the change reached its state, not a parallel account of a different one`);
  }
  return findings;
}

/**
 * rc.38 (flow-plan Phase 4.2) — the emergency route.
 *
 * An emergency change reaches production with receipts still owed. That is the ONLY thing this
 * class buys, and it is bought against a clock: an `emergency` block naming who authorised it,
 * why, and by when the record will be complete. Every outstanding receipt is listed on every run
 * as a NOTICE, so the debt is visible while it is being carried — and the instant the deadline
 * passes with any receipt still owed, EVERY one of them fires as a finding and the build is red.
 *
 * Two ceilings keep this from becoming a waiver with a date on it: the authoriser must be a
 * second-line human (the same rule as the release hold it is standing in for), and the deadline
 * may not be more than EMERGENCY_RETROSPECTIVE_MAX_DAYS after the authorization.
 */
export function checkEmergency(envelope, { registry = null, receipts = [], notices = null, now = Date.now() } = {}) {
  const findings = [];
  const id = envelope?.change_id || '(no id)';
  const em = envelope?.emergency;
  const label = `${id}: emergency authorization`;
  if (!em || typeof em !== 'object' || Array.isArray(em)) {
    // No block at all ⇒ nothing is deferred. The receipts stand exactly as they would have.
    return [`${label} — state ${EMERGENCY_STATE} requires an \`emergency\` block { authorized_by, authorized_at, rationale, retrospective_deadline }; without one there is no clock, and an emergency with no clock is a waiver`, ...receipts];
  }
  for (const f of ['authorized_by', 'authorized_at', 'rationale', 'retrospective_deadline']) {
    if (!isStr(em[f])) findings.push(`${label} — missing ${f}`);
  }
  if (isStr(em.authorized_by) && registry) {
    const who = identityOf(registry, em.authorized_by);
    if (!who || who.kind !== 'human' || !(who.groups || []).includes('second-line')) {
      findings.push(`${label} — authorized_by ${JSON.stringify(em.authorized_by)} is not a second-line HUMAN identity; the emergency authorization stands in for the release hold and is held to the same rule`);
    }
  }
  const authorizedAt = Date.parse(em.authorized_at);
  const deadline = Date.parse(em.retrospective_deadline);
  if (isStr(em.authorized_at) && Number.isNaN(authorizedAt)) findings.push(`${label} — authorized_at ${JSON.stringify(em.authorized_at)} is not a parseable ISO-8601 timestamp`);
  if (isStr(em.retrospective_deadline) && Number.isNaN(deadline)) findings.push(`${label} — retrospective_deadline ${JSON.stringify(em.retrospective_deadline)} is not a parseable ISO-8601 timestamp`);
  if (Number.isNaN(deadline)) return [...findings, ...receipts]; // no readable clock ⇒ nothing deferred
  if (!Number.isNaN(authorizedAt)) {
    if (deadline <= authorizedAt) findings.push(`${label} — retrospective_deadline ${em.retrospective_deadline} does not follow authorized_at ${em.authorized_at}`);
    else if (deadline - authorizedAt > EMERGENCY_RETROSPECTIVE_MAX_DAYS * DAY) {
      findings.push(`${label} — retrospective_deadline ${em.retrospective_deadline} is ${Math.round((deadline - authorizedAt) / DAY)} days after the authorization; the ceiling is ${EMERGENCY_RETROSPECTIVE_MAX_DAYS}. A long enough deadline is a waiver spelled as a deadline`);
    }
  }
  if (now > deadline) {
    if (receipts.length) {
      findings.push(`${label} — the retrospective deadline ${em.retrospective_deadline} has PASSED with ${receipts.length} receipt(s) still outstanding; the emergency class resequences approvals, it never drops them, and the deferral is now over`);
      findings.push(...receipts);
    } else {
      notices?.push(`${id}: the emergency retrospective is complete and its deadline has passed — move the change to ${'production-authorized'} (or ${[...TERMINAL_STATES][0]}) so it stops being reported as an open emergency`);
    }
  } else if (receipts.length) {
    notices?.push(`${id}: EMERGENCY — ${receipts.length} receipt(s) outstanding, due by ${em.retrospective_deadline} (authorised by ${em.authorized_by}): ${receipts.join(' | ')}`);
  }
  return findings;
}

/**
 * 2.1.0 (hardening plan 4.1) — UAT ACCEPTANCE, bound to the release commit.
 *
 * Between delivery-complete and permission-to-launch there was no state in which the BUSINESS
 * said the thing built is the thing asked for: PA2 read the passport's sections and the control
 * functions' signatures, and none of those is a product owner having exercised the software. The
 * sign-off is a file in the change directory (CODEOWNERS-owned, so builders cannot write their
 * own acceptance), accepted by a human holding a business role who is not in the builders group,
 * and naming the 40-hex commit that was accepted — because "we tested the branch" binds to nothing.
 * At production authorization that commit must be the release subject's: what the business
 * accepted is what is being released, or the acceptance evidences a different build.
 */
export function checkUatSignoff(envelope, uat, { registry = null, releaseSubject = null } = {}) {
  const id = envelope?.change_id || '(no id)';
  const state = envelope?.current_state;
  const label = `${id}: state ${state} requires UAT acceptance`;
  if (!uat || typeof uat !== 'object') {
    return [`${label} — ${UAT_SIGNOFF_FILE} is missing; delivery-complete is the builders' word that the work is done, and the business has not yet said it is the work that was asked for`];
  }
  const findings = [];
  if (isStr(uat.change_id) && uat.change_id !== envelope.change_id) findings.push(`${id}: ${UAT_SIGNOFF_FILE} carries change_id ${uat.change_id} — an acceptance for another change`);
  if (uat.status !== 'accepted') findings.push(`${label} — ${UAT_SIGNOFF_FILE} status is ${JSON.stringify(uat.status)}, not "accepted"`);
  for (const k of ['by', 'at', 'release_commit', 'scope']) {
    if (!isStr(uat[k])) findings.push(`${label} — ${UAT_SIGNOFF_FILE} has no ${k}`);
  }
  if (isStr(uat.at) && Number.isNaN(Date.parse(uat.at))) findings.push(`${label} — at ${JSON.stringify(uat.at)} is not a parseable ISO-8601 timestamp`);
  if (isStr(uat.release_commit) && !COMMIT_SHA.test(uat.release_commit)) {
    findings.push(`${label} — release_commit ${JSON.stringify(uat.release_commit)} is not a 40-hex commit sha; acceptance binds to the exact commit the business exercised, never a branch or a tag`);
  }
  // 2.1.0 (row 2.1) — the acceptor resolves through the registry's own rule (human, outside
  // builders, a business role), so acceptance and approval share one definition of "who may".
  if (registry && isStr(uat.by)) findings.push(...resolveAcceptor(registry, uat.by, `${label} — by`));
  const released = releaseSubject?.source?.commit;
  if (at(state) >= at('production-authorized') && isStr(released) && isStr(uat.release_commit) && released !== uat.release_commit) {
    findings.push(`${id}: UAT accepted commit ${uat.release_commit.slice(0, 12)}… is not the release subject's commit ${released.slice(0, 12)}… — what the business accepted is not what is being released`);
  }
  return findings;
}

/**
 * 2.1.0 (hardening plan 4.5) — POST-IMPLEMENTATION REVIEW, on the emergency retrospective's clock.
 *
 * A change in production owes one more look: did it do what the passport said, at the cost the
 * plan said, with the signals the readiness record predicted. The mechanism is the retrospective's
 * — a block with a due date bounded from the moment the change went live, a NOTICE while the date
 * is open, a FINDING the moment it passes with no completed review, and a second-line human on the
 * completed record. Runs on every lane the envelope gate runs on, so a change past its review
 * date turns the tree red rather than waiting for a calendar nobody reads.
 */
export function checkPostImplementationReview(envelope, { registry = null, now = Date.now(), notices = null } = {}) {
  const id = envelope?.change_id || '(no id)';
  const pir = envelope?.post_implementation_review;
  const label = `${id}: post-implementation review`;
  if (!pir || typeof pir !== 'object') {
    return [`${label} — state in-production requires a post_implementation_review block { due, completed_at?, reviewed_by?, outcome?, evidence_ref? }; a live change with no review date is a change nobody will look at again`];
  }
  const findings = [];
  const due = Date.parse(pir.due);
  if (!isStr(pir.due) || Number.isNaN(due)) return [`${label} — due ${JSON.stringify(pir.due)} is not a parseable ISO-8601 timestamp, and a review with no readable date is a review with no date`];
  const live = Date.parse((envelope.state_history || []).find((e) => e?.state === 'in-production')?.at);
  if (!Number.isNaN(live)) {
    if (due <= live) findings.push(`${label} — due ${pir.due} does not follow the in-production transition`);
    else if (due - live > PIR_MAX_DAYS * DAY) findings.push(`${label} — due ${pir.due} is ${Math.round((due - live) / DAY)} days after the change went live; the ceiling is ${PIR_MAX_DAYS}. A review date far enough out is a review that never happens`);
  }
  const completed = Date.parse(pir.completed_at);
  if (isStr(pir.completed_at) && !Number.isNaN(completed)) {
    for (const k of ['reviewed_by', 'outcome', 'evidence_ref']) if (!isStr(pir[k])) findings.push(`${label} — completed but has no ${k}`);
    if (registry && isStr(pir.reviewed_by)) {
      const who = identityOf(registry, pir.reviewed_by);
      if (!who || who.kind === 'agent' || !(who.groups || []).includes('second-line')) {
        findings.push(`${label} — reviewed_by ${JSON.stringify(pir.reviewed_by)} is not a second-line HUMAN identity; the review is held to the retrospective's rule`);
      }
    }
    if (completed > due) notices?.push(`${id}: the post-implementation review was completed ${Math.round((completed - due) / DAY)} day(s) after its due date ${pir.due} — recorded, not blocked`);
  } else if (pir.completed_at !== undefined) {
    findings.push(`${label} — completed_at ${JSON.stringify(pir.completed_at)} is not a parseable ISO-8601 timestamp`);
  } else if (now > due) {
    findings.push(`${label} — due ${pir.due} has PASSED with no completed review; a live change past its review date is the emergency retrospective's defect wearing a normal change's clothes`);
  } else {
    notices?.push(`${id}: post-implementation review due by ${pir.due}`);
  }
  return findings;
}

/**
 * rc.38 (flow-plan Phase 4.7) — FLAG CORROBORATION.
 *
 * The envelope's `flags` decide which conditional profile rules fire, and every one of them only
 * ever ADDS: `model_involved` pulls in the decision log and model validation, `personal_data`
 * pulls in data protection, `third_party` pulls in continuity. So a flag left false is a silent
 * tier reduction, self-declared, requiring no argument and leaving no trace — the one place in
 * the compiler where a builder's own word narrows the route.
 *
 * It cannot be verified in general. It CAN be contradicted, from data the repository already
 * keeps for other reasons: the data-lifecycle register, the model manifest, and the passport's
 * own third-parties analysis. A contradiction is a finding. The absence of one is NOT a pass, and
 * where the corroborating record is missing this says so instead of going quiet.
 *
 * `institutions` adds the fourth record: the repository's own institution profiles (see
 * loadInstitutionProfiles). A flag an institution ASSERTS is not a per-change judgement at all,
 * and an envelope that leaves it false is contradicted by the institution it belongs to.
 */
export function corroborateFlags(envelope, { dataLifecycle = null, modelManifest = null, passport = null, institutions = [], notices = null } = {}) {
  const findings = [];
  const id = envelope?.change_id || '(no id)';
  const flags = envelope?.flags || {};

  const personal = (dataLifecycle?.categories || []).filter((c) => PERSONAL_CLASSIFICATIONS.has(c?.classification));
  if (!flags.personal_data) {
    if (personal.length) {
      findings.push(`${id}: flags.personal_data is ${JSON.stringify(flags.personal_data ?? null)} but docs/governance/data-lifecycle.json classifies ${personal.length} categor${personal.length === 1 ? 'y' : 'ies'} as personal (${personal.slice(0, 3).map((c) => c.category).join(', ')}${personal.length > 3 ? ', …' : ''}) — a flag contradicted by the repository's own register is a finding, not a tier reduction`);
    } else if (!dataLifecycle) {
      notices?.push(`${id}: flags.personal_data is not set and there is no docs/governance/data-lifecycle.json to corroborate it against — NOT VERIFIED`);
    }
  }

  const models = Array.isArray(modelManifest?.models) ? modelManifest.models : [];
  if (!flags.model_involved) {
    if (models.length) {
      findings.push(`${id}: flags.model_involved is ${JSON.stringify(flags.model_involved ?? null)} but docs/governance/model-manifest.json declares ${models.length} model${models.length === 1 ? '' : 's'} (${models.slice(0, 3).map((m) => m.role || m.model_id).join(', ')}) — clear the flag or say which of these the change does not touch`);
    } else if (!modelManifest) {
      notices?.push(`${id}: flags.model_involved is not set and there is no docs/governance/model-manifest.json to corroborate it against — NOT VERIFIED`);
    }
  }

  const tp = passport?.sections?.['third-parties'];
  if (!flags.third_party) {
    const named = tp && typeof tp === 'object' && !Array.isArray(tp)
      ? Object.entries(tp).filter(([, v]) => Array.isArray(v) && v.length > 0)
      : [];
    if (named.length) {
      findings.push(`${id}: flags.third_party is ${JSON.stringify(flags.third_party ?? null)} but the passport's third-parties section names ${named.map(([k, v]) => `${k}: ${v.length}`).join(', ')} — the analysis and the flag disagree, and the flag is the one that decides the route`);
    } else if (tp && typeof tp === 'object' && Object.keys(tp).length > 0) {
      notices?.push(`${id}: flags.third_party is not set and the passport's third-parties section names no parties in a list this gate can read — NOT VERIFIED (declare parties as an array to make the corroboration mechanical)`);
    }
  }

  // The institution's own assertions. Only a `true` assertion binds: asserting a flag false would
  // assert nothing the compiler does not already assume, and an institution cannot declare a flag
  // OFF for a change that legitimately sets it on — the flags only ever add.
  for (const inst of institutions || []) {
    const asserted = inst?.data?.asserts_flags;
    if (!asserted || typeof asserted !== 'object' || Array.isArray(asserted)) continue;
    for (const [flag, value] of Object.entries(asserted)) {
      if (value !== true || flags[flag] === true) continue;
      findings.push(`${id}: flags.${flag} is ${JSON.stringify(flags[flag] ?? null)} but the repository's own institution profile ${inst.path} asserts ${flag}: true of every change here — a flag contradicted by the institution profile is a finding, not a tier reduction (correct the envelope, or the assertion if it is no longer unconditionally true)`);
    }
  }
  return findings;
}

/**
 * The institution profiles a change must NAME. `required_for_all_changes` is how an institution
 * makes its own governance structural rather than opt-in: without it, the profile that carries the
 * institution's approvals, evidence and conformance gates applies only to the changes that chose
 * to be governed by it, and choosing is the builder's.
 *
 * Names resolve the way the compiler resolves them (policy-compiler.mjs findProfile): the bare
 * file name, or a directory-qualified path to the same file.
 */
export function checkRequiredInstitutions(envelope, institutions = []) {
  const findings = [];
  const id = envelope?.change_id || '(no id)';
  const named = new Set((envelope?.required_profiles || []).map((n) => String(n).split('/').pop()));
  for (const inst of institutions || []) {
    if (inst?.data?.required_for_all_changes !== true) continue;
    const accepts = [inst.name, inst.data.profile].filter((n) => typeof n === 'string' && n.trim());
    if (accepts.some((n) => named.has(n.split('/').pop()))) continue;
    findings.push(`${id}: institution profile ${inst.path} declares required_for_all_changes but is not in required_profiles (${[...named].join(', ') || 'none'}) — an institution profile a change can decline to name governs only the changes that agreed to be governed`);
  }
  return findings;
}

/**
 * Findings for one change. `files` gives the sibling artifacts already parsed:
 * { plan, passport, architecture (booleans/objects) }; `registry` resolves identities.
 */
export function evaluate(envelope, { plan, passport, architectureExists, registry, freshPlan, readiness, hold, evidence, notices, patterns, dataLifecycle, modelManifest, institutions = [], diff, uat = null, releaseSubject = null, now = Date.now() } = {}) {
  const findings = [];
  const id = envelope?.change_id || '(no id)';
  if (!known(envelope?.current_state)) {
    findings.push(`${id}: current_state must be one of ${STATES.join('|')}|${EMERGENCY_STATE}|${[...TERMINAL_STATES].join('|')} (got ${JSON.stringify(envelope?.current_state)})`);
    return findings;
  }
  const state = envelope.current_state;
  // rc.38 — the change class. Absent means `normal`, which is what every envelope written before
  // this field was one. An unknown class is a finding rather than a fallback: quietly reading an
  // unrecognised class as `normal` would make a typo in "emergency" look like ordinary governance.
  const changeClass = envelope.change_class ?? DEFAULT_CHANGE_CLASS;
  if (!CHANGE_CLASSES.includes(changeClass)) {
    findings.push(`${id}: change_class must be one of ${CHANGE_CLASSES.join('|')} (got ${JSON.stringify(envelope.change_class)})`);
  }
  if (state === EMERGENCY_STATE && changeClass !== 'emergency') {
    findings.push(`${id}: current_state ${EMERGENCY_STATE} is reachable only by a change classified change_class "emergency" (this one is ${JSON.stringify(changeClass)}) — the emergency route is declared, not discovered at the moment it is convenient`);
  }

  // The transition record is validated in EVERY state, terminal included: a closed change's
  // history is exactly the record the flow metrics read, and closure is itself a transition.
  findings.push(...checkStateHistory(envelope, { registry, notices }));

  // A terminal change (closed/superseded) ships nothing: no plan reconciliation (profiles move
  // on), no state receipts, no exemption clock. What it must keep is the record of who judged
  // it — the classification stays required. Closing a change is abandonment, not a bypass: the
  // moment work resumes it needs a new envelope taking the full route from `classified`.
  if (TERMINAL_STATES.has(state)) {
    if (!envelope.classification?.classified_by) {
      findings.push(`${id}: terminal state ${state} still requires classification.classified_by — the record of who judged the change survives its closure`);
    }
    return findings;
  }

  // Reconciliation, both halves: the stored plan's CONTENT must match its own hash (a
  // hand-edit that keeps the old hash is still an edit), and that hash must match a fresh
  // compile (a stale plan is not this envelope's plan).
  if (!plan) findings.push(`${id}: no stored control plan — run the policy compiler (an unplanned change is blocked)`);
  else {
    if (planHash(plan) !== plan.plan_hash) {
      findings.push(`${id}: stored control plan content does not match its own plan_hash — the plan was edited by hand after compilation`);
    }
    if (freshPlan && plan.plan_hash !== freshPlan.plan_hash) {
      findings.push(`${id}: stored control plan does not reconcile with a fresh compile (stored ${String(plan.plan_hash).slice(0, 12)}… ≠ compiled ${freshPlan.plan_hash.slice(0, 12)}…) — the plan is stale`);
    }
  }
  const effective = freshPlan || plan;

  // The classifier is a human with authority — the agent cannot set or lower the tier.
  const clsBy = envelope.classification?.classified_by;
  if (!clsBy) findings.push(`${id}: classification.classified_by missing — a classification must have a named, resolvable owner`);
  else if (registry) {
    const who = identityOf(registry, clsBy);
    if (!who) findings.push(`${id}: classifier ${clsBy} is not in the identity registry`);
    else {
      if (who.kind === 'agent') findings.push(`${id}: classifier ${clsBy} is an AGENT — the agent cannot set or lower the risk tier`);
      if (!(who.roles || []).some((r) => CLASSIFIER_ROLES.includes(r))) {
        findings.push(`${id}: classifier ${clsBy} holds none of the classification roles (${CLASSIFIER_ROLES.join(', ')})`);
      }
    }
  }

  // rc.38 (Phase 4.3) — a `standard` change rides a pre-approved pattern. The claim is evaluated
  // BEFORE the receipts, because a covered change's PA receipts were given on the pattern. Every
  // failed condition is a finding AND drops coverage, so the fallback is always toward MORE route.
  let patternCovered = false;
  if (changeClass === 'standard') {
    if (!isStr(envelope.pattern_claim?.pattern_id)) {
      findings.push(`${id}: change_class "standard" requires pattern_claim.pattern_id — a standard change is one that rides a pre-approved pattern; without one it is a normal change`);
    } else {
      const entry = patterns?.get(envelope.pattern_claim.pattern_id) || null;
      const res = evaluateClaim(envelope, entry, { plan: effective, registry, identityOf, now, diff });
      findings.push(...res.findings);
      for (const n of res.notices) notices?.push(n);
      patternCovered = res.covered;
    }
  } else if (envelope.pattern_claim !== undefined) {
    findings.push(`${id}: pattern_claim is recorded on a ${JSON.stringify(changeClass)} change — only change_class "standard" rides a pattern, and a claim that grants nothing is a claim nobody checks`);
  }

  // State receipts — a state without its gate evidence is a self-declaration.
  //
  // rc.38: they are collected rather than pushed, because two mechanisms RESEQUENCE them.
  // `receipts` is the compound authorization; `deferrable` says whether this change is entitled
  // to owe them for a stated, bounded period. Neither mechanism removes an entry from this list.
  const receipts = [];
  if (effective) {
    const gates = new Set(effective.required_gates || []);
    if (at(state) >= at('permission-to-develop') && gates.has('PA1') && passport?.pa1?.decision !== 'approved' && !patternCovered) {
      receipts.push(`${id}: state ${state} requires PA1 approved — the product passport says ${JSON.stringify(passport?.pa1?.decision)} (a high-risk change cannot enter Develop without PA1)`);
    }
    if (at(state) >= at('in-delivery') && gates.has('A') && !architectureExists) {
      receipts.push(`${id}: state ${state} requires architecture assurance (A1–A5) — architecture-assurance.json is missing (an unresolved A-gate blocks backlog creation)`);
    }
    // 2.1.0 (hardening plan 4.6) — a tier that compiles the threat model WITHOUT the full A gate
    // (medium, in the shipped base profile) still owes the artifact that carries A2.
    // A change riding a pre-approved pattern was threat-modelled when the PATTERN was approved
    // (its shape, its size ceiling, its paths); a per-instance model for each dependency patch
    // would be ceremony. Coverage is verified above, and a failed claim brings the receipt back.
    if (at(state) >= at('in-delivery') && !gates.has('A') && effective.required_capabilities?.threat_model?.required && !architectureExists && !patternCovered) {
      receipts.push(`${id}: state ${state} requires a threat model (A2) — the plan compiles threat_model at this tier and architecture-assurance.json is missing; a medium change still has attackers`);
    }
    // 2.1.0 (hardening plan 4.1) — the business accepts before launch is asked for. Collected as a
    // receipt so the emergency route resequences it like the rest, and never drops it.
    if (at(state) >= at(UAT_STATE) && !patternCovered) {
      receipts.push(...checkUatSignoff(envelope, uat, { registry, releaseSubject }));
    }
    if (at(state) >= at('permission-to-launch') && gates.has('PA2') && passport?.pa2?.decision !== 'approved' && !patternCovered) {
      receipts.push(`${id}: state ${state} requires PA2 approved — the product passport says ${JSON.stringify(passport?.pa2?.decision)}`);
    }

    // Operational readiness: every declared service must be R-gate green (1.12).
    if (at(state) >= at('operationally-ready')) {
      const services = envelope.service_ids;
      if (!Array.isArray(services) || services.length === 0) {
        receipts.push(`${id}: state ${state} but the envelope declares no service_ids — readiness of nothing is not readiness`);
      }
      for (const s of readiness?.missing || []) {
        receipts.push(`${id}: state ${state} requires operational readiness for service ${s} — docs/governance/services/${s}.json is missing`);
      }
      for (const f of readiness?.findings || []) receipts.push(`${id}: ${f}`);
    }

    // Production authorization is COMPOUND (1.12): PA2 + readiness (above) + the second-line
    // hold released by a second-line human + externally-attested evidence for high tiers.
    // "A human approved" is not production authorization.
    if (at(state) >= at('production-authorized')) {
      if (!hold) {
        receipts.push(`${id}: state ${state} with no release-hold.json — a missing hold means HELD (fail closed), and only the second line releases it`);
      } else {
        if (hold.status !== 'released') {
          receipts.push(`${id}: state ${state} but the second-line release hold is ${JSON.stringify(hold.status)} — builders and agents cannot release it`);
        }
        if (registry) {
          const who = identityOf(registry, hold.by);
          if (!who || who.kind === 'agent' || !(who.groups || []).includes('second-line')) {
            receipts.push(`${id}: release hold ${hold.status} by ${JSON.stringify(hold.by)} — the hold is operated only by a second-line HUMAN identity`);
          }
        }
      }
      if (ANCHOR_REQUIRED_TIERS.has(envelope.risk_tier)) {
        if (!evidence?.anchor) {
          receipts.push(`${id}: ${envelope.risk_tier}-tier production authorization requires externally-anchored evidence — the evidence manifest has no anchor`);
        } else {
          for (const f of evidence.attestationFindings || []) receipts.push(`${id}: ${f}`);
        }
      }
    }
  }
  // The emergency route (Phase 4.2) is the ONLY thing that may hold a receipt back, and only in
  // the emergency state, only for a declared change, and only until a bounded deadline.
  if (changeClass === 'emergency' && state === EMERGENCY_STATE) {
    findings.push(...checkEmergency(envelope, { registry, receipts, notices, now }));
  } else {
    findings.push(...receipts);
  }

  // 2.1.0 (hardening plan 4.5) — once live, the change owes its post-implementation review on a clock.
  if (state === 'in-production') findings.push(...checkPostImplementationReview(envelope, { registry, now, notices }));

  // rc.38 (Phase 4.7) — the flags that decide the route are corroborated against the repo's data,
  // including the institution profiles' own assertions, and the profiles an institution requires
  // of every change are required whether or not this envelope thought to name them.
  findings.push(...corroborateFlags(envelope, { dataLifecycle, modelManifest, passport, institutions, notices }));
  findings.push(...checkRequiredInstitutions(envelope, institutions));

  // Exemptions: owned, reasoned, compensated, expiring, second-line approved. Expired blocks.
  for (const ex of envelope.exemptions || []) {
    const label = `${id}: exemption ${ex.control || '(unnamed)'}`;
    for (const f of ['control', 'owner', 'rationale', 'compensating_control', 'expires', 'approved_by']) {
      if (!(typeof ex[f] === 'string' && ex[f].trim())) findings.push(`${label} — missing ${f}`);
    }
    if (ex.expires && !Number.isNaN(Date.parse(ex.expires)) && Date.parse(ex.expires) < Date.now()) {
      findings.push(`${label} — EXPIRED ${ex.expires}: an expired exemption blocks the change`);
    }
    if (registry && ex.approved_by) {
      const who = identityOf(registry, ex.approved_by);
      if (!who || !(who.groups || []).includes('second-line')) {
        findings.push(`${label} — approved_by ${ex.approved_by} is not a second-line identity (exemptions need independent approval)`);
      }
    }
  }
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * Every institution profile the repository keeps — `[{ name, path, data }]`, empty when there is
 * no profiles/institutions/ at all (most repositories; the directory is optional).
 *
 * ALL of them, deliberately: an envelope that omits the institution profile is exactly the case
 * these assertions exist to catch, so reading only the profiles the envelope named would ask the
 * envelope to incriminate itself.
 *
 * Two things are NOT an institution's declaration and are skipped: a `*.template.json`, and a
 * profile still carrying an `ADOPT:` placeholder as its name. Both ship in the harness with
 * example values filled in, and a template asserting an example flag over every envelope in every
 * adopting repository would be a fabricated institutional declaration — the exact defect the
 * ADOPT: marker exists to make visible.
 */
export function loadInstitutionProfiles(cwd = process.cwd()) {
  const dir = `${cwd}/${INSTITUTIONS_DIR}`;
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries.filter((n) => n.endsWith('.json') && !n.endsWith('.template.json')).sort()) {
    const data = readJson(`${dir}/${name}`);
    if (!data || (typeof data.profile === 'string' && data.profile.startsWith('ADOPT:'))) continue;
    out.push({ name: name.replace(/\.json$/, ''), path: `${INSTITUTIONS_DIR}/${name}`, data });
  }
  return out;
}

/**
 * rc.38 — the diff a pattern claim is reconciled against, or null when it cannot be computed.
 * `null` is a real answer here, not a pass: evaluateClaim() records the claim as NOT VERIFIED.
 */
export function diffSince(base, cwd = process.cwd()) {
  if (!isStr(base)) return null;
  try {
    const g = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const paths = g(['diff', '--name-only', `${base}...HEAD`]).trim().split('\n').filter(Boolean);
    const stat = g(['diff', '--numstat', `${base}...HEAD`]).trim().split('\n').filter(Boolean);
    const lines = stat.reduce((n, row) => {
      const [add, del] = row.split('\t');
      return n + (Number(add) || 0) + (Number(del) || 0);
    }, 0);
    return { paths, lines };
  } catch { return null; }
}

export function run(cwd = process.cwd(), { baseRef = null, now = Date.now() } = {}) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return { findings: [], notices: [], count: 0 }; // no governed changes yet — nothing to check
  const registry = loadRegistry(cwd);
  // rc.38 — corroboration inputs (Phase 4.7) and the diff a pattern claim is checked against
  // (Phase 4.3). Both are loaded ONCE: they are repository-wide records, not per-change ones.
  const dataLifecycle = readJson(`${cwd}/docs/governance/data-lifecycle.json`);
  const modelManifest = readJson(`${cwd}/docs/governance/model-manifest.json`);
  // The institution's own assertions about its changes — repository-wide, so loaded once and read
  // for every envelope, including the envelopes that never named an institution profile.
  const institutions = loadInstitutionProfiles(cwd);
  const diff = diffSince(baseRef, cwd);
  const findings = [];
  const notices = [];
  if (isStr(baseRef) && !diff) {
    notices.push(`--base ${baseRef} was given but the diff could not be computed here (no git history, or an unknown ref) — pattern claims are reported NOT VERIFIED rather than treated as checked`);
  }
  let count = 0;
  for (const name of readdirSync(dir)) {
    const base = `${dir}/${name}`;
    const envelope = readJson(`${base}/change-envelope.json`);
    if (!envelope) { findings.push(`${name}: no parseable change-envelope.json`); continue; }
    count++;
    // Terminal changes are validated for their record only — no fresh compile (their profiles
    // may have moved on or been retired; a closed change must not go red because a profile did).
    if (TERMINAL_STATES.has(envelope.current_state)) {
      findings.push(...evaluate(envelope, { registry, notices, now }));
      continue;
    }
    const plan = readJson(`${base}/${envelope.control_plan || 'control-plan.json'}`);
    const passport = readJson(`${base}/product-passport.json`);
    const architectureExists = existsSync(`${base}/architecture-assurance.json`);
    const context = resolveProfileContext(envelope, cwd);
    const profiles = context.profiles;
    findings.push(...context.findings.map((f) => `${envelope.change_id}: ${f}`));
    // rc.38 — the pre-approved patterns THIS change's own profiles declare. Scoped to the
    // envelope's profiles on purpose: a pattern approved for one product line is not a standing
    // pre-approval across the estate.
    const { patterns, findings: patf } = collectPatterns(profiles);
    findings.push(...patf.map((f) => `${envelope.change_id}: ${f}`));
    // rc.8 WS4: recompile with the SAME profile-content bindings the plan was written from, so a
    // revised profile (or a BrainKit that an institution profile pins) makes the stored plan stale.
    const { plan: freshPlan, findings: cf } = compile(context.envelope, profiles, context.bindings);
    findings.push(...cf.map((f) => `${envelope.change_id}: ${f}`));
    // 1.12 context: R-gate results per declared service, the second-line hold, the evidence anchor.
    const readiness = { missing: [], findings: [] };
    for (const s of envelope.service_ids || []) {
      const sr = readJson(`${cwd}/${SERVICES_DIR}/${s}.json`);
      if (!sr) readiness.missing.push(s);
      // rc.36: observation-shaped drills verify their observer and signature — pass the registry
      // and issuers so a signed drill judged here is judged by the same stack as the R gate.
      // rc.39: and this change's OWN plan decides whether R3b (progressive delivery) is required
      // of the services it declares — the R gate asks the repository-wide question, the envelope
      // gate asks it of the change in hand.
      else readiness.findings.push(...evaluateReadiness(sr, Date.now(), {
        registry,
        issuers: loadIssuers(cwd),
        exposureRequired: Boolean(plan?.required_capabilities?.exposure_control?.required),
      }));
    }
    const hold = readJson(`${base}/release-hold.json`);
    // 2.1.0 — the business acceptance (per change) and the release subject it must bind to.
    const uat = readJson(`${base}/${UAT_SIGNOFF_FILE}`);
    const releaseSubject = readJson(`${cwd}/docs/governance/release-subject.json`);
    const manifest = readJson(`${cwd}/docs/governance/evidence/manifest.json`);
    const evidence = manifest && {
      anchor: manifest.anchor,
      attestationFindings: verifyAnchorAttestation(manifest, loadIssuers(cwd)),
    };
    findings.push(...evaluate(envelope, { plan, passport, architectureExists, registry, freshPlan, readiness, hold, evidence, notices, patterns, dataLifecycle, modelManifest, institutions, diff, uat, releaseSubject, now }));
  }
  return { findings, notices, count };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const bi = argv.indexOf('--base');
  const { findings, notices, count } = run(process.cwd(), { baseRef: bi >= 0 ? argv[bi + 1] : null });
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nChange-envelope gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe envelope is the governed change object: classified by a human with authority,\nplanned by the compiler, reconciled at execution, advancing only with receipts.\n');
    process.exit(1);
  }
  process.stdout.write(`Change-envelope gate — OK (${count} governed change${count === 1 ? '' : 's'})\n`);
}
