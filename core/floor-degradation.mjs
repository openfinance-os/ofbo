// Graceful degradation (Factory Floor WS6 · D6.4). The floor runs on a metered platform. When the
// credits run out, the Custom Agents stop and the Workers stop: no prefill, no routing, no
// conversation, no triage. Nothing errors. Nothing goes red. The board keeps rendering.
//
// THE DANGEROUS FAILURE IS SILENCE, and it is the only thing this module is about. A floor whose
// automation has stopped looks exactly like a floor with nothing to do — in fact it looks BETTER,
// because the queues stop growing. Every reader is misled, and some of them make decisions on it.
// T-13 in the threat model rates the confusion impact Medium and says the operative line: the
// failure mode is silence, and silence must never be mistaken for coverage.
//
// So the requirement is not "handle exhaustion". It is DEGRADE LOUDLY:
//
//   · `deriveState()` computes the status from the observations. It never reads a declared status,
//     so there is no field an operator, a script or an optimistic default can set to make a paused
//     floor report as a live one. A record whose own `status` disagrees with the derivation is a
//     finding (DG-R02) — the derivation wins, and the disagreement is reported rather than resolved.
//   · Any status other than `live` MUST carry a visible surface notice, on every view, not
//     dismissible, with the banner verbatim (DG-R03, DG-R04). A banner on one page is not a banner:
//     people arrive on a database view from a link and never see the home page.
//   · A paused floor MUST name a manual fallback (DG-R07) and a reconciliation that has actually run
//     (DG-R06). "There is a runbook" is the whole of the degradation plan, and an `ADOPT:`
//     placeholder is not a runbook — it is text nobody replaced.
//
// THE ASYMMETRY D6.4 REQUIRES, and it is the part that is easy to lose: PROJECTION DOES NOT DEPEND
// ON CREDITS. The projector is a bank-hosted service, not a Worker (ADR 0002), so a credit-exhausted
// floor STILL MIRRORS GIT. What stops is the labour, not the mirror — and the difference has to be
// legible on the screen, because the two failures call for opposite behaviour from a reader:
//
//     degraded  the mirror is current, so what you see of the record is TRUE. Nothing is being
//               added, prefilled or routed. Read freely; route work by hand.
//     dark      the mirror is not current, so what you see may be days behind git. Do not decide
//               from this screen at all.
//
// Conflating those two is how a "degraded" banner teaches people to ignore banners. A record that
// declares its projection dependent on credits, or paused BY credits, is a finding (DG-R05): either
// the projector was deployed as a Worker — in which case the architecture, not the banner, is wrong
// — or somebody described it carelessly, and this is where that gets caught.
//
// NO CLOCK IN THE VERDICTS. `deriveState()` and `checkDegradation()` compare committed instants
// only, so the same record yields the same status and the same findings on any machine on any future
// date — the `core/floor-drift.mjs` discipline, for the same reason: a degradation record is
// evidence, and evidence whose verdict changes as time passes cannot be re-derived by an auditor.
// The one clock is `checkCurrency()`, which reads `now` and is deliberately a finding against the
// WATCHER — "nobody has looked recently" — never against a record. Observations ACCUMULATE, each in
// its own file: an old observation of a past outage is correct history and must not go red.
//
// NO NETWORK, and nothing here queries a credit balance. The live read arrives as a committed,
// attributed observation, exactly as drift and identity-map currency do. A gate that phoned the
// vendor would make every build depend on that vendor's availability and put an integration token
// into CI — and would fail, unhelpfully, in precisely the outage it exists to describe.
//
// WHAT THIS DOES NOT DO:
//   - It cannot detect exhaustion. It verifies that an observation of exhaustion, once made, is
//     represented honestly. The detection is the adopter's alert at a credit threshold, and the
//     threshold, the alert route and the named owner are all AWAITING in the threat model (T-13).
//     `alert` below reports what the observation says; it does not know what "low" should mean.
//   - It cannot make anybody read the banner. Loudness is necessary and not sufficient, and the
//     manual fallback is what actually keeps the floor truthful.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sameIdentity } from './separation.mjs'; // 2.1.0 — the one separation rule, shared

