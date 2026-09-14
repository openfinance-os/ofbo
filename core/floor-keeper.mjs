// The floor-keepers (Factory Floor WS6 · D6.3). Floor-keeper Custom Agents do the paperwork a
// human should not have to do: they prefill the non-judgment fields, they converse, and they route.
// They are the whole of G5 — "agents do the labour; humans do judgment" — and they are the point at
// which the method's loudest promise, AGENTS APPROVE NOTHING, is either true or decorative.
//
// THE GRANT MODEL IS COARSER THAN THE RISK. This is the fact the whole module is arranged around,
// and it is a property of the platform, not of anyone's configuration. A collaboration surface
// grants access per PAGE or per DATABASE. It does not grant access per PROPERTY. So the sentence
// everybody reaches for in a design review —
//
//     "the agent can read the change but it cannot edit the approval field"
//
// — is NOT EXPRESSIBLE AS A GRANT. There is no such grant. Anyone who believes they have made that
// arrangement has instead given an agent edit access to a container that happens to contain an
// approval property, and is relying on the agent not touching it. That is not a control; it is a
// hope with an audit trail.
//
// The only sound answer is PHYSICAL SEPARATION: approval fields live in a container the floor-keeper
// holds NO GRANT ON AT ALL. Not read-only. Not comment-only. None. That is what D6.3 says and it is
// what this module makes checkable:
//
//   · a floor-keeper holding ANY grant, at ANY level, on a container that carries an approval field
//     is a finding (FK-R03) — `can-view` included, because "no grant of any kind" is the requirement
//     and a view grant is the first step of the creep that ends in an edit grant;
//   · a grant that CLAIMS property-level scope is refused outright (FK-R05), because a claim to a
//     protection the platform cannot provide is worse than no claim: it reads as configured;
//   · a container that mixes approval fields with fields a keeper is meant to prefill is a finding
//     (FK-R07) even when no keeper holds a grant on it today — the separation is not expressible
//     there, so the first person who needs a prefill will have to break it;
//   · a floor-keeper holding a registry ROLE is a finding (FK-R02), which is the same defect one
//     layer down: `identity-registry-check.mjs` refuses an agent with roles, and this refuses the
//     floor-keeper subset of that for the same reason and says so in the WS6 vocabulary.
//
// WHAT "APPROVAL FIELD" MEANS HERE IS BORROWED, DELIBERATELY. `AUTHORITY_FIELDS` in
// `core/floor-project.mjs` is the list of fields a projection refuses wherever they appear — the
// cryptography that makes an approval an approval. It is exactly the same question asked from the
// other side: the projector may not MIRROR them, and a floor-keeper may not hold a grant on the
// container that HOLDS them. One list, imported, not copied — two lists would drift and the drift
// would be silent. See the note on `APPROVAL_FIELDS` for why the set is deliberately over-broad.
//
// AND THE ATTEMPT IS VOID, NOT DISCOURAGED. `attemptedApproval()` returns `void: true` for every
// floor-side approval attempt, and there is no argument, field or configuration that makes it
// return anything else. That is the acceptance test D6.3 asks for, and it is a property of the
// function rather than a policy: validity comes only from a subject-bound assertion minted off the
// floor and merged into git (`core/approval-attestations.mjs`, TB-0 in the threat model), and there
// is no route from a floor page to that. A misconfigured register, a keeper wrongly given a role, a
// container wrongly marked authoritative, a payload with a `signature` field on it — each of those
// is its own finding here, and NONE of them makes the attempt effective. Several independent
// reasons hold it void, which is the only kind of "void" worth writing down: a single-reason
// voidance is one refactor away from being a bug.
//
// SILENT WHERE UNADOPTED. A repository that runs no collaboration surface declares no keepers, and
// this module says nothing about it. `scripts/floor-keeper-check.mjs` is the filesystem half.
//
// WHAT THIS DOES NOT DO, said plainly, because the placement of a checker flatters it:
//
//   - It reads a DECLARED register, not the live workspace. Grants change in a console in ten
//     seconds and nothing here would know. That is why `audit` is mandatory and its freshness is
//     checked (FK-R09): the register is a claim, and the audit is somebody saying they went and
//     looked. Asserted separation is documentation; audited separation is a control; and even an
//     audit is a photograph, not a live read.
//   - It cannot see a page FILED IN THE WRONG CONTAINER. That is T-12's stated residual and it
//     survives every check in this file: an approval page dragged into a keeper-granted database
//     carries its properties with it, and the register still reads clean. The only defences are the
//     template's write class, the container audit, and the fact that git is the record.
//   - It says nothing about a HUMAN who clicks approve on a keeper's recommendation without
//     reading it. That is the method's standing comprehension debt (T-02's medium residual) and no
//     grant model addresses it.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AUTHORITY_FIELDS } from './floor-project.mjs';

