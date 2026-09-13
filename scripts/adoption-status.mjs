// The adoption status projector (Loom 2.0-rc.14 · WS5). Installation is automated (adopt.mjs);
// configuration, validation, platform activation and organisational approval were not — so an
// adopter had no machine-readable answer to "how far along is this adoption, and what is still
// adopt-pending?". This turns adoption into an explicit FIVE-STAGE state machine, projected from
// the control catalog (the single state of record — this never invents a second ledger):
//
//   installed      the mechanism/document the control ships is present
//   configured     its templates carry no unresolved ADOPT markers (@your-org/, ADOPT:, draft)
//   validated      the catalog grades it mechanically-validated or higher
//   platform       the catalog grades it platform-enforced, or a signed activation names it (WS2)
//   organisation   the catalog grades it organisationally-enforced, or an adoption attestation covers it
//
// EVERY ONE OF THOSE FIVE IS A READ OF THE CATALOG, NOT OF THIS REPOSITORY, and the `validated`
// stage is the one where that distinction bites. It means "the catalog grades this control
// mechanically-validated" — i.e. a validating mechanism EXISTS. It does NOT mean the gate passes
// here. On a fresh adoption, nine gates are red by design and this projection still reports
// `validated` for all of them, because the catalog's grade is a property of the bundle and the
// gate's verdict is a property of the repo. Both are true; only one is a green board.
//
// That is a comprehension-debt shape — the exact failure the method names as its standing risk
// (SKILL.md Limits: "every gate stays green" while nobody is reading) — so two things guard it:
// the column is labelled MECHANISM, not "Validated", and `--run` adds a PASSING column that
// actually executes each control's mechanism and reports what this repository does. Without
// `--run` that column prints `?`, never a tick: an unasked question is not a pass.
//
// `loom status` prints this as a machine-readable JSON (--json) or a human table, plus the
// UNRESOLVED-MARKER INVENTORY — every adopt-pending file, named. `attest-adoption`
// (adoption-attest.mjs) reads this and refuses to accept a signed report while any mandatory item
// is adopt-pending.
//
// Run from the adopted repo root: `node scripts/adoption-status.mjs [--json] [--run]`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { run as platformActivationStatus } from './platform-activation-check.mjs';
import { evaluateAdoptionAttestation } from '../core/adoption-attestation.mjs';
import { loadIssuers } from '../core/attestations.mjs';

const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];
const ATTEST_LOCATIONS = ['docs/governance/adoption-attestation.json', 'adoption-attestation.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
// The scan roots for unresolved-marker detection (config the adopter must fill).
const SCAN_ROOTS = ['docs/governance', 'institution', 'guardrails', 'CODEOWNERS'];
export const MARKER = /@your-org\/|ADOPT:|ADOPT-|"status":\s*"draft"/;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const find = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;

/** Every file under `root` (recursive). A single file path returns itself. */
function walk(root) {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  const out = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Files under the scan roots that still carry an ADOPT marker — the unresolved inventory. */
export function unresolvedMarkers(cwd) {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const f of walk(join(cwd, root))) {
      let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (MARKER.test(text)) hits.push(f.slice(cwd.length + 1));
    }
  }
  return hits.sort();
}

const anyMarkerUnder = (cwd, prefixes, pendingSet) =>
  (prefixes || []).some((p) => [...pendingSet].some((f) => f === p || f.startsWith(p)));

/**
 * Execute one control's mechanism and report what it does IN THIS REPOSITORY.
 * Returns true (exit 0), false (non-zero), or null when there is nothing runnable to ask —
 * a documented control, a shell hook, or a mechanism file that is not present. `null` prints
 * as `—`, never as a tick: "not asked" and "passed" must not look the same.
 */
export function runMechanism(control, cwd, spawn = spawnSync) {
  const ref = control && control.mechanism_ref;
  if (typeof ref !== 'string' || !ref.endsWith('.mjs')) return null;
  if (!existsSync(join(cwd, ref))) return null;
  if (control.execute === false) return null; // enforced via another gate — asking here is misleading
  const r = spawn(process.execPath, [ref], { cwd, encoding: 'utf8', timeout: 120_000, stdio: 'ignore' });
  if (r.error || typeof r.status !== 'number') return null;
  return r.status === 0;
}

