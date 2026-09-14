// Webhook discipline (Factory Floor WS4 · D4.3). The seam's only INBOUND path from the
// collaboration surface, and the one place in the harness where bytes arrive from outside without
// anybody having asked for them.
//
// ONE SENTENCE GOVERNS THIS FILE: **webhooks are signals, not records.** A delivery may tell you
// that something MIGHT have changed. It may never tell you WHAT it now says. Everything below is
// arranged so that the second thing is not merely discouraged but structurally unavailable: the
// verified result carries an ID TO REFETCH and no content fields at all, so the only way to learn
// what a page says is to go and read it from the source of truth. A module that let a payload's
// fields flow into a governed artifact would not be a module with a weakness — it would be the
// whole vulnerability, because every gate downstream trusts the record and nothing re-reads the
// floor after the fact.
//
// WHAT A VALID SIGNATURE ACTUALLY PROVES, which is much less than it feels like.
//
//   1. It proves the bytes were not altered between the sender and here, and that the sender holds
//      the subscription's verification token. That is ALL. It says nothing about whether the claim
//      inside the bytes is true. A compromised workspace, a buggy integration, or an automation
//      someone wired up last Tuesday signs its falsehoods exactly as well as the vendor signs its
//      truths — the MAC covers custody, never correctness.
//   2. It authenticates the WORKSPACE, never the person. `authors[]` names a Notion person id, and
//      that id is a claim inside a payload the workspace composed. A decision acquires validity on
//      TB-0 only — a subject-bound assertion minted on a path the bridge cannot reach
//      (`core/approval-attestations.mjs`, threat model T-03). Nothing here is an approval, and no
//      field this module returns may be read as one.
//   3. HMAC IS SYMMETRIC. The key that verifies is the key that signs, so the receiver can forge a
//      delivery indistinguishable from the vendor's. A webhook can therefore never be
//      non-repudiable evidence of anything, against anyone, ever. That is the deepest reason it is
//      a signal and not a record, and it does not go away with better key hygiene.
//
// VERIFY BEFORE PARSE, AND OVER THE RAW BYTES. The HMAC is computed over exactly the octets that
// arrived. Not over a re-serialised object: `JSON.parse` then `JSON.stringify` changes whitespace,
// key order, escape forms and number formatting, so the digest of the round trip is a digest of a
// different document and every genuine delivery would fail. The worse failure is the other
// direction — reaching for `req.body` means a JSON parser has already run over unauthenticated,
// attacker-chosen input before anything checked who sent it. So this module refuses a parsed object
// outright (WH-R04) rather than helpfully re-encoding it, and `JSON.parse` appears exactly once,
// below the signature check, under a comment saying so.
//
// NEVER ASSUME ORDERING OR EXACTLY-ONCE. Delivery is at-least-once on a good day: the vendor
// retries on any non-2xx, retries carry the same event id with `attempt_number` incremented, and
// nothing promises that two events about one page arrive in the order they happened. Two defences,
// and they are the same defence seen from two sides — deduplicate on event id so a retry is a
// no-op, and refetch current state so ordering cannot matter. `coalesceByEntity()` exists to make
// the second one the path of least resistance: N signals about one entity collapse to ONE refetch,
// deterministically, with no notion of which was "latest" — because "latest" is unknowable from
// delivery order and irrelevant once you have read the current state anyway.
//
// A REPLAY IS A NO-OP, NOT AN ERROR. `duplicate: true` comes back with an EMPTY `findings` array
// on purpose. The vendor retries whenever it does not see a 2xx and disables a subscription that
// keeps failing, so an endpoint that answered 4xx to its own retries would switch its own feed off
// and call that a security control. The operational contract is: `signal !== null` is the only
// permission to act; a duplicate means answer 200 and do nothing; findings mean answer 4xx and
// alert. `signal` is `null` in both non-acting cases, which is what makes "act on a refused event"
// something a caller has to write on purpose rather than something they can drift into.
//
// NO CLOCK, NO GLOBAL STATE. `now` and `seen` are injected and REQUIRED (WH-R02, WH-R03) rather
// than defaulted. A default `Date.now()` would make the replay window a property of whatever
// machine happened to run, and a default in-module Set would silently become process-global state
// that two callers share and no test can see. More to the point: making `seen` absent behave like
// "no deduplication configured" would let the module's headline control be switched off by
// omission, which is the absent-reads-as-present asymmetry this repo refuses everywhere else.
//
// WHAT THIS DOES NOT CLOSE, named so silence is not mistaken for coverage:
//
//   - **Loss is silent.** Nothing here can tell a missing delivery from a quiet workspace. That is
//     the reconciliation poll's job (plan §7.3, cadence AWAITING) and it is not in this file.
//   - **The seen-set's durability is undesigned** (threat model §8 G-4: where used event ids live,
//     who owns the file, how it is pruned, how it behaves on a fork). This module takes the set as
//     an argument precisely so it does not pretend to have settled that. An in-memory `Map`
//     survives one process; a restart forgets, and after a restart a replay inside the window would
//     be accepted. Say that out loud rather than shipping a Map that looks like a ledger.
//   - **Retry envelope vs replay window.** Whether the vendor re-stamps `timestamp` on retry is not
//     documented and is not verified here. If it does not, a retry arriving later than
//     `replayWindowMs` is refused as stale (WH-R15) and the delivery is lost until reconciliation.
//     Widening the window trades replay resistance for retry tolerance; it is a tuning decision an
//     adopter makes knowingly, which is why it is a parameter and not a constant edit.
//   - **The subscription handshake is unsigned by design.** Notion's one-time `verification_token`
//     POST carries no `X-Notion-Signature`. It must be completed out of band and must never be
//     routed through this function — WH-R06 says so in its message, because the first thing an
//     adopter meets is that request failing.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Lowercased, because HTTP header names are case-insensitive and callers hand us all three cases. */
export const SIGNATURE_HEADER = 'x-notion-signature';
/** The vendor's prefix. Kept explicit so an algorithm change is a visible edit, not a silent one. */
export const SIGNATURE_PREFIX = 'sha256=';