export const SCHEMA_ID = 'loom.floor-keeper-grants/v1';

/** The capability a compiled plan sets to make the grant register mandatory. */
export const CAPABILITY = 'floor_keepers';

/**
 * The two write scopes D6.3 permits a floor-keeper: it may arrange what is SHOWN, and it may TALK.
 * Neither writes a field. Anything else — page content, properties, comments-as-approval, database
 * schema — is outside the scope and is FK-R04, including scopes that sound harmless. The list is
 * closed on purpose: an unlisted scope is an unreviewed one.
 */
export const WRITE_SCOPE = new Set(['views', 'conversation']);

/**
 * Grant levels a collaboration surface actually offers. Every one of them is a finding on a
 * container carrying approval fields — the level is recorded so a reader can see how far the
 * mistake went, never to decide whether it counts.
 */
export const GRANT_LEVELS = new Set(['full-access', 'can-edit', 'can-edit-content', 'can-comment', 'can-view']);

/**
 * Keys a grant may not carry, refused on sight — the `FORBIDDEN_FIELDS` idiom from
 * `core/identity-map.mjs`. A grant naming a property or a column is asserting a protection the
 * platform does not implement. The refusal is of the FIELD, not of its use: carrying it at all is
 * what makes the shortcut available, and a register that reads as property-scoped will be believed.
 */
export const FORBIDDEN_GRANT_FIELDS = ['property', 'properties', 'field', 'fields', 'column', 'columns'];

/**
 * What makes a container authoritative: it carries one of these fields. IMPORTED from
 * `core/floor-project.mjs` rather than restated — same list, same reason, asked from the other side.
 *
 * The set is DELIBERATELY OVER-BROAD. It contains `key`, `token`, `issuer`, `nonce` and `prev`, so a
 * database with a property innocently titled "Key Decision" is treated as approval-carrying and its
 * keepers lose a grant they did not need. That is the direction to be wrong in: over-broad costs a
 * keeper a convenience, under-broad costs the method the one promise it makes loudest. An adopter
 * who hits a genuine false positive renames the property — which is a smaller act than widening the
 * list, and unlike widening it, it leaves the separation intact.
 *
 * AND IT WAS UNDER-BROAD IN THE DIRECTION THAT COSTS THE PROMISE. This was `AUTHORITY_FIELDS`
 * outright, which answers a DIFFERENT question: *"would this field, projected onto a read-only
 * mirror, read as governance authority?"* — attestation, signature, plan_hash, nonce, token. That is
 * not the same as *"does this container carry an approval?"*, and the gap was exactly the words a
 * human uses. `Sign-off`, `Signed off by`, `Approver` and `Decision` all matched **nothing**.
 *
 * So an approvals database titled the way people actually title one read as carrying no approval
 * field at all: a keeper grant on it raised nothing, and `FK-R11`'s vacuity check was satisfied by
 * any *other* container that happened to match. D6.3's whole promise — approval fields live where
 * the keeper holds no grant — cannot hold when the gate cannot see an approval field. Found while
 * building the worked example, because choosing property names for a realistic approvals database
 * is the first act that puts the vocabulary under pressure.
 *
 * The union below keeps every authority term (nothing previously detected stops being detected) and
 * adds the approval vocabulary — but only words that RECORD an approval. Two were tried and
 * deliberately excluded:
 *
 *   `outcome` — too generic, and the suite already rejected it before this fix was written.
 *   `decision` — the interesting one, because including it put **D5.1 and D6.3 into direct
 *     conflict**. D5.1 requires a floor-keeper to assemble the evidence an approver reads, and that
 *     evidence sits in its own container precisely so the keeper CAN write it while holding no grant
 *     where the approval lives. An evidence pack summarising a decision naturally carries a
 *     `Decision` property — so treating `decision` as approval-carrying makes the very container the
 *     keeper MUST write into one the keeper may NOT touch. The worked example failed on exactly that
 *     (`FK-R08`), which is how the conflict surfaced rather than shipping. A decision-log mirror has
 *     the same shape.
 *
 * So the line is: a field recording WHO approved, or WHETHER they did, is an approval field; a field
 * describing WHAT WAS DECIDED is not. `Approver`, `Sign-off`, `Signed off by`, `Verdict`,
 * `Countersigned by`, `Ratified by` record. `Decision` and `Outcome` describe.
 */
