// The config-reconciliation gate (Loom 2.0-rc.12 — WS2.4). Platform enforcement is not a one-time
// observation: a required check can be removed, CODEOWNERS weakened, force-push re-enabled, a
// workflow's token widened to write, an OIDC issuer swapped, or an AI identity slipped into an
// approval group — hours after activation was signed. This scheduled-lane gate reconciles the
// APPROVED baseline against the CURRENT observed configuration and the live identity registry, and
// FAILS on any weakening drift. Because the routine-change controller (WS2.3) requires this gate
// green before it enables auto-merge, a drift finding SUSPENDS routine autonomy automatically.
//
//   baseline (config-baseline.json)  the approved configuration — owned by the second line
//   observation (platform-activation) what the platform reports now
//   registry (identities.json)        who currently holds approval authority
//
// Drift detected → the gate fails AND requires the routine envelope to be `suspended` (belt and
// braces: the controller gates on this gate; the envelope flag lets a human suspend directly).
//
// Honesty (rc.2 invariant): the CURRENT observation is produced by the adopter's independently
// controlled live-platform read, then verified by `loom activate`. This gate reconciles the
// records; the freshness/authenticity of the observation is platform-activation-check's. A public
// bundle cannot watch a bank's org live.
//
// Run from the repo root: `node scripts/config-reconciliation-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const BASELINE_LOCATIONS = ['docs/governance/config-baseline.json', 'config-baseline.json'];
const ACTIVATION_DIR = ['docs/governance/platform-activation', 'platform-activation'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
const ENVELOPE_LOCATIONS = ['docs/governance/routine-envelope.json', 'routine-envelope.json'];
const APPROVAL_GROUPS = new Set(['second-line', 'platform-admins']);

/** Drift findings from comparing the approved baseline against the observed branch_protection. */
function branchProtectionDrift(expected, obs) {
  const f = [];
  if (!obs) return ['no branch_protection observation to reconcile against the baseline — has the mechanism been removed?'];
  const o = obs.observation || {};
  for (const chk of expected.required_status_checks_include || []) {
    if (!Array.isArray(o.required_status_checks) || !o.required_status_checks.includes(chk)) {
      f.push(`required status check ${JSON.stringify(chk)} is no longer enforced — a required check was removed`);
    }
  }
  if (expected.enforce_admins === true && o.enforce_admins !== true) f.push('enforce_admins is no longer true — admins can now bypass branch protection');
  if (expected.allow_force_pushes === false && o.allow_force_pushes === true) f.push('allow_force_pushes was re-enabled — history can be rewritten on the protected branch');
  const rev = o.required_pull_request_reviews || {};
  if (typeof expected.min_required_reviews === 'number' && !(rev.required_approving_review_count >= expected.min_required_reviews)) {
    f.push(`required approving reviews dropped below ${expected.min_required_reviews} (now ${JSON.stringify(rev.required_approving_review_count)})`);
  }
  if (expected.require_code_owner_reviews === true && rev.require_code_owner_reviews !== true) f.push('require_code_owner_reviews was turned off — CODEOWNERS was weakened');
  return f;
}

/**
 * Findings. Empty ⇒ no weakening drift. `driftPresent` is surfaced so the caller can enforce that
 * routine autonomy is suspended. Pure over already-loaded records.
 */
export function evaluate({ baseline, observations = [], registry, envelope }) {
  const findings = [];
  if (!baseline || typeof baseline !== 'object') return { findings: ['no config-baseline.json — there is no approved configuration to reconcile against'], driftPresent: false };

  const byMechanism = (m) => observations.find((o) => o && o.mechanism === m);
  if (baseline.branch_protection) findings.push(...branchProtectionDrift(baseline.branch_protection, byMechanism('branch_protection')));

  if (baseline.workflow_permissions) {
    const obs = byMechanism('workflow_permissions');
    const cur = obs?.observation?.default_permissions;
    if (baseline.workflow_permissions === 'read' && cur === 'write') findings.push('default workflow token permission was widened to write — a build can now push');
  }
  if (baseline.oidc_issuer) {
    const obs = byMechanism('oidc_subjects');
    const cur = obs?.observation?.issuer;
    if (cur && cur !== baseline.oidc_issuer) findings.push(`OIDC issuer changed from ${JSON.stringify(baseline.oidc_issuer)} to ${JSON.stringify(cur)} — trust anchor moved`);
  }

  // Identity drift — an AI identity in an approval group, or holding an approver role. This is a
  // standing check (no observation needed): the registry is the current state of who can approve.
  for (const id of registry?.identities || []) {
    if (id.kind !== 'agent') continue;
    const inGroup = (id.groups || []).find((g) => APPROVAL_GROUPS.has(g));
    if (inGroup) findings.push(`agent identity ${JSON.stringify(id.id)} is in approval group ${JSON.stringify(inGroup)} — an AI must never hold approval authority`);
    if (Array.isArray(id.roles) && id.roles.length > 0) findings.push(`agent identity ${JSON.stringify(id.id)} now holds roles ${JSON.stringify(id.roles)} — an AI must hold no approver role`);
  }

  const driftPresent = findings.length > 0;
  // Automatic suspension: with drift present, routine auto-merge must be suspended. The controller
  // enforces this by requiring this gate green; the envelope flag is the direct manual switch.
  if (driftPresent && envelope && envelope.suspended !== true) {
    findings.push('configuration drift is present but the routine-envelope is not `suspended: true` — routine auto-merge must be suspended while the control plane is drifted (WS2.4)');
  }
  return { findings, driftPresent };
}

const findFile = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const findDir = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function run(cwd = process.cwd()) {
  const baselinePath = findFile(cwd, BASELINE_LOCATIONS);
  if (!baselinePath) return { present: false, findings: [] }; // no baseline declared — nothing to reconcile
  const baseline = readJson(baselinePath);
  const dir = findDir(cwd, ACTIVATION_DIR);
  const observations = dir ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(`${dir}/${f}`)).filter(Boolean) : [];
  const registry = (() => { const p = findFile(cwd, IDENTITY_LOCATIONS); return p ? readJson(p) : null; })();
  const envelope = (() => { const p = findFile(cwd, ENVELOPE_LOCATIONS); return p ? readJson(p) : null; })();
  const { findings } = evaluate({ baseline, observations, registry, envelope });
  return { present: true, findings };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings } = run();
  if (!present) {
    process.stdout.write('Config-reconciliation gate — no config-baseline.json; nothing to reconcile. OK\n');
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nConfig-reconciliation gate (rc.12 · WS2.4) — FAIL (drift)\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe live control-plane configuration has drifted from the approved baseline. Routine\nauto-merge is suspended until it is restored. See docs/governance/activation-runbook.md.\n');
    process.exit(1);
  }
  process.stdout.write('Config-reconciliation gate (rc.12 · WS2.4) — observed configuration matches the approved baseline. OK\n');
}
