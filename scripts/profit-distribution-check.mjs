// The profit-distribution gate (Shari'ah workstream) — the DEPOSIT-side twin of purification.
//
// On the financing side a structure defect makes a customer PAY something they should not. On the
// deposit side it makes an investment accountholder RECEIVE something they were not entitled to —
// or not receive something they were — and there is no contract term anyone can inspect afterwards,
// only a periodic calculation nobody outside the bank can see. Consumer-protection rules put the
// Shari'ah committee over that calculation for exactly this reason, and this gate holds the RECORD
// of each distribution run to the shape those rules assume.
//
// RETURNS ON THESE STRUCTURES ARE EXPECTED, NEVER GUARANTEED. An accountholder under a Mudarabah or
// Wakala arrangement shares in actual profit; they are not owed a rate. `expected_rate` and
// `distributed_rate` are therefore two DIFFERENT things and this gate keeps them apart on purpose.
// It never asks the distributed rate to reach the expected one — a gate that did would be demanding
// a guaranteed return on a deposit, which is the one thing the whole structure exists not to be.
// What it asks is that a DIVERGENCE was disclosed, because an expectation was set with a customer.
//
// WHAT THIS GATE DOES NOT DO, stated first so nothing downstream reads it as more than it is:
//
//   · It checks the GOVERNANCE RECORD of a distribution run — not the arithmetic. It does not read
//     your ledger, cannot recompute an allocation, cannot verify a weightage table, and cannot tell
//     an approved smoothing from a managed one. It is not an accounting system.
//   · It reads JSON records. It never watches production. A period with no recorded run is
//     UNCOVERED here, not clean — and this gate cannot tell you a quarter went unrecorded, because
//     a missing quarter looks exactly like an institution that has not started.
//   · IT RULES ON NO SHARI'AH QUESTION, and no agent authors or approves a Shari'ah determination.
//     It verifies composition, provenance and binding against structures scholars ALREADY approved.
//     Scholars decide Shari'ah. A movement is "approved" here because a committee reference is
//     recorded against it, never because this file judged it permissible.
//
// THE RULES, and the defect each one exists to prevent:
//
//   PD-R01  a run with no run_id / pool_id, or a file whose name disagrees with the id inside it.
//           Runs are keyed by POOL, not product: several products draw on one pool and one product
//           can span pools, so the pool is the unit that has to reconcile.
//   PD-R02  a period that does not open before it closes — every rate below it is then meaningless.
//   PD-R03  no allocation_basis. Two banks with the same reserves and different bases produce
//           different, equally lawful numbers, so the basis cannot be inferred and must not be.
//   PD-R04  mudarib_share absent or outside 0..1. The manager's share is a DISCLOSED TERM of the
//           contract, not an implicit residual left over after the accountholders are paid.
//   PD-R05  A RESERVE MOVEMENT WITH NO issc_approval_ref. This is the heart of the gate. A Profit
//           Equalisation Reserve or Investment Risk Reserve movement takes profit from one period's
//           accountholders and pays it to another's — displaced commercial risk made operational,
//           redistributing between cohorts of real customers who never agreed to subsidise each
//           other. The reserves are legitimate, approved instruments; the defect is a movement made
//           WITHOUT the committee, or made to hit a number. A movement is recorded when it happened,
//           so an unapproved one is money already moved — which is why `draft` earns no exemption.
//   PD-R06  a movement naming something other than PER|IRR, a direction other than to|from, or a
//           non-positive amount. A direction-less movement cannot be read either way round.
//   PD-R07  a material divergence between the expected and distributed rate with no
//           iah_disclosure_evidence_ref. The accountholder was told an expected rate; a divergence
//           carries a disclosure duty, discharged by what reached the customer.
//   PD-R08  approved_by that does not resolve to a non-agent human holding `shariah-compliance` or
//           `shariah-committee` — and, where the approval is claimed as the COMMITTEE's, fewer
//           distinct committee holders than the registry quorum. The ISSC is a body: one member's
//           name is one member's opinion, and reading it as the committee's is the whole failure.
//   PD-R09  MANDATORY-WHEN-COMPILED. Silent for a repository with no records and no compiled plan
//           requiring `shariah_governance` — a conventional adopter must never fail because of a
//           Shari'ah control. The moment a plan requires it, an empty register is a finding naming
//           the change that made it mandatory.
//   PD-R10  two records of one run_id — one of them is a fiction and nobody can say which.
//   PD-R11  a rate_divergence_threshold RAISED above the shipped default. The threshold may be
//           TIGHTENED (more disclosure) and never loosened, the same direction-of-travel rule the
//           exception policy's concentration limit uses.
//   PD-R12  a status outside draft|approved|distributed. Approved and distributed are kept apart
//           because the gap between them is where a late adjustment lands.
//   PD-R13  an SR-* citation that resolves to no ruling in the rulings register — a citation of a
//           ghost. Only checked when the register is present and the reference LOOKS like a ruling
//           id; a minute reference is a pointer a human follows, and this gate says so instead of
//           pretending to have followed it. With NO register mounted the check cannot run, and the
//           citation is reported NOT VERIFIED rather than passed in silence: a check that is off
//           and says nothing is indistinguishable from a check that ran and was satisfied.
//
// THE THRESHOLD IS A HARNESS DEFAULT AND CARRIES NO REGULATORY AUTHORITY. 10% RELATIVE divergence
// is a starting number, not a standard: relative, so it is unit-agnostic (a rate written 0.0375 and
// one written 3.75% compare identically), and configurable downward in the register so an
// institution can adopt its committee's own materiality definition. Replace it with theirs.
//
// Lane: pr. Run from the repo root: `node scripts/profit-distribution-check.mjs` (exit 1 on a finding).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { identityOf, loadRegistry, quorumFor } from './identity-registry-check.mjs';