export const SCHEMA_ID = 'loom.floor-degradation/v1';

/** The capability a compiled plan sets to make degradation observation mandatory. */
export const CAPABILITY = 'floor_degradation';

/**
 * Credit states an observation may report. `low` is a warning; `exhausted` pauses the automation;
 * `unknown` is what an honest watcher writes when it could not read the meter, and it is never read
 * as `available`.
 */
export const CREDIT_STATES = new Set(['available', 'low', 'exhausted', 'unknown']);
/** What the metered automation is doing. `unknown` is honest and is never read as `running`. */
export const RUN_STATES = new Set(['running', 'paused', 'unknown']);
/** Whether the mirror is still a mirror. Independent of credits, by architecture (ADR 0002). */
export const PROJECTION_STATES = new Set(['current', 'stale', 'unknown']);

/**
 * The four statuses, worst last. `deriveState()` returns one of these and nothing else; the ordering
 * is used so an aggregate over several observations can take the worst rather than the newest.
 */
export const STATUSES = ['live', 'unknown', 'degraded', 'dark'];
const severity = (s) => STATUSES.indexOf(s);

/**
 * The banners, verbatim. Constants rather than parameters for the same reason
 * `NON_AUTHORITATIVE` is one in `core/floor-project.mjs`: a configurable banner is a banner
 * somebody eventually configures away, and the sentence that has to survive contact with a
 * screenshot is the last one anybody edits.
 */
export const DEGRADED_BANNER = 'DEGRADED — the automation on this floor is PAUSED. Nothing is being prefilled, rated, triaged or routed, and no agent will pick anything up. The mirror of git is still current, so what you can see of the record is true — but anything an agent would have ADDED here is not here and is not queued behind this notice. Route work by the manual fallback until this banner clears.';
export const DARK_BANNER = 'DARK — this floor has stopped mirroring the record. The projection is not current, so what you are reading may be hours or days behind git. Do not take a decision from this screen. Git is the record: go there, and use the manual fallback until this banner clears.';
export const UNKNOWN_BANNER = 'UNKNOWN — nobody can currently say whether this floor is live. The automation and the mirror have not been observed, so neither a calm board nor an empty queue means anything right now. Treat this floor as not current until somebody has looked.';

/** Which banner a status must carry. `live` carries none — a green banner teaches people to ignore banners. */
export const BANNERS = new Map([
  ['degraded', DEGRADED_BANNER],
  ['dark', DARK_BANNER],
  ['unknown', UNKNOWN_BANNER],
]);

/**
 * A notice must be on EVERY view. Not the home page, not the "status" page: people arrive on a
 * database view from a link in a message and never see either.
 */
export const NOTICE_PLACEMENT = 'every-view';

/** How far a reconciliation may lag the observation it accompanies. The plan calls it a daily job. */
export const RECONCILIATION_MAX_AGE_DAYS = 1;
/** How old the newest observation may be before the WATCHER is the finding (adopters tighten). */
export const OBSERVATION_MAX_AGE_DAYS = 1;

