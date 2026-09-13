// Tests for MI over sealed evidence (Factory Floor WS6 · D6.2). Node built-in runner.
//
// One failure mode dominates this module and most of the tests below are written against it: a
// dashboard that looks current while reporting three-week-old evidence. It is not a malicious
// failure — it is what happens by default, because the page renders now and the evidence was sealed
// then, and nothing in between insists on saying so. So every negative here is the version of the
// summary that would pass if the corresponding control were absent: a payload that lost its digest,
// a `state: "current"` typed over an old timestamp, a green tile above a broken chain, a statement
// nobody in this vocabulary is allowed to make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EVIDENCE_FLOOR, REQUIRED_TYPES, buildChain } from '../scripts/evidence-seal-check.mjs';
import {
  ASSERTIONS,
  NON_AUTHORITATIVE,
  REJECTIONS,
  SCHEMA_ID,
  STALE_AFTER_DAYS,
  WRITE_CLASS,
  chainResolvesTo,
  deriveMi,
  digestOf,
  freshnessOf,
  lastSealed,
  verifyFreshness,
  verifyMi,
  verifyTile,
} from './floor-mi.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUERS = { issuers: [{ id: 'anchor-signer', mechanism: 'ed25519', verify: { public_key: PEM } }] };
const PLATFORM_ISSUERS = { issuers: [{ id: 'anchor-signer', mechanism: 'sigstore' }] };

const COMMIT = '7e3f9c2a4b6d8e0f1a2c3b4d5e6f7a8b9c0d1e2f';
const SEALED_AT = '2026-07-20T10:00:00Z';
const NOW = Date.parse('2026-07-22T10:00:00Z');
const DAY = 86400000;

/** A sealed bundle that carries every required evidence type, chained for real and signed for real. */
function bundle({ types = REQUIRED_TYPES, commit = COMMIT, tamper = false, signWith = privateKey, issuer = 'anchor-signer' } = {}) {
  const entries = buildChain(types.map((type, i) => ({
    type,
    ref: `${type}.json`,
    sha256: String(i).repeat(64).slice(0, 64),
  })));
  const anchor = entries[entries.length - 1].seal;
  if (tamper) entries[1].sha256 = 'f'.repeat(64); // an artifact swapped after sealing
  const manifest = { release: 'v-test', release_commit: commit, anchor, entries };
  if (signWith) manifest.attestation = { issuer, signature: sign(null, Buffer.from(anchor), signWith).toString('base64') };
  return manifest;
}

const MANIFEST = bundle();
const derive = (over = {}, opts = {}) => deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT, issuers: ISSUERS, ...over }, { now: NOW, ...opts });
/** Re-digest after a hand edit, so a test isolates the control it is aiming at from MI-R09. */
const reseal = (s) => { const out = structuredClone(s); delete out.digest; out.digest = digestOf(out); return out; };
const has = (findings, re) => findings.some((f) => re.test(f));
const valueOf = (s, name) => s.assertions.find((a) => a.name === name).value;

// --- the summary it derives ------------------------------------------------------------------------

test('a sealed bundle produces a labelled summary that verifies against the bundle', () => {
  const { summary, findings, notices } = derive();
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
  assert.equal(summary.schema, SCHEMA_ID);
  assert.equal(summary.authority, 'none');
  assert.equal(summary.banner, NON_AUTHORITATIVE);
  assert.equal(summary.write_class, WRITE_CLASS);
  assert.equal(summary.chain.verdict, 'intact');
  assert.equal(valueOf(summary, 'evidence_sealed'), true);
  assert.equal(valueOf(summary, 'bound_to_commit'), true);
  assert.equal(valueOf(summary, 'evidence_floor_sealed'), true);
  assert.equal(valueOf(summary, 'anchor_externally_signed'), true);
  assert.deepEqual(verifyMi(summary, { manifest: MANIFEST, issuers: ISSUERS }), []);
  assert.deepEqual(verifyMi(summary), [], 'and it must stand up without the bundle beside it');
});

