// The two attestation types the double diamond's LOOP needs and a linear pipeline never has (2.1.0,
// hardening plan row 2.14; kosli-seam.md §3). Kosli's chain of custody runs forward from a commit;
// the Loom's two arcs run the other way as well — a discovery may STOP (the right decision, recorded,
// never hidden) and a shipped change may send the problem BACK to discovery. Neither is a commit,
// and without a record of its own each would be invisible on the trail.
//
//   discovery-stopped    a discovery run that ended without a hand-off: which run, who decided
//                        (a HUMAN — an agent may recommend, never dispose), why, and what each
//                        framing hypothesis was found to be. Source: discovery/runs/<slug>/outcome.md.
//   reopened-discovery   an operations signal routed `discovery`: which signal, which governed
//                        change sent it back (the delivery trail it links to), and the run it
//                        reopened or the triage that will open one. Source: the operations-signal log.
//
// Both are built here, verified here, and signed with the harness's one attestation stack
// (core/attestations.mjs) exactly as the risk-class record is. Posting them is kosli-attest's job.
import { createHash, sign as edSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from './policy-compiler.mjs';
import { verifySignatureOver } from './attestations.mjs';

export const STOPPED_SCHEMA = 'loom.discovery-stopped/v1';
export const REOPENED_SCHEMA = 'loom.reopened-discovery/v1';
export const OUTCOME_FILE = 'outcome.md';
export const OUTCOMES = new Set(['stopped', 'handed-off']);
export const HYPOTHESIS_VERDICTS = new Set(['refuted', 'confirmed', 'uncertain', 'not-tested']);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id) || null;

/** Minimal front-matter reader for outcome.md (YAML subset: `key: value` and `- id: H1 / verdict: x` lists). */
export function readOutcome(runDir) {
  const p = join(runDir, OUTCOME_FILE);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { _error: `${OUTCOME_FILE} has no front-matter` };
  const fm = {}; const hyps = []; let cur = null; let inHyps = false;
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^hypotheses:\s*$/.test(line)) { inHyps = true; continue; }
    if (inHyps && /^\s+-\s+/.test(line)) { cur = {}; hyps.push(cur); const kv = line.replace(/^\s+-\s+/, '').match(/^([\w-]+):\s*(.*)$/); if (kv) cur[kv[1]] = kv[2].replace(/^"|"$/g, ''); continue; }
    if (inHyps && /^\s+[\w-]+:/.test(line) && cur) { const kv = line.trim().match(/^([\w-]+):\s*(.*)$/); cur[kv[1]] = kv[2].replace(/^"|"$/g, ''); continue; }
    inHyps = false;
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, '');
  }
  fm.hypotheses = hyps;
  fm._body = text.slice(m[0].length).trim();
  return fm;
}

/** The discovery-stopped record from a run's outcome. Pure given the outcome object. */
export function discoveryStoppedRecord(slug, outcome) {
  return {
    schema: STOPPED_SCHEMA,
    run: slug,
    outcome: outcome?.outcome ?? null,
    decided_by: outcome?.decided_by ?? null,
    decided_at: outcome?.decided_at ?? null,
    reason: outcome?.reason ?? null,
    hypotheses: (outcome?.hypotheses || []).map((h) => ({ id: h.id ?? null, verdict: h.verdict ?? null })),
    evidence_ref: outcome?.evidence_ref ?? null,
    successor_run: outcome?.successor_run ?? null,
    attestation: null,
  };
}

/** Findings for a discovery-stopped record ([] ⇒ a recorded, human-decided stop). */
export function verifyDiscoveryStopped(rec, { registry = null, runsDir = null, issuers = null, requireSignature = true, now = Date.now(), notices = null } = {}) {
  const f = []; const label = `discovery-stopped ${rec?.run || '(no run)'}`;
  if (!rec || typeof rec !== 'object') return [`${label}: no record`];
  if (rec.schema !== STOPPED_SCHEMA) f.push(`${label}: schema must be ${STOPPED_SCHEMA}`);
  if (!isStr(rec.run)) f.push(`${label}: no run slug`);
  else if (runsDir && !existsSync(join(runsDir, rec.run))) f.push(`${label}: run ${rec.run} does not exist under ${runsDir} — a stop attested for a run nobody can find`);
  if (rec.outcome !== 'stopped') f.push(`${label}: outcome is ${JSON.stringify(rec.outcome)}, not "stopped" — a handed-off run is attested by its hand-off, not here`);
  if (!isStr(rec.reason)) f.push(`${label}: no reason — stopping the wrong problem early is a win only when the record says why`);
  if (!isStr(rec.decided_at) || Number.isNaN(Date.parse(rec.decided_at))) f.push(`${label}: decided_at is not a parseable timestamp`);
  if (!isStr(rec.decided_by)) f.push(`${label}: no decided_by — a stop is a disposition, and someone disposes`);
  else if (registry) {
    const who = identityOf(registry, rec.decided_by);
    if (!who) f.push(`${label}: decided_by ${JSON.stringify(rec.decided_by)} is not in the identity registry`);
    else if (who.kind !== 'human') f.push(`${label}: decided_by ${rec.decided_by} is an ${who.kind} — an agent may recommend stopping; a human disposes`);
  }
  if (!Array.isArray(rec.hypotheses) || rec.hypotheses.length === 0) f.push(`${label}: no hypotheses — say what each framing hypothesis was found to be, or the stop taught nothing`);
  else for (const h of rec.hypotheses) {
    if (!/^H\d+$/.test(String(h?.id))) f.push(`${label}: hypothesis id ${JSON.stringify(h?.id)} is not an H-number`);
    if (!HYPOTHESIS_VERDICTS.has(h?.verdict)) f.push(`${label}: hypothesis ${h?.id} verdict must be ${[...HYPOTHESIS_VERDICTS].join('|')} (got ${JSON.stringify(h?.verdict)})`);
  }
  return [...f, ...signatureFindings(rec, label, { issuers, requireSignature, now, notices })];
}

