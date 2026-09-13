// The read-only projection (Factory Floor WS1 · D1.1–D1.3). Git is mirrored onto the floor so the
// people who never open a repository can see the queue, the state of a change, and what the agent
// decided. This module is the git-side half: backlog entries, change-envelope state and decision-log
// entries in, the payload a projector would write out. It is one direction, and it is the only
// direction this module can express.
//
// Three properties carry the design, and each is unusual enough to state plainly.
//
// ONE WAY. The projector reads git and writes the floor. Nothing here reads the floor, and nothing
// here can write git — not by policy, by construction: there is no filesystem write, no network
// call, no vendor SDK, and no token. That is a property of this file. It is NOT a property of the
// credential the adopter's projector service holds, and this module cannot make it one. The
// incapability of the credential is observed, not declared, by `scripts/projection-capability-check.mjs`
// — a signed probe naming a control, the adapter-contract pattern. Read that file next; without it
// this one is a well-behaved copier with no evidence that it is the only copier.
//
// NO GOVERNANCE AUTHORITY. A projection approves nothing, releases nothing, holds nothing, and no
// gate reads it. That is easy to say in a design document and easy to lose on a screen, where a
// tidy card reading `production-authorized` beside a green tick is indistinguishable from the
// control that produced it. So the label is not decoration and not a footer: every payload AND
// every record inside it carries `authority: "none"` and the banner verbatim, `verifyProjection`
// refuses a payload missing either, and the fields through which a surface could look actionable —
// attestations, signatures, seals, plan hashes, release holds — are refused even if someone adds
// them to the allow-list. An allow-list is an editable file; that refusal is not. The worst thing a
// projection may ever be is a STALE BOARD. It may never be a false approval, and the difference
// between those two failures is the whole of this module's design.
//
// DENY BY DEFAULT, FAIL VISIBLY. The content ceiling is an allow-list of field paths with a
// fidelity ceiling each — *reference + status*, *summary*, *full text*, *never*. A field with no
// entry does not project. A record whose rendered payload trips a prohibited shape is withheld
// WHOLE and shown as `withheld — filter hit`, never dropped: silence must never be mistaken for
// coverage, and a half-projected record reads as complete.
//
// WHERE THE CEILING'S AUTHORITY COMES FROM, and why it is not in this file. The table encoded
// below is a DEFAULT. What makes it binding is the residency review (the "P1" record) at
// `docs/governance/residency-review.md`, naming class by class what may leave git for a SaaS
// workspace at what fidelity — the adopting institution's to write and sign under HG-0011, by
// data-protection plus risk-second-line. That record is no longer prose nobody reads:
// `scripts/residency-check.mjs` refuses a floor that exists while §11 is unsigned. See
// `residency-example/` for a worked instance and the runbook for the obligation. Until your
// record is signed, this module encodes an intent, not a permission — the last bullet below.
//
// What this does NOT protect against, said out loud because the placement of a filter flatters it:
//
//   - It matches SHAPES, NOT MEANING. An Emirates ID has a shape. A customer's name inside a
//     backlog title written from a complaint does not. Against structured identifiers the ceiling
//     is preventive; against unstructured disclosure it is close to useless, and no amount of
//     pattern tuning changes that. The length caps below bound VOLUME, not sensitivity.
//   - It is DIRECTIONAL. It governs git → floor. It has no visibility into what a person types
//     into a floor page, pastes into a comment, or drags in as an attachment. Every floor-authored
//     artifact sits entirely outside its reach; there, the control is the template's discipline and
//     a human reading before the freeze.
//   - It CANNOT RECALL. Once content reaches the vendor, deletion is a request, not an operation.
//     Withholding is the only control that runs before that becomes true.
//   - It says NOTHING about the projector's credential, its token custody, its availability, or
//     whether the projection is current. A projection that is silently three weeks stale passes
//     every check in this file. Freshness is the capability record's job and the board's own
//     `projected_at`, which is why that field is mandatory and its absence is a finding.
//   - It is not a residency approval. The ceiling encoded here is a DEFAULT table, not your
//     institution's decision. Until your P1 residency record is signed, this module describes an
//     intent, not a permission.
//
// Deliberately NOT a client of anything. No network, no clock (`projected_at` is passed in), no
// vendor names in the payload. Same discipline as `core/floor-export.mjs`: keeping the derivation
// pure is what makes it testable without a workspace, and what keeps the token out of it.
import { createHash } from 'node:crypto';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.floor-projection/v1';

