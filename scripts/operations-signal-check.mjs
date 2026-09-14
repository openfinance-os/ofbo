// The loop-closing gate — Run/Operations → Discovery. The double diamond builds the thing; a
// regulated system also runs, and Run produces signals (incidents, SLO breaches, drift, CVEs,
// regulatory change, materialised risk) that must feed back — not fall on the floor. Discovery
// is evidence-gated (D2: every claim traces to a logged signal), so an operational signal is
// just a signal that originated in production. This gate enforces the feedback wire over an
// operations-signal log:
//
//   Every signal must be TRIAGED (routed) and TRACEABLE (the route resolves to real follow-up).
//
// Routes and what each must trace to:
//   - spec-fix        → a delivery follow-up (link a PR / spec-change)      — stays in Delivery
//   - register        → a data-risk register update (cite a DR-* risk)      — Continuous Assurance
//   - discovery       → a discovery run (link its slug), or status:triaging — re-enters Discovery
//   - accepted        → a stated justification (a conscious no-op)          — closed with a reason
//   - purification    → a PUR-* record under docs/governance/purification/  — the money leaves
//   - issc-escalation → an assurance case id, or status:triaging            — a body decides
//
// rc.37 (flow-plan Phase 3.3) — TWO OPTIONAL FIELDS THAT MAKE RUN MEASURABLE. Change-failure
// rate and MTTR are not derivable from a log that never says which change caused a signal or
// when the signal stopped:
//
//   caused_by_change  the change_id this signal is attributed to. Optional — most signals are
//                     not attributable — but when present it must RESOLVE to a governed change
//                     under docs/governance/changes/. A link to a change that does not exist is
//                     a citation of a ghost, which is the failure mode the whole traceability
//                     chain exists to refuse.
//   resolved_at       when the signal was closed out. Optional (an open signal has none), and
//                     when present it must be a real timestamp at or after `detected` — a signal
//                     that resolved before it was detected is a typo that would silently poison
//                     every MTTR figure computed from it.
//
// Neither field gates anything on its VALUE: scripts/flow-report.mjs reads them, and telemetry
// never blocks a merge. What this gate refuses is a malformed or unresolvable link.
//
// rc.46 (Shari'ah workstream) — A SHARI'AH BREACH MUST HAVE SOMEWHERE TO GO. Until now the closed
// type enum had no member for a Shari'ah non-compliance event and no route led anywhere a Shari'ah
// body sits, while the Islamic product profile compiles a PA2 `purification-of-non-compliant-income`
// section that no run-time signal could ever reach. Two rules attach to the type, because a Shari'ah
// breach closes differently from an outage:
//
//   · it needs an evidence_ref at EVERY severity, not only high/critical — purification quantifies
//     an amount that should never have been earned, and an amount nobody can reconstruct from the
//     record is a number, not a record;
//   · it may route ONLY to purification, issc-escalation or register. `accepted` is refused:
//     waiving a Shari'ah breach is the Shari'ah body's decision, recorded in a case with scholars'
//     names on it, never a triager's justification field in an operations log.
//
// Both rules are TYPE-CONDITIONAL, so a repo with no Islamic product in flight never meets them —
// a log that never carries the type is unaffected, and no generic adopter fails because of them.
//
// Honest limit: THIS GATE VALIDATES THE LOG. The runtime screening that detects a non-conforming
// transaction and writes the entry is the institution's — the harness reads JSON records, it never
// watches production, so a period with no Shari'ah signal is UNCOVERED here, not clean. And nothing
// here rules on Shari'ah: the gate checks that a breach was routed somewhere a scholar can decide
// and that the destination resolves. Scholars decide Shari'ah.
//
// An empty log is valid (operations may not have started). A signal with no route is the
// failure this gate exists to prevent. Run from repo root:
//   `node scripts/operations-signal-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { CASES_DIR } from './assurance-case-check.mjs';

const MANIFEST_LOCATIONS = ['docs/governance/operations-signal.json', 'operations-signal.json'];
/** Where purification records live. One record per amount identified, quantified, approved, given away. */
export const PURIFICATION_DIR = 'docs/governance/purification';

// ADOPT: the operational signal taxonomy and how each routes back into the loop. `regulatory` is
// the precedent for a domain-shaped member: a type exists here when the follow-up it demands is
// unlike any other type's. `shariah-non-compliance` is one of those — nothing else routes money out.
export const TYPES = new Set(['incident', 'slo-breach', 'drift', 'cve', 'regulatory', 'near-miss', 'customer-signal', 'risk-materialised', 'shariah-non-compliance']);
export const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
// 2.1.0 (hardening plan 4.7) — REGULATOR NOTIFICATION IS STRUCTURED. A high or critical signal must
// say whether the regulator has to be told: `regulator_notification: { required, authority?, deadline?,
// sent_at?, reference?, rationale? }`. required:true owes a deadline, and the MOMENT the deadline
// passes with no sent_at the signal is a finding; a sent notification carries its reference; a late
// one is a NOTICE (recorded, not blocked — the regulator already knows); required:false owes a
// rationale, because "not required" is a determination someone made. The block is a record of what
// was sent and when; whether the determination was right is compliance's, not this gate's.
export const NOTIFICATION_SEVERITIES = new Set(['high', 'critical']);
export const ROUTES = new Set(['spec-fix', 'register', 'discovery', 'accepted', 'purification', 'issc-escalation']);

