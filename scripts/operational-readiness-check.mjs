// The operational-readiness gate — R1–R6 (Loom 2.0 §7.4). Build-time green says nothing
// about run-the-bank readiness: an untested rollback, an expired DR exercise, or a
// kill-switch nobody has flipped is a production incident on a timer. This gate validates
// docs/governance/services/<service-id>.json:
//
//   R1 criticality + ownership + on-call · R2 continuity (RTO/RPO, BCP/DR exercised) ·
//   R3 rollback drilled + kill-switch tested — WITH FRESHNESS WINDOWS (a drill from two
//   years ago is history, not readiness) — and R3b progressive delivery, whose ramp lands on the
//   environments declared in docs/governance/environments.json (scripts/environments-check.mjs:
//   a rollback is a promotion in reverse, so R3 means nothing without a declared ladder to go
//   back down) · R4 capacity/stress evidence · R5 third-party
//   continuity + exit for critical services · R6 reconciliation, failed-transaction
//   recovery, complaints readiness, regulatory-notification triggers.
//
// rc.36 (flow-plan Phase 2.4): a drill is an OBSERVATION, not a diary entry. A bare date says
// only that somebody typed a date; the drill fields now take the observation shape proven by
// platform-activation-example/ — what the drill showed, a negative test the mechanism REFUSED,
// an observer OUTSIDE the builders' write authority, and an ed25519 signature by a registered
// issuer over the record's canonical hash. The bare-date form is accepted for ONE release with a
// printed deprecation NOTICE (never a silent downgrade); freshness applies to both forms.
//
// rc.37 (flow-plan Phase 3.6): freshness windows gained a WARNING BAND. At 80% of a window the
// gate still passes and prints a NOTICE naming the days left. The block is unmoved; the surprise
// is gone. A drill that expires overnight gets run in a panic, and a panicked drill is theatre.
//
// rc.39 (flow-plan Phase 5.3): R3 gained PROGRESSIVE DELIVERY. R3 already asked "can you go back?".
// It never asked "how far forward did you go, and how fast?" — so a service with a perfect rollback
// drill could still put 100% of customers on a new decision path in one step, which is the case
// where the rollback is exercised for real, under time pressure, on everybody. `progressive_delivery`
// declares the ramp (strategy, stages with traffic % and bake time, the SLOs each stage watches),
// the AUTOMATED rollback trigger, and the flag that gates exposure. The rollback trigger carries its
// own 90-day freshness window in the same signed-observation shape as the other drills: an automated
// rollback nobody has fired is a configuration, not a control. OPTIONAL for a service that is not
// doing staged exposure; REQUIRED the moment a compiled plan asks for the `exposure_control`
// capability — mandatory-when-compiled, exactly like the register and the provider roles.
//
// Freshness is checkable; the shipped template FAILS until adopted (its fields are ADOPT
// placeholders), like the CODEOWNERS template: a copied-but-never-exercised readiness file must
// not read green.
//
// Run from the repo root: `node scripts/operational-readiness-check.mjs`.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadIssuers, verifySignatureOver } from '../core/attestations.mjs';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';

export const SERVICES_DIR = 'docs/governance/services';
export const CRITICALITIES = ['critical', 'important', 'standard'];
// ADOPT: your freshness policy (days). An exercise older than its window blocks production.
export const WINDOWS = { bcp_dr: 365, rollback: 180, kill_switch: 90, capacity: 365, progressive_rollback: 90 };
// rc.39 — the progressive-delivery strategies R3 recognises. Deliberately three and closed: the
// point of the field is a shared word for "how did this reach customers", and an open vocabulary
// makes the deploy record's cross-check (scripts/deployed-digest-check.mjs) unenforceable.
export const STRATEGIES = ['canary', 'blue-green', 'ring'];
// rc.37 (flow-plan Phase 3.6) — the warning band. At 80% of a window the drill is still VALID and
// the gate still passes; a NOTICE is printed. The control is unchanged and the block stays exactly
// where it was: what this removes is the overnight green-to-blocked surprise, which is how a
// kill-switch drill ends up being run in a panic on the morning it expired.
export const WARN_AT = 0.8;
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

const DAY = 24 * 60 * 60 * 1000;

function freshDate(findings, label, dateStr, windowDays, now, what = 'last exercised', notices = null) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) { findings.push(`${label}: ${JSON.stringify(dateStr)} is not a date (unadopted template?)`); return; }
  const age = Math.floor((now - t) / DAY);
  if (age > windowDays) findings.push(`${label}: ${what} ${dateStr} — ${age}d ago exceeds the ${windowDays}d freshness window (STALE)`);
  else if (age >= Math.floor(windowDays * WARN_AT)) {
    notices?.push(`${label}: ${what} ${dateStr} — ${age}d of the ${windowDays}d window used, ${windowDays - age}d left. Schedule the next one now; at ${windowDays}d it BLOCKS production`);
  }
}