/** The one identity D1.1 permits to project. Any other `projected_by` is PJ-R08. */
export const PROJECTOR_IDENTITY = 'svc-floor-projector';

/** From `core/floor-templates.mjs`'s WRITE_CLASSES vocabulary — the banner a reader must see. */
export const WRITE_CLASS = 'read-only-mirror';

/**
 * The label, verbatim. It is a constant rather than a parameter because a configurable banner is a
 * banner someone eventually configures away, and the sentence that has to survive contact with a
 * screenshot is the last one.
 */
export const NON_AUTHORITATIVE = 'NON-AUTHORITATIVE PROJECTION — a read-only mirror of git. Git is the record. Nothing here approves, releases or holds anything, and no gate reads it. If this disagrees with the repository, the repository is right and this is out of date.';

/** Fidelity ceilings, weakest first. `rank` orders them; nothing may exceed its class ceiling. */
export const FIDELITY = ['never', 'reference+status', 'summary', 'full-text'];
const rank = (f) => FIDELITY.indexOf(f);

/** Volume caps per fidelity. These bound HOW MUCH leaves git, never WHAT — see the header. */
export const CAPS = { 'reference+status': 120, summary: 240, 'full-text': 2000 };

export const sha256 = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

/** Canonical JSON — keys sorted at every depth, so the same input digests identically anywhere. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/**
 * The content ceiling, as data (residency record §4). Each class names the git artifact it mirrors,
 * a default ceiling, and the exact fields that may leave. A field absent from `fields` is WITHHELD —
 * there is no pass-through, and a schema change upstream therefore produces a withheld field and a
 * signal rather than a silent new disclosure.
 *
 * A field whose fidelity EXCEEDS its class ceiling must carry a written `exception`. That is not
 * documentation: `everyExceptionIsNamed()` is asserted by the test suite, so granting a second
 * verbatim field is a visible act in a diff, reviewable by the people who signed the ceiling.
 */
export const CLASSES = {
  backlog: {
    source: 'docs/backlog.yaml',
    ceiling: 'reference+status',
    key: ['id'],
    fields: [
      { name: 'id', from: 'id', fidelity: 'reference+status' },
      {
        name: 'title',
        from: 'title',
        fidelity: 'full-text',
        exception: '§4 grants the backlog item title verbatim — a board of elided titles is unusable, which would end the projection\'s only purpose. This is the ONE verbatim field in any projected class. Titles written from a complaint or an incident can carry customer detail and the shape filter will not see it; that residual is accepted in the record and is why the research-log discipline exists upstream of the title.',
      },
      { name: 'state', from: 'state', fidelity: 'reference+status' },
      { name: 'milestone', from: 'milestone', fidelity: 'reference+status' },
      { name: 'discovery', from: 'discovery', fidelity: 'reference+status' },
      { name: 'waist_gate', from: 'waist_gate', fidelity: 'reference+status' },
    ],
  },
  change: {
    source: 'docs/governance/changes/<id>/change-envelope.json',
    ceiling: 'reference+status',
    key: ['change_id'],
    fields: [
      { name: 'change_id', from: 'change_id', fidelity: 'reference+status' },
      { name: 'product_id', from: 'product_id', fidelity: 'reference+status' },
      { name: 'change_type', from: 'change_type', fidelity: 'reference+status' },
      { name: 'risk_tier', from: 'risk_tier', fidelity: 'reference+status' },
      { name: 'current_state', from: 'current_state', fidelity: 'reference+status' },
      { name: 'classified_at', from: 'classified_at', fidelity: 'reference+status' },
      { name: 'classified_by', from: 'classified_by', fidelity: 'reference+status' },
      { name: 'discovery_run', from: 'discovery_run', fidelity: 'reference+status' },
    ],
  },
  decision_log: {
    source: 'docs/governance/decision-log.json',
    ceiling: 'summary',
    key: ['change_id', 'seq'],
    fields: [
      { name: 'seq', from: 'seq', fidelity: 'reference+status' },
      { name: 'at', from: 'at', fidelity: 'reference+status' },
      { name: 'actor', from: 'actor', fidelity: 'reference+status' },
      { name: 'change_id', from: 'change_id', fidelity: 'reference+status' },
      // `decision` is the agent's free text: it quotes files, errors and fixtures, and free text is
      // the leakiest shape there is. It reaches the floor only through the bounded transform, and
      // the raw field has no entry of its own — so it cannot reach the floor at all.
      { name: 'summary', from: 'decision', fidelity: 'summary', transform: 'summarise' },
    ],
  },
};