/** How stale a delivery may be before it is refused. See the retry-envelope note in the header. */
export const REPLAY_WINDOW_MS = 5 * 60_000;
/** How far ahead of our clock the sender's may run. Beyond this, a future stamp is a forged one. */
export const CLOCK_SKEW_MS = 60_000;
/**
 * HMAC over unbounded attacker-supplied bytes is free CPU on an endpoint that is public by
 * construction, so the cap is checked BEFORE the digest, not after.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Author types the bridge refuses (D5.2, threat model T-02). Note carefully what kind of check
 * this is: it uses payload data to REFUSE, never to ASSERT. A refusal driven by data the sender
 * controls can only ever make us do less, so the worst a hostile sender achieves by lying here is
 * their own event being dropped. The moment the same field were used to assert something — "this
 * person approved" — the direction reverses and the sender is choosing our conclusion.
 */
export const REFUSED_AUTHOR_TYPES = new Set(['bot', 'agent']);

/**
 * Every rejection this module can emit. Exported so an adopter can read the contract without
 * reading the source, and asserted against the source by the test suite — a code that exists in
 * one and not the other is a documentation gap the tests fail on.
 */
export const REJECTIONS = new Map([
  ['WH-R01', 'no verification secret configured — an unconfigured verifier must refuse traffic, never wave it through'],
  ['WH-R02', 'no `now` supplied — this module has no clock, so freshness is judged against the caller\'s trusted one'],
  ['WH-R03', 'no `seen` map supplied — deduplication is the headline control and may not be switched off by omission'],
  ['WH-R04', 'the body is not raw bytes — a parsed object cannot be re-serialised back to the octets that were signed'],
  ['WH-R05', 'the body is larger than the cap — an unauthenticated caller does not get to choose how much hashing we do'],
  ['WH-R06', 'no signature header — including the unsigned subscription handshake, which is not an event'],
  ['WH-R07', 'the signature header is malformed — wrong prefix, wrong length, non-hex, or more than one value'],
  ['WH-R08', 'the signature does not verify — a tampered body and a wrong secret share one code on purpose'],
  ['WH-R09', 'the authenticated bytes are not a JSON object — authentic garbage is still garbage'],
  ['WH-R10', 'no event id — there is nothing to deduplicate on, so exactly-once cannot be approximated'],
  ['WH-R11', 'no event type — an untyped signal cannot be routed'],
  ['WH-R12', 'no entity to refetch — a signal that names nothing to go and read is not actionable'],
  ['WH-R13', 'the event is not from the workspace or subscription this endpoint is bound to'],
  ['WH-R14', 'the timestamp is missing or not a parseable ISO-8601 instant — an unreadable stamp is a finding, not a fresh event'],
  ['WH-R15', 'the event is older than the replay window'],
  ['WH-R16', 'the event is stamped further into the future than clock skew allows'],
  ['WH-R17', 'a bot or agent is named as the author — machine judgment is never laundered into human accountability'],
  ['WH-R18', 'already seen — a replayed or retried event is a no-op (not a finding; see the header)'],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/**
 * ISO-8601 only, and the TYPE is part of the check — the same stance as the attestation contract.
 * `Date.parse` coerces non-strings unpredictably (`0` becomes the year 2000), and the payload's
 * JSON is composed by the sender, so the sender would be choosing the type. A numeric zero read as
 * "the year 2000" is an event that is always stale; read as unparseable it is a finding. The
 * second is a judgement someone made.
 */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/**
 * A signature is 64 hex characters and nothing else. Anchored, and length-exact, so a repeated
 * header (which Node collapses to `"a, b"`) cannot smuggle a valid value in beside an invalid one
 * by being "close enough" to parse.
 */
const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * The body as the octets that were signed, or `null` if the caller handed us something else.
 *
 * A string is accepted because most frameworks surface `rawBody` that way, but it must be the
 * bytes as received: if anything in the stack re-encoded them, the signature is over a document
 * that no longer exists. An object is NOT accepted, and that refusal is the point of the function
 * — see the module header.
 */
function rawBytes(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
}

/**
 * The live verification tokens. A list, because rotation is a requirement (threat model T-08) and
 * during an overlap both keys are genuinely live — a verifier that held one would turn every key
 * change into an outage, which is how rotations stop happening.
 *
 * An `ADOPT:` placeholder is not a secret. It is text nobody replaced, and treating it as key
 * material would let an unwired endpoint authenticate its own test traffic: worse than absent,
 * because it looks configured.
 */
function secretList(secret) {
  const raw = Array.isArray(secret) ? secret : [secret];
  return raw.filter((s) => typeof s === 'string' && s.length > 0 && !/^ADOPT:/.test(s));
}

/**
 * Read one header, case-insensitively, from a plain object or a `Headers`.
 *
 * A header delivered twice arrives as an array or as a comma-joined string, and there is no rule
 * for choosing between two claimed signatures. So both forms are returned WHOLE and left to fail
 * the format check. Picking one — the first, the last, "the one that verifies" — would hand an
 * attacker who can append a header a free pass: send garbage plus a captured valid value and let
 * the verifier find the good one.
 */
export function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    return typeof v === 'string' ? v : null;
  }
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() !== want) continue;
    const v = headers[k];
    if (Array.isArray(v)) return v.join(', ');
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * The header value a body should carry. Exported for the CLI, for an adopter's own endpoint tests,
 * and for this module's tests — a test suite that hand-rolled the HMAC would be testing its own
 * arithmetic rather than the module's.
 */
