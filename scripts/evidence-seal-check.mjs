// HG-0003 — the evidence-seal gate. An ungoverned harness self-attests its change records:
// "the tests passed, the reviewers approved" — narrated, not sealed. The decision that closes
// the gap is externally-anchored traceability + tamper-evident evidence: the release bundle is
// SEALED, not narrated. This gate enforces the repo-side half deterministically over an
// evidence manifest (the index the delivery loop writes at step ⑧):
//
//   The evidence entries form an append-only HASH CHAIN, the required evidence is complete,
//   the bundle is BOUND to a release commit, and each sealed artifact is verified for what it
//   SAYS (tests pass, verdicts are PASS/CONFORMANT, scans are clean) — not just for its bytes.
//
// Each entry seals `sha256(prev | type | ref | sha256-of-artifact)`, so altering any artifact
// (without recomputing every downstream seal), reordering entries, or dropping one breaks the
// chain and fails the gate. The final seal is the bundle's fingerprint; publishing it to an
// external, append-only, timestamped store (WORM + an RFC-3161 timestamping authority) is what
// makes a fully-recomputed chain detectable too — that anchor is the adopter's, and if recorded
// as `manifest.anchor` this gate checks the chain resolves to it.
//
// RELEASE TRAINS (rc.38 · flow-plan Phase 4.4). Where a train under docs/governance/release-trains/
// names this bundle's release commit, the required evidence is derived from the changes the train
// ACTUALLY CARRIES rather than from every non-terminal change in the repository — the release-level
// act is taken once per train, and the enumeration is a governed artifact instead of a question
// asked in a channel. Per-change PA2 is untouched. A train is honoured only when EVERY train in
// the repository validates; anything else and the derivation falls back to the repo-wide union.
//
// Run from the repo root: `node scripts/evidence-seal-check.mjs` (exit 1 on any finding).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { evaluate as evaluateSarif } from './sast-check.mjs';
import { checkAudit } from './supply-chain-check.mjs';
import { CHANGES_DIR, aggregateRequirements } from '../core/compiled-requirements.mjs';
import { TRAINS_DIR, evaluateTrains, trainForCommit } from '../core/release-trains.mjs';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { pathToFileURL } from 'node:url';
import { CAPABILITY as EXTERNAL_RECORD, resolve as resolveRecord, status as recordStatus } from '../core/external-record.mjs';
import { capabilityRequired } from '../core/compiled-requirements.mjs';

// Exported (rc.33): release-attestation-check reads the SAME list, so the two gates can never
// again resolve DIFFERENT manifests in one repo — the lists had quietly diverged.
export const MANIFEST_LOCATIONS = ['docs/governance/evidence/manifest.json', 'evidence-manifest.json'];
const GENESIS = 'GENESIS';

// ADOPT: the evidence every release must carry. Add yours (smoke results, attestations).
export const REQUIRED_TYPES = ['tests', 'reviews', 'lineage', 'model-provenance', 'control-plane', 'sast', 'sbom', 'dependency-audit', 'provenance'];
// The floor every sealed release carries regardless of tier.
export const EVIDENCE_FLOOR = ['tests', 'reviews', 'control-plane'];
// rc.8 hardening: evidence types that exist ONLY when a compiled plan demands them. Not in the
// default baseline (a generic repo never seals them), but the seal knows how to verify them — so
// a plan that requires brainkit-provenance makes it a sealed, semantically-checked artifact, not
// a rendering courtesy. The audit's gap: "brainkit-provenance is ignored by the evidence-seal
// gate"; this is what closes it. brainkit-check cross-checks the digest against the live BrainKit.
// rc.41 adds `shariah-attestation` to the same list on the same terms — the Islamic-product
// profile compiles it as required evidence, and a repository whose plans name no Islamic product
// never seals it and never sees this validator run.
export const PLAN_ONLY_TYPES = ['brainkit-provenance', 'shariah-attestation'];

/**
 * The evidence types a release must seal, DERIVED from the compiled plans (W1, closes F1)
 * rather than a fixed list. With no governed changes it falls back to the fixed baseline
 * (backward compatible). With changes, it is the floor plus every plan-required evidence type
 * the seal knows how to verify — so a low-tier change seals less, a high-tier change seals more,
 * and the requirement is compiled, never hardcoded. Plan evidence with no sealed counterpart
 * (e.g. product-eval, external-anchor) is enforced by its own gate, not demanded here.
 */
