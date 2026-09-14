// Compiled requirements — the execution root (Loom 2.0-rc.7 W1). The policy compiler decides
// which gates, evidence and capabilities a change must carry; this module is the single place
// that AGGREGATES those decisions across every governed change, so the gate runner and the
// individual gates read one source of truth instead of hardcoding optionality.
//
//   families  — the union of every active change's compiled `required_gates`
//               (D · PA1 · A · Q · PA2 · R · product-eval · assurance-cadence · decision-log)
//   evidence  — the union of every active change's compiled `required_evidence`
//   changes   — [{ change_id, families, evidence }] so a gate can say WHO requires it
//
// It reads each change's STORED control-plan.json — which `change-envelope-check` already
// reconciles against a fresh compile (a stale plan fails there), so reading it here is safe
// and does not re-run the compiler. A change with no plan contributes nothing (the envelope
// gate reports the missing plan); it never silently lowers a requirement.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { mergeCapabilities } from './policy-compiler.mjs';

export const CHANGES_DIR = 'docs/governance/changes';
// Production states — once a change reaches one, cadence-style capabilities apply even if the
// plan predates them (mirrors the silence-after-launch rule).
export const PRODUCTION_STATES = new Set(['production-authorized', 'in-production']);
// Terminal states (rc.34). A change that is closed or superseded ships nothing and never will —
// it contributes NO requirements. Before these states existed, every change ever governed
// contributed its gate families forever, so the requirement union grew monotonically with repo
// age and the risk-proportionate route decayed to "run everything".
export const TERMINAL_STATES = new Set(['closed', 'superseded']);
// The tier order, for the runner's min_tier selection — mirrors core/policy-compiler.mjs TIERS
// (imported there; restated here would risk drift, so read it from the aggregate instead).

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const TIER_ORDER = ['low', 'medium', 'high', 'critical'];

// Same matching rule as the gate runner's path scopes: exact file, or directory prefix.
const touches = (changedPaths, prefix) =>
  changedPaths.some((f) => f === prefix || f.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));

/**
 * Aggregate compiled requirements across governed changes.
 *
 * `changedPaths` (rc.34) scopes the aggregate to the changes THIS diff implicates: a change
 * counts when the diff touches its envelope directory, or any prefix in the envelope's optional
 * `scope_paths`. `null` (diff unknown, or a release/scheduled run) means EVERY non-terminal
 * change counts — the fail-open direction. This is what keeps the gate runner's opening promise
 * true: a README-only PR no longer carries an unrelated critical change's full gate set.
 */
export function aggregateRequirements(cwd = process.cwd(), { changedPaths = null, changeIds = null } = {}) {
  const families = new Set();
  const evidence = new Set();
  const capabilities = {}; // rc.13 WS3 — merged required-capability map (name → {required, minimum_version, …})
  const changes = [];
  let anyInProduction = false;
  let maxTier = null; // highest classification tier among the counted changes (for min_tier selection)
  const scoped = Array.isArray(changedPaths);
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return { families, evidence, capabilities, changes, anyInProduction, maxTier, scoped };
  for (const name of readdirSync(dir)) {
    const base = `${dir}/${name}`;
    const envelope = readJson(`${base}/change-envelope.json`);
    if (!envelope) continue;
    if (TERMINAL_STATES.has(envelope.current_state)) continue; // closed/superseded: contributes nothing
    if (PRODUCTION_STATES.has(envelope.current_state)) anyInProduction = true;
    // rc.38 (flow-plan Phase 4.4): a RELEASE TRAIN narrows the aggregate to the changes actually
    // shipping. This is the release-lane analogue of rc.34's diff scoping and it is the same
    // fail-open rule: `changeIds === null` counts every non-terminal change, and a train may only
    // be honoured by a gate that has verified the train itself.
    if (changeIds instanceof Set && !changeIds.has(envelope.change_id || name)) continue;
    if (scoped) {
      const own = `${CHANGES_DIR}/${name}/`;
      const declared = Array.isArray(envelope.scope_paths) ? envelope.scope_paths : [];
      if (!touches(changedPaths, own) && !declared.some((p) => typeof p === 'string' && touches(changedPaths, p))) continue;
    }
    const plan = readJson(`${base}/${envelope.control_plan || 'control-plan.json'}`);
    if (!plan) continue;
    const fam = new Set(plan.required_gates || []);
    const ev = new Set(plan.required_evidence || []);
    for (const f of fam) families.add(f);
    for (const e of ev) evidence.add(e);
    mergeCapabilities(capabilities, plan.required_capabilities);
    const tier = envelope.risk_tier;
    if (TIER_ORDER.includes(tier) && (maxTier === null || TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(maxTier))) maxTier = tier;
    // rc.40 — plan_hash travels with the change. The gate result cache keys on the sorted set of
    // them, so recompiling ANY counted plan invalidates every cached result in the run.
    changes.push({
      change_id: envelope.change_id || name,
      state: envelope.current_state,
      families: [...fam],
      evidence: [...ev],
      capabilities: plan.required_capabilities || {},
      model_roles: Array.isArray(envelope.model_roles) ? [...envelope.model_roles] : [],
      plan_hash: plan.plan_hash || null,
    });
  }
  return { families, evidence, capabilities, changes, anyInProduction, maxTier, scoped };
}

// Capability merging is the compiler's mergeCapabilities — one implementation, strongest-wins.
// A local first-wins copy lived here until rc.33 and could silently WEAKEN an aggregate: two
// plans requiring data_risk_register ≥3.1 and ≥4.0 reported 3.1 or 4.0 depending on directory
// read order. The regression test in compiled-requirements.test.mjs holds the door shut.

/** Does any compiled plan require the named capability? (rc.13 WS3 — for mandatory-when-compiled.) */
export function capabilityRequired(agg, name) {
  return Boolean(agg?.capabilities?.[name]?.required);
}

/** Which change_ids require a given gate family — for a gate to name WHO makes it mandatory. */
export function requiredBy(agg, family) {
  return agg.changes.filter((c) => c.families.includes(family)).map((c) => c.change_id);
}

/**
 * Model roles implicated by changes requiring a capability.
 * `null` means all manifest roles: that is the fail-closed result when any implicated envelope did
 * not enumerate model_roles. A Set is safe to use for precise coverage when every change did.
 */
export function modelRolesRequiredByCapability(agg, capability) {
  const changes = (agg?.changes || []).filter((c) => c?.capabilities?.[capability]?.required);
  if (!changes.length || changes.some((c) => !Array.isArray(c.model_roles) || c.model_roles.length === 0)) return null;
  return new Set(changes.flatMap((c) => c.model_roles).filter((r) => typeof r === 'string' && r.trim()));
}

// CLI: print the aggregated requirements (diagnostic).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agg = aggregateRequirements();
  process.stdout.write(JSON.stringify({
    families: [...agg.families].sort(),
    evidence: [...agg.evidence].sort(),
    anyInProduction: agg.anyInProduction,
    changes: agg.changes,
  }, null, 2) + '\n');
}
