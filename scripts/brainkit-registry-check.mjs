// The BrainKit estate-registry gate (Loom 2.0-rc.15 · WS7). rc.8 shipped BrainKit distribution as
// digest-pinned local snapshots — self-verifying, but with no estate-level answer to "which repos
// run this release, and can I withdraw an unsafe one across all of them?". This gate adds that as
// DATA + a verifier (still no live service — the public repo ships schemas and the fictional
// example only). A BrainKit registry answers five questions and this gate enforces their integrity:
//
//   which repositories use it     the adoption inventory (repo → version + digest + acknowledgement)
//   which controls changed        each release's changed_controls
//   which products need re-eval    each release's products_needing_reevaluation
//   is a release withdrawable     status active|revoked|superseded — a REVOKED release pinned by any
//                                 repo FAILS (revocation propagates across the estate)
//   what supersedes what          a superseded release names its successor
//
// Rules: versions are semver, digests sha256, every adopted (version,digest) resolves to a
// registered release, every adoption carries an acknowledgement receipt, and — the point of the
// whole thing — no repository may pin a revoked release. An unsafe BrainKit cannot keep running.
//
// Run from the repo root: `node scripts/brainkit-registry-check.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const REGISTRY_LOCATIONS = ['docs/governance/brainkit-registry.json', 'brainkit-registry.json'];
export const STATUSES = new Set(['active', 'revoked', 'superseded']);
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const isISO = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** Findings ([] ⇒ the registry is well-formed and no repo runs a revoked release). */
export function evaluate(registry) {
  const findings = [];
  const releases = registry?.releases;
  if (!Array.isArray(releases) || releases.length === 0) return ['brainkit-registry has no `releases`'];

  const byKey = new Map(); // `${id}@${version}` → release
  for (const r of releases) {
    const key = `${r?.brainkit_id}@${r?.version}`;
    if (!r?.brainkit_id) findings.push('a release has no brainkit_id');
    if (!SEMVER.test(r?.version || '')) findings.push(`${key}: version is not semver`);
    if (!SHA256.test(r?.package_digest || '')) findings.push(`${key}: package_digest is not a sha256:… digest`);
    if (!STATUSES.has(r?.status)) findings.push(`${key}: status must be ${[...STATUSES].join('|')} (got ${JSON.stringify(r?.status)})`);
    if (!isISO(r?.released_at)) findings.push(`${key}: released_at is not ISO-8601`);
    if (r?.status === 'superseded' && !r?.superseded_by) findings.push(`${key}: superseded but names no superseded_by`);
    if (r?.status === 'revoked' && !(typeof r?.revocation_reason === 'string' && r.revocation_reason.trim())) findings.push(`${key}: revoked but records no revocation_reason`);
    if (byKey.has(key)) findings.push(`${key}: duplicate release`);
    byKey.set(key, r);
  }
  const digestStatus = new Map(releases.map((r) => [r.package_digest, r.status]));

  for (const a of registry?.adoption_inventory || []) {
    const label = `${a?.repository} → ${a?.brainkit_id}@${a?.version}`;
    const rel = byKey.get(`${a?.brainkit_id}@${a?.version}`);
    if (!rel) { findings.push(`${label}: pins a version not in the registry — a repo cannot run an unregistered release`); continue; }
    if (a.package_digest !== rel.package_digest) findings.push(`${label}: pinned digest does not match the registered release digest`);
    if (!isISO(a?.acknowledged_at)) findings.push(`${label}: no acknowledgement receipt (acknowledged_at) — adoption must be acknowledged`);
    // The estate-withdrawal invariant: a revoked release must run NOWHERE.
    if (digestStatus.get(a.package_digest) === 'revoked') {
      findings.push(`${label}: pins a REVOKED release — an unsafe BrainKit must be withdrawn across the estate; migrate this repository off it`);
    }
  }
  return findings;
}

/** The five-question summary a BrainKit release must be able to answer (diagnostic). */
export function summarise(registry) {
  const usedBy = {};
  for (const a of registry?.adoption_inventory || []) (usedBy[`${a.brainkit_id}@${a.version}`] ||= []).push(a.repository);
  return (registry?.releases || []).map((r) => ({
    release: `${r.brainkit_id}@${r.version}`, status: r.status,
    repositories: usedBy[`${r.brainkit_id}@${r.version}`] || [],
    changed_controls: r.changed_controls || [],
    products_needing_reevaluation: r.products_needing_reevaluation || [],
  }));
}

export function run(cwd = process.cwd()) {
  const path = REGISTRY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return { present: false, findings: [] }; // no estate registry — OK (single-repo digest-pin still works)
  let registry;
  try { registry = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { present: true, findings: [`brainkit-registry.json is not valid JSON: ${e.message}`] }; }
  return { present: true, findings: evaluate(registry) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings } = run();
  if (!present) { process.stdout.write('BrainKit-registry gate — no estate registry; single-repo digest-pin is in effect. OK\n'); process.exit(0); }
  if (findings.length) {
    process.stderr.write('\nBrainKit-registry gate (rc.15 · WS7) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe BrainKit estate registry must be consistent and no repository may run a revoked release.\nSee docs/governance/runbooks/brainkit-distribution-runbook.md.\n');
    process.exit(1);
  }
  process.stdout.write('BrainKit-registry gate (rc.15 · WS7) — registry consistent; no repository runs a revoked release. OK\n');
}
