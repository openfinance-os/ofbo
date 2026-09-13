// The control-catalog gate (1.10). The catalog — docs/governance/control-catalog.json — is
// the source of record for control state, replacing any hand-graded scorecard. A catalog is
// only trustworthy if it cannot overstate itself, so this gate enforces the five-state
// grammar and the receipts each state demands:
//
//   absent                    — a note saying so (a gap named, not hidden)
//   defined                   — the governing document exists (doc_ref)
//   mechanically-validated    — the validating mechanism exists (mechanism_ref)
//   platform-enforced         — mechanism + a negative bypass test + activation evidence
//   organisationally-enforced — all of the above + a named independent owner
//
// A control claiming a state without its receipts FAILS the build — the catalog cannot
// drift above the truth. Run from the repo root: `node scripts/control-catalog-check.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];

export const STATES = ['absent', 'defined', 'mechanically-validated', 'platform-enforced', 'organisationally-enforced'];
// The compiler's plan families (core/policy-compiler.mjs required_gates vocabulary) — the
// values a catalog control's gate_family may take so the gate runner can bind them (W1).
export const GATE_FAMILIES = new Set(['D', 'PA1', 'PA2', 'A', 'Q', 'R', 'second-line-hold', 'product-eval', 'assurance-cadence', 'decision-log', 'brainkit-conformance']);

/** Findings (one per violation). `exists` is injectable for tests. */
export function evaluate(catalog, exists = existsSync) {
  const findings = [];
  const controls = catalog && catalog.controls;
  if (!Array.isArray(controls) || controls.length === 0) {
    return ['catalog has no `controls` — there is no control state of record'];
  }
  const seen = new Set();
  for (const c of controls) {
    const id = c && c.control_id;
    if (!id) { findings.push('a control has no control_id'); continue; }
    if (seen.has(id)) findings.push(`${id}: duplicate control_id`);
    seen.add(id);
    if (!(typeof c.objective === 'string' && c.objective.trim())) findings.push(`${id}: no objective`);
    if (!(typeof c.owner_role === 'string' && c.owner_role.trim())) findings.push(`${id}: no owner_role`);
    if (![1, 2, 3].includes(c.line)) findings.push(`${id}: line must be 1, 2 or 3 (got ${JSON.stringify(c.line)})`);
    if (!STATES.includes(c.state)) { findings.push(`${id}: state must be one of ${STATES.join('|')} (got ${JSON.stringify(c.state)})`); continue; }

    // Receipts by state — a state without its receipts is an overstated catalog.
    const need = (field, why) => {
      if (!(typeof c[field] === 'string' && c[field].trim())) findings.push(`${id}: claims ${c.state} but has no ${field} — ${why}`);
    };
    if (c.state === 'absent') need('note', 'an absent capability must be named, not hidden');
    if (c.state === 'defined') need('doc_ref', 'defined means the governing document exists');
    if (c.state === 'mechanically-validated' || c.state === 'platform-enforced' || c.state === 'organisationally-enforced') {
      need('mechanism_ref', 'the validating mechanism must be named');
    }
    if (c.state === 'platform-enforced' || c.state === 'organisationally-enforced') {
      need('test_ref', 'platform-enforced requires a negative bypass test');
      need('activation_evidence', 'platform-enforced requires evidence the platform control is active');
    }
    if (c.state === 'organisationally-enforced') need('independent_owner', 'organisational enforcement requires a named independent owner');

    // Execution metadata (read by core/gate-runner.mjs) must be well-formed.
    if (c.lane !== undefined && !['pr', 'build', 'release', 'deploy', 'scheduled'].includes(c.lane)) {
      findings.push(`${id}: lane must be pr|build|release|deploy|scheduled (got ${JSON.stringify(c.lane)})`);
    }
    if (c.paths !== undefined && !(Array.isArray(c.paths) && c.paths.every((p) => typeof p === 'string' && p.trim()))) {
      findings.push(`${id}: paths must be an array of non-empty path prefixes`);
    }
    // min_tier (rc.34) opts a control into tier-aware selection: it runs only when the highest
    // implicated change tier reaches it. `always` and plan-mandated controls override upward.
    if (c.min_tier !== undefined && !['low', 'medium', 'high', 'critical'].includes(c.min_tier)) {
      findings.push(`${id}: min_tier must be low|medium|high|critical (got ${JSON.stringify(c.min_tier)})`);
    }
    // depends_on (rc.40) orders the runner's parallel pool: "do not start me until these controls
    // have finished". Real ids only, no self-reference — a dependency on a control that does not
    // exist is a barrier that can never be satisfied. Cycles are rejected below, across the whole
    // catalog, because a cycle is not visible from one entry.
    if (c.depends_on !== undefined) {
      if (!(Array.isArray(c.depends_on) && c.depends_on.every((d) => typeof d === 'string' && d.trim()))) {
        findings.push(`${id}: depends_on must be an array of control_ids`);
      } else if (c.depends_on.includes(id)) {
        findings.push(`${id}: depends_on names itself`);
      }
    }
    // gate_family (W1) binds a control to the compiler family it implements, so the runner can
    // make a plan-required control unskippable. The vocabulary is the compiler's plan families.
    if (c.gate_family !== undefined && !GATE_FAMILIES.has(c.gate_family)) {
      findings.push(`${id}: gate_family must be one of ${[...GATE_FAMILIES].join('|')} (got ${JSON.stringify(c.gate_family)})`);
    }

    // Any referenced file must actually exist — a catalog may not cite ghosts.
    for (const field of ['mechanism_ref', 'test_ref', 'doc_ref']) {
      const ref = c[field];
      if (typeof ref === 'string' && ref.trim() && !exists(ref)) {
        findings.push(`${id}: ${field} ${ref} does not exist — the catalog cites a ghost`);
      }
    }
  }
  // depends_on, catalog-wide (rc.40): every edge must resolve to a real control, and the graph
  // must be acyclic. The runner refuses to execute a cycle rather than flatten it, so a cycle
  // here is a build that cannot run — caught at the catalog, where it is fixable.
  const byId = new Map(controls.filter((c) => c && c.control_id).map((c) => [c.control_id, c]));
  for (const c of controls) {
    if (!c || !Array.isArray(c.depends_on)) continue;
    for (const dep of c.depends_on) {
      if (typeof dep === 'string' && dep.trim() && !byId.has(dep)) {
        findings.push(`${c.control_id}: depends_on ${dep} — no such control_id in the catalog`);
      }
    }
  }
  const state = new Map(); // id → 0 unvisited, 1 on stack, 2 done
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { findings.push(`depends_on cycle: ${[...trail, id].join(' → ')}`); return; }
    state.set(id, 1);
    for (const dep of byId.get(id)?.depends_on || []) if (byId.has(dep)) visit(dep, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return findings;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = CATALOG_LOCATIONS.map((p) => `${process.cwd()}/${p}`).find(existsSync);
  let findings;
  if (!path) findings = [`no control catalog found (looked in ${CATALOG_LOCATIONS.join(', ')}) — there is no control state of record`];
  else {
    try { findings = evaluate(JSON.parse(readFileSync(path, 'utf8'))); }
    catch (e) { findings = [`control catalog is not valid JSON: ${e.message}`]; }
  }
  if (findings.length) {
    process.stderr.write('\nControl-catalog gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe catalog is the control state of record: every state needs its receipts, and no\ncited mechanism, test, or document may be missing. See ../loom/references/bank-grade-gap.md.\n');
    process.exit(1);
  }
  process.stdout.write('Control-catalog gate — OK\n');
}