/**
 * Fields refused wherever they appear, EVEN IF added to a class above. These are the fields through
 * which a projection would stop being a mirror and start looking like the control: the cryptography
 * that makes an approval an approval, the chain that makes the decision log tamper-evident, the
 * hold that decides a release. A mirror of them is indistinguishable on screen from the thing
 * itself, and the hash chain stays in git by design (§4). The allow-list is an editable file; this
 * list is the part an edit cannot reach.
 */
export const AUTHORITY_FIELDS = new Set([
  'approval', 'approvals', 'approved_by', 'attestation', 'signature', 'assertion',
  'seal', 'prev', 'plan_hash', 'release_hold', 'hold_released', 'nonce',
  'public_key', 'private_key', 'token', 'key', 'issuer', 'idp_subject', 'exemptions',
]);

/** Record keys the payload shape itself owns — never mistaken for a projected field. */
const RESERVED = new Set(['class', 'id', 'authority', 'banner', 'fidelity', 'fields', 'freeze', 'withheld', 'reason', 'filter', 'withheld_fields']);

/** Drift values a display-only freeze block may carry (the vocabulary of `core/floor-templates.mjs`). */
export const DRIFT_STATES = new Set(['none', 'draft ahead of record']);

/**
 * Shapes refused in any rendered payload. `normalized` patterns run over a separator-stripped,
 * upcased copy, so `784.1990.1234567.1` cannot walk past a pattern written for `784199012345671` —
 * the same evasion `hooks/pii-guard.sh` learned to close. These run AFTER transformation, so a
 * summary cannot smuggle what its source contained.
 *
 * This list is the FLOOR of what must never leave, not the ceiling. The residency record's §5
 * prohibits far more than any pattern can see: case narratives, supervisory correspondence, staff
 * conduct, unredacted incident detail. Nothing automated stands behind those.
 */
// WHY THIS OVERLAPS `floor-pii.mjs` AND MUST NOT BE MERGED WITH IT.
//
// Three shapes appear in both tables — email address, IBAN, Emirates ID — and the regexes differ.
// That is deliberate, and collapsing them into one shared table would break whichever module lost
// its own tolerance:
//
//   - THIS table BLOCKS, in the git → floor direction. A hit withholds the whole record. So it is
//     tuned for LOW FALSE POSITIVES: `784\d{12}` on normalized text, an IBAN that excludes the
//     synthetic 000 bank code. A false positive here silences a legitimate record.
//   - `floor-pii` ADVISES, over floor-authored prose. A hit asks a human to look and can never
//     certify a text clean. So it is tuned for HIGH RECALL: a loose 3-4-7-1 digit grouping that
//     matches plenty of things that are not Emirates IDs. A false negative there is a missed
//     disclosure; a false positive costs one person one glance.
//
// One table cannot hold both tolerances. What IS asserted, in floor-pii.test.mjs, is the invariant
// between them: every PERSONAL-DATA shape blocked here must also be caught there, so the advisory
// net is never narrower than the blocking one. The two credential shapes below are intentionally
// outside floor-pii's remit — a private key is not personal data, and secrets are the Q4 gate's
// job. That exclusion is asserted too, so it stays a decision rather than drifting into a gap.
export const PROHIBITED = [
  { id: 'emirates-id', normalized: true, re: /784\d{12}/, why: 'an Emirates-ID-shaped literal' },
  { id: 'uae-iban', normalized: true, re: /AE\d{2}(?!000)\d{19}/, why: 'a real-shaped UAE IBAN (synthetic ones carry bank code 000)' },
  { id: 'email-address', normalized: false, re: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/, why: 'an email address — a routing label for a named person, and never an identity' },
  { id: 'private-key', normalized: false, re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: 'private key material' },
  { id: 'bearer-token', normalized: false, re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/, why: 'a credential-shaped literal' },
];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const normalize = (s) => String(s).replace(/[ \t.-]/g, '').toUpperCase();