export const CAPABILITY = 'shariah_governance';
// One run per file under the directory; the single-file register is the shipped template's mount
// point. Both are read, because an institution that starts with the register and grows into
// per-run files must not silently stop being checked at the moment it splits the file.
export const RUNS_DIR = 'docs/governance/profit-distribution';
export const REGISTER_LOCATIONS = ['docs/governance/profit-distribution.json', 'profit-distribution.json'];
export const RULINGS_LOCATIONS = ['docs/governance/shariah-rulings.json', 'shariah-rulings.json'];

export const RESERVES = ['PER', 'IRR'];
export const DIRECTIONS = ['to', 'from'];
export const STATUSES = ['draft', 'approved', 'distributed'];
export const APPROVER_ROLES = ['shariah-compliance', 'shariah-committee'];
/** Relative divergence at or above which a disclosure reference is owed. A default, not a standard. */
export const DEFAULT_DIVERGENCE_THRESHOLD = 0.10;

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const firstPath = (locs, cwd) => locs.map((p) => join(cwd, p)).find(existsSync) || null;

/** An untouched template field. A shipped template must not read as a distribution that happened. */
export const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
/** Present and actually filled in. */
const given = (v) => (typeof v === 'number' ? Number.isFinite(v) : nonEmpty(v)) && !isPlaceholder(v);

/** A finite number from a number or a numeric string, else null. Amounts are never inferred. */
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (!nonEmpty(v)) return null;
  const n = Number(String(v).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A rate as `{ value, unit }`, where unit is 'percent' for "3.75%" and 'bare' for 3.75 or "0.0375".
 * The unit is carried rather than normalised because the harness cannot know which convention your
 * finance function writes in — and comparing a percent against a fraction silently understates a
 * divergence by two orders of magnitude, which is a wrong ANSWER rather than a missing one.
 */
export function parseRate(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, unit: 'bare' } : null;
  if (!nonEmpty(v)) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(%?)$/.exec(String(v).trim());
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] ? 'percent' : 'bare' };
}

/**
 * Relative divergence |distributed − expected| / |expected|, or Infinity where an expectation of
 * zero was not met. Relative so the comparison is unit-agnostic; the units are checked separately.
 */
export function divergence(expected, distributed) {
  if (expected === 0) return distributed === 0 ? 0 : Infinity;
  return Math.abs(distributed - expected) / Math.abs(expected);
}

/** Change ids whose compiled plan requires `capability` — so a finding can name WHO made it mandatory. */
export function changesRequiring(agg, capability = CAPABILITY) {
  return (agg?.changes || []).filter((c) => c.capabilities?.[capability]?.required).map((c) => c.change_id);
}

