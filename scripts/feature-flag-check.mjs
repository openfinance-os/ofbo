// The exposure gate (rc.39 · flow-plan Phase 5.2). Deploy is not exposure. A binary on a host
// harms nobody; behaviour in front of a customer is the thing the compound production
// authorization exists to hold. While those two are the same event, the hold has to sit on the
// DEPLOY — so nothing ships until everything is approved, and a bank ends up batching a quarter
// of work behind one signature. Declaring the exposure separately moves the hold to where the
// risk actually is and lets the code ship continuously, dark.
//
// docs/governance/feature-flags.json is that declaration, and this gate holds it to seven
// properties — each one a way the "we shipped it dark" claim goes wrong in practice:
//
//   OWNING CHANGE   change_id resolves to a governed change. A flag belonging to nothing is an
//                   exposure nobody classified.
//   DEFAULT OFF     `default` must be false. A flag defaulting on is a deploy wearing an
//                   exposure control's clothes, and it is how "dark launch" becomes a launch.
//   OWNER           a human registry identity — someone who can be woken up. Not an agent.
//   KILL PATH       a stated route to off. A flag you cannot turn off is a branch, not a switch;
//                   this is the same lever service-readiness names as `kill_switch.mechanism`,
//                   which is what makes the R3 drill evidence for this control too.
//   COHORT STAGE    one of the pilot playbook's six stages, so "how exposed is this?" has ONE
//                   vocabulary across discovery, the pilot and the deploy record.
//   EXPIRY          every flag ends. EXPIRED IS A FINDING; 30/14/7-day warnings precede it
//                   (Phase 3's idiom — the deadline is unmoved, the surprise is removed).
//   RETIREMENT      a flag whose owning change is CLOSED or SUPERSEDED is stale exposure control
//                   in production. Flag debt is the well-known cost of this pattern and it is
//                   mechanically visible, so it is mechanically refused.
//
// MANDATORY-WHEN-COMPILED, exactly like the data-risk register (rc.13 WS3): a repository that
// declares no flags and has no compiling change is SILENT — most repositories are not doing
// staged exposure and are not failing. The moment any change's compiled plan requires the
// `exposure_control` capability (the regulated-bank profile declares it at HIGH tier), a missing
// register fails, and every change requiring it must name at least one flag. The requirement
// comes from the profile, never from a CI flag.
//
// Lane: pr. Run from the repo root: `node scripts/feature-flag-check.mjs` (exit 1 on a finding).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { TERMINAL_STATES, aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';

