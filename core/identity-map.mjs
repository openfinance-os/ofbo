// The identity map — the join that turns a bound subject into a proven one (Factory Floor P6 ·
// D0.4 part 2, specified in `docs/notion-floor-identity-mapping.md`).
//
// `core/approval-attestations.mjs` names this gap in its own header and does not close it: the
// identity-provider subject and the registry identity sit side by side under the human's
// signature, so neither can be altered afterwards — but nothing independent asserts they are the
// same person. A compromised bridge holding a valid assertion for subject A could name registry
// identity B, and every check there would still pass. This module is the independent assertion.
//
// The pivot is the IdP subject, never the workspace person id and NEVER an email address. A
// workspace id is reassignable; an address is a routing label an attacker can control and a
// person can change. Neither is an identity. The map's shape has no field for either — that is
// deliberate, and an entry carrying one is refused rather than ignored (§2.3).
//
// THE MAP IS THE AUTHORITY; THE RECORD IS A CLAIM. The attestation's `registry_id` is written by
// whoever composed the file. Resolution reads the map's entry for the signed `idp_subject` and
// refuses if the two disagree — that is the whole point, and it is why the map may never be
// written by a service (§7.1) and lives under second-line CODEOWNERS.
//
// Roles are NEVER granted here. `roles_at_mapping` is an audit snapshot. If a gate read it as
// authority the map would become a second, invisible role registry that the policy compiler
// cannot see — so this module reads roles from `identities.json` at verification time, always,
// and reports IM-R22 when a required role exists only in the snapshot.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.identity-map/v1';
export const IDENTITY_MAP_LOCATIONS = ['docs/governance/identity-map.json', 'identity-map.json'];
/** The capability a compiled plan sets to make the mapping join mandatory. */
export const CAPABILITY = 'identity_map';

export const VERIFICATION_METHODS = new Set(['assertion-derived', 'directory-plus-console']);
export const REVOCATION_CLASSES = new Set(['departed', 'account-reprovisioned', 'for-cause']);
export const STATUSES = new Set(['active', 'revoked']);

/**
 * Fields the schema does not have, refused on sight. §2.3: any path that establishes identity by
 * comparing addresses is refused AT REVIEW, so it has no rejection code of its own — it must
 * never reach a gate. Carrying the field at all is the thing that makes the shortcut available,
 * so the refusal is of the field, not of its use.
 */
export const FORBIDDEN_FIELDS = ['email', 'email_address', 'mail', 'display_name', 'name', 'title', 'workspace_group', 'group'];

/** Default freshness for the reconciliation observation (§4.4 proposes daily; adopters tighten). */
export const RECONCILIATION_MAX_AGE_DAYS = 7;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/** ISO-8601 only — the type is part of the check, as in the attestation contract. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const DAY = 86400000;

export function loadIdentityMap(cwd = process.cwd()) {
  const path = IDENTITY_MAP_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Is this change's plan requiring the mapping join? (mandatory-when-compiled) */
export function mapRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

const activeEntries = (map) => (map?.entries || []).filter((e) => e?.status === 'active');

/**
 * The map file's own soundness (step 12 · IM-R23, IM-R20, IM-R24, IM-R25). An unsound map
 * resolves nothing, so these findings are reported against the FILE and every approval that
 * depends on it is refused separately — a map that fails here is not a map with a warning.
 *
 * `reconciliation` is the signed observation from §4.4 — the independent observer's live read of
 * both authoritative sides. Absent or stale, mapping currency is unproven: observed, not declared.
 */
