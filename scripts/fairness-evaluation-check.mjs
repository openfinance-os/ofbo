// The fairness-evaluation gate (AI-FAIRNESS). Until 2.0.0 this control was catalogued ABSENT and
// the note said why: the harness holds no fairness metric, no protected-attribute register and no
// test rig, so grading it on the strength of a manifest slot "would claim a bias test where only an
// eval slot exists". That is still true and nothing below changes it.
//
// WHAT THIS GATE DOES NOT DO, stated first because the control's whole history is people claiming
// otherwise: it does not measure a disparity, does not run a model, does not see a population, does
// not know whether the metric named is the right metric for the decision, and cannot detect a proxy.
// Every number it reads was produced by the adopter's rig and is taken as a DECLARATION. A rig that
// measures the wrong thing produces a record this gate passes.
//
// WHAT IT DOES HOLD, which is why the state moves from `absent` to `mechanically-validated` and no
// further — composition, provenance, binding and coverage, the same four things every other gate in
// this harness holds:
//
//   FR-R01  a register with no `protected_attributes` — a fairness policy naming nothing to
//           protect. It silences the per-attribute rules and nothing else: coverage and the pin
//           binding are properties of the evaluations and still report
//   FR-R02  an attribute with no `basis` — a protected class nobody has to defend the choice of.
//           `measured_by` and `proxy_risk` absent are NOTICES: they are prose whose absence is a
//           thinner record, not a broken one
//   FR-R03  no `metric`, or an evaluation expressed in a different one — one file, one metric, or
//           the threshold means a different thing per row
//   FR-R04  `threshold.max_disparity` that is not a finite number, or a `direction` that is neither
//           `ceiling` nor `floor`. DIRECTION IS EXPLICIT AND NEVER INFERRED: a ratio metric where
//           1.0 is parity fails LOW, and guessing that from the metric string is how a failing
//           model reads green
//   FR-R05  an `owner` who does not resolve to a human in the registry, is an agent, or sits inside
//           `builders` — a threshold whose owner cannot be named belongs to nobody
//   FR-R06  a model role in the manifest that is customer-affecting and has NO evaluation entry —
//           the coverage rule. Silence is not a pass
//   FR-R07  an evaluation naming a role that is not in the manifest — a measurement of nothing
//   FR-R08  THE BINDING RULE, and the only one a filled-in slot cannot satisfy: an evaluation whose
//           `evaluated_model_id`/`evaluated_prompt_version` differ from the manifest pin that ships.
//           A retrain moves the pin and thereby invalidates its own fairness evidence. This is the
//           mechanical half of "re-tested on every material retrain"
//   FR-R09  a registered attribute with no measurement in an evaluation — an attribute nobody
//           measured, named rather than averaged over
//   FR-R10  a measurement that is not a finite number, or that breaches the threshold in the
//           declared direction
//   FR-R11  no identified `population.dataset_version`, or no `representativeness` — an
//           unidentified population makes the number unreproducible, which makes it a claim
//   FR-R12  no `report` {ref, sha256}, a report that is absent, or one whose bytes do not match the
//           declared hash — a declared number is not evidence (the 1.10 rule, applied here)
//   FR-R13  (NOTICE ALWAYS) `material_retrain` prose absent — the pin comparison in FR-R08 catches
//           only a retrain that MOVED the pin, and a retrain shipping under the same pin string is
//           invisible to every gate in this repository. Reported every run because the harness
//           enforces precisely nothing about it
//
// MANDATORY-WHEN-COMPILED (the rc.13 WS3 idiom, and rc.46's correction to it — see
// evidence-retention-check.mjs for why arming on the file's PRESENCE is a defect). The installer
// mounts this template, so presence proves nothing about intent. No compiling change ⇒ every rule
// above is a NOTICE and the run is `inert`. The moment a change's compiled plan requires the
// `fairness_evaluation` capability, the same rules are findings that NAME the changes requiring it.
//
// Lane: pr. Run from the repo root: `node scripts/fairness-evaluation-check.mjs` (exit 1 on a
// finding).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired, requiredBy, modelRolesRequiredByCapability } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry } from './identity-registry-check.mjs';

