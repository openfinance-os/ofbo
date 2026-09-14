// The Kosli provider for the `external-record` role (2.1.0, hardening plan rows 2.2–2.3;
// decisions K7, K9). The ONLY module in the harness that spells a Kosli command. Every method
// cites the row of docs/kosli-surface.md it was verified against; when the CLI moves, that file
// moves first. All calls go through core/kosli-cli.mjs, so the whole adapter is testable against
// core/kosli-fake.mjs without an org.
//
// Auth is never on argv: KOSLI_API_TOKEN stays in the runner's environment and the CLI reads it
// itself (kosli-surface.md, global flags). `--org` and `--host` come from the mounted adapter's
// config; an ADOPT placeholder there is left OUT, so the CLI's own "org is required" error is what
// an unconfigured adapter produces — and that error is a queued envelope, not a crash.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKosli } from '../kosli-cli.mjs';

export const NAME = 'kosli';
export const SURFACE = 'docs/kosli-surface.md';
export const DEFAULT_HOST = 'https://app.kosli.com';
export const DEFAULT_FLOWS = { delivery: 'loom-delivery', discovery: 'loom-discovery' };

const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const set = (v) => typeof v === 'string' && v.trim() && !isPlaceholder(v);

/** Global flags from the adapter config (kosli-surface.md, "Global flags"). Never the token. */
export function globalArgs(config = {}) {
  const a = [];
  if (set(config.org)) a.push('--org', config.org.trim());
  if (set(config.host) && config.host.trim() !== DEFAULT_HOST) a.push('--host', config.host.trim());
  return a;
}

/** The Kosli flow a Loom subject maps to: config.flows[subject.flow], else the default, else the name as given. */
export function flowName(subject, config = {}) {
  const f = subject?.flow;
  const flows = config.flows && typeof config.flows === 'object' ? config.flows : {};
  if (set(flows[f])) return flows[f];
  return DEFAULT_FLOWS[f] || f;
}

/** `kosli begin trail` — create-or-update, idempotent (kosli-surface.md, beginTrail row). */
export function beginTrail({ flow, trail, description = null, commit = null }, { cwd, env, config = {}, dryRun = false } = {}) {
  const args = ['begin', 'trail', trail, '--flow', flow];
  if (set(description)) args.push('--description', description);
  if (set(commit)) args.push('--commit', commit);
  if (dryRun) args.push('--dry-run');
  const r = runKosli([...args, ...globalArgs(config)], { cwd, env });
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, args: r.args };
}

/** The attestation ids a trail holds, by name — from `get trail --output json` (kosli-surface.md, resolve/trailStatus row). */
export function readTrail({ flow, trail }, { cwd, env, config = {} } = {}) {
  const r = runKosli(['get', 'trail', trail, '--flow', flow, '--output', 'json', ...globalArgs(config)], { cwd, env });
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'get trail failed').trim(), unavailable: r.status === null };
  const j = r.json;
  if (!j || typeof j !== 'object') return { ok: false, error: 'get trail printed no JSON', unavailable: true };
  const cs = j.compliance_status || {};
  const rows = [];
  for (const a of cs.attestations_statuses || []) rows.push({ name: a.attestation_name, type: a.attestation_type, id: a.attestation_id ?? null, status: a.status ?? null, compliant: a.is_compliant ?? null, unexpected: !!a.unexpected, artifact: null });
  for (const [art, s] of Object.entries(cs.artifacts_statuses || {})) {
    for (const a of s?.attestations_statuses || []) rows.push({ name: a.attestation_name, type: a.attestation_type, id: a.attestation_id ?? null, status: a.status ?? null, compliant: a.is_compliant ?? null, unexpected: !!a.unexpected, artifact: art });
  }
  return { ok: true, trail: j.name ?? trail, flow, compliance: cs.status ?? j.compliance_state ?? null, compliant: cs.is_compliant ?? null, attestations: rows, events: Array.isArray(j.events) ? j.events : [] };
}

/**
 * Post a signed envelope as a generic attestation (kosli-surface.md, post row): begin the trail
 * (idempotent), `attest generic --user-data <envelope>`, then read the id back from the trail.
 * Returns { ok, id, ref, dry_run } or { ok: false, error, stage }.
 */
