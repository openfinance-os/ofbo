// Shared verifier for adoption attestations. Kept out of scripts/adoption-status.mjs and
// scripts/adoption-attest.mjs so both the status projection and the gate use exactly the same
// cryptographic decision without importing each other.
import { createHash } from 'node:crypto';
import { verifySignatureOver } from './attestations.mjs';

const DAY = 86_400_000;
export const WARN_AT = 0.8;

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function attestationHash(record) {
  const { attestation, ...rest } = record;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

/** Findings ([] means fully configured and authentically attested). */
export function evaluateAdoptionAttestation(status, attestation, { issuers, registry, now = Date.now(), maxAgeDays = 365, notices = null } = {}) {
  const findings = [];
  if (status?.adoptPending) {
    findings.push(`adoption is not complete — ${status.unresolved.length} item(s) still adopt-pending; a signed adoption report cannot be produced until they are resolved`);
    for (const f of status.unresolved.slice(0, 10)) findings.push(`  adopt-pending: ${f}`);
  }
  if (!attestation) { findings.push('no adoption-attestation.json — create and sign one for the fully-configured repo, then run `attest-adoption` to verify it'); return findings; }

  if (!attestation.attested_at || Number.isNaN(Date.parse(attestation.attested_at))) findings.push('attestation has no ISO-8601 attested_at');
  else {
    const ageDays = Math.floor((now - Date.parse(attestation.attested_at)) / DAY);
    if (ageDays > maxAgeDays) findings.push('adoption attestation is stale — re-attest');
    else if (ageDays >= Math.floor(maxAgeDays * WARN_AT)) notices?.push(`adoption attestation is ${ageDays}d old of a ${maxAgeDays}d window — ${maxAgeDays - ageDays}d left. Re-run \`adoption-status --run\` and re-attest before it BLOCKS`);
  }

  const who = (registry?.identities || []).find((i) => i.id === attestation.attested_by);
  if (!registry) findings.push('no readable identity registry — the adoption attester cannot be resolved');
  if (!attestation.attested_by) findings.push('attestation names no attested_by');
  else if (registry && (!who || who.kind === 'agent')) findings.push(`attested_by ${JSON.stringify(attestation.attested_by)} does not resolve to a human identity — an agent cannot certify its own adoption`);

  findings.push(...verifySignatureOver(attestationHash(attestation), attestation.attestation, issuers, 'adoption attestation'));
  return findings;
}