export function signBody(rawBody, secret) {
  const bytes = rawBytes(rawBody);
  if (!bytes) throw new TypeError('signBody needs the raw body bytes (Buffer, Uint8Array or string) — an object cannot be re-serialised back to what was signed');
  if (!isStr(secret)) throw new TypeError('signBody needs the subscription verification token');
  return SIGNATURE_PREFIX + createHmac('sha256', secret).update(bytes).digest('hex');
}

/**
 * Constant-time signature check over the raw bytes. Findings ([] ⇒ these bytes came from a holder
 * of one of the live tokens, unaltered).
 *
 * THE LENGTH CHECK IS NOT A LEAK, and it is worth saying why rather than leaving the reader to
 * wonder. `timingSafeEqual` throws `RangeError` on unequal lengths, so something must handle the
 * mismatch — and "catch and return false" quietly converts a malformed header into a comparison
 * failure, losing the distinction an operator needs. The length of a SHA-256 digest is a public
 * constant of the algorithm; it is not a function of the secret, so refusing on it before the
 * comparison reveals nothing. What WOULD leak is comparing the bytes with `===` or `startsWith`,
 * which return at the first differing byte and let an attacker walk a forgery out one byte at a
 * time. Hence: format first, then a fixed-width constant-time compare.
 *
 * A tampered body and a wrong secret deliberately share ONE code. Telling them apart would make
 * this endpoint an oracle that answers "your key is right, your payload is wrong" to anyone.
 */
