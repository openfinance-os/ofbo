// The WS6 floor gate (Factory Floor D6.3 + D6.4). Two deliveries, one gate, because they answer the
// same question from opposite ends: is what this floor SHOWS a person true?
//
//   D6.3 · the floor-keepers. Machines do the paperwork, and the promise is that they approve
//          nothing. Grants on a collaboration surface are per page and per database, never per
//          property, so that promise is kept by PHYSICAL SEPARATION — approval fields live in a
//          container no keeper holds any grant on — or it is not kept at all.
//          `core/floor-keeper.mjs` is the reasoning; this is the half that reads files.
//
//   D6.4 · graceful degradation. When the platform's credits run out the keepers stop, and nothing
//          about the floor looks different. `core/floor-degradation.mjs` refuses to let a paused
//          floor be represented as a live one; this is the half that finds the observations and,
//          crucially, the half that notices there are NONE.
//
//   node scripts/floor-keeper-check.mjs [--max-age-days N] [--observation-max-age-days N]
//
// SILENT WHERE UNADOPTED, in the `freeze-stamp-check.mjs` shape. A repository with no grant register
// and no degradation observation runs no collaboration surface, and this gate says nothing at all.
// An adopter who never switches the floor on must not be handed a red build for a capability they
// may never want.
//
// WHERE IT TIGHTENS, and this is the interesting half of the wiring. The two deliveries imply each
// other, so declaring one without the other is itself a finding:
//
//   · a grant register with no degradation observation (FK-R09/DG-R08) — a floor with keepers has
//     metered automation, and metered automation pauses. A floor that has never been observed for
//     liveness is one whose keepers can stop without anybody finding out, which is exactly T-13.
//   · a committed projection with keepers declared — handled by
//     `scripts/projection-capability-check.mjs`, not here; this gate does not re-verify payloads.
//
// The gate reads only committed files. Nothing here queries a workspace, reads a credit balance, or
// enumerates a live grant: those are the adopter's watcher and auditor, and their output arrives as
// evidence, exactly as drift observations and identity-map reconciliations do. A gate that phoned
// the vendor would fail hardest during the outage it exists to describe.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { GRANT_AUDIT_MAX_AGE_DAYS, checkGrantRegister } from '../core/floor-keeper.mjs';
import {
  OBSERVATION_MAX_AGE_DAYS,
  SCHEMA_ID as DEGRADATION_SCHEMA_ID,
  checkCurrency,
  checkDegradation,
  deriveStatus,
  worstStatus,
} from '../core/floor-degradation.mjs';

export const REGISTER_LOCATIONS = ['docs/governance/floor-keepers.json', 'floor-keepers.json'];
export const DEGRADATION_DIRS = ['docs/governance/floor-degradation', 'floor-degradation'];
export const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const findFile = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const findDir = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find((p) => existsSync(p) && statSync(p).isDirectory()) || null;
const jsonFiles = (dir) => (dir ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort() : []);

/**
 * The degradation half, over a set of already-loaded observations. Split out from `run()` so the
 * rule that matters most — an adopted floor with NO observation at all — is testable without a
 * filesystem, and so a caller can hand in observations from anywhere.
 *
 * `keepersDeclared` is what makes the absence a finding rather than silence: keepers mean metered
 * automation, and metered automation that nobody watches pauses quietly.
 */
export function evaluate({ register = null, observations = [], registry = null } = {}, {
  now = Date.now(),
  maxAgeDays = GRANT_AUDIT_MAX_AGE_DAYS,
  observationMaxAgeDays = OBSERVATION_MAX_AGE_DAYS,
} = {}) {
  const findings = [];
  if (register) findings.push(...checkGrantRegister(register, { registry, now, maxAgeDays }));

  for (const { name, record } of observations) {
    if (!record) { findings.push(`DG-R01: ${name}: not readable as JSON — a file in the degradation directory that is not an observation`); continue; }
    findings.push(...checkDegradation(record, { registry }, name));
  }

  const records = observations.map((o) => o.record).filter(Boolean);
  const keepersDeclared = Array.isArray(register?.keepers) && register.keepers.length > 0;
  if (keepersDeclared || records.length > 0) {
    findings.push(...checkCurrency(records, { now, maxAgeDays: observationMaxAgeDays }));
  }
  if (keepersDeclared && records.length === 0) {
    findings.push(`DG-R08: ${register.keepers.length} floor-keeper(s) are declared but this floor's liveness has never been observed — keepers run on metered automation, and metered automation stops when the credits do. Nothing errors, no queue turns red, and the board keeps rendering: that is T-13, and an unwatched floor is the one it happens to`);
  }

  const worst = worstStatus(records);
  return { findings, worst, observations: records.length, keepers: keepersDeclared ? register.keepers.length : 0 };
}