/** Compute the five-stage status of every control, plus the unresolved inventory. */
export function computeStatus(cwd = process.cwd(), { run = false, spawn = spawnSync } = {}) {
  const catalogPath = find(cwd, CATALOG_LOCATIONS);
  const catalog = catalogPath ? readJson(catalogPath) : null;
  if (!catalog) return { capabilities: [], unresolved: [], adoptPending: false, error: 'no control catalog' };

  const pending = unresolvedMarkers(cwd);
  const pendingSet = new Set(pending);

  // Only independently verified activation records advance the platform column. Reading the
  // satisfies_control string directly made an unsigned one-line JSON file look platform-active.
  const activation = platformActivationStatus(cwd);
  const activated = new Set(activation.verifiedControls || []);
  const attest = readJson(find(cwd, ATTEST_LOCATIONS) || '');
  const registry = readJson(find(cwd, IDENTITY_LOCATIONS) || '');
  const orgFindings = attest
    ? evaluateAdoptionAttestation({ adoptPending: pending.length > 0, unresolved: pending }, attest, { issuers: loadIssuers(cwd), registry })
    : [];
  const orgApproved = new Set(orgFindings.length === 0 ? (attest?.approved_controls || []) : []);

  const capabilities = catalog.controls.map((c) => {
    const state = c.state;
    const validated = ['mechanically-validated', 'platform-enforced', 'organisationally-enforced'].includes(state);
    const installed = validated || state === 'defined' || Boolean(c.mechanism_ref || c.doc_ref);
    // configured: nothing left adopt-pending under the paths this control governs.
    const configured = installed && !anyMarkerUnder(cwd, c.paths, pendingSet);
    const platform = activated.has(c.control_id);
    const organisation = state === 'organisationally-enforced' || orgApproved.has(c.control_id);
    // `passing` is undefined unless --run: the projection must never imply it asked.
    const passing = run ? runMechanism(c, cwd, spawn) : undefined;
    return { control_id: c.control_id, adopter_side: Boolean(c.adopter_side), installed, configured, validated, platform, organisation, passing };
  });
  const failing = capabilities.filter((c) => c.passing === false).map((c) => c.control_id);
  return { capabilities, unresolved: pending, adoptPending: pending.length > 0, ran: run, failing, activationFindings: activation.findings, organisationFindings: orgFindings };
}

const yn = (b) => (b ? 'yes' : '—');
// Tri-state for `passing`: true → yes, false → NO (loud), null → — (nothing runnable to ask),
// undefined → ? (not asked; --run was not given).
const tri = (b) => (b === true ? 'yes' : b === false ? '**NO**' : b === null ? '—' : '?');

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--run');
  const status = computeStatus(process.cwd(), { run });
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(status, null, 2) + '\n'); process.exit(0); }
  if (status.error) { process.stderr.write(`loom status — ${status.error}\n`); process.exit(2); }
  process.stdout.write('\nLoom adoption status\n\n');
  process.stdout.write('| Capability | Installed | Configured | Mechanism | Passing | Platform | Organisation |\n');
  process.stdout.write('|---|---|---|---|---|---|---|\n');
  for (const c of status.capabilities) {
    const tag = c.adopter_side ? ' *' : '';
    process.stdout.write(`| ${c.control_id}${tag} | ${yn(c.installed)} | ${yn(c.configured)} | ${yn(c.validated)} | ${tri(c.passing)} | ${yn(c.platform)} | ${yn(c.organisation)} |\n`);
  }
  process.stdout.write('\n* adopter-side capability (the bundle cannot ship it — you provide it).\n');
  process.stdout.write('Mechanism = the CATALOG grades this control mechanically-validated or higher (a validating\n');
  process.stdout.write('mechanism exists). It is NOT a statement about this repository — read the Passing column for that.\n');
  if (run) {
    process.stdout.write(`Passing = the mechanism was executed here just now: yes · **NO** · — (nothing runnable to ask).\n`);
    if (status.failing.length) {
      process.stdout.write(`\n${status.failing.length} gate(s) FAILING in this repository: ${status.failing.join(', ')}\n`);
      process.stdout.write('On a fresh adoption this is expected — the gates fail closed. Run each one to read what it wants.\n');
    } else {
      process.stdout.write('\nEvery runnable mechanism passes in this repository.\n');
    }
  } else {
    process.stdout.write('Passing = not asked. Re-run with --run to execute each mechanism and see what this repo actually does.\n');
  }
  if (status.unresolved.length) {
    process.stdout.write(`\n${status.unresolved.length} file(s) ADOPT-PENDING (unresolved markers):\n`);
    for (const f of status.unresolved) process.stdout.write(`  · ${f}\n`);
    process.stdout.write('\nFill these before `attest-adoption` — the verifier will not accept a signed adoption report while any mandatory item is adopt-pending.\n');
  } else {
    process.stdout.write('\nNo unresolved ADOPT markers — configuration is complete.\n');
  }
  if (status.activationFindings?.length) {
    process.stdout.write(`\n${status.activationFindings.length} platform-activation finding(s); the Platform column ignores unverified claims:\n`);
    for (const finding of status.activationFindings) process.stdout.write(`  · ${finding}\n`);
  }
  if (status.organisationFindings?.length) {
    process.stdout.write(`\n${status.organisationFindings.length} adoption-attestation finding(s); the Organisation column ignores unverified claims:\n`);
    for (const finding of status.organisationFindings) process.stdout.write(`  · ${finding}\n`);
  }
}
