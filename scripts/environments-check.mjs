// The environment gate (rc.39 · flow-plan Phase 5.1). Exposure is not deploy, and the first
// thing that has to be true before that sentence means anything is that the ESTATE is written
// down. Until now it was not: `skills/release/SKILL.md` carried three `<!-- ADOPT -->` comments
// telling an adopter to "name your pre-production promotion command and environment", "name your
// smoke command and the pre-production URL", and "name your production promotion path and who is
// entitled to run it". Three prose seams, unmounted — so nothing could check what was named,
// no deployment record could cite an environment, and the repository could not answer the
// question every data-protection review opens with: WHICH of your environments hold personal
// data, and who can push into them?
//
// docs/governance/environments.json is that ladder as data. This gate holds five properties:
//
//   SHAPE      every environment declares id, purpose, data_classification, identity,
//              promotion_source, approval_required and url — an environment with no stated
//              purpose is a host somebody stood up, not a rung on a promotion ladder.
//   LADDER     exactly one root (promotion_source null), every other source is a declared id,
//              no self-reference, no cycles, nothing orphaned. A promotion path with a cycle is
//              not a path.
//   IDENTITY   `identity` — who may promote INTO this environment — resolves in the identity
//              registry, and for an approval-required environment is neither an agent nor a
//              builder. The people who build the thing do not wave it into production, and an
//              agent does not promote at all.
//   PERSONAL   an environment classified `personal` MUST require approval. Real customer data
//              behind an unattended promotion is the incident, not the risk.
//   TERMINAL   the environment nothing promotes out of — production, by construction — MUST
//              require approval. This is the release skill's second-line hold expressed as a
//              property of the estate rather than as a step someone remembers.
//
// Absence is silence: a repository that has not declared its estate is not failing (many
// adopters mount this at the same time they mount their first deployment). What is NOT silent is
// a declared estate that is incoherent, and what is never silent is a ladder still carrying the
// shipped example's URLs — that prints a NOTICE on every run, because a template nobody edited is
// the failure mode a green check hides.
//
// Lane: pr. Run from the repo root: `node scripts/environments-check.mjs` (exit 1 on a finding).
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const ENVIRONMENT_LOCATIONS = ['docs/governance/environments.json', 'environments.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

// The data an environment may hold, weakest to strongest. `personal` is the one that changes the
// control posture, so it is the one the rules below name.
export const DATA_CLASSIFICATIONS = ['none', 'synthetic', 'masked', 'pseudonymised', 'personal'];
// The example URLs the shipped template carries. A ladder still using them has not been adopted.
const PLACEHOLDER_URL = /\.example\.invalid(\/|$)/;

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

/**
 * Findings (fail) and notices (never do) for one environments record.
 * `registry` is the identity registry; without one, identity resolution is reported as a finding
 * rather than skipped — an unresolvable promoter does not count, the same rule the drill observer
 * follows in operational-readiness-check.
 */
export function evaluate(doc, { registry = null } = {}) {
  const findings = [];
  const notices = [];
  const envs = doc?.environments;
  if (!Array.isArray(envs) || envs.length === 0) {
    return { findings: ['environments.json has no `environments` array — an empty estate is not a declaration'], notices };
  }

  const byId = new Map();
  for (const e of envs) {
    const id = e?.id;
    if (!nonEmpty(id)) { findings.push('an environment has no id'); continue; }
    if (byId.has(id)) findings.push(`${id}: duplicate environment id`);
    byId.set(id, e);
  }

  for (const [id, e] of byId) {
    for (const f of ['purpose', 'url']) {
      if (!nonEmpty(e[f])) findings.push(`${id}: no ${f} — an environment with no ${f === 'purpose' ? 'stated purpose is a host, not a rung' : 'url cannot be smoke-tested, and an unsmokeable target is not a promotion step'}`);
    }
    if (!DATA_CLASSIFICATIONS.includes(e.data_classification)) {
      findings.push(`${id}: data_classification must be ${DATA_CLASSIFICATIONS.join('|')} (got ${JSON.stringify(e.data_classification)}) — "we are not sure what is in it" is the answer this field exists to make impossible`);
    }
    if (typeof e.approval_required !== 'boolean') {
      findings.push(`${id}: approval_required must be true or false — an unstated approval posture defaults to nothing, and nothing is what gets exploited`);
    }

    // Who may promote INTO this environment.
    if (!nonEmpty(e.identity)) findings.push(`${id}: no identity — an environment nobody is named against is promoted into by anybody`);
    else if (!registry) findings.push(`${id}: identity ${JSON.stringify(e.identity)} cannot be resolved — no identity registry found, and an unresolvable promoter does not count`);
    else {
      const who = identityOf(registry, e.identity);
      if (!who) findings.push(`${id}: identity ${JSON.stringify(e.identity)} does not resolve in the identity registry`);
      else if (e.approval_required === true) {
        if (who.kind === 'agent') findings.push(`${id}: requires approval, yet its promotion identity ${JSON.stringify(e.identity)} is an agent — an agent does not promote into an approval-gated environment`);
        else if ((who.groups || []).includes('builders')) findings.push(`${id}: requires approval, yet its promotion identity ${JSON.stringify(e.identity)} is in the builders group — the people who built the thing do not wave it through their own gate`);
      }
    }

    // PERSONAL — real customer data is never behind an unattended promotion.
    if (e.data_classification === 'personal' && e.approval_required !== true) {
      findings.push(`${id}: holds personal data with approval_required ${JSON.stringify(e.approval_required)} — an environment carrying real customer data is promoted into by decision, not by pipeline`);
    }

    if (nonEmpty(e.url) && PLACEHOLDER_URL.test(e.url)) {
      notices.push(`${id}: url ${e.url} is still the shipped template's placeholder — this is the Loom's example ladder, not your estate. Adopt it (scripts/environments-check.mjs is checking a fiction until you do)`);
    }
  }

  // LADDER — exactly one root, declared sources, no cycles, nothing orphaned.
  const roots = [...byId.values()].filter((e) => e.promotion_source === null || e.promotion_source === undefined);
  if (roots.length === 0) findings.push('no root environment — exactly one environment must declare promotion_source: null; a ladder with no bottom rung is a cycle');
  else if (roots.length > 1) findings.push(`${roots.length} root environments (${roots.map((e) => e.id).join(', ')}) — a promotion ladder has exactly one bottom rung; parallel roots mean two undeclared estates`);
  for (const [id, e] of byId) {
    const src = e.promotion_source;
    if (src === null || src === undefined) continue;
    if (!nonEmpty(src)) { findings.push(`${id}: promotion_source must be null or a declared environment id (got ${JSON.stringify(src)})`); continue; }
    if (src === id) { findings.push(`${id}: promotes from itself — a self-referential promotion source is not a source`); continue; }
    if (!byId.has(src)) findings.push(`${id}: promotion_source ${JSON.stringify(src)} is not a declared environment — an artifact cannot be promoted from somewhere this repository does not describe`);
  }
  // Cycle detection over the declared edges (only for sources that resolve).
  for (const [id] of byId) {
    const seen = new Set([id]);
    let cur = byId.get(id)?.promotion_source;
    while (nonEmpty(cur) && byId.has(cur)) {
      if (seen.has(cur)) { findings.push(`${id}: promotion path contains a cycle (${[...seen, cur].join(' ← ')}) — promotion has a direction or it has no meaning`); break; }
      seen.add(cur);
      cur = byId.get(cur)?.promotion_source;
    }
  }

  // TERMINAL — nothing promotes out of it, so it is the end of the ladder: production.
  const sources = new Set([...byId.values()].map((e) => e.promotion_source).filter(nonEmpty));
  for (const [id, e] of byId) {
    if (sources.has(id)) continue;
    if (e.approval_required !== true) {
      findings.push(`${id}: nothing promotes out of it — this is the terminal environment — yet approval_required is ${JSON.stringify(e.approval_required)}. The last rung of the ladder is where the second-line hold lives; an unattended terminal environment is a production deploy with no human in it`);
    }
  }

  return { findings, notices };
}

/** Read the estate (and the registry) from an adopted or bundle tree. `present:false` ⇒ silence. */
export function run(cwd = process.cwd()) {
  const path = ENVIRONMENT_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) return { present: false, findings: [], notices: [], count: 0 };
  let doc;
  try { doc = JSON.parse(readFileSync(`${path}`, 'utf8')); }
  catch (e) { return { present: true, findings: [`environments.json is not valid JSON: ${e.message}`], notices: [], count: 0 }; }
  const registryPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const { findings, notices } = evaluate(doc, { registry: registryPath ? readJson(registryPath) : null });
  return { present: true, findings, notices, count: Array.isArray(doc?.environments) ? doc.environments.length : 0 };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings, notices, count } = run();
  if (!present) {
    process.stdout.write(`Environment gate — no ${ENVIRONMENT_LOCATIONS[0]} in this repository; the promotion ladder is undeclared (nothing to check)\n`);
    process.exit(0);
  }
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nEnvironment gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe promotion ladder is a control surface, not documentation: one root, no cycles, a\nnamed non-builder promoter wherever approval is required, personal data behind approval,\nand a terminal environment that a human decides into. See skills/release/SKILL.md §2 and §8.\n');
    process.exit(1);
  }
  process.stdout.write(`Environment gate — OK (${count} environment${count === 1 ? '' : 's'}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
