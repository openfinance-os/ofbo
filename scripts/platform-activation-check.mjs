// The platform-activation gate (Loom 2.0-rc.12 — WS2). The review's F3: the Loom validates
// DECLARATIONS about branch protection, identities and approvals (adapter envelopes), but nothing
// proves the platform is configured to PREVENT bypass — which is why no control has ever graded
// above mechanically-validated. This gate is the read-only OBSERVATION verifier: it checks a
// signed activation record produced by an institution-controlled live-platform observation, and it
// is the receipt that lets
// a catalog control graduate to `platform-enforced`.
//
// An activation record (one per platform mechanism) must carry:
//   observer_identity   resolves in the identity registry AND is OUTSIDE the agent's write
//                       authority (not a builder, not an agent) — you cannot self-attest that your
//                       own guardrail is active
//   observation         the mechanism the platform reports active (branch_protection, rulesets, …)
//   bypass_test         a NEGATIVE test actually executed against the platform, result "rejected"
//                       — an active-looking config that never refused a bypass proves nothing
//   attestation         ed25519 over the record's canonical hash, by a registered observer issuer
//   observed_at         fresh within the window (default 365d, like the R-gate drills)
//
// Graduation (WS2.2): every catalog control claiming `platform-enforced` MUST have a verified
// activation record naming it. The shipped bundle ships ZERO platform-enforced controls (activation
// needs live credentials — adopter-side), so this passes trivially here; the negative test proves a
// platform-enforced claim without a verified record fails the build.
//
// Honesty (rc.2 invariant): the bundle ships the verifier, the schema, the observer-separation rule
// and a reference observation shape. The institution must query its platform with a read-only,
// independently controlled observer and sign the resulting record before `loom activate` verifies
// it. A public bundle cannot observe a bank's GitHub org; it can prove the observation, once made,
// is authentic, separated and fresh.
//
// Run from the repo root: `node scripts/platform-activation-check.mjs` (exit 1 on any finding).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import { pathToFileURL } from 'node:url';

export const ACTIVATION_DIR = ['docs/governance/platform-activation', 'platform-activation'];
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
// Mechanisms are git-forge controls plus `egress_proxy` — the network chokepoint an agent's
// outbound traffic is forced through (HG-0011/HG-0012). It is here because the graduation rule
// below made those two controls unreachable by construction: an adopter could wire the gateway
// the runbook tells them to wire and still have no mechanism to name in the record.
export const MECHANISMS = new Set(['branch_protection', 'rulesets', 'required_reviews', 'codeowners', 'workflow_permissions', 'environment_protection', 'oidc_subjects', 'egress_proxy']);
const CONTROL_MECHANISMS = new Map([
  ['HG-0001', new Set(['branch_protection', 'rulesets', 'required_reviews', 'codeowners'])],
  ['HG-0004', new Set(['workflow_permissions', 'oidc_subjects'])],
  ['HG-0005', new Set(['environment_protection'])],
  ['HG-0011', new Set(['egress_proxy'])],
  ['HG-0012', new Set(['egress_proxy'])],
]);
const DEFAULT_MAX_AGE_DAYS = 365;
const DAY = 86_400_000;

/** Recursive canonical serialisation — the signature covers every nested field (assurance-cycle's). */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
/** Canonical hash of an activation record, excluding its own attestation. */
export function activationHash(record) {
  const { attestation, ...rest } = record;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);
const isOutsideWriteAuthority = (who) => who && who.kind !== 'agent' && !(who.groups || []).includes('builders');

/**
 * Findings for one activation record. `now`/`maxAgeDays` injectable for tests.
 * Empty ⇒ the platform mechanism is observed active, bypass-tested, freshly and independently signed.
 */