export function requiredTypesFor(agg, base = REQUIRED_TYPES) {
  if (!agg || agg.evidence.size === 0) return base;
  const known = new Set([...base, ...PLAN_ONLY_TYPES]);
  const req = new Set(EVIDENCE_FLOOR);
  for (const e of agg.evidence) if (known.has(e)) req.add(e);
  return [...req];
}

// Semantic validation — 1.10's rule: a sealed artifact is verified for what it SAYS, not just
// that its bytes are intact. A sealed bundle of failing tests is tamper-evident and worthless.
export const SEMANTICS = {
  tests: (a, ctx) => {
    const f = [];
    if (a.failed !== 0) f.push(`sealed test results are not clean (failed=${JSON.stringify(a.failed)})`);
    if (!(a.passed > 0)) f.push('sealed test results show no passing tests');
    if (ctx.releaseCommit && a.commit !== ctx.releaseCommit) f.push(`sealed test results were produced at ${JSON.stringify(a.commit)}, not the release commit ${JSON.stringify(ctx.releaseCommit)}`);
    return f;
  },
  reviews: (a) => Object.entries(a).filter(([k]) => !k.startsWith('_'))
    .flatMap(([k, v]) => (v === 'PASS' || v === 'CONFORMANT') ? [] : [`sealed reviewer verdict ${k}=${JSON.stringify(v)} is not PASS/CONFORMANT`]),
  'model-provenance': (a) => a.result === 'OK' ? [] : ['sealed model-provenance record does not show the gate passing'],
  'control-plane': (a) => a.result === 'OK' ? [] : ['sealed control-plane record does not show the gate passing'],
  lineage: (a) => (a.emits_lineage === true && a.insert_only === true) ? [] : ['sealed lineage evidence does not show insert-only stores emitting lineage'],
  sast: (a) => evaluateSarif(a).map((f) => `sealed SAST report: ${f}`),
  sbom: (a) => (a.bomFormat === 'CycloneDX' && Array.isArray(a.components) && a.components.length > 0) ? [] : ['sealed SBOM is empty or not CycloneDX'],
  // Shares the Q4 gate's judgement rather than restating it: a bundle that cleared Q4 by
  // reachability calibration must not then be rejected by the seal for the raw totals.
  'dependency-audit': (a) => checkAudit(a).map((f) => `sealed dependency audit: ${f}`),
  provenance: (a) => (Array.isArray(a.subject) && a.subject.length > 0 && a.subject.every((s) => s?.digest?.sha256)
    && (a.predicate?.builder?.id || a.builder?.id)) ? [] : ['sealed provenance lacks subject digests or a builder'],
  // rc.35 (flow-plan Phase 2): the gate runner's own record joins the chain — the most
  // trustworthy artifact CI produces is sealed instead of expiring as a CI artifact. A sealed
  // gate-run must record a PASSING run (sealing a failing run would launder the failure into
  // release evidence), and when it names a commit, that commit must be the release commit.
  // Deliberately NOT in REQUIRED_TYPES or EVIDENCE_FLOOR: demanding it today would break every
  // existing bundle. scripts/seal-evidence.mjs seals it whenever the runner's --emit-dir record
  // is present in the evidence directory.
  'gate-run': (a, ctx) => {
    const f = [];
    if (a.result !== 'pass') f.push(`sealed gate-run record is not a passing run (result=${JSON.stringify(a.result)}) — a failed run is not release evidence`);
    if (ctx.releaseCommit && a.commit && a.commit !== ctx.releaseCommit) f.push(`sealed gate-run record was produced at ${JSON.stringify(a.commit)}, not the release commit ${JSON.stringify(ctx.releaseCommit)}`);
    return f;
  },
  // rc.8 hardening: a sealed brainkit-provenance record must NAME the BrainKit it claims (id,
  // version, sha256 package digest) and LIST the artifacts it covers. Whether that digest is the
  // LIVE BrainKit's — and whether each listed artifact actually embeds it — is brainkit-check's
  // cross-check; the seal verifies the record is complete and well-formed, not merely present.
  'brainkit-provenance': (a) => {
    const f = [];
    for (const field of ['brainkit_id', 'brainkit_version']) {
      if (!(typeof a[field] === 'string' && a[field].trim())) f.push(`sealed brainkit-provenance declares no ${field}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(a.brainkit_digest || '')) f.push('sealed brainkit-provenance has no sha256 brainkit_digest — an unidentified BrainKit is a claim, not provenance');
    if (!Array.isArray(a.artifacts) || a.artifacts.length === 0) f.push('sealed brainkit-provenance lists no artifacts — provenance must say WHICH artifacts it covers');
    return f;
  },
  // The tenth evidence type (rc.41 · Islamic plane). PLAN-ONLY on the brainkit-provenance terms:
  // the Islamic-product profile compiles it, nothing else does, so a conventional adopter never
  // seals one and never reaches this validator.
  //
  // THE ATTESTATION RECORDS A HUMAN DECISION; IT NEVER CONSTITUTES ONE. Scholars decide Shari'ah.
  // What is verified here is COMPOSITION, PROVENANCE and BINDING: an attester who resolves to a
  // HUMAN registry identity, the already-taken committee decision the shipped structures are
  // approved under, WHICH register rows those structures are, a PASS result, and the release
  // commit the assertion was made at. A clean result means the record is complete and bound —
  // "structure-conformant" — and never that anything is Shari'ah-compliant: this reads a JSON
  // file at release time and has no view of what the product does in production.
  //
  // WHAT NOTHING VERIFIES — say it plainly, because attributing this to another gate is how a gap
  // becomes invisible. This validator does not resolve `issc_decision_ref` or the ids in
  // `structures` against docs/governance/shariah-rulings.json, and NO gate in this bundle resolves
  // them FOR THIS ARTIFACT. Two nearby joins exist and neither covers it: SG-R08 (shariah-
  // governance-check) resolves the refs carried by the entries under docs/governance/shariah-
  // structures/, and product-approval-check resolves the ref carried by the CHANGE ENVELOPE on the
  // conforming lane. Both read other files; neither ever opens a sealed attestation. So an
  // attestation citing a decision that was never issued, or one since superseded, or naming
  // structure ids no register row carries, seals clean here. The only reader of that gap today is
  // HUMAN: the Shari'ah Compliance Function checking the attestation against the register before it
  // is sealed. Mechanically closing it would take a gate that reads THIS artifact against the
  // rulings register. Until one exists, a clean result means the record is well-formed, bound, and
  // made by somebody who could make it — and says nothing about whether what it cites is real.
  'shariah-attestation': (a, ctx) => {
    const f = [];
    if (!nonEmpty(a.attester_id)) {
      f.push('sealed shariah-attestation names no attester_id — an attestation nobody is named for is a claim with no author');
    } else if (!ctx.registry) {
      f.push(`sealed shariah-attestation attester_id ${JSON.stringify(a.attester_id)} cannot be resolved — no identity registry was loaded, and an unresolvable attester does not count`);
    } else {
      const who = identityOf(ctx.registry, a.attester_id);
      if (!who) f.push(`sealed shariah-attestation attester_id ${JSON.stringify(a.attester_id)} does not resolve in the identity registry — an approval that resolves to nobody is not an approval`);
      else if (who.kind === 'agent') f.push(`sealed shariah-attestation attester_id ${JSON.stringify(a.attester_id)} is an AGENT — the record of a Shari'ah decision may be PREPARED by an agent and may never be MADE by one`);
    }
    if (!nonEmpty(a.issc_decision_ref)) {
      f.push('sealed shariah-attestation names no issc_decision_ref — an attestation that cites no committee decision asserts approval on its own authority, which is the defect this evidence type exists to prevent');
    }
    if (!Array.isArray(a.structures) || a.structures.length === 0 || !a.structures.every(nonEmpty)) {
      f.push(`sealed shariah-attestation lists no structures (got ${JSON.stringify(a.structures)}) — it must say WHICH register rows the shipped structures are, or it approves everything and nothing`);
    }
    if (a.result !== 'PASS') f.push(`sealed shariah-attestation result is ${JSON.stringify(a.result)}, not PASS — sealing a non-passing attestation launders it into release evidence`);
    if (ctx.releaseCommit && a.commit !== ctx.releaseCommit) {
      f.push(`sealed shariah-attestation was made at ${JSON.stringify(a.commit)}, not the release commit ${JSON.stringify(ctx.releaseCommit)} — an approval given for one build is not an approval of another`);
    }
    return f;
  },
};

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** The seal for one entry, chained onto `prev`. Deterministic and content-addressed. */
export function sealOf(prev, e) {
  return sha256(`${prev}\n${e.type}\n${e.ref}\n${e.sha256}`);
}

/** Fill prev + seal across a list of raw entries ({type, ref, sha256}) → a valid chain. */
export function buildChain(rawEntries) {
  let prev = GENESIS;
  return rawEntries.map((e) => {
    const seal = sealOf(prev, { type: e.type, ref: e.ref, sha256: e.sha256 });
    const out = { ...e, prev, seal };
    prev = seal;
    return out;
  });
}

/**
 * Findings (one per break). Empty ⇒ the bundle is a complete, intact, append-only chain.
 * When `baseDir` is given, each entry's artifact at `ref` (resolved relative to baseDir) is read
 * and its sha256 verified against the manifest — so altering the artifact on disk (not just the
 * manifest) is caught, which is what makes the seal tamper-evident. The CLI always passes it.
 *
 * `registry` (rc.41) is the identity registry, reachable by the semantic validators that need to
 * resolve a NAME inside a sealed artifact. Only shariah-attestation uses it today. It defaults to
 * null so every existing caller is unchanged; a validator that needs it and does not get it says
 * so as a finding rather than passing on an unresolvable name.
 */
export function evaluate(manifest, { requiredTypes = REQUIRED_TYPES, baseDir = null, registry = null } = {}) {
  const findings = [];
  const entries = manifest && manifest.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return ['evidence manifest has no `entries` — the release is narrated, not sealed (HG-0003)'];
  }
  const releaseCommit = manifest.release_commit;
  if (!releaseCommit) {
    findings.push('manifest has no `release_commit` — the evidence is not bound to a released commit (semantic binding, 1.10)');
  } else if (!/^[0-9a-f]{40}$/.test(releaseCommit)) {
    // rc.11 (closes F2): a symbolic subject — `release-v-demo`, a tag, a branch name — is not a
    // commit. Evidence bound to a placeholder proves nothing about what shipped. The subject must
    // be a real 40-hex commit sha (the artifact-digest binding is release-attestation-check's).
    findings.push(`manifest release_commit ${JSON.stringify(releaseCommit)} is not a 40-hex commit sha — a symbolic release identifier is not a binding subject (rc.11)`);
  }
  let prev = GENESIS;
  entries.forEach((e, i) => {
    // sealOf() delimits fields with "\n", so a field carrying an embedded newline could shift a
    // boundary and forge a colliding seal. type/ref never legitimately contain one (type is an
    // enum; ref is a filename), so reject it here — this closes the boundary ambiguity WITHOUT
    // changing the hash, which would invalidate the externally-signed anchor we cannot re-sign.
    for (const f of ['type', 'ref']) {
      if (typeof e[f] === 'string' && /[\n\r]/.test(e[f])) {
        findings.push(`entry ${i}: ${f} contains a newline — not permitted (it could forge a seal-field boundary)`);
      }
    }
    const expectSeal = sealOf(prev, e);
    if (e.prev !== prev) {
      findings.push(`entry ${i} (${e.type}): broken chain — prev pointer ${JSON.stringify(e.prev)} ≠ expected ${JSON.stringify(prev)}`);
    }
    if (e.seal !== expectSeal) {
      findings.push(`entry ${i} (${e.type}): seal mismatch — the entry was altered after sealing, or the chain was reordered`);
    }
    if (baseDir && typeof e.ref === 'string') {
      const p = join(baseDir, e.ref);
      if (!existsSync(p)) {
        findings.push(`entry ${i} (${e.type}): sealed artifact ${e.ref} not found — a sealed bundle must contain its evidence`);
      } else if (sha256File(p) !== e.sha256) {
        findings.push(`entry ${i} (${e.type}): artifact ${e.ref} was altered after sealing — its content sha256 no longer matches the manifest`);
      } else if (SEMANTICS[e.type]) {
        // Bytes intact ⇒ now verify what the artifact SAYS. Intact-but-failing is a failure.
        try {
          for (const f of SEMANTICS[e.type](JSON.parse(readFileSync(p, 'utf8')), { releaseCommit, registry })) {
            findings.push(`entry ${i} (${e.type}): ${f}`);
          }
        } catch {
          findings.push(`entry ${i} (${e.type}): sealed artifact ${e.ref} is not parseable JSON — its meaning cannot be verified`);
        }
      }
    }
    prev = expectSeal; // continue from the recomputed seal so errors localise, not cascade
  });
  // rc.36 (flow-plan D4): the anchor is MANDATORY. A manifest that simply omitted the field used
  // to skip anchor verification entirely — the one check that makes a fully-recomputed chain
  // detectable was opt-out by silence. Near-free since rc.35: the collector always writes it.
  if (!(typeof manifest.anchor === 'string' && manifest.anchor)) {
    findings.push('manifest has no `anchor` — without the final seal recorded there is nothing to publish externally and nothing to sign, so a fully-recomputed chain would be undetectable (D4; scripts/seal-evidence.mjs writes it)');
  } else if (manifest.anchor !== prev) {
    findings.push(`external anchor mismatch — the chain resolves to ${prev.slice(0, 12)}… but the anchored seal is ${manifest.anchor.slice(0, 12)}…`);
  }
  const present = new Set(entries.map((e) => e.type));
  for (const t of requiredTypes) if (!present.has(t)) findings.push(`missing required evidence: ${t}`);
  return findings;
}