export const APPROVAL_VOCABULARY = new Set([
  'approver', 'approvers', 'approve', 'approves', 'approved', 'approval', 'approvals',
  'sign_off', 'signoff', 'signed_off', 'signed_off_by', 'countersigned', 'countersigned_by',
  'verdict',
  'ratified', 'ratified_by', 'endorsed', 'endorsed_by',
  'authorised', 'authorised_by', 'authorized', 'authorized_by',
]);

export const APPROVAL_FIELDS = new Set([...AUTHORITY_FIELDS, ...APPROVAL_VOCABULARY]);

/** How old a grant audit may be before separation is asserted rather than audited (adopters tighten). */
export const GRANT_AUDIT_MAX_AGE_DAYS = 30;

/**
 * The sentence a surface must show where a floor-keeper's act might be mistaken for a decision.
 * A constant, not a parameter, for the same reason `NON_AUTHORITATIVE` is one: a configurable
 * notice is a notice somebody eventually configures away.
 */
export const VOID_NOTICE = 'VOID — nothing on this floor approves anything. An approval acquires validity only from a subject-bound assertion issued away from this surface and merged into git, and no agent may issue one. Whatever was clicked, typed or prefilled here, no gate read it and no record changed.';

/**
 * Rejection codes, in the style of `core/identity-map.mjs`'s `IM-Rnn` — so an operator reading a
 * red build can look up exactly what was refused and why.
 *
 *   FK-R01  the register, or a container in it, cannot be read as one — no schema, no id, no kind,
 *           no declared containers. Unreadable is refused, never treated as empty: an empty
 *           register and an unparseable one must not produce the same green tick.
 *   FK-R02  a floor-keeper holds a REGISTRY ROLE, or sits in a control-function group. Agents
 *           prepare evidence; they never approve. The register's own `roles` claim is refused too —
 *           the registry is the authority, but a register that ASKS for a role has already told you
 *           what somebody intends.
 *   FK-R03  a floor-keeper holds a grant — at any level — on a container that carries an approval
 *           field; or on a container the register does not declare; or at a level the surface does
 *           not offer. THE headline code of D6.3.
 *   FK-R04  a write scope beyond views + conversation, or no declared write scope at all.
 *   FK-R05  a grant claiming property-level scope. There is no such grant. A claim to a protection
 *           the platform cannot provide is worse than no claim, because it reads as configured.
 *   FK-R06  a floor-keeper that does not resolve in the identity registry, or that is not an agent.
 *   FK-R07  a container mixing approval fields with fields a keeper is meant to prefill —
 *           separation is not EXPRESSIBLE there, whatever today's grants happen to be.
 *   FK-R08  a container carrying approval fields that does not declare itself authoritative, or a
 *           container that does not say either way. A mislabelled container is how a page ends up
 *           in the wrong database.
 *   FK-R09  the grant audit is absent, stale, self-audited, or skipped a container. The register is
 *           a claim; the audit is somebody saying they went and looked.
 *   FK-R10  a floor-side approval attempt PRESENTED as having effect — displayed as an approval,
 *           labelled with an authority, or handed to something that reads gates. The attempt is
 *           void either way; this code fires on the presentation, which is the part that misleads.
 *   FK-R11  the register declares no container carrying approval fields and does not say it routes
 *           no approvals — so the separation it certifies is vacuous.
 */
export const REJECTIONS = new Map([
  ['FK-R01', 'the register or one of its containers cannot be read as one — unreadable is refused, never read as empty'],
  ['FK-R02', 'a floor-keeper holds a registry role or a control-function group membership'],
  ['FK-R03', 'a floor-keeper holds a grant on a container that carries approval fields'],
  ['FK-R04', 'a write scope beyond views + conversation'],
  ['FK-R05', 'a grant claiming property-level scope — the platform grants per container, never per property'],
  ['FK-R06', 'a floor-keeper that is not a registered agent identity'],
  ['FK-R07', 'a container mixing approval fields with prefillable ones — separation is not expressible there'],
  ['FK-R08', 'a container carrying approval fields that is not declared authoritative'],
  ['FK-R09', 'the grant audit is absent, stale, self-audited, or incomplete'],
  ['FK-R10', 'a floor-side approval attempt presented as having effect'],
  ['FK-R11', 'the register certifies a separation it never describes — no approval-carrying container, and no statement that none exists'],
]);

/** Groups a machine has no business in. `builders` is not here: first-line labour is the job. */
export const CONTROL_FUNCTION_GROUPS = new Set(['second-line', 'platform-admins']);

const DAY = 86400000;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/** ISO-8601 only — the type is part of the check, as everywhere else in the harness. */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

// --- what counts as an approval field -------------------------------------------------------------

