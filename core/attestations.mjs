// The attestation contract's verification half (Loom 2.0 §6). A gate that checks a
// signature field is non-empty is a field check, not a control — verification means
// resolving the issuer in the allowed-issuers registry and cryptographically checking the
// signature against that issuer's verification material.
//
// Reference mechanism shipped here: `ed25519` — the registry entry carries a PEM public
// key, the attestation carries a base64 signature over the evidence anchor, and Node's
// crypto verifies it for real (negative-tested: a flipped byte fails). `sigstore` and
// `github-attestation` entries declare platform mechanisms the adopter wires in CI; this
// module reports them as UNVERIFIED-HERE rather than pretending — an honest gap, not a
// silent pass.
//
// rc.36 (flow-plan D3) — ONE attestation stack, the strong one. This module used to verify
// issuer + ed25519 and stop, while core/approval-attestations.mjs additionally refused
// `demo: true` issuers and enforced validity windows and revocation — so the WEAKER stack
// guarded the release anchor, and the issuer template documented the hole in prose. The
// issuer-policy and validity checks now live HERE, applied by every caller of
// verifySignatureOver (evidence anchors, assurance cycles, platform activations, adapter
// evidence, projections, approval assertions and transcriptions alike), and the approval
// core delegates to them instead of duplicating.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const ISSUERS_LOCATIONS = ['docs/governance/attestation-issuers.json', 'attestation-issuers.json'];

