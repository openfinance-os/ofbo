// The four evidence streams (Factory Floor WS5 · D5.3). One adapter, one control, each — and the
// word "each" is the whole delivery.
//
// WHAT F4 ACTUALLY WAS. The external control review found that one adapter was carrying several
// unrelated claims, and it named the specific shape: a refused `release-hold.json` write proves
// PLATFORM PROTECTION — the forge would not let a service identity touch a CODEOWNERS-protected
// path — and it was standing in as evidence that a collaboration-surface approval had been
// AUTHENTICALLY ISSUED BY A HUMAN. Those are two different facts about two different mechanisms.
// One probe was answering both questions, and the second answer was never tested. That is not a
// documentation defect: an auditor reading the repository would have found a green control with a
// receipt attached, and the receipt was for something else.
//
// So the correction cannot be a sentence in a runbook saying "one control per adapter". It has to be
// arithmetic. This module makes the binding structural in four places:
//
//   1. An adapter names EXACTLY ONE control. Not "should" — the plural shapes are refused as FIELDS
//      (`satisfies_controls`, an array, a delimiter-packed string), the same move `core/identity-map.mjs`
//      makes with `email`: the thing that makes the shortcut available is the field's existence, so
//      the refusal is of the field and not of its use.
//   2. An EVIDENCE RECORD names exactly one control too, and that control must be its adapter's. A
//      record naming two is a finding; a record naming another adapter's control is named as the
//      borrow it is (AD-R13), with the adapter it was borrowed from printed.
//   3. NO TWO ADAPTERS MAY CLAIM THE SAME CONTROL. This is F4 inverted, and it is the door most
//      likely to be left open: with `notion-pa-decision` and `github-codeowners-hold` both naming
//      one control, a rejected release-hold write satisfies the PA claim again — the exact defect,
//      re-entered from the other side. Streams that share a control are fungible, and fungible
//      streams are one stream wearing four names.
//   4. Activation is per-adapter and per-negative. A stream that declares four negatives is not
//      active until FOUR rejected probes exist. One probe cannot stand in for the other three,
//      which is finding F4 restated at the level of the evidence rather than the declaration.
//
// DECLARED IS THE DEFAULT, AND IT MUST LOOK LIKE IT. An adapter with no verified observation reports
// `declared` — always, including on a green run, in capitals, because `scripts/adapter-check.mjs`
// established that honesty as a NOTICE and a notice nobody prints is not honesty. What this module
// adds is teeth: an adapter cannot self-declare activation. `activation_evidence` populated with real
// values and no verified observation bound to that adapter is AD-R09 — the repository asserting
// liveness nobody observed. And `satisfiedControls()` returns only ACTIVE adapters' controls, so a
// declared stream cannot satisfy anything, by construction rather than by care.
//
// HOW THIS RELATES TO `scripts/platform-activation-check.mjs`, WHICH ALREADY EXISTS AND IS RIGHT.
// Two of D5.3's four streams — `github-branch-protection` (HG-0001) and `github-codeowners-hold`
// (HG-0002) — observe FORGE mechanisms, and that gate already verifies forge observations: signed,
// bypass-tested, observer outside the agent's write authority, fresh. Re-verifying them here would
// fork the verifier of record, and a fork is worse than a duplicate: two verifiers for one mechanism
// means an adopter can route a weak observation to whichever is more forgiving. So this module does
// NOT re-verify them. An adapter declares `activation_source`, and the routing is checked in both
// directions:
//
//   AD-R07  delegating to that gate a mechanism it cannot verify — the observation would be filed
//           where nothing reads it, and the stream would sit at `declared` forever with no reason
//           given. This is the threat model's gap G-2 made into a finding.
//   AD-R08  verifying HERE a mechanism that gate owns — the fork. Route it to the owner.
//
// What is verified here is the half that gate cannot reach: the seam's own mechanisms. G-2 records
// them as missing from its enum, and the enum is right to lack them — a human decision assertion and
// a collaboration-surface liveness probe are not forge settings. They live in `SEAM_MECHANISMS`.
//
// AND THE WINDOW. G-2's second half: that gate's default freshness window is 365 days, which is
// correct for branch protection (a setting that changes when someone changes it) and absurd for a
// SaaS seam whose freshness target is measured in minutes. The default here is 7 days, matching the
// identity map's reconciliation window and the drift watcher's, and an adapter may TIGHTEN it but
// never widen it (AD-R06). An adapter that could set its own window to a year would be grading its
// own homework with a deadline it chose.
//
// NO CLOCK, NO NETWORK, NO VENDOR. The observation arrives as a committed, signed record — exactly as
// the identity map's currency arrives as a signed reconciliation and drift's arrives as a watcher's
// observation. `now` is injected. A gate that phoned the vendor would put an integration token in CI,
// make every build depend on a SaaS provider's availability, and make a past verdict unreproducible,
// which is the one thing an evidence trail may never be.
//
// FIVE RESIDUALS THIS MODULE DOES NOT CLOSE, named so silence is not mistaken for coverage:
//
//   1. G-5 IS NARROWED, NOT CLOSED. The threat model's gap G-5 is that nothing stops the independent
//      observer from being the platform admin who holds the toggle for the mechanism they tested — a
//      bypass test signed by the person holding the bypass is self-attestation with extra steps.
//      `evidence.observes_identities` is now the place to say who that is, and an observer named
//      there is refused (AD-R19/AD-R20). But the harness cannot know an institution's toggle-holders
//      unless the institution lists them, and G-5's actual decision — separate hat, or a second
//      admin's countersignature — is AWAITING a human. An adapter that lists nobody gets the older,
//      weaker rule: not an agent, not a builder. Which is where G-5 started.
//   2. THE OBSERVATION IS AUTHENTIC, NOT NECESSARILY TRUE. This module proves a registered observer
//      signed a record saying the platform refused a probe. It cannot prove the probe was really run.
//      That gap closes with the observer's independence and nothing else, which is why independence is
//      checked so hard here and why `demo: true` anchors are refused outright.
//   3. THE NEGATIVE IDS ARE NAMES, NOT SEMANTICS. Coverage is by exact id, so a stream declaring
//      `["agent-approval", "replay"]` is satisfied by two probes carrying those ids. Nothing here
//      knows that a probe labelled `replay` actually replayed anything. What the coverage rule buys
//      is that one probe cannot cover four claims — which is F4 — not that any probe is honest.
//   4. THE STREAM CONTRACT IS OPT-IN. `isStreamAdapter()` binds only an adapter that names a
//      mechanism or an activation source — see that function for why an unconditional rule would be
//      an outage rather than a control. The consequence is that an adopter can keep a pre-D5.3
//      adapter forever and this gate will never make a claim about it outside a compiled plan. It
//      cannot ACTIVATE one either, so the omission is fail-closed; but "this gate said nothing" and
//      "this gate approved it" look identical from outside, which is why it is written down here.
//   5. THE CATALOG HOOK SHIPS UNUSED. `checkCatalogClaims()` reads an `adapter_ref` on a catalog
//      control, and no shipped catalog entry carries one. That is deliberate — every existing
//      adopter's catalog stays silent — but it means the rule is available, not applied. Declared,
//      not active, like everything else here, and said out loud for the same reason.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.adapter-evidence/v1';
/** The capability a compiled plan sets to make stream activation mandatory. */
export const CAPABILITY = 'adapter_evidence';

