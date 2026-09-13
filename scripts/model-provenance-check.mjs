// HG-0006 — the model-provenance gate (model-risk management). An ungoverned harness runs an
// ungoverned model: no inventory, no pinning, no eval-before-release, no independent challenge.
// Under model-risk standards (SR 11-7, PRA SS1/23, ISO 42001, NIST AI RMF, the EU AI Act) the
// agent IS a model and must be inventoried, tiered, pinned, evaluated, and validated. This gate
// makes the repo-side half of that a merge condition, read from a model manifest:
//
//   Every model role MUST pin its model + prompt version, declare a risk tier, and — at the
//   tiers you require — carry a passing eval RUN AGAINST THAT PIN and an independent validation.
//
// The pin-match check is the anti-stale-eval control: an eval that passed against an older
// model or prompt proves nothing about what ships (cf. Q1b's anti-reward-hacking spirit, one
// layer up). The eval rig itself is domain-specific and the adopter's to build; this gate
// enforces that a release cannot claim green without a fresh, pinned, tier-appropriate eval.
//
// DOMAIN VALIDATION (2.1). Model risk asks whether a model is accurate, stable and monitored. It
// never asks whether the thing the model PRODUCED is admissible in the domain it acts on — and a
// statistically excellent model can be confidently wrong in a way only a domain authority can see.
// So a model may declare `domains` + `domain_validations`, one signature per domain, checked here.
// The extension is generic by construction: shariah, medical and privacy take the identical code
// path, and the required role is DERIVED from the domain (`<domain>-model-validator`), so a new
// domain costs a registry identity and no code. Nothing below reads a domain's meaning.
//
// What that limb proves and what it does not: it proves WHO signed, that they are a human in the
// registry holding the derived role and outside `builders`, and that they signed against the pin
// this manifest ships. Whether their determination is SOUND is not a property of a JSON record and
// is not claimed here — soundness belongs to the accountable body organisationally (for Shari'ah,
// the ISSC; scholars decide permissibility). No agent in this harness authors or approves a domain
// determination, and this gate rules on nothing but composition, provenance and binding. The
// harness reads records; it never watches the model in production.
//
// Run from the repo root: `node scripts/model-provenance-check.mjs` (exit 1 on any finding).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { pathToFileURL } from 'node:url';

const MANIFEST_LOCATIONS = ['docs/governance/model-manifest.json', 'model-manifest.json'];

// ADOPT: a floating tag is not a pin — it can move under you between eval and release.
export const FLOATING = new Set(['', 'latest', 'main', 'head', 'stable', 'edge', '*']);
// ADOPT: which risk tiers must carry a passing eval / an independent validation before release.
// Default follows the model-risk-operating-model-runbook §2.2 controls-by-tier matrix: eval and
// validation are required at medium AND high (low is optional). Tighten or loosen per your tiering.
export const EVAL_REQUIRED_TIERS = new Set(['high', 'medium']);
export const VALIDATION_REQUIRED_TIERS = new Set(['high', 'medium']);
// ADOPT: which tiers must declare runtime governance (monitoring · suspension · fallback).
// High only by default — a high-risk model that RUNS needs a live control loop (§10, 2.0-rc).
export const RUNTIME_REQUIRED_TIERS = new Set(['high']);
const TIERS = new Set(['high', 'medium', 'low']);
// ADOPT: capability name → the domain a manifest must then name. DATA, not logic: this table is
// the only place a domain is spelled out, and adding `medical_model_validation: 'medical'` is an
// edit here, never to the checks below. A compiled plan requiring the capability while no model
// declares the domain is the defect this table exists to catch (see `run()`).
export const CAPABILITY_DOMAINS = { shariah_model_validation: 'shariah' };
/** The registry role a domain validator must hold. Deterministic, so a new domain needs no code. */
export const domainValidatorRole = (domain) => `${domain}-model-validator`;

const isPinned = (v) => typeof v === 'string' && !FLOATING.has(v.trim().toLowerCase());
/** An untouched template row. The shipped manifest template must not read as a declaration. */
const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** Findings (one per violation). Empty ⇒ every model role is pinned, tiered, and eval-fresh.
 *  With `baseDir`, each eval's report artifact is read and its sha256 verified — the CLI
 *  always passes it, so a manifest cannot cite a report that is absent or altered. */