test('the sealed bundle\'s own digest and timestamp reach every tile, not just the page header', () => {
  const { summary } = derive();
  assert.equal(summary.evidence.digest, MANIFEST.anchor);
  assert.equal(summary.evidence.chain_resolves_to, chainResolvesTo(MANIFEST));
  assert.equal(summary.evidence.sealed_at, SEALED_AT);
  assert.equal(summary.tiles.length, ASSERTIONS.size + 1);
  for (const t of summary.tiles) {
    assert.equal(t.sealed_digest, MANIFEST.anchor, `${t.tile} lost the digest`);
    assert.equal(t.as_of, SEALED_AT, `${t.tile} lost the as-of date — a tile outlives the page it sat on`);
    assert.equal(t.authority, 'none');
    assert.equal(t.banner, NON_AUTHORITATIVE);
  }
});

test('the derivation is deterministic, and the module has no clock of its own', () => {
  assert.equal(derive().summary.digest, derive().summary.digest);
  assert.equal(derive().summary.digest, digestOf(derive().summary));
  const src = readFileSync(new URL('./floor-mi.mjs', import.meta.url), 'utf8');
  // The derivation, with the comments and the CLI epilogue removed: nothing in it may reach a clock.
  const code = src.split('if (process.argv[1]')[0].split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/Date\.now\s*\(/.test(code), 'no clock in the derivation');
  assert.ok(!/\bfetch\s*\(|node:https?/.test(src), 'no network');
  assert.match(deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT }, {}).findings[0], /^MI-R08/);
});

test('a repository that has sealed nothing gets SILENCE, not a green board and not a red one', () => {
  const { summary, findings, notices } = deriveMi({ manifest: null, sealedAt: SEALED_AT }, { now: NOW });
  assert.equal(summary, null);
  assert.deepEqual(findings, []);
  assert.ok(notices.some((n) => /SILENT rather than green/.test(n)));
});

test('the LAST sealed bundle is a derivation, and an undated bundle cannot be ordered', () => {
  const older = { manifest: MANIFEST, sealedAt: '2026-07-01T00:00:00Z' };
  const newer = { manifest: MANIFEST, sealedAt: SEALED_AT };
  assert.equal(lastSealed([older, newer]).bundle.sealedAt, SEALED_AT);
  assert.equal(lastSealed([newer, older]).bundle.sealedAt, SEALED_AT, 'input order must not decide it');
  assert.equal(lastSealed([]).bundle, null);
  const mixed = lastSealed([newer, { manifest: MANIFEST }]);
  assert.equal(mixed.bundle, null, 'never pick "the latest" out of a set containing an undated member');
  assert.ok(has(mixed.findings, /MI-R02.*no parseable sealed timestamp/));
});

// --- MI is never fresher than the evidence -----------------------------------------------------------

test('a stale sealed bundle produces a summary that SAYS it is stale, on the page and on every tile', () => {
  const { summary } = derive({}, { now: Date.parse(SEALED_AT) + 21 * DAY });
  assert.equal(summary.freshness.age_days, 21);
  assert.equal(summary.freshness.state, 'stale');
  assert.match(summary.freshness.headline, /^STALE — the last sealed evidence bundle is 21 day\(s\) old \(limit 7\)/);
  assert.match(summary.freshness.headline, /as of 2026-07-20T10:00:00Z, not as of now/);
  for (const t of summary.tiles) {
    assert.equal(t.stale, true, `${t.tile} does not carry the staleness`);
    assert.match(t.label, /STALE/, `${t.tile}'s own label must say it — the label is what a human reads`);
  }
  // The evidence has not changed, so the statements about it have not changed either. Staleness is
  // reported ALONGSIDE them; it does not silently turn a true statement false.
  assert.equal(valueOf(summary, 'evidence_sealed'), true);
  assert.deepEqual(verifyMi(summary, { manifest: MANIFEST, issuers: ISSUERS }), []);
});

test('the staleness bound is a real boundary and an adopter can move it', () => {
  const at = (days, opts) => deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: Date.parse(SEALED_AT) + days * DAY, ...opts }).summary.freshness;
  assert.equal(STALE_AFTER_DAYS, 7);
  assert.equal(at(7).state, 'current');
  assert.equal(at(8).state, 'stale');
  assert.equal(at(8, { staleAfterDays: 30 }).state, 'current', 'ADOPT: the bound is the release cadence, not a constant');
  assert.equal(at(31, { staleAfterDays: 30 }).state, 'stale');
});

