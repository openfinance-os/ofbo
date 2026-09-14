// The evidence collector (flow-plan Phase 2, rc.35 — closes F2's first half). The seal gate has
// carried a correct, tested chain builder since it shipped, and the release skill still told a
// human to "hash-chain the manifest" by hand — a multi-hour ritual of computing digests and
// transcribing verdicts, which is not only toil but the exact "narrated, not sealed" risk the
// gate was built to stop: a hand-typed digest is fabricatable evidence. This CLI derives the
// manifest FROM the artifacts instead:
//
//   walk the evidence directory · hash every artifact · order entries by the seal gate's
//   required-types contract · bind release_commit · chain with the gate's own buildChain() ·
//   set the anchor to the final seal · RE-VERIFY the result with the gate's own evaluate()
//   — and refuse to write anything if that verification fails.
//
// Deriving is not a shortcut; it strengthens the control. The collector never invents evidence
// (an artifact that is absent stays absent and the required-types check refuses the bundle), it
// never edits an artifact (a failing tests.json fails the seal semantics and nothing is written),
// and files it does not recognise as evidence are LISTED, never silently ignored. The gate-run
// record the runner emits (`core/gate-runner.mjs --emit-dir`) is sealed whenever it is present,
// so the most trustworthy artifact CI produces enters the chain instead of expiring as a CI
// artifact.
//
// Run from the repo root (exit 1 = verification refused, exit 2 = cannot even start):
//   node scripts/seal-evidence.mjs [--dir docs/governance/evidence] [--commit <sha>] [--release <id>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildChain, evaluate, requiredTypesFor, verifyReleaseCommit } from './evidence-seal-check.mjs';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';
import { actorFor, post as recordPost, runnerFromEnv, signerFromArgs, status as recordStatus } from '../core/external-record.mjs';
import { buildEnvelope, signEnvelope } from '../core/provenance.mjs';
import { controlsForRecord, loadObligations } from '../core/record-controls.mjs';

export const DEFAULT_DIR = 'docs/governance/evidence';

// Artifact filename → evidence type. The names are the ones the release skill and the worked
// example already use; a file outside this map is not evidence and is reported, not sealed.
export const ARTIFACT_FILES = {
  'tests.json': 'tests',
  'reviews.json': 'reviews',
  'lineage.json': 'lineage',
  'model-provenance.json': 'model-provenance',
  'control-plane.json': 'control-plane',
  'sast.sarif': 'sast',
  'sast.json': 'sast',
  'sbom.cdx.json': 'sbom',
  'sbom.json': 'sbom',
  'dependency-audit.json': 'dependency-audit',
  'provenance.json': 'provenance',
  'brainkit-provenance.json': 'brainkit-provenance',
};

/** The evidence type a filename seals as, or null when the file is not evidence. Any
 * `gate-run*.json` is the runner's emitted record (gate-run.json, gate-run-release.json, …). */
export function typeOfFile(name) {
  if (ARTIFACT_FILES[name]) return ARTIFACT_FILES[name];
  if (/^gate-run[A-Za-z0-9._-]*\.json$/.test(name)) return 'gate-run';
  return null;
}

/**
 * Classify a directory's files into chain entries (ordered by the required-types contract, then
 * every other recognised type in stable name order) and the files left out of the chain.
 * Pure over a file listing so the ordering rule is testable without a filesystem.
 */
