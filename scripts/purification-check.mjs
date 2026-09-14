// The purification gate (Loom 2.0-rc.46 · Shari'ah workstream). Some income must never be
// earned, and when it is earned anyway it must never be BOOKED. Charge income of this kind —
// late-payment charges on a Shari'ah-compliant facility, receipts from a transaction later found
// non-conformant — is quantified, approved by the Shari'ah function, and DONATED. It is not
// revenue, it is not a provision, and it is not a rounding difference. The whole failure mode this
// gate exists against is the quiet one: an amount identified in an operations log, never
// quantified, never approved, and left sitting in the P&L because nothing downstream asked.
//
// Phase 1 gave the operations-signal log a `shariah-non-compliance` type routable to `purification`
// with a `PUR-*` link. That gate resolves the LINK — it checks the id names something under
// docs/governance/purification/. This gate opens the record and holds the money flow to five
// properties, each one a way the flow silently stops being one:
//
//   BOUND TO A BREACH   signal_id resolves to a `shariah-non-compliance` signal in the operations
//                       log. A purification record attached to nothing is a donation with no
//                       stated cause, which is charity, not purification.
//   QUANTIFIED          an amount with a positive value and a currency. Zero is not a small
//                       purification, it is the assertion that nothing was earned — and that
//                       assertion belongs in the signal's triage, not in a disposal record.
//   COMPUTED / APPROVED are two different acts and this gate keeps them apart. `computed_by` may
//                       be ANY registry identity INCLUDING AN AGENT: quantifying an amount is
//                       arithmetic over transactions and an agent doing it is the intended use.
//                       `approved_by` must be a NON-AGENT identity holding `shariah-compliance`
//                       or `shariah-committee`, because the determination that income is
//                       non-compliant, and the decision on how it is disposed of, is human
//                       Shari'ah authority. An agent that could approve here would be an agent
//                       ruling on permissibility.
//   METHOD              method_ref is REQUIRED and must exist on disk. It cites the approved PA2
//                       `purification-of-non-compliant-income` section — the wire from a runtime
//                       payment back to the design-time method the committee approved. Without it
//                       every record computes its amount by a method nobody can read, and the
//                       PA2 section the Islamic product profile compiles evidences nothing.
//   DISPOSAL            status donated requires donation evidence and a donated_at at or after
//                       opened_at. Money cannot leave before the breach was found.
//
// MANDATORY-WHEN-COMPILED. A purification-routed signal with no matching record is a FINDING only
// where a compiled plan requires the `shariah_governance` capability — named, with the change id
// that requires it. Everywhere else it is a NOTICE and this gate is INERT: a repository with no
// records, no purification-routed signal and no Islamic product in flight sees nothing. No generic
// adopter ever fails because of a Shari'ah control.
//
// WHAT THIS GATE DOES NOT DO, stated because the opposite reading is the dangerous one:
//   · it makes NO Shari'ah determination. Whether income is non-compliant, what the purification
//     method should be, and whether ibra' or any other treatment applies are the Shari'ah
//     committee's rulings. This gate checks that a ruling-shaped record exists, is bound to a
//     breach, and was approved by someone entitled to approve it. Scholars decide Shari'ah.
//   · it does not watch the ledger. THE HARNESS READS JSON RECORDS. It proves the record exists,
//     is complete and is bound — never that the money actually moved. A period with no
//     purification record is UNCOVERED here, not clean.
//
// Run from the repo root: `node scripts/purification-check.mjs` (exit 1 on any finding).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { aggregateRequirements, capabilityRequired } from '../core/compiled-requirements.mjs';
import { PURIFICATION_DIR } from './operations-signal-check.mjs';
import { delegationFor, identityOf, isPlaceholder, loadRegistry } from './identity-registry-check.mjs';

