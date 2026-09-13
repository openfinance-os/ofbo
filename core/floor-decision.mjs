// Decision capture, corrected (Factory Floor WS5 · D5.2 — the answer to finding F1). The one
// place in the seam where something that happened on the collaboration surface becomes a record
// git will keep, and therefore the one place where getting the direction of trust wrong would
// undo every control downstream of it.
//
// ONE SENTENCE GOVERNS THIS FILE: **the bridge transcribes; it never decides.** F1 was not that
// the bridge's signature was weak — it verifies for real. F1 was that a decision's AUTHORITY came
// from the thing that CARRIED it: a service key saying "risk-second-line approved" is a service
// making a claim about a person, which is the exact shape the auditor's question — *who decided?*
// — exists to defeat. So this module assembles an envelope and refuses to emit one whose
// `subject.assertion` it could itself have produced. Everything below is arranged around that
// refusal, and the refusal is structural rather than advisory: there is no argument, option, flag
// or shape of this call that returns an envelope carrying only a transcription.
//
// WHAT "COULD ITSELF HAVE PRODUCED" MEANS IN CODE, because the interesting failures are the ones
// where every signature checks out:
//
//   1. The assertion issuer is not a registered SERVICE attestation issuer (DC-R25) — the check
//      `core/approval-attestations.mjs` already makes, restated here so the envelope is refused at
//      EMISSION rather than at a gate months later, by which time a PR carrying it has been
//      reviewed by humans who reasonably assumed the machinery had checked.
//   2. The assertion issuer is not the transcription issuer, and is not the bridge's own registry
//      identity (DC-R26).
//   3. The assertion issuer's verification material does not OVERLAP any service issuer's
//      (DC-R27, via `sharesTrustAnchor`). This is the one that catches the realistic attack: the
//      same key registered under two ids in two files. The id is a name someone typed; the key is
//      the thing that signs, so separation has to hold on key material or it is a naming
//      convention. Note that a forgery caught here is one whose signature VERIFIES — the
//      cryptography is perfect and the record is still refused, which is the whole point.
//   4. The assertion issuer declares SOME verification material (DC-R29). An issuer with nothing
//      pinned cannot be told apart from the bridge's own key, so the bridge's inability to have
//      produced the assertion is unprovable — and unprovable is refused, not assumed.
//   5. The assertion issuer is not marked `"demo": true` (DC-R30). The bundle's reference key
//      demonstrably has a live private half — it signed the worked example — and every adopter who
//      copied the file holds the same one. An assertion under it is precisely the shape this
//      module exists to refuse. The cost is real and deliberate: **D5.2 cannot be demoed with the
//      bundled reference key.** Exercise the contract through `approval-attestations`' own example
//      and tests, which is where a key that refuses itself belongs.
//   6. The assertion binds THIS decision: its nonce equals `sha256` of the canonical payload
//      (DC-R31, ADR-0005's non-negotiable hard condition), and that nonce has not been used before
//      (DC-R32). Change one field of the decision the bridge composed — outcome, role, stage,
//      change id, subject, decision time, custodian — and the nonce no longer matches. This is
//      what stops the bridge from *editing* a decision it cannot *mint*.
//
// AND THE SUBJECT IS RESOLVED, NEVER SUPPLIED. `subject.registry_id` and `subject.idp_subject` are
// not inputs (DC-R12). The caller hands over the surface person id the refetch reported, and the
// P6 identity map (`core/identity-map.mjs`) says who that is. A bridge that names the approver is
// F1 rendered as a data-entry field, and the field is therefore absent rather than validated.
//
// A DECISION STARTS FROM A SIGNAL AND IS READ FROM THE SOURCE OF TRUTH. `verifyWebhook()` returns
// a signal carrying an id to refetch and NO payload content, on purpose (D4.3). So the decision's
// content arrives here in an `observation` — what the bridge read back from the surface after being
// told to look — and the observation must name the entity the signal named (DC-R06) and carry the
// evidence of its own read (DC-R07). Content hung on the signal object by a caller is never read.
//
// EVERYTHING THIS EMITS IS LABELLED NON-AUTHORITATIVE, and that is not modesty. WS5's entry gate
// requires F1–F4 merged **and an independent second-line review of the workstream's design**
// (plan §4). The second half does not exist. Until it does, an envelope from here is a draft
// record for humans to review and merge — not evidence a gate may accept. The label is applied by
// this module, is never taken from input, and there is no knob that removes it: names that look
// like such a knob are refused on sight (DC-R04, `FORBIDDEN_OPTIONS`), and the returned object is
// deep-frozen so it cannot be stripped in place.
//
// WHAT THAT LABEL GUARANTEE IS NOT: cryptographic. `canonicalDecisionPayload()` has a FIXED field
// list, and adding the banner to it would change the string every already-minted assertion is
// bound to — so the label sits outside the signature and a caller who composes a NEW object from
// this one's parts can drop it. The narrow, true claim is: no call to this module returns an
// unlabelled envelope, the object it returns cannot be edited, and `verifyEmission()` refuses one
// whose label has been altered. Stripping it is a separate act and a reviewable diff.
//
// FIVE RESIDUALS, named so silence is not mistaken for coverage:
//
//   1. **The nonce binds bytes the human cannot read.** The payload is composed by the BRIDGE and
//      the human's step-up flow binds its digest. Nothing here proves the human saw the decision
//      that digest names — a bridge that displays "approve the release" while composing a payload
//      for a different change would produce a record every check in this file passes. That control
//      is D5.1's evidence-carried-in rule and the approval page's own display, plus the second-line
//      human who merges the PR. ADR-0005 says the same thing in its own words and must not be
//      cited as covering comprehension.
//   2. **`origin.person_id` is not in the canonical payload.** The signed pivot is `idp_subject`,
//      so the binding that decides WHO is signed; the surface account id beside it is the bridge's
//      claim, and IM-R12 compares the bridge's claim against the map. A bridge that lied about
//      which account clicked would be caught only if the lie also broke the subject resolution —
//      which it does here, because the subject is resolved FROM that person id. At gate time,
//      months later, it is a claim again.
//   3. **The P6 join is self-consistent at capture time**, necessarily: this module resolves the
//      subject from the map instead of accepting a claim, so `verifyMapping()`'s comparison of
//      record against map cannot fail here. Its teeth are at GATE time, against the map as it then
//      stands. What capture does add is real: map soundness, reconciliation currency, and whether
//      the binding was live at the decision instant.
//   4. **The single-use set's durability is undesigned** — the same gap `core/floor-webhook.mjs`
//      names (threat model §8 G-4). An in-memory Map survives one process; after a restart a
//      re-emission of an already-used assertion nonce would be accepted here and caught only by
//      the gate's own replay check.
//   5. **Assertion metadata sits inside the signed payload.** D2.4 puts the assertion's own
//      `audience`, `acr`, `issued_at`, `expires_at` and `subject` in the canonical string, so the
//      nonce cannot be computed until they are known — while a real OIDC step-up sets `iat`/`exp`
//      at mint time, AFTER the nonce is chosen. The two-phase API below makes the ordering explicit
//      (`assembleDecision()` tells you the digest to bind) and cannot resolve the impedance
//      mismatch: D2.5 must, either by requesting a fixed lifetime or by narrowing the payload.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DUPLICATE. Which stage a compiled role binds at is
// `pa1Roles()` in `scripts/product-approval-check.mjs`; the builder-versus-second-line separation
// is that gate's too, and it sits under an open decision (threat model §8 G-9). Two divergent
// copies of a rule under review is worse than one, so this module checks only that the role is one
// the plan compiles at all (DC-R10) and leaves the rest where it is enforced.
//
// NO CLOCK, NO FILESYSTEM, NO NETWORK. `now` is injected (DC-R01) so freshness and lifecycle are
// judged against a clock the caller vouches for. The module imports neither `node:fs` nor any
// network facility — it cannot write the PR it prepares, and a human merges it. That absence is
// asserted by the test suite, because "the bridge cannot commit" is a claim worth checking rather
// than promising.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  ASSERTION_MECHANISMS,
  APPROVALS_SUBDIR,
  SCHEMA_ID,
  canonicalDecisionPayload,
  sha256,
  sharesTrustAnchor,
  trustAnchors,
  verifyApprovalAttestation,
} from './approval-attestations.mjs';
import { CLOCK_SKEW_MS, REFUSED_AUTHOR_TYPES } from './floor-webhook.mjs';
import { RECONCILIATION_MAX_AGE_DAYS, checkMapInvariants, mappingActiveAt } from './identity-map.mjs';
import { sameIdentity } from './separation.mjs'; // 2.1.0 — the one separation rule, shared

