// Tests for webhook discipline (Factory Floor WS4 · D4.3). Node built-in runner.
//
// These are written adversarially: for every control in the module there is a test that would PASS
// if the control were deleted, so a regression that removes a check fails here rather than shipping
// quietly. The ones worth reading first are the pair that pin down ordering — a body that is both
// unsigned and unparseable must report the SIGNATURE, never the parse — and the one that proves a
// verified signal carries no payload content, because that is the whole vulnerability this module
// exists to make unavailable.
//
// What these tests do NOT prove, said here rather than in a commit message: they run against the
// documented event shape, not a live subscription. The first real delivery is where that modelling
// gets checked, and the vendor's retry envelope (does a retry re-stamp `timestamp`?) is not
// knowable from a fixture at all — see the module header's note on the replay window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOCK_SKEW_MS,
  MAX_BODY_BYTES,
  REJECTIONS,
  REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  coalesceByEntity,
  headerValue,
  pruneSeen,
  signBody,
  verifySignature,
  verifyWebhook,
} from './floor-webhook.mjs';

const SECRET = 'notion_verification_token_live';
const OTHER = 'notion_verification_token_someone_elses';
const NOW = Date.parse('2026-07-26T12:00:00.000Z');

/**
 * The documented delivery shape. `data`, `authors`, `accessible_by` and `workspace_name` are
 * present exactly because the module must refuse to pass them on — a fixture without them could
 * not detect the leak it is here to detect.
 */
const event = (over = {}) => ({
  id: 'evt-0001',
  timestamp: '2026-07-26T11:59:30.000Z',
  workspace_id: 'ws-meridian',
  workspace_name: 'Meridian Trust — Factory Floor',
  subscription_id: 'sub-floor-bridge',
  integration_id: 'int-floor-bridge',
  authors: [{ id: 'person-lena', type: 'person' }],
  accessible_by: [{ id: 'person-lena', type: 'person' }],
  attempt_number: 1,
  entity: { id: 'page-d6-feasibility', type: 'page' },
  type: 'page.content_updated',
  data: {
    parent: { id: 'db-artifacts', type: 'database' },
    updated_blocks: [{ id: 'blk-1', type: 'block' }],
  },
  ...over,
});

/** Deliver a body, signing it correctly unless the test says otherwise. */
function deliver(body, { secret = SECRET, signature, headers, rawBody, ...ctx } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = signature === undefined ? signBody(raw, secret) : signature;
  return verifyWebhook(rawBody === undefined ? raw : rawBody, headers || { 'X-Notion-Signature': sig }, {
    secret: SECRET, now: NOW, seen: new Map(), ...ctx,
  });
}

const codes = (r) => r.findings.map((f) => f.slice(0, 6));

// --- the happy path, and what it is allowed to hand back -----------------------------------------

test('a valid signature passes, and what comes back is an id to refetch', () => {
  const r = deliver(event());
  assert.deepEqual(r.findings, []);
  assert.equal(r.duplicate, false);
  assert.ok(r.signal, 'a correctly signed, fresh, first-seen delivery must produce a signal');
  assert.deepEqual(r.signal.refetch, { kind: 'page', id: 'page-d6-feasibility' });
  assert.equal(r.signal.event_id, 'evt-0001');
  assert.equal(r.signal.event_type, 'page.content_updated');
  assert.equal(r.signal.attempt, 1);
});

// THE governing test. If this one goes red, the module has stopped being a webhook verifier and
// become a content channel, and every artifact downstream inherits an attacker-shaped field.
test('the verified signal carries no payload content — webhooks are signals, not records', () => {
  const smuggled = 'SMUGGLED-INTO-THE-RECORD';
  const { signal } = deliver(event({
    workspace_name: smuggled,
    data: {
      parent: { id: smuggled, type: 'database' },
      updated_blocks: [{ id: 'blk', type: 'block' }],
      properties: { 'Residual rating': { select: { name: smuggled } } },
    },
    authors: [{ id: smuggled, type: 'person' }],
    accessible_by: [{ id: smuggled, type: 'person' }],
  }));
  assert.ok(signal);
  // Not by field name — by BYTES. A future field added to the signal cannot sneak content through
  // a test that only checked the fields it knew about.
  assert.doesNotMatch(JSON.stringify(signal), new RegExp(smuggled));
  for (const k of ['data', 'authors', 'accessible_by', 'workspace_name', 'properties', 'body']) {
    assert.equal(signal[k], undefined, `signal must not carry \`${k}\``);
  }
  // …and the resolution a caller most wants for free — "which page is this block on?" — is not
  // offered, because `data.parent` answering it is the habit this module refuses to teach.
  assert.equal(signal.refetch.kind, 'page');
  assert.deepEqual(Object.keys(signal.refetch).sort(), ['id', 'kind']);
});

