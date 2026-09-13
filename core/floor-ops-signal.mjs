// Operations-signal intake — the floor half of the round trip (Factory Floor WS6 · D6.1). Somebody
// on a collaboration surface files a card: "the consent refresh 500'd for twelve minutes". This
// module is what turns that card into an entry the loop-closing gate already ships
// (`scripts/operations-signal-check.mjs`) will accept, and into a record that can be followed back
// to the card afterwards.
//
// IT IS NOT A SECOND SIGNAL SCHEMA, and that is the first thing to understand about it. The
// vocabulary — the types, the severities, the four routes and what each route must trace to — is
// IMPORTED from that gate, not restated here. There is exactly one list of routes in this harness
// and it lives in the gate that enforces them. `roundTrip()` finishes by calling that gate's own
// `evaluate()` over the log it just proposed, so "passing its check" is a fact about the artifact
// rather than a claim in a comment. A second copy of the taxonomy would drift, and the drift would
// be invisible: a signal typed against the floor's list, routed against the floor's rules, landing
// in a log the gate reads with a different list.
//
// A SIGNAL IS A CLAIM, NOT A FINDING. Whoever files it types and rates it — that is the point of
// letting them file it at all, because the person holding the pager knows more at 02:00 than any
// taxonomy does. But their type and their rating are INPUTS TO TRIAGE, never its verdict, and the
// shape here makes that structural rather than cultural:
//
//   - The filer may not route. A `route` or a `status` present at filing time is refused (OS-R05),
//     not quietly dropped, because a card that arrives pre-routed is a verdict wearing a claim's
//     clothes and the next reader cannot tell the difference.
//   - The adjudication must state its OWN type and rating. Silence is not agreement (OS-R01/R02):
//     an adjudicator who leaves the rating blank has not rated it, and a filed `critical` must
//     never become an adjudicated `critical` by default. Where the two differ, `reclassified` says
//     so in the record — so a downgrade is a visible act with a name against it.
//   - The filer may not be the adjudicator (OS-R06). Same reason nobody attests to their own
//     identity binding and no builder issues their own second-line approval.
//   - An unadjudicated signal has no entry at all. `state: 'filed'` derives NO log entry — not a
//     reduced one, not a draft one. There is no shape in which an untriaged signal reads as routed.
//
// TRACEABILITY IS THE ACCEPTANCE CRITERION, so it travels IN the artifact. `filed_digest` is a
// digest over the normalised claim exactly as filed, which fixes what was filed even after somebody
// edits the card — and editing the card is the normal case, not the adversarial one. Beside it: who
// filed it, when, which card (`surface_ref`), who adjudicated it, when, and what they changed. That
// block rides along inside the log entry, because a record whose provenance lives in a different
// file is a record whose provenance goes missing the first time someone copies a row.
//
// PERSONAL DATA IS THIS SEAM'S PROBLEM SPECIFICALLY. `core/floor-project.mjs` says out loud that
// its content ceiling is DIRECTIONAL — it governs git → floor and has no visibility into what a
// person types into a floor page. This is the other direction: a human writing prose about an
// incident, which is to say prose about a customer, heading into git where it is permanent. So the
// free text is scanned with `core/floor-pii.mjs` before anything is proposed. Read that module's
// header before trusting this: a hit is a refusal, and NO HIT IS NOT A CLEARANCE. It matches
// shapes, and the sentence "she called three times about her husband's account" has no shape.
//
// NO CLOCK, NO NETWORK, NO WRITE. Every instant in here is one somebody recorded — the filing time
// and the adjudication time — and the only comparison made between them is their order, which is
// the same on every machine forever. `roundTrip()` returns the file content a pull request would
// carry; it does not open the pull request, and it does not write the file. The bridge transcribes
// and a human merges (D5.2), which is why `transcribed_by` is pinned to one identity and why the
// proposal says in its own text that it is a proposal.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AUTHORITY_FIELDS, canonical, sha256 } from './floor-project.mjs';
import { liveFindings, scanText } from './floor-pii.mjs';
import {
  ROUTES,
  SEVERITIES,
  TYPES,
  evaluate as evaluateOperationsSignalLog,
} from '../scripts/operations-signal-check.mjs';

export const SCHEMA_ID = 'loom.ops-signal-intake/v1';

