// Drift, narrowed (Factory Floor WS4 · D4.2). A freeze is a photograph. The page it was taken
// from keeps moving, and this module is what the harness does about that.
//
// THE ASYMMETRY IS THE WHOLE DESIGN, and everything below exists to make it structural rather
// than promised:
//
//   BACKWARDS — never. A record already merged stays valid forever. A PA1 decided in March, made
//   against the March freeze, is still a decision in July, and no edit anyone makes to the floor
//   page afterwards unmakes it. Drift does not reach backwards. Ever.
//
//   FORWARDS — always. While a page is known to be out of sync with its freeze, no NEW claim may
//   be made against it: no freeze that re-stamps the stale bytes, and no approval citing the
//   frozen artifact. The route through is to re-freeze, which is a deliberate, reviewable act.
//
// THE TEMPTING-BUT-WRONG ALTERNATIVE is one line of code away and would be defended in a design
// review as the *stricter*, therefore safer, option: "the page has drifted, so the frozen artifact
// is stale, so every approval resting on it is stale — invalidate them." Do that and a typo fix in
// a heading retroactively unapproves a change that shipped four months ago. Worse, the verdict
// would depend on WHEN the gate ran: green this morning, red this afternoon, on an identical tree.
// Nobody could reproduce a build, an auditor could not re-derive a past verdict, and the first
// person to hit it would learn that the way to keep CI green is to stop touching the floor — which
// kills the collaboration surface the whole Factory Floor exists to provide. Governance whose
// verdicts change underneath it is not governance; it is weather.
//
// SO EVERY VERDICT COMPARES TWO FIXED INSTANTS. `driftState()` takes no clock, and `blocksClaimAt()`
// compares the claim's own signed `issued_at` against the instant drift was first OBSERVED. Both
// operands are written down and committed. Neither is `now`. The same record, evaluated on any
// machine on any future date, yields the same answer — that is what makes "never reaches backwards"
// a property of the code rather than a promise in a document. The one exception is `checkCurrency()`,
// which does read a clock, and it is deliberately a finding against the WATCHER — "nobody has looked
// recently" — never against a record.
//
// Backdating is not the escape hatch it looks like: `validity.issued_at` is inside the string a
// human's assertion signs (`canonicalDecisionPayload` in `core/approval-attestations.mjs`), so a
// carrier who moves a claim back before the drift observation breaks the signature and the approval
// gate rejects it before this module is ever consulted.
//
// NO NETWORK, and this one is not negotiable. Drift is the difference between a recorded digest and
// another recorded digest. The live read arrives as a committed OBSERVATION — `{ source, digest,
// observed_at, observed_by }` — produced by the adopter's watcher, exactly as the identity map's
// currency arrives as a signed reconciliation observation rather than a live directory call. A gate
// that phoned a SaaS vendor would make every build depend on that vendor's availability, would put
// an integration token into CI, and would make the verdict unreproducible offline, which is the one
// thing an evidence trail may never be.
//
// THE OBSERVATION'S DIGEST MUST COME FROM THE SAME EXPORTER. It is a digest over the exported
// markdown, not over the page JSON: block ids, key order and vendor metadata churn constantly and a
// digest over them would report drift every time anyone opened the page. `core/floor-export.mjs` is
// deterministic precisely so that "the bytes changed" means "someone changed the content".
//
// RE-STAMPING IS NOT RE-FREEZING (DR-F01). The obvious way past a drift block is to write a fresh
// stamp with a fresh `exported_at` over the SAME stale bytes: the D4.1 gate still passes, because
// the file still matches its stamp, and the drift comparison now has a freeze newer than the
// observation that contradicted it. That is the bypass this module is built to name. A freeze that
// post-dates an observation and repeats an earlier freeze's digest is refused — unless a later
// INDEPENDENT observation corroborates it, which is the honest route for the rare case where the
// page genuinely was reverted.
//
// A FREEZER MAY NOT CORROBORATE ITS OWN FREEZE (DR-F06). An observation whose `observed_by` is the
// identity that wrote the stamp proves nothing: it is the same party asserting twice. The watcher is
// a separate identity (P4's independent observer), for the same reason the transcribing bridge may
// never sign an approval.
//
// SILENT WHERE UNADOPTED. A repository that has frozen nothing has no drift. A repository that has
// frozen something but wired no watcher has no OBSERVATIONS, and this module says nothing about it
// rather than inventing a verdict — until a compiled plan requires the `freeze_drift` capability,
// at which point an unwatched page is unproven currency and reported as such (DR-F04). That is the
// same mandatory-when-compiled shape every other capability here uses.
//
// TWO RESIDUALS, NAMED SO SILENCE IS NOT MISTAKEN FOR COVERAGE:
//
//   1. A claim made in the window between an edit and its detection is NOT blocked, because at the
//      moment it was made nobody had observed the page to be out of sync. This is the fail-OPEN
//      direction and it is chosen, not overlooked: the only way to close it is to judge old claims
//      against new observations, which is precisely the retroactive invalidation D4.2 forbids. The
//      window is narrowed by watching often (D4.3's webhooks), never by this module.
//   2. Citation by `origin.page_id` is CONVENIENCE, not proof. That field is not inside the string
//      the human signs, so a carrier can edit it — which can only make a claim escape a block, never
//      acquire one. Citation by digest is inside the signed payload and is the matcher that carries
//      weight. A claim that binds nothing about the frozen artifact cites nothing, and is not this
//      module's business.
//
// The observation record must ACCUMULATE. A watcher that overwrites one file each run destroys the
// instant drift became known, and `drifted_since` would creep forward — which relaxes the block over
// time, in the one direction that must never relax. Each observation is its own committed file.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SCHEMA_ID as FREEZE_SCHEMA_ID, sha256 } from './floor-export.mjs';
import { sameIdentity } from './separation.mjs'; // 2.1.0 — the one separation rule, shared