/**
 * Rejection codes, in the `IM-Rnn` style of `core/identity-map.mjs`.
 *
 *   DG-R01  not readable as an observation — no schema, no instant, no observer, no automation
 *           block. Refused rather than ignored: an unreadable observation must never be mistaken
 *           for a clean bill of health.
 *   DG-R02  the record's own `status` disagrees with what its observations derive, or the
 *           observations contradict each other in the optimistic direction — credits exhausted
 *           while the agents are reported running. THE code of D6.4: a paused floor reported live.
 *   DG-R03  a degraded, dark or unknown floor with no visible surface notice, or a notice that is
 *           dismissible, or scoped to less than every view.
 *   DG-R04  a notice whose banner is not the verbatim text for its status — including a `live`
 *           record carrying a banner, which trains readers to dismiss them.
 *   DG-R05  projection declared dependent on credits, or paused by them. The projector is a
 *           bank-hosted service; if this is true, the architecture is wrong, not the wording.
 *   DG-R06  the reconciliation is absent, predates the degradation, lags the observation, or is
 *           self-signed by the observer or by the paused automation itself.
 *   DG-R07  a paused floor with no documented manual fallback, or one that is still an `ADOPT:`
 *           placeholder — text nobody replaced.
 *   DG-R08  the newest observation is stale, or dated in the future. A finding against the watcher,
 *           never against a record; the only code here that reads a clock.
 *   DG-R09  a vocabulary value outside the declared sets — an unknown state is refused rather than
 *           coerced to the nearest reassuring one.
 */
export const REJECTIONS = new Map([
  ['DG-R01', 'not readable as a degradation observation — unreadable is refused, never read as healthy'],
  ['DG-R02', 'a paused floor represented as a live one, or observations that contradict optimistically'],
  ['DG-R03', 'a degraded floor with no visible, undismissable, every-view surface notice'],
  ['DG-R04', 'a notice whose banner is not the verbatim text for its status'],
  ['DG-R05', 'projection declared dependent on credits — it is a bank-hosted service, not a Worker'],
  ['DG-R06', 'the reconciliation is absent, stale, or self-signed'],
  ['DG-R07', 'no documented manual fallback for a paused floor'],
  ['DG-R08', 'the newest observation is stale or dated in the future — a finding against the watcher'],
  ['DG-R09', 'a state value outside the declared vocabulary'],
]);

const DAY = 86400000;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isReal = (v) => isStr(v) && !/^ADOPT:/.test(v.trim());
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);
const days = (ms) => Math.floor(ms / DAY);

// --- the observation ------------------------------------------------------------------------------

/**
 * What a watcher records when it reads the platform's meter and its own automation. `observedAt` is
 * supplied by the caller — this module has no clock — and `observedBy` is required: an unattributed
 * observation is a claim, and this one decides whether a banner appears in front of every reader.
 *
 * `projection` is a separate limb from `automation` on purpose. They fail independently, they are
 * hosted differently, and collapsing them into one "floor health" field is how the asymmetry D6.4
 * requires gets lost.
 */
export function degradationObservation({
  credits = 'unknown',
  agents = 'unknown',
  workers = 'unknown',
  projection = 'unknown',
  observedAt = null,
  observedBy = null,
  since = null,
} = {}) {
  return {
    _comment: 'Written by the floor watcher. Each observation is its own file and is never overwritten: an old observation of a past outage is correct history, and rewriting it would erase the moment the floor stopped being current. `projection` is observed separately from `automation` because the projector does not spend surface credits (ADR 0002) — a credit-exhausted floor still mirrors git, and that difference is what a reader needs.',
    schema: SCHEMA_ID,
    observed_at: observedAt,
    observed_by: observedBy,
    since: since || observedAt,
    credits: { state: credits },
    automation: { agents, workers },
    projection: { state: projection, depends_on_credits: false },
  };
}

/**
 * Build an observation from an INJECTED reader — the whole of the "fetch" story, as in
 * `core/floor-drift.mjs`. The token lives in the caller's closure and nothing in this module can
 * reach the network.
 *
 * It THROWS rather than returning findings. A watcher that could not read the meter must not write a
 * file: a placeholder observation would be indistinguishable, later, from a floor that was fine —
 * which is the exact silence this delivery exists to break.
 */