/** Recursive canonical serialisation (assurance-cycle's) — the signature covers every nested field. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
/** Canonical hash of a drill observation, excluding its own attestation. */
export function drillHash(record) {
  const { attestation, ...rest } = record;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

/**
 * One drill field, either form. `ctx` carries { registry, issuers, notices } — notices collects
 * the deprecation NOTICE for the bare-date form so the CLI can print it (a notice, not a finding:
 * the old form still passes this release, but never silently).
 */
function drill(findings, label, value, windowDays, now, ctx = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    findings.push(...verifyDrillObservation(value, { label, windowDays, now, registry: ctx.registry, issuers: ctx.issuers, notices: ctx.notices }));
    return;
  }
  if (!(typeof value === 'string' && value.trim())) { findings.push(`${label}: no drill recorded — unexercised is not ready`); return; }
  (ctx.notices || []).push(`${label}: a bare-date drill record is DEPRECATED (rc.36) — record a signed observation {observed_at, observation, negative_test, observer_identity, attestation}; the bare date is accepted for this release only`);
  freshDate(findings, label, value, windowDays, now, 'last exercised', ctx.notices || null);
}

/**
 * A drill in the observation shape (platform-activation's, adapted): what happened, a negative
 * test the mechanism refused, an independent observer, a real signature. Findings; empty ⇒ the
 * drill is observed, refused a bypass, independently witnessed, freshly and authentically signed.
 */
export function verifyDrillObservation(rec, { label, windowDays, now = Date.now(), registry = null, issuers = null, notices = null } = {}) {
  const findings = [];
  if (!(typeof rec.observed_at === 'string' && rec.observed_at.trim())) findings.push(`${label}: observation has no observed_at — an undated drill cannot be aged`);
  else freshDate(findings, label, rec.observed_at, windowDays, now, 'observed', notices);
  if (!rec.observation || typeof rec.observation !== 'object' || Object.keys(rec.observation).length === 0) {
    findings.push(`${label}: no observation object — what did the drill actually show?`);
  }
  const nt = rec.negative_test;
  if (!nt || typeof nt !== 'object') findings.push(`${label}: no negative_test — a drill that never saw the mechanism REFUSE anything proves reachability, not protection`);
  else {
    if (!(typeof nt.attempted === 'string' && nt.attempted.trim())) findings.push(`${label}: negative_test names no attempted action`);
    if (nt.result !== 'rejected') findings.push(`${label}: negative_test result is ${JSON.stringify(nt.result)}, not "rejected" — the mechanism did not refuse the probe`);
    if (!(typeof nt.tested_at === 'string') || Number.isNaN(Date.parse(nt.tested_at))) findings.push(`${label}: negative_test has no parseable tested_at`);
  }
  const observer = rec.observer_identity;
  if (!(typeof observer === 'string' && observer.trim())) findings.push(`${label}: no observer_identity — an unwitnessed drill is a claim`);
  else if (!registry) findings.push(`${label}: observer ${JSON.stringify(observer)} cannot be resolved — no identity registry found, and an unresolvable observer does not count`);
  else {
    const who = identityOf(registry, observer);
    if (!who) findings.push(`${label}: observer_identity ${JSON.stringify(observer)} does not resolve in the identity registry`);
    else if (who.kind === 'agent' || (who.groups || []).includes('builders')) {
      findings.push(`${label}: observer ${JSON.stringify(observer)} is inside the builders' write authority — the people who built the thing do not witness their own drill`);
    }
  }
  findings.push(...verifySignatureOver(drillHash(rec), rec.attestation, issuers, `${label} observation`).map((f) => `${label}: ${f}`));
  return findings;
}

/**
 * R3b — the progressive-delivery declaration (rc.39 · flow-plan Phase 5.3). Findings only.
 *
 * Four things make a ramp a control rather than a diagram: it goes somewhere (strictly increasing
 * traffic, ending at 100 — a ramp that never completes is a permanent split-brain, and one that
 * goes backwards is not a ramp); each stage BAKES while watching a named SLO; the automated
 * rollback fires on one of the SLOs the ramp actually watches (a trigger on a signal nothing in
 * the rollout observes is a trigger nobody will see); and that rollback has been FIRED inside its
 * freshness window, recorded as a signed observation like every other drill here.
 */