export const SCHEMA_ID = 'loom.drift-observation/v1';
/** The capability a compiled plan sets to make drift currency mandatory. */
export const CAPABILITY = 'freeze_drift';
/** How old the newest observation of a page may be before currency is unproven (adopters tighten). */
export const OBSERVATION_MAX_AGE_DAYS = 7;

const DAY = 86400000;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isDigest = (v) => typeof v === 'string' && v.startsWith('sha256:') && v.length > 'sha256:'.length;
/** ISO-8601 only — the type is part of the check, as in the attestation and mapping contracts. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const short = (d) => (typeof d === 'string' ? `${d.slice(0, 23)}…` : String(d));
const byObserved = (a, b) => parseTime(a.observed_at) - parseTime(b.observed_at);

/**
 * Rejection codes. Named and documented in the style of `core/identity-map.mjs`'s `IM-Rnn`, so an
 * operator reading a red build can look up exactly what was refused and why.
 *
 *   DR-F01  A freeze claim that RE-STAMPS rather than re-freezes: it post-dates an observation
 *           which showed the page holding different bytes, and repeats an earlier freeze's digest.
 *           Catches the one-line bypass of a drift block. Blocks the new freeze, not the old one.
 *   DR-F02  A NEW approval claim resting on an artifact whose page has drifted, dated at or after
 *           the instant drift was observed. This is the forwards half of the asymmetry. A claim
 *           dated before that instant is untouched — that is the backwards half, and it is why
 *           this code can only ever fire on something being introduced now.
 *   DR-F03  Unknown is not in-sync. A cited source with no readable freeze stamp — absent,
 *           wrong-schema, digestless, or with no `exported_at` to order it by — yields a state of
 *           `unknown` and a finding. An absent freeze must never read as a clean one.
 *   DR-F04  Currency unproven: no observation of a frozen page, or the newest one is older than the
 *           freshness bound. Mandatory-when-compiled — reported only where a plan requires the
 *           `freeze_drift` capability. It is a finding against the WATCHER, never against a record,
 *           which is why it may safely read a clock when nothing else here does.
 *   DR-F05  An observation that is not an observation: no schema, no source, no digest, no
 *           observer, or no parseable instant. Refused rather than ignored — an unreadable
 *           observation must never be mistaken for a clean bill of health.
 *   DR-F06  Self-corroboration: an observation produced by the identity that wrote the freeze. The
 *           observation is reported and NOT counted; a freezer vouching for its own freeze is one
 *           party asserting twice.
 */
export const REJECTIONS = new Map([
  ['DR-F01', 'a freeze claim that re-stamps stale bytes instead of re-exporting the page'],
  ['DR-F02', 'a new approval claim resting on a drifted artifact, dated at or after the drift was observed'],
  ['DR-F03', 'a cited source whose freeze stamp is absent or unreadable — unknown is not in-sync'],
  ['DR-F04', 'currency unproven: the live page has not been observed, or not recently enough'],
  ['DR-F05', 'an observation that cannot be read as an observation'],
  ['DR-F06', 'an observation produced by the identity that wrote the freeze it would corroborate'],
]);