/** The schema of the thing this emits. It is D2.4's, not a new one — see the header. */
export { SCHEMA_ID, APPROVALS_SUBDIR };

/**
 * The label every emission carries, verbatim. Its wording is the plan's (§9, M2) and the threat
 * model's closing line: WS5 surfaces run labelled non-authoritative until the entry gate passes.
 * Verbatim or it is a finding — the same stance `core/floor-project.mjs` takes with its banner,
 * for the same reason: this sentence is the only thing standing between a well-formed record and a
 * false approval, and a paraphrase is not the sentence.
 */
export const NON_AUTHORITATIVE = 'NON-AUTHORITATIVE · DECLARED, NOT ACTIVE — WS5 decision routing is production-blocked: its entry gate requires an independent second-line review of the workstream design, which does not exist. This envelope is a draft record for human review and merge. No gate may accept it as evidence that anyone approved anything, and nothing here holds, releases or launches anything.';

/** What the envelope claims to be worth. One value, and it is not a parameter. */
export const AUTHORITY = 'none';

/** The provenance system this bridge serves. Signed (it is in the canonical payload). */
export const ORIGIN_SYSTEM = 'notion';

/** The reference name of the carrying service (threat model §4). An adopter names their own. */
export const TRANSCRIBER_IDENTITY = 'svc-floor-bridge';

/**
 * The only outcome this module emits. `loom.approval-attestation/v1`'s verifier reports any other
 * outcome as a finding — "only an approved decision evidences an approval" — so a rejection
 * captured into this schema would be a record no verifier accepts. Refused here rather than
 * emitted as decoration; routing rejections needs a schema decision, not a looser check.
 */
export const OUTCOMES = new Set(['approved']);

/** Stages an approval envelope may name. PA1 is permission to develop, PA2 to launch. */
export const STAGES = new Set(['PA1', 'PA2']);

/** The only surface entity a decision can be read from — a row on the approvals database. */
export const DECISION_ENTITY_KIND = 'page';

/** Author types the bridge refuses, borrowed rather than restated (`core/floor-webhook.mjs`). */
export { REFUSED_AUTHOR_TYPES };

/**
 * The author type a decision requires. An ALLOW-list, deliberately: `bot` and `agent` are the
 * types known today, and a surface that invents a third would otherwise pass a deny-list by being
 * new. Machine judgment is never laundered into human accountability by a vocabulary change.
 */
export const AUTHOR_TYPES = new Set(['person']);

/**
 * Names a caller might reach for to switch the label off, refused on sight in both `input` and
 * `ctx` — the same stance `core/identity-map.mjs` takes with `FORBIDDEN_FIELDS`: carrying the
 * field at all is what makes the shortcut available, so the refusal is of the field, not of its
 * use. There is no supported way to emit an unlabelled envelope, and a caller who tries gets a
 * rejection rather than an argument that is quietly ignored.
 */
export const FORBIDDEN_OPTIONS = [
  'authority', 'banner', 'governance', 'label', 'labelled', 'labeled', 'unlabelled', 'unlabeled',
  'authoritative', 'non_authoritative', 'nonAuthoritative', 'suppress_label', 'suppressLabel',
  'declared_active', 'active', 'entry_gate_passed', 'entryGatePassed',
];

/** `bound_to` keys a caller may set. `plan_hash` and `passport_digest` are DERIVED — see DC-R13. */
export const CALLER_BOUND_KEYS = new Set(['source_sha', 'artifact_digest', 'control_plan_path']);

/** Context this module refuses to run without. Each absent default would disable a control. */
export const REQUIRED_CONTEXT = [
  'transcriber', 'plan', 'passportDigest', 'registry', 'issuers', 'assertionIssuers',
  'map', 'reconciliation', 'resolveApprover', 'identityOf',
];

/**
 * Every rejection this module can emit. Exported so an adopter can read the contract without
 * reading the source, and asserted against the source by the test suite — a code in one and not
 * the other is a documentation gap the tests fail on.
 */