/** `"Approved By (2nd line)"` → `approved_by_2nd_line`. Vendor property titles are prose, not keys. */
export function normalizeFieldName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Does this property title name an approval field? Matched over every contiguous run of tokens, not
 * just the whole string, so `"PA1 Approval"`, `"Risk Sign-off Signature"` and `"Release Hold state"`
 * all hit — a property title is written by a human for humans and will never equal a schema key.
 * The same normalise-then-match discipline `core/floor-project.mjs` uses on payload content.
 */
export function isApprovalField(name) {
  const norm = normalizeFieldName(name);
  if (!norm) return false;
  if (APPROVAL_FIELDS.has(norm)) return true;
  const t = norm.split('_').filter(Boolean);
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j <= t.length; j++) {
      if (APPROVAL_FIELDS.has(t.slice(i, j).join('_'))) return true;
    }
  }
  return false;
}

/** Declared property titles of a container. Accepts `"title"` or `{ name: "title" }`. */
export function fieldNamesOf(container) {
  const raw = Array.isArray(container?.fields) ? container.fields : [];
  return raw.map((f) => (isStr(f) ? f : isStr(f?.name) ? f.name : null)).filter(isStr);
}

/** The declared property titles of `container` that are approval fields, in declaration order. */
export function approvalFieldsOf(container) {
  return fieldNamesOf(container).filter(isApprovalField);
}

const prefillNamesOf = (container) => {
  const raw = Array.isArray(container?.prefill) ? container.prefill : [];
  return raw.map((f) => (isStr(f) ? f : isStr(f?.name) ? f.name : null)).filter(isStr);
};

// --- the register's parts -------------------------------------------------------------------------

/** Is this change's plan requiring the grant register? (mandatory-when-compiled) */
export function keepersRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

/**
 * FK-R01 / FK-R07 / FK-R08 — one container declaration. `[]` ⇒ it can be reasoned about, which is
 * not the same as it being safe: whether a keeper may hold a grant on it is `checkKeeper`'s question.
 */
export function checkContainer(container, label = 'container') {
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    return [`FK-R01: ${label}: not an object — a container nobody described cannot be shown to carry no approval fields`];
  }
  const findings = [];
  const at = `${label}${isStr(container.id) ? ` (${container.id})` : ''}`;
  if (!isStr(container.id)) findings.push(`FK-R01: ${at}: no id — a grant cannot be matched to a container that has no name`);
  // Per PAGE or per DATABASE: those are the two things a grant can be attached to, so they are the
  // two things this register may describe. A container of some third kind has an unknown grant
  // model, and an unknown grant model is refused rather than assumed to behave like a database.
  if (container.kind !== 'database' && container.kind !== 'page') {
    findings.push(`FK-R01: ${at}: kind is ${JSON.stringify(container.kind)}, not "database" or "page" — those are the two things a grant attaches to, and a container of some other kind has a grant model nobody here has reasoned about`);
  }

  const approvals = approvalFieldsOf(container);
  if (typeof container.authoritative !== 'boolean') {
    findings.push(`FK-R08: ${at}: does not say whether it is authoritative — the whole of D6.3 is that approval fields live somewhere separate, and a container that will not say which side it is on cannot be checked against that`);
  } else if (approvals.length && container.authoritative !== true) {
    findings.push(`FK-R08: ${at}: declares itself non-authoritative but carries ${approvals.length} approval field(s) (${approvals.join(', ')}) — the label and the properties disagree, and the label is the thing a person filing a page reads. A mislabelled container is exactly how an approval page ends up in a keeper-granted database`);
  }

  const prefill = prefillNamesOf(container);
  if (approvals.length && prefill.length) {
    findings.push(`FK-R07: ${at}: carries approval field(s) (${approvals.join(', ')}) AND field(s) a keeper is meant to prefill (${prefill.join(', ')}) — a grant is per container, never per property, so "prefill that one but not this one" is not expressible here. Whatever today's grants say, the first person who needs the prefill will have to break the separation. Split the container`);
  }
  for (const name of prefill) {
    if (!fieldNamesOf(container).includes(name)) {
      findings.push(`FK-R01: ${at}: prefill names ${JSON.stringify(name)}, which is not one of the container's declared fields — a register that describes fields it does not list cannot be checked against the container it claims to describe`);
    }
  }
  return findings;
}

/**
 * FK-R02 — a floor-keeper holds no role, ever. Checked against the register's own claim AND against
 * the identity registry, because the two answer different questions: the registry is the authority
 * on what is granted, and a register that ASKS for a role has told you what somebody intends.
 */
