// The assurance-cycle gate (Loom 2.0 §13 — deferred from 1.12, delivered at 2.0-rc).
// Continuous assurance is a six-step lifecycle — Watch → Assess → Check → Test → Evidence →
// Confirm — that re-runs on a schedule and on events. A cycle that leaves no record is a
// meeting, not a control. This gate validates each cycle record under
// docs/governance/assurance-cycles/<cycle-id>.json:
//
//   all six lifecycle steps present, each with a status ·
//   the SIGNED cycle record verifies against a registry issuer (the Confirm step is
//   authenticated human authority, not a checkbox) — signature over the record's canonical
//   hash, real ed25519 (core/attestations.mjs) ·
//   the unresolved-findings register is real: every finding has an owner (resolving to a
//   registry identity), a due date, and a status; an OVERDUE open finding blocks.
//
// The signer must be a HUMAN with second-line authority — an agent runs the cycle and
// prepares the record; a human confirms it. Run from the repo root:
// `node scripts/assurance-cycle-check.mjs`.
//
// rc.46 — STREAMS: one repo, more than one assurance cycle. An institution runs the standing
// control set on one cadence and a DOMAIN cycle on another, confirmed by a different body, over
// the same six steps. Before streams there was one global cadence and one signer rule, so a
// domain cycle either had to be the global cycle (wrong cadence, wrong confirmer) or live outside
// the harness entirely. A stream is NAMED IN THE CONFIG and DECLARED BY THE RECORD:
//
//   docs/governance/assurance-config.json
//   { "cadence_days": 30,
//     "streams": { "shariah": { "cadence_days": 90, "confirm_roles": ["shariah-committee"] } } }
//
//   docs/governance/assurance-cycles/AC-2026-Q3-SH.json  →  { "stream": "shariah", … }
//
// Two things follow, and nothing else does. The stream's own cadence applies to the newest record
// CARRYING that stream, so a busy global cycle can no longer stand in for a domain one that has
// not run. And `confirm_roles` role-locks step ⑥: `confirmed_by` must hold a listed role IN
// ADDITION to the existing signed / human / second-line rules — which is the mechanism by which
// steps ①–⑤ stay agent-preparable while Confirm becomes mechanically the committee's. The
// RATIFICATION of changes that took the conforming lane — those covered by an already-approved
// structure, where no fresh determination was sought — is recorded as exactly such a cycle: the
// accountable body confirms after the fact what the lane let through, and the signed record is
// the receipt that it did.
//
// A record declaring a stream the config does not define is a finding. A ghost stream has no
// cadence to be late against and no confirm roles to fail, so it would read as governed and
// enforce nothing. A record with NO stream keeps the global behaviour exactly: the global
// cadence, the second-line human, nothing more — so a repo that configures no streams is
// unaffected by all of this.
//
// Streams are GENERIC and this gate rules on nothing. `confirm_roles` decides WHO confirms and
// `cadence_days` decides HOW OFTEN; neither says a word about what was confirmed. In the Shari'ah
// case the committee's confirmation is the committee's — scholars decide Shari'ah, and the
// harness records that they did.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { aggregateRequirements, requiredBy } from '../core/compiled-requirements.mjs';
import { pathToFileURL } from 'node:url';