export function verifySignature(rawBody, presented, secret) {
  const secrets = secretList(secret);
  if (secrets.length === 0) return [`WH-R01: ${REJECTIONS.get('WH-R01')} (an \`ADOPT:\` placeholder is not a token — it is text nobody replaced)`];
  const bytes = rawBytes(rawBody);
  if (!bytes) return [`WH-R04: ${REJECTIONS.get('WH-R04')}`];
  if (presented === null || presented === undefined) {
    return [`WH-R06: no \`${SIGNATURE_HEADER}\` header — nothing about this request is authenticated. If this is the subscription handshake carrying \`verification_token\`, it arrives unsigned by design: complete it out of band and never route it through the event path`];
  }
  if (typeof presented !== 'string' || !presented.startsWith(SIGNATURE_PREFIX)) {
    return [`WH-R07: the signature header does not begin with \`${SIGNATURE_PREFIX}\` — the algorithm is part of the contract, and a header whose algorithm we did not choose is not evidence`];
  }
  const hex = presented.slice(SIGNATURE_PREFIX.length);
  if (!HEX64.test(hex)) {
    return [`WH-R07: the signature is not 64 hex characters (got ${JSON.stringify(hex.length > 80 ? `${hex.slice(0, 80)}…` : hex)}) — a truncated, padded or repeated header is refused here rather than being coerced into a comparison`];
  }
  const claimed = Buffer.from(hex.toLowerCase(), 'hex');
  let ok = false;
  for (const s of secrets) {
    // `|| ok` rather than an early `return`: during a rotation both tokens are live, and stopping
    // at the first match would make the time taken depend on WHICH token matched. Every candidate
    // is hashed and compared on every request.
    ok = timingSafeEqual(createHmac('sha256', s).update(bytes).digest(), claimed) || ok;
  }
  return ok ? [] : [`WH-R08: the signature does not verify — either the body was altered in flight or the sender does not hold this subscription's token. This endpoint deliberately does not say which: an answer would make it an oracle that confirms a correct key to anyone probing with a wrong payload`];
}

/**
 * The only thing a verified delivery is allowed to become.
 *
 * Read the omissions, they are the design. `data` (the changed blocks, the parent, the properties),
 * `authors` and `accessible_by` are absent because they are content and identity, and both must
 * come from a refetch or from TB-0, never from here. `workspace_name` is absent for a subtler
 * reason: it is a human-readable label that would look entirely harmless written into a frozen
 * artifact's frontmatter, and it is a string the sender chose. The ONLY payload fields that survive
 * are routing metadata and the id of something to go and read.
 *
 * `claimed_at` is named "claimed" rather than "at" for the same reason: it is inside the signed
 * bytes, so no network attacker can move it, but it is still the SENDER'S clock. Authenticated is
 * not the same as true.
 *
 * `refetch.kind` is the entity type as delivered. For a `block` event, resolving that block to the
 * page it lives on is an API walk — the payload's `data.parent` would answer it for free, and that
 * is exactly the convenience this module declines to offer.
 */
