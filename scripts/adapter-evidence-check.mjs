// The adapter-evidence gate (Factory Floor WS5 · D5.3). The four evidence streams, one control each,
// and the arithmetic that keeps them separate.
//
//   node scripts/adapter-evidence-check.mjs
//
// WHAT THE THREE ADAPTER-FACING GATES EACH DO, because three gates reading one directory needs to be
// legible or it becomes one gate with three names:
//
//   scripts/adapter-check.mjs             is the adapter WELL-FORMEDNESS gate. Does the declaration
//                                         have the required fields, does `satisfies_control` resolve
//                                         to a real catalog control, are the ids unique. It reports
//                                         "declared, not active" as an honest NOTICE and never fails
//                                         on it. Nothing here repeats any of that.
//   scripts/platform-activation-check.mjs is the FORGE OBSERVATION gate and the verifier of record for
//                                         every forge mechanism. Two of D5.3's four streams delegate
//                                         to it wholesale. This gate does not re-verify what it
//                                         verifies; it asks it, and reports the binding.
//   this gate                             is the EVIDENCE-BINDING gate. It answers the question F4
//                                         found nobody was asking: does this piece of evidence belong
//                                         to the control it is being counted for, and is the stream
//                                         it belongs to actually active or merely declared?
//
// THE ONE THING IT ADDS, IN ONE SENTENCE. Before D5.3 an adapter could be declared for one control,
// carry an `activation_evidence` block someone had filled in by hand, and read as a live integration
// to every human and every scorecard that looked at it — while the only real probe in the repository
// had tested a completely different mechanism. This gate makes that arrangement fail.
//
// SILENT WHERE UNADOPTED, and this matters more here than almost anywhere else in the harness, because
// most adopters will never mount a collaboration-surface adapter at all. A repository with no adapters
// is a clean no-op: no findings, no notices, exit 0, one line saying so. A repository with adapters
// but no evidence reports every stream as DECLARED, NOT ACTIVE and still exits 0 — that is the honest
// resting state of a wired seam, not a defect, and failing the build on it would teach adopters to
// delete their adapters to get green. The build fails only on a LIE: a stream asserting activation
// nobody observed, evidence borrowed between streams, two adapters sharing a control, a broken
// observation, or a compiled plan whose requirement is unmet.
//
// PRINTED ON GREEN RUNS TOO. Every stream's badge is printed whether or not anything failed. G6's
// measure is that declared vs active is shown truthfully, and a state nobody prints is not shown.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import {
  CAPABILITY,
  activationRequired,
  activationStates,
  badge,
  checkCatalogClaims,
  checkCompiledRequirement,
  satisfiedControls,
} from '../core/floor-adapters.mjs';
import { ADAPTERS_DIR } from './adapter-check.mjs';
import {
  ACTIVATION_DIR,
  MECHANISMS as FORGE_MECHANISMS,
  evaluate as evaluateForgeObservation,
} from './platform-activation-check.mjs';

/** Where a seam observer commits its evidence. One file per observation; never rewritten. */
export const EVIDENCE_DIR = 'docs/governance/adapter-evidence';
export const CHANGES_DIR = 'docs/governance/changes';
const CATALOG_LOCATIONS = ['docs/governance/control-catalog.json', 'control-catalog.json'];
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const findFile = (cwd, locs) => locs.map((p) => `${cwd}/${p}`).find(existsSync) || null;
const jsonFiles = (dir) => (existsSync(dir) && statSync(dir).isDirectory()
  ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
  : []);

/** Every mounted adapter declaration: [{ label, adapter }]. */
export function loadAdapters(cwd = process.cwd()) {
  const dir = `${cwd}/${ADAPTERS_DIR}`;
  return jsonFiles(dir).map((name) => ({ label: name, adapter: readJson(`${dir}/${name}`) }));
}

/**
 * Every committed seam observation: [{ label, record }]. A file may hold one record or
 * `{ records: [...] }` — an observer that batches one sweep into one commit is doing the right thing,
 * as long as it never rewrites a file it has already written. The instant an observation was made is
 * what decides freshness, and overwriting it would move that instant forward for free.
 */
export function loadEvidence(cwd = process.cwd()) {
  const dir = `${cwd}/${EVIDENCE_DIR}`;
  const out = [];
  for (const name of jsonFiles(dir)) {
    const body = readJson(`${dir}/${name}`);
    if (Array.isArray(body?.records)) body.records.forEach((r, i) => out.push({ label: `${name}[${i}]`, record: r }));
    else out.push({ label: name, record: body });
  }
  return out;
}

/**
 * The forge observations that PASSED their own gate, reduced to the binding facts this gate needs.
 * Verification is not repeated: `platform-activation-check.mjs` is the verifier of record for forge
 * mechanisms, its findings are its own to report, and a record that failed there contributes nothing
 * here — it simply is not in the list, so the delegating stream stays `declared`.
 */
export function loadDelegations(cwd = process.cwd(), { now = Date.now() } = {}) {
  const dir = ACTIVATION_DIR.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!dir) return [];
  const issuers = loadIssuers(cwd) || loadIssuers(`${cwd}/..`);
  const idPath = findFile(cwd, IDENTITY_LOCATIONS);
  const registry = idPath ? readJson(idPath) : null;
  const out = [];
  for (const name of jsonFiles(dir)) {
    const record = readJson(`${dir}/${name}`);
    if (!record) continue;
    if (evaluateForgeObservation(record, { issuers, registry, now }).length) continue;
    out.push({
      satisfies_control: record.satisfies_control,
      mechanism: record.mechanism,
      observed_at: record.observed_at,
      observer_identity: record.observer_identity,
    });
  }
  return out;
}