// Mirrors operations-signal-check's manifest locations (private there). One log, two readers.
export const SIGNAL_LOCATIONS = ['docs/governance/operations-signal.json', 'operations-signal.json'];
export const CAPABILITY = 'shariah_governance';
/** The signal type a purification record must be bound to. */
export const SHARIAH_SIGNAL_TYPE = 'shariah-non-compliance';
/** Who may approve a disposal. `shariah-board` is RETIRED and is not one of them. */
export const APPROVER_ROLES = ['shariah-compliance', 'shariah-committee'];
export const STATUSES = ['open', 'approved', 'donated'];

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * The amount as a number, or null when it is not one. A finite number is the normal form; a
 * decimal STRING is accepted because ledgers that refuse binary floating point for money write
 * amounts as strings, and refusing them would push adopters toward the lossy representation.
 * Everything else — an empty string, "about 4,000", a boolean — is not an amount.
 */
export function amountValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Findings for one record's `approved_by`. Empty ⇒ it resolves to a human Shari'ah authority.
 * A delegation supplies the role inside a window a second-line human granted (the registry gate
 * owns that grant's validity) and is recorded as a NOTICE: a deputy's approval must never be
 * indistinguishable from the holder's.
 */
export function resolveDisposalApprover(registry, id, label, { notices = null, now = Date.now() } = {}) {
  const who = identityOf(registry, id);
  if (!who) return [`${label}: approved_by ${JSON.stringify(id)} is not in the identity registry — an unresolvable approval is a name, not an authority`];
  if (who.kind === 'agent') {
    return [`${label}: approved_by ${id} is an AGENT. An agent may COMPUTE the amount — quantification is arithmetic — but the determination that income is non-compliant, and how it is disposed of, is human Shari'ah authority. Agents never approve`];
  }
  if ((who.roles || []).some((r) => APPROVER_ROLES.includes(r))) return [];
  for (const role of APPROVER_ROLES) {
    const via = delegationFor(registry, id, role, now);
    if (via) {
      notices?.push(`${label}: ${id} holds ${role} BY DELEGATION from ${via.from} until ${via.until} (granted by ${via.granted_by}) — a deputy approval, recorded as one`);
      return [];
    }
  }
  return [`${label}: approved_by ${id} holds none of ${APPROVER_ROLES.join(' | ')} — disposing of non-compliant income is the Shari'ah function's decision, not the change owner's`];
}

/**
 * Findings + notices over the purification records and the operations log.
 *
 * `records`  parsed records (loadRecords adds `source_file` where it read one from disk)
 * `signals`  the operations log's signals array, or `null` when there is no log at all — in which
 *            case a signal_id is reported NOT VERIFIED rather than passed quietly. Unverified is
 *            a different thing from verified-good and this gate never claims the second.
 * `required` `capabilityRequired(agg, 'shariah_governance')` — the mandatory-when-compiled switch
 * `requiringChanges` the change_ids whose compiled plans require it, so a finding names WHO
 * `exists`   repo-relative path → boolean (injected so the method_ref check is testable)
 */
export function evaluate({
  records = [], signals = null, registry = null, required = false,
  requiringChanges = [], exists = () => true, now = Date.now(),
} = {}) {
  const findings = [];
  const notices = [];
  const seen = new Set();

  // One missing registry is one finding, not one per record: neither party can be resolved and
  // saying so six times buries the six real findings underneath it.
  const canResolve = Boolean(registry);
  if (records.length && !canResolve) {
    findings.push(`purification records exist but no identity registry was found — neither the party that computed an amount nor the authority that approved its disposal can be resolved, and unresolvable approvals do not count`);
  }
  const byType = signals ? new Map(signals.filter((s) => nonEmpty(s?.id)).map((s) => [s.id, s])) : null;

  for (const rec of records) {
    const id = rec?.purification_id;
    const label = nonEmpty(id) ? id : (rec?.source_file ? `${rec.source_file} (no purification_id)` : '(unidentified record)');

    if (!nonEmpty(id)) {
      findings.push(`${label}: no purification_id — a disposal record nothing can cite is unreachable from the signal that caused it`);
    } else {
      if (!/^PUR-/.test(id)) findings.push(`${label}: purification_id must start with PUR- — the operations log links these by that prefix, so an id outside it can never be cited`);
      if (seen.has(id)) findings.push(`${label}: duplicate purification_id — two records for one disposal means one of them is a second donation nobody made`);
      seen.add(id);
      if (rec.source_file && rec.source_file !== `${id}.json`) {
        findings.push(`${label}: filed as ${rec.source_file} but declares purification_id ${JSON.stringify(id)} — records live at ${PURIFICATION_DIR}/<PUR-id>.json, and a mismatch makes the id set carry an entry no record answers to`);
      }
    }

    // BOUND TO A BREACH.
    if (!nonEmpty(rec?.signal_id)) {
      findings.push(`${label}: no signal_id — a purification with no breach behind it is a donation with no stated cause`);
    } else if (byType === null) {
      notices.push(`${label}: signal ${JSON.stringify(rec.signal_id)} NOT VERIFIED — no operations-signal log here to resolve it against`);
    } else {
      const sig = byType.get(rec.signal_id);
      if (!sig) {
        findings.push(`${label}: signal_id ${JSON.stringify(rec.signal_id)} does not resolve in the operations-signal log — the record cites a breach the log does not carry`);
      } else if (sig.type !== SHARIAH_SIGNAL_TYPE) {
        findings.push(`${label}: signal ${rec.signal_id} is type ${JSON.stringify(sig.type)}, not ${SHARIAH_SIGNAL_TYPE} — money is purified because income was non-conformant, and no other signal type says that`);
      }
    }

    // QUANTIFIED.
    const amt = rec?.amount;
    if (!amt || typeof amt !== 'object' || Array.isArray(amt)) {
      findings.push(`${label}: no amount { value, currency } — an amount nobody stated is an amount nobody can donate or reconcile`);
    } else {
      const value = amountValue(amt.value);
      if (value === null) findings.push(`${label}: amount.value ${JSON.stringify(amt.value)} is not a number — a description is not a quantification`);
      else if (value <= 0) findings.push(`${label}: amount.value is ${value} — zero is not a small purification, it is the claim that nothing was earned, and that claim belongs in the signal's triage, never in a disposal record`);
      if (!nonEmpty(amt.currency)) findings.push(`${label}: amount.currency is missing — a bare number is not money`);
    }

    // COMPUTED — any registry identity, agents included. Quantification is arithmetic.
    if (!nonEmpty(rec?.computed_by)) {
      findings.push(`${label}: no computed_by — somebody or something derived this figure, and a figure with no author cannot be re-derived by the Shari'ah Compliance Function or the third-line auditor after them`);
    } else if (canResolve && !identityOf(registry, rec.computed_by)) {
      findings.push(`${label}: computed_by ${JSON.stringify(rec.computed_by)} is not in the identity registry — an agent may compute the amount, but it must still be an identity the registry knows`);
    }

    // APPROVED — human Shari'ah authority, always, before the money is called disposed of.
    const decided = rec?.status === 'approved' || rec?.status === 'donated';
    if (!nonEmpty(rec?.approved_by)) {
      if (decided) findings.push(`${label}: status ${rec.status} with no approved_by — an amount cannot be approved or donated without the Shari'ah function having approved its disposal`);
      else notices.push(`${label}: status open — quantified, not yet approved or donated. The amount is still on the institution's books and the harness sees only this record, never the ledger`);
    } else if (canResolve) {
      findings.push(...resolveDisposalApprover(registry, rec.approved_by, label, { notices, now }));
    }

    // METHOD — the wire back to the approved PA2 section.
    const ref = rec?.method_ref;
    if (!nonEmpty(ref)) {
      findings.push(`${label}: no method_ref — the record must cite the approved PA2 purification-of-non-compliant-income section it computed the amount by, or the runtime money flow is bound to no approved method at all`);
    } else if (isPlaceholder(ref)) {
      findings.push(`${label}: method_ref is still an adoption marker (${JSON.stringify(ref)}) — an unreplaced placeholder is not a method`);
    } else {
      // Fragment-addressable: the reference may point at a section inside a document.
      const path = ref.split('#')[0].trim();
      if (!path) {
        // A BARE FRAGMENT names no document. Before this limb existed the empty path component
        // resolved to the repo root — which exists — so "#purification-of-non-compliant-income"
        // passed the existence check while citing nothing: a method reference that reads as
        // bound and is bound to no file at all.
        findings.push(`${label}: method_ref ${JSON.stringify(ref)} is a fragment with no document in front of it — a fragment resolves inside the file that carries it, and this record is not that file. Cite the path to the approved PA2 section, then the fragment`);
      } else if (path.includes('..') || path.startsWith('/')) {
        findings.push(`${label}: method_ref ${JSON.stringify(ref)} escapes the repository — the approved method has to be a document in here, readable by whoever audits this record`);
      } else if (!exists(path)) {
        findings.push(`${label}: method_ref ${JSON.stringify(ref)} does not exist at ${path} — a citation of a method nobody can open is the same as no method`);
      }
    }

    // DISPOSAL.
    if (!STATUSES.includes(rec?.status)) {
      findings.push(`${label}: status must be ${STATUSES.join('|')} (got ${JSON.stringify(rec?.status)})`);
    }
    const opened = Date.parse(rec?.opened_at);
    if (!nonEmpty(rec?.opened_at) || Number.isNaN(opened)) {
      findings.push(`${label}: opened_at ${JSON.stringify(rec?.opened_at)} is not a timestamp — without one there is no interval between finding the income and giving it away, and that interval is the thing an auditor measures`);
    }
    if (rec?.status === 'donated') {
      if (!nonEmpty(rec?.donation_evidence_ref)) {
        findings.push(`${label}: status donated with no donation_evidence_ref — the harness cannot see the transfer, so the evidence reference is the only thing standing between "donated" and an assertion`);
      }
      const donated = Date.parse(rec?.donated_at);
      if (!nonEmpty(rec?.donated_at) || Number.isNaN(donated)) {
        findings.push(`${label}: status donated with no parseable donated_at — a donation with no date cannot be placed in any reporting period`);
      } else if (!Number.isNaN(opened) && donated < opened) {
        findings.push(`${label}: donated_at ${rec.donated_at} precedes opened_at ${rec.opened_at} — the money cannot have left before the breach was found`);
      }
    } else if (nonEmpty(rec?.donation_evidence_ref) || nonEmpty(rec?.donated_at)) {
      // Not a finding: the likeliest cause is a record whose status was never moved after the
      // transfer, and refusing the merge would teach adopters to delete the evidence instead.
      notices.push(`${label}: carries donation evidence while status is ${JSON.stringify(rec?.status)} — one of the two is stale; if the money has left, say donated`);
    }
  }

  // NO RECORDS AT ALL, with the capability compiled-required. Not a finding: purification records
  // exist only where non-compliant income was found, so an institution that has found none has
  // nothing to file and no way to satisfy a finding demanding one. But it is not a pass either —
  // this gate verified NOTHING, and "OK, 0 records bound and approved" reads as assurance over an
  // empty set, which is the vacuous green the file's own preamble refuses. Say what was checked.
  if (required && records.length === 0) {
    const who = requiringChanges.length ? requiringChanges.join(', ') : 'unknown change';
    notices.push(`no records under ${PURIFICATION_DIR}/ while a compiled plan requires ${CAPABILITY} [${who}] — NOTHING WAS VERIFIED here. An empty register is uncovered, not clean: the harness reads records and cannot see whether any income needed purifying, so the absence of records is evidence of nothing`);
  }

  // MANDATORY-WHEN-COMPILED — every purification-routed signal has a record answering to it.
  if (byType) {
    for (const s of signals) {
      if (s?.route !== 'purification') continue;
      const link = String(s?.link || '');
      if (!/^PUR-/.test(link)) continue; // operations-signal-check owns the malformed-link finding
      if (seen.has(link)) continue;
      const who = requiringChanges.length ? requiringChanges.join(', ') : 'unknown change';
      const msg = `${s.id || '(unnamed signal)'}: routed to purification citing ${link}, and no record under ${PURIFICATION_DIR}/ answers to it — the log says an amount was purified and there is nothing that says what, by whom, or where it went`;
      if (required) findings.push(`${msg} — a compiled plan requires the ${CAPABILITY} capability [${who}]`);
      else notices.push(`${msg}. No compiled plan requires ${CAPABILITY} here, so this is a notice, not a finding`);
    }
  }

  return { findings, notices, count: records.length };
}

/**
 * Every parsed purification record, plus a finding per unreadable file. `null` when there is no
 * tree at all — which is the ordinary state of every repository not running an Islamic product.
 */
export function loadRecords(cwd = process.cwd()) {
  const dir = join(cwd, PURIFICATION_DIR);
  if (!existsSync(dir)) return null;
  const records = [];
  const findings = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const rec = readJson(join(dir, name));
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      findings.push(`${PURIFICATION_DIR}/${name}: not a readable JSON record — an unparseable disposal record is money the tree claims to account for and cannot`);
      continue;
    }
    records.push({ ...rec, source_file: name });
  }
  return { records, findings };
}

