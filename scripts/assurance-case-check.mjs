// The assurance-case gate (Loom 2.0-rc.14 · WS6). The assurance-cycle gate verifies the PERIODIC
// ritual; this gate operationalises the SIGNAL-TRIGGERED half — the review's F8: the Loom validated
// records but did not operate the case lifecycle that turns a runtime signal into governed action.
// A signal from a declared source (SIEM, model-monitoring, regulatory-intelligence, …) opens a CASE
// that must run the lifecycle and honour its SLA:
//
//   signal → assess → map controls → run tests → assemble evidence → second-line decision → remediation/closure
//
// The gate enforces, against the service-level expectations (assurance-sla.json):
//   · the signal source is a declared adapter source, its severity known, opened_at ISO;
//   · assessment happened within the severity's window (an unassessed critical signal is a finding);
//   · mapped controls resolve in the catalog; the second-line decision resolves to a second-line human;
//   · a RUNTIME BREACH (high/critical) records a CONTAINMENT action (suspend autonomy, block release,
//     rollback, model fallback) — a breach with no containment fails;
//   · an OPEN breach past its remediation deadline BLOCKS, unless a second-line risk acceptance covers it.
//
// The Loom validates and reconciles; the accountable decision stays human (the second line's).
//
// Run from the repo root: `node scripts/assurance-case-check.mjs`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { pathToFileURL } from 'node:url';

export const CASES_DIR = 'docs/governance/assurance-cases';
const SLA_LOCATIONS = ['docs/governance/assurance-sla.json', 'assurance-sla.json'];
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];
const HOUR = 3_600_000, DAY = 86_400_000;
const LIFECYCLE = ['assess', 'map_controls', 'run_tests', 'assemble_evidence', 'second_line_decision', 'remediation'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const find = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const isSecondLineHuman = (registry, id) => { const w = identityOf(registry, id); return w && w.kind !== 'agent' && (w.groups || []).includes('second-line'); };

/** Findings for one case. `now`/`registry`/`sla`/`controlIds` injectable for tests. */
export function evaluate(kase, { sla, registry, controlIds = new Set(), now = Date.now() } = {}) {
  const findings = [];
  const id = kase?.case_id || '(no case_id)';
  if (!kase?.case_id) findings.push('case has no case_id');

  const sig = kase?.signal;
  if (!sig || typeof sig !== 'object') { findings.push(`${id}: no signal — a case is opened by a signal`); return findings; }
  if (!(sla?.sources || []).includes(sig.source)) findings.push(`${id}: signal source ${JSON.stringify(sig.source)} is not a declared assurance source`);
  const sev = sla?.severities?.[sig.severity];
  if (!sev) { findings.push(`${id}: unknown severity ${JSON.stringify(sig.severity)}`); return findings; }
  const openedAt = Date.parse(sig.opened_at);
  if (Number.isNaN(openedAt)) findings.push(`${id}: signal has no ISO opened_at`);

  // Every lifecycle step present.
  for (const step of LIFECYCLE) if (!kase?.steps?.[step]) findings.push(`${id}: lifecycle step ${JSON.stringify(step)} is missing`);
  const steps = kase?.steps || {};

  // Assessment within the severity window.
  const assessedAt = Date.parse(steps.assess?.at);
  if (steps.assess && Number.isNaN(assessedAt)) findings.push(`${id}: assess step has no ISO \`at\``);
  else if (!Number.isNaN(openedAt) && !Number.isNaN(assessedAt) && assessedAt - openedAt > sev.assessment_hours * HOUR) {
    findings.push(`${id}: assessed ${((assessedAt - openedAt) / HOUR).toFixed(1)}h after the signal — past the ${sev.assessment_hours}h window for ${sig.severity}`);
  }

  // Mapped controls resolve in the catalog.
  const mapped = steps.map_controls?.controls;
  if (!Array.isArray(mapped) || mapped.length === 0) findings.push(`${id}: map_controls names no controls — a case must map to the controls it touches`);
  else for (const c of mapped) if (controlIds.size && !controlIds.has(c)) findings.push(`${id}: mapped control ${JSON.stringify(c)} is not in the control catalog`);

  // Second-line decision resolves to a second-line human.
  const dec = steps.second_line_decision;
  if (dec && registry && !isSecondLineHuman(registry, dec.by)) findings.push(`${id}: second_line_decision.by ${JSON.stringify(dec?.by)} is not a second-line human — the accountable decision is theirs`);

  // Runtime breach containment + overdue remediation.
  const rem = steps.remediation || {};
  const open = kase?.outcome !== 'closed' && rem.status !== 'closed';
  if (sev.requires_containment) {
    const acts = rem.containment;
    const valid = Array.isArray(acts) && acts.length > 0 && acts.every((a) => (sla.containment_actions || []).includes(a));
    if (!valid) findings.push(`${id}: a ${sig.severity} breach records no valid containment action (one of ${(sla.containment_actions || []).join(', ')}) — a runtime breach must be contained`);
  }
  if (open && !Number.isNaN(openedAt)) {
    const due = openedAt + sev.remediation_days * DAY;
    if (now > due) {
      const ra = rem.risk_acceptance;
      const covered = ra && registry && isSecondLineHuman(registry, ra.accepted_by) && Date.parse(ra.expires) > now;
      if (!covered) findings.push(`${id}: OPEN past its ${sev.remediation_days}d remediation deadline — an overdue breach blocks unless the second line risk-accepts it (unexpired)`);
    }
  }
  return findings;
}

export function run(cwd = process.cwd()) {
  const casesDir = existsSync(`${cwd}/${CASES_DIR}`) ? `${cwd}/${CASES_DIR}` : null;
  if (!casesDir) return { count: 0, findings: [] }; // no cases yet — OK for a generic repo
  const sla = readJson(find(cwd, SLA_LOCATIONS) || '');
  if (!sla) return { count: 0, findings: ['assurance cases exist but no assurance-sla.json — there are no service-level expectations to hold them to'] };
  const registry = loadRegistry(cwd);
  const catalog = readJson(find(cwd, CATALOG_LOCATIONS) || '');
  const controlIds = new Set((catalog?.controls || []).map((c) => c.control_id));
  const findings = [];
  let count = 0;
  for (const f of readdirSync(casesDir).filter((n) => n.endsWith('.json'))) {
    const kase = readJson(join(casesDir, f));
    if (!kase) { findings.push(`${f}: not valid JSON`); continue; }
    count++;
    findings.push(...evaluate(kase, { sla, registry, controlIds }));
  }
  return { count, findings };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { count, findings } = run();
  if (findings.length) {
    process.stderr.write('\nAssurance-case gate (rc.14 · WS6) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA runtime signal opens a governed case: assessed in time, mapped to controls, contained, and\nsecond-line decided. See ../loom/references/continuous-assurance.md.\n');
    process.exit(1);
  }
  process.stdout.write(`Assurance-case gate (rc.14 · WS6) — ${count} case(s) within SLA, mapped, contained, second-line decided. OK\n`);
}