export const FAIRNESS_LOCATIONS = ['docs/governance/fairness-evaluations.json', 'fairness-evaluations.json'];
export const MANIFEST_LOCATIONS = ['docs/governance/model-manifest.json', 'model-manifest.json'];
export const CAPABILITY = 'fairness_evaluation';
// The compiler family this record rides with, used ONLY to name the changes when a per-change
// capability record is unavailable — never to decide whether this gate applies.
export const GATE_FAMILY = 'product-eval';
// A threshold is a ceiling (lower is better — a difference metric) or a floor (higher is better —
// a ratio metric where 1.0 is parity). Never inferred from the metric name; see FR-R04.
export const DIRECTIONS = new Set(['ceiling', 'floor']);
// Which manifest risk tiers are taken to affect a customer outcome materially, and therefore must
// carry a measurement. ADOPT: the same medium-and-high default the eval and validation rules use
// (model-provenance-check.mjs EVAL_REQUIRED_TIERS) — a low-tier model is optional here.
export const COVERED_TIERS = new Set(['high', 'medium']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
/** An untouched template field. A shipped template must never read as a decision. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
/** A real, adopted value — present and not an unreplaced marker. */
const stated = (v) => nonEmpty(v) && !isPlaceholder(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * Findings (fail) and notices (never do) over a parsed fairness record.
 *
 * `models` is the manifest's model list — the join partner. Without it the coverage and pin rules
 * (FR-R06, FR-R07, FR-R08) cannot run at all, and the caller reports that as UNCOVERED rather than
 * quietly reporting the remaining rules as a full pass.
 *
 * `enforced` is whether a compiled plan requires the capability, and it is the ONLY thing deciding
 * finding-vs-notice — for every rule. Mounting the template is not the declaration.
 */
export function evaluate(doc, { models = null, coveredRoles = null, registry = null, baseDir = null, enforced = false } = {}) {
  const findings = [];
  const notices = [];
  const say = (m) => (enforced ? findings : notices).push(m);

  // FR-R01 — the register. It ends the PER-ATTRIBUTE rules (FR-R09/FR-R10 have nothing to measure
  // against) and nothing else. The rules that join to the manifest — coverage (FR-R06) and the pin
  // binding (FR-R08) — are properties of the evaluations, not of the register, and returning early
  // here would suppress exactly the two findings an adopter most needs to see: an empty register
  // and three uncovered deciding models is a more useful message than either half alone. The
  // contestability gate beside this one reports both for the same reason.
  const attrs = Array.isArray(doc?.protected_attributes)
    ? doc.protected_attributes.filter((a) => a && typeof a === 'object' && stated(a.attribute))
    : [];
  if (!attrs.length) {
    say('FR-R01: no `protected_attributes` with a stated attribute — a fairness register that names nothing to protect measures nothing, and the per-attribute rules below have nothing to measure against');
  }
  for (const a of attrs) {
    if (!stated(a.basis)) {
      say(`FR-R02: protected attribute ${JSON.stringify(a.attribute)} states no \`basis\` — name the statute, regulation or policy that protects it. An attribute with no basis is a choice nobody has to defend, and an attribute the law names and this register omits is exactly what it exists to make visible`);
    }
    for (const [field, why] of [['measured_by', 'how membership was determined — declared, inferred or proxied. A disparity measured across a badly inferred attribute is a number about the inference'], ['proxy_risk', 'what in the feature set could carry this attribute although it is not a feature. NOTHING HERE DETECTS A PROXY; this field records that somebody looked']]) {
      if (!stated(a[field])) notices.push(`FR-R02: protected attribute ${JSON.stringify(a.attribute)} states no \`${field}\` — ${why}. Reported, never enforced: its absence is a thinner record, not a broken one`);
    }
  }

  // FR-R03/FR-R04 — one metric, one threshold, an explicit direction.
  const metric = stated(doc?.metric) ? doc.metric.trim() : null;
  if (!metric) say('FR-R03: no `metric` — every measurement below is a bare number until the file says what it measures, and a threshold over unnamed numbers means a different thing per row');
  const threshold = doc?.threshold && typeof doc.threshold === 'object' && !Array.isArray(doc.threshold) ? doc.threshold : null;
  const max = threshold?.max_disparity;
  const direction = threshold?.direction;
  const thresholdUsable = finite(max) && DIRECTIONS.has(direction);
  if (!finite(max)) {
    say(`FR-R04: threshold.max_disparity is ${JSON.stringify(max)}, not a number — the value above (or below) which a measurement is a failure. The gate takes no view on what the number should be, only that a real one is set and the measurements are held against it`);
  }
  if (!DIRECTIONS.has(direction)) {
    say(`FR-R04: threshold.direction is ${JSON.stringify(direction)} — it is "ceiling" (a difference metric; lower is better) or "floor" (a ratio metric where 1.0 is parity; higher is better). NEVER INFERRED FROM THE METRIC NAME: guess it wrong and a failing model reads green, which is why this field is explicit`);
  }

  // FR-R05 — the threshold's owner. A number nobody owns is a number in a file.
  if (!stated(doc?.owner)) {
    say('FR-R05: no `owner` for the threshold — a threshold that belongs to nobody is a number in a file. Name the model-risk or second-line human who set it');
  } else if (registry) {
    const who = identityOf(registry, doc.owner);
    if (!who) {
      say(`FR-R05: threshold owner ${JSON.stringify(doc.owner)} is not in the identity registry — an unresolvable owner owns nothing`);
    } else {
      if (who.kind === 'agent') say(`FR-R05: threshold owner ${doc.owner} is an AGENT — agents prepare evidence, they never own a control threshold`);
      // `builders` is a GROUP on the identity, not a top-level registry list — the same membership
      // test identity-registry-check.mjs uses for the second-line disjointness rule.
      if ((who.groups || []).includes('builders')) {
        say(`FR-R05: threshold owner ${doc.owner} is in \`builders\` — the team whose model is being measured cannot own the threshold it is measured against`);
      }
    }
  }

  // FR-R13 — always a notice. The pin comparison cannot see a retrain that kept the pin string.
  if (!stated(doc?.material_retrain)) {
    notices.push('FR-R13: no `material_retrain` prose — FR-R08 catches only a retrain that MOVED the pin, and a retrain shipping under the same pin string is invisible to every gate in this repository. Reported every run because the harness enforces nothing about it');
  }

  const evaluations = Array.isArray(doc?.evaluations)
    ? doc.evaluations.filter((e) => e && typeof e === 'object' && stated(e.role))
    : [];
  const byRole = new Map(evaluations.map((e) => [e.role.trim(), e]));

  // FR-R06 / FR-R07 — the join with the model manifest, in both directions.
  if (Array.isArray(models)) {
    const manifestRoles = new Map(models.filter((m) => m && nonEmpty(m.role)).map((m) => [m.role.trim(), m]));
    for (const [role, m] of manifestRoles) {
      if ((!coveredRoles || coveredRoles.has(role)) && COVERED_TIERS.has(m.risk_tier) && !byRole.has(role)) {
        say(`FR-R06: model role ${JSON.stringify(role)} is ${m.risk_tier}-tier in the model manifest and has NO fairness evaluation here — a model whose output materially affects a customer outcome is measured or it is uncovered, and silence is not a pass`);
      }
    }
    for (const role of byRole.keys()) {
      if (!manifestRoles.has(role)) {
        say(`FR-R07: fairness evaluation names role ${JSON.stringify(role)}, which is not in the model manifest — a measurement of a model this repository does not ship is a measurement of nothing`);
      }
    }
    // FR-R08 — the binding rule.
    for (const [role, e] of byRole) {
      const m = manifestRoles.get(role);
      if (!m) continue;
      if (e.evaluated_model_id !== m.model_id || e.evaluated_prompt_version !== m.prompt_version) {
        say(`FR-R08: STALE fairness evidence for ${JSON.stringify(role)} — measured against ${JSON.stringify(e.evaluated_model_id)}/${JSON.stringify(e.evaluated_prompt_version)}, and the manifest ships ${JSON.stringify(m.model_id)}/${JSON.stringify(m.prompt_version)}. A retrain moves the pin and thereby invalidates its own fairness evidence; re-measure against the pin that ships`);
      }
    }
  }

  // Per-evaluation rules. These run whether or not the manifest could be read — an evaluation is
  // internally sound or it is not, independently of what it binds to.
  for (const e of evaluations) {
    const role = e.role.trim();
    if (!stated(e.ran_at)) say(`FR-R11: evaluation for ${JSON.stringify(role)} has no \`ran_at\` — an undated measurement cannot be aged against anything`);
    const pop = e.population && typeof e.population === 'object' ? e.population : null;
    if (!stated(pop?.dataset_version)) {
      say(`FR-R11: evaluation for ${JSON.stringify(role)} identifies no \`population.dataset_version\` — an unidentified population makes the number unreproducible, and an unreproducible number is a claim`);
    }
    if (!stated(pop?.representativeness)) {
      say(`FR-R11: evaluation for ${JSON.stringify(role)} states no \`population.representativeness\` — a disparity measured on a convenience sample is a disparity in the sample. The gate reads that the statement is present and takes no view on whether it is true`);
    }
    if (stated(e.metric) && metric && e.metric.trim() !== metric) {
      say(`FR-R03: evaluation for ${JSON.stringify(role)} is expressed in ${JSON.stringify(e.metric)} and the file declares ${JSON.stringify(metric)} — one file, one metric, or the threshold means a different thing per row`);
    }

    // FR-R09 / FR-R10 — a number per registered attribute, held against the threshold.
    const measured = e.disparities && typeof e.disparities === 'object' && !Array.isArray(e.disparities) ? e.disparities : {};
    for (const a of attrs) {
      const key = a.attribute.trim();
      if (!Object.prototype.hasOwnProperty.call(measured, key)) {
        say(`FR-R09: evaluation for ${JSON.stringify(role)} has no measurement for registered attribute ${JSON.stringify(key)} — an attribute nobody measured is named here rather than averaged into a headline number`);
        continue;
      }
      const v = measured[key];
      if (!finite(v)) {
        say(`FR-R10: evaluation for ${JSON.stringify(role)} measures ${JSON.stringify(key)} as ${JSON.stringify(v)}, which is not a number — a "pass", a narrative or a missing value is not a measurement`);
        continue;
      }
      if (!thresholdUsable) continue; // FR-R04 already said the threshold cannot be applied
      const breached = direction === 'ceiling' ? v > max : v < max;
      if (breached) {
        say(`FR-R10: evaluation for ${JSON.stringify(role)} measures ${JSON.stringify(key)} at ${v}, breaching the ${direction} of ${max} in ${metric || 'the declared metric'} — the measurement its owner set the threshold to catch. THE GATE DOES NOT JUDGE THE MODEL: it read two numbers out of a file and compared them`);
      }
    }
    for (const key of Object.keys(measured)) {
      if (key.startsWith('_')) continue; // commentary keys, as everywhere else in the harness
      if (!attrs.some((a) => a.attribute.trim() === key)) {
        notices.push(`FR-R09: evaluation for ${JSON.stringify(role)} measures ${JSON.stringify(key)}, which is not in \`protected_attributes\` — measured but not registered. Reported, never enforced: measuring more than the register demands is not a defect`);
      }
    }

    // FR-R12 — the report artifact. A declared number is not evidence.
    const r = e.report;
    if (!r || typeof r !== 'object' || !stated(r.ref) || !/^[0-9a-f]{64}$/.test(r.sha256 || '')) {
      say(`FR-R12: evaluation for ${JSON.stringify(role)} has no \`report\` {ref, sha256} — the rig's output artifact, sealed. A number transcribed into this file with nothing behind it is the false green every other eval rule in this harness already refuses`);
    } else if (baseDir) {
      const p = join(baseDir, r.ref);
      if (!existsSync(p)) {
        say(`FR-R12: fairness report ${r.ref} for ${JSON.stringify(role)} not found — a referenced artifact must exist`);
      } else if (createHash('sha256').update(readFileSync(p)).digest('hex') !== r.sha256) {
        say(`FR-R12: fairness report ${r.ref} for ${JSON.stringify(role)} does not match its declared sha256 — the report was altered after this record was written`);
      }
    }
  }

  return { findings, notices, attributes: attrs.length, evaluations: evaluations.length };
}

/**
 * The change_ids whose compiled plan requires the capability. Prefers the per-change capability
 * record; falls back to the gate family the capability rides with, so a message still names
 * somebody when a plan predates per-change capability records.
 */
export function requiringChanges(agg) {
  const byCapability = (agg?.changes || [])
    .filter((c) => c?.capabilities?.[CAPABILITY]?.required)
    .map((c) => c.change_id);
  return byCapability.length ? byCapability : requiredBy(agg, GATE_FAMILY);
}

export function run(cwd = process.cwd()) {
  const path = FAIRNESS_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  if (!path) {
    // The resting state of a repository that ships no model deciding about people. Not a failure
    // until a compiled plan says one does.
    if (!required) return { present: false, required, findings: [], notices: [], attributes: 0, evaluations: 0, inert: true, joined: false };
    const who = requiringChanges(agg);
    return {
      present: false,
      required,
      // Name the source template and its tier. A capability can compile at any adoption tier while
      // the template lands at `governed`, so "the file is missing" without "here is where it comes
      // from" leaves an adopter below that tier with a failure they cannot action — the rc.46
      // shariah-surfaces defect one step removed.
      findings: [`a compiled plan requires the ${CAPABILITY} capability [${who.join(', ') || 'unknown change'}] and there is no ${FAIRNESS_LOCATIONS[0]} — the route says this change ships a model whose output materially affects a customer outcome, and nothing in the repository says which attributes it must not disadvantage or what was measured. The template is governance/fairness-evaluations.template.json and it installs at the GOVERNED tier; a core-tier adoption that compiles this capability has to raise its tier to receive it`],
      notices: [],
      attributes: 0,
      evaluations: 0,
      inert: false,
      joined: false,
    };
  }
  const doc = readJson(path);
  if (!doc) {
    const m = `${FAIRNESS_LOCATIONS[0]} is not valid JSON — nothing in it can be read, so nothing in it measures anything`;
    return { present: true, required, findings: required ? [m] : [], notices: required ? [] : [m], attributes: 0, evaluations: 0, inert: false, joined: false };
  }
  const manifestPath = MANIFEST_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const manifest = manifestPath ? readJson(manifestPath) : null;
  const models = Array.isArray(manifest?.models) ? manifest.models : null;
  const { findings, notices, attributes, evaluations } = evaluate(doc, {
    models,
    coveredRoles: modelRolesRequiredByCapability(agg, CAPABILITY),
    registry: loadRegistry(cwd),
    baseDir: cwd,
    enforced: required,
  });
  // Say plainly when the join could not run. Coverage and the pin binding are the two rules a
  // filled-in slot cannot satisfy, and reporting the rest as a clean pass without them would be
  // the exact overclaim this control was catalogued absent to avoid.
  const joinNotices = models ? [] : [
    `no model manifest found (looked in ${MANIFEST_LOCATIONS.join(', ')}) — the coverage rule (FR-R06) and THE PIN BINDING (FR-R08) could not run at all, so this record is checked for internal soundness only and its coverage is UNCOVERED rather than confirmed`,
  ];
  return { present: true, required, findings, notices: [...joinNotices, ...notices], attributes, evaluations, inert: false, joined: Boolean(models) };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, required, findings, notices, attributes, evaluations, joined } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nFairness-evaluation gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery model that decides about people carries a measurement, bound to the pin that ships,\nagainst attributes somebody registered and a threshold somebody owns.\nTHE HARNESS MEASURES NOTHING — it reads the record. See governance/fairness-evaluations.template.json.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Fairness-evaluation gate — no ${FAIRNESS_LOCATIONS[0]}; no compiled plan requires ${CAPABILITY} (nothing to check)\n`);
    process.exit(0);
  }
  // "record read", never "model is fair" — the distinction this control's absent note was written
  // to protect, kept in the success line where it is read most often.
  const posture = required
    ? `, ${CAPABILITY} required by a compiled plan`
    : `; no compiled plan requires ${CAPABILITY}, so every rule above is REPORTED, not enforced`;
  process.stdout.write(`Fairness-evaluation gate — OK (${attributes} registered attribute${attributes === 1 ? '' : 's'}, ${evaluations} evaluation${evaluations === 1 ? '' : 's'}${joined ? ', bound to the shipping pins' : ', NOT bound — no manifest'}; record read, no disparity ever measured here${posture}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