export async function observe({ observedAt, observedBy, since = null }, read) {
  if (typeof read !== 'function') throw new Error('observe() needs an injected reader — this module makes no network call of its own, by design');
  const got = await read();
  const credits = got?.credits;
  const agents = got?.agents;
  const workers = got?.workers;
  const projection = got?.projection;
  if (!CREDIT_STATES.has(credits) || !RUN_STATES.has(agents) || !RUN_STATES.has(workers) || !PROJECTION_STATES.has(projection)) {
    throw new Error(`the reader returned ${JSON.stringify({ credits, agents, workers, projection })}, which is not a complete reading (credits ${[...CREDIT_STATES].join('|')}; agents/workers ${[...RUN_STATES].join('|')}; projection ${[...PROJECTION_STATES].join('|')}) — writing a partial observation would let an unread limb read as a working one`);
  }
  return degradationObservation({ credits, agents, workers, projection, observedAt, observedBy, since });
}

/** Is this change's plan requiring proven floor liveness? (mandatory-when-compiled) */
export function degradationRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

// --- the derivation -------------------------------------------------------------------------------

const readingOf = (record) => ({
  credits: record?.credits?.state,
  agents: record?.automation?.agents,
  workers: record?.automation?.workers,
  projection: record?.projection?.state,
});

/**
 * The status, derived. THE function of this module, and the reason it takes a reading rather than a
 * record: there is no `status` field in scope here, so there is nothing to prefer over the
 * observations. A paused floor cannot be reported as live, because "live" is not a value anybody
 * sets — it is what falls out when everything was observed running.
 *
 * Precedence, worst first:
 *
 *   dark      the projection is not current. This outranks everything: a floor that has stopped
 *             mirroring git is misrepresenting the RECORD, not merely the labour, and a reader must
 *             not decide from it at all.
 *   degraded  the automation is paused — or the credits are exhausted, whatever the automation
 *             claims. The optimistic reading never wins a contradiction.
 *   unknown   a limb was not observed. NOT live: an unobserved floor is one nobody has looked at,
 *             and the whole failure mode of D6.4 is that nobody looked.
 *   live      everything was observed running and the mirror is current.
 */
export function deriveStatus(reading = {}) {
  const { credits, agents, workers, projection } = reading;
  const inVocab = CREDIT_STATES.has(credits) && RUN_STATES.has(agents) && RUN_STATES.has(workers) && PROJECTION_STATES.has(projection);
  if (!inVocab) return 'unknown';
  if (projection === 'stale') return 'dark';
  if (agents === 'paused' || workers === 'paused' || credits === 'exhausted') return 'degraded';
  if (credits === 'unknown' || agents === 'unknown' || workers === 'unknown' || projection === 'unknown') return 'unknown';
  return 'live';
}

/**
 * The state a surface renders: the status, the banner it must carry verbatim, and — the part that
 * makes degradation legible rather than merely loud — what still works and what has stopped, in the
 * words a non-technical reader needs. Clock-free.
 *
 * `alert` reports that the observation crossed into `low` or `exhausted`. What "low" means is the
 * adopter's threshold and is AWAITING in the threat model; this module reports the observation, it
 * does not set the policy.
 */
export function deriveState(record) {
  const reading = readingOf(record);
  const status = deriveStatus(reading);
  const paused = reading.agents === 'paused' || reading.workers === 'paused' || reading.credits === 'exhausted';

  const stillWorks = [];
  const hasStopped = [];
  if (status === 'live') {
    stillWorks.push('everything that was observed: the mirror is current and the automation is running');
  } else {
    if (reading.projection === 'current') {
      stillWorks.push('the projection: this floor still mirrors git, because the projector is a bank-hosted service and does not spend surface credits (ADR 0002). What you can see of the record is true');
    } else if (reading.projection === 'stale') {
      hasStopped.push('the projection: this floor is no longer a current mirror of git, so what you are reading may be well behind the record');
    } else {
      hasStopped.push('the projection: nobody has established whether this floor is still mirroring git, so it cannot be relied on as one');
    }
    stillWorks.push('git, the gates and the delivery loop: the record is unaffected by anything on this floor, and no gate reads this floor');
    if (paused) {
      hasStopped.push('prefill: template fields an agent would have filled are blank, and blank here does not mean "not applicable"');
      hasStopped.push('routing and triage: nothing is reaching a role inbox, so an empty queue means nobody was told, not that nobody is needed');
      hasStopped.push('conversation: the floor-keepers will not answer, and a question asked here is not waiting for anyone');
    }
    if (status === 'unknown') {
      hasStopped.push('nobody knows: at least one limb of this floor was not observed, and an unobserved limb is not a working one');
    }
  }

  return {
    status,
    reading,
    alert: reading.credits === 'low' || reading.credits === 'exhausted',
    banner: BANNERS.get(status) || null,
    since: isStr(record?.since) ? record.since : (isStr(record?.observed_at) ? record.observed_at : null),
    observed_at: isStr(record?.observed_at) ? record.observed_at : null,
    observed_by: isStr(record?.observed_by) ? record.observed_by : null,
    projection_depends_on_credits: false,
    still_works: stillWorks,
    has_stopped: hasStopped,
  };
}