/**
 * The mechanisms verified HERE — the seam's own, the ones `platform-activation-check.mjs` cannot
 * reach and should not try to (threat model G-2). A forge setting and a human decision are not the
 * same kind of fact, and one enum covering both would invite one verifier covering both.
 *
 *   human_decision_assertion  a subject-bound human decision arrived, authenticated, and the
 *                             surface refused the things it must refuse (D5.2's negatives)
 *   seam_liveness             the seam itself is up, and was observed refusing a bypass — the
 *                             stream that vouches for the other streams' plumbing
 */
export const SEAM_MECHANISMS = new Set(['human_decision_assertion', 'seam_liveness']);

/** Where a stream's activation evidence is verified. Checked in both directions (AD-R07/AD-R08). */
export const ACTIVATION_SOURCES = new Set(['adapter-evidence', 'platform-activation']);

/**
 * Plural claim fields, refused on sight. F4 was one adapter carrying several claims; these are the
 * shapes that let it happen again while `scripts/adapter-check.mjs` — which checks that
 * `satisfies_control` is a non-empty STRING — still passes. `satisfies_controls: ["A", "B"]` beside a
 * singular `satisfies_control: "A"` is a second claim in a field no gate reads, which is precisely
 * how the first one got in.
 */
export const FORBIDDEN_ADAPTER_FIELDS = ['satisfies_controls', 'controls', 'satisfies', 'also_satisfies'];

/** Anything that reads as more than one control id in a single string. */
const MULTI_CONTROL = /[,;|]|\s\+\s|\band\b/i;

/**
 * The seam's freshness bound. Seven days, not the forge gate's 365: a SaaS seam changes underneath
 * you between one sprint and the next, and G-2 names the year-long window as the reason a stale seam
 * observation would pass if the enum let it be filed at all. Adopters tighten; nobody widens.
 */
export const DEFAULT_MAX_AGE_DAYS = 7;
/**
 * Tolerance for disagreeing clocks. A CI runner thirty seconds ahead of the observer's laptop must
 * not turn a real observation into a red build; an observation dated tomorrow is not an observation.
 */
export const CLOCK_SKEW_MINUTES = 5;

const DAY = 86400000;
const MINUTE = 60000;

/**
 * D5.3's four streams, as reference data rather than prose. One control each, one mechanism each, and
 * the negatives each must have executed before it may read as anything but `declared`.
 *
 * This table is NOT enforcement — an adopter's adapters are whatever they mount. It exists so the
 * gate can say which of the four are missing when a plan compiles the capability, and so the intended
 * mapping is in code where it can be read against the mounted files.
 *
 * `FLOOR-SEAM` does not exist in the shipped control catalog. That is honest rather than an
 * oversight: the seam's own liveness is a new control an adopting institution must add and own, and a
 * control id invented by the harness and owned by nobody is exactly the mapping-to-nothing that
 * `adapter-check.mjs` refuses.
 */
export const STREAMS = Object.freeze([
  Object.freeze({
    adapter_id: 'notion-pa-decision',
    satisfies_control: 'PA-GATES',
    system: 'notion',
    mechanism: 'human_decision_assertion',
    activation_source: 'adapter-evidence',
    claim: 'an authenticated, subject-bound human decision reached the repository',
    required_negatives: Object.freeze(['agent-or-bot-approval', 'unregistered-human', 'replay', 'post-decision-mutation']),
  }),
  Object.freeze({
    adapter_id: 'github-branch-protection',
    satisfies_control: 'HG-0001',
    system: 'github',
    mechanism: 'branch_protection',
    activation_source: 'platform-activation',
    claim: 'no sync identity can merge or bypass branch protection',
    required_negatives: Object.freeze(['sync-identity-merge']),
  }),
  Object.freeze({
    adapter_id: 'github-codeowners-hold',
    satisfies_control: 'HG-0002',
    system: 'github',
    mechanism: 'codeowners',
    activation_source: 'platform-activation',
    claim: 'neither the freezer nor the bridge can alter release-hold.json',
    required_negatives: Object.freeze(['seam-identity-writes-release-hold']),
  }),
  Object.freeze({
    adapter_id: 'notion-activation',
    satisfies_control: 'FLOOR-SEAM',
    system: 'notion',
    mechanism: 'seam_liveness',
    activation_source: 'adapter-evidence',
    claim: 'the seam itself is live and was observed refusing a bypass, signed by the independent observer',
    required_negatives: Object.freeze(['seam-bypass']),
  }),
]);