function signalFrom(body) {
  return Object.freeze({
    event_id: body.id,
    event_type: body.type,
    workspace_id: isStr(body.workspace_id) ? body.workspace_id : null,
    subscription_id: isStr(body.subscription_id) ? body.subscription_id : null,
    integration_id: isStr(body.integration_id) ? body.integration_id : null,
    // Retries carry the same event id with this incremented. It is diagnostic only: a caller that
    // branched on it would be treating an at-least-once delivery as a state machine.
    attempt: Number.isInteger(body.attempt_number) ? body.attempt_number : null,
    claimed_at: body.timestamp,
    refetch: Object.freeze({ kind: body.entity.type, id: body.entity.id }),
  });
}

/**
 * Verify, deduplicate, and reduce one delivery to a signal.
 *
 * `rawBody` — the octets exactly as received (Buffer, Uint8Array, or the string they decode to).
 * `headers` — a plain object or a `Headers`; only the signature header is read.
 * ctx: {
 *   secret,             — the subscription verification token, or an array of them during rotation
 *   now,                — REQUIRED. ms epoch from the caller's trusted clock
 *   seen,               — REQUIRED. Map of event id → receive time. See pruneSeen()
 *   expectWorkspace,    — optional. Pin the workspace this endpoint serves
 *   expectSubscription, — optional. Pin the subscription
 *   replayWindowMs, clockSkewMs, maxBytes, refuseAuthorTypes — optional overrides
 * }
 *
 * Returns { signal, duplicate, findings, note }.
 *
 *   **`signal !== null` is the only permission to act.** It is null on every refusal and on every
 *   duplicate, so there is no shape in which a caller acts on an event this module rejected.
 *   `findings` non-empty ⇒ refuse the request (4xx, alert). `duplicate` ⇒ 200 and do nothing.
 */