/**
 * The notice block a surface must render, or `null` when the floor is live. Null rather than a
 * cheerful green object on purpose: there is no "all good" banner to render, so there is no banner
 * for a reader to learn to skip past.
 *
 * `dismissible: false` and `placement: 'every-view'` are not defaults a caller may override. A
 * notice a reader can close is a notice that is closed, and a notice on the home page is invisible
 * to everyone who arrived from a link.
 */
export function surfaceNotice(record) {
  const state = deriveState(record);
  if (state.status === 'live') return null;
  return {
    visible: true,
    dismissible: false,
    placement: NOTICE_PLACEMENT,
    severity: state.status,
    authority: 'none',
    banner: state.banner,
    since: state.since,
    observed_at: state.observed_at,
    observed_by: state.observed_by,
    still_works: state.still_works,
    has_stopped: state.has_stopped,
    manual_fallback: record?.manual_fallback?.runbook ?? null,
  };
}

// --- refusing a record that misrepresents the floor -----------------------------------------------

/** DG-R03 / DG-R04 — is the notice loud enough to be one? */
export function checkNotice(notice, status, label = 'observation') {
  const findings = [];
  const banner = BANNERS.get(status) || null;
  if (status === 'live') {
    if (notice) findings.push(`DG-R04: ${label}: a live floor carries a degradation notice — there is no reassuring banner to render, and a banner that appears when nothing is wrong is the mechanism by which readers learn to dismiss the one that matters`);
    return findings;
  }
  if (!notice || typeof notice !== 'object') {
    return [`DG-R03: ${label}: the floor is ${status.toUpperCase()} and there is no surface notice — this is the whole of D6.4. A paused floor that still looks current misleads every reader, and some of them will decide on it. Degradation must be visible on the surface, not only in a log`];
  }
  if (notice.visible !== true) findings.push(`DG-R03: ${label}: the notice is not marked visible — a notice nobody sees is a comment`);
  if (notice.dismissible !== false) findings.push(`DG-R03: ${label}: the notice is dismissible — a notice a reader can close is a notice that is closed, and the next reader arrives to a floor that looks fine`);
  if (notice.placement !== NOTICE_PLACEMENT) {
    findings.push(`DG-R03: ${label}: the notice's placement is ${JSON.stringify(notice.placement)}, not ${JSON.stringify(NOTICE_PLACEMENT)} — people arrive on a database view from a link in a message and never see a home page or a status page`);
  }
  if (notice.banner !== banner) {
    findings.push(`DG-R04: ${label}: the banner is missing or altered for status ${status} — it is verbatim or it is a finding, the same rule the non-authoritative projection banner lives under, and for the same reason: this sentence is the last thing standing between a calm-looking board and a decision taken against it`);
  }
  if (notice.severity !== undefined && notice.severity !== status) {
    findings.push(`DG-R04: ${label}: the notice's severity says ${JSON.stringify(notice.severity)} while the observations derive ${JSON.stringify(status)} — the derivation wins, and a notice that undersells its own state is the optimistic reading arriving by the back door`);
  }
  return findings;
}

