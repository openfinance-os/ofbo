// The projection-capability gate (Factory Floor WS1 acceptance). The projection is one-way: the
// projector reads git and writes the floor. `core/floor-project.mjs` makes the DERIVATION one-way —
// it has no filesystem write, no network call and no token. This gate is the other half, and it is
// the half that matters, because the property WS1 has to demonstrate is not about a module:
//
//   the projector's CREDENTIALS cannot write git.
//
// A declared capability is not an active one. A config file saying `readonly: true`, a scope list in
// a token description, a row in a capability matrix — all three are the same artifact: somebody's
// account of what they believe they set up. The threat model says it plainly: the matrix asserts 99
// cells and the plan probes 2, and asserted separation is documentation while probed separation is a
// control. Privilege creep across the four seam identities is gradual, well-intentioned and
// completely invisible without a probe. So this gate reads an OBSERVED capability record — the
// adapter-contract pattern, the same shape `platform-activation-check.mjs` uses for branch
// protection: a live negative probe that was actually executed, whose result was a refusal, signed
// by an observer who is not the subject and is outside the subject's write authority, fresh.
//
// A record must carry, per forbidden capability:
//   probes[]        the capability, what was ATTEMPTED against the live platform, `result: "refused"`,
//                   and when — a capability with no probe is asserted, not observed
//   granted[]       what the credential DOES hold, which must be a subset of the three the matrix
//                   allows the projector (read git · read surface · write surface projection)
//   observer_identity  a human, in the registry, not the subject, not a builder, not an agent
//   attestation     ed25519 over the record's canonical hash, by a registered issuer
//   observed_at     fresh — default 30 days, NOT the 365 the platform gate uses (see below)
//
// It also verifies every projection payload committed under `docs/governance/projection/`, so a
// payload that has lost its non-authoritative label, gained a field outside the content ceiling, or
// dropped a withheld record silently is a build failure and not a screenshot somebody notices later.
//
// Freshness. The default window here is 30 days, not the platform gate's 365. The threat model's G-2
// records why: 365 days is far too long for a seam whose own freshness target is ten minutes, and a
// year-old probe of a token that was widened in March proves nothing about April. Adopters tighten;
// nobody should loosen without writing down what changed.
//
// Silent where unadopted. A repository with neither a capability record nor a committed projection
// projects nothing, and this gate says nothing. It tightens only where a projection actually exists.
//
// What this does NOT prove, said plainly:
//   - It proves the probe was executed and refused ONCE, at `tested_at`, by whoever ran it. It does
//     not prove the credential is still that credential. Between two probes a scope can be widened
//     in a console in ten seconds, and nothing here would know until the next run.
//   - It cannot run the probe. The live attempt needs the adopter's real credential against their
//     real platform; a public bundle cannot push to a bank's repository. What ships here is the
//     verifier, the schema, the separation rule and the freshness window. The observation is
//     adopter-side, and until one exists the projector is DECLARED read-only, not observed to be.
//   - It says nothing about what the projector WROTE. A perfectly incapable credential can still
//     publish a stale board. Content is the content ceiling's job, above.
//
//   node scripts/projection-capability-check.mjs [--max-age-days N]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import { PROJECTOR_IDENTITY, canonical, verifyProjection } from '../core/floor-project.mjs';

