// The release-subject gate (Loom 2.0-rc.11 — WS1). The evidence plane's first defect (F1) is
// self-reference: a product eval names the commit that CONTAINS it, so the eval provably ran
// before that commit existed. The fix is to move the assurance subject off the source commit and
// onto the IMMUTABLE ARTIFACT DIGEST — a value computed AFTER the commit exists, that evidence can
// name without paradox and the bank can point at to say "this exact thing was evaluated, approved
// and deployed".
//
// This gate validates the canonical `release-subject.json`: the binding root the release lane
// seals its evidence against. It checks the record is WELL-FORMED and INTERNALLY CONSISTENT —
//   source      a real 40-hex commit + a sha256 tree digest (no symbolic subjects; closes F2's spirit)
//   artifact    a name + a registry uri that CARRIES its own sha256 digest (uri@sha256:… == digest)
//   build       a builder identity, workflow ref, run id and ISO-8601 build time
// A repo that ships no deployable artifact (docs, this harness) may set `"artifact": null`
// EXPLICITLY — but once anything is in production, a null artifact fails: a deployed thing has a
// digest. Absence of the file is OK for a generic repo (nothing to bind yet).
//
// Honesty (rc.2 invariant): this gate proves the record is coherent, NOT that the artifact was
// actually built by that builder from that commit — that is the platform's provenance attestation,
// cross-checked in CI by release-attestation-check.mjs. A public bundle verifies shape and
// consistency; the trusted-builder proof is the adopter's signed provenance.
//
// Run from the repo root: `node scripts/release-subject-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';
import { pathToFileURL } from 'node:url';

export const SUBJECT_LOCATIONS = ['docs/governance/release-subject.json', 'release-subject.json'];
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Findings (one per violation). Empty ⇒ the subject is a coherent, immutable release binding.
 * `anyInProduction` (from the compiled requirements) turns a null artifact from allowed into a
 * failure — a thing that runs in production has a digest.
 */
export function evaluate(subject, { anyInProduction = false } = {}) {
  const findings = [];
  if (!subject || typeof subject !== 'object') return ['release-subject.json is not an object'];
  if (!nonEmpty(subject.schema_version)) findings.push('no schema_version — an unversioned subject cannot be evolved safely');

  const s = subject.source;
  if (!s || typeof s !== 'object') findings.push('no `source` — a release subject must name its source');
  else {
    if (!nonEmpty(s.repository)) findings.push('source.repository is missing');
    if (!COMMIT.test(s.commit || '')) findings.push(`source.commit ${JSON.stringify(s.commit)} is not a 40-hex commit sha — a symbolic source is not a binding subject`);
    if (!SHA256.test(s.tree_digest || '')) findings.push('source.tree_digest is not a sha256:… digest');
  }

  if (subject.artifact === null) {
    // Explicit opt-out — only honest when nothing is deployed.
    if (anyInProduction) findings.push('artifact is null but a governed change is in production — a deployed release has an immutable artifact digest, it cannot be subjectless');
  } else {
    const a = subject.artifact;
    if (!a || typeof a !== 'object') findings.push('no `artifact` — set it to an object with a digest, or explicitly to null for a non-artifact repo');
    else {
      if (!nonEmpty(a.name)) findings.push('artifact.name is missing');
      if (!SHA256.test(a.digest || '')) findings.push(`artifact.digest ${JSON.stringify(a.digest)} is not a sha256:… digest — the immutable subject is the digest`);
      if (!nonEmpty(a.uri)) findings.push('artifact.uri is missing');
      else if (SHA256.test(a.digest || '') && !a.uri.endsWith(`@${a.digest}`)) {
        // The uri must be digest-pinned to its OWN digest — a tag-pinned uri (…:latest) is mutable
        // and defeats the whole point of an immutable subject.
        findings.push(`artifact.uri ${JSON.stringify(a.uri)} is not pinned to artifact.digest — an immutable subject needs a digest-pinned uri (…@${a.digest})`);
      }
    }
  }

  const b = subject.build;
  if (!b || typeof b !== 'object') findings.push('no `build` — a release subject must name the trusted builder that produced the artifact');
  else {
    for (const field of ['builder_identity', 'workflow_ref', 'run_id']) {
      if (!nonEmpty(b[field])) findings.push(`build.${field} is missing — provenance needs the builder, its workflow and the run`);
    }
    if (!nonEmpty(b.built_at) || Number.isNaN(Date.parse(b.built_at))) findings.push('build.built_at is not an ISO-8601 timestamp');
  }
  return findings;
}

export function run(cwd = process.cwd()) {
  const path = SUBJECT_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return { present: false, findings: [] }; // no artifact bound yet — OK for a generic repo
  let subject;
  try { subject = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { present: true, findings: [`release-subject.json is not valid JSON: ${e.message}`] }; }
  const { anyInProduction } = aggregateRequirements(cwd);
  return { present: true, findings: evaluate(subject, { anyInProduction }) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings } = run();
  if (!present) {
    process.stdout.write('Release-subject gate — no release-subject.json; nothing bound to an artifact yet. OK\n');
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nRelease-subject gate (rc.11 · WS1) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe release subject is the immutable binding root: a real source commit, a digest-pinned\nartifact, and the trusted builder that produced it. See ../loom/references/supply-chain-security.md.\n');
    process.exit(1);
  }
  process.stdout.write('Release-subject gate (rc.11 · WS1) — coherent immutable subject. OK\n');
}
