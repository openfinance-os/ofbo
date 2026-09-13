// MI over sealed evidence (Factory Floor WS6 · D6.2). A board member, a second-line reviewer or an
// accountable executive wants one screen: is the evidence sealed, is it complete, is it bound to
// what shipped. This module derives that screen from the sealed release bundle
// (`scripts/evidence-seal-check.mjs`'s manifest) and refuses to derive anything it cannot support.
//
// ONE SENTENCE GOVERNS THIS FILE: **MI must never be fresher than the evidence it reports.**
//
// A dashboard reads a projection, and a projection is a mirror. If the last sealed bundle is three
// weeks old, MI must say THREE WEEKS OLD — loudly, in the payload, on every tile — rather than show
// a confident green that happens to be describing a three-week-old world. The green is not wrong
// about the past; it is wrong about being about the present, and that is the more dangerous of the
// two errors because nobody acts on a number they know is stale. A stale dashboard that looks
// current is worse than no dashboard.
//
// So the mechanics are arranged so staleness cannot be lost in transit:
//
//   - The sealed bundle's OWN digest (its recorded external anchor) and its OWN timestamp are
//     mandatory. `deriveMi()` emits nothing without them (MI-R01, MI-R02); `verifyMi()` refuses a
//     summary that has lost them, INCLUDING on a per-tile basis — a tile is what gets screenshotted
//     into a board pack, and a tile that has lost its as-of date has lost the only thing that makes
//     it readable six weeks later.
//   - The freshness block is DERIVED ARITHMETIC over two carried instants, and `verifyMi()`
//     recomputes it. A hand-edited `state: "current"` over a `sealed_at` three weeks back is a
//     finding, not a rendering choice. The headline sentence must name the age and must contain the
//     word STALE when it is stale, because the label is the part that reaches a human.
//   - `as_of` may not precede `sealed_at` (MI-R04). MI reporting a bundle that had not been sealed
//     yet is reading the future, and the only way that happens is a clock somebody chose.
//
// NON-AUTHORITATIVE, LIKE THE PROJECTION IT RESEMBLES. MI reports what the sealed record says; it
// never becomes the record. Every payload and every tile carries `authority: "none"` and the banner
// verbatim, the fields through which a screen could look like the control (`core/floor-project.mjs`'s
// AUTHORITY_FIELDS — attestations, signatures, seals, holds) are refused wherever they appear, and
// no signature bytes are copied out of the manifest at any point. What MI carries about the anchor's
// attestation is a STATUS, never the material.
//
// IT MAY ONLY SAY WHAT THE BUNDLE SUPPORTS. The statements MI can make are a fixed vocabulary
// (`ASSERTIONS`), each derived from the manifest and each naming what it rests on. Two refusals hold
// that line: a statement outside the vocabulary is refused (a new statement is a new claim), and no
// statement may read `true` while the chain is broken or while it rests on an evidence type the
// bundle does not carry (MI-R05). A broken seal collapses every green — which is the correct
// behaviour and the one a dashboard author will be tempted to soften, because a red board is an
// unpopular board.
//
// AND IT REPORTS A BROKEN BUNDLE RATHER THAN REFUSING TO RENDER. The distinction matters and is easy
// to get backwards. A bundle whose chain does not resolve produces a summary that SAYS the chain
// does not resolve; a dashboard that goes blank when evidence breaks tells a reader nothing, and
// "the MI page is down" is indistinguishable from "the MI page is fine". What is refused is MI
// lying about ITSELF — a lost digest, a lost timestamp, arithmetic that disagrees with its own
// operands, a claim the bundle does not support.
//
// PURE. No network, no vendor SDK, and no clock of its own: `now` is injected and REQUIRED
// (MI-R08), because a default `Date.now()` would make "stale" a property of whichever machine
// happened to render the page. Same discipline as `core/floor-project.mjs` and
// `core/floor-webhook.mjs`.
//
// WHAT THIS DOES NOT COVER, said out loud because a dashboard flatters whatever it is fed:
//
//   - It does not verify the sealed ARTIFACTS' contents. `evaluate()` is called without a `baseDir`,
//     so the chain, the required types and the commit binding are checked, and what each artifact
//     SAYS is not — that is the seal gate's own semantic pass, which needs the files. A bundle whose
//     tests.json reports failures can still be an intact chain, and MI will say `evidence_sealed`
//     truthfully while saying nothing about the failures. Run the seal gate.
//   - It cannot tell a missing bundle from a project that has not released. Absent evidence yields
//     SILENCE and a notice, never a red tile and never a green one — an adopter who has sealed
//     nothing gets no dashboard rather than a dashboard about nothing.
//   - The external anchor's own timestamp is the adopter's to record. This module takes `sealedAt`
//     as an input and cannot tell a real RFC-3161 timestamp from a number somebody typed. What it
//     guarantees is that whatever was recorded travels through to the screen unaltered and is used
//     as the age's origin — not that it is true.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AUTHORITY_FIELDS, canonical, sha256 } from './floor-project.mjs';
import { verifyAnchorAttestation } from './attestations.mjs';
import {
  EVIDENCE_FLOOR,
  REQUIRED_TYPES,
  buildChain,
  evaluate as evaluateSeal,
} from '../scripts/evidence-seal-check.mjs';