/** The change_ids whose compiled plans require a capability — so a finding can name WHO. */
export function changesRequiring(agg, capability) {
  return (agg?.changes || []).filter((c) => c?.capabilities?.[capability]?.required).map((c) => c.change_id);
}

export function run(cwd = process.cwd()) {
  const agg = aggregateRequirements(cwd);
  const required = capabilityRequired(agg, CAPABILITY);
  const loaded = loadRecords(cwd);
  const signalPath = SIGNAL_LOCATIONS.map((p) => join(cwd, p)).find(existsSync);
  const log = signalPath ? readJson(signalPath) : null;
  const signals = Array.isArray(log?.signals) ? log.signals : null;
  const routed = (signals || []).some((s) => s?.route === 'purification');

  // INERT: no records, nothing routed to purification, and no plan requiring the capability. Most
  // repositories live here permanently and this gate must be silent for them — not "0 checked, OK",
  // which would read as a Shari'ah control passing in a repository that has none.
  if (!loaded && !routed && !required) return { inert: true, findings: [], notices: [], count: 0, required };

  // No tree, but something demands one: an EMPTY record set is the honest input — the coverage
  // rule below then reports every purification-routed signal as answering to nothing.
  const { records, findings: loadFindings } = loaded || { records: [], findings: [] };
  const result = evaluate({
    records,
    signals,
    registry: loadRegistry(cwd),
    required,
    requiringChanges: changesRequiring(agg, CAPABILITY),
    exists: (p) => existsSync(join(cwd, p)),
  });
  return { inert: false, required, count: result.count, findings: [...loadFindings, ...result.findings], notices: result.notices };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { inert, required, count, findings, notices } = run();
  for (const n of notices) process.stdout.write(`NOTICE: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nPurification gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nNon-compliant income is never booked: it is quantified, its disposal is approved by the\nShari\'ah function, and it is donated. This gate proves the record exists and is bound to a\nbreach and to an approved PA2 method — never that the money moved, and never that the income\nwas or was not permissible. Scholars decide Shari\'ah.\n');
    process.exit(1);
  }
  if (inert) {
    process.stdout.write(`Purification gate — inert (no ${PURIFICATION_DIR}/ records, nothing routed to purification, no compiled plan requires ${CAPABILITY})\n`);
    process.exit(0);
  }
  // Zero records is not "OK, 0 records bound and approved" — nothing was bound and nothing was
  // approved, because there was nothing. The summary line says which of the two happened.
  const tail = `${required ? `, ${CAPABILITY} required by a compiled plan` : ''}${notices.length ? `, ${notices.length} notice(s)` : ''}`;
  if (count === 0) process.stdout.write(`Purification gate — NOTHING VERIFIED (no records under ${PURIFICATION_DIR}/; an empty register is uncovered, not clean${tail})\n`);
  else process.stdout.write(`Purification gate — OK (${count} record${count === 1 ? '' : 's'} bound and approved${tail})\n`);
}