/** The reopened-discovery record from an operations signal routed `discovery`. */
export function reopenedDiscoveryRecord(signal) {
  return {
    schema: REOPENED_SCHEMA,
    signal_id: signal?.id ?? null,
    signal_type: signal?.type ?? null,
    severity: signal?.severity ?? null,
    detected: signal?.detected ?? null,
    sent_back_by_change: signal?.caused_by_change ?? null,
    reopened_run: isStr(signal?.link) ? signal.link.replace(/^discovery\//, '') : null,
    status: signal?.status ?? null,
    evidence_ref: signal?.evidence_ref ?? null,
    summary: signal?.summary ?? null,
    attestation: null,
  };
}

/** Findings for a reopened-discovery record ([] ⇒ a signal that went back to the left diamond, traceably). */
export function verifyReopenedDiscovery(rec, { changeIds = null, runsDir = null, issuers = null, requireSignature = true, now = Date.now(), notices = null } = {}) {
  const f = []; const label = `reopened-discovery ${rec?.signal_id || '(no signal)'}`;
  if (!rec || typeof rec !== 'object') return [`${label}: no record`];
  if (rec.schema !== REOPENED_SCHEMA) f.push(`${label}: schema must be ${REOPENED_SCHEMA}`);
  if (!isStr(rec.signal_id)) f.push(`${label}: no signal_id`);
  if (!isStr(rec.summary)) f.push(`${label}: no summary — what the run was reopened for`);
  if (!isStr(rec.reopened_run) && rec.status !== 'triaging') f.push(`${label}: names no reopened run and is not status:triaging — the Run→Discovery edge is broken (the same rule the operations-signal gate applies)`);
  if (isStr(rec.reopened_run) && runsDir && !existsSync(join(runsDir, rec.reopened_run))) f.push(`${label}: reopened run ${rec.reopened_run} does not exist under ${runsDir}`);
  if (rec.sent_back_by_change === null || rec.sent_back_by_change === undefined) {
    notices?.push(`${label}: no sent_back_by_change — the signal is not attributed to a governed change, so the delivery trail it links to is unknown (allowed; most signals are not attributable)`);
  } else if (!isStr(rec.sent_back_by_change)) f.push(`${label}: sent_back_by_change must be a change_id string`);
  else if (changeIds instanceof Set && !changeIds.has(rec.sent_back_by_change)) f.push(`${label}: sent_back_by_change ${rec.sent_back_by_change} does not resolve to a governed change — a return from a change that does not exist`);
  return [...f, ...signatureFindings(rec, label, { issuers, requireSignature, now, notices })];
}

/** Canonical bytes for either record: schema line + canonical JSON of everything but the attestation. */
export function canonicalLoopPayload(rec) { const { attestation: _a, ...rest } = rec || {}; return `${rec?.schema ?? ''}\n${canonical(rest)}`; }
export const loopPayloadDigest = (rec) => 'sha256:' + createHash('sha256').update(canonicalLoopPayload(rec), 'utf8').digest('hex');

/** Sign either record with an ed25519 private key PEM as a registered issuer. Returns a new record. */
export function signLoopRecord(rec, { issuer, privateKeyPem, issuedAt = new Date().toISOString() }) {
  if (!isStr(issuer) || !isStr(privateKeyPem)) throw new Error('signLoopRecord: issuer id and private key PEM are required');
  const unsigned = { ...rec, attestation: null };
  const signature = edSign(null, Buffer.from(canonicalLoopPayload(unsigned), 'utf8'), privateKeyPem).toString('base64');
  return { ...unsigned, attestation: { issuer, mechanism: 'ed25519', payload_digest: loopPayloadDigest(unsigned), signature, validity: { issued_at: issuedAt } } };
}

function signatureFindings(rec, label, { issuers, requireSignature, now, notices }) {
  const att = rec.attestation;
  if (!att) {
    if (requireSignature) return [`${label}: UNSIGNED — a draft, not an attestation`];
    notices?.push(`${label}: unsigned draft`); return [];
  }
  const f = [];
  if (att.payload_digest && att.payload_digest !== loopPayloadDigest(rec)) f.push(`${label}: payload_digest does not match the record — a field changed after signing`);
  if (!issuers) { notices?.push(`${label}: signature NOT VERIFIED — no attestation-issuers registry here`); return f; }
  return [...f, ...verifySignatureOver(canonicalLoopPayload(rec), att, issuers, `${label} record`, { now })];
}
