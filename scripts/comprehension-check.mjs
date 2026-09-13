// The comprehension gate (Loom 2.0-rc.15 · WS8; sampling added rc.41 · G5). Review is not
// understanding. When an agent writes the change, the institution can accrue COMPREHENSION DEBT —
// code that merged, that no human on the owning team can explain or safely modify without the
// original agent session. This gate makes a human-understanding control explicit: a change it
// selects cannot proceed without a comprehension record whose author is a named human who can
// explain it.
//
// Required for a selected change (docs/governance/changes/<id>/comprehension.json):
//   summary                 a human-authored change summary (not the agent's PR body)
//   critical_path           a walkthrough of the critical path
//   named_owner             a human (registry-resolved, non-agent) who can explain the change
//   challenge_questions     reviewer challenge questions (and their answers)
//   architecture_explanation, failure_modes   how it is built and how it fails
//   decision_log_replay_ref a pointer to the replayed agent decision log (WS6's log earns its reader)
//   metrics                 review time, complexity, % agent-generated, reviewer familiarity, … —
//                           REPORTED, never gated on their values (the objective is understanding,
//                           not throttling AI output)
//
// WHICH CHANGES ARE SELECTED — three bases, in this order:
//
//   tier               high/critical, as since rc.15. Unchanged, unconfigurable, and the floor.
//   always-capability  the change's compiled plan requires a capability the second line listed in
//                      `comprehension.always_comprehend_capabilities`. Tier-independent by design:
//                      the intended use is a domain-material surface (product structure, pricing)
//                      where a green gate over unread code is worth the least.
//   sampled            a MEDIUM-tier change the deterministic selector picks.
//
// THE DEFECT SAMPLING EXISTS TO PREVENT (G5). The review gate is the one resource that does not
// scale. At sustained agent throughput four-eyes decays into ceremony while every gate stays green,
// and an institution that keeps its routine flow at medium — which is exactly what a committee-
// cadence approval SLA encourages — accrues the debt precisely where all of its volume lives, in
// the one band this gate never looked at. Sampling puts a floor under that band without pretending
// every medium change can be read: some fraction of them must be, and which ones is not negotiable
// after the fact.
//
// The selector HASHES THE CHANGE ID (FNV-1a/32). Never `Math.random`: a sample that differs between
// two runs, or between the author's run and the reviewer's, is not a control — it is a coin the
// author can flip until it lands green, and nobody can reproduce a dispute about it.
//
// THE SECOND LINE OWNS THE RATE, and owns it out loud. `medium_sample_rate: 0` is a DECISION — the
// gate reports it as a notice on every run, because "we sample no medium change" is a position an
// institution may hold and must not hold invisibly. An ABSENT config is the other thing entirely:
// nothing is claimed, nothing is sampled, and the gate behaves exactly as it did before rc.41.
//
// Config: `comprehension` in docs/governance/approval-sla.json — the second-line-owned file that
// already states what the review resource is expected to deliver (targets, WIP limit). Sampling
// policy belongs beside the WIP limit because they are the same subject measured twice: how much
// human attention exists, and how much of the flow it is expected to actually reach.
//
//   "comprehension": {
//     "medium_sample_rate": 0.2,                      // 0..1, or omit
//     "every_nth": 5,                                 // positive integer, or omit
//     "always_comprehend_capabilities": ["..."]       // capability names, or omit
//   }
//
// Both selectors may be set; a change either one picks is sampled (union). The safe direction for a
// disagreement between two second-line settings is MORE comprehension, not less.
//
// WHAT THIS GATE CANNOT DO. It reads a JSON record. It cannot tell whether the human who wrote the
// record understood the change, and no gate can; it can only tell whether anybody was asked to try,
// and refuse the case where nobody was. Sampling makes the asking proportionate — it does not make
// the answer true.
//
// Lane: pr. Run from the repo root: `node scripts/comprehension-check.mjs`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { loadRegistry, identityOf } from './identity-registry-check.mjs';
import { loadSla } from './approval-status.mjs';
import { pathToFileURL } from 'node:url';