export const SCHEMA_ID = 'loom.floor-mi/v1';

/** From `core/floor-templates.mjs`'s WRITE_CLASSES vocabulary — MI mirrors, it never receives. */
export const WRITE_CLASS = 'read-only-mirror';

/**
 * How old the last sealed bundle may be before MI reports itself STALE. ADOPT: set this to your
 * release cadence — a fortnightly train makes 7 days noise, and a daily one makes 30 days a lie.
 * It is a parameter everywhere below; this is only the default when nobody has chosen.
 */
export const STALE_AFTER_DAYS = 7;

const DAY = 86400000;

/**
 * The label, verbatim. It names the staleness failure specifically, because that is THIS surface's
 * characteristic way of being wrong — a projection's is a stale board, and MI's is a stale board
 * whose numbers look like a verdict.
 */
export const NON_AUTHORITATIVE = 'NON-AUTHORITATIVE MI — a read-only summary of the last SEALED evidence bundle in git. Every number here is as of the sealed timestamp shown beside it, NOT as of now, and this page is exactly as old as that bundle. Nothing here approves, releases or holds anything, and no gate reads it. If this disagrees with the sealed bundle, the bundle is right and this is out of date.';

/**
 * The statements MI is permitted to make. A fixed vocabulary, because a dashboard's statements are
 * where scope creep turns into governance claims: "controls effective", "release approved", "risk
 * accepted" are all one product review away, and none of them is something a sealed evidence bundle
 * can support. A statement outside this table is refused (MI-R05).
 *
 * `reads` is what the statement rests on, and it is the basis of the refusal that matters: no
 * statement may read `true` while resting on an evidence type the bundle does not carry.
 */