export async function post(envelope, { cwd = process.cwd(), env = process.env, config = {}, dryRun = false } = {}) {
  const flow = flowName(envelope.subject, config);
  const trail = envelope.subject.trail;
  const began = beginTrail({ flow, trail, description: `Loom ${envelope.subject.flow} trail ${trail}`, commit: envelope.commit }, { cwd, env, config, dryRun });
  if (!began.ok) return { ok: false, stage: 'begin-trail', error: (began.stderr || began.stdout || 'begin trail failed').trim() };
  const dir = mkdtempSync(join(tmpdir(), 'loom-record-'));
  try {
    const userData = join(dir, 'envelope.json');
    writeFileSync(userData, JSON.stringify(envelope));
    const args = ['attest', 'generic', '--name', envelope.name, '--flow', flow, '--trail', trail, '--user-data', userData,
      `--compliant=${envelope.compliant === false ? 'false' : 'true'}`,
      '--description', `${envelope.kind} · ${envelope.schema}`,
      '--annotate', `loom_kind=${envelope.kind}`, '--annotate', `loom_schema=${envelope.schema}`, '--annotate', `loom_actor=${envelope.actor?.id ?? ''}`];
    if (typeof envelope.commit === 'string' && envelope.commit) args.push('--commit', envelope.commit);
    if (Array.isArray(envelope.attachments) && envelope.attachments.length) args.push('--attachments', envelope.attachments.join(','));
    if (dryRun) args.push('--dry-run');
    const r = runKosli([...args, ...globalArgs(config)], { cwd, env });
    if (!r.ok) return { ok: false, stage: 'attest', error: (r.stderr || r.stdout || 'attest generic failed').trim() };
    if (dryRun) return { ok: true, id: null, dry_run: true, ref: { provider: NAME, flow, trail, name: envelope.name, id: null } };
    // The CLI prints a prose line and no id; the trail lists the id by name.
    const t = readTrail({ flow, trail }, { cwd, env, config });
    if (!t.ok) return { ok: false, stage: 'read-id', error: t.error };
    const mine = t.attestations.filter((a) => a.name === envelope.name && a.id);
    if (!mine.length) return { ok: false, stage: 'read-id', error: `attestation ${envelope.name} was reported but the trail ${trail} lists no id for it` };
    const id = mine[mine.length - 1].id;
    return { ok: true, id, ref: { provider: NAME, flow, trail, name: envelope.name, id } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Resolve a ref by id (`get attestation --attestation-id`), or by name on its trail (kosli-surface.md, resolve rows). */
export async function resolve(ref, { cwd = process.cwd(), env = process.env, config = {} } = {}) {
  if (ref?.id) {
    const r = runKosli(['get', 'attestation', '--attestation-id', String(ref.id), '--output', 'json', ...globalArgs(config)], { cwd, env });
    if (r.status === null) return { ok: false, unavailable: true, error: r.stderr };
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'get attestation failed').trim() };
    const rec = Array.isArray(r.json?.data) ? r.json.data[0] : r.json;
    if (!rec || typeof rec !== 'object' || !rec.attestation_name) return { ok: false, error: `attestation id ${ref.id} resolved to no record` };
    if (ref.name && rec.attestation_name !== ref.name) return { ok: false, error: `attestation id ${ref.id} is ${JSON.stringify(rec.attestation_name)}, not ${JSON.stringify(ref.name)}` };
    return { ok: true, record: rec };
  }
  if (ref?.trail && ref?.name) {
    const t = readTrail({ flow: ref.flow || flowName({ flow: 'delivery' }, config), trail: ref.trail }, { cwd, env, config });
    if (!t.ok) return t;
    const hit = t.attestations.find((a) => a.name === ref.name && a.id);
    return hit ? { ok: true, record: { attestation_name: hit.name, attestation_type: hit.type, attestation_id: hit.id, is_compliant: hit.compliant } } : { ok: false, error: `trail ${ref.trail} holds no attestation named ${ref.name}` };
  }
  return { ok: false, error: 'a reference needs an id, or a trail and a name' };
}

/** Expected-vs-present on a trail: what the template expects (MISSING rows) against what is there. */
export async function trailStatus(subject, { cwd = process.cwd(), env = process.env, config = {} } = {}) {
  const flow = flowName(subject, config);
  const t = readTrail({ flow, trail: subject.trail }, { cwd, env, config });
  if (!t.ok) return t;
  return { ok: true, flow, trail: t.trail, compliance: t.compliance, compliant: t.compliant, present: t.attestations.filter((a) => a.id), missing: t.attestations.filter((a) => !a.id).map((a) => a.name), unexpected: t.attestations.filter((a) => a.unexpected).map((a) => a.name), events: t.events };
}

// ── Row 2.9: render the neutral policy and types in Kosli's forms (kosli-surface.md, evaluate row + create attestation-type) ──

/** Rego for `kosli evaluate trail --policy docs/governance/record/kosli-policy.rego` over input.trail. */
export function renderPolicy(policy) {
  const names = policy.required.map((r) => r.name);
  const rego = `# GENERATED by scripts/record-policy-compile.mjs --render (kosli) from control catalog ${policy.catalog_sha256}
# Do not edit: the catalog is the one source of gate definitions (decision K3). Evaluate with
#   kosli evaluate trail <CHG> --flow <flow> --policy docs/governance/record/kosli-policy.rego --output json
package loom.route

import rego.v1

required := ${JSON.stringify(names)}

attestations := {a.attestation_name: a | some a in input.trail.compliance_status.attestations_statuses}

missing contains name if {
  some name in required
  not attestations[name]
}

missing contains name if {
  some name in required
  attestations[name].attestation_id == null
}

non_compliant contains name if {
  some name in required
  attestations[name].is_compliant == false
}

unexpected contains name if {
  some a in input.trail.compliance_status.attestations_statuses
  a.unexpected == true
  name := a.attestation_name
}

default allow := false

allow if {
  count(missing) == 0
  count(non_compliant) == 0
}

deny contains msg if {
  some name in missing
  msg := sprintf("required record %s is missing from the trail", [name])
}

deny contains msg if {
  some name in non_compliant
  msg := sprintf("required record %s is present but non-compliant", [name])
}
`;
  return { 'docs/governance/record/kosli-policy.rego': rego, 'docs/governance/record/kosli-policy.catalog-sha256': `${policy.catalog_sha256}\n` };
}

/** One `kosli create attestation-type` per type: the schema file, the jq rule, and a script that applies them (create-or-update). */
export function renderTypes(types) {
  const files = {};
  const lines = ['#!/usr/bin/env sh', `# GENERATED by scripts/record-types-compile.mjs --render (kosli) from control catalog ${types.catalog_sha256}`, '# create attestation-type is create-or-update (kosli-surface.md); versioning of a type is unconfirmed (question 6).', 'set -e', 'D="$(dirname "$0")"'];
  for (const t of types.types) {
    files[`docs/governance/record/types/${t.name}.schema.json`] = JSON.stringify({ type: 'object', required: ['payload'], properties: { payload: t.schema } }, null, 2) + '\n';
    const jq = t.pass.in ? `.payload.${t.pass.field.replace(/^payload\./, '')} as $v | ${JSON.stringify(t.pass.in)} | index($v) != null` : `.payload.${t.pass.field.replace(/^payload\./, '')} | test(${JSON.stringify(t.pass.matches)})`;
    lines.push(`kosli create attestation-type ${t.name} --description ${JSON.stringify(t.description)} --schema "$D/types/${t.name}.schema.json" --jq '${jq}' "$@"`);
  }
  files['docs/governance/record/kosli-types.sh'] = lines.join('\n') + '\n';
  files['docs/governance/record/kosli-types.catalog-sha256'] = `${types.catalog_sha256}\n`;
  return files;
}

// ── Row 2.10: the environment snapshot (kosli-surface.md, `get snapshot ENV --output json`) ──

/** What is running in a Kosli environment: { ok, artifacts: [{ artifact, fingerprint, flow, git_commit, replicas, running_since }] }. */
export function environmentSnapshot(environment, { cwd = process.cwd(), env = process.env, config = {} } = {}) {
  const r = runKosli(['get', 'snapshot', String(environment), '--output', 'json', ...globalArgs(config)], { cwd, env });
  if (r.status === null) return { ok: false, unavailable: true, error: r.stderr };
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'get snapshot failed').trim() };
  const list = Array.isArray(r.json) ? r.json : Array.isArray(r.json?.artifacts) ? r.json.artifacts : null;
  if (!list) return { ok: false, unavailable: true, error: 'get snapshot printed no artifact list' };
  return { ok: true, environment: String(environment), artifacts: list.map((a) => ({ artifact: a.artifact ?? a.image ?? null, fingerprint: a.fingerprint ?? null, flow: a.flow ?? a.flow_name ?? null, git_commit: a.git_commit ?? null, replicas: a.replicas ?? null, running_since: a.running_since ?? null })) };
}