export const CYCLES_DIR = 'docs/governance/assurance-cycles';
export const STEPS = ['watch', 'assess', 'check', 'test', 'evidence', 'confirm'];
export const STEP_STATUSES = new Set(['pass', 'fail', 'n/a']);
const DAY = 24 * 60 * 60 * 1000;
// ADOPT: how often assurance must run once you are in production. Override via
// docs/governance/assurance-config.json { "cadence_days": N, "streams": { … } }.
export const DEFAULT_CADENCE_DAYS = 30;
const CONFIG_LOCATIONS = ['docs/governance/assurance-config.json', 'assurance-config.json'];
export function readConfig(cwd) {
  const p = CONFIG_LOCATIONS.map((x) => `${cwd}/${x}`).find(existsSync);
  if (!p) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

/** The configured streams (name → { cadence_days, confirm_roles }). Absent or malformed ⇒ none —
 *  a config that cannot be read as a map of streams configures no streams, and every record then
 *  falls back to the global behaviour rather than to an accidental one. */
export function streamsOf(config) {
  const s = config?.streams;
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

/** Deterministic serialization: keys sorted at EVERY level (not just the top). A flat
 *  key-allowlist replacer would silently drop nested fields — so a tamper deep in `steps`
 *  would not change the hash. This canonicaliser recurses, so the signature covers it all. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Canonical hash of a cycle record, excluding its own attestation. Deterministic. */
export function cycleHash(record) {
  const { attestation, ...rest } = record;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

/** Findings for one cycle record. `streams` (the configured streams) and `now` are injectable. */
export function evaluate(record, { issuers, registry, streams = {}, now = Date.now() } = {}) {
  const findings = [];
  const id = record?.cycle_id || '(no cycle_id)';
  if (!record?.cycle_id) findings.push('cycle record has no cycle_id');
  if (!(typeof record?.ran_at === 'string' && record.ran_at.trim())) findings.push(`${id}: no ran_at timestamp`);
  if (!['schedule', 'event'].includes(record?.trigger)) findings.push(`${id}: trigger must be schedule|event (got ${JSON.stringify(record?.trigger)})`);

  // The declared stream must be a CONFIGURED stream. A name the config does not define carries
  // no cadence and no confirm roles, so a record could name a body it never went to and pass.
  const name = record?.stream;
  let stream = null;
  if (name !== undefined && name !== null) {
    if (!(typeof name === 'string' && name.trim())) {
      findings.push(`${id}: stream must be a non-empty string (got ${JSON.stringify(name)})`);
    } else if (!Object.prototype.hasOwnProperty.call(streams, name)) {
      findings.push(`${id}: declares assurance stream ${JSON.stringify(name)}, which is not configured — add it to docs/governance/assurance-config.json "streams" (with its cadence_days and confirm_roles) or drop the field; an unconfigured stream is governance nobody set up`);
    } else {
      stream = streams[name];
    }
  }

  // Every lifecycle step present and RESOLVED — and a step's status is a status the gate
  // judges, not merely records (W3, closes F4). A structurally-valid `fail` is still a fail:
  //   fail → blocks, unless the step carries a second-line risk acceptance that is unexpired;
  //   n/a  → requires a rationale AND second-line approval ("not applicable" is a decision).
  const steps = record?.steps || {};
  for (const s of STEPS) {
    const step = steps[s];
    if (!step) { findings.push(`${id}: lifecycle step ${JSON.stringify(s)} is missing — an assurance cycle runs all six steps`); continue; }
    if (!STEP_STATUSES.has(step.status)) { findings.push(`${id}: step ${s} status must be pass|fail|n/a (got ${JSON.stringify(step.status)})`); continue; }
    if (step.status === 'fail') {
      const ra = step.risk_acceptance;
      if (!ra) findings.push(`${id}: step ${s} is FAIL with no risk acceptance — a failed assurance step blocks unless second-line risk-accepts it`);
      else {
        if (registry) {
          const who = identityOf(registry, ra.accepted_by);
          if (!who || who.kind === 'agent' || !(who.groups || []).includes('second-line')) {
            findings.push(`${id}: step ${s} risk acceptance accepted_by ${JSON.stringify(ra.accepted_by)} is not a second-line human`);
          }
        }
        if (!(typeof ra.rationale === 'string' && ra.rationale.trim())) findings.push(`${id}: step ${s} risk acceptance has no rationale`);
        if (!ra.expires || Number.isNaN(Date.parse(ra.expires))) findings.push(`${id}: step ${s} risk acceptance has no valid expiry`);
        else if (Date.parse(ra.expires) < now) findings.push(`${id}: step ${s} risk acceptance EXPIRED (${ra.expires}) — an expired acceptance does not cover a failed step`);
      }
    }
    if (step.status === 'n/a') {
      if (!(typeof step.rationale === 'string' && step.rationale.trim())) findings.push(`${id}: step ${s} is n/a with no rationale — "not applicable" is a decision someone accountable made`);
      if (registry) {
        const who = identityOf(registry, step.approved_by);
        if (!who || who.kind === 'agent' || !(who.groups || []).includes('second-line')) {
          findings.push(`${id}: step ${s} n/a is not second-line approved (approved_by ${JSON.stringify(step.approved_by)})`);
        }
      }
    }
  }

  // Unresolved-findings register: owned, dated, statused; overdue-open blocks.
  for (const f of record?.findings || []) {
    const label = `${id}: finding ${f.id || '(unnamed)'}`;
    if (registry && !identityOf(registry, f.owner)) findings.push(`${label} — owner ${JSON.stringify(f.owner)} is not a registry identity`);
    else if (!f.owner) findings.push(`${label} — no owner`);
    if (!f.due) findings.push(`${label} — no due date`);
    if (!['open', 'resolved', 'accepted'].includes(f.status)) findings.push(`${label} — status must be open|resolved|accepted (got ${JSON.stringify(f.status)})`);
    if (f.status === 'open' && f.due && !Number.isNaN(Date.parse(f.due)) && Date.parse(f.due) < now) {
      findings.push(`${label} — OPEN and overdue (${f.due}): an unresolved assurance finding past its due date blocks`);
    }
  }

  // The record is signed, verifies, and the signer is a second-line human (Confirm authority).
  const att = record?.attestation;
  if (!att) findings.push(`${id}: cycle record is unsigned — the Confirm step is authenticated authority, not a checkbox`);
  else {
    findings.push(...verifySignatureOver(cycleHash(record), att, issuers, `cycle ${id}`).map((f) => `${id}: ${f}`));
    if (registry) {
      const who = identityOf(registry, att.confirmed_by);
      if (!who || who.kind === 'agent' || !(who.groups || []).includes('second-line')) {
        findings.push(`${id}: confirmed_by ${JSON.stringify(att.confirmed_by)} is not a second-line human — an agent prepares the cycle, a human confirms it`);
      }
      // A stream may ROLE-LOCK the Confirm step on top of that. This is additive: the confirmer is
      // still a second-line human, and now also holds the role the stream's accountable body sits
      // in. Steps ①–⑤ remain agent-preparable; ⑥ cannot be.
      const need = (stream?.confirm_roles || []).filter((r) => typeof r === 'string' && r.trim());
      if (need.length && !(who?.roles || []).some((r) => need.includes(r))) {
        findings.push(`${id}: stream ${JSON.stringify(name)} requires the Confirm step to be held by one of [${need.join(', ')}]; confirmed_by ${JSON.stringify(att.confirmed_by)} holds none — an agent prepares the record, the accountable body confirms it`);
      }
    }
  }
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * A configured cadence bound: `{ days, ok }`. Absent (undefined/null) is `{ days: null, ok: true }`
 * — not configured, take the fallback. Anything else that is not a positive finite NUMBER is
 * `ok: false`, and that is the defect this exists against: `"monthly"` coerces to NaN, every
 * `age > NaN` is false, and the staleness check switches itself OFF for the one repository whose
 * config was wrong. A malformed cadence must fail loudly and still be POLICED by the fallback,
 * because the alternative is a control disabled by a typo in the file it polices.
 */
export function cadenceBound(v) {
  if (v === undefined || v === null) return { days: null, ok: true };
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? { days: v, ok: true } : { days: null, ok: false };
}

/**
 * Cadence findings: the global window, plus one per CONFIGURED stream. Pure and `now`-injectable
 * so the windows are testable without a clock.
 *
 * `newest` is the newest record of any kind (the global rule, unchanged: "assurance ran once" is
 * not "assurance is current"). `newestByStream` is the newest record CARRYING each stream — a
 * stream with no record at all is as stale as one that ran and then stopped, because a configured
 * stream that never runs is a cadence written down rather than kept.
 */
export function cadenceFindings({ config = {}, newest = 0, newestByStream = new Map(), now = Date.now() } = {}) {
  const findings = [];
  const g = cadenceBound(config?.cadence_days);
  if (!g.ok) {
    findings.push(`assurance-config cadence_days ${JSON.stringify(config.cadence_days)} is not a positive number of days — every staleness comparison against it is false, so a malformed cadence turns this check off rather than failing it. The ${DEFAULT_CADENCE_DAYS}d default is applied until it is a number`);
  }
  const globalDays = g.days ?? DEFAULT_CADENCE_DAYS;
  const ageDays = newest ? Math.floor((now - newest) / DAY) : Infinity;
  if (ageDays > globalDays) {
    findings.push(`newest assurance cycle is ${newest ? `${ageDays}d old` : 'undated'}, past the ${globalDays}d cadence while a change is in production — assurance is stale`);
  }
  for (const [name, cfg] of Object.entries(streamsOf(config))) {
    const c = cadenceBound(cfg?.cadence_days);
    if (!c.ok) {
      findings.push(`stream ${JSON.stringify(name)}: cadence_days ${JSON.stringify(cfg.cadence_days)} is not a positive number of days — the comparison against it is always false, which is this stream's staleness check silently disabled. The ${globalDays}d global cadence is applied until it is a number`);
    }
    const days = c.days ?? globalDays;
    const t = newestByStream.get(name) || 0;
    const age = t ? Math.floor((now - t) / DAY) : Infinity;
    if (age > days) {
      findings.push(`newest ${JSON.stringify(name)}-stream assurance cycle is ${t ? `${age}d old` : 'never run'}, past the ${days}d cadence while a change is in production — a stream that is not running assures nothing`);
    }
  }
  return findings;
}

export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${CYCLES_DIR}`;
  const agg = aggregateRequirements(cwd);
  if (!existsSync(dir)) {
    // Absence is OK — unless a compiled plan requires assurance cadence, or anything is in
    // production (mirrors silence-after-launch): assurance that never ran is not a pass (W1/W3).
    if (agg.families.has('assurance-cadence')) {
      return { findings: [`no assurance cycles, but a compiled plan requires assurance cadence [${requiredBy(agg, 'assurance-cadence').join(', ')}] — an unassured high-risk change cannot ship`], count: 0 };
    }
    if (agg.anyInProduction) {
      return { findings: ['no assurance cycles while a governed change is in production — silence is not assurance'], count: 0 };
    }
    return { findings: [], count: 0 };
  }
  const issuers = loadIssuers(cwd);
  const registry = loadRegistry(cwd);
  const config = readConfig(cwd);
  const streams = streamsOf(config);
  const findings = [];
  let newest = 0;
  const newestByStream = new Map();
  let count = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    count++;
    const record = readJson(`${dir}/${name}`);
    if (!record) { findings.push(`${name}: not parseable JSON`); continue; }
    const t = Date.parse(record.ran_at);
    if (!Number.isNaN(t)) {
      newest = Math.max(newest, t);
      const s = record.stream;
      if (typeof s === 'string' && s.trim()) newestByStream.set(s, Math.max(newestByStream.get(s) || 0, t));
    }
    findings.push(...evaluate(record, { issuers, registry, streams }));
  }
  // Cadence (W3): once anything is in production, the newest cycle must be within the cadence
  // window — "assurance ran once" is not "assurance is current". Per stream as well as globally
  // (rc.46): a stream's own window is judged against records carrying that stream, so the global
  // cycle running weekly cannot cover for a domain stream that stopped.
  if (agg.anyInProduction) findings.push(...cadenceFindings({ config, newest, newestByStream }));
  return { findings, count };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, count } = run();
  if (findings.length) {
    process.stderr.write('\nAssurance-cycle gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEach assurance cycle produces a signed record with an unresolved-findings register;\nan agent prepares it, a second-line human confirms it. See ../loom/references/continuous-assurance.md.\n');
    process.exit(1);
  }
  process.stdout.write(`Assurance-cycle gate — OK (${count} cycle${count === 1 ? '' : 's'})\n`);
}
