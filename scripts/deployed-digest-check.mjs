// The deploy gate (rc.39 · flow-plan Phase 5.4) — the DEPLOY LANE'S FIRST CONTROL.
//
// Until now the deploy lane was empty. rc.33 found that `ci.yml` invoked it anyway, so it was a
// CI step that structurally could not fail, and the fix at the time was to delete the invocation
// and make the runner refuse an empty lane ("an empty lane is a hole, not a pass"). That guard
// stands; this file is what retires it, because the lane now carries a control.
//
// Everything upstream of here binds the release to an IMMUTABLE ARTIFACT DIGEST: the subject
// (release-subject.json), the evidence chain sealed against it, the attestations, the compound
// production authorization. Every one of those is a statement about a digest. None of them was
// ever compared to what actually went out. The gap is not theoretical — "the approved build" and
// "the deployed build" diverge through a re-tagged image, a hand-run promotion, a rebuilt
// artifact from the same commit, or a rollback that was never rolled forward. Two questions, both
// answerable from the repository and neither previously asked:
//
//   ① IS THE DEPLOYED THING THE AUTHORIZED THING?  deployed_digest must equal the digest in
//      docs/governance/release-subject.json. Not the same commit — the same DIGEST. A rebuild of
//      the same source is a different artifact and it was not the one that was evaluated.
//   ② DID IT GO OUT THE WAY IT WAS DECLARED TO?    the strategy, the flag and every declared
//      stage of the service's `progressive_delivery` block (Phase 5.3) must appear in the record,
//      in order, at the declared traffic, each having baked for at least its declared time. A
//      canary that jumped straight to 100% did not go out under the strategy that was approved,
//      whatever the deploy log calls itself.
//
// And because promotion INTO an approval-required environment is the one hop the second-line hold
// exists for, a deployment naming such an environment must carry an `authorized_by` who is a real
// non-builder human and is NOT the deployer. Four eyes at the last rung of the ladder.
//
// ON THE BAKE CHECK AND THE "NOTHING GATES ON TIME" RULE: this reads a clock and it is not a flow
// metric. Nothing here is judged against an SLA, a target or a budget — the gate compares the bake
// a human DECLARED against the bake that was OBSERVED. That is a control being verified, the same
// shape as a freshness window, and the opposite of gating a merge on how long something took.
//
// Silence where there is nothing to check: a repository with no docs/governance/deployments/ has
// deployed nothing this gate can see and is not failing. Once a record exists, the subject, the
// estate and the service readiness it refers to must all exist — a deployment that cannot be
// checked against an authorized subject is exactly the case this gate was built for.
//
// Lane: deploy. Run from the repo root: `node scripts/deployed-digest-check.mjs` (exit 1 on a finding).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { environmentSnapshot, status as recordStatus } from '../core/external-record.mjs';

export const DEPLOYMENTS_DIR = 'docs/governance/deployments';
export const SUBJECT_LOCATIONS = ['docs/governance/release-subject.json', 'release-subject.json'];
export const ENVIRONMENT_LOCATIONS = ['docs/governance/environments.json', 'environments.json'];
export const SERVICES_DIR = 'docs/governance/services';
const IDENTITY_LOCATIONS = ['docs/governance/identities.json', 'identities.json'];

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const MINUTE = 60_000;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const identityOf = (registry, id) => (registry?.identities || []).find((i) => i.id === id);

/**
 * Findings for ONE deployment record. Pure over its inputs so the whole gate is testable without
 * a tree: `subject` is the authorized release subject, `environments` the declared estate,
 * `service` that service's readiness record, `registry` the identity registry.
 */