/** The git-side log this round trip proposes into — `operations-signal-check.mjs`'s first location. */
export const LOG_PATH = 'docs/governance/operations-signal.json';

/**
 * From `core/floor-templates.mjs`'s WRITE_CLASSES vocabulary. A filed signal is not born on the
 * floor and left there, and it is not a mirror of git: it is a decision routed off the floor into
 * a pull request. That is the banner an author has to understand before they type.
 */
export const WRITE_CLASS = 'decision-routed';

/**
 * The one identity permitted to transcribe an intake into a proposal (D5.2). The bridge proves
 * custody, never authority: it carries the card's words into a branch and stops. Pinning it here is
 * what lets its capabilities be probed as one thing, exactly as D1.1 pins the projector.
 */
export const TRANSCRIBER_IDENTITY = 'svc-floor-bridge';

/** The two states an intake record can hold. There is no third, and no `routed` without an adjudication. */
export const STATES = Object.freeze(['filed', 'triaged']);

/**
 * The label, verbatim. A constant rather than a parameter for the reason `core/floor-project.mjs`
 * gives: a configurable banner is a banner someone eventually configures away, and this is the
 * sentence that has to survive being screenshotted into a triage channel.
 */
export const NON_AUTHORITATIVE = 'NON-AUTHORITATIVE INTAKE — a filed signal is a CLAIM, not a finding. The filer\'s type and rating are inputs to triage, never its verdict, and nothing here is routed until an adjudication by somebody other than the filer says so. This approves nothing, releases nothing and holds nothing. The record of a triaged signal is the merged operations-signal log in git.';

/**
 * Every rejection this module can emit, with the reason an operator reading a red build will need.
 * Exported so the contract can be read without reading the source — and asserted against the
 * source by the test suite, so a code documented here and never emitted fails the build.
 */
