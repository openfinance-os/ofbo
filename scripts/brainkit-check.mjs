// The BrainKit conformance gate (Loom 2.0-rc.8 WS7). An institution's BrainKit is the governed
// seed of its context brain; this gate makes its integrity a merge condition — but only when it
// MATTERS. Enforcement is mandatory-when-compiled: it fires when a governed change's compiled plan
// carries the brainkit-conformance family (an institution profile is in the envelope), and for any
// BrainKit that claims `approved`. A dormant, adopt-pending draft that no change pins is skipped,
// exactly like product evals — the installer copies a BrainKit template but never fakes its
// activation. When it fires, the gate fails on:
//
//   missing/malformed manifest · a draft/expired/retired BrainKit used by a compiled change ·
//   missing or unresolvable accountable owners · section or package digest mismatch ·
//   missing approved sources or a source whose approver does not resolve · missing/invalid
//   approvals on an approved package · a stale D7 compatibility projection · a compiled plan whose
//   institution binding pins a BrainKit digest ≠ the live one (a wrong/stale artifact provenance).
//
// Say "institutionally conformant", never "regulatorily compliant". Run from the repo root:
// `node scripts/brainkit-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { loadBrainkit, computeDigests, livePackageDigest, LIFECYCLE, SCHEMA_SECTIONS, sectionKeysFor } from '../core/brainkit.mjs';
import { aggregateRequirements, CHANGES_DIR } from '../core/compiled-requirements.mjs';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { pathToFileURL } from 'node:url';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isPlaceholder = (v) => typeof v === 'string' && /ADOPT:/.test(v);

// Files that legitimately live under institution/brainkit/ without being a declared section:
// the manifest itself, and the canonical read-the-BrainKit fragment (copy-manifest ships both).
const KNOWN_NONSECTION = new Set(['manifest.json', 'repository-instructions.md']);

/** Every file under `dir`, as repo-forward-slash relative paths (recursing into subdirs). */
function listFilesRel(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRel(abs, base));
    else out.push(relative(base, abs).split(/[\\/]/).join('/'));
  }
  return out;
}

/** Read a markdown file's --- frontmatter --- into { key: value } (no YAML dependency). */
export function readFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+):\s*"?([^"]*)"?\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const resolvesToHuman = (registry, id) => {
  if (!registry) return true; // no registry mounted — a different gate reports that
  const who = identityOf(registry, id);
  return who && who.kind === 'human';
};

// rc.8 hardening: an approved BrainKit's version is semantic, and its approval is bound to it.
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Findings for the BrainKit. `brainkit` is loadBrainkit()'s result (or null). Empty ⇒ conformant.
 * `enforce` is computed by run(): required (a compiled change pins it) OR the package claims approved.
 * `repoRoot` lets source references and provenance-covered artifacts be checked on disk;
 * `provenanceEvidence` is the sealed brainkit-provenance record(s) from the evidence manifest.
 */
