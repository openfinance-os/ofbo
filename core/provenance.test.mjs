// Tests for the provenance rules PR1–PR6 (2.1.0, plan row 2.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { FUTURE_SKEW_MS, KINDS, NARRATABLE, SCHEMA_ID, buildEnvelope, canonicalEnvelopePayload, evaluateProvenance, payloadDigest, signEnvelope, verifyEnvelope } from './provenance.mjs';

const keys = generateKeyPairSync('ed25519');
const pem = (k, type) => k.export({ type, format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'ci-runner', mechanism: 'ed25519', verify: { public_key: pem(keys.publicKey, 'spki') } }] };
const PRIV = pem(keys.privateKey, 'pkcs8');
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const REGISTRY = { identities: [
  { id: 'agent-loom-delivery', kind: 'agent', model: { provider: 'p', model_id: 'm@1', prompt_version: 'v1' }, harness_role: 'delivery-loop' },
  { id: 'agent-no-model', kind: 'agent' },
  { id: 'dev-ali', kind: 'human' },
  { id: 'po-sara', kind: 'human', roles: ['product-owner'] },
] };
const RUNNER = { subject: 'repo:acme/x:ref:refs/heads/main', repository: 'acme/x', ref: 'refs/heads/main', sha: COMMIT };
const NOW = Date.parse('2026-09-13T12:00:00Z');

const gate = (over = {}) => buildEnvelope({
  kind: 'gate', name: 'gate.evidence-seal-check', subject: { flow: 'delivery', trail: 'CHG-2026-0042' }, commit: COMMIT,
  actor: { id: 'agent-loom-delivery', kind: 'agent' }, runner: RUNNER, producedAt: '2026-09-13T11:59:00Z',
  payload: { gate: 'scripts/evidence-seal-check.mjs', result: 'pass', controls: ['HG-0003'] }, ...over,
});
const signed = (env) => signEnvelope(env, { issuer: 'ci-runner', privateKeyPem: PRIV, issuedAt: '2026-09-13T11:59:30Z' });
const ev = (env, o = {}) => evaluateProvenance(env, { registry: REGISTRY, issuers: ISSUERS, now: NOW, ...o });

test('a signed, tool-produced gate record with a runner passes every rule', () => {
  assert.deepEqual(ev(signed(gate())), []);
});

test('the envelope is deterministic and its digest covers everything but the signature', () => {
  const a = gate(), b = gate();
  assert.equal(canonicalEnvelopePayload(a), canonicalEnvelopePayload(b));
  assert.equal(a.schema, SCHEMA_ID);
  assert.equal(payloadDigest(a), a.payload_digest);
  const s = signed(a);
  assert.equal(canonicalEnvelopePayload({ ...s, record: { status: 'recorded', id: 'x' } }), canonicalEnvelopePayload(s), 'the post result is outside the signed bytes');
});

test('unsigned is refused as evidence; a shape check on a draft is possible and says nothing about evidence', () => {
  assert.ok(ev(gate()).some((f) => /unsigned/.test(f)));
  assert.deepEqual(ev(gate(), { requireSignature: false }), []);
});

test('any signed field moved breaks verification (property over the fields)', () => {
  const s = signed(gate());
  for (const mutate of [
    (e) => { e.payload.result = 'fail'; }, (e) => { e.commit = 'b'.repeat(40); e.runner = { ...e.runner, sha: e.commit }; },
    (e) => { e.actor = { id: 'dev-ali', kind: 'human' }; }, (e) => { e.compliant = false; }, (e) => { e.name = 'gate.other'; },
  ]) {
    const m = JSON.parse(JSON.stringify(s)); mutate(m);
    assert.ok(verifyEnvelope(m, ISSUERS).length > 0, 'mutation must break the signature');
  }
  assert.deepEqual(verifyEnvelope(JSON.parse(JSON.stringify(s)), ISSUERS), [], 'a JSON round trip still verifies');
});

test('PR1: a gate record must name its mechanism, a runner result and controls, and originate from a tool', () => {
  assert.ok(ev(signed(gate({ payload: { result: 'pass', controls: ['X'] } }))).some((f) => /PR1: gate record names no mechanism/.test(f)));
  assert.ok(ev(signed(gate({ payload: { gate: 'scripts/x.mjs', result: 'PASSED', controls: ['X'] } }))).some((f) => /PR1: gate record result "PASSED"/.test(f)));
  assert.ok(ev(signed(gate({ payload: { gate: 'scripts/x.mjs', result: 'pass', controls: [] } }))).some((f) => /PR1: gate record names no controls/.test(f)));
  assert.ok(ev(signed(gate({ origin: 'narrated' }))).some((f) => /PR1: gate record origin is "narrated"/.test(f)));
});