// NEGATIVE — the confident green. This is the whole module in one test: without the recomputation,
// `state: "current"` is a string a renderer, a cache or a person can put over any timestamp at all.
test('a hand-edited "current" over old evidence is a finding, not a rendering choice', () => {
  const { summary } = derive({}, { now: Date.parse(SEALED_AT) + 21 * DAY });
  const lying = reseal({ ...summary, freshness: { ...summary.freshness, state: 'current', headline: 'All green.' } });
  const findings = verifyMi(lying);
  assert.ok(has(findings, /MI-R04.*state says "current" but 21 day\(s\)/));
  assert.ok(has(findings, /MI-R04.*headline does not name the age/));
  assert.ok(has(findings, /MI-R04.*does not say STALE/));

  const undercount = reseal({ ...summary, freshness: { ...summary.freshness, age_days: 1 } });
  assert.ok(has(verifyMi(undercount), /MI-R04.*age_days says 1 but the two instants give 21/),
    'the arithmetic is derived from two carried instants, not asserted');
});

// NEGATIVE — a page dated before the evidence it reports. The only way it happens is a clock
// somebody chose, and it is indistinguishable from a fresh page unless the two instants are ordered.
test('MI may not be dated before the bundle it reports', () => {
  const early = deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: Date.parse(SEALED_AT) - DAY });
  assert.equal(early.summary, null);
  assert.ok(has(early.findings, /MI-R04.*BEFORE the bundle was sealed/));

  const { summary } = derive();
  const forged = reseal({ ...summary, freshness: { ...summary.freshness, as_of: '2026-07-19T00:00:00Z' } });
  assert.ok(has(verifyMi(forged), /MI-R04.*precedes sealed_at/));
});

test('two dates on one page means neither is the date', () => {
  const { summary } = derive();
  const split = reseal({ ...summary, freshness: { ...summary.freshness, sealed_at: '2026-07-25T00:00:00Z' } });
  assert.ok(has(verifyMi(split), /MI-R02.*disagree/));
  assert.ok(has(verifyFreshness({ evidence: { sealed_at: SEALED_AT } }), /MI-R04.*no freshness block/));
  assert.ok(has(verifyFreshness({ evidence: { sealed_at: SEALED_AT }, freshness: { sealed_at: SEALED_AT, as_of: 'soon' } }), /MI-R04.*as_of is missing or not a parseable/));
  assert.ok(has(verifyFreshness({ evidence: { sealed_at: SEALED_AT }, freshness: { sealed_at: SEALED_AT, as_of: SEALED_AT, stale_after_days: 'a while' } }), /MI-R04.*not a number/));
});

// --- the digest and the timestamp are mandatory ------------------------------------------------------

// NEGATIVE — a summary that has lost the two things that make it traceable and datable. Both are
// easy to drop in a template and neither absence is visible on the rendered page.
test('a summary or a tile that has lost the sealed digest or timestamp is refused', () => {
  const { summary } = derive();
  const noDigest = reseal({ ...summary, evidence: { ...summary.evidence, digest: undefined } });
  assert.ok(has(verifyMi(noDigest), /MI-R01.*no sha256 sealed-bundle digest/));
  const noWhen = reseal({ ...summary, evidence: { ...summary.evidence, sealed_at: undefined } });
  assert.ok(has(verifyMi(noWhen), /MI-R02.*no parseable ISO-8601 sealed_at/));

  const ev = summary.evidence;
  assert.ok(has(verifyTile({ ...summary.tiles[0], sealed_digest: undefined }, ev, summary.freshness), /MI-R01.*no sha256 sealed_digest/));
  assert.ok(has(verifyTile({ ...summary.tiles[0], as_of: undefined }, ev, summary.freshness), /MI-R02.*no parseable ISO-8601 as_of/));
  assert.ok(has(verifyTile({ ...summary.tiles[0], as_of: '2026-07-26T00:00:00Z' }, ev, summary.freshness), /MI-R02.*may not be fresher than the evidence under it/));
  assert.ok(has(verifyMi(reseal({ ...summary, evidence: undefined })), /MI-R01.*no `evidence` block/));
  assert.ok(has(verifyMi(reseal({ ...summary, tiles: undefined })), /MI-R06.*no tiles array/));
});

