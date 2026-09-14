// The provenance rules — what must be true of a record BEFORE it leaves the tree (2.1.0,
// hardening plan row 2.6; PRD loom-kosli F5). Pure: reads nothing, spawns nothing. The seam
// (core/external-record.mjs) refuses to post an envelope this module finds against, and
// scripts/provenance-check.mjs applies the same rules to every envelope the tree still holds —
// the queued ones in .loom/record-outbox/ and the copies the gate runner keeps beside its
// evidence. One rule set, two callers, so the record can never carry what the gate would refuse.
//
//   PR1  tool run required   — a gate record names the mechanism that ran and the result it
//                              emitted; a result nobody's tool produced is a claim
//   PR2  no self-attestation — a review or an acceptance whose actor authored the thing reviewed
//                              is one party asserting twice (core/separation.mjs)
//   PR3  not narrated        — an agent may NARRATE intent, a problem selection, a design decision
//                              or a locked spec; every other kind must originate from a tool or a
//                              human, never from prose
//   PR4  human acceptance    — `accepted` is a human's act; an agent actor cannot accept
//   PR5  timestamp sanity    — produced_at parses, is not in the future, and is not later than
//                              the signature over it
//   PR6  runner identity     — the envelope names the CI runner that produced it (subject,
//                              repository, ref, sha) and the sha is the commit being attested;
//                              a record with no runner is a record anyone could have written
//
// What these rules PREVENT: an agent skipping the tool and typing the verdict; an agent attesting
// its own work; a record with no author and no runner. What they CANNOT prevent: a compromised
// tool lying, or a compromised runner — those are the platform's to evidence (docs/threat-model.md).
import { createHash, sign as edSign } from 'node:crypto';
import { verifySignatureOver } from './attestations.mjs';
import { identityKey, requireSeparate } from './separation.mjs';

export const SCHEMA_ID = 'loom.record-envelope/v1';
/** Every kind the seam carries (kosli-seam.md §3). */
export const KINDS = ['intent', 'problem-selected', 'gate', 'risk-class', 'spec-locked', 'design-decision', 'review', 'accepted', 'discovery-stopped', 'reopened-discovery', 'seal-anchor'];
/** Kinds an agent may NARRATE (PR3). Everything else originates from a tool or a human. */
export const NARRATABLE = new Set(['intent', 'problem-selected', 'design-decision', 'spec-locked']);
export const ORIGINS = ['tool', 'human', 'narrated'];
export const RUNNER_FIELDS = ['subject', 'repository', 'ref', 'sha'];
export const GATE_RESULTS = new Set(['pass', 'pass-cached', 'fail', 'timeout', 'error']);
/** How far ahead of "now" a produced_at may sit before it is a clock problem, not a record. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const parseTime = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : null; };

/** Canonical JSON (sorted keys, no undefined) — the bytes a signature is over. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

/** The signed bytes: the whole envelope with `attestation`, `payload_digest` (derived) and `record` (the post result) left out. */
export function canonicalEnvelopePayload(env) {
  const { attestation, payload_digest, record, ...rest } = env; // eslint-disable-line no-unused-vars
  return canonical(rest);
}
export const payloadDigest = (env) => 'sha256:' + createHash('sha256').update(canonicalEnvelopePayload(env), 'utf8').digest('hex');

/**
 * Build an unsigned envelope. `subject` is { flow, trail } — the provider maps the flow name;
 * the trail is the change id (delivery) or the run slug (discovery). `actor` is the registry
 * identity that PRODUCED the record (id, kind, and for an agent its model pins + harness_role);
 * `runner` is the CI runner identity (PR6). `payload` is the artifact the harness already has —
 * a gate-runner row, a compiled plan's tier and hash, a reviewer verdict — never a paraphrase.
 */