export const ASSERTIONS = new Map([
  ['evidence_sealed', {
    reads: ['anchor'],
    statement: 'the bundle is a complete, intact, append-only hash chain resolving to its recorded external anchor',
  }],
  ['bound_to_commit', {
    reads: ['release_commit'],
    statement: 'the bundle names a 40-hex release commit, so the evidence is bound to what shipped rather than to a tag somebody can move',
  }],
  ['evidence_floor_sealed', {
    reads: [...EVIDENCE_FLOOR],
    statement: `every evidence type in the floor (${EVIDENCE_FLOOR.join(', ')}) is sealed in the bundle`,
  }],
  ['anchor_externally_signed', {
    reads: ['anchor'],
    statement: 'the anchor carries an attestation that verifies against a registered issuer — UNVERIFIED-HERE when the mechanism is the platform\'s rather than this module\'s',
  }],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/** ISO-8601 only — the TYPE is part of the check, as in every other contract in this harness. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/**
 * Every rejection this module can emit, with the reason an operator will need. Exported so the
 * contract can be read without reading the source, and asserted against the source by the tests.
 */
export const REJECTIONS = new Map([
  ['MI-R01', 'no sealed-bundle digest — a dashboard that cannot name the bundle it reports is a screenshot, and an auditor has nothing to look up in the append-only store'],
  ['MI-R02', 'no sealed-bundle timestamp, or one that is not a parseable ISO-8601 instant — MI that cannot be dated cannot be told from current, which is this surface\'s characteristic failure'],
  ['MI-R03', 'the digest the summary carries is not the digest the bundle records — this is not a summary of that bundle, whatever it says at the top'],
  ['MI-R04', 'the freshness block does not follow from its own two instants: recomputed age or state disagrees, the headline does not name the age or does not say STALE when it is, or the summary is dated before the bundle it reports'],
  ['MI-R05', 'a statement the sealed evidence does not support: outside the fixed vocabulary, true while the chain is broken, or true while resting on an evidence type the bundle does not carry'],
  ['MI-R06', 'an unlabelled MI payload or tile — no schema, no authority "none", an altered banner, or the wrong write class'],
  ['MI-R07', 'a field that would read as governance authority on a screen that has none — MI carries statuses, never the cryptography that makes an approval an approval'],
  ['MI-R08', 'no `now` supplied — this module has no clock, so freshness is judged against the caller\'s trusted one rather than against whichever machine rendered the page'],
  ['MI-R09', 'a self-digest that does not match the content — this is not the summary that was derived'],
]);

/**
 * The newest of several sealed bundles, so "the LAST sealed bundle" is a derivation rather than the
 * caller's guess. `bundles`: [{ manifest, sealedAt }]. An unstamped bundle cannot be ordered and is
 * therefore not a candidate — which is a refusal, not a skip: picking the newest of a set in which
 * some members have no date would silently report an older bundle as the latest.
 */
export function lastSealed(bundles = []) {
  const findings = [];
  const dated = [];
  for (const [i, b] of (Array.isArray(bundles) ? bundles : []).entries()) {
    const t = parseTime(b?.sealedAt);
    if (t === null) {
      findings.push(`MI-R02: bundle[${i}]${isStr(b?.manifest?.release) ? ` (${b.manifest.release})` : ''}: no parseable sealed timestamp — an undated bundle cannot be ordered, and choosing "the latest" from a set containing one would quietly report an older bundle as current`);
      continue;
    }
    dated.push({ ...b, _t: t });
  }
  if (findings.length) return { bundle: null, findings };
  if (dated.length === 0) return { bundle: null, findings: [] };
  dated.sort((a, b) => b._t - a._t || String(a.manifest?.anchor).localeCompare(String(b.manifest?.anchor)));
  const { _t, ...bundle } = dated[0];
  return { bundle, findings: [] };
}

/** The final seal the manifest's own entries resolve to — recomputed, never taken on trust. */
export function chainResolvesTo(manifest) {
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (entries.length === 0) return null;
  const rebuilt = buildChain(entries.map((e) => ({ type: e?.type, ref: e?.ref, sha256: e?.sha256 })));
  return rebuilt[rebuilt.length - 1].seal;
}

/**
 * Derive the MI summary for one sealed bundle.
 *
 * `input`: { manifest, sealedAt, issuers? } — the sealed evidence manifest exactly as
 *          `scripts/evidence-seal-check.mjs` reads it, the instant it was externally anchored, and
 *          optionally the allowed-issuers registry so the anchor's attestation can be checked for
 *          real rather than reported as UNVERIFIED-HERE.
 * `opts`:  { now (ms epoch, REQUIRED — this module has no clock), staleAfterDays, requiredTypes }.
 *
 * Returns { summary, findings, notices }. `summary` is null when there are findings and null when
 * there is no bundle at all: a repository that has sealed nothing gets silence and a notice, never
 * a tile. A reduced summary is not offered — MI that has lost its digest or its timestamp is the
 * failure this module exists to prevent, so there is no shape in which it is published anyway.
 */
export function deriveMi(input = {}, { now = null, staleAfterDays = STALE_AFTER_DAYS, requiredTypes = REQUIRED_TYPES } = {}) {
  const findings = [];
  const notices = [];
  const nothing = () => ({ summary: null, findings, notices });

  if (!Number.isFinite(now)) {
    findings.push('MI-R08: no `now` supplied — freshness is the whole point of this module, and a default clock would make "stale" a property of whichever machine rendered the page');
    return nothing();
  }
  const manifest = input.manifest;
  if (manifest === null || manifest === undefined) {
    notices.push('no sealed evidence bundle — MI is SILENT rather than green. An adopter who has sealed nothing gets no dashboard, because a dashboard about nothing is read as a dashboard about something');
    return { summary: null, findings: [], notices };
  }
  if (typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    findings.push('MI-R01: the bundle has no `entries` — there is no sealed evidence here to report, and an empty bundle rendered as a dashboard is the release narrated rather than sealed');
    return nothing();
  }

  const sealedAt = input.sealedAt;
  const sealedMs = parseTime(sealedAt);
  if (!isStr(manifest.anchor) || !HEX64.test(manifest.anchor)) {
    findings.push(`MI-R01: the bundle records no sha256 external anchor (got ${JSON.stringify(manifest.anchor)}) — MI would have to report a digest of its own arithmetic as if it were the seal, and an auditor would have nothing to look up in the append-only store`);
  }
  if (sealedMs === null) {
    findings.push(`MI-R02: no parseable ISO-8601 \`sealedAt\` for the bundle (got ${JSON.stringify(sealedAt)}) — a summary nobody can date cannot be told from a current one`);
  }
  if (findings.length) return nothing();
  if (now < sealedMs) {
    findings.push(`MI-R04: the summary would be dated ${new Date(now).toISOString()}, BEFORE the bundle was sealed at ${sealedAt} — MI cannot report a bundle that did not exist yet, and the only way this happens is a clock somebody chose`);
    return nothing();
  }

  const sealFindings = evaluateSeal(manifest, { requiredTypes });
  const resolvesTo = chainResolvesTo(manifest);
  const types = [...new Set(manifest.entries.map((e) => e?.type).filter(isStr))].sort();
  const intact = sealFindings.length === 0;
  if (!intact) {
    notices.push(`the sealed bundle does NOT verify (${sealFindings.length} finding(s)) — MI reports that rather than refusing to render, and every statement below collapses to false. A blank page and a healthy page are indistinguishable to a reader`);
  }

  const anchorStatus = anchorAttestationStatus(manifest, input.issuers, notices);
  const values = {
    evidence_sealed: intact,
    bound_to_commit: intact && HEX40.test(String(manifest.release_commit ?? '')),
    evidence_floor_sealed: intact && EVIDENCE_FLOOR.every((t) => types.includes(t)),
    anchor_externally_signed: intact ? anchorStatus : false,
  };

  const evidence = {
    release: isStr(manifest.release) ? manifest.release : null,
    release_commit: isStr(manifest.release_commit) ? manifest.release_commit : null,
    // The bundle's OWN digest: the seal that was published to the append-only, timestamped store.
    // Reported as recorded, so an auditor can look it up — and set beside what the chain actually
    // resolves to, so a mismatch is visible on the same screen rather than only in a gate's log.
    digest: manifest.anchor,
    chain_resolves_to: resolvesTo,
    sealed_at: sealedAt,
    entries: manifest.entries.length,
    types,
  };
  const freshness = freshnessOf({ sealedAt, now, staleAfterDays });
  const assertions = [...ASSERTIONS.entries()].map(([name, def]) => ({
    name,
    value: values[name],
    reads: [...def.reads],
    statement: def.statement,
  }));

  const summary = {
    _comment: 'GENERATED by core/floor-mi.mjs. NON-AUTHORITATIVE: git is the record and the sealed bundle is the evidence. Do not hand-edit — verifyMi() recomputes the freshness arithmetic and the self-digest, so an edited "current" over a stale bundle is a finding rather than a rendering choice.',
    schema: SCHEMA_ID,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    write_class: WRITE_CLASS,
    evidence,
    freshness,
    chain: {
      verdict: intact ? 'intact' : 'broken',
      findings: sealFindings,
      note: 'From scripts/evidence-seal-check.mjs, run WITHOUT a baseDir: the chain, the required evidence types and the commit binding are checked here; what each sealed artifact SAYS is the seal gate\'s own semantic pass, which needs the files. An intact chain of failing tests is intact.',
    },
    assertions,
    tiles: assertions.map((a) => tileFor(a, evidence, freshness)).concat([freshnessTile(evidence, freshness)]),
  };
  summary.digest = digestOf(summary);
  return { summary, findings: [], notices };
}

/** The anchor attestation's status — never its material. `true`, `false`, or `'UNVERIFIED-HERE'`. */
function anchorAttestationStatus(manifest, issuers, notices) {
  if (!manifest.attestation) {
    notices.push('the bundle\'s anchor carries no attestation — the seal is unsigned, and MI says so rather than leaving the tile blank');
    return false;
  }
  if (!issuers) {
    notices.push('no allowed-issuers registry supplied — the anchor attestation is reported UNVERIFIED-HERE. That is an honest gap, not a pass: pass the registry to have it checked for real');
    return 'UNVERIFIED-HERE';
  }
  const f = verifyAnchorAttestation(manifest, issuers);
  if (f.length === 0) return true;
  if (f.some((x) => /UNVERIFIED-HERE/.test(x))) {
    notices.push(`the anchor attestation's mechanism is the platform's, not this module's: ${f.join('; ')}`);
    return 'UNVERIFIED-HERE';
  }
  notices.push(`the anchor attestation does not verify: ${f.join('; ')}`);
  return false;
}

/**
 * The freshness block: arithmetic over two recorded instants and nothing else. Derived here and
 * RECOMPUTED by `verifyMi()`, which is what makes a hand-edited `state: "current"` a finding.
 */
export function freshnessOf({ sealedAt, now, staleAfterDays = STALE_AFTER_DAYS }) {
  const sealedMs = parseTime(sealedAt);
  const ageDays = sealedMs === null ? null : Math.floor((now - sealedMs) / DAY);
  const stale = ageDays !== null && ageDays > staleAfterDays;
  return {
    as_of: new Date(now).toISOString(),
    sealed_at: sealedAt,
    age_days: ageDays,
    stale_after_days: staleAfterDays,
    state: stale ? 'stale' : 'current',
    headline: stale
      ? `STALE — the last sealed evidence bundle is ${ageDays} day(s) old (limit ${staleAfterDays}). Every number on this page is as of ${sealedAt}, not as of now. Do not read it as a current position.`
      : `The last sealed evidence bundle is ${ageDays} day(s) old, sealed ${sealedAt}. Every number on this page is as of that instant.`,
  };
}

/**
 * One tile. The digest and the as-of date live on EVERY tile, not in a page footer, for the reason
 * `core/floor-project.mjs` puts the banner on every card: a tile is what gets screenshotted, pasted
 * into a board pack and quoted six weeks later, and a tile that has lost its as-of date has lost the
 * only thing that makes it readable then.
 */
export function tileFor(assertion, evidence, freshness) {
  return {
    tile: assertion.name,
    value: assertion.value,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    sealed_digest: evidence.digest,
    as_of: evidence.sealed_at,
    stale: freshness.state === 'stale',
    label: `${assertion.name}: ${String(assertion.value)} — as of ${evidence.sealed_at}${freshness.state === 'stale' ? `, ${freshness.age_days} days old, STALE` : ''}`,
  };
}

/** The tile whose only job is the age. It is first on the page for the same reason it exists. */
export function freshnessTile(evidence, freshness) {
  return {
    tile: 'evidence_freshness',
    value: freshness.state,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    sealed_digest: evidence.digest,
    as_of: evidence.sealed_at,
    stale: freshness.state === 'stale',
    label: freshness.headline,
  };
}

/** The summary's digest over everything but itself. Same input, same bytes, same digest. */
export function digestOf(summary) {
  const { digest, ...rest } = summary || {};
  return sha256(canonical(rest));
}

/**
 * The gate over an MI summary, whoever built it. `deriveMi()` cannot emit a bad one; this catches
 * the ones it did not build — a hand-edited file, a payload from a newer renderer, a slide somebody
 * assembled because the run was slow.
 *
 * `ctx.manifest` (optional) is the sealed bundle. Supplied, the digest and every statement are
 * re-derived against it (MI-R03, MI-R05). Absent, the summary is still checked for internal
 * coherence — labels, per-tile provenance, the freshness arithmetic, the statement vocabulary, and
 * no statement reading true while the chain reads broken. Findings ([] ⇒ safe to put in front of a
 * board).
 */
export function verifyMi(summary, ctx = {}, label = 'mi') {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return [`MI-R06: ${label}: not an object — there is nothing here to label, and an unlabelled surface is read as the record`];
  }
  const findings = [];
  if (summary.schema !== SCHEMA_ID) findings.push(`MI-R06: ${label}: schema ${JSON.stringify(summary.schema)} is not ${SCHEMA_ID}`);
  if (summary.authority !== 'none') findings.push(`MI-R06: ${label}: authority is ${JSON.stringify(summary.authority)}, not "none" — MI carries none, ever`);
  if (summary.banner !== NON_AUTHORITATIVE) findings.push(`MI-R06: ${label}: the non-authoritative banner is missing or altered — it is the sentence standing between a tidy tile and a governance claim, so it is verbatim or it is a finding`);
  if (summary.write_class !== WRITE_CLASS) findings.push(`MI-R06: ${label}: write_class is ${JSON.stringify(summary.write_class)}, not ${JSON.stringify(WRITE_CLASS)}`);
  for (const k of Object.keys(summary)) {
    if (AUTHORITY_FIELDS.has(k)) findings.push(`MI-R07: ${label}: \`${k}\` would read as governance authority on a screen that has none`);
  }
  if (summary.digest !== undefined && summary.digest !== digestOf(summary)) {
    findings.push(`MI-R09: ${label}: the summary's digest does not match its content — this is not the summary that was derived`);
  }

  const ev = summary.evidence;
  if (!ev || typeof ev !== 'object') {
    return [...findings, `MI-R01: ${label}: no \`evidence\` block — a summary that cannot name the bundle it reports is a screenshot`];
  }
  for (const k of Object.keys(ev)) {
    if (AUTHORITY_FIELDS.has(k)) findings.push(`MI-R07: ${label}: evidence.\`${k}\` would read as governance authority — MI carries the anchor's digest and a status, never the material that signs it`);
  }
  if (!isStr(ev.digest) || !HEX64.test(ev.digest)) {
    findings.push(`MI-R01: ${label}: the summary carries no sha256 sealed-bundle digest (got ${JSON.stringify(ev.digest)}) — nothing here can be traced to a bundle, and an auditor has nothing to look up`);
  }
  if (parseTime(ev.sealed_at) === null) {
    findings.push(`MI-R02: ${label}: the summary carries no parseable ISO-8601 sealed_at (got ${JSON.stringify(ev.sealed_at)}) — a dashboard nobody can date cannot be told from a current one`);
  }
  if (ctx.manifest !== undefined && ctx.manifest !== null) {
    if (ev.digest !== ctx.manifest.anchor) {
      findings.push(`MI-R03: ${label}: the summary reports digest ${String(ev.digest).slice(0, 12)}… but the bundle records ${String(ctx.manifest.anchor).slice(0, 12)}… — this is not a summary of that bundle, whatever it says at the top`);
    }
    const resolves = chainResolvesTo(ctx.manifest);
    if (ev.chain_resolves_to !== resolves) {
      findings.push(`MI-R03: ${label}: the summary says the chain resolves to ${String(ev.chain_resolves_to).slice(0, 12)}… but recomputing it gives ${String(resolves).slice(0, 12)}… — MI does not get to report its own arithmetic`);
    }
  }

  const chainVerdict = summary.chain?.verdict;
  if (chainVerdict !== 'intact' && chainVerdict !== 'broken') {
    findings.push(`MI-R05: ${label}: chain verdict is ${JSON.stringify(chainVerdict)}, not "intact" or "broken" — a third value is a way of not saying which`);
  }
  // The summary's own operands must produce the summary's own conclusion. This is the check that
  // makes a confident green over three-week-old evidence a finding rather than a design choice.
  findings.push(...verifyFreshness(summary, label));

  const types = Array.isArray(ev.types) ? ev.types : [];
  // Re-derived ONCE, not per statement: the derivation is the reference answer, and calling it in
  // the loop would make the cost quadratic in a function a dashboard build runs on every render.
  const reference = ctx.manifest
    ? deriveMi(
      { manifest: ctx.manifest, sealedAt: ev.sealed_at, issuers: ctx.issuers ?? null },
      { now: parseTime(summary.freshness?.as_of) ?? 0, staleAfterDays: Number.isFinite(summary.freshness?.stale_after_days) ? summary.freshness.stale_after_days : STALE_AFTER_DAYS },
    ).summary
    : null;
  const seen = new Set();
  for (const [i, a] of (Array.isArray(summary.assertions) ? summary.assertions : []).entries()) {
    const at = `${label} · assertion[${i}]${isStr(a?.name) ? ` (${a.name})` : ''}`;
    if (!a || typeof a !== 'object') { findings.push(`MI-R05: ${at}: not an object`); continue; }
    if (!ASSERTIONS.has(a.name)) {
      findings.push(`MI-R05: ${at}: ${JSON.stringify(a.name)} is not one of the statements MI may make (${[...ASSERTIONS.keys()].join(', ')}) — a new statement is a new claim, and "controls effective" is one product review away from a sealed evidence bundle that cannot support it`);
      continue;
    }
    seen.add(a.name);
    if (a.value === true) {
      if (chainVerdict === 'broken') {
        findings.push(`MI-R05: ${at}: reads true while the chain reads broken — nothing a bundle says is supported once its chain does not resolve, so a broken seal collapses every green. This is the softening a dashboard author is tempted into, because a red board is an unpopular board`);
      }
      for (const need of (Array.isArray(a.reads) ? a.reads : [])) {
        // 'anchor' and 'release_commit' are manifest fields, not evidence types; only the evidence
        // types are checked against what the bundle actually carries.
        if (need === 'anchor' || need === 'release_commit') continue;
        if (!types.includes(need)) {
          findings.push(`MI-R05: ${at}: reads true but rests on evidence type ${JSON.stringify(need)}, which the bundle does not carry (it carries ${types.join(', ') || 'nothing'}) — a green tile over absent evidence is the failure MI exists to avoid`);
        }
      }
    }
    const mine = (reference?.assertions || []).find((x) => x.name === a.name);
    if (mine && canonical(mine.value) !== canonical(a.value)) {
      findings.push(`MI-R05: ${at}: the summary says ${canonical(a.value)} but the bundle supports ${canonical(mine.value)} — MI reports what the sealed record says, and this does not`);
    }
  }
  for (const name of ASSERTIONS.keys()) {
    if (!seen.has(name)) findings.push(`MI-R05: ${label}: statement ${JSON.stringify(name)} is missing — a dropped statement reads as a passed one to anybody scanning the page, so the vocabulary is rendered whole or not at all`);
  }

  const tiles = Array.isArray(summary.tiles) ? summary.tiles : null;
  if (!tiles) findings.push(`MI-R06: ${label}: no tiles array — an empty dashboard and a broken one must not look alike`);
  else for (const [i, t] of tiles.entries()) findings.push(...verifyTile(t, ev, summary.freshness, `${label} · tile[${i}]${isStr(t?.tile) ? ` (${t.tile})` : ''}`));
  return findings;
}

/** The freshness block recomputed from its own two carried instants. */
export function verifyFreshness(summary, label = 'mi') {
  const f = summary?.freshness;
  if (!f || typeof f !== 'object') return [`MI-R04: ${label}: no freshness block — MI without an age is MI presenting itself as current`];
  const sealedMs = parseTime(f.sealed_at);
  const asOfMs = parseTime(f.as_of);
  const findings = [];
  if (sealedMs === null) return [`MI-R02: ${label}: freshness.sealed_at is missing or not a parseable ISO-8601 instant`];
  if (asOfMs === null) return [`MI-R04: ${label}: freshness.as_of is missing or not a parseable ISO-8601 instant — the age has no second operand`];
  if (f.sealed_at !== summary?.evidence?.sealed_at) {
    findings.push(`MI-R02: ${label}: freshness.sealed_at (${JSON.stringify(f.sealed_at)}) and evidence.sealed_at (${JSON.stringify(summary?.evidence?.sealed_at)}) disagree — two dates on one page means neither is the date`);
  }
  if (asOfMs < sealedMs) {
    findings.push(`MI-R04: ${label}: as_of ${f.as_of} precedes sealed_at ${f.sealed_at} — MI cannot report a bundle that had not been sealed yet`);
  }
  const limit = Number.isFinite(f.stale_after_days) ? f.stale_after_days : null;
  if (limit === null) {
    findings.push(`MI-R04: ${label}: stale_after_days is ${JSON.stringify(f.stale_after_days)}, not a number — without a bound, "stale" is a matter of opinion`);
    return findings;
  }
  const expected = freshnessOf({ sealedAt: f.sealed_at, now: asOfMs, staleAfterDays: limit });
  if (f.age_days !== expected.age_days) {
    findings.push(`MI-R04: ${label}: age_days says ${JSON.stringify(f.age_days)} but the two instants give ${expected.age_days} — the arithmetic is derived, not asserted`);
  }
  if (f.state !== expected.state) {
    findings.push(`MI-R04: ${label}: state says ${JSON.stringify(f.state)} but ${expected.age_days} day(s) against a ${limit}-day bound gives ${JSON.stringify(expected.state)} — a confident green over old evidence is worse than no dashboard, because somebody acts on it`);
  }
  if (!isStr(f.headline) || !f.headline.includes(`${expected.age_days} day`)) {
    findings.push(`MI-R04: ${label}: the headline does not name the age in days — the label is the part that reaches a human, and a page whose age lives only in a field nobody renders is a page that looks current`);
  }
  if (expected.state === 'stale' && !/STALE/.test(String(f.headline))) {
    findings.push(`MI-R04: ${label}: the bundle is ${expected.age_days} day(s) old, past the ${limit}-day bound, and the headline does not say STALE — a stale dashboard that looks current is the failure this module is arranged against`);
  }
  return findings;
}

/** One tile's own provenance and label. A tile travels alone; it carries what it needs. */
export function verifyTile(tile, evidence, freshness, label = 'tile') {
  if (!tile || typeof tile !== 'object') return [`MI-R06: ${label}: not an object`];
  const findings = [];
  if (tile.authority !== 'none') findings.push(`MI-R06: ${label}: authority is ${JSON.stringify(tile.authority)}, not "none" — the label lives on every tile, because a tile is what gets screenshotted into a board pack`);
  if (tile.banner !== NON_AUTHORITATIVE) findings.push(`MI-R06: ${label}: the non-authoritative banner is missing or altered`);
  for (const k of Object.keys(tile)) {
    if (AUTHORITY_FIELDS.has(k)) findings.push(`MI-R07: ${label}: \`${k}\` would read as governance authority`);
  }
  if (!isStr(tile.sealed_digest) || !HEX64.test(tile.sealed_digest)) {
    findings.push(`MI-R01: ${label}: no sha256 sealed_digest — a tile that cannot name the bundle it came from is a number with no provenance, and it will outlive this page`);
  } else if (isStr(evidence?.digest) && tile.sealed_digest !== evidence.digest) {
    findings.push(`MI-R03: ${label}: sealed_digest ${tile.sealed_digest.slice(0, 12)}… is not the summary's ${String(evidence.digest).slice(0, 12)}… — a tile from a different bundle on the same page`);
  }
  if (parseTime(tile.as_of) === null) {
    findings.push(`MI-R02: ${label}: no parseable ISO-8601 as_of — a tile that has lost its as-of date has lost the only thing that makes it readable six weeks later`);
  } else if (isStr(evidence?.sealed_at) && tile.as_of !== evidence.sealed_at) {
    findings.push(`MI-R02: ${label}: as_of ${JSON.stringify(tile.as_of)} is not the bundle's sealed_at ${JSON.stringify(evidence.sealed_at)} — a tile may not be fresher than the evidence under it`);
  }
  const stale = freshness?.state === 'stale';
  if (stale && tile.stale !== true) {
    findings.push(`MI-R04: ${label}: the bundle is stale but this tile does not say so — staleness that lives only on the page header is staleness that is lost the moment the tile is copied`);
  }
  if (stale && !/STALE/.test(String(tile.label ?? ''))) {
    findings.push(`MI-R04: ${label}: the bundle is stale and the tile's own label does not contain STALE — the label is what a human reads`);
  }
  if (tile.value === true && stale && tile.stale !== true) {
    findings.push(`MI-R04: ${label}: a true tile over stale evidence with no staleness marker is exactly the confident green this module exists to prevent`);
  }
  return findings;
}

// CLI: derive MI from a bundle descriptor, so an adopter can see exactly what their dashboard would
// render — and watch a three-week-old bundle produce a page that says STALE in its own words.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-mi.mjs <bundle.json> [now-iso]\n  { "manifest": { … }, "sealedAt": "…", "issuers": { … } }\n');
    process.exit(2);
  }
  let input;
  try { input = JSON.parse(readFileSync(path, 'utf8')); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const nowArg = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
  const { summary, findings, notices } = deriveMi(input, { now: nowArg });
  for (const n of notices) process.stderr.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write(`\nMI ABORTED — nothing is rendered.\n\n  - ${findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  if (!summary) process.exit(0);
  const verdict = verifyMi(summary, { manifest: input.manifest, issuers: input.issuers ?? null });
  if (verdict.length) {
    process.stderr.write(`\nThe derived summary does not verify — this is a bug in the derivation, not in your bundle.\n\n  - ${verdict.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