export function evaluate(manifest, { baseDir = null, registry = null } = {}) {
  const findings = [];
  const models = manifest && manifest.models;
  if (!Array.isArray(models) || models.length === 0) {
    return ['manifest has no `models` array — the model inventory is empty (HG-0006)'];
  }
  for (const m of models) {
    const role = (m && m.role) || '(unnamed role)';
    if (!isPinned(m.model_id)) findings.push(`${role}: model_id is not pinned (got ${JSON.stringify(m.model_id)})`);
    if (!isPinned(m.prompt_version)) findings.push(`${role}: prompt_version is not pinned (got ${JSON.stringify(m.prompt_version)})`);
    if (!TIERS.has(m.risk_tier)) {
      findings.push(`${role}: risk_tier must be one of high|medium|low (got ${JSON.stringify(m.risk_tier)})`);
      continue; // tier drives the remaining checks
    }
    if (EVAL_REQUIRED_TIERS.has(m.risk_tier)) {
      const e = m.eval;
      if (!e || typeof e !== 'object') {
        findings.push(`${role}: ${m.risk_tier}-tier model has no eval block (eval-before-release required)`);
      } else {
        if (e.result !== 'pass' || e.threshold_met !== true) {
          findings.push(`${role}: eval did not pass its threshold (result=${JSON.stringify(e.result)}, threshold_met=${JSON.stringify(e.threshold_met)})`);
        }
        if (e.evaluated_model_id !== m.model_id || e.evaluated_prompt_version !== m.prompt_version) {
          findings.push(`${role}: stale eval — it was run against a different model/prompt pin than the one shipping`);
        }
        // 1.10 — a declared pass is not evidence. The eval must identify its dataset, runner,
        // and timestamp, and point at the actual REPORT artifact, hashed. (`result: "pass"`
        // alone is exactly the false green this gate exists to kill.)
        for (const field of ['dataset_version', 'runner_version', 'ran_at']) {
          if (!(typeof e[field] === 'string' && e[field].trim())) {
            findings.push(`${role}: eval declares no ${field} — an unidentified eval is a claim, not evidence`);
          }
        }
        const r = e.report;
        if (!r || typeof r.ref !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256 || '')) {
          findings.push(`${role}: eval has no report {ref, sha256} — the evaluation artifact itself must be sealed, not just its verdict`);
        } else if (baseDir) {
          const p = `${baseDir}/${r.ref}`;
          if (!existsSync(p)) {
            findings.push(`${role}: eval report ${r.ref} not found — a referenced artifact must exist`);
          } else if (createHash('sha256').update(readFileSync(p)).digest('hex') !== r.sha256) {
            findings.push(`${role}: eval report ${r.ref} does not match its declared sha256 — the report was altered after the manifest was written`);
          }
        }
      }
    }
    if (VALIDATION_REQUIRED_TIERS.has(m.risk_tier)) {
      if (!(typeof m.validated_by === 'string' && m.validated_by.trim())) {
        findings.push(`${role}: ${m.risk_tier}-tier model has no independent validation (validated_by) — HG-0006`);
      } else if (registry) {
        // W5 (closes F6): `validated_by: "Risk"` is not validation. With a registry mounted the
        // validator must RESOLVE to a human model-validator in the second line, not a builder —
        // the same treatment every other approval already gets (CBUAE MMS independent validation).
        const who = identityOf(registry, m.validated_by);
        if (!who) findings.push(`${role}: validated_by ${JSON.stringify(m.validated_by)} is not a registry identity — free text is not independent validation`);
        else {
          if (who.kind === 'agent') findings.push(`${role}: validated_by ${m.validated_by} is an AGENT — validation is independent, not self-issued`);
          if (!(who.roles || []).includes('model-validator')) findings.push(`${role}: validated_by ${m.validated_by} does not hold the model-validator role`);
          if (!(who.groups || []).includes('second-line')) findings.push(`${role}: validated_by ${m.validated_by} is not in the second line — validation must be organisationally independent`);
          if ((who.groups || []).includes('builders')) findings.push(`${role}: validated_by ${m.validated_by} is a BUILDER — a builder cannot validate their own model`);
        }
      }
    }
    // 2.1 — DOMAIN validation, an ADDITIONAL signature and never a role swap. `validated_by` is
    // still held to second-line model-validator; this asks the separate question of whether anyone
    // COMPETENT IN THE DOMAIN looked at what the model's output does there. One person may cover
    // both only by holding both roles — otherwise the manifest needs two distinct signatures, which
    // is the point: model-risk competence and domain competence are rarely the same person, and
    // letting one signature stand for both is how a domain review becomes a checkbox nobody read.
    // Strictly additive: a model that declares no `domains` never reaches any of this.
    if (m.domains !== undefined && !Array.isArray(m.domains)) {
      findings.push(`${role}: domains must be an array of domain names (got ${JSON.stringify(m.domains)})`);
    }
    const sigs = m.domain_validations && typeof m.domain_validations === 'object' && !Array.isArray(m.domain_validations)
      ? m.domain_validations : null;
    if (m.domain_validations !== undefined && !sigs) {
      findings.push(`${role}: domain_validations must be an object mapping domain → identity id (got ${JSON.stringify(m.domain_validations)})`);
    }
    const declaredDomains = (Array.isArray(m.domains) ? m.domains : []).filter((d) => !isPlaceholder(d));
    for (const d of declaredDomains) {
      if (!(typeof d === 'string' && /^[a-z][a-z0-9-]*$/.test(d))) {
        findings.push(`${role}: domain ${JSON.stringify(d)} is not a slug — the validator role is derived from the domain (<domain>-model-validator), so a domain that cannot name a role cannot be checked`);
        continue;
      }
      const need = domainValidatorRole(d);
      const id = sigs ? sigs[d] : undefined;
      if (!nonEmpty(id)) {
        findings.push(`${role}: declares domain ${d} but domain_validations.${d} names nobody — a model whose output carries ${d} significance is validated for accuracy and reviewed by nobody who holds ${d} competence`);
        continue;
      }
      if (isPlaceholder(id)) {
        findings.push(`${role}: domain_validations.${d} is still an ADOPT placeholder — a template value is not a signature`);
        continue;
      }
      if (!registry) continue; // same posture as validated_by: presence only, with no registry to resolve against
      const who = identityOf(registry, id);
      if (!who) {
        findings.push(`${role}: domain_validations.${d} ${JSON.stringify(id)} is not a registry identity — free text is not a domain validation`);
        continue;
      }
      // An agent validates nothing. A domain determination is a human one, made by the accountable
      // body; this gate records that it happened and never rules on whether it was right.
      if (who.kind === 'agent') findings.push(`${role}: domain_validations.${d} ${id} is an AGENT — a ${d} determination is a human one, made by the accountable body, and no agent here makes or approves it`);
      if (!(who.roles || []).includes(need)) {
        findings.push(id === m.validated_by
          ? `${role}: domain_validations.${d} reuses validated_by ${id}, who does not hold ${need} — one signature covers both only when that person holds BOTH roles; otherwise this needs two distinct signatures`
          : `${role}: domain_validations.${d} ${id} does not hold the ${need} role — the domain validator role name is derived from the domain, so grant that role in the registry rather than renaming the domain`);
      }
      if ((who.groups || []).includes('builders')) findings.push(`${role}: domain_validations.${d} ${id} is a BUILDER — a builder cannot domain-validate their own model`);
    }
    // A signature for a domain the model does not declare reads as coverage that does not exist —
    // the usual cause is a domain renamed above and its old signature left behind.
    for (const d of sigs ? Object.keys(sigs) : []) {
      if (isPlaceholder(d) || declaredDomains.includes(d)) continue;
      findings.push(`${role}: domain_validations names ${JSON.stringify(d)}, which is not in domains — a signature bound to no declared domain is coverage the manifest claims and does not have`);
    }

    // 2.0-rc — a model is not just built and validated once; it RUNS. At high tier the
    // manifest must declare the runtime governance: what is monitored, when it is suspended,
    // and what happens when the model or its provider is unavailable. Declaring the plan is
    // the repo-side half; executing the monitoring is the adopter's model-risk function.
    if (RUNTIME_REQUIRED_TIERS.has(m.risk_tier)) {
      const rt = m.runtime;
      if (!rt || typeof rt !== 'object') {
        findings.push(`${role}: ${m.risk_tier}-tier model has no runtime block — a running model needs monitoring, suspension thresholds, and a fallback (§10)`);
      } else {
        if (!(Array.isArray(rt.monitoring) && rt.monitoring.length > 0)) findings.push(`${role}: runtime.monitoring must list the metrics watched in production`);
        if (!(typeof rt.suspension === 'string' && rt.suspension.trim())) findings.push(`${role}: runtime.suspension must state the threshold that suspends the model`);
        if (!(typeof rt.fallback === 'string' && rt.fallback.trim())) findings.push(`${role}: runtime.fallback must state what happens on model/provider outage`);
      }
    }
  }
  return findings;
}