/**
 * rc.36 (flow-plan D5): the release_commit must EXIST in this repository and be an ancestor of
 * HEAD. A 40-hex sha nobody ever ran passes every shape check; evidence from a commit outside the
 * release line proves nothing about what shipped. Returns { status, findings, note }:
 *   'verified'        — the commit exists here and HEAD descends from it
 *   'failed'          — checkable and wrong (findings say why)
 *   'not-performable' — no git repository at cwd; the check CANNOT run, and that is recorded as
 *                       a note, never as a silent pass (the run record must state what was not
 *                       executed and why)
 *   'not-checked'     — no well-formed commit to check (its absence/shape is evaluate()'s finding)
 */
export function verifyReleaseCommit(commit, cwd = process.cwd()) {
  if (!(typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit))) return { status: 'not-checked', findings: [] };
  const git = (args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git(['rev-parse', '--git-dir']); }
  catch {
    return {
      status: 'not-performable',
      findings: [],
      note: `release_commit existence/ancestry NOT verified — ${cwd} is not a git repository, so the check cannot be performed here (D5). Run the gate in the release checkout; this note is the record of the skip.`,
    };
  }
  try { git(['cat-file', '-e', `${commit}^{commit}`]); }
  catch {
    return { status: 'failed', findings: [`manifest release_commit ${commit} does not exist in this repository — evidence sealed at a commit nobody ran proves nothing about what shipped (D5)`] };
  }
  try { git(['merge-base', '--is-ancestor', commit, 'HEAD']); }
  catch {
    return { status: 'failed', findings: [`manifest release_commit ${commit} is not an ancestor of HEAD — this release line never contained the commit the evidence is bound to (D5)`] };
  }
  return { status: 'verified', findings: [] };
}