/** The only routes a Shari'ah non-compliance signal may take. `accepted` is deliberately not one. */
export const SHARIAH_ROUTES = new Set(['purification', 'issc-escalation', 'register']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Findings (one per untriaged/untraceable signal). Empty ⇒ every signal is routed and traceable.
 * `inProduction`: true once any governed change holds a production state — from that moment an
 * EMPTY log is itself a finding (1.12): a live product that has never produced one incident,
 * complaint, drift or SLO measurement means the sensing is missing, not that Run is perfect.
 */
/** 2.1.0 (4.7) — findings for one signal's regulator-notification block. */
export function checkRegulatorNotification(s, { now = Date.now(), notices = null } = {}) {
  const id = (s && s.id) || '(unnamed signal)';
  if (!NOTIFICATION_SEVERITIES.has(s?.severity)) return [];
  const rn = s.regulator_notification;
  const label = `${id}: regulator_notification`;
  if (!rn || typeof rn !== 'object') return [`${id}: a ${s.severity} signal must say whether the regulator is notified — add regulator_notification { required: true|false, ... }; silence is not a determination`];
  const f = [];
  if (typeof rn.required !== 'boolean') { f.push(`${label}.required must be true or false (got ${JSON.stringify(rn.required)})`); return f; }
  if (rn.required === false) {
    if (!nonEmpty(rn.rationale)) f.push(`${label}: required is false with no rationale — "not required" is a determination, and it is recorded with its reason`);
    return f;
  }
  if (!nonEmpty(rn.authority)) f.push(`${label}: no authority — say which regulator`);
  const deadline = Date.parse(rn.deadline);
  if (!nonEmpty(rn.deadline) || Number.isNaN(deadline)) { f.push(`${label}: required is true but deadline ${JSON.stringify(rn.deadline)} is not a parseable timestamp — a notification obligation has a clock`); return f; }
  const detected = Date.parse(s.detected);
  if (!Number.isNaN(detected) && deadline < detected) f.push(`${label}: deadline ${rn.deadline} precedes detected ${s.detected}`);
  if (rn.sent_at === undefined) {
    if (now > deadline) f.push(`${label}: deadline ${rn.deadline} has PASSED and no notification was sent — a missed statutory notification is itself a reportable event`);
    else notices?.push(`${id}: regulator notification to ${rn.authority || '(authority unstated)'} due by ${rn.deadline}`);
    return f;
  }
  const sent = Date.parse(rn.sent_at);
  if (!nonEmpty(rn.sent_at) || Number.isNaN(sent)) { f.push(`${label}: sent_at ${JSON.stringify(rn.sent_at)} is not a parseable timestamp`); return f; }
  if (!nonEmpty(rn.reference)) f.push(`${label}: sent with no reference — the regulator's acknowledgement or case number is what makes "sent" verifiable`);
  if (sent > deadline) notices?.push(`${id}: regulator notification was sent ${rn.sent_at}, after its deadline ${rn.deadline} — recorded, not blocked`);
  return f;
}

export function evaluate(manifest, { inProduction = false, changeIds = null, purificationIds = null, caseIds = null, notices = null, now = Date.now() } = {}) {
  const signals = manifest && manifest.signals;
  if (!Array.isArray(signals)) return ['operations-signal manifest has no `signals` array'];
  if (signals.length === 0) {
    return inProduction
      ? ['operations log is EMPTY while a governed change is in production — silence after launch means the sensing is unwired, not that nothing happened']
      : []; // an empty operations log is valid before anything runs
  }

  const findings = [];
  for (const s of signals) {
    const id = (s && s.id) || '(unnamed signal)';
    if (!TYPES.has(s.type)) { findings.push(`${id}: type must be one of ${[...TYPES].join('|')} (got ${JSON.stringify(s.type)})`); }
    if (!SEVERITIES.has(s.severity)) { findings.push(`${id}: severity must be low|medium|high|critical (got ${JSON.stringify(s.severity)})`); }
    // high/critical signals must carry evidence so a reviewer can reconstruct them.
    if ((s.severity === 'high' || s.severity === 'critical') && !nonEmpty(s.evidence_ref)) {
      findings.push(`${id}: ${s.severity} signal needs an evidence_ref`);
    }
    // 2.1.0 (4.7) — a high/critical signal states its regulator-notification position.
    findings.push(...checkRegulatorNotification(s, { now, notices }));
    // A Shari'ah non-compliance signal carries evidence at EVERY severity (the high/critical rule
    // above already covers those two). What follows a low-severity entry is a purification
    // computation, and a computed amount with nothing behind it cannot be re-derived by the
    // Shari'ah Compliance Function, the third-line auditor, or anyone after them.
    if (s.type === 'shariah-non-compliance' && s.severity !== 'high' && s.severity !== 'critical' && !nonEmpty(s.evidence_ref)) {
      findings.push(`${id}: a shariah-non-compliance signal needs an evidence_ref at EVERY severity — the money flow must be reconstructable, and severity does not change that`);
    }
    // rc.37 — the two flow fields. Optional; malformed or unresolvable is a finding.
    if (s.caused_by_change !== undefined) {
      if (!nonEmpty(s.caused_by_change)) {
        findings.push(`${id}: caused_by_change must be a change_id string (got ${JSON.stringify(s.caused_by_change)})`);
      } else if (changeIds instanceof Set) {
        if (!changeIds.has(s.caused_by_change)) {
          findings.push(`${id}: caused_by_change ${JSON.stringify(s.caused_by_change)} does not resolve to a governed change under docs/governance/changes/ — a signal cannot be attributed to a change that does not exist`);
        }
      } else {
        // No governed-change tree to resolve against: say so rather than pass quietly. The
        // attribution is unverified, which is a different thing from verified-good.
        notices?.push(`${id}: caused_by_change ${JSON.stringify(s.caused_by_change)} NOT verified — no docs/governance/changes/ tree here to resolve it against`);
      }
    }
    if (s.resolved_at !== undefined) {
      const r = Date.parse(s.resolved_at);
      if (Number.isNaN(r)) findings.push(`${id}: resolved_at ${JSON.stringify(s.resolved_at)} is not a timestamp — an unparseable resolution time makes MTTR fiction`);
      else {
        const d = Date.parse(s.detected);
        if (!Number.isNaN(d) && r < d) findings.push(`${id}: resolved_at ${s.resolved_at} precedes detected ${s.detected} — a signal cannot close before it opens`);
      }
    }
    if (!ROUTES.has(s.route)) {
      findings.push(`${id}: not triaged — route must be ${[...ROUTES].join('|')} (got ${JSON.stringify(s.route)}); a signal must not fall on the floor`);
      continue; // route drives the traceability checks
    }
    // Where a Shari'ah breach may go. Not a judgement about the breach — a statement about who is
    // allowed to close one. `accepted` would let a triager retire a Shari'ah finding with a sentence.
    if (s.type === 'shariah-non-compliance' && !SHARIAH_ROUTES.has(s.route)) {
      findings.push(`${id}: shariah-non-compliance routed to ${JSON.stringify(s.route)} — it may route only to ${[...SHARIAH_ROUTES].join('|')}. Waiving a Shari'ah breach is the Shari'ah body's decision recorded in a case, not a triager's justification in an operations log`);
    }
    switch (s.route) {
      case 'discovery':
        if (!nonEmpty(s.link) && s.status !== 'triaging') {
          findings.push(`${id}: routed to discovery but links no run and is not status:triaging — the Run→Discovery edge is broken`);
        }
        break;
      case 'register':
        if (!/^DR-/.test(String(s.link || ''))) findings.push(`${id}: routed to register but does not cite a DR-* risk in link`);
        break;
      case 'spec-fix':
        if (!nonEmpty(s.link)) findings.push(`${id}: routed to spec-fix but links no PR / spec-change`);
        break;
      case 'accepted':
        if (!nonEmpty(s.justification)) findings.push(`${id}: accepted (no action) needs a justification`);
        break;
      case 'purification': {
        // Income that should never have been earned is quantified, approved and given away — never
        // booked. The link is the record of that, and an unresolvable PUR-* id is the failure the
        // whole traceability chain refuses: a citation of a payment nobody can find.
        const link = String(s.link || '');
        if (!/^PUR-/.test(link)) {
          findings.push(`${id}: routed to purification but does not cite a PUR-* purification record in link — an amount to be purified with no record is money the log says left and cannot show leaving`);
        } else if (purificationIds instanceof Set) {
          if (!purificationIds.has(link)) {
            findings.push(`${id}: purification record ${JSON.stringify(link)} does not resolve under ${PURIFICATION_DIR}/ — a signal cannot be purified into a record that does not exist`);
          }
        } else {
          // No purification tree to resolve against: say so rather than pass quietly. Unverified is
          // a different thing from verified-good, and this gate never claims the second.
          notices?.push(`${id}: purification record ${JSON.stringify(link)} NOT verified — no ${PURIFICATION_DIR}/ tree here to resolve it against`);
        }
        break;
      }
      case 'issc-escalation': {
        // Escalated to the Shari'ah committee. The destination is an assurance case, because that is
        // where a body's decision is recorded with a name and a date on it. `status: triaging` is the
        // honest interim: the escalation was logged before the case was cut. An escalation with
        // neither is a breach declared to nobody.
        const link = String(s.link || '');
        if (!nonEmpty(link)) {
          if (s.status !== 'triaging') {
            findings.push(`${id}: routed to issc-escalation but names no assurance case and is not status:triaging — an escalation that reaches no case reaches no committee`);
          }
        } else if (caseIds instanceof Set) {
          if (!caseIds.has(link)) {
            findings.push(`${id}: assurance case ${JSON.stringify(link)} does not resolve under ${CASES_DIR}/ — the escalation cites a case that does not exist`);
          }
        } else {
          notices?.push(`${id}: assurance case ${JSON.stringify(link)} NOT verified — no ${CASES_DIR}/ tree here to resolve it against`);
        }
        break;
      }
    }
  }
  return findings;
}

/** True once any governed change under docs/governance/changes/ holds a production state. */
export function anyChangeInProduction(cwd = process.cwd()) {
  const dir = `${cwd}/docs/governance/changes`;
  if (!existsSync(dir)) return false;
  const PROD = new Set(['production-authorized', 'in-production']);
  for (const name of readdirSync(dir)) {
    try {
      const env = JSON.parse(readFileSync(`${dir}/${name}/change-envelope.json`, 'utf8'));
      if (PROD.has(env.current_state)) return true;
    } catch { /* the envelope gate reports unparseable envelopes */ }
  }
  return false;
}

/**
 * Every governed change id in the tree — the directory name AND the declared change_id, because
 * a change may be filed under either. Returns null when there is no changes tree at all, which
 * `evaluate` reports as an unverified attribution rather than treating as "no such change".
 */
export function governedChangeIds(cwd = process.cwd()) {
  const dir = `${cwd}/docs/governance/changes`;
  if (!existsSync(dir)) return null;
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    ids.add(name);
    try { ids.add(JSON.parse(readFileSync(`${dir}/${name}/change-envelope.json`, 'utf8')).change_id); }
    catch { /* the envelope gate reports unparseable envelopes */ }
  }
  ids.delete(undefined);
  return ids;
}

