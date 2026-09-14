// The external-record seam (2.1.0, hardening plan rows 2.2–2.5; decision K9). The ONE module the
// harness calls to put a record outside the tree the agent edits, or to read one back. It reads
// which provider the institution chose (docs/governance/provider-selection.json, role
// `external-record`), loads core/providers/<provider>.mjs, and hands over a SIGNED envelope that
// the provenance rules (core/provenance.mjs) have already passed. Three outcomes and no fourth:
//
//   recorded   the provider holds it and returned an id — stored where the caller asked
//   queued     the provider was reached and failed (network, auth, CLI exit ≠ 0) — the envelope
//              waits in .loom/record-outbox/ for scripts/record-flush-outbox.mjs
//   rejected   the provenance rules refused it — NEVER posted, NEVER queued; the fake's empty
//              call log is the proof
//
// and, orthogonal to those, `unmounted`: no provider is selected and mounted. That is a NAMED
// no-op, said aloud in every run record and status line, never a silent pass — and never a
// failure here either: a compiled plan requiring `external_record` with nobody chosen is
// PS-R06's finding (scripts/provider-selection-check.mjs), and one finding has one owner.
//
// Nothing here names Kosli. core/providers/kosli.mjs does, and only there.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateProvenance } from './provenance.mjs';

export const ROLE = 'external-record';
export const CAPABILITY = 'external_record';
export const OUTBOX_DIR = '.loom/record-outbox';
export const SELECTION_LOCATIONS = ['docs/governance/provider-selection.json', 'provider-selection.json'];
export const MOUNTED_DIR = 'docs/governance/adapters';
export const REGISTRY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];
export const ISSUERS_LOCATIONS = ['docs/governance/attestation-issuers.json', 'attestation-issuers.json'];
/** The providers this bundle ships an adapter for. A selection naming another is `mounted: false, reason: no adapter module`. */
export const KNOWN_PROVIDERS = ['kosli'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const firstPath = (locs, cwd) => locs.map((p) => join(cwd, p)).find(existsSync) || null;
const isPlaceholder = (v) => typeof v === 'string' && /^ADOPT[\s:—-]/i.test(v.trim());
const isActive = (adapter) => {
  const ev = adapter?.activation_evidence;
  if (!ev || typeof ev !== 'object') return false;
  return Object.entries(ev).filter(([k]) => !k.startsWith('_')).every(([, v]) => !isPlaceholder(v));
};

export const loadRegistry = (cwd = process.cwd()) => { const p = firstPath(REGISTRY_LOCATIONS, cwd); return p ? readJson(p) : null; };
export const loadIssuers = (cwd = process.cwd()) => { const p = firstPath(ISSUERS_LOCATIONS, cwd); return p ? readJson(p) : null; };

/**
 * Is a provider selected AND mounted for the role? Returns
 *   { mounted: false, reason }                                            — the named no-op
 *   { mounted: true, provider, adapter_id, adapter, active, module }     — ready to post
 * `active` is false while the mounted adapter's activation_evidence is still placeholders
 * (selected-not-active — the provider is used, and the status says the integration run is owed).
 */
export function status(cwd = process.cwd()) {
  const selPath = firstPath(SELECTION_LOCATIONS, cwd);
  const selections = selPath ? (readJson(selPath)?.selections || []) : [];
  const sel = selections.find((s) => s?.role === ROLE && !isPlaceholder(s.role) && !isPlaceholder(s.provider));
  if (!sel) return { mounted: false, reason: `no provider selected for role ${ROLE} in ${SELECTION_LOCATIONS[0]}` };
  if (!KNOWN_PROVIDERS.includes(sel.provider)) return { mounted: false, reason: `role ${ROLE} selects provider ${JSON.stringify(sel.provider)}, for which this bundle ships no adapter module (core/providers/${sel.provider}.mjs) — known: ${KNOWN_PROVIDERS.join(', ')}`, provider: sel.provider };
  const dir = join(cwd, MOUNTED_DIR);
  let adapter = null;
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith('.json')) continue;
      const j = readJson(join(dir, n));
      if (j && j.adapter_id === sel.adapter_id && j.role === ROLE) { adapter = j; break; }
    }
  }
  if (!adapter) return { mounted: false, reason: `role ${ROLE} selects ${sel.provider} but its adapter ${JSON.stringify(sel.adapter_id)} is not mounted at ${MOUNTED_DIR}/ — selecting is not installing (PS-R05)`, provider: sel.provider };
  return { mounted: true, provider: sel.provider, adapter_id: sel.adapter_id, adapter, active: isActive(adapter), module: new URL(`./providers/${sel.provider}.mjs`, import.meta.url).href };
}