/**
 * Rejection codes, in the style of `core/identity-map.mjs`'s `IM-Rnn` and `core/floor-drift.mjs`'s
 * `DR-Fnn`: an operator reading a red build can look one up and find out exactly what was refused
 * and why it is not negotiable.
 *
 * DECLARATION — the F4 correction, made arithmetic
 *   AD-R01  An adapter that names no control. It provides evidence for nothing in particular.
 *   AD-R02  An adapter that names MORE THAN ONE control — a plural field, an array, or two ids
 *           packed into one string. The original finding, refused at the field.
 *   AD-R03  An unknown or absent `activation_source`. Nobody would verify it, and a stream nobody
 *           verifies sits at `declared` with no explanation, which reads like an oversight.
 *   AD-R04  An unknown mechanism: neither a seam mechanism nor one the forge gate owns.
 *   AD-R05  Two adapters claiming the SAME control. F4 inverted: shared controls make the streams
 *           fungible, and one probe satisfies a claim it never tested. Again.
 *   AD-R06  An adapter widening its own freshness window past the seam default (G-2's second half).
 *
 * VERIFIER ROUTING — one mechanism, one verifier
 *   AD-R07  Delegated to `platform-activation-check.mjs` a mechanism that gate cannot verify.
 *   AD-R08  Verified here a mechanism that gate owns — a second, possibly weaker verifier.
 *
 * ACTIVATION STATE — declared may never read as active
 *   AD-R09  An adapter SELF-DECLARING activation: populated `activation_evidence`, no verified
 *           observation bound to it. Activation is observed, not declared.
 *   AD-R10  A catalog control citing an adapter (`adapter_ref`) that is only declared.
 *
 * EVIDENCE RECORDS
 *   AD-R11  Unreadable as a record: wrong schema, no adapter named, no parseable instant.
 *   AD-R12  A record naming more than one control.
 *   AD-R13  Evidence bound to adapter A offered for adapter B — the borrow, named.
 *   AD-R14  A record whose control is not its own adapter's declared control.
 *   AD-R15  A record whose mechanism is unknown, or disagrees with its adapter's.
 *   AD-R16  Unsigned, or signed by an issuer outside the registry.
 *   AD-R17  A `demo: true` anchor. A key shipped with the harness is held by every adopter who
 *           copied the file, and its private half demonstrably exists.
 *   AD-R18  The credited observer is not the signer — `observer_identity` is a registry id and the
 *           signature carries an issuer id, so without the issuer's `identity` binding the credit
 *           is free text.
 *   AD-R19  Self-attestation: signed by, or credited to, an identity the observation makes a claim
 *           ABOUT. You cannot vouch for your own guardrail.
 *   AD-R20  The observer is inside the write authority it vouches for: an agent, a builder, or an
 *           identity the stream is a claim about.
 *   AD-R21  A stale observation.
 *   AD-R22  A future-dated observation.
 *   AD-R23  No executed, rejected, fresh bypass probe for every negative the stream declares.
 */