test('the signal is frozen — content cannot be bolted on after verification', () => {
  const { signal } = deliver(event());
  assert.ok(Object.isFrozen(signal) && Object.isFrozen(signal.refetch));
  assert.throws(() => { signal.data = 'the payload after all'; }, TypeError);
  assert.throws(() => { signal.refetch.id = 'somewhere-else'; }, TypeError);
});

// --- the signature -------------------------------------------------------------------------------

test('a tampered body fails — including the tamper that actually matters', () => {
  const original = JSON.stringify(event());
  const sig = signBody(original, SECRET);

  // Redirect the refetch at a page the attacker controls, keeping the captured signature.
  const redirected = JSON.stringify(event({ entity: { id: 'page-attacker-owned', type: 'page' } }));
  const r = deliver(redirected, { signature: sig });
  assert.equal(r.signal, null);
  assert.deepEqual(codes(r), ['WH-R08']);
  assert.doesNotMatch(r.findings[0], /page-attacker-owned/, 'a refusal must not echo the unauthenticated body back');

  // One byte, anywhere. The MAC covers the whole document, not the fields we happen to read.
  const flipped = `${original.slice(0, 40)}${original[40] === 'x' ? 'y' : 'x'}${original.slice(41)}`;
  assert.deepEqual(codes(deliver(flipped, { signature: sig })), ['WH-R08']);
});

test('a wrong secret fails, and is not distinguishable from a tampered body', () => {
  const wrongSecret = deliver(event(), { secret: OTHER });
  assert.equal(wrongSecret.signal, null);
  assert.deepEqual(codes(wrongSecret), ['WH-R08']);

  const tampered = deliver(JSON.stringify(event({ id: 'evt-9999' })), { signature: signBody(JSON.stringify(event()), SECRET) });
  // Same code, same sentence: an endpoint that told them apart would answer "your key is right,
  // your payload is wrong" to anyone who asked.
  assert.equal(wrongSecret.findings[0], tampered.findings[0]);
});

// The ordering test. Delete the "verify before parse" discipline and the second assertion flips to
// WH-R09 — meaning a JSON parser ran over a stranger's bytes before anything authenticated them.
test('the signature is checked BEFORE the body is parsed', () => {
  const garbage = '{"id": "evt-1", this is not json';
  const signed = deliver(garbage);
  assert.deepEqual(codes(signed), ['WH-R09'], 'authentic bytes that are not JSON are a parse finding');

  const unsigned = deliver(garbage, { signature: `${'sha256='}${'0'.repeat(64)}` });
  assert.deepEqual(codes(unsigned), ['WH-R08'], 'unauthenticated bytes must never reach the parser');
});

test('a missing signature header fails, and names the unsigned handshake', () => {
  const r = verifyWebhook(JSON.stringify(event()), {}, { secret: SECRET, now: NOW, seen: new Map() });
  assert.equal(r.signal, null);
  assert.deepEqual(codes(r), ['WH-R06']);
  // The first request an adopter ever sees fail is the handshake. The message must not send them
  // hunting for a signing bug that does not exist.
  assert.match(r.findings[0], /verification_token/);
  assert.match(r.findings[0], /unsigned by design/);
});