/**
 * Findings + notices for ONE distribution run.
 *
 * `registry` resolves approvers; `rulingIds` is the rulings register's id set, or `null` when there
 * is NO register to resolve against — in which case an SR-* citation is reported NOT VERIFIED
 * rather than passed quietly, exactly as the purification gate reports an unresolvable signal_id.
 * Unverified is a different thing from verified-good and this gate never claims the second. A
 * register that is present but empty is a register: every SR-* citation then resolves to nothing,
 * which is PD-R13. `file` is the record's filename where there is one; `threshold` is the relative
 * divergence at which a disclosure reference becomes due.
 *
 * An entirely untouched template row returns `{ counted: false }` and no findings: a fresh adoption
 * has not made a bad record, it has made no record. PD-R09 is what makes that silence temporary.
 */
export function evaluate(r, { registry = null, rulingIds = null, file = null, threshold = DEFAULT_DIVERGENCE_THRESHOLD } = {}) {
  const findings = [];
  const notices = [];
  const core = [r?.run_id, r?.pool_id, r?.period_start, r?.period_end, r?.allocation_basis, r?.mudarib_share, r?.approved_by];
  if (core.every(isPlaceholder)) return { findings, notices, counted: false, run_id: null };

  const id = given(r?.run_id) ? String(r.run_id) : null;
  const label = id || (file ? `${file} (no run_id)` : '(no run_id)');

  // PD-R01 — identity. A run nobody can name cannot be superseded, restated, or cited.
  if (!id) findings.push(`PD-R01: ${label}: no run_id — a distribution run that cannot be named cannot be cited, restated or superseded`);
  else if (file && basename(file).replace(/\.json$/i, '') !== id) {
    findings.push(`PD-R01: ${label}: the file is named ${JSON.stringify(basename(file))} but the record inside it is ${JSON.stringify(id)} — two names for one run is how the wrong record gets cited`);
  }
  if (!given(r?.pool_id)) {
    findings.push(`PD-R01: ${label}: no pool_id — allocation is computed per investment POOL, not per product, so the pool is the unit that has to reconcile. A run keyed by nothing cannot be`);
  }

  // PD-R02 — the period. Every rate in the record is a rate over this window.
  const start = Date.parse(r?.period_start);
  const end = Date.parse(r?.period_end);
  if (!given(r?.period_start) || Number.isNaN(start)) findings.push(`PD-R02: ${label}: period_start ${JSON.stringify(r?.period_start)} is not an RFC 3339 date`);
  if (!given(r?.period_end) || Number.isNaN(end)) findings.push(`PD-R02: ${label}: period_end ${JSON.stringify(r?.period_end)} is not an RFC 3339 date`);
  if (!Number.isNaN(start) && !Number.isNaN(end) && !(start < end)) {
    findings.push(`PD-R02: ${label}: the profit period does not open before it closes (${r.period_start} → ${r.period_end}) — every rate computed over it is meaningless`);
  }

  // PD-R03 — the basis. Not inferable, and the harness must not pretend otherwise.
  if (!given(r?.allocation_basis)) {
    findings.push(`PD-R03: ${label}: no allocation_basis — the weightages applied, and where PER and IRR sit relative to the mudarib's share, are a committee-approved decision. Two banks with the same reserves and different bases produce different, equally lawful numbers, so this cannot be inferred`);
  }

  // PD-R04 — the manager's share is a disclosed term, not the remainder.
  if (!given(r?.mudarib_share)) {
    findings.push(`PD-R04: ${label}: no mudarib_share — the manager's share is a DISCLOSED TERM of the contract, and leaving it out makes it an implicit residual: whatever was left after the accountholders were paid`);
  } else {
    const share = parseRate(r.mudarib_share);
    const ratio = share === null ? null : (share.unit === 'percent' ? share.value / 100 : share.value);
    if (ratio === null) findings.push(`PD-R04: ${label}: mudarib_share ${JSON.stringify(r.mudarib_share)} is not a rate or ratio`);
    else if (!(ratio >= 0 && ratio <= 1)) {
      findings.push(`PD-R04: ${label}: mudarib_share resolves to ${ratio}, outside 0..1 — a share of the profit cannot exceed all of it or fall below none of it (write 0.3, or "30%")`);
    }
  }

  // PD-R05 / PD-R06 / PD-R13 — the reserves. The heart of the gate.
  const movements = r?.per_reserve_movements;
  if (movements !== undefined && !Array.isArray(movements)) {
    findings.push(`PD-R06: ${label}: per_reserve_movements must be an ARRAY of movements`);
  } else {
    for (const [i, m] of (Array.isArray(movements) ? movements : []).entries()) {
      const where = `${label}: per_reserve_movements[${i}]`;
      if (!m || typeof m !== 'object' || Array.isArray(m)) { findings.push(`PD-R06: ${where} is not a movement object`); continue; }
      if (!RESERVES.includes(m.reserve)) findings.push(`PD-R06: ${where}: reserve must be ${RESERVES.join(' | ')} (got ${JSON.stringify(m.reserve)}) — PER smooths the distributed rate, IRR absorbs loss, and they sit on different sides of the mudarib's share`);
      if (!DIRECTIONS.includes(m.direction)) findings.push(`PD-R06: ${where}: direction must be ${DIRECTIONS.join(' | ')} (got ${JSON.stringify(m.direction)}) — a movement with no direction can be read either way round, and the two readings are opposite transfers between cohorts`);
      const amount = parseAmount(m.amount);
      if (amount === null) findings.push(`PD-R06: ${where}: amount ${JSON.stringify(m.amount)} is not a number`);
      else if (!(amount > 0)) findings.push(`PD-R06: ${where}: amount ${amount} is not positive — direction carries the sign, so a zero or negative amount is either a no-op recorded as a movement or a direction written twice`);

      // PD-R05 — the movement's OWN approval. A standing policy reference is the absence of
      // oversight written as its presence, which is why this is per-movement and not per-run.
      if (!given(m.issc_approval_ref)) {
        findings.push(`PD-R05: ${where}: no issc_approval_ref — a ${m?.reserve || 'reserve'} movement without a recorded committee approval is the defect this register exists to surface. Smoothing moves profit between cohorts of real customers; unapproved, it is displaced commercial risk nobody signed for. A movement is recorded when it happened, so this is money already moved`);
      } else if (!/^SR-/i.test(String(m.issc_approval_ref).trim())) {
        notices.push(`${where}: issc_approval_ref ${JSON.stringify(m.issc_approval_ref)} is not an SR-* ruling id, so it is NOT RESOLVED here — a minute reference is a pointer a human follows, and this gate has not followed it`);
      } else if (rulingIds === null) {
        // No register mounted. The citation is UNRESOLVED, and saying nothing here would let an
        // approval reference that resolves to nothing read exactly like one that resolves.
        notices.push(`${where}: issc_approval_ref ${JSON.stringify(m.issc_approval_ref)} NOT VERIFIED — no rulings register here to resolve it against, so this gate has not checked that the ruling it names exists`);
      } else if (!rulingIds.has(String(m.issc_approval_ref).trim())) {
        findings.push(`PD-R13: ${where}: issc_approval_ref ${JSON.stringify(m.issc_approval_ref)} resolves to no ruling in the rulings register — a citation of a ghost`);
      }
    }
  }

  // PD-R07 — the disclosure duty that attaches to a divergence, never to the divergence's size.
  const expected = parseRate(r?.expected_rate);
  const distributed = parseRate(r?.distributed_rate);
  if (!given(r?.expected_rate) || expected === null) {
    findings.push(`PD-R07: ${label}: expected_rate ${JSON.stringify(r?.expected_rate)} is not a rate — accountholders were given an indication, and without it here nothing can say whether what they were paid diverged from it`);
  }
  if (!given(r?.distributed_rate) || distributed === null) {
    findings.push(`PD-R07: ${label}: distributed_rate ${JSON.stringify(r?.distributed_rate)} is not a rate`);
  }
  if (expected && distributed) {
    if (expected.unit !== distributed.unit) {
      findings.push(`PD-R07: ${label}: expected_rate is written as a ${expected.unit} and distributed_rate as a ${distributed.unit} — comparing them would understate the divergence by two orders of magnitude, so the comparison is refused rather than guessed`);
    } else {
      const d = divergence(expected.value, distributed.value);
      if (d >= threshold && !given(r?.iah_disclosure_evidence_ref)) {
        const pct = Number.isFinite(d) ? `${(d * 100).toFixed(1)}%` : 'an expectation of zero that was not met';
        findings.push(`PD-R07: ${label}: distributed_rate diverges from expected_rate by ${pct} (threshold ${(threshold * 100).toFixed(1)}%) and there is no iah_disclosure_evidence_ref — the divergence itself is lawful, since a return here is EXPECTED and never guaranteed; what is owed is telling the accountholders. The obligation is discharged by what reached the customer, not by what was calculated`);
      }
      if (d === 0 && Array.isArray(movements) && movements.length > 0) {
        notices.push(`${label}: the distributed rate exactly met the expected rate while ${movements.length} reserve movement(s) were made — the reserves are doing the work. That may be entirely approved; it should be VISIBLE rather than smooth`);
      }
    }
  }

  // PD-R08 — who approved the run. A body, not a name.
  const raw = r?.approved_by;
  const approvers = (Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw])).filter((v) => !isPlaceholder(v));
  if (approvers.length === 0) {
    findings.push(`PD-R08: ${label}: no approved_by — a distribution run nobody approved has already been paid to customers on somebody's unrecorded say-so`);
  } else {
    const seen = new Set();
    let committee = 0;
    for (const who of approvers) {
      if (!nonEmpty(who)) { findings.push(`PD-R08: ${label}: approved_by contains ${JSON.stringify(who)}, which is not an identity id`); continue; }
      if (seen.has(who)) { findings.push(`PD-R08: ${label}: ${who} appears twice in approved_by — one person signing twice is one signature`); continue; }
      seen.add(who);
      if (!registry) { findings.push(`PD-R08: ${label}: approver ${JSON.stringify(who)} cannot be resolved — no identity registry found, and an unresolvable approval does not count`); continue; }
      const identity = identityOf(registry, who);
      if (!identity) { findings.push(`PD-R08: ${label}: approver ${JSON.stringify(who)} is not in the identity registry — free text is not an approver`); continue; }
      if (identity.kind === 'agent') {
        findings.push(`PD-R08: ${label}: approver ${who} is an AGENT — agents prepare evidence and never approve, and no agent authors or approves a Shari'ah determination`);
        continue;
      }
      const roles = identity.roles || [];
      if (!APPROVER_ROLES.some((role) => roles.includes(role))) {
        findings.push(`PD-R08: ${label}: approver ${who} holds none of ${APPROVER_ROLES.join(' | ')} — this run's approval belongs to the Shari'ah second line or the committee, not to whoever computed it`);
        continue;
      }
      if (roles.includes('shariah-committee')) committee += 1;
    }
    if (committee > 0) {
      const k = quorumFor(registry, 'shariah-committee');
      if (committee < k) {
        findings.push(`PD-R08: ${label}: the run is approved by ${committee} committee member(s) but the registry quorum for shariah-committee is ${k} — the ISSC rules as a BODY, so one member's name is one member's opinion and reading it as the committee's is the failure itself`);
      }
    }
  }

  // PD-R12 — status. `approved` and `distributed` are kept apart on purpose.
  if (r?.status !== undefined && !STATUSES.includes(r.status)) {
    findings.push(`PD-R12: ${label}: status must be ${STATUSES.join(' | ')} (got ${JSON.stringify(r.status)})`);
  }
  if (r?.status === 'draft') {
    notices.push(`${label}: status is draft — recorded, not yet approved. A draft evidences nothing, and its reserve movements are still held to PD-R05 because a movement is recorded when it happened`);
  }

  return { findings, notices, counted: true, run_id: id };
}