export const REJECTIONS = new Map([
  ['AD-R01', 'an adapter that names no control'],
  ['AD-R02', 'an adapter that names more than one control — the F4 conflation, refused at the field'],
  ['AD-R03', 'an unknown or absent activation_source — nobody would verify this stream'],
  ['AD-R04', 'an adapter declaring a mechanism no verifier owns'],
  ['AD-R05', 'two adapters claiming the same control — fungible streams are one stream wearing several names'],
  ['AD-R06', 'an adapter widening its own freshness window'],
  ['AD-R07', 'a mechanism delegated to a gate that cannot verify it'],
  ['AD-R08', 'a mechanism re-verified here that the platform-activation gate owns'],
  ['AD-R09', 'an adapter self-declaring activation with no verified observation bound to it'],
  ['AD-R10', 'a catalog control citing an adapter that is only declared'],
  ['AD-R11', 'a record that cannot be read as an evidence record'],
  ['AD-R12', 'a record naming more than one control'],
  ['AD-R13', 'evidence bound to one adapter offered for another'],
  ['AD-R14', "a record whose control is not its adapter's control"],
  ['AD-R15', 'a record whose mechanism is unknown or disagrees with its adapter'],
  ['AD-R16', 'an unsigned observation, or one signed by an unregistered issuer'],
  ['AD-R17', 'a demo anchor underwriting a real observation'],
  ['AD-R18', 'the credited observer is not the signer'],
  ['AD-R19', 'self-attestation: the observation is signed by an identity it makes a claim about'],
  ['AD-R20', 'the observer is inside the write authority it vouches for'],
  ['AD-R21', 'a stale observation'],
  ['AD-R22', 'a future-dated observation'],
  ['AD-R23', 'a stream negative with no executed, rejected, fresh bypass probe'],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/** ISO-8601 only — the type is part of the check, as in the attestation, mapping and drift contracts. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const days = (ms) => Math.floor(ms / DAY);

/**
 * Recursive canonical serialisation, DELIBERATELY the same recipe as `activationHash`'s in
 * `scripts/platform-activation-check.mjs`. Same recipe means an adopter's observer signs one kind of
 * string whichever stream it is producing, and a record can be moved between the two verifiers
 * without re-signing. `scripts/adapter-evidence-check.test.mjs` asserts the two agree byte for byte,
 * so this stays true rather than merely being intended.
 */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Canonical hash of an evidence record, excluding its own attestation. */
export function evidenceHash(record) {
  const { attestation, ...rest } = record || {};
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

/** Is this change's plan requiring streams to be ACTIVE, not merely declared? (mandatory-when-compiled) */
export function activationRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

/**
 * The evidence record a stream's observer commits. The mirror of a platform-activation observation,
 * for the mechanisms that gate does not own.
 *
 * `observedAt` is the caller's — this module has no clock, deliberately, so a verdict is reproducible
 * on any machine on any future date.
 */
export function evidenceRecord({ adapterId, control, mechanism, observation, bypassTests = [], observedAt, observedBy }) {
  return {
    _comment: 'Written by the independent observer for ONE adapter and ONE control (Factory Floor D5.3 · F4). Evidence for one stream never counts for another: the adapter_id and satisfies_control below are both inside the signed hash, and the gate refuses a record whose control is not its adapter\'s. Sign evidenceHash(record) with the observer\'s registered ed25519 key.',
    schema: SCHEMA_ID,
    adapter_id: adapterId,
    satisfies_control: control,
    mechanism,
    observation: observation ?? null,
    bypass_tests: bypassTests,
    observer_identity: observedBy || null,
    observed_at: observedAt || null,
  };
}

/**
 * The predicate `scripts/adapter-check.mjs` uses to decide whether an adapter LOOKS active, repeated
 * here on purpose and byte-compatibly. That gate turns a false answer into an honest NOTICE; this one
 * turns a true answer into a CLAIM that must be backed (AD-R09). Two gates reading one field two ways
 * would be how "declared, not active" quietly stopped meaning anything, so the script's test asserts
 * the two agree on the same input.
 */
export function selfDeclaresActive(adapter) {
  const ae = adapter?.activation_evidence;
  if (!ae || typeof ae !== 'object') return false;
  return Object.keys(ae).some((k) => !k.startsWith('_') && isStr(ae[k]) && !/^ADOPT:/.test(ae[k]));
}

/** The freshness bound for one adapter: the seam default, or tighter if the adapter says so. */
export function maxAgeDaysFor(adapter, fallback = DEFAULT_MAX_AGE_DAYS) {
  const n = adapter?.evidence?.max_age_days;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= fallback ? n : fallback;
}

/** The identities a stream makes a claim ABOUT — nobody in this list may observe it. */
const observedIdentities = (adapter) => {
  const v = adapter?.evidence?.observes_identities;
  return Array.isArray(v) ? v.filter(isStr) : [];
};

/**
 * Does this adapter opt into the D5.3 stream contract?
 *
 * THE OPT-IN IS DELIBERATE AND IT IS WHERE "SILENT WHERE UNADOPTED" LIVES IN THIS MODULE. Adapters
 * predate D5.3 — the shipped reference mappings (`github-branch-protection`, `grc-control-register`)
 * declare no `mechanism` and no `activation_source`, because there was nothing to declare one to. If
 * the stream rules applied to every adapter, every existing adopter would get a red build on the day
 * they upgraded, for adapters they wrote correctly against the contract that existed, with no route to
 * green except deleting them. A gate with no route to green is not a control; it is an outage.
 *
 * So the stream contract binds an adapter that ASKS for it: one that names a mechanism or names an
 * activation source. And omitting the mechanism is not an escape hatch — an adapter outside the
 * contract can never be ACTIVATED here either. It sits at `declared` forever and satisfies nothing,
 * which is the fail-closed direction. `adapter-check.mjs` remains its only gate, exactly as before.
 *
 * NOT BY STREAM ID, and the reason is the shipped `adapters/reference/github-branch-protection.json`.
 * It carries one of D5.3's four ids and, correctly for the contract that existed when it was written,
 * no mechanism. Opting it in by name would have failed the adoption dry-run the day this gate was
 * wired into CI — a shipped reference file that fails a shipped gate, which is the kind of thing that
 * gets a gate deleted rather than fixed. Completeness for the four named streams is enforced instead
 * where it actually matters: `checkCompiledRequirement()` demands every D5.3 stream be ACTIVE once a
 * plan compiles the capability, by id, whether or not the adapter opted in. A stream that names no
 * mechanism can never be active, so it fails there with the reason printed.
 */
export function isStreamAdapter(adapter) {
  return isStr(adapter?.mechanism) || isStr(adapter?.activation_source);
}

/** The negatives a stream must have executed before it may read as anything but `declared`. */
export function requiredNegatives(adapter) {
  const v = adapter?.evidence?.required_negatives;
  if (Array.isArray(v) && v.filter(isStr).length) return v.filter(isStr);
  const stream = STREAMS.find((s) => s.adapter_id === adapter?.adapter_id);
  return stream ? [...stream.required_negatives] : [];
}

/**
 * One adapter's declaration (AD-R01…AD-R08). `delegatedMechanisms` is INJECTED — the set the
 * platform-activation gate owns — because `core/` may not import from `scripts/`, and hard-coding a
 * copy of another gate's enum here is how the two would drift apart in opposite directions.
 *
 * This does NOT repeat what `scripts/adapter-check.mjs` already does: that gate checks the adapter is
 * well formed, that `satisfies_control` is a non-empty string, and that it resolves to a real catalog
 * control. What is added here is singularity — the plural shapes it cannot see — and routing.
 *
 * SINGULARITY APPLIES TO EVERY ADAPTER; ROUTING ONLY TO A STREAM. A plural claim field is the F4
 * defect wherever it appears and nobody else looks for it, so AD-R02 is universal. The mechanism and
 * activation-source rules bind only an adapter that opted into the contract (`isStreamAdapter`) —
 * see that function for why an unconditional rule would be an outage rather than a control.
 */
export function checkAdapterDeclaration(adapter, { delegatedMechanisms = new Set() } = {}) {
  const id = isStr(adapter?.adapter_id) ? adapter.adapter_id : '(no adapter_id)';
  const findings = [];
  const stream = isStreamAdapter(adapter);

  for (const f of FORBIDDEN_ADAPTER_FIELDS) {
    if (adapter && typeof adapter === 'object' && f in adapter) {
      findings.push(`AD-R02: ${id}: carries \`${f}\` — an adapter names exactly one control. Finding F4 was one adapter carrying several claims, so the plural field is refused rather than ignored: a second claim in a field no gate reads is how the first one got in`);
    }
  }
  const control = adapter?.satisfies_control;
  if (Array.isArray(control)) {
    findings.push(`AD-R02: ${id}: satisfies_control is an array (${control.length} entries) — one adapter, one control. Mount one adapter per control instead, so each carries its own evidence and its own negatives`);
  } else if (!isStr(control)) {
    // `adapter-check.mjs` already fails an adapter with no control, so this fires only where that
    // message would leave a stream unexplained. Two gates shouting one sentence teaches people to skim.
    if (stream) findings.push(`AD-R01: ${id}: names no control — an adapter provides evidence FOR something, and evidence for nothing in particular satisfies nothing`);
  } else if (MULTI_CONTROL.test(control)) {
    findings.push(`AD-R02: ${id}: satisfies_control ${JSON.stringify(control)} packs more than one control id into one string — one adapter, one control`);
  }

  const source = adapter?.activation_source ?? 'adapter-evidence';
  if (!stream) {
    // Pre-D5.3 adapter: outside the stream contract, so no mechanism is expected and none is checked.
    // It can never be activated here either, which is the fail-closed half of the same decision.
  } else if (!ACTIVATION_SOURCES.has(source)) {
    findings.push(`AD-R03: ${id}: activation_source ${JSON.stringify(adapter?.activation_source)} is not one of ${[...ACTIVATION_SOURCES].join(' | ')} — no verifier would read this stream's evidence, so it would sit at \`declared\` forever with no reason given`);
  } else {
    const m = adapter?.mechanism;
    const seam = SEAM_MECHANISMS.has(m);
    const delegated = delegatedMechanisms.has(m);
    if (!isStr(m) || (!seam && !delegated)) {
      findings.push(`AD-R04: ${id}: mechanism ${JSON.stringify(m)} is owned by no verifier — seam mechanisms are ${[...SEAM_MECHANISMS].join(' | ')}; forge mechanisms belong to scripts/platform-activation-check.mjs`);
    } else if (source === 'platform-activation' && !delegated) {
      findings.push(`AD-R07: ${id}: mechanism ${JSON.stringify(m)} is delegated to scripts/platform-activation-check.mjs, which does not verify it — the observation would be filed where nothing reads it and this stream would never leave \`declared\`. Either verify it here (activation_source \`adapter-evidence\`) or extend that gate's enum (threat model G-2)`);
    } else if (source === 'adapter-evidence' && delegated) {
      findings.push(`AD-R08: ${id}: mechanism ${JSON.stringify(m)} is already owned by scripts/platform-activation-check.mjs — verifying it here too would fork the verifier of record, and two verifiers for one mechanism means the weaker one decides. Set activation_source to \`platform-activation\``);
    }
  }

  const n = adapter?.evidence?.max_age_days;
  if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= DEFAULT_MAX_AGE_DAYS)) {
    findings.push(`AD-R06: ${id}: evidence.max_age_days ${JSON.stringify(n)} does not tighten the ${DEFAULT_MAX_AGE_DAYS}-day seam window — an adapter may narrow its own freshness bound and never widen it, or it grades its own homework against a deadline it chose`);
  }
  return findings;
}

/**
 * AD-R05 — no two adapters claim the same control.
 *
 * THE JUDGEMENT WORTH ARGUING ABOUT, so it is stated plainly rather than buried. Two independent
 * evidence sources for one control is a reasonable thing to want, and this refuses it. The reason is
 * F4: the moment two adapters name one control, either one's evidence satisfies it, and the specific
 * defect the review found — a release-hold refusal standing in for an authenticated human decision —
 * is available again through a door nobody is watching. An adopter who genuinely has two sources for
 * one control should model them as ONE adapter with two required negatives, which is stricter (both
 * must be observed) rather than looser (either will do).
 */
export function checkStreamSeparation(adapters = []) {
  const findings = [];
  const byControl = new Map();
  for (const a of adapters) {
    const c = a?.satisfies_control;
    if (!isStr(c)) continue;
    if (!byControl.has(c)) byControl.set(c, []);
    byControl.get(c).push(isStr(a.adapter_id) ? a.adapter_id : '(no adapter_id)');
  }
  for (const [control, ids] of [...byControl].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (ids.length < 2) continue;
    findings.push(`AD-R05: control ${JSON.stringify(control)} is claimed by ${ids.length} adapters (${ids.sort().join(', ')}) — one control, one adapter. Sharing a control makes their evidence interchangeable, which is finding F4 re-entered from the other side: a probe of one mechanism would satisfy a claim about another. If both sources are genuinely needed, make them one adapter with both negatives required`);
  }
  return findings;
}

/** Every bypass probe on a record, however it was written. */
export function bypassProbes(rec) {
  const many = Array.isArray(rec?.bypass_tests) ? rec.bypass_tests : [];
  const one = rec?.bypass_test && typeof rec.bypass_test === 'object' ? [rec.bypass_test] : [];
  return [...many, ...one].filter((p) => p && typeof p === 'object');
}

/**
 * AD-R23 — every declared negative has an executed, rejected, fresh probe.
 *
 * This is F4 at the level of the evidence rather than the declaration: a stream declaring four
 * negatives is not active until four probes exist. One probe covering four claims is the original
 * finding with the adapter count reduced to one.
 */
export function checkNegatives(rec, adapter, { now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}, label = 'evidence') {
  const findings = [];
  const probes = bypassProbes(rec);
  if (!probes.length) {
    findings.push(`AD-R23: ${label}: no bypass probe — a configuration that looks active and was never observed refusing anything proves nothing about what it would refuse`);
  }
  const covered = new Set();
  const skew = CLOCK_SKEW_MINUTES * MINUTE;
  for (const [i, p] of probes.entries()) {
    const at = `${label} · probe ${isStr(p.negative) ? p.negative : i}`;
    let ok = true;
    if (!isStr(p.attempted)) { findings.push(`AD-R23: ${at}: names no attempted action — a probe that cannot say what it tried tested nothing`); ok = false; }
    if (p.result !== 'rejected') { findings.push(`AD-R23: ${at}: result is ${JSON.stringify(p.result)}, not "rejected" — the platform did not refuse the bypass`); ok = false; }
    const t = parseTime(p.tested_at);
    if (t === null) { findings.push(`AD-R23: ${at}: tested_at is missing or not a parseable ISO-8601 timestamp`); ok = false; }
    else if (now - t > maxAgeDays * DAY) { findings.push(`AD-R23: ${at}: the probe is ${days(now - t)} days old (limit ${maxAgeDays}) — re-run it`); ok = false; }
    else if (t - now > skew) { findings.push(`AD-R22: ${at}: tested_at ${p.tested_at} is in the future — a probe dated after the moment it is read was not run`); ok = false; }
    if (ok && isStr(p.negative)) covered.add(p.negative);
  }
  for (const need of requiredNegatives(adapter)) {
    if (covered.has(need)) continue;
    findings.push(`AD-R23: ${label}: the negative ${JSON.stringify(need)} has no executed, rejected, fresh probe (covered: ${covered.size ? [...covered].sort().join(', ') : 'none'}) — this stream declares ${requiredNegatives(adapter).length} negative(s) and one probe may not stand in for the others; that substitution is finding F4 itself`);
  }
  return findings;
}

/**
 * The observer's independence (AD-R18…AD-R20). Deliberately the same shape as
 * `platform-activation-check.mjs`'s observer-separation rule — not an agent, not a builder — plus the
 * narrowing G-5 asks for: an observer named among the identities this stream makes a claim ABOUT is
 * refused, because a bypass test signed by whoever holds the bypass is self-attestation with extra
 * steps.
 */
export function checkObserver(rec, adapter, { registry, issuers } = {}, label = 'evidence') {
  const findings = [];
  const who = rec?.observer_identity;
  if (!isStr(who)) {
    findings.push(`AD-R11: ${label}: names no observer_identity — an unattributed observation is a claim, and this one decides whether a control reads as active`);
    return findings;
  }
  const about = observedIdentities(adapter);
  if (about.includes(who)) {
    findings.push(`AD-R19: ${label}: the observer ${JSON.stringify(who)} is one of the identities this stream makes a claim about (${about.join(', ')}) — you cannot attest that your own guardrail is active`);
  }
  const entry = (registry?.identities || []).find((i) => i.id === who);
  if (registry && !entry) {
    findings.push(`AD-R20: ${label}: observer_identity ${JSON.stringify(who)} does not resolve in the identity registry — an unregistered observer has no independence to assess`);
  } else if (entry) {
    if (entry.kind === 'agent') {
      findings.push(`AD-R20: ${label}: observer ${JSON.stringify(who)} is an agent — an agent observing its own control plane is inside the write authority it vouches for`);
    } else if ((entry.groups || []).includes('builders')) {
      findings.push(`AD-R20: ${label}: observer ${JSON.stringify(who)} is a builder — an observation of the guardrail around your own changes is not independent`);
    }
  }
  // The credited observer must be the one who actually signed. `observer_identity` is a REGISTRY id
  // and the signature carries an ISSUER id — two namespaces — so the issuer entry binds them with
  // `identity`, exactly as `verifyTranscription` binds a custodian to its signing key. Without that
  // binding the credit is free text: one party signs and another is credited.
  const att = rec?.attestation;
  if (isStr(att?.issuer)) {
    const signer = (issuers?.issuers || []).find((i) => i.id === att.issuer);
    if (signer && !isStr(signer.identity)) {
      findings.push(`AD-R18: ${label}: issuer ${JSON.stringify(signer.id)} declares no \`identity\` — the signing key is not bound to a registry identity, so the credited observer cannot be checked and independence is UNVERIFIED-HERE`);
    } else if (signer && signer.identity !== who) {
      findings.push(`AD-R18: ${label}: observer_identity is ${JSON.stringify(who)} but issuer ${JSON.stringify(signer.id)} signs for ${JSON.stringify(signer.identity)} — the credited observer is not the signer`);
    }
    if (signer && isStr(signer.identity) && about.includes(signer.identity)) {
      findings.push(`AD-R19: ${label}: the observation is signed by ${JSON.stringify(signer.identity)}, an identity this stream makes a claim about — self-attestation, whoever is credited on the record`);
    }
    if (signer?.demo === true) {
      findings.push(`AD-R17: ${label}: issuer ${JSON.stringify(signer.id)} is marked \`"demo": true\` — a reference key shipped with the harness is held by every adopter who copied the file, and its private half demonstrably exists. Register your observer's own material`);
    }
  }
  return findings;
}

/**
 * Verify one evidence record against the adapter it claims. `verify` is INJECTED — the signature
 * primitive from `core/attestations.mjs`, passed in rather than imported so this module composes with
 * whatever the caller trusts and so the tests can exercise the refusals without a key pair for every
 * case. Absent, the signature is reported UNVERIFIED-HERE rather than silently skipped.
 *
 * ctx: { adapter, adapters, registry, issuers, verify, now, maxAgeDays }
 * Findings ([] ⇒ this observation is authentic, independent, fresh, bypass-tested and bound to
 * exactly this adapter's one control).
 */
export function verifyEvidence(rec, ctx = {}, label = 'evidence') {
  const { adapter, adapters = [], registry, issuers, verify, now = Date.now() } = ctx;
  if (!rec || typeof rec !== 'object') return [`AD-R11: ${label}: not an object`];
  if (rec.schema !== SCHEMA_ID) {
    // Shape unknown: every further check would be guesswork, exactly as in the attestation contract.
    return [`AD-R11: ${label}: schema ${JSON.stringify(rec.schema)} is not ${SCHEMA_ID} — an unversioned record cannot be verified`];
  }
  const findings = [];
  const maxAgeDays = ctx.maxAgeDays ?? maxAgeDaysFor(adapter);

  // 1 · WHICH STREAM. The binding is the whole delivery, so it is checked before anything else: a
  // record that cannot say which single stream it belongs to cannot be counted for any of them.
  if (!isStr(rec.adapter_id)) findings.push(`AD-R11: ${label}: names no adapter_id — evidence that cannot say which stream it belongs to cannot be counted for any of them`);
  if (Array.isArray(rec.satisfies_control)) {
    findings.push(`AD-R12: ${label}: satisfies_control is an array (${rec.satisfies_control.length} entries) — one record, one control. Evidence for two controls is the F4 conflation carried in the evidence instead of the declaration`);
  } else if (!isStr(rec.satisfies_control)) {
    findings.push(`AD-R11: ${label}: names no satisfies_control — an observation must say which control it activates`);
  } else if (MULTI_CONTROL.test(rec.satisfies_control)) {
    findings.push(`AD-R12: ${label}: satisfies_control ${JSON.stringify(rec.satisfies_control)} names more than one control — one record, one control`);
  }
  if (adapter) {
    if (isStr(rec.adapter_id) && rec.adapter_id !== adapter.adapter_id) {
      const other = adapters.find((a) => a?.adapter_id === rec.adapter_id);
      findings.push(`AD-R13: ${label}: this record is bound to adapter ${JSON.stringify(rec.adapter_id)}${other ? ` (which claims ${JSON.stringify(other.satisfies_control)})` : ''} and is being offered for ${JSON.stringify(adapter.adapter_id)} — evidence for one stream never counts for another. That substitution is finding F4`);
    }
    if (isStr(rec.satisfies_control) && isStr(adapter.satisfies_control) && rec.satisfies_control !== adapter.satisfies_control) {
      const borrowed = adapters.find((a) => a?.adapter_id !== adapter.adapter_id && a?.satisfies_control === rec.satisfies_control);
      findings.push(borrowed
        ? `AD-R13: ${label}: the record names control ${JSON.stringify(rec.satisfies_control)}, which belongs to adapter ${JSON.stringify(borrowed.adapter_id)}, not to ${JSON.stringify(adapter.adapter_id)} (${JSON.stringify(adapter.satisfies_control)}) — a stream cannot borrow another's control`
        : `AD-R14: ${label}: the record names control ${JSON.stringify(rec.satisfies_control)} but its adapter claims ${JSON.stringify(adapter.satisfies_control)} — an observation activates the control its adapter names, or nothing`);
    }
    if (rec.mechanism !== adapter.mechanism) {
      findings.push(`AD-R15: ${label}: the record's mechanism ${JSON.stringify(rec.mechanism)} is not the adapter's ${JSON.stringify(adapter.mechanism)} — the observation is of a different thing than the stream declares`);
    } else if (!SEAM_MECHANISMS.has(rec.mechanism)) {
      findings.push(`AD-R15: ${label}: mechanism ${JSON.stringify(rec.mechanism)} is not verified here — seam mechanisms are ${[...SEAM_MECHANISMS].join(' | ')}`);
    }
  }

  // 2 · WHAT the seam actually reported.
  if (!rec.observation || typeof rec.observation !== 'object') {
    findings.push(`AD-R11: ${label}: no observation object — what did the seam actually report?`);
  }

  // 3 · WHEN. Stale in one direction, impossible in the other. The forge gate checks only staleness;
  // a record dated next month would pass there and is refused here (threat model AC-5's second half).
  const at = parseTime(rec.observed_at);
  if (at === null) {
    findings.push(`AD-R11: ${label}: observed_at is missing or not a parseable ISO-8601 timestamp — an observation with no instant can be neither aged nor ordered`);
  } else if (now - at > maxAgeDays * DAY) {
    findings.push(`AD-R21: ${label}: the observation is ${days(now - at)} days old (limit ${maxAgeDays}) — nobody has looked recently enough for this stream to read as active. A SaaS seam changes underneath you between one sprint and the next`);
  } else if (at - now > CLOCK_SKEW_MINUTES * MINUTE) {
    findings.push(`AD-R22: ${label}: observed_at ${rec.observed_at} is in the future — an observation dated after the moment it is read has not happened, and a forward-dated record would stay "fresh" for as long as its author chose`);
  }

  // 4 · WHO looked, and whether they could have.
  findings.push(...checkObserver(rec, adapter, { registry, issuers }, label));

  // 5 · The negatives. Declared, executed, rejected, fresh — each of them.
  findings.push(...checkNegatives(rec, adapter, { now, maxAgeDays }, label));

  // 6 · Authenticity. Injected primitive; absent, the record is UNVERIFIED-HERE, never a silent pass.
  if (typeof verify === 'function') {
    findings.push(...verify(evidenceHash(rec), rec.attestation, issuers, 'evidence record').map((f) => `AD-R16: ${label}: ${f}`));
  } else {
    findings.push(`AD-R16: ${label}: no signature primitive was supplied, so the observation is UNVERIFIED-HERE — an unverified observation must never read as a verified one`);
  }
  return findings;
}

/**
 * One adapter's activation state. `declared` unless a verified observation says otherwise, and
 * `declared` is the value returned for an adapter nobody has observed at all — the default, not an
 * error condition.
 *
 * `records` are the evidence records offered for this adapter; foreign ones are REPORTED (AD-R13)
 * rather than silently dropped, because "your evidence did not count and nobody said why" is how an
 * adopter concludes the gate is broken and stops reading it.
 *
 * `delegations` are observations already verified by another gate of record — the platform-activation
 * gate, for the two forge streams. This module contributes the binding for those (a delegation for
 * another control cannot activate this adapter) and nothing else: their verification is not ours to
 * repeat or to second-guess.
 */
export function activationState(adapter, records = [], ctx = {}) {
  const id = isStr(adapter?.adapter_id) ? adapter.adapter_id : '(no adapter_id)';
  const stream = isStreamAdapter(adapter);
  const source = !stream ? null
    : ACTIVATION_SOURCES.has(adapter?.activation_source ?? 'adapter-evidence')
      ? (adapter?.activation_source ?? 'adapter-evidence')
      : null;
  const state = {
    adapter_id: id,
    control: isStr(adapter?.satisfies_control) ? adapter.satisfies_control : null,
    system: adapter?.system ?? null,
    mechanism: adapter?.mechanism ?? null,
    activation_source: source,
    stream,
    status: 'declared',
    verified: 0,
    offered: records.length,
    observed_at: null,
    observed_by: null,
    verified_by: null,
    findings: [],
  };

  const own = [];
  for (const { label, record } of records) {
    if (record && typeof record === 'object' && isStr(record.adapter_id) && record.adapter_id !== id) {
      state.findings.push(`AD-R13: ${label}: bound to adapter ${JSON.stringify(record.adapter_id)}, offered for ${JSON.stringify(id)} — evidence for one stream never counts for another, so it is not counted here`);
      continue;
    }
    own.push({ label, record });
  }

  if (source === 'platform-activation') {
    // The forge streams. Verification belongs to `scripts/platform-activation-check.mjs`; what is
    // added here is that a delegation must name THIS adapter's control and mechanism — the binding
    // F4 was missing. A record filed here for a delegated stream is a filing mistake worth naming:
    // nothing would read it, and its author would reasonably assume something had.
    for (const { label } of own) {
      state.findings.push(`AD-R07: ${label}: ${id} delegates activation to scripts/platform-activation-check.mjs, so an adapter-evidence record here is read by nothing — file the observation under docs/governance/platform-activation/`);
    }
    const match = (ctx.delegations || []).find((d) => d.satisfies_control === state.control && d.mechanism === state.mechanism);
    if (match) {
      state.status = 'active';
      state.verified = 1;
      state.observed_at = match.observed_at ?? null;
      state.observed_by = match.observer_identity ?? null;
      state.verified_by = 'scripts/platform-activation-check.mjs';
    }
  } else if (source === 'adapter-evidence') {
    const fresh = [];
    for (const { label, record } of own) {
      const f = verifyEvidence(record, { ...ctx, adapter }, label);
      state.findings.push(...f);
      if (f.length === 0) fresh.push(record);
    }
    if (fresh.length) {
      // The newest verified observation is the one the badge reports. Every one of them was fresh,
      // independent and fully bypass-tested, or it is not in this list.
      fresh.sort((a, b) => parseTime(a.observed_at) - parseTime(b.observed_at));
      const last = fresh[fresh.length - 1];
      state.status = 'active';
      state.verified = fresh.length;
      state.observed_at = last.observed_at;
      state.observed_by = last.observer_identity;
      state.verified_by = 'core/floor-adapters.mjs';
    }
  }

  // The teeth. `adapter-check.mjs` turns an EMPTY activation_evidence block into an honest notice;
  // this turns a POPULATED one with nothing behind it into a finding. A repository that can assert
  // its own liveness has no activation model at all — it has a field. Stream adapters only: an
  // adapter outside the contract has no observation record to file, so there would be no route to
  // green, and a gate with no route to green teaches people to delete their adapters.
  if (stream && state.status !== 'active' && selfDeclaresActive(adapter)) {
    state.findings.push(`AD-R09: ${id}: activation_evidence carries real values but no verified observation is bound to this adapter — activation is observed, not declared. Until an independent, bypass-tested, freshly signed observation lands, this stream is DECLARED, NOT ACTIVE, and writing values into the block does not change that`);
  }
  return state;
}

/**
 * Every adapter's state, plus the findings that belong to the set rather than to any one member.
 * `records` is the whole repository's evidence, routed by `adapter_id`; a record naming an adapter
 * nobody declared is reported rather than dropped.
 */
export function activationStates({ adapters = [], records = [], delegations = [], ...ctx } = {}) {
  const findings = [...checkStreamSeparation(adapters)];
  const declared = new Map();
  for (const a of adapters) {
    findings.push(...checkAdapterDeclaration(a, ctx));
    if (isStr(a?.adapter_id)) declared.set(a.adapter_id, a);
  }

  const routed = new Map([...declared.keys()].map((k) => [k, []]));
  for (const entry of records) {
    const rid = entry?.record?.adapter_id;
    if (isStr(rid) && routed.has(rid)) { routed.get(rid).push(entry); continue; }
    findings.push(`AD-R11: ${entry?.label || 'evidence'}: names adapter ${JSON.stringify(rid)}, which is not a declared adapter — evidence with no stream to belong to activates nothing, and an orphan record is more likely a rename nobody finished than a fabrication`);
  }

  const states = [];
  for (const [id, adapter] of [...declared].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const state = activationState(adapter, routed.get(id), { ...ctx, adapters, delegations });
    states.push(state);
    findings.push(...state.findings);
  }
  return { states, findings };
}

/**
 * The controls a set of states actually satisfies — ACTIVE streams only. This is the function that
 * makes "the gate must not let a declared adapter satisfy anything" structural: there is no path
 * through which a `declared` state contributes a control id, so no caller can accidentally count one.
 */
export function satisfiedControls(states = []) {
  return new Set(states.filter((s) => s.status === 'active' && isStr(s.control)).map((s) => s.control));
}

/**
 * AD-R10 — a catalog control that cites an adapter as its evidence may not read as enforced while
 * that adapter is only declared.
 *
 * Reads an `adapter_ref` that no shipped catalog entry carries, so every existing adopter is silent.
 * That is the same shape as every other capability here and it is also this rule's honest limit: the
 * hook exists, and nothing yet uses it (residual 5 in the header).
 */
export function checkCatalogClaims(catalog, states = []) {
  const findings = [];
  const byId = new Map(states.map((s) => [s.adapter_id, s]));
  for (const c of catalog?.controls || []) {
    const ref = c?.adapter_ref;
    if (!isStr(ref)) continue;
    const state = byId.get(ref);
    if (!state) {
      findings.push(`AD-R10: ${c.control_id}: cites adapter ${JSON.stringify(ref)}, which is not declared — a citation of an adapter that does not exist is a mapping to nothing`);
    } else if (state.status !== 'active') {
      findings.push(`AD-R10: ${c.control_id}: claims state ${JSON.stringify(c.state)} on the evidence of adapter ${JSON.stringify(ref)}, which is DECLARED, NOT ACTIVE — a wired seam awaiting its first observation cannot enforce anything`);
    }
  }
  return findings;
}

/**
 * Mandatory-when-compiled. A plan that does not compile `adapter_evidence` is unaffected — the states
 * are still reported, because visibility is a goal in its own right (G6), but nothing fails.
 *
 * Where a plan DOES compile it: every declared stream must be active, and every stream D5.3 names
 * must be declared. A requirement with nowhere to land reads as satisfied, which is the silent pass
 * this whole programme is written against.
 */
export function checkCompiledRequirement(states = [], required = []) {
  if (!required.length) return [];
  const findings = [];
  const have = new Set(states.map((s) => s.adapter_id));
  for (const change of required) {
    for (const stream of STREAMS) {
      if (!have.has(stream.adapter_id)) {
        findings.push(`AD-R09: ${change}: the plan requires the ${CAPABILITY} capability but stream ${JSON.stringify(stream.adapter_id)} (${stream.satisfies_control}) is not declared — ${stream.claim}, and no adapter carries that claim`);
      }
    }
    for (const s of states) {
      // Stream adapters, plus the four D5.3 streams BY ID whether or not they opted in — that is
      // where completeness for the named four is enforced (see `isStreamAdapter`). A pre-D5.3
      // adapter that is none of the four is exempt: a compiled seam requirement says nothing about
      // it, and demanding it be active would fail something this gate has no verifier for.
      const named = STREAMS.some((x) => x.adapter_id === s.adapter_id);
      if ((s.stream !== false || named) && s.status !== 'active') {
        findings.push(`AD-R09: ${change}: the plan requires the ${CAPABILITY} capability but stream ${JSON.stringify(s.adapter_id)} is DECLARED, NOT ACTIVE — a compiled requirement is not met by a wired seam`);
      }
    }
  }
  return findings;
}

/**
 * The one-line badge. `DECLARED, NOT ACTIVE` in capitals, `active` in lower case, on every run
 * including green ones — a reader must never be able to mistake one for the other, and the plan's G6
 * measure is that the scorecard shows declared vs active TRUTHFULLY. Matching `scripts/drift-check.mjs`'s
 * badge convention: the state that overstates is the one that shouts.
 */
export function badge(state) {
  if (state.status === 'active') {
    const when = state.observed_at ? ` as of ${state.observed_at}` : '';
    const who = state.observed_by ? ` by ${state.observed_by}` : '';
    return `  active${when}${who} — ${state.adapter_id} → ${state.control}`;
  }
  const why = state.stream === false
    ? ' (not an evidence stream — declares no mechanism; scripts/adapter-check.mjs owns it)'
    : state.offered ? ` (${state.offered} record(s) offered, none verified)` : ' (no observation)';
  return `  DECLARED, NOT ACTIVE — ${state.adapter_id} → ${state.control ?? '(no control)'}${why}`;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// CLI: print the canonical hash an observer must sign for a record, so an adopter can wire their
// signer without guessing — the same affordance `core/approval-attestations.mjs` offers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stdout.write(`The four evidence streams (D5.3) — one adapter, one control, each:\n\n`);
    for (const s of STREAMS) {
      process.stdout.write(`  ${s.adapter_id}\n    control    ${s.satisfies_control}\n    mechanism  ${s.mechanism} (verified by ${s.activation_source})\n    claim      ${s.claim}\n    negatives  ${s.required_negatives.join(' · ')}\n\n`);
    }
    process.stdout.write(`usage: node core/floor-adapters.mjs <evidence-record.json>   # print the hash to sign\n`);
    process.exit(0);
  }
  if (!existsSync(path)) { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const rec = readJson(path);
  if (!rec) { process.stderr.write(`${path} is not parseable JSON\n`); process.exit(2); }
  process.stdout.write(`${evidenceHash(rec)}\n`);
}