test('a malformed signature is a format finding, never a crash', () => {
  // `timingSafeEqual` throws RangeError on unequal lengths and `Buffer.from(hex, "hex")` silently
  // truncates at the first non-hex character. A verifier that handed either of those straight to
  // the comparison would die on the first probe — which is a denial of service anyone can trigger.
  const bad = [
    ['too short', 'sha256=abcd'],
    ['too long', `sha256=${'a'.repeat(65)}`],
    ['not hex', `sha256=${'z'.repeat(64)}`],
    ['half hex', `sha256=${'a'.repeat(60)}zzzz`],
    ['no prefix', 'a'.repeat(64)],
    ['another algorithm', `md5=${'a'.repeat(64)}`],
    ['empty', ''],
    ['whitespace padded', ` sha256=${'a'.repeat(64)}`],
  ];
  for (const [why, signature] of bad) {
    const r = deliver(event(), { signature });
    assert.equal(r.signal, null, why);
    assert.deepEqual(codes(r), ['WH-R07'], `${why}: ${r.findings[0]}`);
    assert.doesNotMatch(r.findings[0], /RangeError|Assertion/, why);
  }
});

test('a repeated signature header cannot smuggle a valid value beside an invalid one', () => {
  const good = signBody(JSON.stringify(event()), SECRET);
  const junk = `sha256=${'0'.repeat(64)}`;
  // Node collapses a duplicated header into an array (or a comma-joined string). Picking "the one
  // that verifies" would mean an attacker who can append a header wins with any captured value.
  for (const value of [[junk, good], [good, junk], `${junk}, ${good}`]) {
    const r = deliver(event(), { headers: { 'x-notion-signature': value } });
    assert.equal(r.signal, null, JSON.stringify(value));
    assert.deepEqual(codes(r), ['WH-R07'], JSON.stringify(value));
  }
});

test('hex case is not part of the secret — an upper-case signature still verifies', () => {
  const sig = signBody(JSON.stringify(event()), SECRET);
  const upper = `sha256=${sig.slice(7).toUpperCase()}`;
  assert.ok(deliver(event(), { signature: upper }).signal);
});

test('rotation: either live token verifies, and a retired one does not', () => {
  // A verifier that held one token would turn every key change into an outage, which is how
  // rotations stop happening — so the overlap has to be expressible.
  for (const signer of [SECRET, OTHER]) {
    const r = verifyWebhook(JSON.stringify(event()), { 'X-Notion-Signature': signBody(JSON.stringify(event()), signer) }, {
      secret: [SECRET, OTHER], now: NOW, seen: new Map(),
    });
    assert.ok(r.signal, `${signer} should verify while both are live`);
  }
  // Rotation finished: the retired token no longer opens the door.
  const retired = verifyWebhook(JSON.stringify(event()), { 'X-Notion-Signature': signBody(JSON.stringify(event()), OTHER) }, {
    secret: [SECRET], now: NOW, seen: new Map(),
  });
  assert.deepEqual(codes(retired), ['WH-R08']);
});

// --- the raw-bytes rule --------------------------------------------------------------------------

test('a parsed object is refused — it cannot be re-serialised back to the bytes that were signed', () => {
  const body = event();
  const r = deliver(body, { rawBody: body });
  assert.equal(r.signal, null);
  assert.deepEqual(codes(r), ['WH-R04']);
  assert.match(r.findings[0], /whitespace, key order and escaping|raw body/);
});

test('re-serialising really does change the bytes — which is why the rule exists', () => {
  // Not a test of the module so much as a test of the premise the module rests on. If a round trip
  // were byte-stable, "verify over the raw bytes" would be pedantry rather than a requirement.
  for (const raw of ['{\n  "id": "evt-1"\n}', '{"n": 1e3}', '{"s": "\\u0041"}']) {
    assert.notEqual(JSON.stringify(JSON.parse(raw)), raw, raw);
    assert.notEqual(signBody(JSON.stringify(JSON.parse(raw)), SECRET), signBody(raw, SECRET), raw);
  }
  // …and a pretty-printed delivery, signed as received, verifies exactly as it should.
  const pretty = JSON.stringify(event(), null, 2);
  assert.ok(deliver(pretty).signal, 'a whitespace-formatted body must verify when signed as received');
});