/** Every train in the repository: [{ file, train }]. Empty where there are none. */
export function loadTrains(cwd = process.cwd()) {
  const dir = `${cwd}/${TRAINS_DIR}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => {
    try { return { file: n, train: JSON.parse(readFileSync(`${dir}/${n}`, 'utf8')) }; }
    catch { return { file: n, train: null }; }
  });
}

/** The governed change ids in this repository, or null where there is no changes tree. */
export function governedChangeIds(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return null;
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    try { ids.add(JSON.parse(readFileSync(`${dir}/${name}/change-envelope.json`, 'utf8')).change_id || name); }
    catch { ids.add(name); }
  }
  return ids;
}

const firstManifest = (cwd) => MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync) || null;
function run(cwd = process.cwd()) {
  const path = firstManifest(cwd);
  if (!path) return { findings: [`no evidence manifest found (looked in ${MANIFEST_LOCATIONS.join(', ')}) — the release is unsealed`], notes: [] };
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { findings: [`evidence manifest is not valid JSON: ${e.message}`], notes: [] }; }
  // rc.38 (flow-plan Phase 4.4) — a RELEASE TRAIN. Every train is validated whether or not it
  // names this bundle: a malformed or double-claiming train is a broken enumeration wherever it
  // sits. Only a VALID train binding this exact release commit narrows the required evidence, and
  // the narrowing is stated in the run's notes — an enumeration nobody can read is not one.
  const notes = [];
  const findings = [];
  const trains = loadTrains(cwd);
  const registry = loadRegistry(cwd);
  const trainFindings = evaluateTrains(trains, { changeIds: governedChangeIds(cwd), registry, identityOf, notices: notes });
  findings.push(...trainFindings);
  const train = trainFindings.length === 0 ? trainForCommit(trains, manifest.release_commit) : null;
  const changeIds = train ? new Set(train.changes) : null;
  if (train) {
    notes.push(`release train ${train.train_id} carries ${train.changes.length} change(s) (${train.changes.join(', ')}) into commit ${String(train.release_commit).slice(0, 12)}… — the release-level acts are taken ONCE for this bundle, and the required evidence below is derived from these changes rather than from every change in the repository. Per-change PA2 is untouched.`);
  } else if (trains.length) {
    notes.push(`${trains.length} release train(s) present, none of them binding this bundle's release_commit — required evidence is derived from EVERY non-terminal change (the fail-open posture)`);
  }
  const requiredTypes = requiredTypesFor(aggregateRequirements(cwd, { changeIds }));
  findings.push(...evaluate(manifest, { baseDir: dirname(path), requiredTypes, registry }));
  const commitCheck = verifyReleaseCommit(manifest.release_commit, cwd);
  findings.push(...commitCheck.findings);
  if (commitCheck.note) notes.push(commitCheck.note);
  return { findings, notes };
}

