// Tests for the deploy gate (rc.39 · flow-plan Phase 5.4). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, run } from './deployed-digest-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST = `sha256:${'e3b0c442'.repeat(8)}`;
const OTHER = `sha256:${'a'.repeat(64)}`;
const COMMIT = '7e3f9c2a4b6d8e0f1a2c3b4d5e6f7a8b9c0d1e2f';

const SUBJECT = { source: { repository: 'org/svc', commit: COMMIT }, artifact: { name: 'svc', digest: DIGEST, uri: `r/svc@${DIGEST}` } };
const ENVIRONMENTS = [
  { id: 'staging', approval_required: false, data_classification: 'masked', promotion_source: 'dev' },
  { id: 'production', approval_required: true, data_classification: 'personal', promotion_source: 'staging' },
];
const SERVICE = {
  service_id: 'credit-origination',
  progressive_delivery: {
    strategy: 'canary',
    feature_flag_ref: 'credit.decisioning.enabled',
    stages: [
      { name: 'internal', traffic_pct: 1, bake_minutes: 60, slo_refs: ['err'] },
      { name: 'full', traffic_pct: 100, bake_minutes: 0, slo_refs: ['err'] },
    ],
  },
};
const REGISTRY = {
  identities: [
    { id: 'ops-dana', kind: 'human', groups: [] },
    { id: 'padmin-zoe', kind: 'human', groups: ['platform-admins'] },
    { id: 'eng-omar', kind: 'human', groups: ['builders'] },
    { id: 'agent-loom-delivery', kind: 'agent', groups: ['builders'] },
  ],
};
const CTX = { subject: SUBJECT, environments: ENVIRONMENTS, service: SERVICE, registry: REGISTRY };

const deployment = (over = {}) => ({
  deployment_id: 'DEP-1',
  service_id: 'credit-origination',
  environment: 'production',
  release_commit: COMMIT,
  deployed_digest: DIGEST,
  strategy: 'canary',
  feature_flag_ref: 'credit.decisioning.enabled',
  stages_completed: [
    { name: 'internal', traffic_pct: 1, started_at: '2026-07-24T06:00:00Z', completed_at: '2026-07-24T07:05:00Z' },
    { name: 'full', traffic_pct: 100, started_at: '2026-07-24T07:05:00Z', completed_at: '2026-07-24T07:10:00Z' },
  ],
  deployed_by: 'ops-dana',
  authorized_by: 'padmin-zoe',
  deployed_at: '2026-07-24T07:10:00Z',
  ...over,
});

test('a deployment of the authorized digest under the declared strategy passes', () => {
  assert.deepEqual(evaluate(deployment(), CTX), []);
});

test('① THE DIGEST — a deployed digest that is not the authorized one is the whole point of this gate', () => {
  const f = evaluate(deployment({ deployed_digest: OTHER }), CTX);
  assert.ok(f.some((x) => /DEPLOYED DIGEST IS NOT THE AUTHORIZED DIGEST/.test(x)), f.join('\n'));
  assert.ok(f.some((x) => /Same source is not the same artifact/.test(x)));
});

test('① a malformed digest, a missing subject, and a null-artifact subject each fail', () => {
  assert.ok(evaluate(deployment({ deployed_digest: 'latest' }), CTX).some((x) => /is not a sha256/.test(x)));
  assert.ok(evaluate(deployment(), { ...CTX, subject: null }).some((x) => /no authorized subject/.test(x)));
  assert.ok(evaluate(deployment(), { ...CTX, subject: { ...SUBJECT, artifact: null } }).some((x) => /artifact: null/.test(x)));
});