export function checkMapInvariants(map, registry, { now = Date.now(), reconciliation = null, maxAgeDays = RECONCILIATION_MAX_AGE_DAYS } = {}) {
  const findings = [];
  if (!map) return [`IM-R23: no identity map at ${IDENTITY_MAP_LOCATIONS[0]} — an unmapped surface resolves no human`];
  if (map.schema !== SCHEMA_ID) {
    return [`IM-R23: schema ${JSON.stringify(map.schema)} is not ${SCHEMA_ID} — an unversioned map cannot be read`];
  }

  const seen = { idp_subject: new Map(), notion_person_id: new Map(), registry_id: new Map() };
  for (const [i, e] of (map.entries || []).entries()) {
    const at = `IM-R23: entry ${i}${isStr(e?.registry_id) ? ` (${e.registry_id})` : ''}`;
    if (!e || typeof e !== 'object') { findings.push(`${at}: not an object`); continue; }

    for (const f of FORBIDDEN_FIELDS) {
      if (f in e) findings.push(`${at}: carries \`${f}\` — the map has no field for it. Identity is the IdP subject; an address or display name is a routing label, and comparing them is refused at review, not at runtime`);
    }
    for (const f of ['notion_person_id', 'idp_subject', 'registry_id', 'mapped_at', 'mapped_by', 'status']) {
      if (!isStr(e[f])) findings.push(`${at}: ${f} missing`);
    }
    if (!Array.isArray(e.roles_at_mapping)) findings.push(`${at}: roles_at_mapping must be an array — it is an audit snapshot, and an absent one hides what was true at mapping time`);
    if (!STATUSES.has(e.status)) findings.push(`${at}: status must be active|revoked (got ${JSON.stringify(e.status)}) — there is no \`pending\`; an unmerged entry is not an entry`);
    if (!VERIFICATION_METHODS.has(e.verification?.method)) findings.push(`${at}: verification.method must be ${[...VERIFICATION_METHODS].join(' | ')}`);
    if (!isStr(e.verification?.reference)) findings.push(`${at}: verification.reference missing — an auditor must be able to follow the binding to the act that established it`);
    if (parseTime(e.mapped_at) === null) findings.push(`${at}: mapped_at is not a parseable ISO-8601 timestamp`);

    // Invariant 4 · no self-mapping. A person may not attest to their own binding, for the same
    // reason a builder may not issue their own second-line approval.
    if (isStr(e.mapped_by) && e.mapped_by === e.registry_id) {
      findings.push(`${at}: mapped_by is the subject itself — nobody attests to their own binding`);
    }
    findings.push(...checkMapper(registry, e.mapped_by, at));

    if (e.status === 'revoked') {
      if (parseTime(e.revoked_at) === null) findings.push(`${at}: revoked without a parseable revoked_at — the moment authority ended is what decides in-flight approvals`);
      if (!isStr(e.revoked_by)) findings.push(`${at}: revoked without revoked_by`);
      if (!REVOCATION_CLASSES.has(e.revocation_class)) findings.push(`${at}: revocation_class must be ${[...REVOCATION_CLASSES].join(' | ')} — the class changes what happens to in-flight approvals`);
    }

    // IM-R20 · no service identity may be a mapped human subject. A mapping asserts that a HUMAN
    // clicked; a service has no human behind its credential, and mapping one would make the
    // bridge's own key a valid approver — F1 restated as a data-entry error.
    const who = (registry?.identities || []).find((x) => x.id === e.registry_id);
    if (isStr(e.registry_id) && !who) findings.push(`IM-R16: entry ${i}: registry_id ${JSON.stringify(e.registry_id)} is not in the identity registry`);
    else if (who && who.kind !== 'human') findings.push(`IM-R20: entry ${i}: ${e.registry_id} is kind ${JSON.stringify(who.kind)} — a service has no clicks to attest to`);

    if (e.status !== 'active') continue;
    // Invariant 1 · uniqueness, on all three axes. Ambiguity resolves to refusal, never to a pick.
    for (const key of ['idp_subject', 'notion_person_id', 'registry_id']) {
      if (!isStr(e[key])) continue;
      const prior = seen[key].get(e[key]);
      if (prior !== undefined) {
        findings.push(`IM-R10: entries ${prior} and ${i} both hold active ${key} ${JSON.stringify(e[key])} — one human is one registry identity wearing several hats, which is one entry, not several`);
      } else seen[key].set(e[key], i);
    }
  }

  // Reconciliation is only meaningful once there is something to reconcile. A map an adopter has
  // copied but not yet populated is not a stale map — it is an unused one, and demanding a signed
  // observation for zero entries would hand every adopter a red gate for a capability they may
  // never switch on. The moment one entry exists, currency is required: that is where "observed,
  // not declared" starts to mean something.
  if (activeEntries(map).length > 0) findings.push(...checkReconciliation(reconciliation, map, { now, maxAgeDays }));
  return findings;
}