export const REJECTIONS = new Map([
  ['DC-R01', 'no `now` supplied — this module has no clock, so the decision\'s lifecycle is judged against the caller\'s trusted one'],
  ['DC-R02', 'no `seen` map supplied — single-use is a headline control (ADR-0005) and may not be switched off by omission'],
  ['DC-R03', 'a required context input is missing — this module refuses to run half-configured; the message names the field'],
  ['DC-R04', 'the caller passed a label, authority or governance option — there is no such knob, and carrying the field is what would make the shortcut available'],
  ['DC-R05', 'no verified webhook signal — a decision starts from `verifyWebhook()`\'s signal, never from a body, a duplicate or a refusal'],
  ['DC-R06', 'the observation does not name the page the signal said to refetch — a record must describe what was read, not what the delivery said'],
  ['DC-R07', 'the observation carries no usable read evidence — an unattributed or impossible read is not a refetch'],
  ['DC-R08', 'an author of type bot or agent is named — machine judgment is never laundered into human accountability'],
  ['DC-R09', 'the deciding author is not a person — an unknown or absent author type fails closed'],
  ['DC-R10', 'the decision names no change, stage, role or decision time this plan compiles'],
  ['DC-R11', 'the outcome is not `approved` — no other outcome has a shape in this schema'],
  ['DC-R12', 'the caller named the subject — the approver is resolved through P6, never supplied by the bridge'],
  ['DC-R13', 'the caller set a `bound_to` field this module derives, or one the schema has no place for'],
  ['DC-R14', 'the identity map is unsound or its currency is unproven — an unsound map resolves nobody'],
  ['DC-R15', 'no active P6 mapping for the surface person id — an unmapped human is an unknown human'],
  ['DC-R16', 'more than one active P6 mapping for the surface person id — ambiguity resolves to refusal, never to a pick'],
  ['DC-R17', 'the P6 mapping was not live at the decision instant — authority must have existed when it was exercised'],
  ['DC-R18', 'the resolved human does not resolve as an approver holding the decision\'s role'],
  ['DC-R19', 'the transcriber is not a registered non-human identity — custody is credited, so it may not be free text'],
  ['DC-R20', 'the transcriber holds approval roles — the bridge must hold none (threat model C10)'],
  ['DC-R21', 'the transcriber and the approver are the same identity — custody and decision must be separable'],
  ['DC-R22', 'the transcription attestation is missing, unattributed, or signed for someone other than the transcriber'],
  ['DC-R23', 'no subject assertion — an envelope carrying only a transcription authenticates the worker, not the approver'],
  ['DC-R24', 'the assertion declares a mechanism the contract does not know'],
  ['DC-R25', 'the assertion issuer is a registered SERVICE attestation issuer — a service signing for a human authenticates the service'],
  ['DC-R26', 'the assertion issuer is the transcriber, or the transcriber\'s own signing issuer — the bridge transcribes, it never vouches'],
  ['DC-R27', 'the assertion issuer shares verification material with a service issuer — the bridge could have produced this assertion'],
  ['DC-R28', 'the assertion issuer is not in the assertion-issuers registry — an unpinned identity provider is not trusted'],
  ['DC-R29', 'the assertion issuer declares no verification material — it cannot be told apart from the bridge\'s own key'],
  ['DC-R30', 'the assertion issuer is marked `"demo": true` — its private half ships with the harness, so the bridge could have signed this'],
  ['DC-R31', 'the assertion does not bind THIS decision — the nonce must equal sha256 of the canonical payload (ADR-0005\'s hard condition)'],
  ['DC-R32', 'the assertion nonce has already been used — a decision nonce is single-use'],
  ['DC-R33', 'the assertion names a different human than the P6 mapping resolves'],
  ['DC-R34', 'the assertion\'s own validity window is missing, unreadable, or did not cover the decision'],
  ['DC-R35', 'the assembled envelope does not satisfy its own schema\'s verifier — the findings follow verbatim'],
  ['DC-R36', 'the envelope\'s non-authoritative label is missing or altered — verbatim or it is a finding'],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/**
 * ISO-8601 only, and the TYPE is part of the check — the stance every module in this seam takes.
 * `Date.parse` coerces non-strings unpredictably (`0` becomes the year 2000), and this JSON is
 * composed by the bridge, so the bridge would be choosing the type.
 */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const iso = (ms) => new Date(ms).toISOString();

/** `DC-Rnn: <the documented reason> — <what to do about it here>`. One shape for every refusal. */
const refuse = (code, extra = '') => `${code}: ${REJECTIONS.get(code)}${extra ? ` — ${extra}` : ''}`;

/**
 * Freeze the emission all the way down. Not decoration: a caller holding a mutable envelope could
 * `delete envelope.governance` and hand the result to a PR writer. Frozen, that line throws in a
 * module (strict mode), so removing the label takes composing a NEW object — a different act, and
 * a visible one. It does not make the label cryptographic; see the header.
 */
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** Drop undefined values so the emitted JSON has no keys standing in for absent facts. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const issuerEntry = (reg, id) => (reg?.issuers || []).find((i) => i.id === id);

/**
 * Active P6 entries for a surface person id. A LOOKUP, not the join — and the distinction is the
 * reason this is three lines rather than a call into `identity-map.mjs`. The join resolves from the
 * SIGNED pivot (`idp_subject`) and arbitrates a claim; there is no claim here yet, only the account
 * the refetch reported, so what is needed is the other direction. Nothing found this way is
 * trusted: it produces a candidate, the candidate becomes the record's subject, and
 * `verifyMapping()` re-resolves it from the pivot inside the self-check below.
 */
const activeFor = (map, personId) =>
  (map?.entries || []).filter((e) => e?.status === 'active' && isStr(personId) && e.notion_person_id === personId);

/**
 * A finding the shipped contract reports as UNVERIFIED-HERE *because of the mechanism* — the one
 * class of self-check finding that is not a refusal. `oidc-step-up` is ADR-0005's accepted primary
 * mechanism and is verified by the platform against pinned metadata, not by this control plane, so
 * refusing it would refuse the very mechanism the programme chose.
 *
 * NOTE THE DIRECTION OF DRIFT, which is why matching on the sibling module's words is acceptable
 * here. If that wording changes, this predicate stops matching and the finding is reclassified as
 * a REFUSAL — the module gets stricter and something fails loudly. It cannot drift the other way.
 * A test asserts the marker still exists, so the reclassification is caught deliberately.
 */
const isMechanismCaveat = (f) => /UNVERIFIED-HERE/.test(f) && /mechanism/.test(f);

/**
 * Phase 1 · assemble the candidate decision and say what an identity provider must bind.
 *
 * Returns `{ draft, payload, nonce, findings }`. `findings` non-empty ⇒ nothing may be requested,
 * and `draft` is null. `nonce` is the value the assertion's `nonce` claim must carry: the digest of
 * the canonical payload, which is what makes the assertion an approval of THIS decision and not a
 * login (ADR-0005's hard condition).
 *
 * The draft is NOT an envelope. It carries the label and `authority: "none"` like everything else
 * here, and it carries no assertion signature — a draft is the question, not the answer.
 *
 * `input.assertion` must already declare the claims the payload names — `issuer`, `subject`,
 * `audience`, `acr`, `issued_at`, `expires_at`, `mechanism` — because D2.4 signs them. Residual 5
 * in the header is about exactly this.
 */
export function assembleDecision(input = {}, ctx = {}) {
  return build(input, ctx, false);
}

/**
 * Phase 2 · package the assertion and the transcription into the envelope, or refuse.
 *
 * Returns `{ envelope, path, payload, nonce, findings, unverified }`.
 *
 *   **`envelope !== null` is the only permission to open a PR.** It is null on every refusal, so
 *   there is no shape in which a caller commits a record this module rejected. `findings` non-empty
 *   ⇒ refuse and alert. `unverified` carries the honest caveats an emission ships WITH — today,
 *   only the platform-verified assertion mechanisms — and is never empty of meaning: an emission
 *   with caveats is still labelled non-authoritative, like every other.
 *
 *   `path` is where the envelope belongs (`approvals/<stage>-<role>.json`), so the caller writing
 *   the PR has no naming freedom: a second capture for the same slot REPLACES the file and shows
 *   up as a diff, instead of quietly becoming a second approval for one role.
 *
 * ctx: {
 *   now,                      — REQUIRED. ms epoch from the caller's trusted clock
 *   seen,                     — REQUIRED. Map of used nonces (single-use); see the durability residual
 *   transcriber,              — REQUIRED. registry id of the carrying service
 *   plan, passportDigest,     — REQUIRED. the compiled control plan, and the passport's analysis digest
 *   registry,                 — REQUIRED. docs/governance/identities.json
 *   issuers, assertionIssuers,— REQUIRED. SERVICE issuers · identity-provider material
 *   map, reconciliation,      — REQUIRED. the P6 map and the observation proving it is current
 *   resolveApprover, identityOf — REQUIRED. injected from the identity gate (no cycle)
 *   site, system, clockSkewMs, mapMaxAgeDays — optional
 * }
 */
export function captureDecision(input = {}, ctx = {}) {
  return build(input, ctx, true);
}

function build(input, ctx, emit) {
  const nothing = (findings) => (emit
    ? { envelope: null, path: null, payload: null, nonce: null, findings, unverified: [] }
    : { draft: null, payload: null, nonce: null, findings });

  // ── 0 · configuration, and the label. Fail closed on all of it, and refuse the knob that does
  // not exist BEFORE anything else: a caller who asked for an unlabelled envelope has asked for
  // the one thing this module cannot do, and answering any other question first would be answering
  // the wrong one.
  const knobs = [...new Set([...Object.keys(input || {}), ...Object.keys(ctx || {})])]
    .filter((k) => FORBIDDEN_OPTIONS.includes(k));
  if (knobs.length) {
    return nothing([refuse('DC-R04', `remove ${knobs.map((k) => `\`${k}\``).join(', ')}. Everything this module emits is labelled non-authoritative until WS5's entry gate passes, which needs an independent second-line review of the workstream design that does not exist. The label is not configuration`)]);
  }
  if (typeof ctx.now !== 'number' || !Number.isFinite(ctx.now)) {
    return nothing([refuse('DC-R01', 'pass `now` as ms epoch, so whether the mapping was live and the assertion fresh is judged against a clock the caller vouches for rather than whichever machine happens to run this')]);
  }
  if (emit && !(ctx.seen instanceof Map)) {
    return nothing([refuse('DC-R02', 'pass a Map of used nonce → site. An absent set reads exactly like a set that has never seen anything, so a replayed assertion would be indistinguishable from a first use')]);
  }
  const missing = REQUIRED_CONTEXT.filter((k) => ctx[k] === undefined || ctx[k] === null
    || (['resolveApprover', 'identityOf'].includes(k) && typeof ctx[k] !== 'function')
    || (k === 'transcriber' && !isStr(ctx[k])));
  if (missing.length) {
    return nothing(missing.map((k) => refuse('DC-R03', `\`${k}\` is absent. Defaulting it would decide by omission: no registry means nobody resolves, no map means an unmapped human passes, no reconciliation means an unproven map counts as current, and \`resolveApprover\`/\`identityOf\` are injected from the identity gate so this module does not invert the layering to reach them`)));
  }

  const findings = [];
  const clockSkewMs = Number.isFinite(ctx.clockSkewMs) ? ctx.clockSkewMs : CLOCK_SKEW_MS;

  // ── 1 · the signal. `signal !== null` was the permission to act; this is where that permission
  // is spent. A duplicate or refused delivery yields null from verifyWebhook, so a caller passing
  // one through is passing null, and null stops here.
  const signal = input.signal;
  if (!signal || typeof signal !== 'object') {
    return nothing([refuse('DC-R05', 'pass the `signal` from `verifyWebhook()`. A duplicate or refused delivery returns `signal: null`, and null is not permission to record a decision')]);
  }
  if (!isStr(signal.event_id) || !isStr(signal.refetch?.kind) || !isStr(signal.refetch?.id)) {
    return nothing([refuse('DC-R05', 'the signal carries no `event_id` or no `refetch.{kind,id}`. Only its SHAPE can be checked here: this module cannot tell a genuine signal from a well-formed forgery, which is precisely why authority comes from the assertion and never from the carrier')]);
  }
  if (signal.refetch.kind !== DECISION_ENTITY_KIND) {
    return nothing([refuse('DC-R06', `the signal names a \`${signal.refetch.kind}\` to refetch; a decision is a ${DECISION_ENTITY_KIND} on the approvals database. A block or comment signal names nothing this module can read a decision from`)]);
  }

  // ── 2 · the observation. The decision's content comes from what was READ, never from what was
  // delivered — the delivery carried none, by construction (D4.3). Anything a caller hangs on the
  // signal object is ignored, and that is worth stating because it is invisible in the code: no
  // line below reads `signal` for anything but ids.
  const obs = input.observation;
  if (!obs || typeof obs !== 'object') {
    return nothing([refuse('DC-R07', 'pass an `observation`: what the bridge read back from the surface after the signal told it to look. A decision assembled from the delivery instead of a refetch is the whole vulnerability D4.3 exists to make unavailable')]);
  }
  if (obs.entity?.kind !== signal.refetch.kind || obs.entity?.id !== signal.refetch.id) {
    findings.push(refuse('DC-R06', `the observation names ${JSON.stringify(obs.entity?.kind)}/${JSON.stringify(obs.entity?.id)} but the signal said to refetch ${JSON.stringify(signal.refetch.kind)}/${JSON.stringify(signal.refetch.id)}`));
  }
  const readAt = parseTime(obs.read_at);
  if (readAt === null) {
    findings.push(refuse('DC-R07', `\`read_at\` ${JSON.stringify(obs.read_at)} is missing or not a parseable ISO-8601 instant — an undated read cannot be shown to have happened after the signal, which is the only thing that makes it a refetch`));
  } else if (readAt - ctx.now > clockSkewMs) {
    findings.push(refuse('DC-R07', `the read is stamped ${obs.read_at}, ${Math.floor((readAt - ctx.now) / 1000)}s in the future beyond the ${Math.floor(clockSkewMs / 1000)}s skew allowance — a read that has not happened yet is not evidence`));
  }
  if (obs.read_by !== ctx.transcriber) {
    findings.push(refuse('DC-R07', `\`read_by\` is ${JSON.stringify(obs.read_by)} but the transcription will credit ${JSON.stringify(ctx.transcriber)}. The custodian signs what IT read; a read performed by anyone else is hearsay, and the envelope has no field to record whose`));
  }

  // ── 3 · authors. A refusal driven by data the surface controls, which can only ever make us do
  // less — the direction argument from `floor-webhook.mjs` applies unchanged. `verifyWebhook()`
  // already refuses a bot/agent author on the DELIVERY (WH-R17); this refuses it on the REFETCH,
  // where the answer is authoritative rather than claimed. Two layers, deliberately.
  const author = obs.author;
  for (const a of [author, ...(Array.isArray(obs.authors) ? obs.authors : [])]) {
    if (a && REFUSED_AUTHOR_TYPES.has(a.type)) {
      findings.push(refuse('DC-R08', `the surface names an author of type ${JSON.stringify(a.type)}${isStr(a.id) ? ` (${a.id})` : ''}. Agents and bots prepare evidence; they are never the party behind a decision, and an automation that touched the decision row makes this row unusable rather than acceptable`));
    }
  }
  if (!author || !AUTHOR_TYPES.has(author.type) || !isStr(author.id)) {
    findings.push(refuse('DC-R09', `the deciding author is ${JSON.stringify(author?.type ?? null)} with id ${JSON.stringify(author?.id ?? null)}; it must be one of ${[...AUTHOR_TYPES].join(' | ')} with an id. This is an allow-list: a surface that invents a new machine type must not pass by being new`));
  }

  // ── 4 · the decision, as read. Stage, role, outcome and the decision instant are the surface's
  // answers; the plan decides whether they mean anything.
  const d = obs.decision || {};
  const decidedAt = parseTime(d.decided_at);
  if (d.change_id !== ctx.plan?.change_id) {
    findings.push(refuse('DC-R10', `the decision names change ${JSON.stringify(d.change_id)} but the compiled plan in force is ${JSON.stringify(ctx.plan?.change_id)} — an approval of a different change approves nothing here`));
  }
  if (!STAGES.has(d.stage)) findings.push(refuse('DC-R10', `stage ${JSON.stringify(d.stage)} is not one of ${[...STAGES].join(' | ')}`));
  if (!isStr(d.role)) findings.push(refuse('DC-R10', 'the decision names no role — an approval that is not for a compiled role is not an approval of anything the gate looks for'));
  else if (!(ctx.plan?.required_approver_roles || []).includes(d.role)) {
    findings.push(refuse('DC-R10', `role ${JSON.stringify(d.role)} is not compiled into this plan's \`required_approver_roles\`. WHICH stage a compiled role binds at is \`pa1Roles()\` in the PA gate and is deliberately not duplicated here`));
  }
  if (decidedAt === null) {
    findings.push(refuse('DC-R10', `\`decided_at\` ${JSON.stringify(d.decided_at)} is missing or not a parseable ISO-8601 instant — the decision instant is what every lifecycle check is judged against, and it is signed`));
  } else if (readAt !== null && readAt + clockSkewMs < decidedAt) {
    findings.push(refuse('DC-R07', `the read at ${obs.read_at} precedes the decision at ${d.decided_at} — a decision cannot have been read before it was made, so this observation describes something else`));
  }
  if (!OUTCOMES.has(d.outcome)) {
    findings.push(refuse('DC-R11', `outcome ${JSON.stringify(d.outcome)} — this module emits approval envelopes only. A rejection or abstention has no shape in ${SCHEMA_ID}, whose verifier reports any non-approved outcome as a finding, so capturing one would produce a record no verifier accepts`));
  }
  if (!isStr(d.nonce)) {
    findings.push(refuse('DC-R10', 'the decision carries no `nonce` from the approval surface — it is signed, and the replay guard downstream is keyed on it'));
  }

  // ── 5 · what the caller may not decide. Both of these are F1 restated as a convenience field.
  if (input.subject !== undefined) {
    findings.push(refuse('DC-R12', 'remove `subject`. The approver is whoever the P6 map binds the surface person id to; a bridge that NAMES the approver is the finding this module exists to answer, so the field is absent rather than validated'));
  }
  for (const k of Object.keys(input.bound_to || {})) {
    if (!CALLER_BOUND_KEYS.has(k)) {
      findings.push(refuse('DC-R13', `\`bound_to.${k}\` is not the caller's to set. \`plan_hash\` and \`passport_digest\` are read from the compiled plan and the committed passport, so the bridge cannot bind a decision to a plan that is not the one in force; anything else has no place in the schema`));
    }
  }
  const expiresAt = input.expires_at;
  if (expiresAt !== undefined && parseTime(expiresAt) === null) {
    findings.push(refuse('DC-R10', `\`expires_at\` ${JSON.stringify(expiresAt)} is not a parseable ISO-8601 instant. Omit it to record an approval with no expiry — the schema treats absence as no expiry, and this module does not invent one`));
  }

  // ── 6 · the transcriber. C10 of the capability matrix rendered as a check: the bridge may sign
  // custody and may never hold a role. Asserted against the registry, not against a comment.
  const bridge = ctx.identityOf(ctx.registry, ctx.transcriber);
  if (!bridge) {
    findings.push(refuse('DC-R19', `transcriber ${JSON.stringify(ctx.transcriber)} is not in the identity registry. Custody is CREDITED in the record, so an unregistered custodian names a party no auditor can resolve`));
  } else if (bridge.kind === 'human') {
    findings.push(refuse('DC-R19', `transcriber ${ctx.transcriber} is a human identity. The bridge is a service (threat model §4); a human custodian is a different design, and the one check that would still hold — "holds no approval role" — passes for any role-less person`));
  }
  if (bridge && (bridge.roles || []).length > 0) {
    findings.push(refuse('DC-R20', `${ctx.transcriber} holds ${(bridge.roles || []).join(', ')}. The bridge signs what it READ, never what a human DECIDED — the distinction F1 turns on, and C10 of the capability matrix says every machine row is \`no\``));
  }

  // ── 7 · P6. The map's own soundness first: an unsound or stale map resolves nobody, and finding
  // that out after resolving would mean having trusted it already.
  const mapFindings = checkMapInvariants(ctx.map, ctx.registry, {
    now: ctx.now,
    reconciliation: ctx.reconciliation,
    maxAgeDays: Number.isFinite(ctx.mapMaxAgeDays) ? ctx.mapMaxAgeDays : RECONCILIATION_MAX_AGE_DAYS,
  });
  for (const f of mapFindings) findings.push(refuse('DC-R14', f));

  const candidates = activeFor(ctx.map, author?.id);
  if (isStr(author?.id) && candidates.length === 0) {
    findings.push(refuse('DC-R15', `no active mapping for surface person id ${JSON.stringify(author.id)}. There is no fallback: no nearest match, no resolution by name or address, no override. The route past this is a merged PR that changes the map`));
  }
  if (candidates.length > 1) {
    findings.push(refuse('DC-R16', `${candidates.length} active mappings name person id ${JSON.stringify(author.id)} — one human is one registry identity wearing several hats, which is one entry, not several`));
  }
  const entry = candidates.length === 1 ? candidates[0] : null;
  if (entry && decidedAt !== null && !mappingActiveAt(entry, decidedAt)) {
    findings.push(refuse('DC-R17', entry.status === 'revoked'
      ? `the mapping for ${entry.registry_id} was revoked at ${entry.revoked_at} (class ${entry.revocation_class || 'unstated'}), before the decision at ${d.decided_at}`
      : `the mapping for ${entry.registry_id} begins at ${entry.mapped_at}, after the decision at ${d.decided_at} — a binding cannot authorise a click that predates it`));
  }
  if (entry && isStr(d.role)) {
    for (const f of ctx.resolveApprover(ctx.registry, entry.registry_id, d.role, 'subject')) {
      findings.push(refuse('DC-R18', f));
    }
  }
  if (entry && sameIdentity(entry.registry_id, ctx.transcriber)) {
    findings.push(refuse('DC-R21', `the map binds this click to ${entry.registry_id}, which is the transcriber. Custody and decision must be separable, and an identity that is both is neither`));
  }

  // ── 8 · the assertion's independence. THE section. Everything here runs before any payload is
  // computed, because an assertion the bridge could have produced must not even get as far as
  // being packaged into something that looks like a record.
  const a = input.assertion;
  if (!a || typeof a !== 'object') {
    findings.push(refuse('DC-R23', `pass the assertion the identity provider minted for this decision. A record with only \`transcription.attestation\` proves that a service wrote a file — the service is authentic, the approval is not`));
  } else {
    if (!ASSERTION_MECHANISMS.has(a.mechanism)) {
      findings.push(refuse('DC-R24', `mechanism ${JSON.stringify(a.mechanism)} is not one of ${[...ASSERTION_MECHANISMS].join(' | ')}`));
    }
    if (!isStr(a.issuer)) {
      findings.push(refuse('DC-R28', 'the assertion names no issuer — an unattributed assertion is not evidence, and there is nothing to check independence against'));
    } else {
      const service = issuerEntry(ctx.issuers, a.issuer);
      const idp = issuerEntry(ctx.assertionIssuers, a.issuer);
      const transcriptionIssuer = issuerEntry(ctx.issuers, input.attestation?.issuer);
      if (service) {
        findings.push(refuse('DC-R25', `${JSON.stringify(a.issuer)} is registered in the SERVICE attestation issuers. That registry holds custody keys; a custody key asserting a human decided authenticates the custodian`));
      }
      if (a.issuer === input.attestation?.issuer || a.issuer === ctx.transcriber) {
        findings.push(refuse('DC-R26', `${JSON.stringify(a.issuer)} is the transcribing party. The bridge packages the assertion; it cannot be its source, or the envelope's two signatures collapse into one`));
      }
      if (idp) {
        // Key material, not ids. The same key registered under two ids in two files is the
        // realistic version of this attack, and an id comparison would miss it entirely.
        for (const s of ctx.issuers?.issuers || []) {
          if (sharesTrustAnchor(idp, s)) {
            findings.push(refuse('DC-R27', `${JSON.stringify(idp.id)} and SERVICE issuer ${JSON.stringify(s.id)} rest on the same verification material. One trust anchor in both registries makes the service/human separation a naming convention, and this module cannot show it did not sign this assertion itself`));
          }
        }
        if (transcriptionIssuer && sharesTrustAnchor(idp, transcriptionIssuer)) {
          findings.push(refuse('DC-R27', `${JSON.stringify(idp.id)} shares verification material with the transcription issuer ${JSON.stringify(transcriptionIssuer.id)} directly`));
        }
        if (trustAnchors(idp).size === 0) {
          findings.push(refuse('DC-R29', `${JSON.stringify(idp.id)} pins no key, provider or JWKS (an \`ADOPT:\` placeholder is text nobody replaced, not material). With nothing to compare, the overlap check above can report nothing and the bridge's inability to have signed this is unprovable`));
        }
        if (idp.demo === true) {
          findings.push(refuse('DC-R30', `${JSON.stringify(idp.id)} is the bundle's reference issuer. Its private half existed — it signed the worked example — and every adopter who copied the file holds the same public one, so an assertion under it is exactly the shape this module refuses. Register your identity provider's own material`));
        }
      } else {
        findings.push(refuse('DC-R28', `${JSON.stringify(a.issuer)} is not in the assertion-issuers registry, so no material is pinned for it and nothing distinguishes it from a key the bridge holds`));
      }
    }
  }

  // ── 9 · assemble. Deterministic: every field is either derived from the plan and the map, or
  // copied verbatim from the observation. Nothing is invented, and nothing is taken from `input`
  // that the caller was not allowed to set.
  const draft = {
    schema: SCHEMA_ID,
    change_id: ctx.plan?.change_id ?? null,
    stage: d.stage ?? null,
    outcome: d.outcome ?? null,
    role: d.role ?? null,
    subject: compact({
      registry_id: entry?.registry_id ?? null,
      idp_subject: entry?.idp_subject ?? null,
      assertion: a && typeof a === 'object'
        ? compact({
          mechanism: a.mechanism,
          issuer: a.issuer,
          subject: a.subject,
          audience: a.audience,
          acr: a.acr,
          issued_at: a.issued_at,
          expires_at: a.expires_at,
        })
        : undefined,
    }),
    bound_to: compact({
      plan_hash: ctx.plan?.plan_hash ?? null,
      passport_digest: ctx.passportDigest ?? null,
      source_sha: input.bound_to?.source_sha,
      artifact_digest: input.bound_to?.artifact_digest,
      control_plan_path: input.bound_to?.control_plan_path,
    }),
    origin: compact({
      system: isStr(ctx.system) ? ctx.system : ORIGIN_SYSTEM,
      workspace_id: isStr(signal.workspace_id) ? signal.workspace_id : undefined,
      page_id: signal.refetch.id,
      data_source_id: isStr(obs.data_source_id) ? obs.data_source_id : undefined,
      // The account the surface says clicked. NOT in the canonical payload — residual 2.
      person_id: author?.id,
      event_id: signal.event_id,
      nonce: d.nonce,
      observed_at: obs.read_at,
    }),
    validity: compact({ issued_at: d.decided_at, expires_at: expiresAt, revoked: false }),
    transcription: compact({ by: ctx.transcriber, transcribed_at: iso(ctx.now) }),
    governance: { authority: AUTHORITY, banner: NON_AUTHORITATIVE },
  };

  // The digest the identity provider must bind. Computed over the draft WITHOUT the assertion's
  // nonce and signature — those are the answer, and a payload containing its own answer could not
  // be computed by the party who has to ask the question.
  const payload = canonicalDecisionPayload(draft);
  const nonce = sha256(payload);

  if (!emit) {
    if (findings.length) return nothing(findings);
    return { draft: deepFreeze(draft), payload, nonce, findings: [] };
  }

  // The replay SITE: which record slot this nonce is being spent on. Keyed on the change and the
  // (stage, role) file, because those are the boundaries a re-use would cross — the same reasoning
  // `approval-attestations.mjs` gives for its own site key. Re-emitting the SAME slot is a
  // replacement and shows up as a diff; presenting one authentication for two slots is not.
  const site = isStr(ctx.site) ? ctx.site : `${ctx.plan?.change_id ?? 'unknown'} · ${slotPath(d.stage, d.role)}`;

  // ── 10 · binding and single use. This is where an assertion stops being an authentication and
  // becomes an approval of one specific decision.
  let nonceKey = null;
  if (a && typeof a === 'object') {
    if (!isStr(a.nonce)) {
      findings.push(refuse('DC-R31', 'the assertion carries no nonce over the decision payload. Binding is what separates an approval from a login: without it the same assertion authorises every decision the bridge chooses to attach it to'));
    } else if (a.nonce !== nonce) {
      findings.push(refuse('DC-R31', `the assertion binds ${a.nonce} and this decision is ${nonce}. Something in the payload differs from what the human authenticated over — stage, outcome, role, change, subject, decision time, origin or custodian. Call \`assembleDecision()\` first and request the assertion over the digest it returns`));
    } else {
      // Checked here, RECORDED only when an envelope is actually emitted (step 12). A capture that
      // is refused for some other reason must not consume the authentication — the same ordering
      // `core/floor-webhook.mjs` gives for deduplicating last, and for the same reason: spending a
      // nonce on a record that was never written is a denial primitive with no upside.
      nonceKey = `assertion:${a.issuer}:${a.nonce}`;
      const prior = ctx.seen.get(nonceKey);
      if (prior !== undefined && prior !== site) {
        findings.push(refuse('DC-R32', `this nonce was already used by ${prior}. One authentication backs one decision; reusing it would let a single click stand behind two`));
      }
    }
    if (!isStr(a.signature) && a.mechanism === 'ed25519') {
      findings.push(refuse('DC-R23', 'the ed25519 assertion carries no signature — a declared mechanism with nothing to verify is an unsigned claim in a signed shape'));
    }
    if (entry && isStr(a.subject) && a.subject !== entry.idp_subject) {
      findings.push(refuse('DC-R33', `the assertion names subject ${JSON.stringify(a.subject)}; the map binds this click to ${JSON.stringify(entry.idp_subject)}. A valid assertion for one human cannot be spent on another's decision`));
    }
    // The window has to FAIL CLOSED: an assertion with no declared window would otherwise read
    // exactly like one proven live, and "no liveness evidence" is not "liveness".
    for (const f of ['issued_at', 'expires_at']) {
      if (parseTime(a[f]) === null) {
        findings.push(refuse('DC-R34', `\`${f}\` ${JSON.stringify(a[f])} is missing or not a parseable ISO-8601 instant — an assertion with no readable window cannot be shown to have been live when the decision was made`));
      }
    }
    const aIat = parseTime(a.issued_at);
    const aExp = parseTime(a.expires_at);
    if (decidedAt !== null && aExp !== null && aExp < decidedAt) {
      findings.push(refuse('DC-R34', `the assertion expired at ${a.expires_at}, before the decision at ${d.decided_at}. Judged against the SIGNED decision time, never against now: a step-up token lives minutes and a gate re-verifies for years`));
    }
    if (decidedAt !== null && aIat !== null && aIat > decidedAt) {
      findings.push(refuse('DC-R34', `the assertion was issued at ${a.issued_at}, after the decision at ${d.decided_at} — an authentication cannot attest a decision that preceded it`));
    }
  }

  // ── 11 · the transcription. Custody, and only custody.
  const att = input.attestation;
  if (!att || !isStr(att.issuer) || !isStr(att.signature)) {
    findings.push(refuse('DC-R22', `pass \`attestation: { issuer, signature }\` — the bridge's signature over the canonical payload. It proves the bridge carried this faithfully and proves nothing about who decided`));
  } else {
    const signer = issuerEntry(ctx.issuers, att.issuer);
    if (!signer) {
      findings.push(refuse('DC-R22', `attestation issuer ${JSON.stringify(att.issuer)} is not in the service attestation-issuers registry — an unregistered signer does not count`));
    } else if (!isStr(signer.identity)) {
      findings.push(refuse('DC-R22', `issuer ${JSON.stringify(signer.id)} declares no \`identity\`, so the signing key is not bound to a registry identity and the credited custodian cannot be checked`));
    } else if (signer.identity !== ctx.transcriber) {
      findings.push(refuse('DC-R22', `issuer ${JSON.stringify(signer.id)} signs for ${JSON.stringify(signer.identity)} but custody will be credited to ${JSON.stringify(ctx.transcriber)} — the credited custodian is not the signer`));
    }
  }

  if (findings.length) return nothing(findings);

  const envelope = { ...draft, subject: { ...draft.subject, assertion: { ...draft.subject.assertion, nonce: a.nonce, ...(isStr(a.signature) ? { signature: a.signature } : {}) } }, transcription: { ...draft.transcription, attestation: { issuer: att.issuer, signature: att.signature } } };

  // ── 12 · the self-check. The envelope is verified by the verifier that will judge it, HERE, so a
  // record that cannot pass is never written to a branch. Three of that verifier's checks are
  // vacuous at capture time and it is important to say which: `stage`, `role` and
  // subject-versus-passport are compared against what the PASSPORT claims, and the passport entry
  // this envelope will be cited by does not exist until the PR this prepares is merged. Everything
  // else — plan agreement, both signatures, the P6 join, replay, expiry — is real.
  const selfCheck = verifyApprovalAttestation(envelope, {
    stage: envelope.stage,
    role: envelope.role,
    by: envelope.subject.registry_id,
    plan: ctx.plan,
    passportDigest: ctx.passportDigest,
    registry: ctx.registry,
    issuers: ctx.issuers,
    assertionIssuers: ctx.assertionIssuers,
    resolveApprover: ctx.resolveApprover,
    identityOf: ctx.identityOf,
    map: ctx.map,
    seen: ctx.seen,
    site,
    now: ctx.now,
  }, 'emission');
  const unverified = selfCheck.filter(isMechanismCaveat);
  const refusals = selfCheck.filter((f) => !isMechanismCaveat(f));
  if (refusals.length) return nothing(refusals.map((f) => refuse('DC-R35', f)));

  // The authentication is spent HERE, on the way out, and not a step earlier.
  if (nonceKey) ctx.seen.set(nonceKey, site);

  return {
    envelope: deepFreeze(envelope),
    path: `${APPROVALS_SUBDIR}/${slotPath(d.stage, d.role)}`,
    payload,
    nonce,
    findings: [],
    unverified,
  };
}

/** One file per (stage, role) slot — see the `path` note on `captureDecision()`. */
export const slotPath = (stage, role) => `${String(stage ?? 'unknown').toLowerCase()}-${String(role ?? 'unknown')}.json`;

/**
 * The reader's half of the label guarantee: does this envelope still say what it is worth?
 *
 * A gate, a PR check or a projection can call this on a record it did not emit. It is the only
 * defence against a label removed by composing a new object, because the banner is outside the
 * signed payload (see the header) — so it is a check someone must RUN, and the tests prove it
 * catches both removal and paraphrase. Findings ([] ⇒ the envelope is labelled as emitted).
 */
export function verifyEmission(envelope, label = 'emission') {
  const findings = [];
  if (!envelope || typeof envelope !== 'object') return [`${label} · ${refuse('DC-R36', 'there is no envelope to read')}`];
  if (envelope.schema !== SCHEMA_ID) {
    findings.push(`${label} · ${refuse('DC-R35', `schema ${JSON.stringify(envelope.schema)} is not ${SCHEMA_ID}`)}`);
  }
  if (envelope.governance?.authority !== AUTHORITY) {
    findings.push(`${label} · ${refuse('DC-R36', `\`governance.authority\` is ${JSON.stringify(envelope.governance?.authority)} and must be ${JSON.stringify(AUTHORITY)} while WS5's entry gate is open`)}`);
  }
  if (envelope.governance?.banner !== NON_AUTHORITATIVE) {
    findings.push(`${label} · ${refuse('DC-R36', 'the banner is absent or reworded. It is the only sentence standing between a well-formed record and a false approval, so a paraphrase is not it')}`);
  }
  // A DRAFT must not read as an emission. `assembleDecision()` returns a record with the assertion's
  // CLAIMS and no nonce, no signature and no transcription — the question, not the answer — and a
  // reader that accepted it would accept a decision nobody authenticated and nobody carried.
  const a = envelope.subject?.assertion;
  if (!a) {
    findings.push(`${label} · ${refuse('DC-R23', 'the envelope carries no subject assertion — whatever else it carries, it does not evidence a human decision')}`);
  } else if (!isStr(a.nonce)) {
    findings.push(`${label} · ${refuse('DC-R31', 'the assertion carries no nonce, so this is a draft from `assembleDecision()` — the question that was asked, not the answer that came back')}`);
  }
  if (!envelope.transcription?.attestation) {
    findings.push(`${label} · ${refuse('DC-R22', 'nothing signs for custody — no party is on record as having carried this')}`);
  }
  return findings;
}

// CLI: print the rejection contract. There is nothing here to run against a repository — this
// module reads no files and makes no calls — so what it can usefully answer is "what will refuse
// me, and why", which is the question an adopter wiring a bridge actually has.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${SCHEMA_ID} · decision capture (WS5 · D5.2)\n${NON_AUTHORITATIVE}\n\n`);
  for (const [code, why] of REJECTIONS) process.stdout.write(`  ${code}  ${why}\n`);
  process.stdout.write(`\n${REJECTIONS.size} rejection codes. Every emission is labelled \`authority: "${AUTHORITY}"\`.\n`);
}