export function evaluate(d, { subject = null, environments = null, service = null, registry = null } = {}) {
  const findings = [];
  const id = nonEmpty(d?.deployment_id) ? d.deployment_id : '(no deployment_id)';
  if (!nonEmpty(d?.deployment_id)) findings.push('a deployment record has no deployment_id');
  for (const f of ['service_id', 'environment', 'deployed_by']) {
    if (!nonEmpty(d?.[f])) findings.push(`${id}: no ${f}`);
  }
  if (!nonEmpty(d?.deployed_at) || Number.isNaN(Date.parse(d.deployed_at))) findings.push(`${id}: deployed_at is not an ISO-8601 timestamp`);

  // ① THE DIGEST.
  if (!SHA256.test(d?.deployed_digest || '')) {
    findings.push(`${id}: deployed_digest ${JSON.stringify(d?.deployed_digest)} is not a sha256:… digest — what went out is identified by its digest or it is not identified`);
  } else if (!subject) {
    findings.push(`${id}: there is no ${SUBJECT_LOCATIONS[0]} to check the deployed digest against — a deployment with no authorized subject is an unreviewed release, not an unverifiable one`);
  } else if (subject.artifact === null) {
    findings.push(`${id}: the release subject declares artifact: null (a non-artifact repository) yet something was deployed with digest ${d.deployed_digest}`);
  } else if (!SHA256.test(subject?.artifact?.digest || '')) {
    findings.push(`${id}: the release subject carries no usable artifact.digest — release-subject-check is the gate for that, and this deployment cannot be bound until it passes`);
  } else if (subject.artifact.digest !== d.deployed_digest) {
    findings.push(`${id}: DEPLOYED DIGEST IS NOT THE AUTHORIZED DIGEST — deployed ${d.deployed_digest}, authorized ${subject.artifact.digest}. Same source is not the same artifact: the evaluation, the evidence chain and the production authorization all name the authorized digest, and none of them describes what is running`);
  }
  if (nonEmpty(d?.release_commit) && subject?.source?.commit && d.release_commit !== subject.source.commit) {
    findings.push(`${id}: release_commit ${d.release_commit} is not the subject's source commit ${subject.source.commit}`);
  }

  // The environment, and four eyes on the last rung.
  let env = null;
  if (nonEmpty(d?.environment)) {
    if (!Array.isArray(environments)) {
      findings.push(`${id}: no declared environment estate (${ENVIRONMENT_LOCATIONS[0]}) — a deployment target this repository does not describe cannot be checked for data classification or approval posture`);
    } else {
      env = environments.find((e) => e?.id === d.environment) || null;
      if (!env) findings.push(`${id}: environment ${JSON.stringify(d.environment)} is not a declared environment`);
    }
  }
  if (env?.approval_required === true) {
    if (!nonEmpty(d?.authorized_by)) {
      findings.push(`${id}: promotes into ${env.id}, which requires approval, and names no authorized_by — this is the hop the second-line hold exists for`);
    } else {
      if (d.authorized_by === d.deployed_by) findings.push(`${id}: authorized_by and deployed_by are both ${JSON.stringify(d.deployed_by)} — an approval you give yourself is not an approval`);
      if (!registry) findings.push(`${id}: authorized_by ${JSON.stringify(d.authorized_by)} cannot be resolved — no identity registry found`);
      else {
        const who = identityOf(registry, d.authorized_by);
        if (!who) findings.push(`${id}: authorized_by ${JSON.stringify(d.authorized_by)} does not resolve in the identity registry`);
        else if (who.kind === 'agent') findings.push(`${id}: authorized_by ${JSON.stringify(d.authorized_by)} is an agent — an agent does not authorize a production promotion`);
        else if ((who.groups || []).includes('builders')) findings.push(`${id}: authorized_by ${JSON.stringify(d.authorized_by)} is in the builders group — the second-line hold is not released by first line`);
      }
    }
  }

  // ② THE DECLARED STRATEGY.
  const pd = service?.progressive_delivery;
  if (!service) {
    findings.push(`${id}: no readiness record at ${SERVICES_DIR}/${d?.service_id}.json — the declared rollout strategy lives there, so there is nothing to check this deployment against`);
  } else if (!pd || typeof pd !== 'object') {
    findings.push(`${id}: service ${d?.service_id} declares no progressive_delivery block — a deployment record claiming a strategy the service never declared is a claim about nothing`);
  } else {
    if (d?.strategy !== pd.strategy) {
      findings.push(`${id}: deployed under strategy ${JSON.stringify(d?.strategy)} but ${d?.service_id} declares ${JSON.stringify(pd.strategy)} — it did not go out the way it was approved to`);
    }
    if (nonEmpty(pd.feature_flag_ref) && d?.feature_flag_ref !== pd.feature_flag_ref) {
      findings.push(`${id}: feature_flag_ref ${JSON.stringify(d?.feature_flag_ref)} is not the service's declared exposure switch ${JSON.stringify(pd.feature_flag_ref)}`);
    }
    const declared = Array.isArray(pd.stages) ? pd.stages : [];
    const done = Array.isArray(d?.stages_completed) ? d.stages_completed : null;
    if (!done) {
      findings.push(`${id}: no stages_completed — a progressive deployment that records no stages is indistinguishable from one that skipped them`);
    } else {
      if (done.length !== declared.length) {
        findings.push(`${id}: completed ${done.length} stage(s) against ${declared.length} declared (${declared.map((s) => s?.name).join(' → ')}) — a stage that was skipped is exposure that was never baked`);
      }
      declared.forEach((want, i) => {
        const got = done[i];
        const at = `${id}: stage ${i + 1} (${want?.name})`;
        if (!got) { findings.push(`${at} was not completed`); return; }
        if (got.name !== want.name) findings.push(`${at} is recorded as ${JSON.stringify(got.name)} — the ramp ran in a different order than it was declared in`);
        if (got.traffic_pct !== want.traffic_pct) findings.push(`${at} ran at ${JSON.stringify(got.traffic_pct)}% against a declared ${want.traffic_pct}%`);
        const t0 = Date.parse(got.started_at);
        const t1 = Date.parse(got.completed_at);
        if (Number.isNaN(t0) || Number.isNaN(t1)) { findings.push(`${at} has no parseable started_at/completed_at — an unbaked stage and an unrecorded one look the same`); return; }
        if (t1 < t0) { findings.push(`${at} completed before it started`); return; }
        const baked = Math.floor((t1 - t0) / MINUTE);
        if (Number.isFinite(want.bake_minutes) && baked < want.bake_minutes) {
          findings.push(`${at} baked ${baked}m against a declared ${want.bake_minutes}m — the bake is the observation window the SLOs are watched in; cutting it short is not a faster rollout, it is an unwatched one`);
        }
      });
    }
  }
  return findings;
}