export function verifyProgressiveDelivery(pd, { label, now = Date.now(), registry = null, issuers = null, notices = null } = {}) {
  const findings = [];
  if (!pd || typeof pd !== 'object' || Array.isArray(pd)) {
    return [`${label}: progressive_delivery is not an object — a compiled plan requires exposure_control, so how this service reaches customers is not optional`];
  }
  if (!STRATEGIES.includes(pd.strategy)) {
    findings.push(`${label}: strategy must be ${STRATEGIES.join('|')} (got ${JSON.stringify(pd.strategy)})`);
  }

  const stages = pd.stages;
  const declaredSlos = new Set();
  if (!Array.isArray(stages) || stages.length === 0) {
    findings.push(`${label}: no stages — a progressive rollout with no stages is a deploy with a nicer name`);
  } else {
    let prev = null;
    stages.forEach((s, i) => {
      const at = `${label}: stages[${i}]`;
      if (!(typeof s?.name === 'string' && s.name.trim())) findings.push(`${at} has no name`);
      const pct = s?.traffic_pct;
      if (!(Number.isFinite(pct) && pct > 0 && pct <= 100)) findings.push(`${at} traffic_pct must be a number in (0, 100] (got ${JSON.stringify(pct)})`);
      else {
        if (prev !== null && pct <= prev) findings.push(`${at} traffic_pct ${pct} does not increase on the previous stage's ${prev} — a ramp that flattens or reverses is not progressive`);
        prev = pct;
      }
      if (!(Number.isFinite(s?.bake_minutes) && s.bake_minutes >= 0)) findings.push(`${at} bake_minutes must be a number — a stage with no bake is a stage nobody watched`);
      if (!(Array.isArray(s?.slo_refs) && s.slo_refs.length && s.slo_refs.every((r) => typeof r === 'string' && r.trim()))) {
        findings.push(`${at} slo_refs must name at least one SLO — baking without watching anything is waiting`);
      } else for (const r of s.slo_refs) declaredSlos.add(r);
    });
    const last = stages[stages.length - 1]?.traffic_pct;
    if (Number.isFinite(last) && last !== 100) {
      findings.push(`${label}: the final stage reaches ${last}% — a rollout that never reaches 100% is a permanent partial exposure nobody decided to keep. State the last stage, or say the ramp ends here by declaring it 100`);
    }
  }

  const ar = pd.automated_rollback;
  if (!ar || typeof ar !== 'object') {
    findings.push(`${label}: no automated_rollback — a ramp whose only rollback is a human noticing is a ramp that rolls back at human speed`);
  } else {
    if (!(typeof ar.trigger_slo === 'string' && ar.trigger_slo.trim())) findings.push(`${label}: automated_rollback.trigger_slo is missing — name the signal that fires it`);
    else if (declaredSlos.size && !declaredSlos.has(ar.trigger_slo)) {
      findings.push(`${label}: automated_rollback.trigger_slo ${JSON.stringify(ar.trigger_slo)} is not among the SLOs the stages watch (${[...declaredSlos].join(', ')}) — a trigger on a signal the rollout does not observe never fires`);
    }
    // last_tested is a SIGNED OBSERVATION (rc.36's shape), not a date: an automated rollback
    // nobody has fired is a configuration, not a control, and a date is what a configuration
    // claims about itself. Absent → the observation verifier says so, item by item.
    findings.push(...verifyDrillObservation(ar.last_tested && typeof ar.last_tested === 'object' ? ar.last_tested : {}, {
      label: `${label}: automated-rollback trigger test`, windowDays: WINDOWS.progressive_rollback, now, registry, issuers, notices,
    }));
  }

  if (!(typeof pd.feature_flag_ref === 'string' && pd.feature_flag_ref.trim())) {
    findings.push(`${label}: no feature_flag_ref — the ramp and the exposure register must name the same switch, or "we can turn it off" is two claims about two different things`);
  }
  return findings;
}

/**
 * Findings for one service-readiness artifact. Empty ⇒ the service is production-ready on paper
 * AND exercised. `ctx` supplies { registry, issuers, notices } for observation-shaped drills and
 * the bare-date deprecation notice; omitted, bare dates behave exactly as before (plus the notice
 * has nowhere to go, so callers that only want findings — the envelope gate — are unchanged).
 */