export function evaluate(brainkit, { required = false, registry = null, institutionBindings = [], projection = null, repoRoot = null, provenanceEvidence = null, now = Date.now() } = {}) {
  const findings = [];
  if (!brainkit) {
    if (required) findings.push('a compiled change requires brainkit-conformance, but institution/brainkit/manifest.json is missing — the institutional BrainKit is not mounted');
    return findings;
  }
  if (brainkit.parseError || !brainkit.manifest) {
    return [`BrainKit manifest is not valid JSON: ${brainkit.parseError || 'unparseable'}`];
  }
  const m = brainkit.manifest;
  const enforce = required || m.status === 'approved';
  if (!enforce) return findings; // a dormant draft nobody pins — skipped, like an unadopted template

  // A — required identity fields (an unfilled ADOPT placeholder is not a value).
  for (const f of ['schema_version', 'brainkit_id', 'institution_id', 'version', 'effective_at']) {
    if (!(typeof m[f] === 'string' && m[f].trim()) || isPlaceholder(m[f])) findings.push(`manifest.${f} is missing or an unfilled placeholder`);
  }
  if (!LIFECYCLE.has(m.status)) findings.push(`manifest.status must be one of ${[...LIFECYCLE].join('|')} (got ${JSON.stringify(m.status)})`);
  // rc.8 hardening (audit gap 3): distribution and rollback reason about versions, so the
  // version must be semantic — "not-semver" is not a release identity.
  if (typeof m.version === 'string' && !isPlaceholder(m.version) && !SEMVER.test(m.version)) {
    findings.push(`manifest.version ${JSON.stringify(m.version)} is not semantic (MAJOR.MINOR.PATCH) — releases and rollbacks are versioned`);
  }

  // rc.8 hardening (audit gap 2): the canonical section set is COMPLETE and UNIQUE. Checking only
  // the declared sections let an approved package silently omit one — remove `architecture` from
  // manifest.sections, reseal, and the old gate was blind. Every canonical section must be
  // declared exactly once; extra institution-specific sections are allowed (and digest-checked).
  // 2.2.0: the canonical set is the one the manifest's schema_version names (1.0 = six sections,
  // 1.1 adds `strategy`). An unknown schema is a finding — the gate never guesses a section set.
  if (typeof m.schema_version === 'string' && !isPlaceholder(m.schema_version) && !SCHEMA_SECTIONS[m.schema_version]) {
    findings.push(`manifest.schema_version ${JSON.stringify(m.schema_version)} is not a known BrainKit schema (${Object.keys(SCHEMA_SECTIONS).join(', ')}) — the canonical section set cannot be determined`);
  }
  const SECTION_KEYS = sectionKeysFor(m);
  const declared = (m.sections || []).map((s) => s.section);
  for (const key of SECTION_KEYS) {
    if (!declared.includes(key)) findings.push(`canonical section ${key} is not declared in manifest.sections — a BrainKit cannot silently omit a canonical section`);
  }
  for (const dupe of new Set(declared.filter((s, i) => declared.indexOf(s) !== i))) {
    findings.push(`section ${dupe} is declared more than once — the section set must be unique`);
  }

  // B — lifecycle. A change that COMPILED brainkit-conformance may only use an approved, effective,
  // unexpired BrainKit. (An approved-but-dormant package is integrity-checked below but not gated on use.)
  if (required) {
    if (m.status !== 'approved') findings.push(`a compiled change pins this BrainKit, but its status is ${JSON.stringify(m.status)} — only an approved BrainKit satisfies a compiled change`);
    const eff = Date.parse(m.effective_at);
    if (!Number.isNaN(eff) && eff > now) findings.push(`BrainKit effective_at ${m.effective_at} is in the future — it is not yet effective`);
    if (m.expires_at) {
      const exp = Date.parse(m.expires_at);
      if (!Number.isNaN(exp) && exp < now) findings.push(`BrainKit expired ${m.expires_at} — an expired BrainKit blocks a compiled change`);
    }
  }

  // C — accountable owners resolve to registry humans, one per section (canonical AND declared —
  // an institution-specific extra section is owned too, or it is ungoverned content).
  const owners = m.owners || {};
  for (const section of new Set([...SECTION_KEYS, ...declared])) {
    const owner = owners[section];
    if (!(typeof owner === 'string' && owner.trim()) || isPlaceholder(owner)) findings.push(`section ${section} has no accountable owner`);
    else if (!resolvesToHuman(registry, owner)) findings.push(`section ${section} owner ${JSON.stringify(owner)} does not resolve to a human in the identity registry`);
  }

  // D — section + package digests match the actual files.
  const computed = computeDigests(brainkit.dir, m);
  const byName = new Map(computed.sections.map((s) => [s.section, s]));
  for (const s of m.sections || []) {
    const got = byName.get(s.section);
    if (!got || got.digest === null) findings.push(`section ${s.section}: file ${s.path} is missing — cannot verify its digest`);
    else if (isPlaceholder(s.digest) || s.digest !== got.digest) findings.push(`section ${s.section}: declared digest does not match ${s.path} — the section was changed without resealing`);
  }
  if (isPlaceholder(m.package_digest) || m.package_digest !== computed.package_digest) {
    findings.push('package_digest does not match the section digests — the BrainKit was changed without resealing (run brainkit-check --seal)');
  }

  // D2 — no UNDECLARED files under institution/brainkit/. computeDigests hashes only declared
  // section paths, so a file dropped in beside them (e.g. an extra policy the agent is told to
  // obey via repository-instructions.md's "conform to the whole directory") sits OUTSIDE the
  // digest envelope: binding institutional context with no owner, no grounding, no reseal. The
  // package digest never moves when it is added, so no plan goes stale. Fail on it.
  if (repoRoot) {
    const declaredPaths = new Set((m.sections || []).map((s) => s.path));
    for (const rel of listFilesRel(brainkit.dir)) {
      if (KNOWN_NONSECTION.has(rel) || declaredPaths.has(rel)) continue;
      findings.push(`institution/brainkit/${rel} is not a declared section (nor the manifest / repository-instructions) — undeclared BrainKit content is outside the digest envelope; declare it as a section and reseal, or remove it`);
    }
  }

  // E — approved sources: every section grounds in the source register; approvers resolve.
  const register = readJson(join(brainkit.dir, 'source-register.json'));
  const sources = register?.sources?.filter((s) => !isPlaceholder(s.id)) || [];
  if (required && sources.length === 0) findings.push('source-register.json lists no approved sources — a BrainKit section must ground in approved institutional sources, not inference');
  for (const s of sources) {
    if (!resolvesToHuman(registry, s.approved_by)) findings.push(`source ${JSON.stringify(s.id)} approved_by ${JSON.stringify(s.approved_by)} does not resolve to a human — an unapproved source is not authoritative`);
    // rc.8 hardening (audit gap 4): a repo-relative reference (a regulated-context or solution-
    // domain pointer, e.g. the D6 register) must EXIST — a broken pointer is broken grounding.
    // Scheme-qualified references (https://, internal://, doc ids with a scheme) are external
    // and out of mechanical reach.
    if (repoRoot && typeof s.reference === 'string' && s.reference.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(s.reference) && !isPlaceholder(s.reference)) {
      if (!existsSync(join(repoRoot, s.reference))) findings.push(`source ${s.id} references ${s.reference}, which does not exist in the repository — a broken regulated-context or domain reference blocks`);
    }
  }
  const sourceIds = new Set(sources.map((s) => s.id));
  const manifestSources = (m.approved_sources || []).filter((r) => !isPlaceholder(r));
  // rc.8 hardening (audit gap 4): an EMPTY approved_sources list passed while the register held
  // unrelated sources. Grounding is now positive: the manifest names its sources, and every
  // section maps to at least one register source.
  if (manifestSources.length === 0) findings.push('manifest.approved_sources is empty — a BrainKit must name the approved sources it grounds in');
  for (const ref of manifestSources) {
    if (!sourceIds.has(ref)) findings.push(`manifest.approved_sources references ${JSON.stringify(ref)}, which is not in source-register.json`);
  }
  for (const s of m.sections || []) {
    const secSources = (s.sources || []).filter((x) => !isPlaceholder(x));
    if (secSources.length === 0) findings.push(`section ${s.section} declares no approved sources — every section grounds, per section, in the source register`);
    for (const id of secSources) {
      if (!sourceIds.has(id)) findings.push(`section ${s.section} cites source ${JSON.stringify(id)}, which is not in source-register.json`);
    }
  }

  // F — approvals on an approved package: at least one, resolving to a human context owner, and
  // BOUND to the version it approved (audit gap 3: version drifted to a value nobody approved and
  // the gate still passed — approval of 1.0.0 is not approval of whatever the manifest says now).
  if (m.status === 'approved') {
    const approvals = m.approvals || [];
    if (approvals.length === 0) findings.push('an approved BrainKit carries no approvals — approval must be recorded and resolvable');
    for (const a of approvals) {
      const who = registry && identityOf(registry, a.by);
      if (registry && (!who || who.kind !== 'human')) findings.push(`approval by ${JSON.stringify(a.by)} does not resolve to a human identity — an agent cannot approve institutional context`);
      else if (registry && who && !(who.roles || []).includes('institutional-context-owner')) findings.push(`approval by ${a.by} does not hold the institutional-context-owner role`);
    }
    if (approvals.length > 0 && !approvals.some((a) => a.version === m.version)) {
      findings.push(`no approval covers version ${JSON.stringify(m.version)} — approval is bound to the version it approved; a version change needs a new approval`);
    }
  }

  // G — the D7 compatibility projection must not be stale. A BrainKit-bound repo (required)
  // projects identity to D7 WITH provenance stamped. Three failure modes, not one:
  //   · missing file / no frontmatter                       (projection === null)
  //   · frontmatter present but NO brainkit provenance at all — the ungoverned, hand-written
  //     seam the installer ships by default: a repo can mount an approved BrainKit, never
  //     regenerate the seam, and every visual then renders from ungoverned context. The old
  //     gate only checked digest/version drift, so an absent stamp fired nothing and passed.
  //   · a stamped-but-stale digest or version               (the drift checks below)
  if (projection === null) {
    if (required) findings.push('the D7 compatibility projection discovery/brand/design.md is missing or has no frontmatter — a BrainKit-bound repo projects identity to D7');
  } else {
    if (required && !projection.brainkit_digest && !projection.brainkit_version) {
      findings.push('the D7 compatibility projection discovery/brand/design.md carries no BrainKit provenance (brainkit_digest/brainkit_version) — regenerate it from the approved BrainKit so D7 identity is governed, not a hand-written seam');
    }
    if (projection.brainkit_digest && projection.brainkit_digest !== computed.package_digest) {
      findings.push(`the D7 compatibility projection cites BrainKit digest ${String(projection.brainkit_digest).slice(0, 20)}… but the live BrainKit is ${computed.package_digest.slice(0, 20)}… — regenerate the projection`);
    }
    if (projection.brainkit_version && m.version && projection.brainkit_version !== m.version) {
      findings.push(`the D7 compatibility projection cites BrainKit version ${projection.brainkit_version} but the BrainKit is ${m.version} — regenerate the projection`);
    }
  }

  // H — a compiled plan's institution binding must pin the LIVE BrainKit digest.
  const live = livePackageDigest(brainkit.dir, m);
  for (const b of institutionBindings) {
    if (b.brainkit_digest && b.brainkit_digest !== live) {
      findings.push(`change ${b.change_id}: its compiled plan pins BrainKit digest ${String(b.brainkit_digest).slice(0, 20)}… but the live BrainKit is ${live.slice(0, 20)}… — the plan is stale or the artifact cites the wrong BrainKit`);
    }
    // rc.8 WS9 — multi-repo distribution: a repo may pin the approved RELEASE digest in its
    // institution profile. The mounted snapshot must match it, or the repo is running an
    // unadopted BrainKit version (adopt a new version through a reviewed PR; no live service).
    if (b.release_digest && b.release_digest !== live) {
      findings.push(`the mounted BrainKit snapshot (${live.slice(0, 20)}…) does not match the release digest pinned by profile ${b.profile} (${String(b.release_digest).slice(0, 20)}…) — mount the approved release, or adopt a new version through a reviewed PR`);
    }
  }

  // I — rc.8 hardening (audit gap 1): artifact provenance is ENFORCED, not just rendered. The
  // evidence-seal gate demands a sealed brainkit-provenance record whenever a compiled plan
  // requires the evidence type; here its CONTENT is cross-checked against the live BrainKit —
  // the record must pin the live package digest, and every artifact it covers must exist and
  // EMBED that digest (renderers stamp it into HTML meta and OOXML core properties, both stored
  // uncompressed, so a byte scan is exact). A correct visual carrying the wrong digest fails.
  for (const pe of provenanceEvidence || []) {
    const label = `brainkit-provenance ${pe.ref || '(inline)'}`;
    const a = pe.artifact;
    if (!a) { findings.push(`${label}: the sealed provenance record is missing or unparseable`); continue; }
    if (a.brainkit_digest !== live) {
      findings.push(`${label}: pins BrainKit digest ${String(a.brainkit_digest).slice(0, 20)}… but the live BrainKit is ${live.slice(0, 20)}… — provenance of a different BrainKit is not provenance of this one`);
      continue; // per-artifact scans against a wrong pin would double-report
    }
    if (a.brainkit_version !== m.version) findings.push(`${label}: cites BrainKit version ${JSON.stringify(a.brainkit_version)} but the BrainKit is ${m.version}`);
    for (const art of a.artifacts || []) {
      const ref = typeof art === 'string' ? art : art?.ref;
      if (!ref) { findings.push(`${label}: an artifact entry has no ref`); continue; }
      if (!repoRoot) continue; // no disk context (pure-unit call) — run() always provides it
      const p = join(repoRoot, ref);
      if (!existsSync(p)) findings.push(`${label}: covered artifact ${ref} does not exist — provenance of an absent artifact is a claim`);
      else if (!readFileSync(p).includes(live)) findings.push(`${label}: artifact ${ref} does not embed the live BrainKit digest — it was rendered against a different BrainKit (regenerate it)`);
    }
  }
  return findings;
}

