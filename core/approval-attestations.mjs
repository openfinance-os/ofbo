// The approval-attestation contract (Factory Floor WS2 · D2.4). When a product approval is
// made somewhere other than the repository — a collaboration surface, a workflow tool, an
// approval page — the decision must come home as evidence that survives an auditor's two
// questions: WHO decided, and WHAT exactly did they approve.
//
// Two signatures, two different meanings, and the whole contract turns on not confusing them:
//
//   subject.assertion       — the HUMAN's proof. Issued by the institution's identity provider
//                             (the assertion-issuers registry), binding an immutable subject to
//                             THIS decision payload via a nonce. This is what makes the approval
//                             an approval.
//   transcription.attestation — the BRIDGE's proof. The service that carried the decision from
//                             the external surface into the repository signs that it transcribed
//                             faithfully. It proves custody, never authority.
//
// A bridge-signed record with no subject assertion authenticates the worker, not the approver —
// a service key saying "a human clicked" is an assertion about the service, not about the human.
// This module refuses that shape outright: an assertion signed by a key from the ATTESTATION
// issuers registry (service keys) is rejected, the transcriber may never be the subject, and the
// payload the human signs names the plan hash and the content digests, so an approval cannot
// survive the thing it approved being changed underneath it.
//
// Honest gaps, in the tradition of `attestations.mjs`: `ed25519` assertion material is verified
// here for real; `oidc-step-up` and `sigstore` declare mechanisms an adopter wires to pinned IdP
// metadata, and are reported UNVERIFIED-HERE — a finding, never a silent pass.
//
// TWO RESIDUALS THIS MODULE DOES NOT CLOSE, named so silence is not mistaken for coverage:
//
//   1. The identity-provider subject is BOUND, and JOINED only when a map is supplied.
//      `idp_subject` and `registry_id` sit side by side under the human's signature, so neither
//      can be altered afterwards — but nothing in THIS module asserts they are the same person.
//      That join is the second-line-owned identity map in `core/identity-map.mjs` (P6), applied
//      at step 8 below and mandatory-when-compiled via `identity_map`. Without a map, a
//      compromised bridge with a valid assertion for subject A could still name registry
//      identity B and every check here would pass — so the residual is now "unmapped", not
//      "unclosable". The map itself is only as current as its reconciliation observation.
//   2. `source_sha` and `artifact_digest` are BOUND but not RECONCILED. They are inside the
//      signed payload, so an approval cannot be re-pointed at different code after the fact;
//      this module does not, however, check that the sha names the change's actual source state
//      or that the digest names a built artifact. Reconciliation belongs to the release-subject
//      and evidence gates, which hold that state.
//
// Both are "the approval is authentic and immutable, but its subject is asserted, not proven".
// Neither is closable here without state this module deliberately does not reach for.
//
// A third residual CLOSED at rc.36 (flow-plan D3): `demo: true` refusal, issuer validity windows
// and revocation now live in `core/attestations.mjs` and apply to EVERY verifySignatureOver call
// — including the evidence-anchor path that used to skip them. This module delegates to that one
// stack rather than carrying its own copy; the bundle's `demo-anchor-signer` is refused everywhere.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { issuerPolicyFindings, verifySignatureOver } from './attestations.mjs';
import { CAPABILITY as MAP_CAPABILITY, verifyMapping } from './identity-map.mjs';

export const SCHEMA_ID = 'loom.approval-attestation/v1';
export const APPROVALS_SUBDIR = 'approvals';
export const ASSERTION_ISSUERS_LOCATIONS = ['docs/governance/assertion-issuers.json', 'assertion-issuers.json'];
/** Mechanisms an assertion may declare. Only `ed25519` is verified by this module. */
export const ASSERTION_MECHANISMS = new Set(['ed25519', 'oidc-step-up', 'sigstore']);
/** The capability a compiled plan sets to make envelope-backed approvals mandatory. */
export const CAPABILITY = 'approval_attestation';