export function checkKeeperRoles(keeper, registry, at) {
  const findings = [];
  const claimed = Array.isArray(keeper?.roles) ? keeper.roles.filter(isStr) : [];
  if (claimed.length) {
    findings.push(`FK-R02: ${at}: the register itself lists roles ${JSON.stringify(claimed)} for this floor-keeper — the registry is the authority on roles and the register may not carry them, but a register asking for a role is a statement of intent and is refused where it is written`);
  }
  const who = identityOf(registry, keeper?.identity);
  if (!who) return findings; // FK-R06's business
  const roles = (who.roles || []).filter(isStr);
  if (roles.length) {
    findings.push(`FK-R02: ${at}: holds registry role(s) ${JSON.stringify(roles)} — a floor-keeper prepares evidence and converses; it never approves, and a role is the only thing that makes an approver. This is the F1 defect entered as data, and it is the one finding here that a gate elsewhere (identity-registry-check.mjs) will also refuse`);
  }
  for (const g of (who.groups || [])) {
    if (CONTROL_FUNCTION_GROUPS.has(g)) {
      findings.push(`FK-R02: ${at}: is in the ${JSON.stringify(g)} group — the second line and the platform owners are the functions that CHALLENGE the work. A machine cannot hold a challenge function, and membership is read as authority by every human who looks at the registry`);
    }
  }
  return findings;
}

/** FK-R04 — views + conversation, or say why not. An unstated scope is an unreviewed one. */
export function checkWriteScope(keeper, at) {
  const scope = keeper?.write_scope;
  if (!Array.isArray(scope)) {
    return [`FK-R04: ${at}: no \`write_scope\` array — D6.3 fixes the scope at views + conversation, and a keeper that will not state its scope is running with whatever the workspace happened to give it. Unstated is refused, not assumed narrow`];
  }
  const findings = [];
  for (const s of scope) {
    if (!WRITE_SCOPE.has(s)) {
      findings.push(`FK-R04: ${at}: write scope ${JSON.stringify(s)} is outside views + conversation — those two are the whole of what D6.3 permits, because neither writes a field. An unlisted scope is an unreviewed one and is refused rather than weighed`);
    }
  }
  return findings;
}

/**
 * FK-R03 / FK-R05 — the grants themselves. `containers` is a Map from container id to its
 * declaration. This is the function the delivery exists for.
 */
export function checkGrants(keeper, containers, at) {
  const grants = keeper?.grants;
  if (!Array.isArray(grants)) {
    return [`FK-R03: ${at}: no \`grants\` array — a keeper that does not enumerate what it holds cannot be shown to hold nothing on the approval container. An unstated grant is an unreviewed one`];
  }
  const findings = [];
  for (const [i, g] of grants.entries()) {
    const gat = `${at} · grant[${i}]${isStr(g?.container) ? ` on ${g.container}` : ''}`;
    if (!g || typeof g !== 'object' || Array.isArray(g)) { findings.push(`FK-R03: ${gat}: not an object`); continue; }

    for (const f of FORBIDDEN_GRANT_FIELDS) {
      if (f in g) {
        findings.push(`FK-R05: ${gat}: carries \`${f}\` — there is no property-level grant to carry it. The surface grants per page and per database; a grant that names a property is describing a protection the platform does not implement, and it will be believed by everyone who reads it. Separate the container instead`);
      }
    }
    if (g.scope === 'property' || g.scope === 'field') {
      findings.push(`FK-R05: ${gat}: scope is ${JSON.stringify(g.scope)} — property-level scope does not exist. "The agent can read the change but not approve it" is not expressible as a grant, and writing it down does not make it so`);
    }

    if (!isStr(g.container)) { findings.push(`FK-R03: ${gat}: names no container`); continue; }
    if (!GRANT_LEVELS.has(g.level)) {
      findings.push(`FK-R03: ${gat}: level is ${JSON.stringify(g.level)}, not one of ${[...GRANT_LEVELS].join(' | ')} — an unrecognised level cannot be placed against the approval rule, and unknown resolves to refusal here as it does everywhere else`);
    }

    const container = containers.get(g.container);
    if (!container) {
      findings.push(`FK-R03: ${gat}: the register does not declare this container — an undeclared container cannot be shown to carry no approval fields, so unknown is refused rather than assumed harmless`);
      continue;
    }
    const approvals = approvalFieldsOf(container);
    if (approvals.length) {
      findings.push(`FK-R03: ${gat}: holds \`${g.level}\` on a container carrying approval field(s) (${approvals.join(', ')}) — D6.3 requires NO GRANT AT ALL here, and it means no grant at all: not read-only, not comment-only. The grant is per container, so there is no narrower version of this that keeps the agent away from the approval property. ${g.level === 'can-view' ? 'A view grant looks harmless and is the first step of the creep that ends in an edit grant — and it is already outside the matrix\'s floor-keeper row' : 'This is T-12 realised: a machine editing the surface humans read before deciding'}`);
    }
    if (container.authoritative === true) {
      findings.push(`FK-R03: ${gat}: the container is declared authoritative — a floor-keeper's entire write scope is views and conversation, and an authoritative container is not a place it belongs at any level`);
    }
  }
  return findings;
}