export function evaluate(r, now = Date.now(), ctx = {}) {
  const findings = [];
  const id = r?.service_id || '(no service_id)';
  if (!r?.service_id) findings.push('service readiness has no service_id');

  // R1 — criticality, ownership, escalation.
  if (!CRITICALITIES.includes(r?.criticality)) findings.push(`${id}: criticality must be ${CRITICALITIES.join('|')} (got ${JSON.stringify(r?.criticality)})`);
  for (const f of ['owner', 'on_call']) {
    if (!(typeof r?.[f] === 'string' && r[f].trim())) findings.push(`${id}: no ${f} — a service nobody owns pages nobody`);
  }

  // R2 — continuity.
  for (const f of ['rto_minutes', 'rpo_minutes']) {
    if (!(Number.isFinite(r?.[f]) && r[f] >= 0)) findings.push(`${id}: ${f} must be a number — disruption tolerance is a commitment, not a vibe`);
  }
  if (!r?.bcp_dr?.plan_ref) findings.push(`${id}: no BCP/DR plan_ref`);
  drill(findings, `${id}: BCP/DR exercise`, r?.bcp_dr?.last_exercised, WINDOWS.bcp_dr, now, ctx);

  // R3 — rollback + kill-switch, drilled and fresh.
  if (!r?.rollback?.procedure_ref) findings.push(`${id}: no rollback procedure_ref`);
  drill(findings, `${id}: rollback drill`, r?.rollback?.last_drilled, WINDOWS.rollback, now, ctx);
  if (!(typeof r?.kill_switch?.owner === 'string' && r.kill_switch.owner.trim())) findings.push(`${id}: kill-switch has no owner`);
  drill(findings, `${id}: kill-switch test`, r?.kill_switch?.last_tested, WINDOWS.kill_switch, now, ctx);

  // R3b — progressive delivery (rc.39). Optional unless a compiled plan requires exposure_control:
  // a service nobody is ramping is not failing, and a change routed for staged exposure against a
  // service with no declared ramp is exposing everybody at once while claiming otherwise.
  if (r?.progressive_delivery !== undefined || ctx.exposureRequired) {
    findings.push(...verifyProgressiveDelivery(r?.progressive_delivery, {
      label: `${id}: progressive delivery`, now, registry: ctx.registry, issuers: ctx.issuers, notices: ctx.notices,
    }));
  }

  // R4 — capacity.
  if (!r?.capacity?.stress_test_ref) findings.push(`${id}: no capacity/stress test reference`);
  drill(findings, `${id}: capacity test`, r?.capacity?.last_run, WINDOWS.capacity, now, ctx);

  // R5 — third-party continuity (critical services must be able to leave).
  if (r?.criticality === 'critical') {
    const deps = r?.third_parties;
    if (!Array.isArray(deps)) findings.push(`${id}: critical service declares no third_parties array (empty is a valid declaration)`);
    else deps.forEach((d, i) => {
      for (const f of ['name', 'continuity', 'exit_strategy']) {
        if (!(typeof d?.[f] === 'string' && d[f].trim())) findings.push(`${id}: third_parties[${i}] missing ${f} — a critical dependency without an exit is a trap`);
      }
    });
  }

  // R6 — customer + financial integrity on the way down.
  for (const f of ['reconciliation', 'failed_transaction_recovery', 'complaints_readiness', 'regulatory_notification_triggers']) {
    if (!(typeof r?.[f] === 'string' && r[f].trim())) findings.push(`${id}: no ${f}`);
  }
  return findings;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${SERVICES_DIR}`;
  if (!existsSync(dir)) return { findings: [], notices: [], count: 0 }; // no services declared yet — the envelope gate demands them at production states
  const registryPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const ctx = {
    registry: registryPath ? readJson(registryPath) : null,
    issuers: loadIssuers(cwd) || loadIssuers(`${cwd}/..`),
    notices: [],
    // rc.39 — mandatory-when-compiled for R3b. The requirement comes from the PROFILE (via every
    // governed change's compiled plan), never from a flag on this gate.
    exposureRequired: capabilityRequired(aggregateRequirements(cwd), 'exposure_control'),
  };
  const findings = [];
  let count = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    count++;
    const r = readJson(`${dir}/${name}`);
    if (!r) { findings.push(`${name}: not parseable JSON`); continue; }
    findings.push(...evaluate(r, Date.now(), ctx));
  }
  return { findings, notices: ctx.notices, count };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, count } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nOperational-readiness gate (R1–R6) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nAn expired DR exercise, an undrilled rollback, or an untested kill-switch blocks\nproduction. Freshness is checkable; a drill is a SIGNED OBSERVATION (rc.36) — an\nindependent observer, a refused negative test, a registered signature.\n');
    process.exit(1);
  }
  process.stdout.write(`Operational-readiness gate — OK (${count} service${count === 1 ? '' : 's'})\n`);
}