/**
 * `mapped_by` must be a human who is not a builder and who holds a second-line or
 * information-security role — the verifier of a binding is a control function, not a teammate.
 */
function checkMapper(registry, mappedBy, at) {
  if (!isStr(mappedBy) || !registry) return [];
  const who = (registry.identities || []).find((x) => x.id === mappedBy);
  if (!who) return [`${at}: mapped_by ${JSON.stringify(mappedBy)} is not in the identity registry`];
  const findings = [];
  if (who.kind !== 'human') findings.push(`${at}: mapped_by ${mappedBy} is not a human — a binding is verified by a person`);
  const builders = registry.groups?.builders || [];
  if (builders.includes(mappedBy)) findings.push(`${at}: mapped_by ${mappedBy} is a builder — the function that verifies who may approve cannot be the function being approved`);
  const roles = who.roles || [];
  if (!roles.some((r) => /second-line|information-security|compliance/.test(r))) {
    findings.push(`${at}: mapped_by ${mappedBy} holds no control-function role (${roles.join(', ') || 'none'}) — ADOPT: set which function your institution assigns to verify bindings`);
  }
  return findings;
}

/**
 * IM-R24 / IM-R25 — the map is only as current as the last time someone looked. Three systems,
 * three lifecycles, no shared transaction: drift is a permanent condition, not a bug fixed once.
 * Absent or stale observation ⇒ currency is unproven, and unproven is refused.
 */
export function checkReconciliation(reconciliation, map, { now = Date.now(), maxAgeDays = RECONCILIATION_MAX_AGE_DAYS } = {}) {
  if (!reconciliation) {
    return [`IM-R24: no reconciliation observation — the map's currency is unproven, so it is UNVERIFIED-HERE (observed, not declared)`];
  }
  const findings = [];
  const at = parseTime(reconciliation.observed_at);
  if (at === null) findings.push('IM-R24: reconciliation observed_at is missing or not a parseable ISO-8601 timestamp');
  else if (now - at > maxAgeDays * DAY) {
    findings.push(`IM-R24: the reconciliation observation is ${Math.floor((now - at) / DAY)} days old (limit ${maxAgeDays}) — nobody has looked recently enough for the map to be trusted`);
  }
  if (!isStr(reconciliation.observed_by)) findings.push('IM-R24: reconciliation names no observer — an unattributed observation is a claim');
  // The directory is authoritative over the map: a subject the IdP reports disabled is refused
  // even while the entry still reads `active`, because landing the revocation PR takes a human.
  for (const s of (reconciliation.disabled_subjects || [])) {
    if (activeEntries(map).some((e) => e.idp_subject === s)) {
      findings.push(`IM-R25: subject ${JSON.stringify(s)} is disabled at the identity provider but still holds an active mapping — the directory is authoritative over the map`);
    }
  }
  return findings;
}

/** Was the binding live at instant `t`? Step 11 — authority must have existed when it was exercised. */
export function mappingActiveAt(entry, t) {
  const from = parseTime(entry?.mapped_at);
  if (from === null || t === null) return false;
  if (t < from) return false;
  if (entry.status === 'active') return true;
  const until = parseTime(entry.revoked_at);
  return until !== null && t < until;
}

/**
 * The per-approval join: resolution steps 3, 4, 5, 11 and 22 (IM-R09…R15, IM-R22).
 *
 * `rec` is a verified `loom.approval-attestation/v1` record — this runs AFTER the cryptography,
 * because a mapping lookup on an unverified subject would be asking the map to arbitrate a claim
 * nobody signed. ctx: { map, registry, role, now }.
 *
 * Findings ([] ⇒ the signed subject is, independently of the record's own claim, this human).
 */
