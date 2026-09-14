// The decision-log gate (Loom 2.0 §10 — deferred from 1.12, delivered at 2.0-rc). The agent
// IS a model; an examiner asks "what did it do, and why?" A log that can be edited after the
// fact answers nothing. This gate validates the replayable decision log at
// docs/governance/decision-log.json:
//
//   an APPEND-ONLY hash chain (each entry seals sha256(prev | canonical-entry), so editing,
//   reordering, or dropping an entry breaks the chain) ·
//   contiguous sequence numbers (no silent gaps — a missing decision is itself a finding) ·
//   every entry reconstructable: an actor resolving to an AGENT identity, the decision, a
//   rationale, the inputs it saw (inputs_ref), the tools it used (tool_calls), a timestamp.
//
// Capture (writing entries as the agent works) is the adopter's harness wiring; this gate
// enforces that whatever is captured is intact, contiguous, and replayable. Run from the
// repo root: `node scripts/decision-log-check.mjs`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { aggregateRequirements, requiredBy } from '../core/compiled-requirements.mjs';
import { pathToFileURL } from 'node:url';

export const LOG_LOCATIONS = ['docs/governance/decision-log.json', 'decision-log.json'];
const GENESIS = 'GENESIS';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** The seal for one entry chained onto `prev`: hash of the ordered payload fields.
 *  The fields are JSON-encoded as an array, NOT "\n".join()'d: `decision` and `rationale` are
 *  free text that can contain newlines, and a plain join let text move across a field boundary
 *  (decision:"A\nB", rationale:"" ⇄ decision:"A", rationale:"B") for an IDENTICAL seal. JSON
 *  encoding makes every field boundary explicit, so a boundary shuffle changes the hash. */
export function sealOf(prev, e) {
  const payload = JSON.stringify([prev, e.seq, e.at, e.actor, e.change_id, e.decision, e.rationale,
    e.inputs_ref, e.tool_calls || []]);
  return sha256(payload);
}

/** Fill prev + seal across raw entries → a valid chain (helper for adopters and tests). */
export function buildChain(rawEntries) {
  let prev = GENESIS;
  return rawEntries.map((e) => {
    const seal = sealOf(prev, e);
    const out = { ...e, prev, seal };
    prev = seal;
    return out;
  });
}

/** Findings for the decision log. `registry` resolves actors to agent identities. */
export function evaluate(log, { registry } = {}) {
  const entries = log?.entries;
  if (!Array.isArray(entries)) return ['decision log has no `entries` array'];
  if (entries.length === 0) return []; // an empty log is valid before the agent has acted

  const findings = [];
  let prev = GENESIS;
  entries.forEach((e, i) => {
    const id = `entry ${e.seq ?? i}`;
    if (e.seq !== i) findings.push(`${id}: sequence gap — expected seq ${i} (a missing decision is a finding, not a convenience)`);
    const expect = sealOf(prev, e);
    if (e.prev !== prev) findings.push(`${id}: broken chain — prev ${JSON.stringify(e.prev)} ≠ expected ${JSON.stringify(prev)}`);
    if (e.seal !== expect) findings.push(`${id}: seal mismatch — the entry was altered after logging, or the chain was reordered`);
    for (const f of ['at', 'decision', 'rationale', 'inputs_ref']) {
      if (!(typeof e[f] === 'string' && e[f].trim())) findings.push(`${id}: no ${f} — an entry that cannot be reconstructed is not a record`);
    }
    if (!Array.isArray(e.tool_calls)) findings.push(`${id}: tool_calls must be an array (what the agent DID, not just decided)`);
    if (registry) {
      const who = identityOf(registry, e.actor);
      if (!who) findings.push(`${id}: actor ${JSON.stringify(e.actor)} is not a registry identity`);
      else if (who.kind !== 'agent') findings.push(`${id}: actor ${e.actor} is not an agent — the decision log records the AGENT's reasoning`);
    } else if (!e.actor) findings.push(`${id}: no actor`);
    prev = expect; // continue from the recomputed seal so errors localise
  });
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function run(cwd = process.cwd()) {
  const path = LOG_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) {
    // Absence is OK — unless a compiled plan requires a decision log (W1, closes F3).
    const agg = aggregateRequirements(cwd);
    if (agg.families.has('decision-log')) {
      return [`no decision log, but a compiled plan requires one [${requiredBy(agg, 'decision-log').join(', ')}] — a model-involved change must record its reasoning`];
    }
    return []; // capture is the adopter's harness wiring
  }
  const log = readJson(path);
  if (!log) return [`decision log is not parseable JSON`];
  return evaluate(log, { registry: loadRegistry(cwd) });
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = run();
  if (findings.length) {
    process.stderr.write('\nDecision-log gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe decision log is an append-only, contiguous, replayable chain of what the agent\ndid and why. See ../loom/references/model-risk.md.\n');
    process.exit(1);
  }
  process.stdout.write('Decision-log gate — OK\n');
}