export function buildEnvelope({ kind, name, subject, commit, actor, runner = null, payload = {}, attachments = [], compliant = true, origin = 'tool', producedAt = new Date().toISOString(), controls = null }) {
  const env = {
    schema: SCHEMA_ID,
    kind, name, subject, commit, produced_at: producedAt, origin,
    actor: actor ?? null,
    runner,
    compliant: compliant !== false,
    attachments: Array.isArray(attachments) ? attachments : [],
    // row 3.5 — which obligations this record answers (core/record-controls.mjs); null when the caller had no register
    controls: controls && typeof controls === 'object' ? controls : null,
    payload,
    attestation: null,
  };
  env.payload_digest = payloadDigest(env);
  return env;
}

/** Sign with ed25519. The key is never read from the tree — the caller loads it from where the runner is. */
export function signEnvelope(env, { issuer, privateKeyPem, issuedAt = new Date().toISOString() }) {
  if (!isStr(issuer)) throw new Error('signEnvelope: issuer id is required');
  if (!isStr(privateKeyPem)) throw new Error('signEnvelope: a private key PEM is required — the key is never read from the tree');
  const unsigned = { ...env, attestation: null };
  unsigned.payload_digest = payloadDigest(unsigned);
  const signature = edSign(null, Buffer.from(canonicalEnvelopePayload(unsigned), 'utf8'), privateKeyPem).toString('base64');
  return { ...unsigned, attestation: { issuer, mechanism: 'ed25519', payload_digest: unsigned.payload_digest, signature, validity: { issued_at: issuedAt } } };
}

/** Signature findings over the envelope's canonical payload ([] ⇒ authentically signed by a registered issuer). */
export function verifyEnvelope(env, issuers, opts = {}) {
  if (!env?.attestation) return ['record envelope is unsigned — an unsigned record is refused as evidence and never posted'];
  const f = [];
  if (env.attestation.payload_digest !== payloadDigest(env)) f.push('record envelope payload_digest does not match its content — the envelope changed after it was signed');
  f.push(...verifySignatureOver(canonicalEnvelopePayload(env), env.attestation, issuers, 'record envelope', opts));
  return f;
}

/**
 * The six rules over one envelope. `registry` (identities.json, parsed) resolves actor ids;
 * `issuers` (attestation-issuers.json, parsed) verifies the signature when given; `requireSignature`
 * false skips the signature (a shape check on a draft, never evidence).
 * Returns findings ([] ⇒ the envelope may leave the tree).
 */