/**
 * DG-R06 — the reconciliation job. Clock-free: it compares the reconciliation's instant against the
 * observation's, both of which are committed, so the verdict is reproducible forever. A
 * reconciliation is only required where the floor is not live — a running floor reconciles by
 * running.
 */
export function checkReconciliation(record, status, { registry = null, maxAgeDays = RECONCILIATION_MAX_AGE_DAYS } = {}, label = 'observation') {
  if (status === 'live') return [];
  const rec = record?.reconciliation;
  if (!rec || typeof rec !== 'object') {
    return [`DG-R06: ${label}: the floor is ${status.toUpperCase()} and no reconciliation has run — the reconciliation is what keeps a paused floor TRUTHFUL rather than merely labelled. Without it, the banner says "degraded" and nobody has established what was missed`];
  }
  const findings = [];
  const ran = parseTime(rec.ran_at);
  const obs = parseTime(record?.observed_at);
  const since = parseTime(record?.since) ?? obs;
  if (ran === null) findings.push(`DG-R06: ${label}: the reconciliation has no parseable ISO-8601 \`ran_at\` — a run nobody can date cannot be told from one that never happened`);
  else if (obs !== null) {
    if (obs - ran > maxAgeDays * DAY) {
      findings.push(`DG-R06: ${label}: the last reconciliation ran ${days(obs - ran)} day(s) before this observation (limit ${maxAgeDays}) — the gap is the window in which work stopped routing and nobody established what was missed`);
    }
    if (ran > obs) findings.push(`DG-R06: ${label}: the reconciliation is dated ${rec.ran_at}, after the observation at ${record.observed_at} — a run that post-dates the reading it accompanies is reconciling something this record cannot describe`);
    if (since !== null && ran < since) {
      findings.push(`DG-R06: ${label}: the reconciliation ran at ${rec.ran_at}, before the degradation began at ${record.since ?? record.observed_at} — a reconciliation from before the pause reconciles nothing about the pause`);
    }
  }

  const by = rec.ran_by;
  if (!isStr(by)) findings.push(`DG-R06: ${label}: the reconciliation names nobody — an unattributed run is a claim, and this one is the claim that a paused floor is still truthful`);
  else {
    if (isStr(record?.observed_by) && sameIdentity(by, record.observed_by)) {
      findings.push(`DG-R06: ${label}: the reconciliation was run by ${JSON.stringify(by)}, the same identity that made the observation — one party asserting twice. The watcher says what it saw; somebody else establishes what was missed`);
    }
    const who = identityOf(registry, by);
    if (registry && !who) findings.push(`DG-R06: ${label}: reconciliation identity ${JSON.stringify(by)} does not resolve in the identity registry`);
    else if (who && who.kind !== 'human') {
      findings.push(`DG-R06: ${label}: the reconciliation was run by ${JSON.stringify(by)}, which is kind ${JSON.stringify(who.kind)} — the automation is what stopped. A machine on the paused platform vouching that nothing was missed is the silence signing its own alibi`);
    }
  }
  return findings;
}

/** DG-R07 — a runbook, named, and not an `ADOPT:` placeholder. */
export function checkManualFallback(record, status, label = 'observation') {
  if (status === 'live') return [];
  const fb = record?.manual_fallback;
  if (!fb || typeof fb !== 'object') {
    return [`DG-R07: ${label}: the floor is ${status.toUpperCase()} and no manual fallback is documented — "the agents are paused" is a description; the fallback is the plan. Without one the honest reading of this record is that work has stopped and nobody decided what happens next`];
  }
  const findings = [];
  if (!isReal(fb.runbook)) {
    findings.push(`DG-R07: ${label}: the manual fallback names no runbook${isStr(fb.runbook) ? ' (an `ADOPT:` placeholder is not a runbook — it is text nobody replaced)' : ''} — a fallback nobody wrote down is one nobody can follow at 2am`);
  }
  if (!isReal(fb.owner)) {
    findings.push(`DG-R07: ${label}: the manual fallback names no owner${isStr(fb.owner) ? ' (an `ADOPT:` placeholder is not an owner)' : ''} — a procedure with no owner is nobody's job, and the whole point of this record is that nobody noticed`);
  }
  return findings;
}

