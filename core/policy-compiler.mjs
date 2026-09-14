// The policy compiler — Loom 2.0's core (plan §5). A change's risk classification COMPILES
// the path it must take: which gates run, which control functions approve, which evidence
// must exist. Teams do not choose their own route; the classification does.
//
// Profiles are pure DATA (profiles/*.json): a base profile (regulated-bank), jurisdiction
// profiles (jurisdictions/*), and product-type profiles (products/*). Each declares
// requirements per risk tier; the compiler takes the CUMULATIVE UNION up to the envelope's
// tier, then unions across profiles — so a higher tier can only ADD requirements, never
// remove them. Monotonicity is guaranteed by construction and proven by a property test.
//
// The compiled plan is deterministic (sorted, canonically hashed). The change-envelope gate
// recompiles and compares plan_hash on every run — a stored plan that no longer matches its
// inputs fails, so classification-time rigor cannot be defeated at execution time.
//
// This file is control plane (CONTROL_TARGETS): an agent that could edit the compiler could
// compile itself an easier path.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { loadBrainkit, livePackageDigest } from './brainkit.mjs';
import { pathToFileURL } from 'node:url';

export const TIERS = ['low', 'medium', 'high', 'critical'];
export const CHANGE_TYPES = ['documentation', 'software-change', 'new-product', 'material-product-change'];
export const AUTOMATIC_PREDICATES = ['flags_all', 'change_types', 'minimum_tier'];
export const PRODUCT_CHANGE_TYPES = new Set(['new-product', 'material-product-change']);
// plan field ← the key profiles use for it
const FIELD_MAP = {
  required_gates: 'gates',
  required_approver_roles: 'approver_roles',
  // Which of those roles must have signed by PA1 (permission to develop). A profile that adds an
  // approver role AND a PA1 section plainly wants that function involved at PA1; without this
  // field the plan published one flat role list and the gate silently bound only its own core set.
  pa1_approver_roles: 'pa1_approver_roles',
  required_evidence: 'evidence',
  pa1_sections: 'pa1_sections',
  pa2_sections: 'pa2_sections',
};
const PLAN_FIELDS = Object.keys(FIELD_MAP);

// rc.8 WS3: institution profiles compose alongside base + jurisdiction + product. The dir a
// profile is found in gives its default kind (a profile may still declare its own `kind`).
const PROFILE_DIRS = ['profiles', 'profiles/jurisdictions', 'profiles/products', 'profiles/institutions'];
const KIND_BY_DIR = {
  profiles: 'base',
  'profiles/jurisdictions': 'jurisdiction',
  'profiles/products': 'product',
  'profiles/institutions': 'institution',
};

/** Resolve a profile name to { path, dir } under the profile dirs, or null. */
function findProfile(name, baseDir) {
  for (const d of PROFILE_DIRS) {
    const path = `${baseDir}/${d}/${name}.json`;
    if (existsSync(path)) return { path, dir: d };
  }
  return null;
}

/** Resolve profile names to loaded data. Missing profiles are findings, not defaults. */
export function loadProfiles(names, baseDir = process.cwd()) {
  const loaded = [];
  const findings = [];
  for (const name of names || []) {
    const hit = findProfile(name, baseDir);
    if (!hit) {
      findings.push(`profile ${name} not found under ${PROFILE_DIRS.join(', ')} — an unresolvable profile blocks the change`);
      continue;
    }
    try { loaded.push(JSON.parse(readFileSync(hit.path, 'utf8'))); }
    catch (e) { findings.push(`profile ${name} is not valid JSON: ${e.message}`); }
  }
  return { profiles: loaded, findings };
}

