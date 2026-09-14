// The adoption-attestation gate (Loom 2.0-rc.14 · WS5). `loom attest-adoption` verifies a SIGNED
// adoption report — the machine-checkable claim "this repository has adopted the Loom to stage N".
// Its central rule closes F7's gap: a signed adoption report cannot be accepted while ANY mandatory
// item is adopt-pending. Installation being automated is not adoption;
// an attestation over a half-configured repo would be a false green.
//
//   · the live status (adoption-status.mjs) must have NO adopt-pending mandatory items,
//   · the attestation must be signed by a REGISTERED issuer (ed25519) over its canonical hash,
//   · the attester must resolve to a non-agent identity (an agent cannot certify its own adoption),
//   · the attestation must be fresh.
//
// rc.37 (flow-plan Phase 3.6): the freshness window gained a WARNING BAND. At WARN_AT (80%) of the
// window the attestation is still valid and this gate still passes — a NOTICE is printed naming
// the days left. The block is unmoved. What is removed is the overnight green-to-blocked surprise
// on a control whose remedy (re-run the adoption status, re-sign) takes a human and a key.
//
// Honesty (rc.2 invariant): the bundle ships the verifier; the report and signature are produced
// adopter-side with the adopter's key, then checked by `attest-adoption`.
//
// Run from the adopted repo root: `node scripts/adoption-attest.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadIssuers } from '../core/attestations.mjs';
import { attestationHash, evaluateAdoptionAttestation, WARN_AT } from '../core/adoption-attestation.mjs';
import { computeStatus } from './adoption-status.mjs';
import { pathToFileURL } from 'node:url';

const ATTEST_LOCATIONS = ['docs/governance/adoption-attestation.json', 'adoption-attestation.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
export { attestationHash, WARN_AT };

/** Findings ([] ⇒ the adoption is fully configured and authentically attested). */
export function evaluate(status, attestation, { issuers, registry, now = Date.now(), maxAgeDays = 365, notices = null } = {}) {
  return evaluateAdoptionAttestation(status, attestation, { issuers, registry, now, maxAgeDays, notices });
}

export function run(cwd = process.cwd()) {
  const status = computeStatus(cwd);
  const attPath = ATTEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const attestation = attPath ? JSON.parse(readFileSync(attPath, 'utf8')) : null;
  const issuers = loadIssuers(cwd) || loadIssuers(`${cwd}/..`);
  const idPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const registry = idPath ? JSON.parse(readFileSync(idPath, 'utf8')) : null;
  const notices = [];
  return { findings: evaluate(status, attestation, { issuers, registry, notices }), notices };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nAdoption-attestation gate (rc.14 · WS5) — NOT ATTESTED\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nInstallation is not adoption. Resolve every adopt-pending item, then sign the adoption\nreport with your organisation\'s key. See docs/governance/activation-runbook.md.\n');
    process.exit(1);
  }
  process.stdout.write('Adoption-attestation gate (rc.14 · WS5) — fully configured and authentically attested. OK\n');
}