export const CHANGES_DIR = 'docs/governance/changes';
/** The policy block, inside the second-line-owned approval SLA file (see the header). */
export const POLICY_KEY = 'comprehension';
const HIGH_TIERS = new Set(['high', 'critical']);
const NARRATIVE = ['summary', 'critical_path', 'architecture_explanation', 'failure_modes'];
const METRICS = ['review_minutes', 'change_complexity', 'pct_agent_generated', 'reviewer_familiarity'];
const PLACEHOLDER = /ADOPT|TODO|TBD|\bxxx\b/i;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const filled = (v) => typeof v === 'string' && v.trim().length > 0 && !PLACEHOLDER.test(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * FNV-1a, 32-bit. The whole point is that it is boring and fixed: the same change id yields the
 * same number on every machine, in every run, for every reviewer, forever. Do not "improve" it —
 * changing the hash resamples the entire backlog and retroactively excuses changes that were
 * selected under the old one.
 */
export function hash32(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Why (if at all) this change id is sampled — an array of human-readable reasons, empty for not
 * sampled. Pure and total: no clock, no randomness, no filesystem.
 */
export function sampleReasons(changeId, policy = null) {
  const reasons = [];
  const h = hash32(changeId);
  const rate = policy?.medium_sample_rate;
  // fraction is in [0, 1) — a rate of 1 therefore selects everything, and a rate of 0 nothing.
  if (Number.isFinite(rate) && rate > 0 && h / 2 ** 32 < rate) reasons.push(`medium_sample_rate ${rate}`);
  const nth = policy?.every_nth;
  if (Number.isInteger(nth) && nth > 0 && h % nth === 0) reasons.push(`every_nth ${nth}`);
  return reasons;
}

/**
 * Does this change need a comprehension record, and on what BASIS? The basis travels into the
 * finding: "you were sampled" and "you are high tier" are different conversations, and a finding
 * that cannot say which one it is will be argued with rather than fixed.
 */
export function requirement(changeId, { tier = null, capabilities = {}, policy = null } = {}) {
  if (HIGH_TIERS.has(tier)) return { required: true, basis: 'tier', detail: String(tier) };
  const always = Array.isArray(policy?.always_comprehend_capabilities) ? policy.always_comprehend_capabilities : [];
  const hit = always.filter((c) => typeof c === 'string' && capabilities?.[c]?.required);
  if (hit.length) return { required: true, basis: 'always-capability', detail: hit.join(', ') };
  if (tier === 'medium') {
    const why = sampleReasons(changeId, policy);
    if (why.length) return { required: true, basis: 'sampled', detail: why.join(' + ') };
  }
  return { required: false, basis: null, detail: null };
}

/**
 * Findings if the policy block is malformed. The defect: a rate written as `"20%"` or `20` leaves a
 * file that LOOKS configured and samples nothing, so the institution believes it has a control it
 * does not have. A malformed policy fails loudly rather than degrading to silence.
 */
export function policyFindings(policy) {
  if (policy === undefined || policy === null) return [];
  if (!isObject(policy)) return [`${POLICY_KEY} policy must be an object (got ${JSON.stringify(policy)})`];
  const findings = [];
  const { medium_sample_rate: rate, every_nth: nth, always_comprehend_capabilities: caps } = policy;
  if (rate !== undefined && !(Number.isFinite(rate) && rate >= 0 && rate <= 1)) {
    findings.push(`${POLICY_KEY}.medium_sample_rate must be a number between 0 and 1 (got ${JSON.stringify(rate)}) — a rate the selector cannot read samples nothing while looking configured`);
  }
  if (nth !== undefined && !(Number.isInteger(nth) && nth > 0)) {
    findings.push(`${POLICY_KEY}.every_nth must be a positive integer (got ${JSON.stringify(nth)})`);
  }
  if (caps !== undefined && !(Array.isArray(caps) && caps.every((c) => typeof c === 'string' && c.trim()))) {
    findings.push(`${POLICY_KEY}.always_comprehend_capabilities must be an array of capability names (got ${JSON.stringify(caps)})`);
  }
  return findings;
}

/**
 * Notices the policy earns. Never findings: a second line that has decided to sample nothing is
 * entitled to that decision and is not entitled to make it quietly.
 */
export function policyNotices(policy) {
  if (!isObject(policy)) return [];
  const rate = policy.medium_sample_rate;
  const nth = policy.every_nth;
  const noNth = !(Number.isInteger(nth) && nth > 0);
  if (rate === 0 && noNth) {
    return [`${POLICY_KEY}.medium_sample_rate is 0 and no every_nth is set — the second line has decided that NO medium-tier change is sampled for comprehension. That is a position, and it is reported on every run so it stays a decision somebody owns rather than a default nobody sees`];
  }
  return [];
}

/** The missing-record finding, phrased for the basis that selected the change. */
function missingRecord(changeId, basis, detail) {
  if (basis === 'always-capability') {
    return `${changeId}: has no comprehension.json — its compiled plan requires ${JSON.stringify(detail)}, which the second line listed in ${POLICY_KEY}.always_comprehend_capabilities. This surface needs a human who can explain it at ANY tier`;
  }
  if (basis === 'sampled') {
    return `${changeId}: has no comprehension.json — this medium-tier change was SAMPLED for comprehension (${detail}; deterministic over the change id, so this selection is the same on every run and for every reviewer). A sampled change with no record is exactly the debt the sample exists to find`;
  }
  return `${changeId}: high-tier change has no comprehension.json — a high-risk change needs a human-authored understanding record (WS8)`;
}

/** Findings for one selected change's comprehension record. `registry` injectable for tests. */
export function evaluate(changeId, record, { registry, basis = 'tier', detail = null } = {}) {
  const findings = [];
  if (!record) return [missingRecord(changeId, basis, detail)];
  for (const f of NARRATIVE) if (!filled(record[f])) findings.push(`${changeId}: comprehension ${f} is missing or a placeholder`);
  const owner = record.named_owner;
  if (!owner) findings.push(`${changeId}: no named_owner — a human must be accountable for explaining the change`);
  else if (registry) {
    const who = identityOf(registry, owner);
    if (!who || who.kind === 'agent') findings.push(`${changeId}: named_owner ${JSON.stringify(owner)} is not a human registry identity — an agent cannot be the human who understands the change`);
  }
  if (!Array.isArray(record.challenge_questions) || record.challenge_questions.length === 0) findings.push(`${changeId}: no challenge_questions — a reviewer must have probed the change`);
  if (!filled(record.decision_log_replay_ref)) findings.push(`${changeId}: no decision_log_replay_ref — the agent's decision log must have been replayed and referenced`);
  // Metrics are REPORTED, not gated on value — but they must be present (you cannot manage what you
  // do not measure). A missing metric key is a finding; its number is not judged.
  const metrics = record.metrics || {};
  for (const m of METRICS) if (!(m in metrics)) findings.push(`${changeId}: comprehension metric ${JSON.stringify(m)} not recorded`);
  return findings;
}

/** The sampling policy the second line set, or null. Reads the approval-SLA file, never a CI flag. */
export function loadPolicy(cwd = process.cwd()) {
  const sla = loadSla(cwd);
  return sla && POLICY_KEY in sla ? sla[POLICY_KEY] : null;
}

export function run(cwd = process.cwd()) {
  const policy = loadPolicy(cwd);
  const findings = [...policyFindings(policy)];
  const notices = [...policyNotices(policy)];
  const by_basis = { tier: 0, 'always-capability': 0, sampled: 0 };
  const dir = `${cwd}/${CHANGES_DIR}`;
  if (!existsSync(dir)) return { count: 0, findings, notices, by_basis, policy: isObject(policy), inert: findings.length === 0 };
  const registry = loadRegistry(cwd);
  let count = 0;
  for (const name of readdirSync(dir)) {
    const envelope = readJson(join(dir, name, 'change-envelope.json'));
    if (!envelope) continue;
    const changeId = envelope.change_id || name;
    const plan = readJson(join(dir, name, envelope.control_plan || 'control-plan.json'));
    const { required, basis, detail } = requirement(changeId, {
      tier: envelope.risk_tier,
      capabilities: plan?.required_capabilities || {},
      policy,
    });
    if (!required) continue;
    count++;
    by_basis[basis] += 1;
    const record = readJson(join(dir, name, 'comprehension.json'));
    findings.push(...evaluate(changeId, record, { registry, basis, detail }));
  }
  return { count, findings, notices, by_basis, policy: isObject(policy), inert: count === 0 && findings.length === 0 };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { count, findings, notices, by_basis } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nComprehension gate (rc.15 · WS8; sampling rc.41 · G5) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nReview is not understanding. A selected change needs a human who can explain it.\nSee ../loom/references/governance.md (comprehension debt).\n');
    process.exit(1);
  }
  const how = [`${by_basis.tier} by tier`, `${by_basis['always-capability']} by always-comprehend capability`, `${by_basis.sampled} sampled`].join(', ');
  process.stdout.write(`Comprehension gate — ${count} selected change(s) carry a human understanding record (${how}). OK\n`);
}