/** Changes whose compiled plan requires the streams to be ACTIVE, not merely declared. */
export function changesRequiringActivation(cwd = process.cwd()) {
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const envelope = readJson(`${dir}/${name}/change-envelope.json`);
    if (!envelope) continue;
    const plan = readJson(`${dir}/${name}/${envelope.control_plan || 'control-plan.json'}`);
    if (plan && activationRequired(plan)) out.push(name);
  }
  return out;
}

/**
 * The pure half. Everything is passed in, nothing is read, no clock is consulted unless one is
 * omitted — so the same inputs yield the same verdict on any machine on any future date, which is
 * what lets an auditor re-derive a past build's answer.
 *
 * `adapters` [{ label, adapter }] · `records` [{ label, record }] · `delegations` from the forge gate ·
 * `required` the change ids whose plans compile the capability.
 *
 * Returns `{ findings, notices, states, satisfied, … }`. `states` is always returned, including on a
 * clean run: declared-vs-active must be visible, not merely correct.
 */
export function evaluate({
  adapters = [],
  records = [],
  delegations = [],
  catalog = null,
  registry = null,
  issuers = null,
  required = [],
  now = Date.now(),
} = {}) {
  const findings = [];
  const notices = [];

  // A declaration that will not parse cannot be reasoned about. `adapter-check.mjs` already fails the
  // build on it, so this is a notice: two gates shouting the same sentence teaches people to skim.
  const parsed = [];
  for (const { label, adapter } of adapters) {
    if (!adapter || typeof adapter !== 'object') { notices.push(`${label}: not parseable as an adapter declaration (scripts/adapter-check.mjs owns that finding)`); continue; }
    parsed.push(adapter);
  }

  // UNADOPTED. No adapters at all is the common case and it is a clean no-op — except that a plan
  // compiling the capability with nothing to apply it to is a plan defect, not a pass. A requirement
  // with nowhere to land reads as satisfied, which is the silent pass this programme exists to refuse.
  if (!parsed.length) {
    return {
      findings: required.map((id) => `AD-R09: ${id}: the plan requires the ${CAPABILITY} capability but no adapter is mounted at ${ADAPTERS_DIR} — a requirement with nowhere to land is not a requirement met`),
      notices, states: [], satisfied: new Set(), adapters: 0, records: records.length, streams: 0, active: 0,
    };
  }

  const { states, findings: stateFindings } = activationStates({
    adapters: parsed,
    records,
    delegations,
    registry,
    issuers,
    verify: verifySignatureOver,
    delegatedMechanisms: FORGE_MECHANISMS,
    now,
  });
  findings.push(...stateFindings);
  findings.push(...checkCatalogClaims(catalog, states));
  findings.push(...checkCompiledRequirement(states, required));

  for (const s of states) {
    if (s.status === 'active') continue;
    // A pre-D5.3 adapter gets adapter-check's notice, not a second one from here.
    if (s.stream === false) continue;
    notices.push(`${s.adapter_id}: DECLARED, NOT ACTIVE — ${s.control ?? 'no control'} is not evidenced by this stream yet (a wired seam, never a green control)`);
  }

  return {
    findings,
    notices,
    states,
    satisfied: satisfiedControls(states),
    adapters: parsed.length,
    records: records.length,
    streams: states.filter((s) => s.stream !== false).length,
    active: states.filter((s) => s.status === 'active').length,
  };
}

export function run(cwd = process.cwd(), { now = Date.now() } = {}) {
  const catPath = findFile(cwd, CATALOG_LOCATIONS);
  const idPath = findFile(cwd, IDENTITY_LOCATIONS);
  return evaluate({
    adapters: loadAdapters(cwd),
    records: loadEvidence(cwd),
    delegations: loadDelegations(cwd, { now }),
    catalog: catPath ? readJson(catPath) : null,
    registry: idPath ? readJson(idPath) : null,
    issuers: loadIssuers(cwd) || loadIssuers(`${cwd}/..`),
    required: changesRequiringActivation(cwd),
    now,
  });
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, states, adapters, streams, active } = run();
  for (const s of states) process.stdout.write(`${badge(s)}\n`);
  if (findings.length) {
    process.stderr.write('\nAdapter-evidence gate (D5.3) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nOne adapter, one control, each. Finding F4 was one adapter carrying several\nclaims, so a single probe appeared to satisfy controls it had never been tested\nagainst. Evidence for one stream never counts for another, and a stream is ACTIVE\nonly on a fresh, independently-signed, fully bypass-tested observation of its own.\nEverything else is DECLARED, NOT ACTIVE — which is the honest resting state, not a\nfailure. See docs/notion-floor-plan.md §4 WS5 D5.3 and adapters/README.md.\n');
    process.exit(1);
  }
  if (!adapters) {
    process.stdout.write('Adapter-evidence gate (D5.3) — no adapters mounted (nothing declares an evidence stream)\n');
  } else {
    for (const n of notices) process.stdout.write(`  · ${n}\n`);
    const legacy = adapters - streams;
    process.stdout.write(`Adapter-evidence gate (D5.3) — OK (${streams} evidence stream${streams === 1 ? '' : 's'}: ${active} active, ${streams - active} declared${legacy ? `; ${legacy} pre-D5.3 adapter${legacy === 1 ? '' : 's'} outside the stream contract` : ''})\n`);
  }
}