export function collect(names, requiredTypes) {
  const byType = new Map();
  const unsealed = [];
  for (const name of [...names].sort()) {
    if (name === 'manifest.json') continue; // the output, never its own entry
    const type = typeOfFile(name);
    if (!type) { unsealed.push(name); continue; }
    byType.set(type, [...(byType.get(type) || []), name]);
  }
  const entries = [];
  const seen = new Set();
  for (const type of requiredTypes) {
    seen.add(type);
    for (const ref of byType.get(type) || []) entries.push({ type, ref });
  }
  // Recognised types beyond the contract (gate-run today; a plan-only type an aggregate did not
  // demand) still seal — extra evidence is chained, and the gate's semantics still judge it.
  for (const [type, refs] of [...byType.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (seen.has(type)) continue;
    for (const ref of refs) entries.push({ type, ref });
  }
  return { entries, unsealed };
}

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * Build the manifest for one evidence directory: hash, order, chain, anchor. Returns everything
 * the CLI needs to verify and report; writes nothing.
 */
export function buildManifest({ cwd = process.cwd(), dir, commit, release = undefined } = {}) {
  const requiredTypes = requiredTypesFor(aggregateRequirements(cwd));
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  const { entries: rawOrder, unsealed } = collect(names, requiredTypes);
  const raw = rawOrder.map((e) => ({ type: e.type, ref: e.ref, sha256: sha256File(join(dir, e.ref)) }));
  const entries = buildChain(raw);
  const manifest = { release, release_commit: commit, entries };
  if (entries.length) manifest.anchor = entries[entries.length - 1].seal;
  return { manifest, requiredTypes, unsealed };
}

function gitHead(cwd) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dirArg = arg('--dir') || DEFAULT_DIR;
  const dir = isAbsolute(dirArg) ? dirArg : resolve(cwd, dirArg);
  if (!existsSync(dir)) {
    process.stderr.write(`no evidence directory at ${dir} — nothing to seal (pass --dir)\n`);
    return 2;
  }
  const commit = arg('--commit') || gitHead(cwd);
  if (!commit) {
    process.stderr.write('no release commit: not a git checkout and no --commit given — evidence must be bound to the released commit\n');
    return 2;
  }
  // rc.36 (D5): a commit this repository never contained must not be sealed against. In a non-git
  // context the check is NOT performable, and that is said aloud below — never a silent pass.
  const commitCheck = verifyReleaseCommit(commit, cwd);
  if (commitCheck.status === 'failed') {
    process.stderr.write('\nseal-evidence — REFUSED (nothing written)\n\n');
    for (const f of commitCheck.findings) process.stderr.write(`  - ${f}\n`);
    return 1;
  }

  // Preserve an existing manifest's release id (the collector derives evidence, it does not
  // rename the release); a stale attestation over the OLD anchor is dropped LOUDLY — carrying it
  // forward would present a signature over a chain that no longer exists.
  const manifestPath = join(dir, 'manifest.json');
  let previous = null;
  if (existsSync(manifestPath)) {
    try { previous = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { previous = null; }
  }
  const release = arg('--release') || previous?.release;

  const { manifest, requiredTypes, unsealed } = buildManifest({ cwd, dir, commit, release });

  // The refusal: the gate's own evaluate(), on the collector's own output, BEFORE anything is
  // written. A bundle that would fail verification is never written — there is no state in which
  // this tool has produced a manifest the seal gate rejects.
  const findings = evaluate(manifest, { baseDir: dir, requiredTypes });
  if (findings.length) {
    process.stderr.write('\nseal-evidence — REFUSED (nothing written)\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe collector derives evidence; it never repairs it. Fix what the artifacts report\n(or supply the missing ones), then re-run. See scripts/evidence-seal-check.mjs.\n');
    return 1;
  }

  if (previous?.attestation) {
    process.stdout.write('note: the previous manifest carried an attestation over the OLD anchor — dropped, not copied.\nRe-anchor the new final seal to your external store and re-attest it.\n');
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (commitCheck.note) process.stdout.write(`NOTE: ${commitCheck.note}\n`);
  const sealedGateRun = manifest.entries.some((e) => e.type === 'gate-run');
  process.stdout.write(
    `\nseal-evidence — sealed ${manifest.entries.length} artifact(s) at ${commit.slice(0, 12)} → ${manifestPath}\n` +
    `  required-types contract: ${requiredTypes.join(', ')}\n` +
    `  gate-run record: ${sealedGateRun ? 'sealed into the chain' : 'none present (run core/gate-runner.mjs --emit-dir to produce one)'}\n` +
    `  anchor (publish to your external WORM/RFC-3161 store): ${manifest.anchor}\n`,
  );
  if (unsealed.length) {
    process.stdout.write('  not evidence, left OUT of the chain (said aloud, never silent):\n');
    for (const n of unsealed) process.stdout.write(`    · ${n}\n`);
  }
  process.stdout.write('\nverified by evidence-seal-check.evaluate() before writing — re-run the gate any time:\n  node scripts/evidence-seal-check.mjs\n');
  return 0;
}

/**
 * 2.1.0 (hardening plan row 2.5, decision K9): put the anchor in the external record. Posts a
 * signed `seal-anchor` envelope through core/external-record.mjs and, when the provider returns
 * an id, writes `external_record { provider, id, ref, recorded_at }` on the manifest — the field
 * scripts/evidence-seal-check.mjs resolves at the provider when a compiled plan requires
 * `external_record`. Unmounted: a note, the manifest untouched, exit 0 — PS-R06 owns that
 * finding. Queued: a note, exit 4. Rejected: exit 3 — a seal whose record the rules refuse is
 * reported, never quietly unrecorded.
 */
export async function recordAnchor({ cwd = process.cwd(), dir, trail = null, actor = null, issuer = null, keyPath = null, dryRun = false } = {}) {
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const st = recordStatus(cwd);
  if (!st.mounted) return { status: 'unmounted', reason: st.reason };
  const signer = signerFromArgs({ issuer, keyPath });
  const subjectTrail = trail || (aggregateRequirements(cwd).changes.map((c) => c.change_id).filter(Boolean).sort()[0] ?? null);
  if (!subjectTrail) return { status: 'rejected', findings: ['no implicated change envelope and no --trail — a seal anchor binds to a change'] };
  let envl = buildEnvelope({ kind: 'seal-anchor', name: 'seal-anchor', subject: { flow: 'delivery', trail: subjectTrail }, commit: manifest.release_commit,
    actor: actorFor(cwd, actor || process.env.LOOM_ACTOR_ID || null), runner: runnerFromEnv(process.env, manifest.release_commit), controls: controlsForRecord(loadObligations(cwd), ['HG-0003']),
    payload: { anchor: manifest.anchor, release: manifest.release ?? null, release_commit: manifest.release_commit, entries: manifest.entries.length, types: manifest.entries.map((e) => e.type) } });
  if (signer) envl = signEnvelope(envl, signer);
  const r = await recordPost(envl, { cwd, dryRun });
  if (r.status === 'recorded' && !r.dry_run) {
    manifest.external_record = { provider: r.provider, id: r.id, ref: r.ref, recorded_at: r.recorded_at };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  return r;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  // --record: seal, then record the anchor. --record-only: record the anchor of the manifest as
  // it stands (after a re-derive that already signed it — resealing would drop that signature).
  const recordOnly = argv.includes('--record-only');
  const code = recordOnly ? 0 : main(argv);
  if (code !== 0 || !(argv.includes('--record') || recordOnly)) process.exit(code);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dirArg = arg('--dir') || DEFAULT_DIR;
  recordAnchor({ dir: isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg), trail: arg('--trail'), actor: arg('--actor'), issuer: arg('--record-issuer'), keyPath: arg('--record-key'), dryRun: argv.includes('--dry-run') }).then((r) => {
    if (r.status === 'recorded') { process.stdout.write(`  external record (${r.provider}): anchor recorded${r.dry_run ? ' (dry run — manifest untouched)' : ` as ${r.id} — written to manifest.external_record`}\n`); process.exit(0); }
    if (r.status === 'unmounted') { process.stdout.write(`  external record: not mounted — ${r.reason}\n`); process.exit(0); }
    if (r.status === 'queued') { process.stdout.write(`  external record: provider call failed — envelope queued${r.file ? ` at ${r.file}` : ''} (${r.error})\n`); process.exit(4); }
    process.stderr.write('\nseal-evidence --record — the seal-anchor envelope was REFUSED by the provenance rules (nothing posted):\n');
    for (const f of r.findings || []) process.stderr.write(`  - ${f}\n`);
    process.exit(3);
  });
}