/**
 * FK-R09 — the periodic grant audit T-12 asks for. The register is somebody's account of what they
 * believe they configured; the audit is somebody saying they went and looked. Clock-injected, and
 * only meaningful once there is a keeper: an adopter who has copied the template and declared
 * nothing is not overdue an audit, they simply have nothing to audit — the same shape
 * `core/identity-map.mjs` uses for reconciliation.
 */
export function checkGrantAudit(register, { registry = null, now = Date.now(), maxAgeDays = GRANT_AUDIT_MAX_AGE_DAYS } = {}) {
  const audit = register?.audit;
  if (!audit || typeof audit !== 'object') {
    return [`FK-R09: no grant audit — the register says what somebody believes they configured. Grants change in a console in ten seconds, so separation here is ASSERTED, not audited, and asserted separation is documentation`];
  }
  const findings = [];
  const t = parseTime(audit.audited_at);
  if (t === null) findings.push('FK-R09: the audit has no parseable ISO-8601 `audited_at` — an audit nobody can date cannot be told from a stale one');
  else if (now - t > maxAgeDays * DAY) findings.push(`FK-R09: the grant audit is ${Math.floor((now - t) / DAY)} days old (limit ${maxAgeDays}) — a grant widened since is invisible from here`);
  else if (t > now) findings.push(`FK-R09: audited_at ${audit.audited_at} is in the future — an audit that has not happened yet has not happened`);

  const by = audit.audited_by;
  if (!isStr(by)) findings.push('FK-R09: the audit names no auditor — an unattributed audit is a claim');
  else {
    const keepers = (register?.keepers || []).map((k) => k?.identity).filter(isStr);
    if (keepers.includes(by)) findings.push(`FK-R09: the audit is signed by ${JSON.stringify(by)}, which is one of the floor-keepers being audited — a keeper reporting on its own grants is the declaration this audit exists to replace`);
    const who = identityOf(registry, by);
    if (registry && !who) findings.push(`FK-R09: auditor ${JSON.stringify(by)} does not resolve in the identity registry`);
    else if (who && who.kind !== 'human') findings.push(`FK-R09: auditor ${JSON.stringify(by)} is kind ${JSON.stringify(who.kind)} — a grant audit is a person opening the sharing dialog and reading it. A machine enumerating grants through the same API surface it is granted on is not an independent look`);
  }

  // An audit that skipped a container proves nothing about that container. Enumeration is the whole
  // act: the failure mode is not a wrong answer, it is a container nobody thought to open.
  const declared = (register?.containers || []).map((c) => c?.id).filter(isStr);
  const enumerated = Array.isArray(audit.containers_enumerated) ? audit.containers_enumerated.filter(isStr) : null;
  if (enumerated === null) {
    findings.push('FK-R09: the audit does not list the containers it enumerated — "we audited the grants" is not an audit; the record must say which containers were actually opened, because the failure mode is a container nobody thought to look in');
  } else {
    const missed = declared.filter((id) => !enumerated.includes(id));
    if (missed.length) findings.push(`FK-R09: the audit did not enumerate ${missed.join(', ')} — a container that was not opened is unaudited, and an unaudited container is where the wrongly-filed page is`);
    const extra = enumerated.filter((id) => !declared.includes(id));
    if (extra.length) findings.push(`FK-R09: the audit enumerated ${extra.join(', ')}, which the register does not declare — either the register is out of date or the audit looked at something nobody has described. Both are findings; neither is noise`);
  }
  return findings;
}

/**
 * The whole register. `[]` ⇒ every declared floor-keeper is a registered agent with no role, a write
 * scope of views + conversation, and no grant of any kind on any container carrying an approval
 * field — audited, freshly, by a human who is not one of them.
 */