export function evaluateProvenance(env, { registry = null, issuers = null, requireSignature = true, now = Date.now() } = {}) {
  const f = [];
  if (!env || typeof env !== 'object') return ['record envelope is not an object'];
  if (env.schema !== SCHEMA_ID) f.push(`record envelope schema is ${JSON.stringify(env.schema)}, expected ${SCHEMA_ID}`);
  if (!KINDS.includes(env.kind)) f.push(`record envelope kind ${JSON.stringify(env.kind)} is not one the seam carries (${KINDS.join(', ')})`);
  if (!isStr(env.name)) f.push('record envelope has no name — the provider stores records by name and a nameless one cannot be read back');
  if (!isStr(env.subject?.flow) || !isStr(env.subject?.trail)) f.push('record envelope subject must name a flow and a trail — a record bound to no change or run is a loose fact');
  if (!/^[0-9a-f]{40}$/.test(String(env.commit || ''))) f.push(`record envelope commit ${JSON.stringify(env.commit)} is not a 40-hex sha — a record must bind to the commit it describes`);
  if (!ORIGINS.includes(env.origin)) f.push(`record envelope origin ${JSON.stringify(env.origin)} is not one of ${ORIGINS.join(', ')}`);

  const who = env.actor;
  const resolved = who && registry ? (registry.identities || []).find((i) => identityKey(i.id) === identityKey(who)) : null;
  if (!who || !isStr(identityKey(who))) f.push('record envelope names no actor — a record nobody produced is a claim with no author');
  else if (registry && !resolved) f.push(`record envelope actor ${JSON.stringify(identityKey(who))} does not resolve in the identity registry — an actor nobody registered is nobody`);
  const actorKind = resolved?.kind ?? who?.kind ?? null;
  if (actorKind === 'agent') {
    const model = resolved?.model ?? who?.model;
    if (!model?.model_id) f.push(`record envelope actor ${JSON.stringify(identityKey(who))} is an agent with no model pin — the actor record must say WHICH model produced this (decision K4)`);
  }

  // PR1 — a gate record is a tool's output, and says which tool.
  if (env.kind === 'gate') {
    const p = env.payload || {};
    if (!isStr(p.gate) || !p.gate.endsWith('.mjs')) f.push('PR1: gate record names no mechanism (payload.gate) — a gate result must come from the tool that ran');
    if (!GATE_RESULTS.has(p.result)) f.push(`PR1: gate record result ${JSON.stringify(p.result)} is not a runner result (${[...GATE_RESULTS].join(', ')}) — a verdict the runner did not emit is a narration`);
    if (!Array.isArray(p.controls) || p.controls.length === 0) f.push('PR1: gate record names no controls — a result that satisfies no catalogued control evidences nothing');
    if (env.origin !== 'tool') f.push(`PR1: gate record origin is ${JSON.stringify(env.origin)}, not tool — the runner emits gate results; nothing else may`);
  }

  // PR2 — the reviewer/acceptor is not the author.
  if (env.kind === 'review' || env.kind === 'accepted') {
    const authors = Array.isArray(env.payload?.authors) ? env.payload.authors : [];
    if (!authors.length) f.push(`PR2: ${env.kind} record lists no authors of the thing ${env.kind === 'review' ? 'reviewed' : 'accepted'} — separation cannot be checked against nobody, and unchecked is not separate`);
    for (const a of authors) {
      f.push(...requireSeparate({ code: 'PR2', what: `${env.kind} record ${env.name}`, a: who, roleA: env.kind === 'review' ? 'reviewer' : 'acceptor', b: a, roleB: 'author' }));
    }
  }

  // PR3 — narration is allowed for the left-diamond kinds only.
  if (env.origin === 'narrated' && !NARRATABLE.has(env.kind)) {
    f.push(`PR3: a ${env.kind} record may not be narrated — an agent narrates intent, a problem selection, a design decision or a locked spec; a ${env.kind} originates from a tool or a human`);
  }

  // PR4 — acceptance is a human act.
  if (env.kind === 'accepted' && actorKind !== 'human') {
    f.push(`PR4: accepted record actor ${JSON.stringify(identityKey(who))} is ${actorKind ? `an ${actorKind}` : 'of unknown kind'} — acceptance is a human decision; an agent may prepare it and never make it`);
  }

  // PR5 — timestamps.
  const produced = parseTime(env.produced_at);
  if (produced === null) f.push(`PR5: produced_at ${JSON.stringify(env.produced_at)} is not a parseable ISO-8601 timestamp`);
  else if (produced > now + FUTURE_SKEW_MS) f.push(`PR5: produced_at ${env.produced_at} is in the future — a record dated after the run that produced it was not produced by that run`);
  const issued = parseTime(env.attestation?.validity?.issued_at);
  if (produced !== null && issued !== null && issued + 1000 < produced) f.push(`PR5: the signature (issued ${env.attestation.validity.issued_at}) predates the record it signs (${env.produced_at}) — a signature cannot be over content that did not yet exist`);

  // PR6 — the runner.
  const r = env.runner;
  if (!r || typeof r !== 'object') f.push('PR6: record envelope carries no runner identity — a record with no runner is a record anyone could have written');
  else {
    for (const k of RUNNER_FIELDS) if (!isStr(r[k])) f.push(`PR6: runner identity has no ${k}`);
    if (isStr(r.sha) && isStr(env.commit) && r.sha !== env.commit) f.push(`PR6: runner sha ${r.sha.slice(0, 12)}… is not the attested commit ${String(env.commit).slice(0, 12)}… — the runner that produced this record was not running the commit it describes`);
  }

  if (requireSignature) f.push(...verifyEnvelope(env, issuers, { now }));
  return f;
}