export const REJECTIONS = new Map([
  ['OS-R01', 'no type — at filing, or in the adjudication. An untyped signal cannot be routed, and an adjudicator who leaves the type blank has not typed it: silence is not agreement with the filer'],
  ['OS-R02', 'no rating — at filing, or in the adjudication. The filer\'s rating is a required INPUT; the adjudicator\'s is a required verdict, and a filed severity must never become an adjudicated one by default'],
  ['OS-R03', 'a type, rating or route outside the vocabulary the gate reads — the taxonomy is imported from scripts/operations-signal-check.mjs, so an unknown value here is a value no route resolves'],
  ['OS-R04', 'an intake that collides with a signal id already in the log — a re-filed card is a no-op, never a silent overwrite of what triage already decided'],
  ['OS-R05', 'presented as routed without an adjudication: a route or status set by the filer, an adjudication missing its adjudicator or its instant, an adjudication dated before the filing it judges, or a filed-only record written into the log'],
  ['OS-R06', 'the filer is also the adjudicator — nobody adjudicates their own signal, for the same reason nobody attests to their own identity binding'],
  ['OS-R07', 'an intake that cannot be followed back: no filer, no filing instant, no reference to the card it was filed on, no digest over what was filed, or a log entry that lost its intake block'],
  ['OS-R08', 'a personal-data shape in floor-authored free text — this is the direction the projection\'s content ceiling cannot see, and git is permanent. A hit refuses; no hit is not a clearance'],
  ['OS-R09', 'the proposed log does not pass scripts/operations-signal-check.mjs — the loop-closing gate is the acceptance criterion, and it is called here rather than re-implemented'],
  ['OS-R10', 'an unlabelled intake record, or one carrying a field that would read as governance authority — a triage card that looks like an approval is indistinguishable from one on a screen'],
  ['OS-R11', 'transcribed by an identity other than svc-floor-bridge — the bridge proves custody and nothing else, and one identity is what makes its capabilities probeable'],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/** ISO-8601 only, and the TYPE is part of the check — the stance of every other contract here. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/** The free-text fields a human types. These are what the personal-data scan reads. */
export const FREE_TEXT = Object.freeze(['summary', 'justification']);

/**
 * The claim, normalised. Key order is fixed by construction and unknown keys are dropped, so the
 * digest below is over a canonical shape rather than over whatever the surface happened to send.
 * Dropping rather than refusing is deliberate here and only here: a collaboration surface adds
 * properties constantly (assignee, emoji, last-edited-by) and none of them is part of the claim.
 */
export function filedClaim(input = {}) {
  const out = {
    id: input.id,
    source: input.source,
    surface_ref: input.surface_ref,
    filed_by: input.filed_by,
    filed_at: input.filed_at,
    type: input.type,
    severity: input.severity,
    summary: input.summary,
  };
  if (input.evidence_ref !== undefined) out.evidence_ref = input.evidence_ref;
  // Preserved, never honoured: see OS-R05. Carrying it is how the refusal can name it.
  if (input.route !== undefined) out.route = input.route;
  if (input.status !== undefined) out.status = input.status;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return Object.freeze(out);
}

/** The digest that fixes what was filed, even after somebody edits the card. */
export const filedDigest = (claim) => sha256(canonical(claim));

/** Findings for a personal-data scan over one text. Synthetic matches are notices, never silence. */
function scanFreeText(text, where, findings, notices) {
  if (!isStr(text)) return;
  const result = scanText(text, { where });
  for (const f of liveFindings(result)) {
    findings.push(`OS-R08: ${where}: ${f.label} at line ${f.line}:${f.column} (${f.redacted}) — ${f.why}. The floor→git direction is the one the projection's content ceiling cannot see, and a merge is permanent`);
  }
  for (const f of (result.findings || []).filter((x) => x.synthetic)) {
    notices.push(`${where}: ${f.label} at line ${f.line}:${f.column} carries this repository's synthetic marker — reported, not suppressed. ${result.statement}`);
  }
}

/** Which of the filer's two ratings the adjudicator changed. `[]` ⇒ the adjudicator restated both. */
export function reclassifiedBetween(filed, adjudication) {
  const out = [];
  for (const field of ['type', 'severity']) {
    if (filed?.[field] !== adjudication?.[field]) {
      out.push({ field, filed: filed?.[field] ?? null, adjudicated: adjudication?.[field] ?? null });
    }
  }
  return out;
}

/**
 * Type and rate one signal, and — where an adjudication is present — route it.
 *
 * `filed`      the card as filed: { id, source, surface_ref, filed_by, filed_at, type, severity,
 *              summary, evidence_ref? }. A `route` or `status` here is a finding, not a shortcut.
 * `adjudication` (optional) { adjudicated_by, adjudicated_at, type, severity, route, link?,
 *              justification?, status? }. Absent ⇒ the signal is filed and NOT routed.
 * `opts`       { transcribedBy }.
 *
 * Returns { record, entry, findings, notices }.
 *
 *   `record` is the labelled, non-authoritative intake record — null when there are findings.
 *   `entry`  is the git-side operations-signal entry, in exactly the shape the existing gate reads
 *            — null for a filed-only signal, and null when there are findings. There is no reduced
 *            form: a signal that cannot be routed is not published half-routed.
 */
export function intake({ filed, adjudication = null } = {}, { transcribedBy = TRANSCRIBER_IDENTITY } = {}) {
  const findings = [];
  const notices = [];
  const nothing = () => ({ record: null, entry: null, findings, notices });

  if (!filed || typeof filed !== 'object' || Array.isArray(filed)) {
    findings.push('OS-R07: no filed signal — there is nothing here to follow back to');
    return nothing();
  }
  const claim = filedClaim(filed);
  const at = isStr(claim.id) ? `signal ${claim.id}` : 'signal (unnamed)';

  // Traceability first: a signal nobody can follow back is not improved by being well typed.
  if (!isStr(claim.id)) findings.push('OS-R07: the filed signal carries no id — an unnamed signal cannot be deduplicated, cited or followed');
  if (!isStr(claim.filed_by)) findings.push(`OS-R07: ${at}: no filer — an unattributed claim is a rumour, and triage has nobody to go back to`);
  if (!isStr(claim.surface_ref)) findings.push(`OS-R07: ${at}: no surface_ref — nothing points back at the card that was filed, so "what was filed" is unrecoverable the moment somebody edits it`);
  if (!isStr(claim.source)) findings.push(`OS-R07: ${at}: no source — which operation produced this is part of following it back`);
  if (parseTime(claim.filed_at) === null) findings.push(`OS-R07: ${at}: filed_at is missing or not a parseable ISO-8601 instant — this module has no clock, so an unstamped filing cannot be ordered against its own adjudication`);

  if (!isStr(claim.type)) findings.push(`OS-R01: ${at}: filed with no type — the filer types it, and an untyped signal cannot be routed`);
  else if (!TYPES.has(claim.type)) findings.push(`OS-R03: ${at}: filed type ${JSON.stringify(claim.type)} is not one of ${[...TYPES].join('|')} — the taxonomy is the gate's, not the floor's`);
  if (!isStr(claim.severity)) findings.push(`OS-R02: ${at}: filed with no rating — the filer rates it, and that rating is a required input to triage even though it is not its verdict`);
  else if (!SEVERITIES.has(claim.severity)) findings.push(`OS-R03: ${at}: filed severity ${JSON.stringify(claim.severity)} is not one of ${[...SEVERITIES].join('|')}`);

  // The filer does not route. Refused rather than dropped: a card that arrives pre-routed must be
  // sent back, because the next reader cannot tell a claim that looks like a verdict from a verdict.
  if (claim.route !== undefined) findings.push(`OS-R05: ${at}: the filed card already carries route ${JSON.stringify(claim.route)} — the filer files, triage routes. A rating is an input, never a verdict, and a pre-routed card reads as adjudicated by whoever happened to type it`);
  if (claim.status !== undefined) findings.push(`OS-R05: ${at}: the filed card already carries status ${JSON.stringify(claim.status)} — triage state is set by triage`);

  scanFreeText(claim.summary, `${at} · summary`, findings, notices);
  if (adjudication) scanFreeText(adjudication.justification, `${at} · justification`, findings, notices);
  if (transcribedBy !== TRANSCRIBER_IDENTITY) {
    findings.push(`OS-R11: ${at}: transcribed_by is ${JSON.stringify(transcribedBy)}, not ${TRANSCRIBER_IDENTITY} — the bridge transcribes; it does not triage, and it is one identity so its capabilities can be probed as one thing`);
  }

  let adj = null;
  if (adjudication !== null) {
    if (typeof adjudication !== 'object' || Array.isArray(adjudication)) {
      findings.push(`OS-R05: ${at}: the adjudication is not an object — an unreadable adjudication must never read as a route`);
      return nothing();
    }
    if (!isStr(adjudication.adjudicated_by)) findings.push(`OS-R05: ${at}: the adjudication names no adjudicator — a route nobody signed for is the signal falling on the floor with extra steps`);
    const adjAt = parseTime(adjudication.adjudicated_at);
    if (adjAt === null) findings.push(`OS-R05: ${at}: adjudicated_at is missing or not a parseable ISO-8601 instant`);
    const filedAt = parseTime(claim.filed_at);
    if (adjAt !== null && filedAt !== null && adjAt < filedAt) {
      findings.push(`OS-R05: ${at}: adjudicated at ${adjudication.adjudicated_at}, BEFORE it was filed at ${claim.filed_at} — a verdict that predates its claim is not an adjudication of it. Both instants are recorded, so this comparison is the same on every machine forever`);
    }
    if (isStr(adjudication.adjudicated_by) && adjudication.adjudicated_by === claim.filed_by) {
      findings.push(`OS-R06: ${at}: ${claim.filed_by} filed it and adjudicated it — the rating would be its own verdict, and the second pair of eyes triage exists to provide would be the first pair again`);
    }
    if (!isStr(adjudication.type)) findings.push(`OS-R01: ${at}: the adjudication states no type — silence is not agreement with the filer, and an unstated type would inherit a claim as a finding`);
    else if (!TYPES.has(adjudication.type)) findings.push(`OS-R03: ${at}: adjudicated type ${JSON.stringify(adjudication.type)} is not one of ${[...TYPES].join('|')}`);
    if (!isStr(adjudication.severity)) findings.push(`OS-R02: ${at}: the adjudication states no rating — an adjudicator who leaves it blank has not rated it, and a filed \`critical\` must never become an adjudicated \`critical\` by default`);
    else if (!SEVERITIES.has(adjudication.severity)) findings.push(`OS-R03: ${at}: adjudicated severity ${JSON.stringify(adjudication.severity)} is not one of ${[...SEVERITIES].join('|')}`);
    if (!isStr(adjudication.route)) findings.push(`OS-R05: ${at}: the adjudication sets no route — an adjudication that routes nowhere leaves the signal exactly where an untriaged one sits`);
    else if (!ROUTES.has(adjudication.route)) findings.push(`OS-R03: ${at}: route ${JSON.stringify(adjudication.route)} is not one of ${[...ROUTES].join('|')} — what each route must trace to is the gate's table, and an invented route traces to nothing`);

    adj = {
      adjudicated_by: adjudication.adjudicated_by,
      adjudicated_at: adjudication.adjudicated_at,
      type: adjudication.type,
      severity: adjudication.severity,
      route: adjudication.route,
    };
    // 2.1.0 (hardening plan 4.7): the regulator-notification position is the ADJUDICATOR's
    // determination, carried verbatim — the gate then holds it to its clock and its reference.
    for (const k of ['link', 'justification', 'status', 'regulator_notification']) {
      if (adjudication[k] !== undefined) adj[k] = adjudication[k];
    }
  }

  if (findings.length) return nothing();

  const digest = filedDigest(claim);
  const reclassified = adj ? reclassifiedBetween(claim, adj) : [];
  const record = {
    _comment: 'GENERATED by core/floor-ops-signal.mjs. NON-AUTHORITATIVE: the record of a triaged signal is the merged operations-signal log in git. Do not hand-edit — `filed_digest` is over the claim exactly as filed, and verifyIntake() re-derives it.',
    schema: SCHEMA_ID,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    write_class: WRITE_CLASS,
    state: adj ? 'triaged' : 'filed',
    signal_id: claim.id,
    filed: { ...claim },
    filed_digest: digest,
    adjudication: adj,
    reclassified,
    transcribed_by: transcribedBy,
  };

  if (!adj) {
    notices.push(`${at}: filed, not routed — it derives no log entry. It exits triage when somebody other than ${claim.filed_by} adjudicates it; until then there is no shape in which it reads as routed`);
    return { record, entry: null, findings: [], notices };
  }
  if (reclassified.length) {
    notices.push(`${at}: re-rated in triage by ${adj.adjudicated_by} — ${reclassified.map((r) => `${r.field} ${JSON.stringify(r.filed)} → ${JSON.stringify(r.adjudicated)}`).join(', ')}. The filed values stay in the record; a downgrade is a visible act with a name against it`);
  }

  const entry = entryFrom(record);
  // The gate that owns the taxonomy is the one that says whether this entry is acceptable. Calling
  // it here means the round trip cannot pass while the gate would fail — the two cannot drift.
  for (const f of evaluateOperationsSignalLog({ signals: [entry] })) {
    findings.push(`OS-R09: ${f} — from scripts/operations-signal-check.mjs, the gate this round trip exists to satisfy`);
  }
  if (findings.length) return nothing();
  return { record, entry, findings: [], notices };
}

/**
 * The git-side log entry a triaged record becomes: exactly the fields `operations-signal-check.mjs`
 * reads, plus ONE named `intake` block carrying the provenance. One key rather than seven, so the
 * widening of the log's shape is a single reviewable thing — and inside the entry rather than
 * beside it, because provenance in a second file is provenance that goes missing the first time
 * somebody copies a row.
 */
export function entryFrom(record) {
  const filed = record?.filed || {};
  const adj = record?.adjudication || {};
  const entry = {
    id: record?.signal_id,
    source: filed.source,
    type: adj.type,
    severity: adj.severity,
    // The gate's template writes a date here, and the date a signal was DETECTED is the day it was
    // filed. Derived, never taken from the adjudication: triage does not get to move it.
    detected: typeof filed.filed_at === 'string' ? filed.filed_at.slice(0, 10) : filed.filed_at,
    summary: filed.summary,
  };
  if (filed.evidence_ref !== undefined) entry.evidence_ref = filed.evidence_ref;
  entry.route = adj.route;
  for (const k of ['link', 'justification', 'status', 'regulator_notification']) if (adj[k] !== undefined) entry[k] = adj[k];
  entry.intake = {
    schema: SCHEMA_ID,
    filed_digest: record?.filed_digest,
    filed_by: filed.filed_by,
    filed_at: filed.filed_at,
    surface_ref: filed.surface_ref,
    adjudicated_by: adj.adjudicated_by,
    adjudicated_at: adj.adjudicated_at,
    reclassified: record?.reclassified || [],
  };
  return entry;
}

/**
 * The gate over an intake record, whoever built it. `intake()` cannot emit a bad one; this catches
 * the ones it did not build — a hand-edited file, a record from a newer intake service, a card
 * somebody assembled by hand because the run was slow. Findings ([] ⇒ safe to route).
 */
export function verifyIntake(record, label = 'intake') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [`OS-R10: ${label}: not an object — there is nothing here to label, and an unlabelled surface is read as the record`];
  }
  const findings = [];
  if (record.schema !== SCHEMA_ID) findings.push(`OS-R10: ${label}: schema ${JSON.stringify(record.schema)} is not ${SCHEMA_ID} — an unversioned record cannot be read, and what cannot be read cannot be shown to be non-authoritative`);
  if (record.authority !== 'none') findings.push(`OS-R10: ${label}: authority is ${JSON.stringify(record.authority)}, not "none" — an intake carries none, ever`);
  if (record.banner !== NON_AUTHORITATIVE) findings.push(`OS-R10: ${label}: the non-authoritative banner is missing or altered — it is the sentence standing between a triage card and a finding, so it is verbatim or it is a finding`);
  if (record.write_class !== WRITE_CLASS) findings.push(`OS-R10: ${label}: write_class is ${JSON.stringify(record.write_class)}, not ${JSON.stringify(WRITE_CLASS)}`);
  for (const k of Object.keys(record)) {
    if (AUTHORITY_FIELDS.has(k)) findings.push(`OS-R10: ${label}: \`${k}\` would read as governance authority on a card that has none — a triage record that mirrors an approval is indistinguishable from one on a screen`);
  }
  if (record.transcribed_by !== TRANSCRIBER_IDENTITY) findings.push(`OS-R11: ${label}: transcribed_by is ${JSON.stringify(record.transcribed_by)}, not ${TRANSCRIBER_IDENTITY}`);
  if (!STATES.includes(record.state)) findings.push(`OS-R05: ${label}: state is ${JSON.stringify(record.state)}, not one of ${STATES.map((s) => JSON.stringify(s)).join(' | ')} — there is no third state, and an invented one is how "routed" gets asserted without an adjudication`);

  const filed = record.filed;
  if (!filed || typeof filed !== 'object') return [...findings, `OS-R07: ${label}: no filed claim — nothing to follow back to`];
  for (const [field, code] of [['id', 'OS-R07'], ['source', 'OS-R07'], ['surface_ref', 'OS-R07'], ['filed_by', 'OS-R07'], ['filed_at', 'OS-R07'], ['type', 'OS-R01'], ['severity', 'OS-R02']]) {
    if (!isStr(filed[field])) findings.push(`${code}: ${label}: the filed claim carries no ${field}`);
  }
  if (filed.route !== undefined || filed.status !== undefined) {
    findings.push(`OS-R05: ${label}: the filed claim carries a route or status of its own — the filer files, triage routes`);
  }
  if (record.signal_id !== filed.id) findings.push(`OS-R07: ${label}: signal_id ${JSON.stringify(record.signal_id)} does not match the filed id ${JSON.stringify(filed.id)} — the record and the claim it carries must be about the same signal`);
  if (record.filed_digest !== filedDigest(filedClaim(filed))) {
    findings.push(`OS-R07: ${label}: filed_digest does not match the claim it is supposed to fix — this is not the claim that was filed, so nothing here can be followed back to the card`);
  }

  const adj = record.adjudication;
  if (record.state === 'triaged') {
    if (!adj || typeof adj !== 'object') {
      findings.push(`OS-R05: ${label}: state is "triaged" with no adjudication — this is the shape in which an unadjudicated signal reads as routed, and it is the one thing this module exists to make unavailable`);
      return findings;
    }
    if (!isStr(adj.adjudicated_by)) findings.push(`OS-R05: ${label}: the adjudication names no adjudicator`);
    if (parseTime(adj.adjudicated_at) === null) findings.push(`OS-R05: ${label}: adjudicated_at is missing or not a parseable ISO-8601 instant`);
    if (!isStr(adj.type)) findings.push(`OS-R01: ${label}: the adjudication states no type`);
    if (!isStr(adj.severity)) findings.push(`OS-R02: ${label}: the adjudication states no rating`);
    if (!ROUTES.has(adj.route)) findings.push(`OS-R03: ${label}: route ${JSON.stringify(adj.route)} is not one of ${[...ROUTES].join('|')}`);
    if (isStr(adj.adjudicated_by) && adj.adjudicated_by === filed.filed_by) {
      findings.push(`OS-R06: ${label}: ${filed.filed_by} filed it and adjudicated it`);
    }
    const a = parseTime(adj.adjudicated_at);
    const f = parseTime(filed.filed_at);
    if (a !== null && f !== null && a < f) findings.push(`OS-R05: ${label}: adjudicated before it was filed`);
    const expected = reclassifiedBetween(filed, adj);
    if (canonical(record.reclassified ?? []) !== canonical(expected)) {
      findings.push(`OS-R07: ${label}: \`reclassified\` does not describe the difference between the filed rating and the adjudicated one (says ${canonical(record.reclassified ?? [])}, the two ratings say ${canonical(expected)}) — a re-rating nobody wrote down is a re-rating nobody reviewed`);
    }
  } else if (adj !== null && adj !== undefined) {
    findings.push(`OS-R05: ${label}: state is ${JSON.stringify(record.state)} but an adjudication is attached — a record must be one or the other, because "filed with an adjudication" is read as routed by anybody scanning it`);
  }
  return findings;
}