/**
 * Filesystem wiring. Returns `{ findings, adopted, … }`; `adopted: false` ⇒ this repository runs no
 * floor and the gate is silent.
 */
export function run(cwd = process.cwd(), {
  now = Date.now(),
  maxAgeDays = GRANT_AUDIT_MAX_AGE_DAYS,
  observationMaxAgeDays = OBSERVATION_MAX_AGE_DAYS,
} = {}) {
  const registerPath = findFile(cwd, REGISTER_LOCATIONS);
  const degradationDir = findDir(cwd, DEGRADATION_DIRS);
  const names = jsonFiles(degradationDir);
  if (!registerPath && names.length === 0) {
    return { findings: [], adopted: false, worst: null, observations: 0, keepers: 0 };
  }

  const register = registerPath ? readJson(registerPath) : null;
  const findings = [];
  if (registerPath && !register) {
    findings.push(`FK-R01: ${registerPath.slice(cwd.length + 1)}: not readable as JSON — an unreadable register must never be mistaken for one describing no grants`);
  }
  const registryPath = findFile(cwd, IDENTITY_LOCATIONS);
  const registry = registryPath ? readJson(registryPath) : null;
  const observations = names.map((name) => ({ name, record: readJson(`${degradationDir}/${name}`) }));

  const r = evaluate({ register, observations, registry }, { now, maxAgeDays, observationMaxAgeDays });
  return { ...r, findings: [...findings, ...r.findings], adopted: true };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const num = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && Number.isFinite(Number(process.argv[i + 1])) ? Number(process.argv[i + 1]) : fallback;
  };
  const { findings, adopted, worst, observations, keepers } = run(process.cwd(), {
    maxAgeDays: num('--max-age-days', GRANT_AUDIT_MAX_AGE_DAYS),
    observationMaxAgeDays: num('--observation-max-age-days', OBSERVATION_MAX_AGE_DAYS),
  });
  if (findings.length) {
    process.stderr.write('\nFloor gate (WS6 · D6.3 floor-keeper grants, D6.4 graceful degradation) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nTwo promises are being kept here, or not kept. AGENTS APPROVE NOTHING: a grant is per\ncontainer and never per property, so approval fields live where a keeper holds no grant at\nall — there is no narrower arrangement. AND SILENCE IS NOT COVERAGE: when the credits run\nout the keepers stop and nothing looks different, so a paused floor must say so on every\nview, and it may never be represented as a live one. See docs/notion-floor-plan.md §4 WS6\nand docs/notion-floor-threat-model.md T-12/T-13.\n');
    process.exit(1);
  }
  if (!adopted) {
    process.stdout.write('Floor gate (WS6) — no floor adopted (no grant register, no degradation observation)\n');
  } else {
    const status = worst ? worst.status.toUpperCase() : 'UNOBSERVED';
    process.stdout.write(`Floor gate (WS6) — OK (${keepers} floor-keeper${keepers === 1 ? '' : 's'} with no grant on any approval-carrying container; ${observations} liveness observation${observations === 1 ? '' : 's'}, worst status ${status})\n`);
    if (worst && worst.status !== 'live') {
      // Not a failure. A truthfully-degraded floor PASSES this gate: representing degradation
      // honestly is the deliverable, and a gate that failed on it would teach adopters to stop
      // writing observations, which is the silence D6.4 exists to break.
      process.stdout.write(`  · this floor is ${worst.status.toUpperCase()} and says so, on every view — that is D6.4 working, not failing\n`);
    }
  }
}

// Re-exported so a caller checking one record does not have to import two modules. The gate's
// verdict and the surface's banner must come from the same derivation or they will diverge.
export { DEGRADATION_SCHEMA_ID, deriveStatus };