test('a Buffer, a Uint8Array and the string they decode to are the same delivery', () => {
  const raw = JSON.stringify(event());
  const sig = signBody(raw, SECRET);
  for (const form of [raw, Buffer.from(raw, 'utf8'), new Uint8Array(Buffer.from(raw, 'utf8'))]) {
    const r = verifyWebhook(form, { 'X-Notion-Signature': sig }, { secret: SECRET, now: NOW, seen: new Map() });
    assert.ok(r.signal, form?.constructor?.name);
  }
});

test('an empty body and an oversized body are both refused', () => {
  assert.deepEqual(codes(deliver('')), ['WH-R04']);

  const fat = JSON.stringify(event({ data: { pad: 'x'.repeat(MAX_BODY_BYTES) } }));
  const over = deliver(fat);
  assert.deepEqual(codes(over), ['WH-R05']);
  // The NEGATIVE: it is the cap refusing, not the content. Raise the cap and the same bytes pass —
  // so the cap is a bound on unauthenticated work, not an accidental content filter.
  assert.ok(deliver(fat, { maxBytes: MAX_BODY_BYTES * 4 }).signal);
});

// --- replay: the acceptance criterion ------------------------------------------------------------

test('a replayed webhook is a no-op', () => {
  const seen = new Map();
  const raw = JSON.stringify(event());
  const sig = signBody(raw, SECRET);
  const send = () => verifyWebhook(raw, { 'X-Notion-Signature': sig }, { secret: SECRET, now: NOW, seen });

  const first = send();
  assert.ok(first.signal, 'the first delivery is acted on');

  const second = send();
  // Delete the dedupe and `second.signal` becomes a second, identical instruction to act — a
  // duplicate PR, a duplicate transcription, a decision counted twice.
  assert.equal(second.signal, null);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.findings, [], 'a retry is expected traffic, not a fault — 4xx here would switch the feed off');
  assert.match(second.note, /^WH-R18:/);
});

test('deduplication is on the event id, not on the bytes — a retry re-signs a changed body', () => {
  const seen = new Map();
  const ctx = { secret: SECRET, now: NOW, seen };
  const first = JSON.stringify(event({ attempt_number: 1 }));
  const retry = JSON.stringify(event({ attempt_number: 2 })); // same id, different bytes, valid signature
  assert.notEqual(first, retry);

  assert.ok(verifyWebhook(first, { 'X-Notion-Signature': signBody(first, SECRET) }, ctx).signal);
  const r = verifyWebhook(retry, { 'X-Notion-Signature': signBody(retry, SECRET) }, ctx);
  // A digest-keyed dedupe would let this through: the bytes are genuinely new and genuinely signed.
  assert.equal(r.signal, null);
  assert.equal(r.duplicate, true);
});

test('a distinct event about the same entity is NOT a duplicate', () => {
  const seen = new Map();
  const ctx = { secret: SECRET, now: NOW, seen };
  for (const id of ['evt-1', 'evt-2']) {
    const raw = JSON.stringify(event({ id }));
    assert.ok(verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, SECRET) }, ctx).signal, id);
  }
});

// A forged delivery must not be able to consume an id it does not own. This is the denial primitive
// that appears the moment the seen-set is written before verification instead of after.
test('an unverified delivery never enters the seen set', () => {
  const seen = new Map();
  const raw = JSON.stringify(event());

  for (const spoiler of [
    { signature: `sha256=${'0'.repeat(64)}` },              // bad signature
    { signature: 'sha256=nope' },                            // malformed header
    { body: JSON.stringify(event({ authors: [{ id: 'bot-1', type: 'bot' }] })) }, // refused shape
    { body: JSON.stringify(event({ timestamp: '2020-01-01T00:00:00.000Z' })) },   // stale
  ]) {
    const b = spoiler.body ?? raw;
    verifyWebhook(b, { 'X-Notion-Signature': spoiler.signature ?? signBody(b, SECRET) }, { secret: SECRET, now: NOW, seen });
  }
  assert.equal(seen.size, 0, 'nothing that failed may claim the id');

  const genuine = verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, SECRET) }, { secret: SECRET, now: NOW, seen });
  assert.ok(genuine.signal, 'the real delivery must still be acted on after the forgeries');
});

