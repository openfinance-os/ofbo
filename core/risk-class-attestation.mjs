// The risk-class attestation (2.1.0, hardening plan row 2.8; PRD loom-kosli F8). The policy compiler
// turns a classification into a route — a tier, a plan hash, the exact profile content the plan was
// compiled from — and until now that decision lived only in the tree the agent edits. This record is
// the shape that decision takes when it leaves the tree: the compiled tier and plan hash, the
// profile inputs (name, kind, version, content digest) the compiler bound, the flags that fired the
// conditionals, and who classified. No second rules file, no second risk scale (decision 0.6): the
// tier IS the compiler's, and a verifier recompiles and compares rather than trusting the record.
//
// SIGNING. The record is signed with the harness's one attestation stack (core/attestations.mjs):
// an ed25519 signature over the canonical payload, by an issuer registered in
// docs/governance/attestation-issuers.json, verified with the same demo/validity/revocation policy
// every other attestation gets. The private key never lives in the tree — signing happens where
// the key is (the CI runner, a signing service), and `signRiskClass` takes the PEM as an argument
// for exactly that reason. An unsigned record is a valid DRAFT and an invalid attestation.
//
// Posting it to Kosli is phase 2 proper (kosli-attest). This module only builds, signs and verifies.
import { createHash, sign as edSign } from 'node:crypto';
import { canonical, planHash } from './policy-compiler.mjs';
import { verifySignatureOver } from './attestations.mjs';

export const SCHEMA_ID = 'loom.risk-class/v1';
export const RECORD_FILE = 'risk-class.json';
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** The record, from an envelope and the plan compiled for it. Pure: same inputs, same record. */
export function buildRiskClassRecord(envelope, plan, { compiledAt = null } = {}) {
  if (!envelope || !plan) throw new Error('buildRiskClassRecord needs an envelope and its compiled plan');
  return {
    schema: SCHEMA_ID,
    change_id: envelope.change_id,
    product_id: envelope.product_id ?? null,
    change_type: envelope.change_type ?? null,
    change_class: envelope.change_class ?? 'normal',
    risk_tier: plan.risk_tier,
    plan_hash: plan.plan_hash,
    profiles: [...(plan.profile_bindings || [])].map((b) => ({ profile: b.profile, kind: b.kind, version: b.version ?? null, digest: b.digest, ...(b.brainkit_digest ? { brainkit_digest: b.brainkit_digest } : {}) })),
    flags: Object.fromEntries(Object.entries(envelope.flags || {}).filter(([, v]) => v === true).sort()),
    required_gates: [...(plan.required_gates || [])],
    required_capabilities: Object.keys(plan.required_capabilities || {}).sort(),
    classified_by: envelope.classification?.classified_by ?? null,
    classified_at: envelope.classification?.classified_at ?? null,
    compiled_at: compiledAt,
    attestation: null,
  };
}

/** The bytes that are signed: everything but the attestation itself, canonically serialised. */
export function canonicalRiskClassPayload(rec) {
  const { attestation: _a, ...rest } = rec || {};
  return `${SCHEMA_ID}\n${canonical(rest)}`;
}
export const payloadDigest = (rec) => 'sha256:' + createHash('sha256').update(canonicalRiskClassPayload(rec), 'utf8').digest('hex');

/** Sign with an ed25519 private key PEM as a registered issuer. Returns a NEW record; the input is untouched. */
export function signRiskClass(rec, { issuer, privateKeyPem, issuedAt = new Date().toISOString() }) {
  if (!isStr(issuer)) throw new Error('signRiskClass: issuer id is required');
  if (!isStr(privateKeyPem)) throw new Error('signRiskClass: a private key PEM is required — the key is never read from the tree');
  const unsigned = { ...rec, attestation: null };
  const payload = canonicalRiskClassPayload(unsigned);
  const signature = edSign(null, Buffer.from(payload, 'utf8'), privateKeyPem).toString('base64');
  return { ...unsigned, attestation: { issuer, mechanism: 'ed25519', payload_digest: payloadDigest(unsigned), signature, validity: { issued_at: issuedAt } } };
}