test('a bundle with no external anchor, no timestamp or no entries derives nothing', () => {
  const { anchor: _dropped, ...unanchored } = MANIFEST;
  assert.ok(has(deriveMi({ manifest: unanchored, sealedAt: SEALED_AT }, { now: NOW }).findings, /MI-R01.*records no sha256 external anchor/));
  assert.ok(has(deriveMi({ manifest: MANIFEST }, { now: NOW }).findings, /MI-R02.*no parseable ISO-8601 `sealedAt`/));
  assert.ok(has(deriveMi({ manifest: { ...MANIFEST, entries: [] }, sealedAt: SEALED_AT }, { now: NOW }).findings, /MI-R01.*no `entries`/));
  assert.equal(deriveMi({ manifest: unanchored, sealedAt: SEALED_AT }, { now: NOW }).summary, null, 'no reduced form');
});

// NEGATIVE — a summary of a different bundle. Without the comparison it reads as a summary of this
// one, and the digest at the top is the only place the substitution would show.
test('a summary carrying a digest that is not the bundle\'s is refused', () => {
  const { summary } = derive();
  const swapped = reseal({ ...summary, evidence: { ...summary.evidence, digest: 'a'.repeat(64) } });
  assert.ok(has(verifyMi(swapped, { manifest: MANIFEST }), /MI-R03.*but the bundle records/));
  const invented = reseal({ ...summary, evidence: { ...summary.evidence, chain_resolves_to: 'b'.repeat(64) } });
  assert.ok(has(verifyMi(invented, { manifest: MANIFEST }), /MI-R03.*MI does not get to report its own arithmetic/));
  const tile = { ...summary.tiles[0], sealed_digest: 'c'.repeat(64) };
  assert.ok(has(verifyTile(tile, summary.evidence, summary.freshness), /MI-R03.*a tile from a different bundle on the same page/));
});

// --- it may only say what the bundle supports --------------------------------------------------------

test('a broken bundle is REPORTED, not refused — a blank page and a healthy page look alike', () => {
  const broken = bundle({ tamper: true });
  const { summary, notices } = deriveMi({ manifest: broken, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW });
  assert.ok(summary, 'MI still renders — the failure is reported, not hidden behind an error page');
  assert.equal(summary.chain.verdict, 'broken');
  assert.ok(summary.chain.findings.length > 0);
  assert.ok(notices.some((n) => /does NOT verify/.test(n)));
  for (const a of summary.assertions) assert.equal(a.value, false, `${a.name} must collapse when the chain does not resolve`);
  assert.deepEqual(verifyMi(summary, { manifest: broken, issuers: ISSUERS }), []);
});

// NEGATIVE — the softening. A red board is an unpopular board, and one edited boolean is all it
// takes; absent MI-R05 the page reads green over evidence that does not hash.
test('a statement reading true over a broken chain is refused', () => {
  const broken = bundle({ tamper: true });
  const { summary } = deriveMi({ manifest: broken, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW });
  const softened = reseal({
    ...summary,
    assertions: summary.assertions.map((a) => (a.name === 'evidence_sealed' ? { ...a, value: true } : a)),
  });
  assert.ok(has(verifyMi(softened), /MI-R05.*reads true while the chain reads broken/));
  assert.ok(has(verifyMi(softened, { manifest: broken, issuers: ISSUERS }), /MI-R05.*but the bundle supports false/));
});