// --- freshness -----------------------------------------------------------------------------------

test('an expired event is refused — the window catches what a forgotten id no longer does', () => {
  const raw = JSON.stringify(event()); // stamped 30s before NOW
  const sig = signBody(raw, SECRET);
  // A fresh Map is exactly what a process restart or an over-eager prune leaves behind: dedupe has
  // no memory here, so the timestamp is the only thing standing between a captured delivery and a
  // second execution.
  const later = verifyWebhook(raw, { 'X-Notion-Signature': sig }, {
    secret: SECRET, now: NOW + REPLAY_WINDOW_MS + 1000, seen: new Map(),
  });
  assert.equal(later.signal, null);
  assert.deepEqual(codes(later), ['WH-R15']);
  // The NEGATIVE: the identical bytes and signature are accepted inside the window, so it is the
  // age being refused and not something wrong with the capture.
  assert.ok(verifyWebhook(raw, { 'X-Notion-Signature': sig }, { secret: SECRET, now: NOW, seen: new Map() }).signal);
});

test('a far-future event is refused, and ordinary skew is not', () => {
  const ahead = (ms) => deliver(event({ timestamp: new Date(NOW + ms).toISOString() }));
  assert.deepEqual(codes(ahead(CLOCK_SKEW_MS + 60_000)), ['WH-R16']);
  // Without a future bound, a forward-dated stamp buys a delivery that never ages out of the window.
  assert.ok(ahead(Math.floor(CLOCK_SKEW_MS / 2)).signal, 'a clock a little ahead is normal, not hostile');
});

test('a timestamp of the wrong type is a finding, not a reading', () => {
  // `Date.parse` coerces: `0` becomes the year 2000 (always stale), `true` becomes NaN (which a
  // `!== null`-guarded check would skip entirely — always fresh). Both are conclusions nobody drew.
  for (const timestamp of [0, true, null, undefined, 20260726, { at: 'now' }, 'yesterday afternoon']) {
    const r = deliver(event({ timestamp }));
    assert.equal(r.signal, null, JSON.stringify(timestamp));
    assert.deepEqual(codes(r), ['WH-R14'], `${JSON.stringify(timestamp)}: ${r.findings[0]}`);
  }
});

// --- shape: authentic, and still not usable ------------------------------------------------------

test('valid JSON that is not the expected shape is refused, with a correct signature throughout', () => {
  const cases = [
    ['no event id', event({ id: undefined }), 'WH-R10'],
    ['blank event id', event({ id: '   ' }), 'WH-R10'],
    ['no event type', event({ type: undefined }), 'WH-R11'],
    ['no entity', event({ entity: undefined }), 'WH-R12'],
    ['entity without a type', event({ entity: { id: 'page-1' } }), 'WH-R12'],
    ['entity without an id', event({ entity: { type: 'page' } }), 'WH-R12'],
  ];
  for (const [why, body, code] of cases) {
    const r = deliver(body);
    assert.equal(r.signal, null, why);
    assert.ok(codes(r).includes(code), `${why}: ${r.findings.join(' | ')}`);
  }
  // Authentic JSON that is not an object at all.
  for (const raw of ['null', '42', '"a string"', '[]', '[{"id":"evt-1"}]']) {
    const r = deliver(raw);
    assert.equal(r.signal, null, raw);
    assert.deepEqual(codes(r), ['WH-R09'], raw);
  }
});

test('an event from another workspace or subscription is refused when the endpoint is pinned', () => {
  assert.deepEqual(codes(deliver(event(), { expectWorkspace: 'ws-somewhere-else' })), ['WH-R13']);
  assert.deepEqual(codes(deliver(event(), { expectSubscription: 'sub-somewhere-else' })), ['WH-R13']);
  assert.ok(deliver(event(), { expectWorkspace: 'ws-meridian', expectSubscription: 'sub-floor-bridge' }).signal);
  // Unpinned is the default and stays permissive — the pin is defence in depth over the token, and
  // making it mandatory would break every adopter who has one subscription and no reason to name it.
  assert.ok(deliver(event()).signal);
});