export function loadIssuers(cwd = process.cwd()) {
  const path = ISSUERS_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ISO-8601 timestamps only, in the exact discipline of core/approval-attestations.mjs: the TYPE
// is part of the check, because `Date.parse` coerces non-strings unpredictably and the record's
// JSON is composed by whoever carried it. An unreadable expiry read as "skip" is an attestation
// that never expires; read as a date it expired in 2000. Neither is a judgement anyone made.
const parseTime = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const badTime = (v) => v !== undefined && v !== null && parseTime(v) === null;

/**
 * Issuer-level policy — the checks rc.36 unified out of core/approval-attestations.mjs so that
 * ONE stack, the strong one, guards every signature (flow-plan D3). Before this, the older
 * evidence-anchor path verified issuer + ed25519 and stopped: no `demo: true` refusal, no issuer
 * validity window, no revocation — the issuer template itself documented the hole in prose.
 * `at` is the instant the issuer's authority is judged at: the attestation's own signed/claimed
 * issue time when it declares one, else now (temporal correctness, as in the approval core).
 * Findings ([] ⇒ the issuer may underwrite this attestation).
 */
export function issuerPolicyFindings(issuer, { at = Date.now(), what = 'payload' } = {}) {
  const findings = [];
  if (issuer?.demo === true) {
    findings.push(`issuer ${JSON.stringify(issuer.id)} is marked \`"demo": true\` — a reference key shipped with the harness cannot underwrite the ${what}; register your own material`);
  }
  if (issuer?.revoked === true) findings.push(`issuer ${issuer.id} is REVOKED in the allowed-issuers registry — a withdrawn signer does not count`);
  for (const field of ['valid_from', 'valid_until']) {
    if (badTime(issuer?.[field])) findings.push(`issuer ${issuer.id}: ${field} ${JSON.stringify(issuer[field])} is not a parseable ISO-8601 timestamp — an unreadable validity window is a finding, not an issuer that is always valid`);
  }
  const from = parseTime(issuer?.valid_from);
  const until = parseTime(issuer?.valid_until);
  if (from !== null && at < from) findings.push(`issuer ${issuer.id} was not yet valid at the attested instant (valid_from ${issuer.valid_from})`);
  if (until !== null && at > until) findings.push(`issuer ${issuer.id} was no longer valid at the attested instant (valid_until ${issuer.valid_until})`);
  return findings;
}

/**
 * Per-attestation validity ({issued_at, expires_at, revoked}), honoured when present (D3). An
 * attestation that declares none behaves exactly as before — the window is opt-in, but once
 * declared it is enforced, and an unreadable timestamp fails closed.
 */
export function attestationValidityFindings(validity, { now = Date.now(), what = 'payload' } = {}) {
  if (validity === undefined || validity === null) return [];
  const findings = [];
  if (validity.revoked === true) findings.push(`the attestation over the ${what} is REVOKED`);
  if (badTime(validity.issued_at)) findings.push(`attestation validity.issued_at ${JSON.stringify(validity.issued_at)} is not a parseable ISO-8601 timestamp`);
  if (badTime(validity.expires_at)) findings.push(`attestation validity.expires_at ${JSON.stringify(validity.expires_at)} is not a parseable ISO-8601 timestamp — an unreadable expiry is a finding, not an attestation that never expires`);
  else {
    const exp = parseTime(validity.expires_at);
    if (exp !== null && exp < now) findings.push(`the attestation over the ${what} expired at ${validity.expires_at}`);
  }
  return findings;
}

/**
 * Verify one attestation ({issuer, signature, validity?}) over an arbitrary payload STRING against
 * the issuers registry. This is the general primitive: a record counts as authentically signed
 * only when its issuer is registered, PERMITTED (not demo, not revoked, inside its validity
 * window — rc.36, D3: one attestation stack, the strong one), its own validity holds when it
 * declares one, and the signature cryptographically checks out.
 * `what` labels the payload for the message; `opts.at` is the instant issuer authority is judged
 * at (defaults to the attestation's own validity.issued_at when present, else now).
 * Findings ([] ⇒ authentically signed).
 */
export function verifySignatureOver(payload, att, issuers, what = 'payload', opts = {}) {
  if (!att) return [`no attestation — the ${what} is unsigned`];
  const issuer = (issuers?.issuers || []).find((i) => i.id === att.issuer);
  if (!issuer) return [`attestation issuer ${JSON.stringify(att.issuer)} is not in the allowed-issuers registry — an unregistered signer does not count`];
  const now = opts.now ?? Date.now();
  const at = opts.at ?? parseTime(att.validity?.issued_at) ?? now;
  // Policy findings ACCUMULATE and the signature is still checked: a demo-signed record whose
  // signature also fails should say both, and a valid signature from a refused issuer must still
  // be refused — refusal is about authority, not about the maths.
  const findings = [
    ...issuerPolicyFindings(issuer, { at, what }),
    ...attestationValidityFindings(att.validity, { now, what }),
  ];
  if (issuer.mechanism === 'ed25519') {
    const pem = issuer.verify?.public_key;
    if (!pem) return [...findings, `issuer ${issuer.id}: mechanism ed25519 but no public_key in the registry`];
    let ok = false;
    try {
      ok = cryptoVerify(null, Buffer.from(payload, 'utf8'), createPublicKey(pem), Buffer.from(att.signature || '', 'base64'));
    } catch (e) {
      return [...findings, `issuer ${issuer.id}: signature verification errored (${e.message})`];
    }
    if (!ok) return [...findings, `attestation signature does NOT verify over the ${what} for issuer ${issuer.id}`];
    return findings;
  }
  return [...findings, `issuer ${issuer.id}: mechanism ${JSON.stringify(issuer.mechanism)} is verified by the platform (CI), not by this module — wire it per the registry and record activation evidence; until then this attestation is UNVERIFIED-HERE`];
}

/**
 * Verify an evidence manifest's anchor attestation against the issuers registry.
 * Findings ([] ⇒ the anchor is authentically signed by a registered issuer).
 */
export function verifyAnchorAttestation(manifest, issuers) {
  if (!manifest?.attestation) return ['evidence manifest carries no attestation — the anchor is unsigned'];
  if (!manifest?.anchor) return ['evidence manifest has no anchor to attest'];
  return verifySignatureOver(manifest.anchor, manifest.attestation, issuers, 'anchor')
    .map((f) => f.replace('does NOT verify over the anchor', 'does NOT verify over the anchor — the seal is not authentically anchored'));
}