/** The first prohibited shape in `text`, or null. */
export function scan(text) {
  const raw = String(text ?? '');
  const norm = normalize(raw);
  for (const p of PROHIBITED) if (p.re.test(p.normalized ? norm : raw)) return p;
  return null;
}

/**
 * The bounded, schema-fixed transform a *summary* field is rendered through. Deterministic: no
 * clock, no locale, no randomness. It collapses whitespace, replaces any token containing a slash
 * with `⟨path⟩` — deliberately blunt, it eats "and/or" too, because a summary is not prose to be
 * preserved — and caps the length at a word boundary.
 *
 * It is a VOLUME control. It does not understand the text and cannot tell a fixture path from a
 * customer's situation. Say so wherever this output is described as filtered.
 */
export function summarise(text, max = CAPS.summary) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/\S*\/\S+/g, '⟨path⟩');
  if (one.length <= max) return one;
  return `${one.slice(0, max - 2).replace(/\s+\S*$/, '')} …`;
}

const TRANSFORMS = { summarise };

/** Every field whose fidelity exceeds its class ceiling must say why. `[]` ⇒ the table is honest. */
export function everyExceptionIsNamed() {
  const findings = [];
  for (const [cls, def] of Object.entries(CLASSES)) {
    for (const f of def.fields) {
      if (!FIDELITY.includes(f.fidelity)) findings.push(`${cls}.${f.name}: unknown fidelity ${JSON.stringify(f.fidelity)}`);
      if (f.fidelity === 'never') findings.push(`${cls}.${f.name}: a field with ceiling \`never\` has no business in an allow-list — remove it`);
      if (rank(f.fidelity) > rank(def.ceiling) && !isStr(f.exception)) {
        findings.push(`${cls}.${f.name}: fidelity ${f.fidelity} exceeds the class ceiling ${def.ceiling} with no named exception — a widening nobody wrote down is a widening nobody reviewed`);
      }
      if (AUTHORITY_FIELDS.has(f.name)) findings.push(`${cls}.${f.name}: is an authority field — no allow-list entry can grant one`);
    }
  }
  return findings;
}

// --- deriving the payload -------------------------------------------------------------------------

/** The display-only freeze/drift block (D1.3). Written by the freeze round-trip, never by a reader. */
export function freezeBlock({ frozenAt = null, version = null, drift = 'none' } = {}) {
  return {
    display_only: true,
    read_only: true,
    frozen_at: frozenAt,
    version,
    drift: DRIFT_STATES.has(drift) ? drift : 'none',
    note: 'Display only. Drift never blocks and never approves; it says the draft and the record have diverged. Re-freeze from the floor — editing the record here is not possible and editing it in git is a finding.',
  };
}