export function evaluate(record, { issuers, registry, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const findings = [];
  const id = record?.satisfies_control || '(no satisfies_control)';
  if (!registry) findings.push(`${id}: no readable identity registry — observer independence cannot be verified`);
  if (record?.platform == null || !record.platform) findings.push(`${id}: no platform named`);
  if (!record?.repository) findings.push(`${id}: no repository named`);
  if (!record?.satisfies_control) findings.push('activation record names no satisfies_control — an observation must say which control it activates');
  if (!MECHANISMS.has(record?.mechanism)) findings.push(`${id}: mechanism must be one of ${[...MECHANISMS].join('|')} (got ${JSON.stringify(record?.mechanism)})`);
  const allowedMechanisms = CONTROL_MECHANISMS.get(record?.satisfies_control);
  if (allowedMechanisms && !allowedMechanisms.has(record?.mechanism)) {
    findings.push(`${id}: mechanism ${JSON.stringify(record?.mechanism)} cannot activate this control; expected one of ${[...allowedMechanisms].join('|')}`);
  }
  if (!record?.observation || typeof record.observation !== 'object' || Array.isArray(record.observation) || Object.keys(record.observation).length === 0) {
    findings.push(`${id}: no non-empty observation object — what did the platform actually report?`);
  }

  // Observer separation — you cannot attest that your own guardrail is active.
  const observerId = record?.observer_identity;
  if (!observerId) findings.push(`${id}: no observer_identity`);
  else if (registry) {
    const who = identityOf(registry, observerId);
    if (!who) findings.push(`${id}: observer_identity ${JSON.stringify(observerId)} does not resolve in the identity registry`);
    else if (!isOutsideWriteAuthority(who)) findings.push(`${id}: observer ${JSON.stringify(observerId)} is inside the agent's write authority (a builder/agent) — an observation of your own control plane is not independent`);
  }

  // A negative bypass test must have been EXECUTED and rejected.
  const bt = record?.bypass_test;
  if (!bt || typeof bt !== 'object') findings.push(`${id}: no bypass_test — an active-looking config that never refused a bypass proves nothing`);
  else {
    if (!bt.attempted) findings.push(`${id}: bypass_test names no attempted action`);
    if (bt.result !== 'rejected') findings.push(`${id}: bypass_test result is ${JSON.stringify(bt.result)}, not "rejected" — the platform did not refuse the bypass`);
    if (!bt.tested_at || Number.isNaN(Date.parse(bt.tested_at))) findings.push(`${id}: bypass_test has no ISO-8601 tested_at`);
    else if (now - Date.parse(bt.tested_at) > maxAgeDays * DAY) findings.push(`${id}: bypass_test is stale (older than ${maxAgeDays}d) — re-run the bypass probe`);
  }

  // Freshness of the observation itself.
  if (!record?.observed_at || Number.isNaN(Date.parse(record.observed_at))) findings.push(`${id}: no ISO-8601 observed_at`);
  else if (now - Date.parse(record.observed_at) > maxAgeDays * DAY) findings.push(`${id}: observation is stale (older than ${maxAgeDays}d) — re-observe the platform`);

  // The observation is authentically signed by a registered issuer.
  findings.push(...verifySignatureOver(activationHash(record), record?.attestation, issuers, `activation ${id}`).map((f) => `${id}: ${f}`));
  return findings;
}

/**
 * Graduation cross-check (WS2.2): every catalog control claiming platform-enforced must have a
 * verified activation record naming it. `verifiedControlIds` is the set of satisfies_control values
 * whose records passed evaluate(). Findings ⇒ an overstated platform-enforced claim.
 */
export function checkGraduation(catalog, verifiedControlIds) {
  const findings = [];
  for (const c of catalog?.controls || []) {
    if (c.state === 'platform-enforced' || c.state === 'organisationally-enforced') {
      if (!verifiedControlIds.has(c.control_id)) {
        findings.push(`${c.control_id}: claims ${c.state} but has no VERIFIED platform-activation record — a platform-enforced claim needs an observed, bypass-tested, signed receipt (WS2.2)`);
      }
    }
  }
  return findings;
}

const findDir = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const findFile = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function run(cwd = process.cwd(), { maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const issuers = loadIssuers(cwd) || loadIssuers(`${cwd}/..`);
  const registry = (() => { const p = findFile(cwd, IDENTITY_LOCATIONS); return p ? readJson(p) : null; })();
  const catalogPath = findFile(cwd, CATALOG_LOCATIONS);
  const catalog = catalogPath ? readJson(catalogPath) : null;

  const dir = findDir(cwd, ACTIVATION_DIR);
  const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

  const findings = [];
  const verified = new Set();
  for (const file of files) {
    const r = readJson(`${dir}/${file}`);
    if (!r) { findings.push(`${file}: platform-activation record is not valid JSON`); continue; }
    const f = evaluate(r, { issuers, registry, maxAgeDays });
    if (f.length === 0 && r.satisfies_control) verified.add(r.satisfies_control);
    findings.push(...f);
  }
  if (catalog) findings.push(...checkGraduation(catalog, verified));
  return { count: files.length, findings, verifiedControls: [...verified].sort() };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--max-age-days');
  const maxAgeDays = i >= 0 ? Number(process.argv[i + 1]) : DEFAULT_MAX_AGE_DAYS;
  const { count, findings } = run(process.cwd(), { maxAgeDays });
  if (findings.length) {
    process.stderr.write('\nPlatform-activation gate (rc.12 · WS2) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA control is platform-enforced only when the live platform is OBSERVED preventing bypass,\nindependently and freshly. See docs/governance/activation-runbook.md and supply-chain-security.md.\n');
    process.exit(1);
  }
  process.stdout.write(`Platform-activation gate (rc.12 · WS2) — ${count} observation(s) verified; no overstated platform-enforced claim. OK\n`);
}