/** Findings + notices across every run, plus the count of runs that are actually records. */
export function evaluateAll(runs, ctx = {}) {
  const findings = [];
  const notices = [];
  const seen = new Set();
  let count = 0;
  for (const { run: r, file } of runs) {
    const res = evaluate(r, { ...ctx, file });
    findings.push(...res.findings);
    notices.push(...res.notices);
    if (!res.counted) continue;
    count += 1;
    if (res.run_id) {
      if (seen.has(res.run_id)) findings.push(`PD-R10: ${res.run_id}: two records of one run — one of them is a fiction and the register cannot say which`);
      seen.add(res.run_id);
    }
  }
  return { findings, notices, count };
}

/**
 * Every run on disk, from the per-run directory and the single-file register alike, as
 * `[{ run, file }]`. A record present in both places is not deduplicated — PD-R10 reports it,
 * because two copies of one run is a defect and not a loading detail to be smoothed over.
 */
export function loadRuns(cwd = process.cwd()) {
  const out = [];
  const dir = join(cwd, RUNS_DIR);
  const findings = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const doc = readJson(join(dir, name));
      if (doc === null) { findings.push(`${RUNS_DIR}/${name}: not valid JSON`); continue; }
      if (Array.isArray(doc?.runs)) for (const r of doc.runs) out.push({ run: r, file: null });
      else out.push({ run: doc, file: `${RUNS_DIR}/${name}` });
    }
  }
  const registerPath = firstPath(REGISTER_LOCATIONS, cwd);
  if (registerPath) {
    const doc = readJson(registerPath);
    if (doc === null) findings.push(`${REGISTER_LOCATIONS[0]}: not valid JSON`);
    else for (const r of (Array.isArray(doc.runs) ? doc.runs : [])) out.push({ run: r, file: null });
  }
  return { runs: out, findings, registerPath, present: out.length > 0 || existsSync(dir) || Boolean(registerPath) };
}

