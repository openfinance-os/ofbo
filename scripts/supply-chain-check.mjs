// Q4 — supply-chain output validation. Like Q2, the control is the OUTPUT, not the run:
// a release must carry a real SBOM, a dependency-audit result within policy, and build
// provenance that binds an artifact digest to a builder. This gate validates all three:
//
//   SBOM     — CycloneDX JSON with a non-empty component inventory
//   audit    — critical/high counts within policy (missing report = gap, not pass)
//   provenance — subjects with sha256 digests + a named builder (SLSA-shaped)
//
// An audit MAY calibrate by reachability (see below). Run from the repo root:
// `node scripts/supply-chain-check.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const LOCATIONS = {
  sbom: ['docs/governance/evidence/sbom.cdx.json', 'sbom.cdx.json'],
  audit: ['docs/governance/evidence/dependency-audit.json', 'dependency-audit.json'],
  provenance: ['docs/governance/evidence/provenance.json', 'provenance.json'],
};
// ADOPT: your vulnerability policy for a releasable build.
export const MAX_CRITICAL = 0;
export const MAX_HIGH = 0;
// ADOPT: the deferral budget, used ONLY when the audit declares reachability (below). A finding
// a call-graph analysis proves unreachable is still real — it is deferred under an SLA, never
// forgiven — so the budget is small and the SLA is mandatory.
export const MAX_DEFERRED_CRITICAL = 0;
export const MAX_DEFERRED_HIGH = 10;

// Reachability calibration. `maxHigh = 0` is the right floor and unlivable on a real dependency
// tree; the predictable outcome is a permanently-red gate that gets bypassed — an inert control.
// An audit may instead declare which findings a call-graph analysis proves REACHABLE, and be
// gated on those. The split of authority is the point:
//
//   the REPORT states facts   — tool, method, reachable counts, the deferral SLA
//   this GATE states policy   — the constants above, which live under CODEOWNERS
//
// so calibrating is a control-plane change, not something a report can grant itself. A declared
// but malformed block never degrades to the lenient path: it fails AND the strict totals apply.
const asDate = (v) => { const d = new Date(`${v}`); return Number.isNaN(d.getTime()) ? null : d; };

/**
 * Validate a declared reachability block against the audit totals.
 * `{ usable, findings }` — `usable` reports whether the CLAIM is sound enough to gate on, which
 * is a different question from whether it passed. A sound claim that breaches the budget is
 * usable and failing; an unsound one is unusable, and the caller falls back to the strict totals
 * rather than letting a broken block buy leniency.
 */
export function checkReachability(r, { critical, high }, now) {
  const findings = [];
  const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!nonEmpty(r.tool) || !nonEmpty(r.method)) {
    findings.push('reachability claim names no tool/method — evidence must identify what produced it');
    return { usable: false, findings };
  }
  const rc = r.reachable?.critical;
  const rh = r.reachable?.high;
  if (typeof rc !== 'number' || typeof rh !== 'number') {
    findings.push('reachability declared but reachable.critical/reachable.high are not stated');
    return { usable: false, findings };
  }
  if (rc > critical || rh > high) {
    findings.push(`reachable counts (${rc} critical / ${rh} high) exceed the totals they are drawn from (${critical}/${high})`);
    return { usable: false, findings };
  }
  if (rc > MAX_CRITICAL) findings.push(`${rc} REACHABLE critical vulnerability(ies) exceed the policy maximum of ${MAX_CRITICAL}`);
  if (rh > MAX_HIGH) findings.push(`${rh} REACHABLE high vulnerability(ies) exceed the policy maximum of ${MAX_HIGH}`);

  const deferredC = critical - rc;
  const deferredH = high - rh;
  if (deferredC > MAX_DEFERRED_CRITICAL) findings.push(`${deferredC} unreachable critical vulnerability(ies) exceed the deferral budget of ${MAX_DEFERRED_CRITICAL}`);
  if (deferredH > MAX_DEFERRED_HIGH) findings.push(`${deferredH} unreachable high vulnerability(ies) exceed the deferral budget of ${MAX_DEFERRED_HIGH}`);
  if (deferredC + deferredH > 0) {
    const sla = nonEmpty(r.deferred_sla) ? asDate(r.deferred_sla) : null;
    if (!sla) findings.push('findings are deferred as unreachable with no remediation SLA — a deferral without a date is a bypass, not a policy');
    else if (sla < now) findings.push(`the deferral SLA (${r.deferred_sla}) has passed — the deferred findings are now overdue, not deferred`);
  }
  return { usable: true, findings };
}