/**
 * The drift observation: what a watcher records when it reads the live page. The mirror of
 * `freezeStamp()` — same shape of evidence, opposite side of the comparison.
 *
 * `digest` is over the EXPORTED markdown, produced by `core/floor-export.mjs`, or the comparison is
 * against a moving target. `observed_by` is required by `checkObservation()`: an unattributed
 * observation is a claim, and this one decides whether other people's claims are blocked.
 */
export function driftObservation({ source, digest, observedAt, observedBy }) {
  return {
    _comment: 'Written by the drift watcher. `digest` is the export digest of the LIVE page at `observed_at`, produced by core/floor-export.mjs so it is comparable with a freeze stamp. Each observation is its own file and is never overwritten: the instant drift became known is what decides which claims are blocked, and rewriting it would relax the block.',
    schema: SCHEMA_ID,
    source,
    digest,
    observed_at: observedAt || null, // supplied by the caller — this module has no clock
    observed_by: observedBy || null, // the watcher's registry identity, never the freezer's
  };
}

/**
 * Build an observation from an INJECTED reader. This is the whole of the "fetch" story: the caller
 * hands over a function, the token lives in the caller's closure, and nothing in this module can
 * reach the network. `read()` may return `{ markdown }` — the export of the live page, which is
 * hashed here — or `{ digest }` if the caller already hashed it.
 *
 * It throws rather than returning findings: a watcher that could not read the page must not write a
 * file at all. An observation is evidence someone looked; a placeholder saying nobody could would be
 * indistinguishable, later, from a page that had not changed.
 */
export async function observe({ source, observedAt, observedBy }, read) {
  if (!isStr(source)) throw new Error('observe() needs the source the freeze stamp names, or the observation cannot be matched to a freeze');
  if (typeof read !== 'function') throw new Error('observe() needs an injected reader — this module makes no network call of its own, by design');
  const got = await read({ source });
  const digest = isDigest(got?.digest) ? got.digest
    : typeof got?.markdown === 'string' ? sha256(got.markdown)
      : null;
  if (!digest) {
    throw new Error(`the reader for ${source} returned neither \`markdown\` nor a sha256 \`digest\` — an observation that cannot say what it saw is not an observation, and writing one would report a page as unchanged when nobody managed to read it`);
  }
  return driftObservation({ source, digest, observedAt, observedBy });
}

/** Is this change's plan requiring proven freeze currency? (mandatory-when-compiled) */
export function driftRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

/** DR-F05 — is this readable as an observation at all? `[]` ⇒ it can be used. */
export function checkObservation(obs, label = 'observation') {
  if (!obs || typeof obs !== 'object') {
    return [`DR-F05: ${label}: not an object — an unreadable observation must never be mistaken for a clean bill of health`];
  }
  const findings = [];
  if (obs.schema !== SCHEMA_ID) findings.push(`DR-F05: ${label}: schema ${JSON.stringify(obs.schema)} is not ${SCHEMA_ID}`);
  if (!isStr(obs.source)) findings.push(`DR-F05: ${label}: names no source — an observation of nothing in particular cannot be matched to a freeze`);
  if (!isDigest(obs.digest)) findings.push(`DR-F05: ${label}: carries no sha256 digest of the live page — there is nothing to compare`);
  if (parseTime(obs.observed_at) === null) {
    findings.push(`DR-F05: ${label}: observed_at is missing or not a parseable ISO-8601 timestamp — an observation with no instant cannot be ordered against a freeze or a decision, and ordering is the entire control`);
  }
  if (!isStr(obs.observed_by)) findings.push(`DR-F05: ${label}: names no observer — an unattributed observation is a claim`);
  return findings;
}

/** The page id inside a freeze stamp's `source` (`notion:page/<id>` → `<id>`), or null. */
export const pageIdOf = (source) => {
  if (!isStr(source)) return null;
  const i = source.indexOf(':page/');
  return i === -1 ? null : source.slice(i + ':page/'.length) || null;
};

/**
 * DR-F01 — is this freeze claim a re-stamp rather than a re-freeze?
 *
 * `stamps` is every stamp for the same source (including this one); `observations` every well-formed
 * observation of it. A FIRST freeze can never be a re-stamp, and a freeze that changed the bytes is a
 * real re-export, so both return clean — the code fires only on the specific shape that repeats an
 * earlier freeze's digest after the page was seen holding something else.
 */