export const SCHEMA_ID = 'loom.projection-capability/v1';
export const CAPABILITY_DIR = ['docs/governance/projection-capability', 'projection-capability'];
export const PROJECTION_DIR = ['docs/governance/projection', 'projection'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

/** See the note above: 30 days, not 365. */
export const DEFAULT_MAX_AGE_DAYS = 30;
const DAY = 86_400_000;

/**
 * The `no` cells of the projector's row in the capability matrix (threat model §4), each with the
 * reason it is a `no`. Every one of these must be PROBED — the point of the row is that the
 * projection is incapable of the reverse direction, and incapability is the claim that needs
 * evidence. `read_git` is not here: the projector reads git, that is its job.
 */
export const FORBIDDEN = new Map([
  ['write_git_branch', 'C2 — a projector that can write a branch is not a one-way projection any more, whatever the code does'],
  ['open_pr', 'C3 — proposing a change is a write path back into git wearing a polite hat'],
  ['merge_pr', 'C4 — four-eyes (HG-0001) must be unreachable from the seam by construction, not by policy'],
  ['write_control_plane', 'C5 — CODEOWNERS, workflows, gates, release-hold.json, identities.json, attestation-issuers.json'],
  ['read_webhooks', 'C8 — an inbound event channel is where a one-way projector starts becoming a two-way sync'],
  ['sign_transcription', 'C9 — the projector reads git; there is no human act for it to transcribe'],
  ['issue_approval_assertion', 'C10 — only humans approve, and every machine row in the matrix is a no'],
  ['produce_activation_evidence', 'C11 — nobody observes their own guardrail'],
]);

/** The `yes` cells. `granted` must be a subset: a capability the matrix does not name was not reviewed. */
export const ALLOWED = new Map([
  ['read_git', 'C1 — read-only, scoped to the classes the residency record permits'],
  ['read_surface', 'C6 — projection databases only, to reconcile what it wrote'],
  ['write_surface_projection', 'C7 — the one write it holds, and it points away from git'],
]);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

/** Canonical hash of a capability record, excluding its own attestation. */
export function capabilityHash(record) {
  const { attestation, ...rest } = record || {};
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);
const isOutsideWriteAuthority = (who) => who && who.kind !== 'agent' && !(who.groups || []).includes('builders');

/**
 * Findings for one capability record. `now` / `maxAgeDays` injectable; no filesystem here.
 * Empty ⇒ the projector's credential was observed, freshly and independently, refusing every write
 * path back into git.
 *
 * Rejection codes:
 *   PJ-R20  no capability record where a projection exists — declared read-only, never observed
 *   PJ-R21  a forbidden or unreviewed capability appears in `granted`
 *   PJ-R22  the observation is self-signed or self-observed (subject observes or signs for itself,
 *           or the observer is inside the subject's write authority)
 *   PJ-R23  the observation or a probe is stale — or dated in the future
 *   PJ-R24  a probe that was not executed, or whose result is not "refused"
 *   PJ-R25  unsigned, unregistered issuer, or a signature that does not verify
 *   PJ-R26  the record's subject is not `svc-floor-projector`, or does not resolve in the registry
 *   PJ-R27  a forbidden capability with no probe at all — asserted separation, not probed
 */
export function evaluate(record, { issuers, registry, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const findings = [];
  const subject = record?.subject_identity;
  const id = isStr(subject) ? subject : '(no subject_identity)';

  if (record?.schema !== SCHEMA_ID) findings.push(`PJ-R26: ${id}: schema ${JSON.stringify(record?.schema)} is not ${SCHEMA_ID} — an unversioned observation cannot be read`);
  if (subject !== PROJECTOR_IDENTITY) {
    findings.push(`PJ-R26: ${id}: subject_identity must be ${PROJECTOR_IDENTITY} — D1.1 puts projection under one identity precisely so its capabilities are one thing to probe`);
  } else if (registry) {
    const who = identityOf(registry, subject);
    if (!who) findings.push(`PJ-R26: ${id}: does not resolve in the identity registry — a probe of an unregistered credential names nothing`);
    else if (who.roles?.length) findings.push(`PJ-R26: ${id}: holds roles ${JSON.stringify(who.roles)} — the projector holds none; a service with an approval role is the F1 defect entered as data`);
  }
  if (!isStr(record?.surface)) findings.push(`PJ-R26: ${id}: names no surface — an observation that cannot say what it observed proves nothing`);

  // What the credential DOES hold. A subset of the matrix's three yes-cells, or it is not this row.
  const granted = record?.granted;
  if (!Array.isArray(granted)) findings.push(`PJ-R21: ${id}: \`granted\` must list what the credential actually holds — an unstated grant is an unreviewed one`);
  else {
    for (const g of granted) {
      if (FORBIDDEN.has(g)) findings.push(`PJ-R21: ${id}: the credential HOLDS \`${g}\` — ${FORBIDDEN.get(g)}. The projection is not one-way while this is true, and no label on a page repairs it`);
      else if (!ALLOWED.has(g)) findings.push(`PJ-R21: ${id}: \`${g}\` is not a capability the matrix names — an unnamed capability is an unreviewed one, and unknown is refused rather than assumed harmless`);
    }
  }

  // Observer separation — you cannot probe your own incapability and be believed.
  const observer = record?.observer_identity;
  if (!isStr(observer)) findings.push(`PJ-R22: ${id}: no observer_identity — an unattributed observation is a claim`);
  else if (observer === subject) findings.push(`PJ-R22: ${id}: the subject observed itself — a credential reporting on its own limits is the declaration this gate exists to replace`);
  else if (registry) {
    const who = identityOf(registry, observer);
    if (!who) findings.push(`PJ-R22: ${id}: observer_identity ${JSON.stringify(observer)} does not resolve in the identity registry`);
    else {
      if (who.kind !== 'human') findings.push(`PJ-R22: ${id}: observer ${JSON.stringify(observer)} is kind ${JSON.stringify(who.kind)} — a probe is witnessed by a person`);
      if (!isOutsideWriteAuthority(who)) findings.push(`PJ-R22: ${id}: observer ${JSON.stringify(observer)} is inside the write authority being probed (a builder or an agent) — an observation of your own seam is not independent`);
    }
  }
  if (isStr(record?.attestation?.issuer) && record.attestation.issuer === subject) {
    findings.push(`PJ-R22: ${id}: the record is signed by the subject's own issuer — self-signed evidence of self-restraint`);
  }
  const issuerEntry = (issuers?.issuers || []).find((i) => i.id === record?.attestation?.issuer);
  if (issuerEntry && isStr(issuerEntry.identity) && issuerEntry.identity === subject) {
    findings.push(`PJ-R22: ${id}: the signing issuer ${JSON.stringify(issuerEntry.id)} belongs to the subject — self-signed`);
  }

  // Every forbidden capability must have been ATTEMPTED and REFUSED.
  const probes = Array.isArray(record?.probes) ? record.probes : [];
  if (!Array.isArray(record?.probes)) findings.push(`PJ-R27: ${id}: no probes array — the matrix's ${FORBIDDEN.size} no-cells are asserted, not observed`);
  const probed = new Set();
  for (const [i, p] of probes.entries()) {
    const at = `${id} · probe[${i}]${isStr(p?.capability) ? ` ${p.capability}` : ''}`;
    if (!isStr(p?.capability)) { findings.push(`PJ-R24: ${at}: names no capability`); continue; }
    if (!FORBIDDEN.has(p.capability)) findings.push(`PJ-R24: ${at}: is not one of the capabilities the matrix forbids the projector — probing something else does not discharge the ones it does`);
    probed.add(p.capability);
    if (!isStr(p.attempted)) findings.push(`PJ-R24: ${at}: names no attempted action — "we checked" is not a probe; the record must say what was actually tried against the live platform`);
    if (p.result !== 'refused') findings.push(`PJ-R24: ${at}: result is ${JSON.stringify(p.result)}, not "refused" — the platform did not refuse the write, so the incapability is unproven and may well be false`);
    const t = parseTime(p.tested_at);
    if (t === null) findings.push(`PJ-R23: ${at}: no ISO-8601 tested_at`);
    else if (now - t > maxAgeDays * DAY) findings.push(`PJ-R23: ${at}: probed ${Math.floor((now - t) / DAY)} days ago (limit ${maxAgeDays}) — a scope widened since is invisible from here`);
    else if (t > now) findings.push(`PJ-R23: ${at}: tested_at ${p.tested_at} is in the future — a probe that has not happened yet has not happened`);
  }
  for (const [cap, why] of FORBIDDEN) {
    if (!probed.has(cap)) findings.push(`PJ-R27: ${id}: \`${cap}\` was never probed — ${why}. Asserted separation is documentation; probed separation is a control`);
  }

  // Freshness of the observation itself.
  const obs = parseTime(record?.observed_at);
  if (obs === null) findings.push(`PJ-R23: ${id}: no ISO-8601 observed_at`);
  else if (now - obs > maxAgeDays * DAY) findings.push(`PJ-R23: ${id}: the observation is ${Math.floor((now - obs) / DAY)} days old (limit ${maxAgeDays}) — nobody has looked recently enough for this to be trusted`);
  else if (obs > now) findings.push(`PJ-R23: ${id}: observed_at ${record.observed_at} is in the future`);

  // Authentically signed by a registered issuer.
  findings.push(...verifySignatureOver(capabilityHash(record), record?.attestation, issuers, `projection-capability record for ${id}`).map((f) => `PJ-R25: ${id}: ${f}`));
  return findings;
}

const findDir = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const jsonFiles = (dir) => (dir ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort() : []);

/**
 * Filesystem wiring. Silent where a repository projects nothing: no capability record AND no
 * committed projection means the floor was never adopted, and an adopter who runs no external
 * surface must not be handed a red gate for a capability they may never switch on.
 */
export function run(cwd = process.cwd(), { now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const capDir = findDir(cwd, CAPABILITY_DIR);
  const projDir = findDir(cwd, PROJECTION_DIR);
  const capFiles = jsonFiles(capDir);
  const projFiles = jsonFiles(projDir);
  if (capFiles.length === 0 && projFiles.length === 0) return { findings: [], records: 0, payloads: 0, adopted: false };

  const findings = [];
  const issuers = loadIssuers(cwd) || loadIssuers(`${cwd}/..`);
  const registryPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const registry = registryPath ? readJson(registryPath) : null;

  if (projFiles.length > 0 && capFiles.length === 0) {
    findings.push(`PJ-R20: a projection is published (${projFiles.length} payload${projFiles.length === 1 ? '' : 's'} under ${projDir.slice(cwd.length + 1)}) but no capability record exists — the projector is DECLARED read-only and has never been observed to be. A declared capability is not an active one`);
  }
  for (const name of capFiles) {
    const rec = readJson(`${capDir}/${name}`);
    if (!rec) { findings.push(`PJ-R26: ${name}: not readable as JSON`); continue; }
    findings.push(...evaluate(rec, { issuers, registry, now, maxAgeDays }));
  }
  for (const name of projFiles) {
    const payload = readJson(`${projDir}/${name}`);
    if (!payload) { findings.push(`PJ-R01: ${name}: not readable as JSON — a file in the projection directory that is not a labelled projection`); continue; }
    findings.push(...verifyProjection(payload, name));
  }
  return { findings, records: capFiles.length, payloads: projFiles.length, adopted: true };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--max-age-days');
  const maxAgeDays = i >= 0 ? Number(process.argv[i + 1]) : DEFAULT_MAX_AGE_DAYS;
  const { findings, records, payloads, adopted } = run(process.cwd(), { maxAgeDays });
  if (findings.length) {
    process.stderr.write('\nProjection-capability gate (WS1) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe projection is one-way or it is not a projection. The projector reads git and writes\nthe floor; that it CANNOT do the reverse is observed with a live, refused probe, signed by\nsomeone who is not the projector — never declared in a config file. See\ndocs/notion-floor-threat-model.md §4 (the capability matrix) and the WS1 acceptance.\n');
    process.exit(1);
  }
  process.stdout.write(adopted
    ? `Projection-capability gate (WS1) — OK (${records} observed capability record${records === 1 ? '' : 's'}, ${payloads} projection payload${payloads === 1 ? '' : 's'} verified non-authoritative)\n`
    : 'Projection-capability gate (WS1) — nothing is projected (no floor adopted)\n');
}