export function checkGrantRegister(register, { registry = null, now = Date.now(), maxAgeDays = GRANT_AUDIT_MAX_AGE_DAYS } = {}) {
  if (!register || typeof register !== 'object' || Array.isArray(register)) {
    return [`FK-R01: not an object — an unreadable register must never be mistaken for one describing no grants`];
  }
  if (register.schema !== SCHEMA_ID) {
    return [`FK-R01: schema ${JSON.stringify(register.schema)} is not ${SCHEMA_ID} — an unversioned register cannot be read, and what cannot be read cannot be shown to separate anything`];
  }
  const findings = [];

  const containerList = Array.isArray(register.containers) ? register.containers : null;
  if (containerList === null) {
    findings.push('FK-R01: no `containers` array — the grants below name containers nothing describes, so no grant can be tested against the approval rule');
  }
  const containers = new Map();
  for (const [i, c] of (containerList || []).entries()) {
    findings.push(...checkContainer(c, `container[${i}]`));
    if (isStr(c?.id)) {
      if (containers.has(c.id)) findings.push(`FK-R01: container[${i}]: duplicate container id ${JSON.stringify(c.id)} — a grant naming it would resolve to whichever declaration came first, and ambiguity resolves to refusal, never to a pick`);
      else containers.set(c.id, c);
    }
  }

  const keepers = Array.isArray(register.keepers) ? register.keepers : null;
  if (keepers === null) {
    findings.push('FK-R06: no `keepers` array — a register that names no floor-keepers separates nothing. If this floor runs none, remove the register rather than shipping an empty certificate');
    return findings;
  }

  const seen = new Set();
  for (const [i, k] of keepers.entries()) {
    const at = `keeper[${i}]${isStr(k?.identity) ? ` ${k.identity}` : ''}`;
    if (!k || typeof k !== 'object' || Array.isArray(k)) { findings.push(`FK-R06: ${at}: not an object`); continue; }
    if (!isStr(k.identity)) { findings.push(`FK-R06: ${at}: names no identity — an anonymous agent's grants belong to nobody and can be revoked by nobody`); continue; }
    if (seen.has(k.identity)) findings.push(`FK-R06: ${at}: declared twice — two entries for one agent means its grants are whichever entry a reader stops at`);
    seen.add(k.identity);

    const who = identityOf(registry, k.identity);
    if (registry && !who) {
      findings.push(`FK-R06: ${at}: does not resolve in the identity registry — an unregistered agent is outside every separation rule the harness enforces, including the one that says agents hold no roles`);
    } else if (who && who.kind !== 'agent') {
      findings.push(`FK-R06: ${at}: is kind ${JSON.stringify(who.kind)}, not "agent" — this register governs what a MACHINE may hold. A human's grants are a different question with a different answer, and filing one here would quietly exempt them from the human controls`);
    }
    findings.push(...checkKeeperRoles(k, registry, at));
    findings.push(...checkWriteScope(k, at));
    findings.push(...checkGrants(k, containers, at));
  }

  if (keepers.length > 0) {
    // The vacuity check. A register can pass every rule above by simply not mentioning the database
    // the approvals live in, and a green gate over a register that never described the thing it was
    // separating is worse than no gate: it certifies nothing and reads as certifying everything.
    const carriers = [...containers.values()].filter((c) => approvalFieldsOf(c).length > 0);
    if (carriers.length === 0 && register.routes_approvals !== false) {
      findings.push('FK-R11: no declared container carries an approval field, and the register does not say `routes_approvals: false` — so what exactly are the keepers being kept out of? Either this floor routes no approvals and the register should say so, or the container the separation is about is missing and this check is vacuous');
    }
    findings.push(...checkGrantAudit(register, { registry, now, maxAgeDays }));
  }
  return findings;
}

// --- the attempt, and why it is void --------------------------------------------------------------

/**
 * A floor-side approval attempt: what happened when somebody — or something — clicked approve on the
 * floor. The acceptance test D6.3 asks for is that this is DEMONSTRABLY VOID, so read what this
 * function does and does not do.
 *
 * `void` is `true`. Unconditionally. There is no argument to this function, and no field on
 * `attempt`, that makes it `false`, and that is not a policy decision expressed as an if-statement —
 * it is the shape of the record plane. An approval acquires validity from a subject-bound assertion
 * minted on a path the floor cannot reach (TB-0) and merged into git under CODEOWNERS. A click on a
 * collaboration surface produces no such assertion, cannot produce one, and no gate reads the floor
 * for a verdict. So there is nothing to weigh.
 *
 * `reasons` are INDEPENDENT and plural on purpose. Each one alone would void the attempt; a
 * voidance resting on a single reason is one refactor away from being a bug. Note in particular
 * that giving the agent a registry role — misconfiguring the very thing FK-R02 refuses — removes at
 * most one reason and leaves the rest standing.
 *
 * `findings` is separate from `void` and answers a different question: was the attempt PRESENTED as
 * having effect? That is FK-R10 and it is the part that misleads a human. An attempt that was
 * refused at the surface and shown as void is a non-event; an attempt that was displayed as an
 * approval is a finding even though nothing was approved, because somebody read it.
 *
 * Returns `{ void, gate_readable, record, reasons, findings }`. `record` is always `null`: this
 * function is incapable of emitting anything a gate could consume, which is the strongest form the
 * property can take in code.
 */