/** Validate an automatic-profile rule. Unknown or empty policy must fail closed. */
export function automaticRuleFindings(rule) {
  const findings = [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return ['rule must be an object'];
  }
  if (!(typeof rule.profile === 'string' && rule.profile.trim())) {
    findings.push('profile must be a non-empty string');
  }
  for (const key of Object.keys(rule)) {
    if (!['profile', 'when'].includes(key)) findings.push(`unknown rule field ${key}`);
  }
  const when = rule.when;
  if (!when || typeof when !== 'object' || Array.isArray(when)) {
    findings.push('when must be an object');
    return findings;
  }
  const keys = Object.keys(when);
  if (keys.length === 0) findings.push('when must contain at least one predicate');
  for (const key of keys) {
    if (!AUTOMATIC_PREDICATES.includes(key)) findings.push(`unknown predicate ${key}`);
  }
  if ('flags_all' in when && (!Array.isArray(when.flags_all) || when.flags_all.length === 0
    || when.flags_all.some((flag) => typeof flag !== 'string' || !flag.trim()))) {
    findings.push('flags_all must be a non-empty array of non-empty strings');
  }
  if ('change_types' in when && (!Array.isArray(when.change_types) || when.change_types.length === 0
    || when.change_types.some((type) => !CHANGE_TYPES.includes(type)))) {
    findings.push(`change_types must be a non-empty array containing only: ${CHANGE_TYPES.join('|')}`);
  }
  if ('minimum_tier' in when && !TIERS.includes(when.minimum_tier)) {
    findings.push(`minimum_tier must be one of: ${TIERS.join('|')}`);
  }
  return findings;
}

/** Does a valid automatic-profile rule apply to this envelope? */
export function automaticRuleMatches(rule, envelope) {
  if (automaticRuleFindings(rule).length) return false;
  const when = rule?.when;
  if (Array.isArray(when.flags_all) && !when.flags_all.every((f) => envelope?.flags?.[f] === true)) return false;
  if (Array.isArray(when.change_types) && !when.change_types.includes(envelope?.change_type)) return false;
  if (typeof when.minimum_tier === 'string') {
    const actual = TIERS.indexOf(envelope?.risk_tier);
    const floor = TIERS.indexOf(when.minimum_tier);
    if (actual < 0 || floor < 0 || actual < floor) return false;
  }
  return true;
}

/**
 * Resolve the explicit profile set plus profiles implied by those facts.
 *
 * A classifier can truthfully say `model_involved` and still forget the profile that turns that
 * fact into AI controls. Automatic profiles put that implication in jurisdiction policy, not in
 * the classifier's memory. Inclusion is recursive, de-duplicated, bound and fail-closed.
 */
export function resolveProfileContext(envelope, baseDir = process.cwd()) {
  const queue = [...(Array.isArray(envelope?.required_profiles) ? envelope.required_profiles : [])];
  const names = [];
  const profiles = [];
  const findings = [];
  const seen = new Set();

  while (queue.length) {
    const name = queue.shift();
    if (typeof name !== 'string' || !name.trim() || seen.has(name)) continue;
    seen.add(name);
    const { profiles: loaded, findings: lf } = loadProfiles([name], baseDir);
    findings.push(...lf);
    if (!loaded.length) continue;
    const profile = loaded[0];
    names.push(name);
    profiles.push(profile);
    if (profile.automatic_profiles !== undefined && !Array.isArray(profile.automatic_profiles)) {
      findings.push(`profile ${name} automatic_profiles must be an array`);
    }
    const automaticProfiles = Array.isArray(profile.automatic_profiles) ? profile.automatic_profiles : [];
    for (const [index, rule] of automaticProfiles.entries()) {
      const af = automaticRuleFindings(rule);
      findings.push(...af.map((finding) => `profile ${name} automatic_profiles[${index}]: ${finding}`));
      if (af.length === 0 && automaticRuleMatches(rule, envelope)) {
        queue.push(rule.profile.trim());
      }
    }
  }

  const { bindings, findings: bf } = resolveBindings(names, baseDir);
  findings.push(...bf);
  return { names, profiles, bindings, envelope: { ...envelope, required_profiles: names }, findings };
}

/**
 * rc.8 WS4 — bind the plan to the EXACT content of every profile it compiled from, not just
 * their names. Each binding is { profile, kind, version, digest }; the digest is over the
 * profile's canonical content, so any change to a profile makes a stored plan stale (the
 * change-envelope gate recompiles and compares). This is what lets a BrainKit or institution
 * profile revision force recompilation instead of silently riding an old plan.
 */