test('a bot or agent author is refused; a person author is still not an approval', () => {
  for (const type of ['bot', 'agent']) {
    const r = deliver(event({ authors: [{ id: `${type}-1`, type }] }));
    assert.equal(r.signal, null, type);
    assert.deepEqual(codes(r), ['WH-R17'], type);
  }
  // Mixed: one machine among humans is still a machine in the room.
  assert.deepEqual(codes(deliver(event({ authors: [{ id: 'p', type: 'person' }, { id: 'a', type: 'agent' }] }))), ['WH-R17']);

  // A `person` author passes the refusal — and is then thrown away. The signal must not carry it,
  // because "the workspace says a person did it" is a claim by the workspace, and validity comes
  // only from a subject-bound assertion the bridge cannot mint (TB-0).
  const ok = deliver(event({ authors: [{ id: 'person-lena', type: 'person' }] }));
  assert.ok(ok.signal);
  assert.doesNotMatch(JSON.stringify(ok.signal), /person-lena/);

  // Absent authors are deliberately NOT a finding: demanding them here would imply this module can
  // answer "who acted", and it cannot.
  assert.ok(deliver(event({ authors: undefined })).signal);
});

// --- configuration must be demanded, never defaulted ---------------------------------------------

test('an unconfigured verifier refuses traffic instead of waving it through', () => {
  const raw = JSON.stringify(event());
  const headers = { 'X-Notion-Signature': signBody(raw, SECRET) };

  for (const [why, ctx, code] of [
    ['no secret', { now: NOW, seen: new Map() }, 'WH-R01'],
    ['empty secret', { secret: '', now: NOW, seen: new Map() }, 'WH-R01'],
    ['ADOPT: placeholder', { secret: 'ADOPT: your subscription verification token', now: NOW, seen: new Map() }, 'WH-R01'],
    ['no clock', { secret: SECRET, seen: new Map() }, 'WH-R02'],
    ['NaN clock', { secret: SECRET, now: Number.NaN, seen: new Map() }, 'WH-R02'],
    ['no seen set', { secret: SECRET, now: NOW }, 'WH-R03'],
    ['a plain object for seen', { secret: SECRET, now: NOW, seen: {} }, 'WH-R03'],
  ]) {
    const r = verifyWebhook(raw, headers, ctx);
    // Each of these, defaulted rather than demanded, silently disables a control: everything
    // authenticates · the window belongs to whichever machine ran · nothing deduplicates.
    assert.equal(r.signal, null, why);
    assert.deepEqual(codes(r), [code], `${why}: ${r.findings[0]}`);
  }
});

test('a placeholder secret is not a secret, even when the delivery is signed with it', () => {
  const placeholder = 'ADOPT: your subscription verification token';
  const raw = JSON.stringify(event());
  const r = verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, placeholder) }, {
    secret: placeholder, now: NOW, seen: new Map(),
  });
  // Worse than absent: an unwired endpoint would otherwise authenticate its own test traffic and
  // read as configured.
  assert.deepEqual(codes(r), ['WH-R01']);
});

// --- ordering is not assumed; it is made irrelevant ----------------------------------------------

test('out-of-order deliveries about one entity collapse to one refetch, whatever the order', () => {
  const seen = new Map();
  const ctx = { secret: SECRET, now: NOW, seen };
  const signals = ['evt-a', 'evt-b', 'evt-c'].map((id) => {
    const raw = JSON.stringify(event({ id }));
    return verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, SECRET) }, ctx).signal;
  });
  assert.equal(signals.filter(Boolean).length, 3);

  const forward = coalesceByEntity(signals);
  const backward = coalesceByEntity([...signals].reverse());
  assert.equal(forward.length, 1, 'three signals about one page are one page to read');
  assert.deepEqual(forward, backward, 'the plan must not depend on the order deliveries landed in');
  assert.deepEqual(forward[0], { kind: 'page', id: 'page-d6-feasibility', events: ['evt-a', 'evt-b', 'evt-c'] });
  // No payload survives coalescing either — there is nothing to merge, which is the point.
  assert.deepEqual(Object.keys(forward[0]).sort(), ['events', 'id', 'kind']);
});