/** One git-side record → its projected form, or its visible withholding. */
function projectRecord(cls, raw, index) {
  const def = CLASSES[cls];
  const idParts = def.key.map((k) => raw?.[k]).filter((v) => v !== undefined && v !== null);
  const id = idParts.length === def.key.length ? idParts.join('#') : `#${index}`;
  const base = { class: cls, id: scan(id) ? `#${index}` : id, authority: 'none', banner: NON_AUTHORITATIVE };

  const allowed = new Set(def.fields.map((f) => f.from));
  const withheldFields = Object.keys(raw && typeof raw === 'object' ? raw : {})
    .filter((k) => !allowed.has(k) && k !== 'freeze').sort();

  const fields = {};
  for (const f of def.fields) {
    const v = raw?.[f.from];
    if (v === undefined || v === null) continue;
    // No attachments, no binaries, no evidence payloads: a value that is not a scalar cannot be
    // rendered at a fidelity, so it does not project at all.
    if (typeof v === 'object') continue;
    fields[f.name] = f.transform ? TRANSFORMS[f.transform](v, CAPS[f.fidelity]) : v;
  }

  // Pattern denial runs over the RENDERED record — after transformation, not before.
  const hit = scan(canonical(fields));
  if (hit) {
    return {
      ...base,
      withheld: true,
      reason: 'withheld — filter hit',
      filter: hit.id,
      withheld_fields: withheldFields,
    };
  }
  const out = { ...base, fidelity: def.ceiling, fields };
  if (withheldFields.length) out.withheld_fields = withheldFields;
  if (raw?.freeze && typeof raw.freeze === 'object') out.freeze = freezeBlock(raw.freeze);
  return out;
}

/**
 * Derive the payload a projector would write.
 *
 * `input`: { backlog?, changes?, decisions? } — arrays of git-side objects, exactly as the
 * repository holds them. `opts`: { projectedAt (ISO, required — this module has no clock),
 * projectedBy, source: { sha, ref } }.
 *
 * Returns { payload, findings, notices }. `payload` is null when there are findings: a projection
 * that cannot be anchored or cannot be attributed is not published in a reduced form, because a
 * board with no `projected_at` is a board nobody can tell is stale.
 */
export function project(input = {}, { projectedAt = null, projectedBy = PROJECTOR_IDENTITY, source = null } = {}) {
  const findings = [];
  if (!isIso(projectedAt)) findings.push('PJ-R06: no ISO-8601 `projectedAt` — a projection nobody can date cannot be told from a current one, and staleness is this surface\'s characteristic failure');
  if (!isStr(source?.sha)) findings.push('PJ-R06: no source commit sha — a mirror that cannot name what it mirrors is a screenshot');
  if (projectedBy !== PROJECTOR_IDENTITY) findings.push(`PJ-R08: projected_by is ${JSON.stringify(projectedBy)}, not ${PROJECTOR_IDENTITY} — D1.1 puts projection under one identity so its capabilities can be probed as one thing`);
  const tableFindings = everyExceptionIsNamed();
  if (tableFindings.length) findings.push(...tableFindings.map((f) => `PJ-R03: ${f}`));
  if (findings.length) return { payload: null, findings, notices: [] };

  const notices = [];
  const records = [];
  for (const [cls, key] of [['backlog', 'backlog'], ['change', 'changes'], ['decision_log', 'decisions']]) {
    for (const [i, raw] of (Array.isArray(input[key]) ? input[key] : []).entries()) {
      const rec = projectRecord(cls, raw, i);
      if (rec.withheld) notices.push(`${cls} ${rec.id}: withheld — filter hit (${rec.filter}); the record is shown on the floor as withheld, never omitted`);
      if (rec.withheld_fields?.length) notices.push(`${cls} ${rec.id}: ${rec.withheld_fields.length} field(s) withheld as outside the ceiling: ${rec.withheld_fields.join(', ')}`);
      records.push(rec);
    }
  }

  const payload = {
    _comment: 'GENERATED by core/floor-project.mjs. NON-AUTHORITATIVE: git is the record. Do not hand-edit and do not read this as a control — scripts/projection-capability-check.mjs refuses a payload that has lost its label, and no gate anywhere reads this file for a verdict.',
    schema: SCHEMA_ID,
    authority: 'none',
    banner: NON_AUTHORITATIVE,
    write_class: WRITE_CLASS,
    source: { sha: source.sha, ref: source.ref ?? null },
    projected_at: projectedAt,
    projected_by: projectedBy,
    content_ceiling: Object.fromEntries(Object.entries(CLASSES).map(([c, d]) => [c, d.ceiling])),
    counts: {
      records: records.length,
      projected: records.filter((r) => !r.withheld).length,
      withheld: records.filter((r) => r.withheld).length,
    },
    records,
  };
  payload.digest = digestOf(payload);
  return { payload, findings: [], notices };
}