/** Read every deployment record and its context from an adopted (or bundle) tree. */
export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${DEPLOYMENTS_DIR}`;
  if (!existsSync(dir)) return { present: false, findings: [], count: 0 };
  const subjectPath = SUBJECT_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const envPath = ENVIRONMENT_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const registryPath = IDENTITY_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const subject = subjectPath ? readJson(subjectPath) : null;
  const environments = envPath ? readJson(envPath)?.environments ?? null : null;
  const registry = registryPath ? readJson(registryPath) : null;
  const findings = [];
  let count = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    count++;
    const d = readJson(`${dir}/${name}`);
    if (!d) { findings.push(`${name}: not parseable JSON`); continue; }
    const service = nonEmpty(d.service_id) ? readJson(`${cwd}/${SERVICES_DIR}/${d.service_id}.json`) : null;
    findings.push(...evaluate(d, { subject, environments, service, registry }));
  }
  return { present: true, findings, count };
}

/**
 * 2.1.0 (hardening plan row 2.10, decision K9): what is RUNNING, read from the provider when one
 * is mounted and keeps environment snapshots; the repo's own deployment record otherwise — and
 * the run says which. Pure over injected state: `snapshotFn(environmentName)` is
 * core/external-record.mjs environmentSnapshot(). Per deployment record:
 *   unmounted / unsupported  → note: "read the repo record"
 *   snapshot ok              → the deployed digest must be running in that environment (a digest
 *                              the platform does not see running was not deployed, whatever the
 *                              record says); a different digest running is the drift this lane
 *                              exists to catch
 *   unavailable / unresolved → finding (an outage is not a pass on the deploy lane)
 * The provider's environment name is environments.json `external_record_environment` when set,
 * else the environment id.
 */
export async function snapshotFindings(deployments, { status, snapshotFn, environments = null, notes = null }) {
  const findings = [];
  if (!status?.mounted) { notes?.push(`environment snapshot: read the REPO RECORD — external record ${status?.reason ? `not mounted (${status.reason})` : 'not mounted'}`); return findings; }
  const cache = new Map();
  for (const d of deployments) {
    const id = d?.deployment_id || '(no deployment_id)';
    if (!d?.environment || !SHA256.test(d?.deployed_digest || '')) continue; // shape findings already raised
    const decl = Array.isArray(environments) ? environments.find((e) => e?.id === d.environment) : null;
    const mapped = decl?.external_record_environment;
    const name = typeof mapped === 'string' && mapped.trim() && !/^ADOPT[\s:—-]/i.test(mapped) ? mapped.trim() : d.environment; // an untouched template row is not a mapping
    if (!cache.has(name)) cache.set(name, await snapshotFn(name)); // eslint-disable-line no-await-in-loop
    const snap = cache.get(name);
    if (snap.status === 'unsupported') { notes?.push(`environment snapshot: read the REPO RECORD — ${snap.reason}`); return findings; }
    if (snap.status !== 'ok') { findings.push(`${id}: the external record (${snap.provider}) could not say what is running in ${name} — ${snap.status}: ${snap.reason}. On the deploy lane an unanswered snapshot is a finding, not a pass`); continue; }
    const want = d.deployed_digest.replace(/^sha256:/, '');
    const running = (snap.artifacts || []).map((a) => String(a.fingerprint || '').replace(/^sha256:/, ''));
    if (!running.includes(want)) {
      findings.push(`${id}: the external record (${snap.provider}) does NOT see digest ${d.deployed_digest.slice(0, 19)}… running in ${name} — it sees ${running.length ? running.map((x) => x.slice(0, 12) + '…').join(', ') : 'nothing'}. The record says it was deployed; the platform says it is not running`);
    } else {
      notes?.push(`environment snapshot: ${id} — digest ${d.deployed_digest.slice(0, 19)}… confirmed RUNNING in ${name} by the external record (${snap.provider})`);
    }
  }
  return findings;
}

/** run() plus the provider snapshot — the CLI path. */
export async function runWithRecord(cwd = process.cwd()) {
  const r = run(cwd);
  r.notes = r.notes || [];
  if (!r.present) return r;
  const dir = `${cwd}/${DEPLOYMENTS_DIR}`;
  const deployments = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => readJson(`${dir}/${n}`)).filter(Boolean);
  const envPath = ENVIRONMENT_LOCATIONS.map((p) => `${cwd}/${p}`).find(existsSync);
  const environments = envPath ? readJson(envPath)?.environments ?? null : null;
  r.findings.push(...await snapshotFindings(deployments, { status: recordStatus(cwd), snapshotFn: (name) => environmentSnapshot(name, { cwd }), environments, notes: r.notes }));
  return r;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { present, findings, count, notes } = await runWithRecord();
  if (!present) {
    process.stdout.write(`Deploy gate — no ${DEPLOYMENTS_DIR}/ in this repository; nothing has been recorded as deployed (nothing to check)\n`);
    process.exit(0);
  }
  if (findings.length) {
    process.stderr.write('\nDeploy gate (deployed digest + declared strategy) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe deployed artifact IS the authorized artifact, and it reached customers the way the\nservice declared it would. Everything upstream binds a digest; this is where that binding\nmeets what is running. See scripts/release-subject-check.mjs and R3b in service readiness.\n');
    process.exit(1);
  }
  for (const n of notes || []) process.stdout.write(`NOTE: ${n}\n`);
  process.stdout.write(`Deploy gate — OK (${count} deployment record${count === 1 ? '' : 's'} bound to the authorized digest and the declared strategy)\n`);
}