/**
 * The whole record. `[]` ⇒ this observation represents the floor honestly: its status is what its
 * observations derive, its notice is loud where it must be, its projection does not lean on credits,
 * and a paused floor names both a reconciliation that has run and a fallback somebody owns.
 *
 * Clock-free by design; staleness is `checkCurrency()`'s job and is a finding against the watcher.
 */
export function checkDegradation(record, { registry = null, reconciliationMaxAgeDays = RECONCILIATION_MAX_AGE_DAYS } = {}, label = 'observation') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [`DG-R01: ${label}: not an object — an unreadable observation must never be mistaken for a clean bill of health`];
  }
  if (record.schema !== SCHEMA_ID) {
    return [`DG-R01: ${label}: schema ${JSON.stringify(record.schema)} is not ${SCHEMA_ID} — an unversioned observation cannot be read, and what cannot be read cannot be shown to be honest`];
  }
  const findings = [];
  if (parseTime(record.observed_at) === null) findings.push(`DG-R01: ${label}: observed_at is missing or not a parseable ISO-8601 timestamp — an observation with no instant cannot be ordered, aged, or compared with a reconciliation, and the ordering is the control`);
  if (!isStr(record.observed_by)) findings.push(`DG-R01: ${label}: names no observer — an unattributed observation is a claim`);
  if (record.since !== undefined && parseTime(record.since) === null) findings.push(`DG-R01: ${label}: \`since\` is present but not a parseable ISO-8601 timestamp — the instant the floor stopped being live is what a reader needs and what the reconciliation is measured against`);

  const reading = readingOf(record);
  for (const [limb, value, vocab] of [
    ['credits.state', reading.credits, CREDIT_STATES],
    ['automation.agents', reading.agents, RUN_STATES],
    ['automation.workers', reading.workers, RUN_STATES],
    ['projection.state', reading.projection, PROJECTION_STATES],
  ]) {
    if (!vocab.has(value)) {
      findings.push(`DG-R09: ${label}: ${limb} is ${JSON.stringify(value)}, not one of ${[...vocab].map((v) => JSON.stringify(v)).join(' | ')} — an unknown state is refused rather than coerced to the nearest reassuring one, and the derivation reads it as \`unknown\`, never as \`running\``);
    }
  }

  // The asymmetry. If this is true the architecture is wrong, not the wording: the projector is a
  // bank-hosted service precisely so a credit-exhausted floor still mirrors git (ADR 0002).
  if (record.projection?.depends_on_credits === true) {
    findings.push(`DG-R05: ${label}: the projection is declared dependent on credits — D6.4 requires that it is not. Either the projector was deployed as a metered Worker, in which case a credit outage takes the mirror down with the labour and the floor stops being able to tell a reader the truth about the record, or somebody described it carelessly. Both are worth a red build`);
  }
  if (isStr(record.projection?.paused_by) && /credit/i.test(record.projection.paused_by)) {
    findings.push(`DG-R05: ${label}: the projection is recorded as paused by ${JSON.stringify(record.projection.paused_by)} — the projector does not spend surface credits. If it stopped, it stopped for its own reason, and recording that reason as "credits" hides the actual outage behind an expected one`);
  }

  const status = deriveStatus(reading);

  // DG-R02, the headline. The derivation wins; a disagreement is reported, never resolved.
  if (record.status !== undefined && record.status !== status) {
    const worse = severity(status) > severity(record.status);
    findings.push(`DG-R02: ${label}: the record declares status ${JSON.stringify(record.status)} but its observations derive ${JSON.stringify(status)} (credits ${JSON.stringify(reading.credits)}, agents ${JSON.stringify(reading.agents)}, workers ${JSON.stringify(reading.workers)}, projection ${JSON.stringify(reading.projection)})${worse ? ' — and the declared status is the more reassuring of the two, which is the exact direction this control exists to refuse. A paused floor represented as a live one is not a labelling error; it is the failure' : ' — the derivation is what a surface must render, so a declared status that nothing derives is decoration'}`);
  }
  // Belt and braces on the one contradiction that produces silence: a meter at zero with the
  // automation reported running. `deriveStatus` already refuses to call this live; this says why.
  if (reading.credits === 'exhausted' && (reading.agents === 'running' || reading.workers === 'running')) {
    findings.push(`DG-R02: ${label}: the credits are exhausted but ${reading.agents === 'running' ? 'the agents are' : 'the Workers are'} reported running — exhausted credits pause them. One of these two readings is wrong, and the optimistic one must never be the one that decides the banner`);
  }

  findings.push(...checkNotice(record.notice, status, label));
  findings.push(...checkReconciliation(record, status, { registry, maxAgeDays: reconciliationMaxAgeDays }, label));
  findings.push(...checkManualFallback(record, status, label));
  return findings;
}