/** The approved release digest a profile pins (rc.8 WS9), or undefined. */
function releaseDigestOf(cwd, profileName) {
  const p = join(cwd, 'profiles', 'institutions', `${profileName}.json`);
  const profile = readJson(p);
  return profile?.brainkit?.release_digest;
}

/** Collect, per governed change, any institution profile_bindings in its stored plan. */
function institutionBindingsOf(cwd) {
  const dir = join(cwd, CHANGES_DIR);
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const envelope = readJson(join(dir, name, 'change-envelope.json'));
    if (!envelope) continue;
    const plan = readJson(join(dir, name, envelope.control_plan || 'control-plan.json'));
    for (const b of plan?.profile_bindings || []) {
      if (b.kind === 'institution') out.push({ ...b, change_id: envelope.change_id || name, release_digest: releaseDigestOf(cwd, b.profile) });
    }
  }
  return out;
}

/** The sealed brainkit-provenance records from the evidence manifest ({ref, artifact}[]).
 *  Presence when a plan requires the type is the evidence-seal gate's demand; this collects
 *  whatever exists so evaluate() can cross-check its content against the live BrainKit. */
function provenanceEvidenceOf(cwd) {
  const manifest = readJson(join(cwd, 'docs/governance/evidence/manifest.json'));
  const out = [];
  for (const e of manifest?.entries || []) {
    if (e.type !== 'brainkit-provenance') continue;
    out.push({ ref: e.ref, artifact: typeof e.ref === 'string' ? readJson(join(cwd, 'docs/governance/evidence', e.ref)) : null });
  }
  return out;
}