export function resolveBindings(names, baseDir = process.cwd()) {
  const bindings = [];
  const findings = [];
  for (const name of names || []) {
    const hit = findProfile(name, baseDir);
    if (!hit) { findings.push(`profile ${name} not found under ${PROFILE_DIRS.join(', ')} — cannot bind an unresolvable profile`); continue; }
    let data;
    try { data = JSON.parse(readFileSync(hit.path, 'utf8')); }
    catch (e) { findings.push(`profile ${name} is not valid JSON: ${e.message}`); continue; }
    const kind = typeof data.kind === 'string' ? data.kind : (KIND_BY_DIR[hit.dir] || 'base');
    // rc.38 (flow-plan Phase 4.3): `patterns` is EXCLUDED from the binding digest, and this is a
    // deliberate, load-bearing exclusion rather than an oversight. A pre-approved pattern names
    // the plan hash it pre-approves; that hash is computed over the bindings; the bindings would
    // otherwise be computed over the pattern. There is no fixed point, so a pattern could never
    // name a real route. Patterns are also not REQUIREMENTS — the compiler never reads them, and
    // nothing in a compiled plan derives from them, so excluding them cannot change what a change
    // must do. They carry their own controls instead: a second-line approver, an expiry, a
    // sampling rate and a matcher, all re-verified by scripts/change-envelope-check.mjs on every
    // run, on top of the CODEOWNERS ownership of profiles/ that every other profile field has.
    const { patterns: _patterns, ...bindable } = data;
    const binding = {
      profile: name,
      kind,
      version: typeof data.version === 'string' ? data.version : null,
      digest: 'sha256:' + createHash('sha256').update(canonical(bindable)).digest('hex'),
    };
    // rc.8 WS7: an institution profile pins a BrainKit. Fold the LIVE package digest into the
    // binding, so a one-byte BrainKit edit changes the plan hash and makes a stored plan stale —
    // the BrainKit tamper cannot ride an old plan. A named institution profile with no resolvable
    // BrainKit is a finding, not a silent pass.
    if (kind === 'institution') {
      const rel = data.brainkit?.path ? dirname(data.brainkit.path) : 'institution/brainkit';
      const bk = loadBrainkit(baseDir, rel);
      if (!bk || !bk.manifest) {
        findings.push(`institution profile ${name} pins a BrainKit at ${rel} but it is missing or unparseable — cannot bind an unresolvable BrainKit`);
      } else {
        binding.brainkit_id = bk.manifest.brainkit_id ?? null;
        binding.brainkit_version = bk.manifest.version ?? null;
        binding.brainkit_digest = livePackageDigest(bk.dir, bk.manifest);
      }
    }
    bindings.push(binding);
  }
  bindings.sort((a, b) => a.profile.localeCompare(b.profile));
  return { bindings, findings };
}

const union = (into, from) => { for (const x of from || []) into.add(x); };

// rc.13 WS3: a profile declares required CAPABILITIES (data_risk_register, model_risk,
// consumer_product_approval, …) as a map, not a flat set — each carrying attributes (a minimum
// version, a minimum tier, institution-ownership). The compiler MERGES them "strongest wins", so
// like gates they only ever strengthen up the tiers and across profiles (monotonic by construction).
// This is what lets D6 be MANDATORY-WHEN-COMPILED: the register requirement is derived from the
// institution/product profile, not switched on by a CLI flag (closes F5).
const maxVersion = (a, b) => {
  if (!a) return b; if (!b) return a;
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? a : b;
  }
  return a;
};
const maxTier = (a, b) => {
  if (!a) return b; if (!b) return a;
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b;
};
export function mergeCapabilities(target, source) {
  for (const [name, spec] of Object.entries(source || {})) {
    const cur = target[name] || {};
    const merged = { required: Boolean(cur.required || spec.required) };
    const mv = maxVersion(cur.minimum_version, spec.minimum_version);
    if (mv) merged.minimum_version = mv;
    const mt = maxTier(cur.minimum_tier, spec.minimum_tier);
    if (mt) merged.minimum_tier = mt;
    if (cur.institution_owned || spec.institution_owned) merged.institution_owned = true;
    target[name] = merged;
  }
  return target;
}

/**
 * Compile the control plan for an envelope against its profiles.
 * `bindings` (rc.8 WS4) pins the exact profile content the plan compiled from; pass the output
 * of resolveBindings(envelope.required_profiles). Tests may omit it (an empty binding set is a
 * valid, if unpinned, plan). Returns { plan, findings } — a non-empty findings list means BLOCKED.
 */