export function verifyWebhook(rawBody, headers, ctx = {}) {
  const nothing = (findings, extra = {}) => ({ signal: null, duplicate: false, findings, note: null, ...extra });

  // Configuration first, and fail closed on all of it. Each of these three, defaulted instead of
  // demanded, would disable a control silently: no secret ⇒ everything authenticates; no clock ⇒
  // the replay window belongs to whatever machine ran; no seen-set ⇒ no deduplication at all.
  if (secretList(ctx.secret).length === 0) {
    return nothing([`WH-R01: ${REJECTIONS.get('WH-R01')} — set the subscription's verification token (an \`ADOPT:\` placeholder does not count; it is text nobody replaced)`]);
  }
  if (typeof ctx.now !== 'number' || !Number.isFinite(ctx.now)) {
    return nothing([`WH-R02: ${REJECTIONS.get('WH-R02')} — pass \`now\`, so the replay window is judged against a clock the caller vouches for rather than whichever machine happens to run this`]);
  }
  if (!(ctx.seen instanceof Map)) {
    return nothing([`WH-R03: ${REJECTIONS.get('WH-R03')} — pass a Map of event id → receive time; an absent set would read exactly like a set that has never seen anything, and deduplication is the whole acceptance criterion of D4.3`]);
  }

  const bytes = rawBytes(rawBody);
  if (!bytes) {
    return nothing([`WH-R04: ${REJECTIONS.get('WH-R04')} — pass the request's raw body. Re-serialising a parsed object changes whitespace, key order and escaping, so its digest is the digest of a different document; and reaching for the parsed body means JSON was parsed from an unauthenticated stranger before anything checked the signature`]);
  }
  if (bytes.length === 0) return nothing([`WH-R04: the body is empty — there are no bytes to authenticate`]);
  const maxBytes = Number.isFinite(ctx.maxBytes) ? ctx.maxBytes : MAX_BODY_BYTES;
  if (bytes.length > maxBytes) {
    return nothing([`WH-R05: the body is ${bytes.length} bytes, over the ${maxBytes} cap — checked BEFORE the HMAC, because hashing unbounded bytes for an unauthenticated caller is CPU they chose to spend on our behalf`]);
  }

  const sig = verifySignature(bytes, headerValue(headers, SIGNATURE_HEADER), ctx.secret);
  if (sig.length) return nothing(sig);

  // ---------------------------------------------------------------------------------------------
  // EVERYTHING BELOW THIS LINE RUNS ON AUTHENTICATED BYTES. This is the first parse of the
  // request, and it happens here and nowhere earlier — that ordering is the control, not a detail
  // of implementation. Authenticated still does not mean true: see the module header.
  // ---------------------------------------------------------------------------------------------
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); } catch (e) {
    return nothing([`WH-R09: the signature verified but the bytes are not JSON (${e.message}) — the sender is who they claim and the claim is unreadable, which is a sender bug or a version skew, not an attack`]);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return nothing([`WH-R09: ${REJECTIONS.get('WH-R09')} (got ${Array.isArray(body) ? 'an array' : JSON.stringify(body)})`]);
  }

  const findings = [];
  // Shape. Every field checked here is one the module itself needs — an id to deduplicate on, a
  // type to route by, an entity to go and read. Nothing else is validated, because nothing else is
  // used, and validating a field we do not use would imply we do.
  if (!isStr(body.id)) findings.push(`WH-R10: ${REJECTIONS.get('WH-R10')} — without an event id, a retry is indistinguishable from a second event and at-least-once delivery cannot be narrowed`);
  if (!isStr(body.type)) findings.push(`WH-R11: ${REJECTIONS.get('WH-R11')}`);
  if (!isStr(body.entity?.id) || !isStr(body.entity?.type)) {
    findings.push(`WH-R12: no \`entity.{id,type}\` — a signal exists to say WHICH thing to refetch, and one that names nothing leaves the caller with only the payload to act on, which is the one thing it must never act on`);
  }

  // The endpoint is bound to a workspace and a subscription. The token already implies both, so
  // this is defence in depth — it catches a token pasted into the wrong deployment far more often
  // than it catches an attacker, and that is a good enough reason to have it.
  if (isStr(ctx.expectWorkspace) && body.workspace_id !== ctx.expectWorkspace) {
    findings.push(`WH-R13: the event names workspace ${JSON.stringify(body.workspace_id)} but this endpoint is bound to ${JSON.stringify(ctx.expectWorkspace)}`);
  }
  if (isStr(ctx.expectSubscription) && body.subscription_id !== ctx.expectSubscription) {
    findings.push(`WH-R13: the event names subscription ${JSON.stringify(body.subscription_id)} but this endpoint is bound to ${JSON.stringify(ctx.expectSubscription)}`);
  }

  // Freshness. The stamp is inside the signed bytes, so nobody in the middle can move it — but a
  // captured delivery replayed a week later carries its original stamp, and that is exactly what
  // the window catches. Deduplication alone would not: after a restart, or after pruning, the id
  // is forgotten and the stamp is the only thing left saying "this is old".
  const window = Number.isFinite(ctx.replayWindowMs) ? ctx.replayWindowMs : REPLAY_WINDOW_MS;
  const skew = Number.isFinite(ctx.clockSkewMs) ? ctx.clockSkewMs : CLOCK_SKEW_MS;
  const stamped = parseTime(body.timestamp);
  if (stamped === null) {
    findings.push(`WH-R14: \`timestamp\` ${JSON.stringify(body.timestamp)} is missing or not a parseable ISO-8601 instant — an unreadable stamp is a finding, because the alternative readings are "always fresh" and "always stale" and neither is a judgement anyone made`);
  } else if (ctx.now - stamped > window) {
    findings.push(`WH-R15: the event is stamped ${body.timestamp}, ${Math.floor((ctx.now - stamped) / 1000)}s old, past the ${Math.floor(window / 1000)}s replay window — a captured delivery replayed later carries its original stamp, which is what this catches once the event id has been pruned or forgotten across a restart`);
  } else if (stamped - ctx.now > skew) {
    findings.push(`WH-R16: the event is stamped ${body.timestamp}, ${Math.floor((stamped - ctx.now) / 1000)}s in the future, beyond the ${Math.floor(skew / 1000)}s skew allowance — a forward-dated stamp buys an attacker a delivery that never ages out of the window`);
  }

  // Authors. A refusal, never an assertion — see REFUSED_AUTHOR_TYPES. Absent authors are NOT a
  // finding: the authoritative answer to "who acted" is the TB-0 assertion, and demanding it here
  // would imply this module can answer it. It cannot, and pretending otherwise is F1 restated.
  const refused = ctx.refuseAuthorTypes ? new Set(ctx.refuseAuthorTypes) : REFUSED_AUTHOR_TYPES;
  for (const a of Array.isArray(body.authors) ? body.authors : []) {
    if (refused.has(a?.type)) {
      findings.push(`WH-R17: the workspace names an author of type ${JSON.stringify(a.type)} — agents and bots prepare evidence, they never act as the party behind a decision. Note the direction: this refuses on a field the sender controls, so a hostile sender can only cost itself the delivery, never buy an approval`);
    }
  }

  if (findings.length) return nothing(findings);

  // Deduplication, LAST, and only for a delivery that passed everything else. Recording an event
  // id before it verified would hand an attacker a denial primitive: forge a delivery carrying the
  // id of an event they know is coming, and the genuine one is dropped as a duplicate when it
  // arrives. The seen-set is stamped with OUR receive time, never the sender's claim, because
  // pruneSeen() reasons about it against our clock.
  const prior = ctx.seen.get(body.id);
  if (prior !== undefined) {
    return {
      signal: null,
      duplicate: true,
      findings: [], // a retry is expected traffic, not a fault — see the module header
      note: `WH-R18: event ${body.id} was already handled at ${new Date(prior).toISOString()} — a replay is a no-op. Answer 2xx and do nothing: the vendor retries anything that is not a 2xx and disables a subscription that keeps failing, so refusing our own retries would switch the feed off`,
    };
  }
  ctx.seen.set(body.id, ctx.now);

  return { signal: signalFrom(body), duplicate: false, findings: [], note: null };
}