/**
 * Findings ([] ⇒ the record is the compiler's decision, signed by a registered issuer).
 *   plan       the stored control plan the record claims to describe
 *   freshPlan  a fresh compile (optional) — the record must match it too, or the route moved
 *   envelope   the envelope (optional) — tier and classifier must agree
 *   issuers    the allowed-issuers registry; when absent the signature is reported NOT VERIFIED
 *   requireSignature  true in any lane where the record is evidence (default true)
 */
export function verifyRiskClass(rec, { plan = null, freshPlan = null, envelope = null, issuers = null, requireSignature = true, now = Date.now(), notices = null } = {}) {
  const f = [];
  const label = `risk-class ${rec?.change_id || '(no id)'}`;
  if (!rec || typeof rec !== 'object') return [`${label}: no record`];
  if (rec.schema !== SCHEMA_ID) f.push(`${label}: schema must be ${SCHEMA_ID} (got ${JSON.stringify(rec.schema)})`);
  for (const k of ['change_id', 'risk_tier', 'plan_hash']) if (!isStr(rec[k])) f.push(`${label}: no ${k}`);
  if (!Array.isArray(rec.profiles) || rec.profiles.length === 0) f.push(`${label}: no profile inputs — a tier with no stated profiles is a number, not a compiled decision`);
  if (plan) {
    if (rec.plan_hash !== plan.plan_hash) f.push(`${label}: plan_hash ${String(rec.plan_hash).slice(0, 12)}… is not the stored plan's ${String(plan.plan_hash).slice(0, 12)}… — the record describes a different route`);
    if (planHash(plan) !== plan.plan_hash) f.push(`${label}: the stored plan does not match its own plan_hash — the plan was edited after compilation`);
    if (rec.risk_tier !== plan.risk_tier) f.push(`${label}: risk_tier ${rec.risk_tier} is not the plan's ${plan.risk_tier}`);
    const want = (plan.profile_bindings || []).map((b) => `${b.profile}@${b.digest}`).sort().join('|');
    const got = (rec.profiles || []).map((b) => `${b.profile}@${b.digest}`).sort().join('|');
    if (want !== got) f.push(`${label}: profile inputs do not match the plan's bindings — the record names different profile content than the route was compiled from`);
  }
  if (freshPlan && rec.plan_hash !== freshPlan.plan_hash) f.push(`${label}: does not reconcile with a fresh compile (${String(freshPlan.plan_hash).slice(0, 12)}…) — the profiles moved after the classification was attested`);
  if (envelope) {
    if (rec.change_id !== envelope.change_id) f.push(`${label}: change_id is not the envelope's ${envelope.change_id}`);
    if (rec.risk_tier !== envelope.risk_tier) f.push(`${label}: risk_tier ${rec.risk_tier} is not the envelope's ${envelope.risk_tier}`);
    if (rec.classified_by !== (envelope.classification?.classified_by ?? null)) f.push(`${label}: classified_by is not the envelope's classifier`);
  }
  const att = rec.attestation;
  if (!att) {
    if (requireSignature) f.push(`${label}: UNSIGNED — a draft, not an attestation; sign it where the issuer key lives before it is evidence`);
    else notices?.push(`${label}: unsigned draft`);
    return f;
  }
  if (att.payload_digest && att.payload_digest !== payloadDigest(rec)) f.push(`${label}: payload_digest does not match the record — a field changed after signing`);
  if (!issuers) { notices?.push(`${label}: signature NOT VERIFIED — no attestation-issuers registry here`); return f; }
  f.push(...verifySignatureOver(canonicalRiskClassPayload(rec), att, issuers, 'risk-class record', { now }));
  return f;
}