/**
 * Findings for a dependency-audit report on its own. Exported because the audit is judged in two
 * places — the Q4 gate and the sealed evidence bundle (`evidence-seal-check.mjs`) — and the two
 * must agree: a bundle that clears Q4 by reachability must not then be rejected by the seal.
 */
export function checkAudit(audit, { maxCritical = MAX_CRITICAL, maxHigh = MAX_HIGH, now = new Date() } = {}) {
  const findings = [];
  const crit = audit.critical ?? audit.vulnerabilities?.critical;
  const high = audit.high ?? audit.vulnerabilities?.high;
  if (typeof crit !== 'number' || typeof high !== 'number') return ['dependency-audit report does not state critical/high counts'];
  // A usable reachability claim replaces the totals gate; an unusable one adds to it.
  const declared = audit.reachability ?? audit.vulnerabilities?.reachability;
  const reach = declared ? checkReachability(declared, { critical: crit, high }, now) : null;
  if (reach) findings.push(...reach.findings);
  if (!reach?.usable) {
    if (crit > maxCritical) findings.push(`${crit} critical vulnerability(ies) exceed the policy maximum of ${maxCritical}`);
    if (high > maxHigh) findings.push(`${high} high vulnerability(ies) exceed the policy maximum of ${maxHigh}`);
  }
  return findings;
}

/** Findings across the three artifacts ({sbom, audit, provenance} — null = missing). */
export function evaluate({ sbom, audit, provenance }, { maxCritical = MAX_CRITICAL, maxHigh = MAX_HIGH, now = new Date() } = {}) {
  const findings = [];

  if (!sbom) findings.push('no SBOM — the release does not declare what it contains (Q4)');
  else {
    if (sbom.bomFormat !== 'CycloneDX') findings.push(`SBOM bomFormat is ${JSON.stringify(sbom.bomFormat)} — expected CycloneDX`);
    if (!Array.isArray(sbom.components) || sbom.components.length === 0) findings.push('SBOM has no components — an empty inventory is not an inventory');
  }

  if (!audit) findings.push('no dependency-audit report — the Q4 seam is unfilled, which is a gap, not a pass');
  else findings.push(...checkAudit(audit, { maxCritical, maxHigh, now }));

  if (!provenance) findings.push('no build provenance — nothing binds the artifact to a builder (Q4)');
  else {
    const subjects = provenance.subject;
    if (!Array.isArray(subjects) || subjects.length === 0 || !subjects.every((s) => s?.digest?.sha256)) {
      findings.push('provenance subjects missing or without sha256 digests');
    }
    const builder = provenance.predicate?.builder?.id ?? provenance.builder?.id;
    if (!builder) findings.push('provenance names no builder — evidence must identify what produced it');
  }

  return findings;
}

const load = (paths, cwd) => {
  const p = paths.map((x) => `${cwd}/${x}`).find(existsSync);
  if (!p) return null;
  return JSON.parse(readFileSync(p, 'utf8')); // a parse error is a legitimate crash-fail
};

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = process.cwd();
  let findings;
  try {
    findings = evaluate({
      sbom: load(LOCATIONS.sbom, cwd),
      audit: load(LOCATIONS.audit, cwd),
      provenance: load(LOCATIONS.provenance, cwd),
    });
  } catch (e) { findings = [`supply-chain artifact is not valid JSON: ${e.message}`]; }
  if (findings.length) {
    process.stderr.write('\nSupply-chain gate (Q4: SBOM · audit · provenance) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nFill the Q4 seams with real SCA/SBOM/provenance producers.\nSee ../loom/references/supply-chain-security.md.\n');
    process.exit(1);
  }
  process.stdout.write('Supply-chain gate (Q4) — OK\n');
}