export function run(cwd = process.cwd()) {
  const path = MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return [`no model manifest found (looked in ${MANIFEST_LOCATIONS.join(', ')}) — the model is ungoverned`];
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return [`model manifest is not valid JSON: ${e.message}`]; }
  const findings = evaluate(manifest, { baseDir: cwd, registry: loadRegistry(cwd) });
  // MANDATORY-WHEN-COMPILED (rc.13 WS3 idiom). Silent for every repository whose compiled plans
  // name no domain capability — a generic adopter never fails a domain control. The moment a plan
  // DOES require one, a manifest that never names the domain cannot satisfy it: the requirement
  // would otherwise be met by a model inventory that simply does not mention the domain, which is
  // the quiet way a routed control evaporates. The finding names the change that requires it.
  const agg = aggregateRequirements(cwd);
  const models = Array.isArray(manifest?.models) ? manifest.models : [];
  for (const [capability, domain] of Object.entries(CAPABILITY_DOMAINS)) {
    if (!capabilityRequired(agg, capability)) continue;
    if (models.some((m) => Array.isArray(m?.domains) && m.domains.includes(domain))) continue;
    const who = agg.changes.filter((c) => c.capabilities?.[capability]?.required).map((c) => c.change_id);
    findings.push(`a compiled plan requires the ${capability} capability [${who.join(', ') || 'unknown change'}] and no model in the manifest declares the ${JSON.stringify(domain)} domain — the route says this change's model output carries ${domain} significance, and the inventory does not name it. Declare domains + domain_validations on the model concerned`);
  }
  return findings;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = run();
  if (findings.length) {
    process.stderr.write('\nModel-provenance gate (HG-0006) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery model role must be pinned, tiered, and (at required tiers) carry a fresh\npassing eval + independent validation. A model that declares a domain also carries a\ndomain signature — which records that a competent human reviewed it, never that the\noutput is admissible. See ../loom/references/model-risk.md.\n');
    process.exit(1);
  }
  process.stdout.write('Model-provenance gate (HG-0006) — OK\n');
}