export function checkFreezeClaim(stamp, { stamps = [], observations = [] } = {}, label = 'freeze') {
  const t = parseTime(stamp?.exported_at);
  if (t === null || !isDigest(stamp?.digest)) return []; // DR-F03 already said so
  const prior = stamps.filter((s) => s !== stamp && isDigest(s?.digest) && parseTime(s?.exported_at) !== null && parseTime(s.exported_at) < t);
  if (!prior.length) return [];

  const dated = observations.filter((o) => parseTime(o?.observed_at) !== null && isDigest(o?.digest));
  const before = dated.filter((o) => parseTime(o.observed_at) < t).sort(byObserved);
  const last = before[before.length - 1];
  if (!last || last.digest === stamp.digest) return []; // nothing contradicted this freeze

  // The freeze post-dates a read of the page that showed different bytes. If it carries NEW bytes it
  // is an honest re-export; only a repeat of an earlier freeze's digest is the bypass.
  if (!prior.some((s) => s.digest === stamp.digest)) return [];

  // …unless somebody INDEPENDENT looked afterwards and saw those bytes live. That is the rare, real
  // case of a page reverted to what was frozen, and it deserves a route through that is not a bypass.
  // The freezer's own later observation does not count, for the DR-F06 reason.
  const corroborated = dated.some((o) => parseTime(o.observed_at) >= t
    && o.digest === stamp.digest
    && !(isStr(stamp.exported_by) && o.observed_by === stamp.exported_by));
  if (corroborated) return [];

  return [`DR-F01: ${label}: the freeze at ${stamp.exported_at} repeats the digest of an earlier freeze (${short(stamp.digest)}), although the page was observed at ${last.observed_at} holding ${short(last.digest)} — re-stamping is not re-freezing. Export the page again through the freezer, or, if it has genuinely been reverted, let the watcher observe it once more`];
}

/**
 * The drift state of one source: the badge. Deliberately CLOCK-FREE — every field is derived from
 * committed instants, so the same inputs yield the same badge forever.
 *
 * `{ source, stamps, observations }` — `stamps` are every freeze stamp taken from that page,
 * `observations` every observation of it. Returns the state plus its findings; `status` is one of:
 *
 *   in-sync     the newest observation that can judge the current freeze agrees with it
 *   drifted     it disagrees — `drifted_since` is when that first became known
 *   unobserved  nothing has looked at the page since the current freeze. NOT drifted, and not
 *               in-sync either: a re-freeze lands here until the watcher next runs
 *   unknown     there is no readable freeze to compare against (DR-F03)
 */
export function driftState({ source, stamps = [], observations = [] } = {}) {
  const findings = [];
  const state = {
    source,
    status: 'unknown',
    file: null,
    stamped_digest: null,
    live_digest: null,
    stamp_exported_at: null,
    observed_at: null,
    observed_by: null,
    drifted_since: null,
    findings,
  };

  const dated = [];
  for (const [i, s] of stamps.entries()) {
    const at = `${source} · ${s?.file || `stamp ${i}`}`;
    if (!s || typeof s !== 'object' || s.schema !== FREEZE_SCHEMA_ID || !isDigest(s.digest)) {
      findings.push(`DR-F03: ${at}: not a readable ${FREEZE_SCHEMA_ID} stamp carrying a sha256 digest — there is no digest to compare, and an unreadable freeze must not read as an in-sync one`);
      continue;
    }
    if (parseTime(s.exported_at) === null) {
      findings.push(`DR-F03: ${at}: no parseable exported_at — a freeze that cannot be placed in time cannot be ordered against a read of the page, so drift cannot be judged in either direction`);
      continue;
    }
    dated.push(s);
  }
  if (!dated.length) {
    if (!findings.length) {
      findings.push(`DR-F03: ${source}: nothing was frozen from this page, so there is no digest to compare — an unfrozen page cannot be shown to be in sync, and absence must not read as agreement`);
    }
    return state;
  }

  dated.sort((a, b) => parseTime(a.exported_at) - parseTime(b.exported_at));
  const current = dated[dated.length - 1];
  const tFreeze = parseTime(current.exported_at);
  state.file = current.file || null;
  state.stamped_digest = current.digest;
  state.stamp_exported_at = current.exported_at;

  const mine = observations.filter((o) => o?.source === source && checkObservation(o).length === 0).sort(byObserved);
  const judging = [];
  for (const o of mine) {
    if (parseTime(o.observed_at) < tFreeze) continue; // predates the freeze — it read a different document
    if (isStr(current.exported_by) && sameIdentity(o.observed_by, current.exported_by)) {
      findings.push(`DR-F06: ${source}: the observation at ${o.observed_at} was produced by ${o.observed_by}, the same identity that wrote the freeze — a freezer corroborating its own freeze is one party asserting twice, so it is not counted. The watcher is a separate identity`);
      continue;
    }
    judging.push(o);
  }

  findings.push(...checkFreezeClaim(current, { stamps: dated, observations: mine }, `${source} · ${current.file || 'freeze'}`));

  if (!judging.length) {
    state.status = 'unobserved';
    return state;
  }
  const last = judging[judging.length - 1];
  state.observed_at = last.observed_at;
  state.observed_by = last.observed_by;
  state.live_digest = last.digest;
  if (last.digest === current.digest) {
    state.status = 'in-sync';
    return state;
  }
  state.status = 'drifted';
  // When drift became KNOWN — the oldest observation in the unbroken run of disagreement ending at
  // the newest. If a later observation agreed, the clock restarts from the next disagreement: an
  // earlier, since-resolved divergence must not block claims made after it was resolved.
  let since = last;
  for (let i = judging.length - 1; i >= 0; i--) {
    if (judging[i].digest === current.digest) break;
    since = judging[i];
  }
  state.drifted_since = since.observed_at;
  return state;
}