test('coalescing is deterministic across entities and kinds', () => {
  const s = (id, kind, eid) => ({ event_id: eid, refetch: { kind, id } });
  const plan = coalesceByEntity([s('page-b', 'page', 'e3'), s('page-a', 'page', 'e1'), s('page-a', 'block', 'e2')]);
  assert.deepEqual(plan.map((t) => `${t.kind} ${t.id}`), ['block page-a', 'page page-a', 'page page-b']);
  // A block event and a page event are different reads; collapsing them on id alone drops one.
  assert.equal(plan.length, 3);
  assert.deepEqual(coalesceByEntity([]), []);
  assert.deepEqual(coalesceByEntity(null), []);
  assert.deepEqual(coalesceByEntity([{}, { refetch: {} }]), [], 'a malformed signal contributes nothing');
});

// --- pruning: the same defence from the other side -----------------------------------------------

test('pruning never forgets an id while a replay of it would still be fresh', () => {
  const seen = new Map([['evt-0001', NOW]]);
  // Exactly at the replay window: still remembered, because a replay stamped at NOW would still be
  // inside the window and the id is the only thing refusing it.
  assert.equal(pruneSeen(seen, NOW + REPLAY_WINDOW_MS), 0);
  assert.equal(seen.size, 1);

  // Past the window plus the skew allowance: safe to forget, because the stamp now refuses it.
  assert.equal(pruneSeen(seen, NOW + REPLAY_WINDOW_MS + CLOCK_SKEW_MS + 1), 1);
  assert.equal(seen.size, 0);

  const raw = JSON.stringify(event());
  const replayed = verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, SECRET) }, {
    secret: SECRET, now: NOW + REPLAY_WINDOW_MS + CLOCK_SKEW_MS + 1, seen,
  });
  // The handover is seamless: the id is gone and the timestamp takes over. No instant exists in
  // which neither defence is holding.
  assert.equal(replayed.signal, null);
  assert.deepEqual(codes(replayed), ['WH-R15']);
});

// The skew allowance is in the horizon for the same reason it is in the freshness check, and this
// is the delivery that proves it: stamped as far AHEAD of our clock as we tolerate, so its stamp
// stays fresh for `window + skew` after we received it. Drop `clockSkewMs` from the horizon and
// there is a `skew`-wide corridor in which the id has been forgotten and the stamp still passes.
test('an event stamped at the edge of skew is remembered for as long as its stamp stays fresh', () => {
  const seen = new Map();
  const raw = JSON.stringify(event({ timestamp: new Date(NOW + CLOCK_SKEW_MS).toISOString() }));
  const headers = { 'X-Notion-Signature': signBody(raw, SECRET) };
  assert.ok(verifyWebhook(raw, headers, { secret: SECRET, now: NOW, seen }).signal);

  // One millisecond past the bare window: still inside the corridor, so the id must survive.
  const t = NOW + REPLAY_WINDOW_MS + 1;
  assert.equal(pruneSeen(seen, t), 0, 'forgetting here re-opens replay for the whole skew allowance');

  const replayed = verifyWebhook(raw, headers, { secret: SECRET, now: t, seen });
  assert.equal(replayed.signal, null, 'the replay must be caught by the id it was pruned too early to lose');
  assert.equal(replayed.duplicate, true);
});

// Documented as a hazard rather than asserted as safety, because it is the one coupling this module
// cannot enforce: prune and verify are separate calls, and nothing stops a caller passing different
// windows to each. Written down as an executable demonstration so nobody has to discover it live.
test('HAZARD — pruning with a narrower window than the verifier re-opens replay', () => {
  const seen = new Map([['evt-0001', NOW]]);
  assert.equal(pruneSeen(seen, NOW + 100, { replayWindowMs: 1, clockSkewMs: 0 }), 1);

  const raw = JSON.stringify(event()); // stamp is still well inside the verifier's 5-minute window
  const r = verifyWebhook(raw, { 'X-Notion-Signature': signBody(raw, SECRET) }, { secret: SECRET, now: NOW + 100, seen });
  assert.ok(r.signal, 'the replay walks through: the id was forgotten while the stamp was still fresh');
  // The rule this pins: pruneSeen must be called with the SAME window verifyWebhook uses.
});