export function loadAssertionIssuers(cwd = process.cwd()) {
  const path = ASSERTION_ISSUERS_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Is this change's plan requiring envelope-backed approvals? (mandatory-when-compiled) */
export function attestationRequired(plan) {
  return Boolean(plan?.required_capabilities?.[CAPABILITY]?.required);
}

export const sha256 = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

/**
 * The exact string a human's assertion must bind. Deterministic and order-fixed — no JSON
 * key-order ambiguity, so a verifier and an issuer cannot disagree about what was signed.
 * Binding the plan hash and the content digests is what stops an approval outliving its subject.
 *
 * Each field is JSON-encoded before joining. A bare newline-join would be ambiguous: a value
 * containing a newline could shift the remaining fields and let two DIFFERENT records produce
 * the same signed string. Encoding escapes the delimiter, so one payload means one record.
 */
export function canonicalDecisionPayload(rec) {
  const b = rec?.bound_to || {};
  return [
    SCHEMA_ID,
    rec?.change_id ?? '',
    rec?.stage ?? '',
    rec?.outcome ?? '',
    rec?.role ?? '',
    rec?.subject?.registry_id ?? '',
    rec?.subject?.idp_subject ?? '',
    b.plan_hash ?? '',
    // rc.38 (flow-plan Phase 4.1) — the NARROW binding, signed ALONGSIDE the whole-plan hash and
    // never instead of it. See roleBindingHash() below for what it covers and why.
    b.binding_hash ?? '',
    b.passport_digest ?? '',
    b.source_sha ?? '',
    b.artifact_digest ?? '',
    // Provenance and replay keys are signed: the replay guard is keyed on origin, so leaving
    // origin unsigned would let a carrier evade deduplication by editing one unsigned word.
    rec?.origin?.system ?? '',
    rec?.origin?.event_id ?? '',
    rec?.origin?.nonce ?? '',
    // The claimed decision time is signed too, so a carrier cannot back- or forward-date a
    // decision without breaking the human's signature. Without this the only anchor for "when"
    // is the merge time of the file, which is the bridge's word until git records it.
    rec?.validity?.issued_at ?? '',
    // …as are expiry and revocation. Outside the signature they are editable JSON, and a dead
    // or withdrawn approval could be revived by a carrier flipping one field.
    rec?.validity?.expires_at ?? '',
    String(rec?.validity?.revoked === true),
    // The custodian is named under the human's signature, so custody cannot be reattributed.
    rec?.transcription?.by ?? '',
    // The assurance context of the authentication itself. Checking `audience` and `acr` against
    // the registry means nothing if a carrier can edit them: a weak session would present itself
    // as a step-up one. Verified AND signed, or they are decoration.
    rec?.subject?.assertion?.audience ?? '',
    rec?.subject?.assertion?.acr ?? '',
    // The assertion's OWN validity window and subject claim, by the same rule. These decide whether
    // the human's authentication was live AT the decision and whether the token names the person
    // the record names — the entire liveness defence. Unsigned, a carrier deletes two fields and
    // that defence disappears with no finding at all, which is the absent-vs-present asymmetry.
    rec?.subject?.assertion?.issued_at ?? '',
    rec?.subject?.assertion?.expires_at ?? '',
    rec?.subject?.assertion?.subject ?? '',
  ].map((v) => JSON.stringify(typeof v === 'string' ? v : String(v ?? ''))).join('\n');
}

/**
 * The verification material an issuer entry actually trusts, normalised for comparison — a SET,
 * not one value. Separation between the SERVICE and ASSERTION registries has to hold on key
 * material, not on the id someone typed: registering one key under two ids in two files would
 * otherwise let a service key vouch for a human simply by quoting the other id.
 *
 * Why a set rather than the first material found: a realistic identity-provider entry pins BOTH
 * the provider URL and the keys. Collapsing it to one anchor meant an adopter who did the more
 * careful thing — pinning the key as well as naming the provider — silently switched the overlap
 * detector off for that provider. The control degraded in exactly the configuration it most needs
 * to inspect, and reported nothing.
 *
 * `ADOPT:` placeholders are not material. They are text nobody replaced, and treating them as
 * anchors would make two unwired stubs collide and report a shared anchor that does not exist.
 */
export function trustAnchors(issuer) {
  const v = issuer?.verify || {};
  const real = (s) => isStr(s) && !/^ADOPT:/.test(s);
  const out = new Set();
  if (real(v.public_key)) out.add(`key:${v.public_key.replace(/\s+/g, '')}`);
  // The anchor is the PROVIDER, never the scope. A subject pattern narrows who that provider may
  // speak for; it does not make it a different provider — folding it in would let the same issuer
  // sit in both registries undetected, which is exactly the overlap this check exists to catch.
  if (real(v.issuer)) out.add(`oidc:${v.issuer}`);
  if (real(v.jwks_uri)) out.add(`jwks:${v.jwks_uri}`);
  return out;
}

/** Do two issuer entries rest on any of the same verification material? */
export const sharesTrustAnchor = (a, b) => {
  const anchors = trustAnchors(a);
  return [...trustAnchors(b)].some((x) => anchors.has(x));
};

/**
 * Deterministic JSON with sorted keys AT EVERY DEPTH. `JSON.stringify(v, sortedTopLevelKeys)`
 * looks equivalent and is not: the array form is a key *filter* applied at all depths, so nested
 * keys absent from the top-level list are silently dropped and two different objects can collide.
 */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export const BINDING_SCHEMA_ID = 'loom.approval-binding/v1';

/**
 * The NARROW binding (rc.38 · flow-plan Phase 4.1) — a per-role digest over WHAT THIS ROLE WAS
 * ACTUALLY SHOWN, computed from the compiled plan rather than hand-picked.
 *
 * The problem it solves is an economic one, not a security one. `plan_hash` covers the whole
 * compiled plan INCLUDING `profile_bindings`, which are content digests of every profile the plan
 * compiled from. So a comment edit in an unrelated profile — or a BrainKit bump — moves the plan
 * hash and invalidates every signature on every in-flight change, up to twelve per change. The
 * approvals were not wrong; nothing an approver read had changed. Re-collecting twelve human
 * signatures to record that a comment moved is a tax that gets paid by not re-collecting them.
 *
 * So the binding covers the ROUTE and the SUBJECT and nothing else: the change and its tier, the
 * role's own standing in the plan (is it required at all, does it bind at PA1), the compiled gate
 * families, the section sets the approver reads, the required capabilities, and the content
 * digests of what was approved. It deliberately EXCLUDES `profile_bindings` and `plan_hash` — the
 * two fields that move for reasons invisible to an approver.
 *
 * Tamper-evidence is unchanged for everything in scope: add a gate, add or drop a section, move a
 * role from PA2 to PA1, strengthen a capability, or re-point the passport digest, and this hash
 * moves. What stops moving is the noise. The full `plan_hash` REMAINS in the payload as context,
 * so an auditor can still see exactly which compiled plan the human was looking at.
 */
export function roleBindingHash(plan, role, bound = {}) {
  if (!plan) return null;
  const roles = plan.required_approver_roles || [];
  return sha256(stableStringify({
    schema: BINDING_SCHEMA_ID,
    change_id: plan.change_id ?? null,
    risk_tier: plan.risk_tier ?? null,
    role: role ?? null,
    // The role's own entry in the plan: whether it is required at all, and where it binds.
    role_required: roles.includes(role),
    binds_at_pa1: (plan.pa1_approver_roles || []).includes(role),
    // The route and the analysis the approver reads.
    required_gates: [...(plan.required_gates || [])].sort(),
    pa1_sections: [...(plan.pa1_sections || [])].sort(),
    pa2_sections: [...(plan.pa2_sections || [])].sort(),
    required_capabilities: plan.required_capabilities ?? {},
    // The subject digests — taken from the record's own `bound_to`, which is separately compared
    // against the live passport, so a doctored digest is caught by that comparison, not laundered
    // through this one.
    subject: {
      passport_digest: bound.passport_digest ?? null,
      source_sha: bound.source_sha ?? null,
      artifact_digest: bound.artifact_digest ?? null,
    },
  }));
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
/**
 * ISO-8601 timestamps only — the TYPE is part of the check. `Date.parse` coerces non-strings
 * unpredictably (`true` → NaN, `0` → the year 2000), and the record's JSON is composed by the
 * bridge, so the bridge would pick the type. A boolean expiry read as "unparseable, therefore
 * skip" is an approval that never expires; the same value read as a date is an approval that
 * expired in 2000. Neither is a judgement anyone made, so both are refused here.
 */
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
/** Present, but not a timestamp this module will act on. */
const badTime = (v) => v !== undefined && v !== null && parseTime(v) === null;

/**
 * Verify one approval-attestation record.
 *
 * ctx: {
 *   stage, role, by,            — what the passport claims, so the record must agree
 *   plan,                       — the compiled control plan (plan_hash, risk tier)
 *   passportDigest,             — digest of the passport as committed
 *   registry, issuers,          — identity registry · ATTESTATION (service) issuers
 *   assertionIssuers,           — IdP verification material
 *   resolveApprover, identityOf — injected from the identity gate (no cycle)
 *   seen,                       — Map of nonce/event ids already used (replay detection)
 *   now                         — ms epoch, for expiry
 * }
 * Findings ([] ⇒ the approval is authentically made by the named human over this exact subject).
 */
export function verifyApprovalAttestation(rec, ctx, label = 'approval') {
  const findings = [];
  if (!rec) return [`${label}: no approval attestation — an approval recorded only as a name in a file is a claim, not evidence`];
  if (rec.schema !== SCHEMA_ID) {
    findings.push(`${label}: schema ${JSON.stringify(rec.schema)} is not ${SCHEMA_ID} — an unversioned record cannot be verified`);
    return findings; // shape is unknown; every further check would be guesswork
  }

  // 1 · The record agrees with what the passport claims.
  if (rec.change_id !== ctx.plan?.change_id) findings.push(`${label}: change_id ${JSON.stringify(rec.change_id)} does not match the plan (${ctx.plan?.change_id})`);
  if (rec.stage !== ctx.stage) findings.push(`${label}: stage ${JSON.stringify(rec.stage)} does not match the passport stage ${ctx.stage}`);
  if (rec.role !== ctx.role) findings.push(`${label}: role ${JSON.stringify(rec.role)} does not match the required role ${ctx.role}`);
  if (rec.outcome !== 'approved') findings.push(`${label}: outcome ${JSON.stringify(rec.outcome)} — only an approved decision evidences an approval`);
  if (rec.subject?.registry_id !== ctx.by) findings.push(`${label}: subject ${JSON.stringify(rec.subject?.registry_id)} is not the approver named in the passport (${ctx.by})`);

  // 2 · WHO — the subject resolves to a human holding the role, and is not a service identity.
  findings.push(...ctx.resolveApprover(ctx.registry, rec.subject?.registry_id, rec.role, `${label} · subject`));
  if (!isStr(rec.subject?.idp_subject)) {
    findings.push(`${label}: subject.idp_subject missing — a workspace-scoped person id is reassignable; the immutable institutional subject is the pivot`);
  }

  // 3 · WHAT — bound to this exact plan and this exact content (nothing may change underneath).
  const b = rec.bound_to || {};
  // The narrow binding is checked FIRST and on its own terms: if the record carries one it must be
  // right, whether or not the whole-plan hash still matches. A record whose binding_hash is stale
  // is a record something inside the approver's own scope moved under — that is the tamper case,
  // and it stays a finding no matter what the plan hash says.
  const expectedBinding = ctx.plan ? roleBindingHash(ctx.plan, rec.role, b) : null;
  const bindingOk = isStr(b.binding_hash) && expectedBinding !== null && b.binding_hash === expectedBinding;
  if (isStr(b.binding_hash) && expectedBinding !== null && !bindingOk) {
    findings.push(`${label}: bound_to.binding_hash does not match what this role is shown by the compiled plan — the route, the sections, the capabilities or the approved content moved after the decision`);
  }
  if (!isStr(b.plan_hash)) findings.push(`${label}: bound_to.plan_hash missing — an approval not bound to a compiled plan approves nothing in particular`);
  else if (ctx.plan?.plan_hash && b.plan_hash !== ctx.plan.plan_hash) {
    if (bindingOk) {
      // Re-priced, not weakened (flow-plan Phase 4.1). The plan moved somewhere this approver
      // could not see — an unrelated profile's content digest, a BrainKit bump — and everything
      // they DID see still hashes the same. The approval stands, and the narrowing is SAID OUT
      // LOUD on every run: a silent acceptance would be indistinguishable from no check at all.
      ctx.notices?.push(`${label}: the compiled plan_hash moved (approved ${String(b.plan_hash).slice(0, 12)}… ≠ compiled ${String(ctx.plan.plan_hash).slice(0, 12)}…) but the per-role binding_hash still matches — nothing inside this approver's scope changed, so the approval stands (flow-plan Phase 4.1)`);
    } else {
      findings.push(`${label}: bound_to.plan_hash does not match the compiled plan — the plan changed after the decision`
        + (isStr(b.binding_hash) ? '' : ' (and the record carries no bound_to.binding_hash, so there is no narrower binding to fall back on — see core/approval-attestations.mjs roleBindingHash)'));
    }
  }
  if (!isStr(b.passport_digest)) findings.push(`${label}: bound_to.passport_digest missing — the approved content is not pinned`);
  else if (ctx.passportDigest && b.passport_digest !== ctx.passportDigest) findings.push(`${label}: bound_to.passport_digest does not match the passport — the content changed after the decision was made`);
  if (rec.stage === 'PA1' && !isStr(b.source_sha)) findings.push(`${label}: PA1 requires bound_to.source_sha — permission to develop is granted against a source state`);
  if (rec.stage === 'PA2' && !isStr(b.artifact_digest)) findings.push(`${label}: PA2 requires bound_to.artifact_digest — permission to launch is granted against the built artifact, not a commit`);

  // 4 · WHERE — origin provenance, and replay.
  const o = rec.origin || {};
  for (const f of ['system', 'event_id', 'nonce']) {
    if (!isStr(o[f])) findings.push(`${label}: origin.${f} missing — provenance and replay protection depend on it`);
  }
  // Replay is tracked per record SLOT — (change directory · stage · role). Both coarser keys are
  // wrong in opposite directions. Per LABEL is too loose across directories: two change directories
  // can carry the same change_id (a copy, a re-launch route), making their labels identical, so the
  // guard would exempt the very duplication it exists to catch. Per DIRECTORY is too loose within
  // one: every role in a change would share a slot, and a single click on the external surface —
  // one webhook event, one decision nonce — could back product-owner AND second-line AND
  // permission-to-launch at once. Each (directory, stage, role) slot is visited exactly once per
  // run, so keying on all three exempts a re-verification and nothing else.
  // rc.38: the SUBJECT joins the slot key. Under a role quorum (Phase 4.5) one role carries two
  // records in one directory and stage; without the subject they would share a slot and the
  // second holder's record would be reported as a replay of the first's.
  const site = ctx.site ? [ctx.site, rec.stage ?? '', rec.role ?? '', rec.subject?.registry_id ?? ''].join(' · ') : label;
  for (const [field, why] of [['nonce', 'a decision nonce is single-use'], ['event_id', 'webhooks are signals, deduplicated on event id']]) {
    if (!ctx.seen || !isStr(o[field])) continue;
    const key = `${o.system}:${field}:${o[field]}`;
    const prior = ctx.seen.get(key);
    if (prior && prior !== site) findings.push(`${label}: origin.${field} replays the one already used by ${prior} — ${why}`);
    else if (!prior) ctx.seen.set(key, site);
  }

  // 5 · WHEN — validity.
  const v = rec.validity || {};
  if (v.revoked === true) findings.push(`${label}: the attestation is revoked`);
  const now = ctx.now ?? Date.now();
  const exp = parseTime(v.expires_at);
  if (badTime(v.expires_at)) findings.push(`${label}: validity.expires_at ${JSON.stringify(v.expires_at)} is not a parseable ISO-8601 timestamp — an unreadable expiry is a finding, not an approval that never expires`);
  else if (exp !== null && exp < now) findings.push(`${label}: the attestation expired at ${v.expires_at}`);

  // 6 · The HUMAN's assertion — the finding-F1 teeth.
  findings.push(...verifySubjectAssertion(rec, ctx, label));

  // 7 · The BRIDGE's transcription — custody, never authority.
  findings.push(...verifyTranscription(rec, ctx, label));

  // 8 · The identity-map JOIN (P6) — residual 1 above, closed when a map is supplied. Everything
  // before this proves the record is authentic and immutable; only this proves that the signed
  // IdP subject and the claimed registry identity are the same person. Mandatory-when-compiled:
  // a plan that does not compile `identity_map` is unaffected, exactly as before this existed.
  if (ctx.map) findings.push(...verifyMapping(rec, ctx, label));
  else if (ctx.mapRequired) {
    findings.push(`${label}: the plan requires the ${MAP_CAPABILITY} capability but no identity map was loaded — the subject is bound but not joined, which is the residual this capability exists to close`);
  }

  return findings;
}

/**
 * The human's proof, verified independently of whatever carried it. Three refusals live here:
 * an absent assertion, an assertion signed by a SERVICE key (the bridge vouching for the human),
 * and an assertion that does not bind this exact decision payload.
 */
export function verifySubjectAssertion(rec, ctx, label) {
  const a = rec?.subject?.assertion;
  if (!a) return [`${label}: subject.assertion missing — without it the record proves only that a service wrote a file`];
  const findings = [];
  if (!ASSERTION_MECHANISMS.has(a.mechanism)) {
    return [`${label}: assertion mechanism ${JSON.stringify(a.mechanism)} is not one of ${[...ASSERTION_MECHANISMS].join(' | ')}`];
  }
  if (!isStr(a.issuer)) return [`${label}: assertion has no issuer — an unattributed assertion is not evidence`];

  // A service key may never vouch for a human. This is the whole point of the contract, and it
  // has to hold on KEY MATERIAL, not on the id someone typed — the same key registered under two
  // ids in two files would otherwise defeat the separation by simply quoting the other id.
  const serviceIssuers = ctx.issuers?.issuers || [];
  if (serviceIssuers.some((i) => i.id === a.issuer)) {
    findings.push(`${label}: assertion issuer ${JSON.stringify(a.issuer)} is a registered SERVICE attestation issuer — a service signing for a human authenticates the service, not the approver`);
  }
  const declared = (ctx.assertionIssuers?.issuers || []).find((i) => i.id === a.issuer);
  if (declared) {
    if (trustAnchors(declared).size === 0) {
      findings.push(`${label}: assertion issuer ${JSON.stringify(declared.id)} declares no verification material — no key, provider or JWKS to pin, so it cannot be told apart from a service key and the registry separation is UNVERIFIED-HERE`);
    }
    const shared = serviceIssuers.find((i) => sharesTrustAnchor(declared, i));
    if (shared) {
      findings.push(`${label}: the assertion issuer's verification material is also registered as SERVICE issuer ${JSON.stringify(shared.id)} — one trust anchor in both registries makes the service/human separation a naming convention rather than a control`);
    }
  }
  if (isStr(rec?.transcription?.by) && a.issuer === rec.transcription.by) {
    findings.push(`${label}: the transcriber ${JSON.stringify(a.issuer)} issued the subject assertion — the bridge transcribes, it never vouches`);
  }

  // The assertion must bind THIS decision: audience, subject, and a nonce over the payload.
  const payload = canonicalDecisionPayload(rec);
  if (isStr(a.subject) && isStr(rec?.subject?.idp_subject) && a.subject !== rec.subject.idp_subject) {
    findings.push(`${label}: assertion subject ${JSON.stringify(a.subject)} is not the record's idp_subject`);
  }
  if (isStr(a.nonce) && a.nonce !== sha256(payload)) {
    findings.push(`${label}: assertion nonce does not bind the decision payload — the assertion could be replayed onto a different decision`);
  } else if (!isStr(a.nonce)) {
    findings.push(`${label}: assertion carries no nonce over the decision payload — binding is what separates an approval from a login`);
  }
  // An identity-provider assertion is SHORT-LIVED by design — a step-up ID token lives minutes.
  // It must have been valid when the HUMAN DECIDED, not when a gate re-verifies it months later:
  // checking it against verification time would make every genuine approval rot on a timer, and
  // the contract would be unusable with exactly the mechanism it recommends. The decision time is
  // itself signed (it is in the canonical payload), so a carrier cannot move it to suit.
  //
  // The window has to FAIL CLOSED. Both comparisons below are `!== null`-guarded, so an assertion
  // that simply omits its window skips them — and "no liveness evidence" would read exactly like
  // "liveness proven". An assertion with no declared window cannot be judged at all, so its
  // absence is a finding in its own right, as is a subject claim there is nothing to cross-check.
  for (const f of ['issued_at', 'expires_at']) {
    if (!isStr(a[f])) findings.push(`${label}: subject.assertion.${f} missing — an assertion with no declared validity window cannot be shown to have been live when the decision was made`);
    else if (parseTime(a[f]) === null) findings.push(`${label}: subject.assertion.${f} ${JSON.stringify(a[f])} is not a parseable ISO-8601 timestamp`);
  }
  if (!isStr(a.subject)) {
    findings.push(`${label}: subject.assertion.subject missing — without the provider's own subject claim there is nothing to cross-check the record's idp_subject against`);
  }
  const decidedAt = parseTime(rec?.validity?.issued_at);
  const aExp = parseTime(a.expires_at);
  const aIat = parseTime(a.issued_at);
  if (decidedAt === null) {
    findings.push(`${label}: validity.issued_at is missing or unparseable — without a signed decision time the assertion's own validity window cannot be judged`);
  } else {
    if (aExp !== null && aExp < decidedAt) findings.push(`${label}: the subject assertion had already expired when the decision was made (assertion expired ${a.expires_at}, decision ${rec.validity.issued_at})`);
    if (aIat !== null && aIat > decidedAt) findings.push(`${label}: the subject assertion was issued after the decision it attests (${a.issued_at} > ${rec.validity.issued_at})`);
  }

  // Verification material: real for ed25519, honestly reported for the platform mechanisms.
  const reg = ctx.assertionIssuers;
  if (!reg) {
    findings.push(`${label}: no assertion-issuers registry (${ASSERTION_ISSUERS_LOCATIONS[0]}) — the identity provider's verification material is not pinned, so the assertion is UNVERIFIED-HERE`);
    return findings;
  }
  const idp = (reg.issuers || []).find((i) => i.id === a.issuer);
  if (!idp) {
    findings.push(`${label}: assertion issuer ${JSON.stringify(a.issuer)} is not in the assertion-issuers registry — an unpinned identity provider is not trusted`);
    return findings;
  }
  // What the registry pins, the gate checks. An audience or step-up level carried in the record
  // but never compared is decoration: it reads as a control and enforces nothing. An `ADOPT:`
  // placeholder is worse than absent — it looks configured. So it is reported, not skipped: the
  // one thing this contract must never do is let an unapplied requirement read as satisfied.
  // A field left out entirely is a genuine "nothing pinned"; `null` records that as deliberate.
  for (const [claim, pinned] of [['audience', idp.verify?.audience], ['acr', idp.verify?.required_acr]]) {
    if (isStr(pinned) && /^ADOPT:/.test(pinned)) {
      findings.push(`${label}: the assertion registry still carries an ADOPT: placeholder for ${claim} on ${idp.id} — the pin is unconfigured, so ${claim} is UNVERIFIED-HERE (set it, or set it to null to record a deliberate opt-out)`);
      continue;
    }
    if (!isStr(pinned)) continue; // nothing pinned — nothing to check against
    if (!isStr(a[claim])) findings.push(`${label}: the registry pins ${claim} for ${idp.id} but the assertion carries none`);
    else if (a[claim] !== pinned) findings.push(`${label}: assertion ${claim} ${JSON.stringify(a[claim])} does not match the ${JSON.stringify(pinned)} pinned for ${idp.id}`);
  }
  // Issuer policy (demo refusal, revocation, validity window) and the signature both come from
  // the ONE unified stack in core/attestations.mjs (rc.36, D3) — judged at the SIGNED decision
  // instant, never at verification time. A demo key exists so the contract can be exercised end
  // to end in the bundle; it must never underwrite a real approval, and now no path lets it.
  if (a.mechanism === 'ed25519' && idp.mechanism === 'ed25519') {
    findings.push(...verifySignatureOver(payload, { issuer: a.issuer, signature: a.signature }, reg, 'decision payload', { at: decidedAt ?? undefined })
      .map((f) => `${label}: ${f}`));
  } else {
    findings.push(...issuerPolicyFindings(idp, { at: decidedAt ?? Date.now(), what: 'decision payload' }).map((f) => `${label}: ${f}`));
    findings.push(`${label}: assertion mechanism ${JSON.stringify(a.mechanism)} is verified against pinned identity-provider metadata by the platform, not by this module — wire it per the registry and record activation evidence; until then this assertion is UNVERIFIED-HERE`);
  }
  return findings;
}

/** The bridge's custody proof: a registered service issuer, never the subject, holding no role. */
export function verifyTranscription(rec, ctx, label) {
  const t = rec?.transcription;
  if (!t) return [`${label}: transcription block missing — the chain of custody from the external surface is unrecorded`];
  const findings = [];
  if (!isStr(t.by)) findings.push(`${label}: transcription.by missing — the carrying identity is unnamed`);
  if (isStr(t.by) && t.by === rec?.subject?.registry_id) {
    findings.push(`${label}: the transcriber and the approver are the same identity (${t.by}) — custody and decision must be separable`);
  }
  const who = isStr(t.by) && ctx.identityOf ? ctx.identityOf(ctx.registry, t.by) : null;
  if (isStr(t.by) && !who) findings.push(`${label}: transcriber ${JSON.stringify(t.by)} is not in the identity registry`);
  if (who && (who.roles || []).length > 0) {
    findings.push(`${label}: transcriber ${t.by} holds approval roles (${(who.roles || []).join(', ')}) — the bridge must hold none`);
  }
  // The named custodian must be the one who actually signed. `transcription.by` is a REGISTRY
  // identity and the signature carries an ISSUER id — two namespaces — so the issuer entry binds
  // them with `identity`. Without that binding `by` is free text: one service signs and another
  // is credited, and the custody chain names the wrong party.
  if (isStr(t.by) && isStr(t.attestation?.issuer)) {
    const signer = (ctx.issuers?.issuers || []).find((i) => i.id === t.attestation.issuer);
    if (signer && !isStr(signer.identity)) {
      findings.push(`${label}: attestation issuer ${JSON.stringify(signer.id)} declares no \`identity\` — the signing key is not bound to a registry identity, so the credited custodian cannot be checked`);
    } else if (signer && signer.identity !== t.by) {
      findings.push(`${label}: transcription.by is ${JSON.stringify(t.by)} but issuer ${JSON.stringify(signer.id)} signs for ${JSON.stringify(signer.identity)} — the credited custodian is not the signer`);
    }
  }
  // Demo refusal, revocation and issuer validity for the carrying service come from the unified
  // stack (rc.36, D3) — a reference key cannot evidence custody either. Judged at the signed
  // decision instant when the record declares one.
  findings.push(...verifySignatureOver(canonicalDecisionPayload(rec), t.attestation, ctx.issuers, 'transcribed decision', { at: parseTime(rec?.validity?.issued_at) ?? undefined })
    .map((f) => `${label}: ${f}`));
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Load a change's approval attestations: [{ file, record }]. */
export function loadApprovals(changeDir) {
  const dir = `${changeDir}/${APPROVALS_SUBDIR}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => ({ file: n, record: readJson(`${dir}/${n}`) }));
}

/**
 * The digest an approval binds itself to: the passport's ANALYSIS (`sections`), not the whole
 * file. This distinction is load-bearing. A high-tier change needs up to twelve approvals, each
 * recorded into `pa1.approvals` as it arrives — so a digest over the whole passport would change
 * on every signature and invalidate every approval already given. Sequential approval would be
 * impossible, and the contract would only ever work for changes needing exactly one approver.
 *
 * What an approver is approving is the analysis. Who else approved it is the record of the
 * process, verified separately: the gate resolves every named approver and cross-checks each
 * attestation's subject against the passport entry it evidences.
 */
export function passportDigest(changeDir) {
  const p = `${changeDir}/product-passport.json`;
  if (!existsSync(p)) return null;
  let passport;
  try { passport = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  return sha256(stableStringify(passport?.sections ?? null));
}

// CLI: print the canonical decision payload and its digest for a record — the string an
// identity provider must bind, so an adopter can wire their signer without guessing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/approval-attestations.mjs <approval-record.json>\n');
    process.exit(2);
  }
  const rec = readJson(path);
  if (!rec) { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const payload = canonicalDecisionPayload(rec);
  process.stdout.write(`${payload}\n\n--- digest (the assertion nonce) ---\n${sha256(payload)}\n`);
}