/**
 * The configured divergence threshold. It may be TIGHTENED and never loosened: a lower number
 * demands disclosure more often, and letting an institution raise it would let the control be
 * turned off by editing one number in the file it polices.
 */
export function resolveThreshold(doc) {
  const v = doc?.rate_divergence_threshold;
  if (v === undefined || v === null) return { threshold: DEFAULT_DIVERGENCE_THRESHOLD, findings: [] };
  if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) {
    return { threshold: DEFAULT_DIVERGENCE_THRESHOLD, findings: [`PD-R11: rate_divergence_threshold ${JSON.stringify(v)} is not a positive relative fraction (0.10 = 10%)`] };
  }
  if (v > DEFAULT_DIVERGENCE_THRESHOLD) {
    return {
      threshold: DEFAULT_DIVERGENCE_THRESHOLD,
      findings: [`PD-R11: rate_divergence_threshold ${v} is looser than the shipped ${DEFAULT_DIVERGENCE_THRESHOLD} — this threshold may only ever be TIGHTENED. Raising it silently removes the disclosure duty from divergences that already happened`],
    };
  }
  return { threshold: v, findings: [] };
}

export function run(cwd = process.cwd()) {
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  const { runs, findings: loadFindings, registerPath, present } = loadRuns(cwd);

  // Silent for an adopter with no investment-accountholder book and nothing compiling one. A
  // conventional repository must never fail because of a Shari'ah control.
  if (!present && !required) return { inert: true, required, count: 0, findings: [], notices: [] };

  const { threshold, findings: thresholdFindings } = resolveThreshold(registerPath ? readJson(registerPath) : null);
  const rulingsPath = firstPath(RULINGS_LOCATIONS, cwd);
  // `null` where no register is mounted — NOT an empty Set. The two are different claims: an empty
  // register says every SR-* citation is a ghost; no register says this gate has not looked.
  const rulingIds = rulingsPath ? new Set((readJson(rulingsPath)?.rulings || []).map((x) => x?.ruling_id).filter(nonEmpty)) : null;
  const { findings, notices, count } = evaluateAll(runs, { registry: loadRegistry(cwd), rulingIds, threshold });
  const all = [...loadFindings, ...thresholdFindings, ...findings];

  // PD-R09 — mandatory-when-compiled, naming the change that made it so.
  if (required && count === 0) {
    const who = changesRequiring(agg).join(', ') || 'unknown change';
    all.push(`PD-R09: a compiled plan requires the ${CAPABILITY} capability [${who}] and no distribution run is recorded under ${RUNS_DIR}/ — profit distribution to investment accountholders is committee-overseen, and a book with no recorded run is uncovered here, not clean. If this institution takes no investment-accountholder deposits, say so in the change's plan rather than by leaving the register empty`);
  }
  return { inert: false, required, count, findings: all, notices };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { inert, required, count, findings, notices } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nProfit-distribution gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA return to an investment accountholder is EXPECTED, never guaranteed — and every reserve\nmovement that smooths one carries the committee\'s approval for THAT movement. This gate reads the\ngovernance record of a run, never its arithmetic, and rules on no Shari\'ah question: scholars do.\nSee governance/profit-distribution.template.json.\n');
    process.exit(1);
  }
  if (inert) {
    process.stdout.write(`Profit-distribution gate — inert (no runs recorded; no compiled plan requires ${CAPABILITY})\n`);
    process.exit(0);
  }
  process.stdout.write(`Profit-distribution gate — OK (${count} run${count === 1 ? '' : 's'} structure-conformant${required ? `, ${CAPABILITY} required by a compiled plan` : ''}${notices.length ? `, ${notices.length} notice(s)` : ''})\n`);
}