/** The payload's digest over everything but itself. Determinism: same input, same bytes, same digest. */
export function digestOf(payload) {
  const { digest, ...rest } = payload || {};
  return sha256(canonical(rest));
}

// --- refusing a payload that is not one -----------------------------------------------------------

/**
 * The gate over a payload, whoever built it. `project()` cannot emit a bad one; this is what catches
 * the ones it did not build — a hand-edited file, a payload from a newer projector, a card someone
 * assembled by hand because the run was slow. Findings ([] ⇒ safe to put in front of a human).
 *
 * Rejection codes:
 *   PJ-R01  unlabelled — no schema, no `authority: "none"`, banner altered, or wrong write class
 *   PJ-R02  a field with no entry in the content ceiling (deny by default)
 *   PJ-R03  a field above the shape its ceiling permits (volume/newline caps, unknown drift value)
 *   PJ-R04  a prohibited shape in the rendered payload
 *   PJ-R05  a content class the ceiling does not name — an unlisted class is `never`
 *   PJ-R06  no source anchor, no projected_at, or a digest that does not match the content
 *   PJ-R07  a record neither projected nor visibly withheld; or counts that do not reconcile
 *   PJ-R08  projected_by is not `svc-floor-projector`
 *   PJ-R09  a non-scalar value — an attachment, a binary, or an evidence payload
 *   PJ-R10  a field that would read as governance authority, or a freeze block that is not display-only
 */
export function verifyProjection(payload, label = 'projection') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [`PJ-R01: ${label}: not an object — there is nothing here to label, and an unlabelled surface is read as the record`];
  }
  const findings = [];
  const at = `${label}`;
  if (payload.schema !== SCHEMA_ID) findings.push(`PJ-R01: ${at}: schema ${JSON.stringify(payload.schema)} is not ${SCHEMA_ID} — an unversioned payload cannot be read, and what cannot be read cannot be shown to be non-authoritative`);
  if (payload.authority !== 'none') findings.push(`PJ-R01: ${at}: authority is ${JSON.stringify(payload.authority)}, not "none" — a projection carries none, ever`);
  if (payload.banner !== NON_AUTHORITATIVE) findings.push(`PJ-R01: ${at}: the non-authoritative banner is missing or altered — this sentence is the only thing standing between a tidy card and a false approval, so it is verbatim or it is a finding`);
  if (payload.write_class !== WRITE_CLASS) findings.push(`PJ-R01: ${at}: write_class is ${JSON.stringify(payload.write_class)}, not ${JSON.stringify(WRITE_CLASS)}`);

  if (!isStr(payload.source?.sha)) findings.push(`PJ-R06: ${at}: no source commit sha — a mirror that cannot name what it mirrors is a screenshot`);
  if (!isIso(payload.projected_at)) findings.push(`PJ-R06: ${at}: no ISO-8601 projected_at — nobody can tell this board from a current one`);
  if (payload.digest !== undefined && payload.digest !== digestOf(payload)) {
    findings.push(`PJ-R06: ${at}: the payload's digest does not match its content — this is not the payload that was derived`);
  }
  if (payload.projected_by !== PROJECTOR_IDENTITY) findings.push(`PJ-R08: ${at}: projected_by is ${JSON.stringify(payload.projected_by)}, not ${PROJECTOR_IDENTITY}`);

  if (!Array.isArray(payload.records)) {
    findings.push(`PJ-R07: ${at}: no records array — an empty projection and a broken one must not look alike`);
    return findings;
  }
  for (const [i, rec] of payload.records.entries()) findings.push(...verifyRecord(rec, `${at} · record[${i}]`));

  const projected = payload.records.filter((r) => r && !r.withheld).length;
  const withheld = payload.records.filter((r) => r?.withheld).length;
  const c = payload.counts;
  if (!c || c.records !== payload.records.length || c.projected !== projected || c.withheld !== withheld) {
    findings.push(`PJ-R07: ${at}: counts do not reconcile (${JSON.stringify(c)} against ${payload.records.length} records, ${projected} projected, ${withheld} withheld) — a record dropped between derivation and publication is exactly the failure that reads as coverage`);
  }
  return findings;
}