test('① a release_commit that is not the subject\'s source commit is a finding', () => {
  assert.ok(evaluate(deployment({ release_commit: 'f'.repeat(40) }), CTX).some((x) => /is not the subject's source commit/.test(x)));
});

test('the environment must be one this repository declares', () => {
  assert.ok(evaluate(deployment({ environment: 'prod-eu' }), CTX).some((x) => /is not a declared environment/.test(x)));
  assert.ok(evaluate(deployment(), { ...CTX, environments: null }).some((x) => /no declared environment estate/.test(x)));
});

test('four eyes on the last rung — an approval-required environment needs a non-builder authorizer who is not the deployer', () => {
  const none = evaluate(deployment({ authorized_by: undefined }), CTX);
  assert.ok(none.some((x) => /names no authorized_by/.test(x)), none.join('\n'));
  assert.ok(evaluate(deployment({ authorized_by: 'ops-dana' }), CTX).some((x) => /an approval you give yourself/.test(x)));
  assert.ok(evaluate(deployment({ authorized_by: 'eng-omar' }), CTX).some((x) => /is in the builders group/.test(x)));
  assert.ok(evaluate(deployment({ authorized_by: 'agent-loom-delivery' }), CTX).some((x) => /is an agent/.test(x)));
  assert.ok(evaluate(deployment({ authorized_by: 'ghost' }), CTX).some((x) => /does not resolve/.test(x)));
  // A non-approval environment needs none of that.
  assert.deepEqual(evaluate(deployment({ environment: 'staging', authorized_by: undefined }), CTX), []);
});

test('② THE STRATEGY — a strategy the service never declared, and a service with no ramp at all', () => {
  assert.ok(evaluate(deployment({ strategy: 'blue-green' }), CTX).some((x) => /did not go out the way it was approved to/.test(x)));
  assert.ok(evaluate(deployment(), { ...CTX, service: { service_id: 'x' } }).some((x) => /declares no progressive_delivery block/.test(x)));
  assert.ok(evaluate(deployment(), { ...CTX, service: null }).some((x) => /no readiness record at/.test(x)));
});

test('② the exposure switch named by the deploy must be the one the service declares', () => {
  assert.ok(evaluate(deployment({ feature_flag_ref: 'other.flag' }), CTX).some((x) => /is not the service's declared exposure switch/.test(x)));
});

test('② a skipped stage is exposure that was never baked', () => {
  const jumped = deployment({ stages_completed: [{ name: 'full', traffic_pct: 100, started_at: '2026-07-24T06:00:00Z', completed_at: '2026-07-24T06:05:00Z' }] });
  const f = evaluate(jumped, CTX);
  assert.ok(f.some((x) => /completed 1 stage\(s\) against 2 declared/.test(x)), f.join('\n'));
  assert.ok(f.some((x) => /the ramp ran in a different order/.test(x)));
  const none = evaluate(deployment({ stages_completed: undefined }), CTX);
  assert.ok(none.some((x) => /records no stages is indistinguishable/.test(x)));
});

test('② a stage run at the wrong traffic, or cut short of its declared bake, fails', () => {
  const hot = deployment();
  hot.stages_completed[0].traffic_pct = 25;
  assert.ok(evaluate(hot, CTX).some((x) => /ran at 25% against a declared 1%/.test(x)));

  const rushed = deployment();
  rushed.stages_completed[0].completed_at = '2026-07-24T06:30:00Z';
  const f = evaluate(rushed, CTX);
  assert.ok(f.some((x) => /baked 30m against a declared 60m/.test(x)), f.join('\n'));
  assert.ok(f.some((x) => /not a faster rollout, it is an unwatched one/.test(x)));

  const undated = deployment();
  delete undated.stages_completed[1].completed_at;
  assert.ok(evaluate(undated, CTX).some((x) => /no parseable started_at\/completed_at/.test(x)));

  const backwards = deployment();
  backwards.stages_completed[1].completed_at = '2026-07-24T06:00:00Z';
  assert.ok(evaluate(backwards, CTX).some((x) => /completed before it started/.test(x)));
});

// ── run(): silence with nothing deployed, and the real thing off a tree ───────────────────────
test('run(): no deployments directory is SILENCE, not a pass about nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dep-'));
  try {
    const r = run(dir);
    assert.equal(r.present, false);
    assert.deepEqual(r.findings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run(): a record on disk is read with its subject, estate, service and registry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dep-'));
  try {
    mkdirSync(join(dir, 'docs/governance/deployments'), { recursive: true });
    mkdirSync(join(dir, 'docs/governance/services'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/release-subject.json'), JSON.stringify(SUBJECT));
    writeFileSync(join(dir, 'docs/governance/environments.json'), JSON.stringify({ environments: ENVIRONMENTS }));
    writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
    writeFileSync(join(dir, 'docs/governance/services/credit-origination.json'), JSON.stringify(SERVICE));
    writeFileSync(join(dir, 'docs/governance/deployments/DEP-1.json'), JSON.stringify(deployment()));
    const ok = run(dir);
    assert.deepEqual(ok.findings, [], ok.findings.join('\n'));
    assert.equal(ok.count, 1);
    // …and the negative, through the same path.
    writeFileSync(join(dir, 'docs/governance/deployments/DEP-1.json'), JSON.stringify(deployment({ deployed_digest: OTHER })));
    assert.ok(run(dir).findings.some((f) => /DEPLOYED DIGEST IS NOT THE AUTHORIZED DIGEST/.test(f)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The shipped worked example must pass against the shipped subject, estate and service template —
// a demonstration that fails its own gate teaches the wrong shape. Skipped with a stated reason
// where the example is not present (the installer does not ship demonstration data).
// The MOUNTED record is preferred over the bundle's copy, and the mounted subject with it, so the
// two sides of the commit binding always come from the same layer: CI's dry-run re-derives the
// evidence bundle at a real commit and stamps both, while the bundle's committed example keeps its
// fictional one. Mixing the layers would fail on a difference that is the fixture regeneration
// working exactly as designed.
const EX = [
  `${H}/docs/governance/deployments/DEP-2026-0042-01.json`,
  `${H}/exposure-example/deployment.json`,
  `${H}/../exposure-example/deployment.json`,
].find(existsSync);
test('the shipped deployment example binds to the shipped subject and the shipped ramp', { skip: !EX && 'exposure-example not present in this layout' }, () => {
  // The ADOPTED subject is preferred where one exists: CI's dry-run re-derives the evidence bundle
  // at a real commit and stamps docs/governance/release-subject.json (and the deployment record)
  // with it, while the bundle's evidence-example keeps its fictional commit. Reading the mounted
  // subject is what a deployment record is checked against anyway — the bundle copy is the
  // fallback for the un-adopted layout.
  const subject = JSON.parse(readFileSync([`${H}/docs/governance/release-subject.json`, `${H}/evidence-example/release-subject.json`].find(existsSync), 'utf8'));
  const environments = JSON.parse(readFileSync([`${H}/governance/environments.template.json`, `${H}/docs/governance/environments.json`].find(existsSync), 'utf8')).environments;
  const service = JSON.parse(readFileSync([`${H}/governance/service-readiness.template.json`, `${H}/docs/governance/services/credit-origination.json`].find(existsSync), 'utf8'));
  const registry = JSON.parse(readFileSync([`${H}/governance/identities.template.json`, `${H}/docs/governance/identities.json`].find(existsSync), 'utf8'));
  const findings = evaluate(JSON.parse(readFileSync(EX, 'utf8')), { subject, environments, service, registry });
  assert.deepEqual(findings, [], findings.join('\n'));
});

/* ---- 2.1.0 row 2.10: the provider snapshot on the deploy lane ---- */
import { snapshotFindings } from './deployed-digest-check.mjs';

const DEP = { deployment_id: 'DEP-1', environment: 'production', deployed_digest: 'sha256:' + 'ab'.repeat(32) };
const MOUNTED = { mounted: true, provider: 'kosli' };
const snap = (fps) => async () => ({ status: 'ok', provider: 'kosli', environment: 'prod-k8s', artifacts: fps.map((f) => ({ fingerprint: f })) });

test('unmounted or unsupported: the repo record is read and the note says so; nothing fails', async () => {
  const notes = [];
  assert.deepEqual(await snapshotFindings([DEP], { status: { mounted: false, reason: 'none' }, snapshotFn: async () => { throw new Error('no'); }, notes }), []);
  assert.ok(notes.some((n) => /read the REPO RECORD/.test(n)));
  const n2 = [];
  assert.deepEqual(await snapshotFindings([DEP], { status: MOUNTED, snapshotFn: async () => ({ status: 'unsupported', reason: 'no snapshots' }), notes: n2 }), []);
  assert.ok(n2.some((n) => /REPO RECORD/.test(n)));
});

test('mounted: the deployed digest must be RUNNING per the provider, mapped through external_record_environment; an outage is a finding', async () => {
  const notes = [];
  const envs = [{ id: 'production', external_record_environment: 'prod-k8s' }];
  assert.deepEqual(await snapshotFindings([DEP], { status: MOUNTED, snapshotFn: snap(['ab'.repeat(32)]), environments: envs, notes }), []);
  assert.ok(notes.some((n) => /confirmed RUNNING in prod-k8s/.test(n)));
  const drift = await snapshotFindings([DEP], { status: MOUNTED, snapshotFn: snap(['cd'.repeat(32)]), environments: envs });
  assert.ok(drift.some((f) => /does NOT see digest .* running in prod-k8s/.test(f)));
  const n3 = [];
  await snapshotFindings([DEP], { status: MOUNTED, snapshotFn: snap(['ab'.repeat(32)]), environments: [{ id: 'production', external_record_environment: 'ADOPT: name it' }], notes: n3 });
  assert.ok(n3.some((n) => /RUNNING in production by/.test(n)), 'an ADOPT placeholder mapping falls back to the environment id');
  const out = await snapshotFindings([DEP], { status: MOUNTED, snapshotFn: async () => ({ status: 'unavailable', provider: 'kosli', reason: 'binary missing' }) });
  assert.ok(out.some((f) => /could not say what is running in production/.test(f)));
});