async function loadProvider(st) {
  return import(st.module);
}

/** Queue an envelope the provider could not take. Returns the file written. */
export function queue(cwd, envelope, error) {
  const dir = join(cwd, OUTBOX_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(envelope.name || 'record').replace(/[^A-Za-z0-9._-]/g, '_');
  const file = join(dir, `${stamp}-${safe}.json`);
  writeFileSync(file, JSON.stringify({ ...envelope, record: { status: 'queued', error: String(error || ''), queued_at: new Date().toISOString() } }, null, 2) + '\n');
  return file;
}

/** Every queued envelope, oldest first: [{ file, envelope }]. */
export function listOutbox(cwd = process.cwd()) {
  const dir = join(cwd, OUTBOX_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => ({ file: join(dir, n), envelope: readJson(join(dir, n)) }));
}

/**
 * Post one envelope. Returns { status: 'rejected', findings } | { status: 'unmounted', reason }
 * | { status: 'recorded', provider, id, ref, recorded_at } | { status: 'queued', file, error }.
 * Order matters: provenance FIRST, so a bad envelope is refused whether or not anything is
 * mounted — an unmounted seam must not make a bad record look merely unrecorded.
 */
export async function post(envelope, { cwd = process.cwd(), env = process.env, registry = undefined, issuers = undefined, requireSignature = true, now = Date.now(), dryRun = false, noQueue = false } = {}) {
  const reg = registry === undefined ? loadRegistry(cwd) : registry;
  const iss = issuers === undefined ? loadIssuers(cwd) : issuers;
  const findings = evaluateProvenance(envelope, { registry: reg, issuers: iss, requireSignature, now });
  if (findings.length) return { status: 'rejected', findings };
  const st = status(cwd);
  if (!st.mounted) return { status: 'unmounted', reason: st.reason };
  const provider = await loadProvider(st);
  let r;
  try { r = await provider.post(envelope, { cwd, env, config: st.adapter.config || {}, dryRun }); }
  catch (e) { r = { ok: false, error: e.message }; }
  if (r?.ok) return { status: 'recorded', provider: st.provider, id: r.id ?? null, ref: r.ref ?? null, dry_run: !!r.dry_run, recorded_at: new Date().toISOString() };
  const error = r?.error || 'provider call failed';
  if (noQueue || dryRun) return { status: 'queued', file: null, error };
  return { status: 'queued', file: queue(cwd, envelope, error), error };
}

/**
 * Resolve a stored reference { provider, id, ... } back to the record the platform holds.
 * { status: 'unmounted' | 'mismatch' | 'resolved' | 'unresolved' | 'unavailable', ... }.
 * `mismatch` is a ref naming a provider other than the mounted one — evidence from a record
 * the institution did not choose. `unresolved` is the provider saying it does not hold the id;
 * `unavailable` is the provider not answering. Both are findings for a gate; they are told apart
 * so an outage and a forged id read differently in the log.
 */
export async function resolve(ref, { cwd = process.cwd(), env = process.env } = {}) {
  const st = status(cwd);
  if (!st.mounted) return { status: 'unmounted', reason: st.reason };
  if (!ref || typeof ref !== 'object') return { status: 'unresolved', reason: 'no reference given' };
  if (ref.provider && ref.provider !== st.provider) return { status: 'mismatch', reason: `reference names provider ${JSON.stringify(ref.provider)} but the mounted provider is ${st.provider}` };
  const provider = await loadProvider(st);
  let r;
  try { r = await provider.resolve(ref, { cwd, env, config: st.adapter.config || {} }); }
  catch (e) { r = { ok: false, unavailable: true, error: e.message }; }
  if (r?.ok) return { status: 'resolved', provider: st.provider, record: r.record };
  return { status: r?.unavailable ? 'unavailable' : 'unresolved', provider: st.provider, reason: r?.error || 'not held by the provider' };
}

/** Expected-vs-present for one subject { flow, trail }. { status: 'unmounted' } | { status: 'ok', ... } | { status: 'unavailable', reason }. */
export async function trailStatus(subject, { cwd = process.cwd(), env = process.env } = {}) {
  const st = status(cwd);
  if (!st.mounted) return { status: 'unmounted', reason: st.reason };
  const provider = await loadProvider(st);
  let r;
  try { r = await provider.trailStatus(subject, { cwd, env, config: st.adapter.config || {} }); }
  catch (e) { r = { ok: false, error: e.message }; }
  if (r?.ok) return { status: 'ok', provider: st.provider, ...r };
  return { status: 'unavailable', provider: st.provider, reason: r?.error || 'provider did not answer' };
}

/** Retry every queued envelope. A record that succeeds leaves the outbox; a rejected one is REMOVED too (it can never post) and reported. */
export async function flushOutbox({ cwd = process.cwd(), env = process.env, dryRun = false } = {}) {
  const out = { recorded: [], queued: [], rejected: [], unmounted: null };
  for (const { file, envelope } of listOutbox(cwd)) {
    if (!envelope) { out.rejected.push({ file, findings: ['unparseable outbox file'] }); continue; }
    const { record, ...env0 } = envelope; // eslint-disable-line no-unused-vars
    const r = await post(env0, { cwd, env, dryRun, noQueue: true });
    if (r.status === 'recorded') { out.recorded.push({ file, name: env0.name, id: r.id }); if (!dryRun) unlinkSync(file); }
    else if (r.status === 'rejected') { out.rejected.push({ file, name: env0.name, findings: r.findings }); if (!dryRun) unlinkSync(file); }
    else if (r.status === 'unmounted') { out.unmounted = r.reason; out.queued.push({ file, name: env0.name, error: r.reason }); }
    else out.queued.push({ file, name: env0.name, error: r.error });
  }
  return out;
}

// ── Helpers for the two producers (the gate runner and the evidence collector) ─────────────────

/** The actor record for a registry id: { id, kind, model?, harness_role? } — or a bare { id } when the registry does not know it (the provenance rules then refuse it). */
export function actorFor(cwd, id) {
  if (!id) return null;
  const reg = loadRegistry(cwd);
  const i = (reg?.identities || []).find((x) => x.id === id);
  if (!i) return { id };
  const a = { id: i.id, kind: i.kind };
  if (i.model) a.model = i.model;
  if (i.harness_role) a.harness_role = i.harness_role;
  return a;
}

/**
 * The CI runner identity (PR6) from the environment: LOOM_RUNNER_* when set, else the GitHub
 * Actions variables. `sha` is the attested commit when the environment does not say otherwise —
 * a runner that cannot name what it ran is refused by PR6, not defaulted past it.
 */
export function runnerFromEnv(env = process.env, commit = null) {
  const pick = (...ks) => { for (const k of ks) if (typeof env[k] === 'string' && env[k].trim()) return env[k].trim(); return null; };
  const repository = pick('LOOM_RUNNER_REPOSITORY', 'GITHUB_REPOSITORY');
  const ref = pick('LOOM_RUNNER_REF', 'GITHUB_REF');
  const sha = pick('LOOM_RUNNER_SHA', 'GITHUB_SHA') || commit;
  const subject = pick('LOOM_RUNNER_SUBJECT') || (repository && ref ? `repo:${repository}:ref:${ref}` : null);
  if (!repository || !ref || !sha || !subject) return null;
  const r = { subject, repository, ref, sha };
  const run = pick('LOOM_RUNNER_RUN', 'GITHUB_RUN_ID'); if (run) r.run = run;
  return r;
}

/** Read the signing material named on a CLI: { issuer, privateKeyPem } or null when either half is missing. The key is a path, never content in the tree. */
export function signerFromArgs({ issuer = null, keyPath = null } = {}, env = process.env) {
  const iss = issuer || env.LOOM_RECORD_ISSUER || null;
  const kp = keyPath || env.LOOM_RECORD_KEY || null;
  if (!iss || !kp) return null;
  try { return { issuer: iss, privateKeyPem: readFileSync(kp, 'utf8') }; } catch { return null; }
}

/** What the provider says is running in `environment` (row 2.10). { status: 'unmounted' | 'unsupported' | 'ok' | 'unavailable' | 'unresolved' }. */
export async function environmentSnapshot(environment, { cwd = process.cwd(), env = process.env } = {}) {
  const st = status(cwd);
  if (!st.mounted) return { status: 'unmounted', reason: st.reason };
  const provider = await loadProvider(st);
  if (typeof provider.environmentSnapshot !== 'function') return { status: 'unsupported', provider: st.provider, reason: `provider ${st.provider} keeps no environment snapshots` };
  let r;
  try { r = await provider.environmentSnapshot(environment, { cwd, env, config: st.adapter.config || {} }); }
  catch (e) { r = { ok: false, unavailable: true, error: e.message }; }
  if (r?.ok) return { status: 'ok', provider: st.provider, environment: r.environment, artifacts: r.artifacts };
  return { status: r?.unavailable ? 'unavailable' : 'unresolved', provider: st.provider, reason: r?.error || 'no snapshot' };
}