/** Every source's state, keyed by source. `stamps`/`observations` are the whole repository's. */
export function driftStates({ stamps = [], observations = [] } = {}) {
  const sources = [...new Set(stamps.map((s) => s?.source).filter(isStr))].sort();
  return new Map(sources.map((source) => [source, driftState({
    source,
    stamps: stamps.filter((s) => s?.source === source),
    observations: observations.filter((o) => o?.source === source),
  })]));
}

/**
 * THE ASYMMETRY, in one function. Does this page's drift block a claim dated `issuedAt`?
 *
 * Both operands are fixed: the claim's own signed instant, and the instant drift was first observed.
 * `now` appears nowhere. A claim dated before the drift was seen was made against a page nobody had
 * yet found out of sync, and it is already in the record — blocking it would be the retroactive
 * invalidation this whole delivery exists to refuse.
 *
 * A claim with no parseable instant IS blocked. It cannot be shown to predate anything, and "cannot
 * be shown" resolves to refusal here as it does everywhere else in the harness.
 */
export function blocksClaimAt(state, issuedAt) {
  if (!state || state.status !== 'drifted') return { blocked: false, reason: null };
  const since = parseTime(state.drifted_since);
  if (since === null) return { blocked: false, reason: null };
  const t = parseTime(issuedAt);
  if (t === null) {
    return { blocked: true, reason: 'the claim carries no parseable instant, so it cannot be shown to have been made before the page was found out of sync' };
  }
  if (t < since) return { blocked: false, reason: null };
  return { blocked: true, reason: `the claim is dated ${issuedAt}, at or after ${state.drifted_since} — the instant the page was first observed out of sync with its freeze` };
}

/**
 * Which frozen artifacts does an approval record cite? Two matchers, and the difference matters:
 *
 *   `digest`   — a digest under `bound_to` equals a freeze stamp's digest. This is INSIDE the string
 *                the human's assertion signs, so it cannot be edited after the fact. It is the
 *                matcher that carries weight.
 *   `page-id`  — `origin.page_id` names the page a stamp was frozen from. This is NOT in the signed
 *                payload, so a carrier can edit it — which can only let a claim escape a block, never
 *                acquire one. Convenience, reported as such.
 *
 * A record binding nothing about the artifact cites nothing and is not this module's business.
 */
export function citedStamps(rec, stamps = []) {
  const bound = rec?.bound_to && typeof rec.bound_to === 'object' ? rec.bound_to : {};
  const digests = new Set(Object.values(bound).filter(isDigest));
  const pageId = rec?.origin?.page_id;
  const out = [];
  for (const s of stamps) {
    if (!s || typeof s !== 'object' || !isStr(s.source)) continue;
    if (isDigest(s.digest) && digests.has(s.digest)) { out.push({ stamp: s, via: 'digest' }); continue; }
    if (isStr(pageId) && pageIdOf(s.source) === pageId) out.push({ stamp: s, via: 'page-id' });
  }
  return out;
}