/** Findings for one log entry THIS module introduces. Pre-existing entries are the gate's business. */
export function verifyEntryTraceability(entry, label = 'entry') {
  if (!entry || typeof entry !== 'object') return [`OS-R07: ${label}: not an object`];
  const findings = [];
  const t = entry.intake;
  if (!t || typeof t !== 'object' || Array.isArray(t)) {
    return [`OS-R07: ${label}: no \`intake\` block — a signal that exits triage without one cannot be followed back to what was filed, by whom, or what changed, which is the whole acceptance criterion`];
  }
  if (t.schema !== SCHEMA_ID) findings.push(`OS-R07: ${label}: the intake block's schema is ${JSON.stringify(t.schema)}, not ${SCHEMA_ID}`);
  for (const field of ['filed_digest', 'filed_by', 'filed_at', 'surface_ref', 'adjudicated_by', 'adjudicated_at']) {
    if (!isStr(t[field])) findings.push(`OS-R07: ${label}: the intake block carries no ${field}`);
  }
  if (!Array.isArray(t.reclassified)) findings.push(`OS-R07: ${label}: the intake block's \`reclassified\` is not an array — an absent list hides whether triage changed the filer's rating, and absent must never read as "unchanged"`);
  if (isStr(t.filed_by) && t.filed_by === t.adjudicated_by) findings.push(`OS-R06: ${label}: ${t.filed_by} filed it and adjudicated it`);
  if (!ROUTES.has(entry.route)) findings.push(`OS-R05: ${label}: route ${JSON.stringify(entry.route)} is not one of ${[...ROUTES].join('|')} — an entry in the log is by definition routed`);
  for (const k of Object.keys(entry)) {
    if (AUTHORITY_FIELDS.has(k)) findings.push(`OS-R10: ${label}: \`${k}\` would read as governance authority — a triage entry approves nothing`);
  }
  return findings;
}