// NEGATIVE — a green tile over evidence that is not in the bundle at all.
test('a statement reading true while resting on evidence the bundle does not carry is refused', () => {
  const { summary } = derive();
  const thin = reseal({ ...summary, evidence: { ...summary.evidence, types: summary.evidence.types.filter((t) => t !== 'tests') } });
  assert.ok(has(verifyMi(thin), /MI-R05.*rests on evidence type "tests", which the bundle does not carry/));
  // …and the derivation itself will not claim the floor over a bundle that lacks it.
  const partial = bundle({ types: ['reviews', 'control-plane'] });
  const { summary: s2 } = deriveMi({ manifest: partial, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW, requiredTypes: ['reviews', 'control-plane'] });
  assert.equal(valueOf(s2, 'evidence_floor_sealed'), false, `the floor is ${EVIDENCE_FLOOR.join(', ')} and tests is missing`);
  assert.deepEqual(verifyMi(s2), []);
});

// NEGATIVE — scope creep as a governance claim. "Controls effective" is one product review away,
// and a sealed evidence bundle cannot support it.
test('a statement outside the fixed vocabulary is refused', () => {
  const { summary } = derive();
  const creep = reseal({ ...summary, assertions: [...summary.assertions, { name: 'controls_effective', value: true, reads: [], statement: 'all controls operating effectively' }] });
  assert.ok(has(verifyMi(creep), /MI-R05.*is not one of the statements MI may make/));
  assert.deepEqual([...ASSERTIONS.keys()], ['evidence_sealed', 'bound_to_commit', 'evidence_floor_sealed', 'anchor_externally_signed']);
});

// NEGATIVE — the dropped statement. A page missing its `bound_to_commit` row reads as a page with
// nothing to report there, which is indistinguishable from a pass.
test('a dropped statement is refused — the vocabulary renders whole or not at all', () => {
  const { summary } = derive();
  const short = reseal({ ...summary, assertions: summary.assertions.filter((a) => a.name !== 'bound_to_commit') });
  assert.ok(has(verifyMi(short), /MI-R05.*statement "bound_to_commit" is missing/));
});

test('a symbolic release identifier is not a binding subject, and MI says so', () => {
  const symbolic = bundle({ commit: 'release-v-demo' });
  const { summary } = deriveMi({ manifest: symbolic, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW });
  assert.equal(valueOf(summary, 'bound_to_commit'), false);
  assert.ok(summary.chain.findings.some((f) => /not a 40-hex commit sha/.test(f)));
  assert.deepEqual(verifyMi(summary, { manifest: symbolic, issuers: ISSUERS }), []);
});

test('the anchor attestation is a status, honestly reported — never a signature MI carries', () => {
  const noIssuers = deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT }, { now: NOW });
  assert.equal(valueOf(noIssuers.summary, 'anchor_externally_signed'), 'UNVERIFIED-HERE');
  assert.ok(noIssuers.notices.some((n) => /honest gap, not a pass/.test(n)));

  const platform = deriveMi({ manifest: MANIFEST, sealedAt: SEALED_AT, issuers: PLATFORM_ISSUERS }, { now: NOW });
  assert.equal(valueOf(platform.summary, 'anchor_externally_signed'), 'UNVERIFIED-HERE');

  const { privateKey: other } = generateKeyPairSync('ed25519');
  const wrong = { ...MANIFEST, attestation: { issuer: 'anchor-signer', signature: sign(null, Buffer.from('not the anchor'), other).toString('base64') } };
  const bad = deriveMi({ manifest: wrong, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW });
  assert.equal(valueOf(bad.summary, 'anchor_externally_signed'), false);
  assert.ok(bad.notices.some((n) => /does not verify/.test(n)));

  const unsigned = { ...MANIFEST };
  delete unsigned.attestation;
  const u = deriveMi({ manifest: unsigned, sealedAt: SEALED_AT, issuers: ISSUERS }, { now: NOW });
  assert.equal(valueOf(u.summary, 'anchor_externally_signed'), false);

  // The material itself never travels. MI carries the anchor's digest and a status, nothing else.
  assert.ok(!JSON.stringify(derive().summary).includes(MANIFEST.attestation.signature),
    'a signature copied onto a dashboard is indistinguishable from the approval it belongs to');
});

// --- non-authoritative ------------------------------------------------------------------------------