/** Findings for one record. */
export function verifyRecord(rec, label = 'record') {
  if (!rec || typeof rec !== 'object') return [`PJ-R07: ${label}: not an object`];
  const findings = [];
  if (rec.authority !== 'none') findings.push(`PJ-R01: ${label}: authority is ${JSON.stringify(rec.authority)}, not "none" — the label lives on every card, because a card is what gets screenshotted, pasted and quoted, not the page it sat on`);
  if (rec.banner !== NON_AUTHORITATIVE) findings.push(`PJ-R01: ${label}: the non-authoritative banner is missing or altered`);

  const def = CLASSES[rec.class];
  if (!def) return [...findings, `PJ-R05: ${label}: content class ${JSON.stringify(rec.class)} is not in the ceiling — a class nobody listed has fidelity \`never\`, and unknown is withheld, never passed through`];

  for (const k of Object.keys(rec)) {
    if (!RESERVED.has(k)) findings.push(`PJ-R02: ${label}: \`${k}\` is not part of a projection record — a payload key with no entry is withheld, never passed through`);
    if (AUTHORITY_FIELDS.has(k)) findings.push(`PJ-R10: ${label}: \`${k}\` would read as governance authority on a screen that has none`);
  }

  if (rec.withheld) {
    if (rec.reason !== 'withheld — filter hit') findings.push(`PJ-R07: ${label}: a withheld record must say so in the words a reader will see ("withheld — filter hit"), because silence must never be mistaken for coverage`);
    if (!isStr(rec.filter)) findings.push(`PJ-R07: ${label}: a withheld record names no filter — an unexplained gap cannot be reviewed`);
    if (rec.fields !== undefined) findings.push(`PJ-R07: ${label}: a withheld record still carries fields — withholding is whole-record; a half-projected record reads as complete`);
    return findings;
  }

  const fields = rec.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [...findings, `PJ-R07: ${label}: no fields object and not marked withheld — a record must be one or the other`];
  const byName = new Map(def.fields.map((f) => [f.name, f]));
  for (const [k, v] of Object.entries(fields)) {
    if (AUTHORITY_FIELDS.has(k)) {
      findings.push(`PJ-R10: ${label}: field \`${k}\` is refused wherever it appears — a mirror of the cryptography that makes an approval an approval is indistinguishable on screen from the approval, and the hash chain stays in git`);
      continue;
    }
    const f = byName.get(k);
    if (!f) { findings.push(`PJ-R02: ${label}: field \`${k}\` has no entry in the ${rec.class} ceiling — deny by default; an unrecognised field is withheld and signalled, never passed through`); continue; }
    if (typeof v === 'object' && v !== null) { findings.push(`PJ-R09: ${label}: field \`${k}\` is not a scalar — no attachments, no binaries, no evidence payloads; evidence projects as a digest and a status`); continue; }
    const s = String(v);
    if (f.fidelity !== 'full-text' && /[\n\r]/.test(s)) {
      findings.push(`PJ-R03: ${label}: field \`${k}\` carries a newline but its ceiling is ${f.fidelity} — identifiers, states and dates do not contain newlines, so this is free text taking a field that was granted for a reference`);
    }
    if (s.length > CAPS[f.fidelity]) {
      findings.push(`PJ-R03: ${label}: field \`${k}\` is ${s.length} characters, above the ${f.fidelity} cap of ${CAPS[f.fidelity]} — the cap bounds volume, not sensitivity, and a field that outgrew it has stopped being what the ceiling granted`);
    }
    const hit = scan(s);
    if (hit) findings.push(`PJ-R04: ${label}: field \`${k}\` contains ${hit.why} — the whole record is withheld, not the field; a partial record reads as complete`);
  }

  if (rec.freeze !== undefined) {
    const fz = rec.freeze;
    if (!fz || typeof fz !== 'object') findings.push(`PJ-R10: ${label}: freeze block is not an object`);
    else {
      if (fz.display_only !== true || fz.read_only !== true) {
        findings.push(`PJ-R10: ${label}: the freeze/drift block is not marked display_only + read_only — D1.3 renders it, it never operates it. A drift badge that looks clickable is a control that does not exist`);
      }
      if (!DRIFT_STATES.has(fz.drift)) findings.push(`PJ-R03: ${label}: drift is ${JSON.stringify(fz.drift)}, not one of ${[...DRIFT_STATES].map((d) => JSON.stringify(d)).join(' | ')}`);
    }
  }
  return findings;
}