export function attemptedApproval(attempt = {}, { registry = null } = {}) {
  const actor = attempt?.actor;
  const who = identityOf(registry, actor);
  const label = isStr(actor) ? actor : '(unattributed)';

  const reasons = [
    'the floor holds no governance authority: git is the record, and no gate anywhere reads a floor page for a verdict (threat model §2, the engagement plane)',
    'an approval acquires validity only from a subject-bound assertion minted away from this surface and merged into git under CODEOWNERS — a click produces no assertion, and there is no path from the floor to one (TB-0)',
    'nothing on the floor can issue an approval assertion: every machine row of the capability matrix has C10 = no, and the floor-keeper row is no across C1–C11 except reading non-authoritative containers',
  ];
  if (!isStr(actor)) {
    reasons.push('the attempt names no actor — an approval nobody made is not an approval, and an unattributed one cannot be resolved to a role in any case');
  } else if (!registry) {
    reasons.push(`${label} cannot be resolved: no identity registry was supplied, and an unresolvable approver does not count`);
  } else if (!who) {
    reasons.push(`${label} is not in the identity registry — unresolvable approvals do not count`);
  } else {
    if (who.kind === 'agent') reasons.push(`${label} is an AGENT — agents prepare evidence, they never approve`);
    if (!(who.roles || []).length) reasons.push(`${label} holds no role, and a role is the only thing that makes an approver`);
  }

  const findings = [];
  const presented = attempt?.presented_as;
  if (presented && typeof presented === 'object') {
    if (presented.effective === true) {
      findings.push(`FK-R10: the attempt by ${label} was presented as EFFECTIVE — it was not, and it could not have been, but a surface that displays a machine's click as an approval has already done the damage the void-ness was protecting against. Show ${JSON.stringify(VOID_NOTICE.slice(0, 24))}… instead`);
    }
    if (isStr(presented.authority) && presented.authority !== 'none') {
      findings.push(`FK-R10: the attempt by ${label} was labelled authority ${JSON.stringify(presented.authority)} — the floor carries "none", on every card, always. This is the label \`core/floor-project.mjs\` refuses to let a projection lose, and it is the same label for the same reason`);
    }
    if (presented.gate_readable === true) {
      findings.push(`FK-R10: the attempt by ${label} was handed to something that reads gates — nothing on the floor is gate-readable; if a gate consumed this, the defect is in whatever fed it, and it is a control-plane defect, not a floor one`);
    }
  }
  // Exact match on the normalised key here, NOT the token-window matching `isApprovalField` uses on
  // container property titles. A property title is prose written for humans and needs the looser
  // match; an attempt's keys are a payload shape, and the loose match would flag ordinary
  // traceability fields (`event_nonce`, `signature_checked_at`) that carry no authority at all.
  for (const key of Object.keys(attempt || {})) {
    if (APPROVAL_FIELDS.has(normalizeFieldName(key))) {
      findings.push(`FK-R10: the attempt carries \`${key}\` — a floor-side act dressed in the cryptography that makes an approval an approval is indistinguishable from one on a screenshot, and a screenshot is what gets pasted into a chat and believed`);
    }
  }

  return { void: true, gate_readable: false, record: null, reasons, findings };
}

/**
 * The notice a surface must render where an attempt happened. Never null, never empty, never
 * dismissible: the failure this guards against is a reader who saw a tick and stopped reading.
 */
export function voidNotice(attempt = {}) {
  const { reasons } = attemptedApproval(attempt);
  return {
    visible: true,
    dismissible: false,
    authority: 'none',
    banner: VOID_NOTICE,
    actor: isStr(attempt?.actor) ? attempt.actor : null,
    at: isStr(attempt?.at) ? attempt.at : null,
    reasons,
  };
}

// CLI: report a grant register's findings from a committed file, so an adopter can see the
// separation their workspace actually describes before any of it is believed.
//   node core/floor-keeper.mjs <floor-keepers.json> [<identities.json>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [registerPath, registryPath] = process.argv.slice(2);
  if (!registerPath) {
    process.stderr.write('usage: node core/floor-keeper.mjs <floor-keepers.json> [<identities.json>]\n');
    process.exit(2);
  }
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { process.stderr.write(`cannot read ${p}\n`); process.exit(2); return null; } };
  const register = read(registerPath);
  const findings = checkGrantRegister(register, { registry: registryPath ? read(registryPath) : null });
  if (findings.length) {
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
  const keepers = (register.keepers || []).length;
  process.stdout.write(`Floor-keeper grants (D6.3) — OK (${keepers} keeper${keepers === 1 ? '' : 's'}, no grant on any approval-carrying container)\n`);
}