/**
 * Collapse many signals into the set of things to go and read.
 *
 * This is where "never assume ordering" stops being advice and becomes an API. Given five signals
 * about one page — in whatever order they arrived, from however many retries — the answer is ONE
 * refetch of that page. There is no "latest" here and no merge of payloads, because the payloads
 * were never carried, and once you read current state the order they arrived in cannot matter.
 *
 * The output is SORTED, on the target key and on the event ids within each target, so the same
 * batch produces the same plan whatever order the deliveries landed in. A caller that logs or
 * digests the plan gets a stable value; one that diffs two runs sees real change, not arrival jitter.
 */
export function coalesceByEntity(signals) {
  const byTarget = new Map();
  for (const s of Array.isArray(signals) ? signals : []) {
    if (!isStr(s?.refetch?.id) || !isStr(s?.refetch?.kind)) continue;
    // Keyed on kind AND id: a block and a page are different reads even in the impossible case of
    // a shared identifier, and collapsing them would drop one.
    const key = `${s.refetch.kind}\u0000${s.refetch.id}`;   // NUL written as an ESCAPE, never a raw
    // byte: a literal NUL in source makes the file "binary" to grep, diff and review tooling, and a
    // control character nobody can see is the wrong thing to hide a security-relevant delimiter in.
    const target = byTarget.get(key) || { kind: s.refetch.kind, id: s.refetch.id, events: [] };
    if (isStr(s.event_id)) target.events.push(s.event_id);
    byTarget.set(key, target);
  }
  return [...byTarget.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, t]) => ({ kind: t.kind, id: t.id, events: [...t.events].sort() }));
}