export const FLAG_LOCATIONS = ['docs/governance/feature-flags.json', 'feature-flags.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
export const CHANGES_DIR = 'docs/governance/changes';
export const CAPABILITY = 'exposure_control';

// The pilot playbook's six stages (governance/runbooks/pilot-playbook.md, "Stages"), as keys.
// One vocabulary: a flag at `capped-production-cohort` and a pilot at stage 4 are the same claim.
export const COHORT_STAGES = [
  'synthetic-rehearsal',
  'controlled-internal',
  'staff-customer-beta',
  'capped-production-cohort',
  'expanded-cohort',
  'normal-operation',
];
export const WARNING_BANDS = [30, 14, 7];

const DAY = 86_400_000;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

/**
 * Findings (fail) and notices (never do) over a parsed flag register.
 *
 * `changes` is [{change_id, current_state, requires_exposure_control}] — the governed changes this
 * repository carries. `null` means there is no changes tree at all, in which case the owning-change
 * link is reported as NOT VERIFIED rather than passed quietly (the rule `caused_by_change` follows
 * in operations-signal-check: an unresolvable link is never a silent pass).
 */
export function evaluate(doc, { registry = null, changes = null, now = Date.now() } = {}) {
  const findings = [];
  const notices = [];
  const flags = doc?.flags;
  if (!Array.isArray(flags)) {
    return { findings: ['feature-flags.json has no `flags` array — an exposure register with no register is not a declaration'], notices };
  }
  const byChange = changes ? new Map(changes.map((c) => [c.change_id, c])) : null;

  const seen = new Set();
  for (const f of flags) {
    const key = f?.flag_key;
    const label = nonEmpty(key) ? key : '(unnamed flag)';
    if (!nonEmpty(key)) findings.push('a flag has no flag_key — an exposure control with no key controls nothing');
    else {
      if (seen.has(key)) findings.push(`${key}: duplicate flag_key — two declarations of one switch means one of them is a fiction`);
      seen.add(key);
      if (/\s/.test(key)) findings.push(`${key}: flag_key contains whitespace — this must be the key your flag platform actually reads`);
    }

    // DEFAULT OFF — the property the whole pattern rests on.
    if (f?.default !== false) {
      findings.push(`${label}: default is ${JSON.stringify(f?.default)}, not false — a flag that defaults ON is not an exposure control, it is a deploy. Exposure is a decision somebody takes, never the state a release arrives in`);
    }

    // OWNER — a human who can be woken up.
    if (!nonEmpty(f?.owner)) findings.push(`${label}: no owner — an exposure nobody owns is an exposure nobody turns off`);
    else if (!registry) findings.push(`${label}: owner ${JSON.stringify(f.owner)} cannot be resolved — no identity registry found, and an unresolvable owner does not count`);
    else {
      const who = identityOf(registry, f.owner);
      if (!who) findings.push(`${label}: owner ${JSON.stringify(f.owner)} does not resolve in the identity registry`);
      else if (who.kind === 'agent') findings.push(`${label}: owner ${JSON.stringify(f.owner)} is an agent — the thing you page at 3am is a person`);
    }

    if (!nonEmpty(f?.kill_path)) {
      findings.push(`${label}: no kill_path — a flag you cannot state the route to turning off is a branch in production, not a switch. Name the same lever the service's kill_switch.mechanism names`);
    }

    if (!COHORT_STAGES.includes(f?.cohort_stage)) {
      findings.push(`${label}: cohort_stage must be one of ${COHORT_STAGES.join(' | ')} (got ${JSON.stringify(f?.cohort_stage)}) — the stages are the pilot playbook's, so exposure has one vocabulary`);
    }

    // OWNING CHANGE + RETIREMENT.
    if (!nonEmpty(f?.change_id)) findings.push(`${label}: no change_id — an exposure belongs to a governed change, or it is an exposure nobody classified`);
    else if (byChange === null) notices.push(`${label}: owning change ${f.change_id} NOT VERIFIED — this repository carries no ${CHANGES_DIR} tree, so the link cannot be resolved here`);
    else {
      const owner = byChange.get(f.change_id);
      if (!owner) findings.push(`${label}: change_id ${JSON.stringify(f.change_id)} does not resolve under ${CHANGES_DIR}/ — an exposure control must belong to a governed change`);
      else if (TERMINAL_STATES.has(owner.current_state)) {
        findings.push(`${label}: its owning change ${f.change_id} is ${owner.current_state} — a flag outliving its change is stale exposure machinery in production. Remove the flag (and this entry) as part of closing the change`);
      }
    }

    // EXPIRY — every flag ends.
    const t = Date.parse(f?.expires);
    if (!nonEmpty(f?.expires) || Number.isNaN(t)) {
      findings.push(`${label}: expires ${JSON.stringify(f?.expires)} is not a date — an exposure control with no end date is a permanent branch in production that nobody ever decided to keep`);
    } else if (t < now) {
      findings.push(`${label}: EXPIRED ${f.expires} (${Math.floor((now - t) / DAY)}d ago) — the flag was to be removed and was not. Remove it, or record a NEW expiry as a decision rather than an edit`);
    } else {
      const left = Math.floor((t - now) / DAY);
      const band = [...WARNING_BANDS].sort((a, b) => a - b).find((b) => left <= b);
      if (band !== undefined) notices.push(`${label}: expires ${f.expires} — ${left}d left (${band}-day band). Plan the removal now; at expiry this BLOCKS`);
    }
  }

  // MANDATORY-WHEN-COMPILED — every change whose plan requires exposure_control names a flag.
  if (byChange) {
    const covered = new Set(flags.map((f) => f?.change_id).filter(nonEmpty));
    for (const c of byChange.values()) {
      if (!c.requires_exposure_control || TERMINAL_STATES.has(c.current_state)) continue;
      if (!covered.has(c.change_id)) {
        findings.push(`${c.change_id}: its compiled plan requires the ${CAPABILITY} capability, and no flag in the register names it — a change routed for staged exposure that declares no exposure control is going out all at once`);
      }
    }
  }
  return { findings, notices };
}

/** The governed changes and whether each one's compiled plan requires the exposure capability. */
export function collectChanges(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return null;
  const out = [];
  for (const name of readdirSync(dir)) {
    const env = readJson(`${dir}/${name}/change-envelope.json`);
    if (!env) continue;
    const plan = readJson(`${dir}/${name}/${env.control_plan || 'control-plan.json'}`);
    out.push({
      change_id: env.change_id || name,
      current_state: env.current_state,
      requires_exposure_control: Boolean(plan?.required_capabilities?.[CAPABILITY]?.required),
    });
  }
  return out;
}

export function run(cwd = process.cwd()) {
  const path = FLAG_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const required = capabilityRequired(aggregateRequirements(cwd), CAPABILITY);
  if (!path) {
    if (!required) return { present: false, required, findings: [], notices: [], count: 0 };
    const who = (collectChanges(cwd) || []).filter((c) => c.requires_exposure_control && !TERMINAL_STATES.has(c.current_state)).map((c) => c.change_id);
    return {
      present: false,
      required,
      findings: [`a compiled plan requires the ${CAPABILITY} capability [${who.join(', ') || 'unknown change'}] and there is no ${FLAG_LOCATIONS[0]} — the route says this change is exposed in stages, and nothing in the repository says how`],
      notices: [],
      count: 0,
    };
  }
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { present: true, required, findings: [`feature-flags.json is not valid JSON: ${e.message}`], notices: [], count: 0 }; }
  const registryPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const { findings, notices } = evaluate(doc, {
    registry: registryPath ? readJson(registryPath) : null,
    changes: collectChanges(cwd),
  });
  return { present: true, required, findings, notices, count: Array.isArray(doc?.flags) ? doc.flags.length : 0 };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, required, findings, notices, count } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nExposure gate (feature flags) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nExposure is not deploy. A flag defaults OFF, belongs to a governed change, names a human\nowner and a kill path, sits at one of the pilot playbook\'s stages, and ENDS.\nSee governance/runbooks/pilot-playbook.md and skills/release/SKILL.md §2.\n');
    process.exit(1);
  }
  if (!present) {
    process.stdout.write(`Exposure gate — no ${FLAG_LOCATIONS[0]}; no compiled plan requires ${CAPABILITY} (nothing to check)\n`);
    process.exit(0);
  }
  process.stdout.write(`Exposure gate — OK (${count} flag${count === 1 ? '' : 's'}${required ? `, ${CAPABILITY} required by a compiled plan` : ''}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