/**
 * Every purification record id in the tree — the file/directory name (a `.json` suffix stripped)
 * AND the declared id, because a record may be filed under either. Same shape as
 * `governedChangeIds`, including the null: no tree at all is reported by `evaluate` as an
 * UNVERIFIED link, never as "no such record". The harness reads these records; it does not see the
 * bank account the money left from.
 */
export function purificationRecordIds(cwd = process.cwd()) {
  const dir = `${cwd}/${PURIFICATION_DIR}`;
  if (!existsSync(dir)) return null;
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    ids.add(name.replace(/\.json$/, ''));
    try {
      const rec = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
      ids.add(rec.purification_id ?? rec.id);
    } catch { /* a directory, or a malformed record the purification gate reports */ }
  }
  ids.delete(undefined);
  return ids;
}

/** Every assurance-case id — filename (minus `.json`) and declared `case_id`. Null when no tree. */
export function assuranceCaseIds(cwd = process.cwd()) {
  const dir = `${cwd}/${CASES_DIR}`;
  if (!existsSync(dir)) return null;
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    ids.add(name.replace(/\.json$/, ''));
    try { ids.add(JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')).case_id); }
    catch { /* the assurance-case gate reports unparseable cases */ }
  }
  ids.delete(undefined);
  return ids;
}

function run(cwd = process.cwd()) {
  const inProduction = anyChangeInProduction(cwd);
  const notices = [];
  const path = MANIFEST_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  if (!path) {
    return {
      notices,
      findings: inProduction
        ? ['no operations-signal manifest while a governed change is in production — the feedback seam is MANDATORY after launch']
        : [], // operations not yet wired — the feedback seam is optional until Run begins
    };
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { notices, findings: [`operations-signal manifest is not valid JSON: ${e.message}`] }; }
  return {
    notices,
    findings: evaluate(manifest, {
      inProduction,
      changeIds: governedChangeIds(cwd),
      purificationIds: purificationRecordIds(cwd),
      caseIds: assuranceCaseIds(cwd),
      notices,
    }),
  };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nOperations → Discovery feedback gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nEvery operational signal must be triaged and traceable, so Run feeds back into\nthe loop. See ../loom/references/operations.md.\n');
    process.exit(1);
  }
  process.stdout.write('Operations → Discovery feedback gate — OK\n');
}