/**
 * Drop event ids old enough that the replay window refuses them anyway. Returns how many went.
 *
 * THE HORIZON IS DERIVED FROM THE WINDOW, NEVER CHOSEN INDEPENDENTLY, and that is the entire
 * subtlety of this function. Deduplication and the replay window are one defence seen from two
 * sides: an id is safe to forget only once a replay carrying it would be refused as stale. Prune
 * sooner and there is a gap in which an id has been forgotten but its stamp is still fresh — a
 * replay walks straight through, and nothing anywhere reports it.
 *
 * The skew allowance is in the horizon for the same reason it is in the check: an entry received
 * at R may carry a stamp up to `clockSkewMs` AHEAD of R, so waiting `window` alone would forget it
 * while a replay of it was still inside the window by its own stamp.
 */
export function pruneSeen(seen, now, { replayWindowMs = REPLAY_WINDOW_MS, clockSkewMs = CLOCK_SKEW_MS } = {}) {
  if (!(seen instanceof Map) || typeof now !== 'number' || !Number.isFinite(now)) return 0;
  const horizon = now - (replayWindowMs + clockSkewMs);
  let dropped = 0;
  for (const [id, at] of seen) {
    // A non-numeric stamp is not evidence of age, so it is kept. An entry that cannot be shown to
    // be old is not old — the same fail-closed reading applied to every timestamp in this file.
    if (typeof at === 'number' && at < horizon) { seen.delete(id); dropped += 1; }
  }
  return dropped;
}

// CLI, two ways round, because both halves of wiring an endpoint go wrong:
//
//   NOTION_WEBHOOK_SECRET=… node core/floor-webhook.mjs sign   <body.json>
//   NOTION_WEBHOOK_SECRET=… node core/floor-webhook.mjs verify <body.json> <sha256=…>
//   node core/floor-webhook.mjs codes
//
// The file is read as BYTES, never as text that gets re-encoded — signing a re-serialisation would
// teach the adopter exactly the habit this module exists to prevent.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, path, presented] = process.argv.slice(2);
  const usage = 'usage: NOTION_WEBHOOK_SECRET=… node core/floor-webhook.mjs sign|verify <body.json> [signature]\n       node core/floor-webhook.mjs codes\n';
  if (mode === 'codes') {
    for (const [code, why] of REJECTIONS) process.stdout.write(`${code}  ${why}\n`);
    process.exit(0);
  }
  if (!['sign', 'verify'].includes(mode) || !path) { process.stderr.write(usage); process.exit(2); }
  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (!secret) { process.stderr.write('NOTION_WEBHOOK_SECRET is not set\n'); process.exit(2); }
  let bytes;
  try { bytes = readFileSync(path); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  if (mode === 'sign') {
    process.stdout.write(`${SIGNATURE_HEADER}: ${signBody(bytes, secret)}\n`);
    process.exit(0);
  }
  const { signal, duplicate, findings, note } = verifyWebhook(bytes, { [SIGNATURE_HEADER]: presented }, {
    secret, now: Date.now(), seen: new Map(),
  });
  if (findings.length) {
    process.stderr.write(`\nDelivery REFUSED — nothing is acted on.\n\n  - ${findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  if (duplicate) { process.stdout.write(`${note}\n`); process.exit(0); }
  process.stdout.write(`${JSON.stringify(signal, null, 2)}\n\nRefetch \`${signal.refetch.kind}\` ${signal.refetch.id} before acting — this payload is a signal, and its content is not the record.\n`);
}