/**
 * The round trip: triaged records in, the file content a pull request would carry out.
 *
 * `log`     the existing `docs/governance/operations-signal.json`, or null. Its own `_comment` and
 *           any other top-level keys are preserved — this proposes an addition, not a replacement.
 * `records` intake records from `intake()`. A record in state `filed` is refused (OS-R05): writing
 *           an unadjudicated signal into the log is precisely how it would come to read as routed.
 * `opts`    { transcribedBy, inProduction } — `inProduction` is passed straight through to the
 *           gate, which treats an EMPTY log after launch as a finding of its own.
 *
 * Returns { proposal, findings, notices }. `proposal` is null when there are findings: a log that
 * would not pass the gate is not proposed in a reduced form, because a pull request that lands a
 * half-triaged signal has closed the loop on paper and left it open in fact.
 *
 * It does not write the file and does not open the pull request. The bridge transcribes; a human
 * merges. Nothing here is the record until that merge.
 */
export function roundTrip(log, records = [], { transcribedBy = TRANSCRIBER_IDENTITY, inProduction = false } = {}) {
  const findings = [];
  const notices = [];
  const nothing = () => ({ proposal: null, findings, notices });

  const base = log && typeof log === 'object' && !Array.isArray(log) ? log : {};
  const existing = Array.isArray(base.signals) ? base.signals : [];
  if (log !== null && log !== undefined && !Array.isArray(base.signals)) {
    findings.push('OS-R09: the existing operations-signal log has no `signals` array — the gate reports this too, and appending to a malformed log would bury it');
    return nothing();
  }
  if (transcribedBy !== TRANSCRIBER_IDENTITY) {
    findings.push(`OS-R11: transcribed_by is ${JSON.stringify(transcribedBy)}, not ${TRANSCRIBER_IDENTITY}`);
  }

  const byId = new Map(existing.map((s) => [s?.id, s]));
  const signals = [...existing];
  const added = [];
  const unchanged = [];

  for (const [i, record] of (Array.isArray(records) ? records : []).entries()) {
    const label = `record[${i}]${isStr(record?.signal_id) ? ` (${record.signal_id})` : ''}`;
    const recFindings = verifyIntake(record, label);
    if (recFindings.length) { findings.push(...recFindings); continue; }
    if (record.state !== 'triaged') {
      findings.push(`OS-R05: ${label}: state is ${JSON.stringify(record.state)} — a filed signal may not be written into the log. Once it is a row beside triaged ones it reads as routed, and the person scanning the log has no way to tell`);
      continue;
    }
    const entry = entryFrom(record);
    findings.push(...verifyEntryTraceability(entry, label));

    const prior = byId.get(entry.id);
    if (prior !== undefined) {
      // A re-filed card is the normal case, not the adversarial one: somebody re-runs the intake,
      // or two people file the same incident. Identical ⇒ no-op. Different ⇒ refused, never merged:
      // triage already decided this, and an overwrite would erase the decision silently.
      if (canonical(prior) === canonical(entry)) {
        unchanged.push(entry.id);
        notices.push(`${label}: already in the log, byte-identical — the round trip is idempotent, so a re-filed card is a no-op`);
      } else {
        findings.push(`OS-R04: ${label}: signal ${JSON.stringify(entry.id)} is already in the log with different content — a re-file does not overwrite what triage decided. File a new signal, or amend the existing one by its own reviewed change`);
      }
      continue;
    }
    byId.set(entry.id, entry);
    signals.push(entry);
    added.push(entry.id);
  }

  if (findings.length) return nothing();

  const proposedLog = { ...base, signals };
  // The last word belongs to the gate. If this fails, the round trip fails — there is no path on
  // which a proposal is emitted that the check would reject.
  for (const f of evaluateOperationsSignalLog(proposedLog, { inProduction })) {
    findings.push(`OS-R09: ${f} — from scripts/operations-signal-check.mjs`);
  }
  if (findings.length) return nothing();

  const proposal = {
    _comment: 'A PROPOSAL, not a write. `log` is the file content a pull request would carry to `path`; this module does not write it and does not open the pull request. The bridge transcribes, a human merges, and nothing here is the record until that merge.',
    schema: SCHEMA_ID,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    write_class: WRITE_CLASS,
    path: LOG_PATH,
    transcribed_by: transcribedBy,
    added,
    unchanged,
    log: proposedLog,
  };
  return { proposal, findings: [], notices };
}

// CLI: run one intake from a JSON file, so an adopter can watch a card become a log entry the
// existing gate accepts — and watch a pre-routed card, or a self-adjudicated one, be refused.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-ops-signal.mjs <intake.json>\n  { "filed": { … }, "adjudication": { … }, "log": { "signals": [] } }\n');
    process.exit(2);
  }
  let input;
  try { input = JSON.parse(readFileSync(path, 'utf8')); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const { record, findings, notices } = intake(input);
  for (const n of notices) process.stderr.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write(`\nIntake REFUSED — nothing is proposed.\n\n  - ${findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  const trip = roundTrip(input.log ?? null, record.state === 'triaged' ? [record] : []);
  for (const n of trip.notices) process.stderr.write(`  · ${n}\n`);
  if (trip.findings.length) {
    process.stderr.write(`\nRound trip REFUSED — nothing is proposed.\n\n  - ${trip.findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ record, proposal: trip.proposal }, null, 2)}\n`);
}