// --- the views (D1.2) -----------------------------------------------------------------------------

/**
 * Board, timeline, agent activity feed and MI v0 — derived from the payload, never from git a second
 * time, so a view can never show something the ceiling withheld. Withheld records appear on the board
 * as withheld cards: a board that quietly has fewer cards than the backlog is the failure mode this
 * whole module is arranged against.
 */
export function deriveViews(payload) {
  const recs = Array.isArray(payload?.records) ? payload.records : [];
  const of = (cls) => recs.filter((r) => r?.class === cls);
  const card = (r) => (r.withheld
    ? { id: r.id, withheld: true, label: 'withheld — filter hit', filter: r.filter }
    : { id: r.id, ...r.fields });
  const head = { authority: 'none', banner: NON_AUTHORITATIVE, projected_at: payload?.projected_at ?? null, source_sha: payload?.source?.sha ?? null };

  const group = (rows, key) => {
    const out = {};
    for (const r of rows) {
      const k = r.withheld ? 'withheld' : String(r.fields?.[key] ?? 'unstated');
      (out[k] ||= []).push(card(r));
    }
    return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  };

  return {
    board: { ...head, view: 'board', group_by: 'state', columns: group(of('backlog'), 'state') },
    timeline: {
      ...head,
      view: 'timeline',
      date_field: 'classified_at',
      rows: of('change').map((r) => (r.withheld ? card(r) : { id: r.id, at: r.fields?.classified_at ?? null, state: r.fields?.current_state ?? null, risk_tier: r.fields?.risk_tier ?? null })),
    },
    activity: {
      ...head,
      view: 'agent-activity',
      note: 'What the agent decided, as a bounded summary. The rationale, the tool calls and the hash chain stay in git.',
      entries: of('decision_log').map((r) => (r.withheld ? card(r) : { id: r.id, at: r.fields?.at ?? null, actor: r.fields?.actor ?? null, summary: r.fields?.summary ?? null })),
    },
    mi: {
      ...head,
      view: 'mi-v0',
      note: 'Counts, not verdicts. Every number here is a count of records that reached the floor — a withheld record is counted as withheld, never as absent.',
      records: payload?.counts?.records ?? recs.length,
      withheld: payload?.counts?.withheld ?? recs.filter((r) => r?.withheld).length,
      backlog_by_state: Object.fromEntries(Object.entries(group(of('backlog'), 'state')).map(([k, v]) => [k, v.length])),
      changes_by_state: Object.fromEntries(Object.entries(group(of('change'), 'current_state')).map(([k, v]) => [k, v.length])),
      decisions: of('decision_log').length,
    },
  };
}

// CLI: derive a payload from a git-side JSON bundle, so an adopter can see exactly what their
// projector would push — and watch a record be withheld rather than quietly disappear.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-project.mjs <git-side.json>\n  { "projected_at": "…", "source": { "sha": "…" }, "backlog": [], "changes": [], "decisions": [] }\n');
    process.exit(2);
  }
  let input;
  try { input = JSON.parse(readFileSync(path, 'utf8')); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const { payload, findings, notices } = project(input, { projectedAt: input.projected_at, source: input.source });
  for (const n of notices) process.stderr.write(`  · ${n}\n`);
  if (findings.length) {
    process.stderr.write(`\nProjection ABORTED — nothing is derived.\n\n  - ${findings.join('\n  - ')}\n`);
    process.exit(1);
  }
  const verdict = verifyProjection(payload);
  if (verdict.length) {
    process.stderr.write(`\nThe derived payload does not verify — this is a bug in the projector, not in your data.\n\n  - ${verdict.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