export function compile(envelope, profiles, bindings = []) {
  const findings = [];
  for (const field of ['change_id', 'product_id', 'change_type', 'risk_tier']) {
    if (!(typeof envelope?.[field] === 'string' && envelope[field].trim())) {
      findings.push(`envelope has no ${field} — an unclassified change is blocked`);
    }
  }
  if (envelope?.change_type && !CHANGE_TYPES.includes(envelope.change_type)) {
    findings.push(`unknown change_type ${JSON.stringify(envelope.change_type)} (one of: ${CHANGE_TYPES.join('|')})`);
  }
  const tierIdx = TIERS.indexOf(envelope?.risk_tier);
  if (envelope?.risk_tier && tierIdx < 0) {
    findings.push(`unknown risk_tier ${JSON.stringify(envelope.risk_tier)} (one of: ${TIERS.join('|')})`);
  }
  // Promise 1: a product must not be able to call itself "just a software change" — a
  // new or materially changed product cannot ride the low-risk route.
  if (PRODUCT_CHANGE_TYPES.has(envelope?.change_type) && envelope?.risk_tier === 'low') {
    findings.push('a new or materially changed product cannot be classified low — product changes take the product-governance route');
  }
  if (!Array.isArray(envelope?.required_profiles) || envelope.required_profiles.length === 0) {
    findings.push('envelope names no required_profiles — an unprofiled change is blocked');
  }
  if (findings.length) return { plan: null, findings };

  const acc = Object.fromEntries(PLAN_FIELDS.map((f) => [f, new Set()]));
  const caps = {};
  for (const p of profiles) {
    // Cumulative union up to the envelope's tier — higher tiers ADD, never remove.
    for (let i = 0; i <= tierIdx; i++) {
      const req = p.requirements?.[TIERS[i]];
      if (req) { for (const f of PLAN_FIELDS) union(acc[f], req[FIELD_MAP[f]]); mergeCapabilities(caps, req.capabilities); }
    }
    for (const cond of p.conditional || []) {
      if (envelope.flags?.[cond.when]) { for (const f of PLAN_FIELDS) union(acc[f], cond.adds?.[FIELD_MAP[f]]); mergeCapabilities(caps, cond.adds?.capabilities); }
    }
  }
  const plan = {
    change_id: envelope.change_id,
    risk_tier: envelope.risk_tier,
    profiles: [...envelope.required_profiles].sort(),
  };
  for (const f of PLAN_FIELDS) plan[f] = [...acc[f]].sort();
  plan.required_capabilities = caps; // rc.13 WS3 — merged capability map (canonical() sorts keys)
  // rc.8 WS4: pin the exact profile content the plan compiled from.
  plan.profile_bindings = [...bindings].sort((a, b) => a.profile.localeCompare(b.profile));
  plan.plan_hash = planHash(plan);
  return { plan, findings: [] };
}

/**
 * Canonical JSON serialization — recursive, object keys sorted at EVERY depth. rc.8 WS4 replaces
 * the old top-level `JSON.stringify(rest, keys)` replacer, which was a whitelist that silently
 * DROPPED any nested key (e.g. a profile_binding's digest) from the serialization — so a change
 * to nested content did not change the hash. This function hashes the whole tree, so it does.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

/** Canonical hash of a plan (excluding plan_hash itself). Deterministic across runs and depths. */
export function planHash(plan) {
  const { plan_hash, ...rest } = plan;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

// CLI: compile an envelope's plan. `--write` stores it at the envelope's control_plan path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [envPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!envPath) { process.stderr.write('usage: node core/policy-compiler.mjs <change-envelope.json> [--write]\n'); process.exit(2); }
  const envelope = JSON.parse(readFileSync(envPath, 'utf8'));
  const context = resolveProfileContext(envelope);
  const { plan, findings } = compile(context.envelope, context.profiles, context.bindings);
  const all = [...context.findings, ...findings];
  if (all.length) {
    process.stderr.write('\nPolicy compiler — BLOCKED\n\n');
    for (const f of all) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
  if (process.argv.includes('--write')) {
    const out = envPath.replace(/change-envelope\.json$/, envelope.control_plan || 'control-plan.json');
    writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
    process.stdout.write(`compiled control plan → ${out} (${plan.plan_hash.slice(0, 12)}…)\n`);
  } else {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  }
}