export function verifyMapping(rec, ctx, label = 'approval') {
  const subject = rec?.subject?.idp_subject;
  if (!isStr(subject)) return [`${label} · IM-R07: no idp_subject to resolve — a workspace-scoped person id is reassignable`];
  if (!ctx?.map) return [`${label} · IM-R09: no identity map — an unmapped human is an unknown human`];

  const matches = activeEntries(ctx.map).filter((e) => e.idp_subject === subject);
  if (matches.length === 0) {
    return [`${label} · IM-R09: no active mapping for the signed subject — an unmapped human is an unknown human. There is no fallback: no nearest match, no resolution by name, no override. The route past this is a merged PR that changes the map`];
  }
  if (matches.length > 1) {
    return [`${label} · IM-R10: ${matches.length} active mappings for the signed subject — ambiguity resolves to refusal, never to a pick`];
  }
  const entry = matches[0];
  const findings = [];

  // Step 4 · the map is the authority. The record's registry_id is a claim by whoever wrote the
  // file — this is the check that closes "bound but not joined".
  if (entry.registry_id !== rec?.subject?.registry_id) {
    findings.push(`${label} · IM-R11: the map binds this subject to ${JSON.stringify(entry.registry_id)} but the record claims ${JSON.stringify(rec?.subject?.registry_id)} — the map is the authority, the record is a claim`);
  }
  // Step 5 · the click and the mapping must be the same account.
  const personId = rec?.origin?.person_id;
  if (isStr(personId) && personId !== entry.notion_person_id) {
    findings.push(`${label} · IM-R12: the decision originated from person id ${JSON.stringify(personId)} but the mapping names ${JSON.stringify(entry.notion_person_id)} — the click and the mapping must be the same account`);
  }

  // Step 11 · active AT THE DECISION, judged against the signed decision time. Judging against
  // verification time would revoke history: a decision made in March was made by someone who held
  // the mapping in March, and a later leaver event does not unmake it (§6, and D4.2's narrowing).
  const t = parseTime(rec?.validity?.issued_at);
  if (t === null) {
    findings.push(`${label} · IM-R15: no signed decision time — an unanchored decision cannot be tested against a lifecycle`);
  } else if (!mappingActiveAt(entry, t)) {
    findings.push(entry.status === 'revoked' && parseTime(entry.revoked_at) !== null && t >= parseTime(entry.revoked_at)
      ? `${label} · IM-R13: the mapping was revoked at ${entry.revoked_at} (class ${entry.revocation_class || 'unstated'}), before the decision at ${rec.validity.issued_at} — a revoked binding grants nothing`
      : `${label} · IM-R14: the mapping was not active at the decision time ${rec.validity.issued_at} (mapped_at ${entry.mapped_at}) — authority must have existed when it was exercised`);
  }

  // Step 22 · the snapshot is not a role registry. Reading `roles_at_mapping` as authority would
  // create a second, invisible role source the policy compiler cannot see. It is only ever read
  // HERE, to say so out loud when it is the reason someone expected the approval to pass.
  if (isStr(ctx.role) && Array.isArray(entry.roles_at_mapping) && entry.roles_at_mapping.includes(ctx.role)) {
    const who = (ctx.registry?.identities || []).find((x) => x.id === entry.registry_id);
    if (who && !(who.roles || []).includes(ctx.role)) {
      findings.push(`${label} · IM-R22: ${entry.registry_id} held ${JSON.stringify(ctx.role)} at mapping time but does not hold it in the registry now — roles_at_mapping is an audit snapshot, never an authorisation source`);
    }
  }
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// CLI: report the map's own soundness, so an adopter can check the file before any approval
// depends on it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = process.argv[2] || process.cwd();
  const map = loadIdentityMap(cwd);
  const registry = readJson(`${cwd}/docs/governance/identities.json`) || readJson(`${cwd}/identities.json`);
  const findings = checkMapInvariants(map, registry, { reconciliation: readJson(`${cwd}/docs/governance/identity-map-reconciliation.json`) });
  if (findings.length) {
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(`Identity map — OK (${activeEntries(map).length} active entries)\n`);
}