/**
 * 2.1.0 (hardening plan row 2.5, decision K9): the anchor must be held OUTSIDE the tree when a
 * compiled plan requires `external_record`. Pure over injected state so it is testable without a
 * provider: `required` (does a plan require the capability), `status` (core/external-record
 * status()), `resolveFn(ref)` (core/external-record resolve()). Findings ([] ⇒ nothing owed here).
 *   not required                          → nothing (the field is optional below the tier)
 *   required, unmounted                   → a NOTE only: PS-R06 owns the missing decision
 *   required, mounted, no field           → finding
 *   field names another provider          → finding (evidence from a record nobody chose)
 *   id unresolved / provider unavailable  → finding, told apart in the text
 *   resolved, record anchor ≠ manifest    → finding (the platform holds a different seal)
 */
export async function externalRecordFindings(manifest, { required, status, resolveFn, notes = null }) {
  if (!required) return [];
  if (!status?.mounted) { notes?.push(`a compiled plan requires ${EXTERNAL_RECORD} but no provider is mounted — the provider-selection gate (PS-R06) owns that finding; the anchor is unrecorded, not wrong`); return []; }
  const xr = manifest?.external_record;
  if (!xr || typeof xr !== 'object' || !xr.id) return [`a compiled plan requires ${EXTERNAL_RECORD} and provider ${status.provider} is mounted, but the manifest carries no external_record id — the anchor exists only in the tree the agent edits (scripts/seal-evidence.mjs --record writes it)`];
  if (xr.provider && xr.provider !== status.provider) return [`manifest external_record names provider ${JSON.stringify(xr.provider)} but the institution selected ${status.provider} — evidence from a record nobody chose`];
  const r = await resolveFn({ ...(xr.ref || {}), provider: xr.provider || status.provider, id: xr.id, name: xr.ref?.name || 'seal-anchor' });
  if (r.status === 'resolved') {
    const held = r.record?.user_data?.payload?.anchor ?? r.record?.payload?.anchor ?? null;
    if (held && manifest.anchor && held !== manifest.anchor) return [`external record ${xr.id} holds anchor ${String(held).slice(0, 12)}… but the manifest is anchored at ${String(manifest.anchor).slice(0, 12)}… — the platform holds a different seal from the one in the tree`];
    if (!status.active) notes?.push(`external record (${status.provider}): anchor ${xr.id} resolves — the provider is selected, not active (activation_evidence still placeholders); the integration run is owed`);
    return [];
  }
  if (r.status === 'unavailable') return [`external record (${status.provider}) could not be reached to resolve anchor ${xr.id} — ${r.reason}. An anchor that cannot be checked is not checked; this is an outage, not a forged id, and the release waits on it`];
  if (r.status === 'mismatch') return [`external record: ${r.reason}`];
  return [`external record (${status.provider}) does NOT hold anchor id ${xr.id} — ${r.reason}. A recomputed chain with a fabricated id is exactly what this check exists to catch`];
}

/** run() plus the external-record resolution — the CLI path. */
export async function runWithRecord(cwd = process.cwd()) {
  const r = run(cwd);
  const path = firstManifest(cwd);
  if (!path) return r;
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch { return r; }
  const required = capabilityRequired(aggregateRequirements(cwd), EXTERNAL_RECORD);
  r.findings.push(...await externalRecordFindings(manifest, { required, status: recordStatus(cwd), resolveFn: (ref) => resolveRecord(ref, { cwd }), notes: r.notes }));
  return r;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notes } = await runWithRecord();
  if (findings.length) {
    process.stderr.write('\nEvidence-seal gate (HG-0003) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe release evidence bundle must be a complete, intact, append-only hash chain.\nSee ../loom/references/delivery-harness.md (step ⑧) and governance.md (HG-0003).\n');
    process.exit(1);
  }
  for (const n of notes) process.stdout.write(`NOTE: ${n}\n`);
  process.stdout.write('Evidence-seal gate (HG-0003) — OK\n');
}