test('pruneSeen is inert on nonsense rather than destructive', () => {
  assert.equal(pruneSeen(null, NOW), 0);
  assert.equal(pruneSeen(new Map(), Number.NaN), 0);
  const seen = new Map([['a', 'not a number'], ['b', NOW - 10 * REPLAY_WINDOW_MS]]);
  assert.equal(pruneSeen(seen, NOW), 1);
  assert.deepEqual([...seen.keys()], ['a'], 'an entry that cannot be shown to be old is not old');
});

// --- the small pieces ----------------------------------------------------------------------------

test('headerValue reads case-insensitively, from an object or a Headers', () => {
  assert.equal(headerValue({ 'X-Notion-Signature': 'v' }, SIGNATURE_HEADER), 'v');
  assert.equal(headerValue({ 'x-notion-signature': 'v' }, SIGNATURE_HEADER), 'v');
  assert.equal(headerValue(new Headers({ 'X-Notion-Signature': 'v' }), SIGNATURE_HEADER), 'v');
  assert.equal(headerValue({}, SIGNATURE_HEADER), null);
  assert.equal(headerValue(null, SIGNATURE_HEADER), null);
  assert.equal(headerValue({ 'x-notion-signature': 42 }, SIGNATURE_HEADER), null);
});

test('signBody refuses anything that is not the bytes', () => {
  assert.throws(() => signBody({ id: 'evt-1' }, SECRET), /raw body bytes/);
  assert.throws(() => signBody('{}', ''), /verification token/);
  assert.match(signBody('{}', SECRET), /^sha256=[0-9a-f]{64}$/);
  // The same bytes and key always give the same header — an adopter can diff ours against theirs.
  assert.equal(signBody('{}', SECRET), signBody(Buffer.from('{}'), SECRET));
});

test('verifySignature is usable on its own, and fails closed on every missing input', () => {
  const raw = JSON.stringify(event());
  assert.deepEqual(verifySignature(raw, signBody(raw, SECRET), SECRET), []);
  assert.match(verifySignature(raw, signBody(raw, SECRET), null)[0], /^WH-R01/);
  assert.match(verifySignature({ parsed: true }, 'sha256=x', SECRET)[0], /^WH-R04/);
  assert.match(verifySignature(raw, null, SECRET)[0], /^WH-R06/);
  assert.match(verifySignature(raw, signBody(raw, OTHER), SECRET)[0], /^WH-R08/);
});

// --- the contract is documented, and the documentation is checked --------------------------------

test('every rejection code the module can emit is documented, and every documented code is reachable', () => {
  const source = readFileSync(new URL('./floor-webhook.mjs', import.meta.url), 'utf8');
  const used = new Set(source.match(/WH-R\d+/g) || []);
  for (const code of used) {
    assert.ok(REJECTIONS.has(code), `${code} is emitted but not documented in REJECTIONS`);
  }
  for (const code of REJECTIONS.keys()) {
    // A code appearing exactly once appears only in the table — declared, never emitted, and a
    // reader would take it for a control that exists.
    const occurrences = (source.match(new RegExp(code, 'g')) || []).length;
    assert.ok(occurrences >= 2, `${code} is documented but never emitted (${occurrences} occurrence)`);
    assert.ok(REJECTIONS.get(code).length > 20, `${code} needs a reason, not a label`);
  }
  assert.equal(used.size, REJECTIONS.size);
});

test('the bounds are real values, not decoration', () => {
  for (const [name, v] of [['REPLAY_WINDOW_MS', REPLAY_WINDOW_MS], ['CLOCK_SKEW_MS', CLOCK_SKEW_MS], ['MAX_BODY_BYTES', MAX_BODY_BYTES]]) {
    assert.ok(Number.isFinite(v) && v > 0, name);
  }
  assert.ok(REPLAY_WINDOW_MS > CLOCK_SKEW_MS, 'a skew allowance wider than the window would swallow it');
});