/**
 * DG-R08 — the only clock here, and it judges the WATCHER. Observations accumulate, so an old file
 * describing a past outage is correct history: staleness is a property of the NEWEST observation
 * alone, and applying it per-record would turn a truthful archive red as time passed.
 */
export function checkCurrency(records = [], { now = Date.now(), maxAgeDays = OBSERVATION_MAX_AGE_DAYS } = {}) {
  const times = records
    .filter((r) => r?.schema === SCHEMA_ID)
    .map((r) => parseTime(r.observed_at))
    .filter((t) => t !== null);
  if (!times.length) {
    return [`DG-R08: the floor's liveness has never been observed — nobody can say whether it is running, and the whole failure mode of D6.4 is that nobody looked. Observed, not declared`];
  }
  const newest = Math.max(...times);
  if (newest > now) return [`DG-R08: the newest observation is dated in the future — an observation that has not happened yet has not happened`];
  const age = days(now - newest);
  if (age > maxAgeDays) {
    return [`DG-R08: the newest observation is ${age} day(s) old (limit ${maxAgeDays}) — nobody has looked recently enough to say this floor is live, and a floor nobody is watching is exactly the one that pauses quietly`];
  }
  return [];
}

/**
 * The worst status across a set of observations, with the record that carries it. Used where several
 * watchers report on one floor: the WORST reading decides the banner, never the newest. A later,
 * cheerier observation must not clear a notice that a still-unresolved one raised.
 */
export function worstStatus(records = []) {
  let worst = null;
  for (const r of records) {
    if (r?.schema !== SCHEMA_ID) continue;
    const status = deriveStatus(readingOf(r));
    if (!worst || severity(status) > severity(worst.status)) worst = { status, record: r };
  }
  return worst;
}

// CLI: render the state and the notice a surface must show, from a committed observation.
//   node core/floor-degradation.mjs <observation.json> [<identities.json>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [recordPath, registryPath] = process.argv.slice(2);
  if (!recordPath) {
    process.stderr.write('usage: node core/floor-degradation.mjs <observation.json> [<identities.json>]\n');
    process.exit(2);
  }
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { process.stderr.write(`cannot read ${p}\n`); process.exit(2); return null; } };
  const record = read(recordPath);
  const state = deriveState(record);
  process.stdout.write(`Floor status — ${state.status.toUpperCase()}${state.alert ? ' · CREDIT ALERT' : ''}\n`);
  if (state.banner) process.stdout.write(`\n  ${state.banner}\n`);
  for (const s of state.still_works) process.stdout.write(`\n  still works · ${s}`);
  for (const s of state.has_stopped) process.stdout.write(`\n  STOPPED     · ${s}`);
  process.stdout.write('\n');
  const findings = checkDegradation(record, { registry: registryPath ? read(registryPath) : null });
  if (findings.length) {
    process.stderr.write('\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
}