// NEGATIVE — a payload that lost its label. Without MI-R06 it is a tidy board with no way to tell it
// from the control.
test('an unlabelled MI payload or tile is refused', () => {
  const { summary } = derive();
  for (const strip of ['schema', 'authority', 'banner', 'write_class']) {
    const broken = reseal({ ...summary, [strip]: undefined });
    assert.ok(has(verifyMi(broken), /^MI-R06/m), `stripping ${strip} must be a finding`);
  }
  assert.ok(has(verifyMi(reseal({ ...summary, banner: 'Evidence dashboard.' })), /MI-R06.*banner is missing or altered/));
  assert.ok(has(verifyMi(null), /MI-R06.*not an object/));
  assert.ok(has(verifyTile({ ...summary.tiles[0], authority: 'second-line' }, summary.evidence, summary.freshness), /MI-R06.*authority is "second-line"/));
  assert.ok(has(verifyTile({ ...summary.tiles[0], banner: 'ok' }, summary.evidence, summary.freshness), /MI-R06.*banner is missing or altered/));
  assert.ok(has(verifyMi(reseal({ ...summary, chain: { ...summary.chain, verdict: 'mostly fine' } })), /MI-R05.*not "intact" or "broken"/));
});

// NEGATIVE — the field that turns a mirror into the control. A `release_hold` on a board is
// indistinguishable on screen from the hold itself.
test('a field that would read as governance authority is refused wherever it appears', () => {
  const { summary } = derive();
  assert.ok(has(verifyMi(reseal({ ...summary, release_hold: 'released' })), /MI-R07.*would read as governance authority/));
  assert.ok(has(verifyMi(reseal({ ...summary, evidence: { ...summary.evidence, attestation: 'sig:MEUCIQ…' } })), /MI-R07.*evidence.*governance authority/));
  assert.ok(has(verifyTile({ ...summary.tiles[0], approved_by: 'exec-rashid' }, summary.evidence, summary.freshness), /MI-R07/));
});

test('a summary edited after derivation no longer matches its own digest', () => {
  const { summary } = derive();
  summary.evidence.entries = 999;
  assert.ok(has(verifyMi(summary), /MI-R09.*does not match its content/));
});

test('a stale tile with no staleness marker is the exact failure this module prevents', () => {
  const { summary } = derive({}, { now: Date.parse(SEALED_AT) + 21 * DAY });
  const green = { ...summary.tiles[0], stale: false, label: 'evidence_sealed: true' };
  const findings = verifyTile(green, summary.evidence, summary.freshness);
  assert.ok(has(findings, /MI-R04.*does not say so/));
  assert.ok(has(findings, /MI-R04.*label does not contain STALE/));
  assert.ok(has(findings, /MI-R04.*confident green this module exists to prevent/));
});

test('freshnessOf is pure arithmetic over its two operands', () => {
  const f = freshnessOf({ sealedAt: SEALED_AT, now: Date.parse(SEALED_AT) + 3 * DAY });
  assert.equal(f.age_days, 3);
  assert.equal(f.state, 'current');
  assert.equal(f.as_of, new Date(Date.parse(SEALED_AT) + 3 * DAY).toISOString());
  assert.deepEqual(f, freshnessOf({ sealedAt: SEALED_AT, now: Date.parse(SEALED_AT) + 3 * DAY }));
});

// --- the contract is documented, and the documentation is checked ------------------------------------

test('every rejection code the module can emit is documented, and every documented code is reachable', () => {
  const source = readFileSync(new URL('./floor-mi.mjs', import.meta.url), 'utf8');
  const used = new Set(source.match(/MI-R\d+/g) || []);
  for (const code of used) assert.ok(REJECTIONS.has(code), `${code} is emitted but not documented in REJECTIONS`);
  for (const code of REJECTIONS.keys()) {
    const occurrences = (source.match(new RegExp(code, 'g')) || []).length;
    assert.ok(occurrences >= 2, `${code} is documented but never emitted (${occurrences} occurrence)`);
    assert.ok(REJECTIONS.get(code).length > 20, `${code} needs a reason, not a label`);
  }
  assert.equal(used.size, REJECTIONS.size);
});