test('PR2: a review or acceptance by an author of the thing is one party asserting twice', () => {
  const review = (actor, authors) => signed(gate({ kind: 'review', name: 'review.hard-stop', origin: 'tool', actor, payload: { verdict: 'PASS', authors } }));
  assert.ok(ev(review({ id: 'dev-ali', kind: 'human' }, ['Dev-Ali'])).some((f) => /^PR2: .*reviewer and the author are the same identity/.test(f)));
  assert.deepEqual(ev(review({ id: 'po-sara', kind: 'human' }, ['dev-ali'])), []);
  assert.ok(ev(review({ id: 'po-sara', kind: 'human' }, [])).some((f) => /PR2: review record lists no authors/.test(f)));
});

test('PR3: narration is allowed for the left-diamond kinds and nothing else', () => {
  for (const k of KINDS) {
    const e = signed(gate({ kind: k, name: `${k}.x`, origin: 'narrated', payload: { gate: 'scripts/x.mjs', result: 'pass', controls: ['X'], authors: ['dev-ali'] }, actor: { id: 'po-sara', kind: 'human' } }));
    const hit = ev(e).some((f) => /^PR3:/.test(f));
    assert.equal(hit, !NARRATABLE.has(k), `kind ${k}`);
  }
});

test('PR4: acceptance is a human act — an agent acceptor, even a well-pinned one, is refused', () => {
  const acc = (actor) => signed(gate({ kind: 'accepted', name: 'accepted.pa2', origin: 'human', actor, payload: { authors: ['dev-ali'] } }));
  assert.ok(ev(acc({ id: 'agent-loom-delivery', kind: 'agent' })).some((f) => /^PR4: .*is an agent/.test(f)));
  assert.deepEqual(ev(acc({ id: 'po-sara', kind: 'human' })), []);
});

test('PR5: an unparseable, future, or signature-predated timestamp is refused', () => {
  assert.ok(ev(signed(gate({ producedAt: 'yesterday' }))).some((f) => /^PR5: produced_at "yesterday"/.test(f)));
  assert.ok(ev(signed(gate({ producedAt: new Date(NOW + FUTURE_SKEW_MS + 1000).toISOString() }))).some((f) => /^PR5: .*in the future/.test(f)));
  const early = signEnvelope(gate(), { issuer: 'ci-runner', privateKeyPem: PRIV, issuedAt: '2026-09-13T10:00:00Z' });
  assert.ok(ev(early).some((f) => /^PR5: the signature .*predates the record/.test(f)));
});

test('PR6: no runner, a partial runner, or a runner on another commit is refused', () => {
  assert.ok(ev(signed(gate({ runner: null }))).some((f) => /^PR6: record envelope carries no runner/.test(f)));
  assert.ok(ev(signed(gate({ runner: { subject: 's', repository: 'r' } }))).some((f) => /^PR6: runner identity has no ref/.test(f)));
  assert.ok(ev(signed(gate({ runner: { ...RUNNER, sha: 'c'.repeat(40) } }))).some((f) => /^PR6: runner sha .*is not the attested commit/.test(f)));
});

test('the actor must resolve, and an agent actor must carry a model pin (K4)', () => {
  assert.ok(ev(signed(gate({ actor: { id: 'nobody', kind: 'agent' } }))).some((f) => /does not resolve in the identity registry/.test(f)));
  assert.ok(ev(signed(gate({ actor: { id: 'agent-no-model', kind: 'agent' } }))).some((f) => /agent with no model pin/.test(f)));
  assert.ok(ev(signed(gate({ actor: null }))).some((f) => /names no actor/.test(f)));
});

test('shape: schema, kind, subject and a 40-hex commit are all required', () => {
  const f = ev(signed({ ...gate(), schema: 'x', kind: 'nope', subject: {}, commit: 'HEAD' }));
  assert.ok(f.some((x) => /schema is "x"/.test(x)));
  assert.ok(f.some((x) => /kind "nope"/.test(x)));
  assert.ok(f.some((x) => /subject must name a flow and a trail/.test(x)));
  assert.ok(f.some((x) => /commit "HEAD" is not a 40-hex sha/.test(x)));
});