const stateFor = (states, source) => (states instanceof Map ? states.get(source) : states?.[source]);

/**
 * DR-F02 / DR-F03 — may this approval claim be made?
 *
 * `cites` lets a caller name sources explicitly, for records that depend on a frozen artifact
 * without binding its digest. A cited source with no state is DR-F03: a claim that says it rests on
 * a frozen artifact and names one nothing was frozen from is refused, because unknown is not in-sync.
 */
export function checkApprovalClaim(rec, { states, stamps = [], cites = [] } = {}, label = 'approval') {
  const findings = [];
  const issuedAt = rec?.validity?.issued_at;
  const seen = new Set();

  const judge = (state, source, via) => {
    if (state.status === 'unknown') {
      findings.push(`DR-F03: ${label}: rests on ${source} (matched by ${via}), whose freeze cannot be read — unknown is not in-sync, so the claim is refused rather than passed on an absent comparison`);
      return;
    }
    const { blocked, reason } = blocksClaimAt(state, issuedAt);
    if (!blocked) return;
    findings.push(`DR-F02: ${label}: rests on ${source} (matched by ${via}), which has drifted from its freeze (frozen ${short(state.stamped_digest)}, observed ${short(state.live_digest)}) — ${reason}. Records already merged against this artifact stand and are not touched; this is a NEW claim, and a new claim needs a page in sync. Re-freeze the artifact and re-issue against the new freeze`);
  };

  for (const { stamp, via } of citedStamps(rec, stamps)) {
    if (seen.has(stamp.source)) continue;
    seen.add(stamp.source);
    const state = stateFor(states, stamp.source);
    if (state) judge(state, stamp.source, via);
  }
  for (const source of cites) {
    if (!isStr(source) || seen.has(source)) continue;
    seen.add(source);
    const state = stateFor(states, source);
    if (!state) {
      findings.push(`DR-F03: ${label}: cites ${source}, from which nothing has been frozen — a claim that names a frozen artifact that does not exist cannot be judged against one, and an absent freeze must not read as an in-sync freeze`);
      continue;
    }
    judge(state, source, 'declaration');
  }
  return findings;
}

/**
 * DR-F04 — the only clock in this module, and it judges the WATCHER, not a record. Mandatory-when-
 * compiled: callers apply it where a plan requires the `freeze_drift` capability, and nowhere else.
 * Applying it per-claim would be the retroactive-invalidation bug in slow motion — a merged approval
 * would go red simply because time passed.
 */
export function checkCurrency(source, observations = [], { now = Date.now(), maxAgeDays = OBSERVATION_MAX_AGE_DAYS } = {}) {
  const times = observations
    .filter((o) => o?.source === source && checkObservation(o).length === 0)
    .map((o) => parseTime(o.observed_at));
  if (!times.length) {
    return [`DR-F04: ${source}: the live page has never been observed, and the plan requires the ${CAPABILITY} capability — an unwatched page's currency is unproven. Observed, not declared`];
  }
  const age = Math.floor((now - Math.max(...times)) / DAY);
  if (age > maxAgeDays) {
    return [`DR-F04: ${source}: the newest observation is ${age} days old (limit ${maxAgeDays}) — nobody has looked recently enough for this freeze to be trusted as current`];
  }
  return [];
}

// CLI: report the drift state of one source from committed files, so an adopter can see the badge
// and the comparison behind it without running the gate over a whole repository.
//   node core/floor-drift.mjs <freeze-stamp.json> <observation.json> [<observation.json> …]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stampPath, ...obsPaths] = process.argv.slice(2);
  if (!stampPath) {
    process.stderr.write('usage: node core/floor-drift.mjs <freeze-stamp.json> [<observation.json> …]\n');
    process.exit(2);
  }
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { process.stderr.write(`cannot read ${p}\n`); process.exit(2); return null; } };
  const stamp = read(stampPath);
  const state = driftState({ source: stamp?.source, stamps: [stamp], observations: obsPaths.map(read) });
  process.stdout.write(`${state.source} — ${state.status.toUpperCase()}\n  frozen   ${state.stamped_digest || '(none)'} at ${state.stamp_exported_at || '(undated)'}\n  observed ${state.live_digest || '(never)'} at ${state.observed_at || '—'}\n`);
  if (state.drifted_since) process.stdout.write(`  drifted since ${state.drifted_since} — claims dated at or after this instant are blocked; earlier records stand\n`);
  if (state.findings.length) {
    for (const f of state.findings) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
}