export function run(cwd = process.cwd()) {
  const brainkit = loadBrainkit(cwd);
  const agg = aggregateRequirements(cwd);
  const required = agg.families.has('brainkit-conformance');
  if (!brainkit && !required) return []; // not adopted, nothing pins it — a clean no-op
  const registry = loadRegistry(cwd);
  const projPath = join(cwd, 'discovery/brand/design.md');
  const projection = existsSync(projPath) ? readFrontmatter(readFileSync(projPath, 'utf8')) : null;
  return evaluate(brainkit, {
    required, registry, projection, repoRoot: cwd,
    institutionBindings: institutionBindingsOf(cwd),
    provenanceEvidence: provenanceEvidenceOf(cwd),
  });
}

/** Seal a BrainKit: compute section + package digests from the files and write them into the
 *  manifest. This never approves — it records what the files hash to, so owners approve a sealed,
 *  reproducible package. Returns the sealed manifest path. */
export function seal(cwd = process.cwd()) {
  const bk = loadBrainkit(cwd);
  if (!bk || !bk.manifest) throw new Error('no BrainKit manifest to seal at institution/brainkit/manifest.json');
  const computed = computeDigests(bk.dir, bk.manifest);
  const byName = new Map(computed.sections.map((s) => [s.section, s]));
  bk.manifest.sections = (bk.manifest.sections || []).map((s) => ({ ...s, digest: byName.get(s.section)?.digest ?? s.digest }));
  bk.manifest.package_digest = computed.package_digest;
  writeFileSync(bk.manifestPath, JSON.stringify(bk.manifest, null, 2) + '\n');
  return bk.manifestPath;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--seal')) {
    const p = seal();
    process.stdout.write(`BrainKit sealed → ${p} (digests recomputed; owners must still approve)\n`);
    process.exit(0);
  }
  const findings = run();
  if (findings.length) {
    process.stderr.write('\nBrainKit conformance gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nAn institutional BrainKit must be approved, digest-consistent, owned and grounded before a\ncompiled change may rely on it. See ../loom/references/brainkit.md.\n');
    process.exit(1);
  }
  process.stdout.write('BrainKit conformance gate — OK\n');
}
