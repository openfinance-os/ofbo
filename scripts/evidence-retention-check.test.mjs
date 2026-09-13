// Tests for the evidence-retention gate. Node built-in runner: `node --test`.
//
// Two properties matter more than the field rules and are tested first and last: the gate is
// SILENT for a repository that has written no retention policy and compiles nothing (a
// conventional adopter never fails on this), and the SHIPPED TEMPLATE — which the installer
// mounts by DEFAULT at the `governed` tier — produces notices rather than findings until a
// compiled plan asks for the capability. Every rule test below therefore passes `enforced: true`:
// dormant, each of them is a notice, and the dormant-vs-armed pair is asserted explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY, evaluate, isPlaceholder, producedTypes, requiringChanges, run } from './evidence-retention-check.mjs';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ is copied into an adopted tree, so this
// suite runs there too, where the template has been installed as docs/governance/evidence-retention.json.
const RETENTION_PATH = [join(H, 'governance/evidence-retention.template.json'), join(H, 'docs/governance/evidence-retention.json')].find(existsSync);
const SKIP_NO_TEMPLATE = !RETENTION_PATH && 'evidence-retention template not present in this layout';
const clean = (d) => rmSync(d, { recursive: true, force: true });

const policy = (types, over = {}) => ({
  default_retention_years: 7,
  immutable_archive_ref: 'ADOPT: the WORM store',
  types,
  ...over,
});
const entry = (over = {}) => ({
  retention_years: 7,
  immutable_archive: false,
  justification: 'The trail from the shipped artifact back to the approvals.',
  ...over,
});
const WORM = 'platform://worm/evidence (retention lock, 10y)';

test('a policy covering everything this repository produces passes clean', () => {
  const { findings, notices, count } = evaluate(policy({ tests: entry(), reviews: entry() }), {
    produced: new Map([['tests', 'sealed into the evidence bundle'], ['reviews', 'sealed into the evidence bundle']]),
    enforced: true,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
  assert.equal(count, 2);
});

test('ER-R01 — a mounted file with no types object is a policy with no policy in it', () => {
  for (const doc of [{}, { types: [] }, { types: 'later' }, null]) {
    assert.ok(evaluate(doc, { enforced: true }).findings.some((f) => /ER-R01/.test(f)), JSON.stringify(doc));
    // …and dormant it is a notice: nobody compiled a requirement to hold this file to.
    const dormant = evaluate(doc);
    assert.deepEqual(dormant.findings, [], JSON.stringify(doc));
    assert.ok(dormant.notices.some((n) => /ER-R01/.test(n)), JSON.stringify(doc));
  }
});

test('ER-R02 — the default is what unnamed types fall through to, so an unusable one is a finding', () => {
  for (const bad of [0, -1, 'seven', null]) {
    const { findings } = evaluate(policy({ tests: entry() }, { default_retention_years: bad }), { enforced: true });
    assert.ok(findings.some((f) => /ER-R02/.test(f)), JSON.stringify(bad));
  }
  // Absent is allowed — every produced type must be named anyway.
  assert.deepEqual(evaluate({ types: { tests: entry() } }, { enforced: true }).findings, []);
});

test('ER-R03 — an evidence type this repository PRODUCES with no entry is the gap the file exists to close', () => {
  const { findings } = evaluate(policy({ tests: entry() }), {
    produced: new Map([['tests', 'sealed'], ['shariah-attestation', 'required by a compiled control plan']]),
    enforced: true,
  });
  assert.ok(findings.some((f) => /ER-R03.*"shariah-attestation".*required by a compiled control plan/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /safety net that is load-bearing is a missing entry/.test(f)));
});

test('ER-R04 — an entry that is not an object states nothing', () => {
  for (const bad of [7, 'seven', null, ['7y']]) {
    assert.ok(evaluate(policy({ tests: bad }), { enforced: true }).findings.some((f) => /ER-R04/.test(f)), JSON.stringify(bad));
  }
});

test('ER-R05 — neither a period nor a reason is the unretained state with extra JSON', () => {
  for (const years of [undefined, 0, -3, 'ten', null]) {
    const { findings } = evaluate(policy({ tests: entry({ retention_years: years, justification: undefined }) }), { enforced: true });
    assert.ok(findings.some((f) => /ER-R05/.test(f)), JSON.stringify(years));
  }
  // An unreplaced ADOPT marker is not a justification.
  assert.ok(evaluate(policy({ tests: entry({ retention_years: undefined, justification: 'ADOPT: say why' }) }), { enforced: true })
    .findings.some((f) => /ER-R05/.test(f)));
});

test('DORMANCY — every well-formedness rule is a notice until a compiled plan requires the capability', () => {
  // One file breaking ER-R02, ER-R03, ER-R04 and ER-R05 at once. Mounting it is not opting in.
  const broken = policy({ tests: 'three years', reviews: entry({ retention_years: 0, justification: undefined }) }, { default_retention_years: 'seven' });
  const produced = new Map([['tests', 'sealed'], ['reviews', 'sealed'], ['penetration-test', 'sealed']]);
  const dormant = evaluate(broken, { produced });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  for (const rule of ['ER-R02', 'ER-R03', 'ER-R04', 'ER-R05']) {
    assert.ok(dormant.notices.some((n) => n.startsWith(rule)), `${rule} missing from notices:\n${dormant.notices.join('\n')}`);
  }
  // Armed, the same file fails on all four — the gate is dormant, not toothless.
  const live = evaluate(broken, { produced, enforced: true });
  assert.deepEqual(live.notices, [], live.notices.join('\n'));
  for (const rule of ['ER-R02', 'ER-R03', 'ER-R04', 'ER-R05']) {
    assert.ok(live.findings.some((f) => f.startsWith(rule)), `${rule} missing from findings:\n${live.findings.join('\n')}`);
  }
});

test('ER-R06 — an unbounded entry carried on a stated justification is a NOTICE, reported every run', () => {
  const { findings, notices } = evaluate(policy({
    reviews: entry({ retention_years: undefined, justification: 'Held under a statutory record-keeping hold with no year count; see data-lifecycle.json.' }),
  }));
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(notices.some((n) => /ER-R06.*enforces nothing about it/.test(n)), notices.join('\n'));
});

test('ER-R07 — an immutable_archive claim must say WHERE, per entry or once for the file', () => {
  const claim = { tests: entry({ immutable_archive: true }) };
  // Dormant repository: a NOTICE. The location is adopter-side platform detail.
  const dormant = evaluate(policy(claim));
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.ok(dormant.notices.some((n) => /ER-R07.*names no archive/.test(n)), dormant.notices.join('\n'));
  // Compiled: a finding, and it says plainly what the harness cannot do.
  const live = evaluate(policy(claim), { enforced: true });
  assert.ok(live.findings.some((f) => /ER-R07.*THE HARNESS CANNOT VERIFY THE STORE/.test(f)), live.findings.join('\n'));
  // Located either way, and an unreplaced marker locates nothing.
  assert.deepEqual(evaluate(policy({ tests: entry({ immutable_archive: true, archive_ref: WORM }) }), { enforced: true }).findings, []);
  assert.deepEqual(evaluate(policy(claim, { immutable_archive_ref: WORM }), { enforced: true }).findings, []);
  assert.ok(evaluate(policy(claim, { immutable_archive_ref: 'ADOPT: name the WORM store' }), { enforced: true }).findings.some((f) => /ER-R07/.test(f)));
  // A non-boolean claim reads the same way: a finding once armed, a notice while dormant.
  const nonBool = policy({ tests: entry({ immutable_archive: 'yes' }) });
  assert.ok(evaluate(nonBool, { enforced: true }).findings.some((f) => /ER-R07.*true or false/.test(f)));
  assert.deepEqual(evaluate(nonBool).findings, []);
  assert.ok(evaluate(nonBool).notices.some((n) => /ER-R07.*true or false/.test(n)));
});

test('ER-R08 — entries for evidence this repository does not produce are reported, never enforced', () => {
  const { findings, notices } = evaluate(policy({ tests: entry(), 'shariah-attestation': entry({ retention_years: 10 }) }), {
    produced: new Map([['tests', 'sealed']]),
    enforced: true,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(notices.some((n) => /ER-R08.*shariah-attestation/.test(n)), notices.join('\n'));
});

test('commentary keys are not retention entries', () => {
  const { findings, count } = evaluate(policy({ _comment: 'ADOPT: prose', tests: entry() }));
  assert.deepEqual(findings, []);
  assert.equal(count, 1);
});

// The shipped template must be GREEN when armed, and this test used to assert the opposite: that
// most entries claimed an immutable archive. They did, and they named none — so the moment a profile
// made the capability reachable, the bundle's own template failed the bundle's own gate. An untouched
// template that asserts on the adopter's behalf that ten kinds of evidence sit in a WORM store the
// harness has never reached is the same unearned-claim defect the rest of this release removed. It
// ships claiming nothing; the adopter makes the claim when they can say where.
test('the SHIPPED template claims no archive it cannot name, and passes its own gate armed', { skip: SKIP_NO_TEMPLATE }, () => {
  const doc = JSON.parse(readFileSync(RETENTION_PATH, 'utf8'));
  const archived = Object.entries(doc.types).filter(([, e]) => e.immutable_archive === true);
  assert.deepEqual(archived, [], 'no shipped entry may claim an archive the template does not name');
  assert.deepEqual(evaluate(doc).findings, []);
  assert.deepEqual(evaluate(doc, { enforced: true }).findings, [], 'the shipped template is green when armed');

  // And the rule still bites the moment a claim IS made without a location…
  const claimed = { ...doc, types: { ...doc.types, provenance: { ...doc.types.provenance, immutable_archive: true } } };
  assert.equal(evaluate(claimed, { enforced: true }).findings.length, 1);
  assert.equal(evaluate(claimed).notices.length, 1, 'dormant, the same claim is only reported');
  // …and naming the store once, for the file, clears it.
  assert.deepEqual(evaluate({ ...claimed, immutable_archive_ref: WORM }, { enforced: true }).findings, []);
});

test('the shipped template covers every evidence type the seal knows how to verify', { skip: SKIP_NO_TEMPLATE }, async () => {
  const doc = JSON.parse(readFileSync(RETENTION_PATH, 'utf8'));
  const seal = await import('./evidence-seal-check.mjs');
  const produced = new Map([...seal.REQUIRED_TYPES, ...seal.PLAN_ONLY_TYPES].map((t) => [t, 'sealed']));
  const { findings } = evaluate({ ...doc, immutable_archive_ref: WORM }, { produced, enforced: true });
  assert.deepEqual(findings.filter((f) => /ER-R03/.test(f)), [], 'a sealed type with no retention row is a gap');
});

test('helpers: isPlaceholder', () => {
  assert.ok(isPlaceholder('ADOPT: the WORM store') && isPlaceholder('adopt — name it'));
  assert.ok(!isPlaceholder(WORM) && !isPlaceholder(null) && !isPlaceholder(undefined));
});

// ── run(): the mandatory-when-compiled contract, on a real tree ────────────────────────────────

/** A tmp repo, optionally with a change whose plan requires the capability, a policy and a bundle. */
function repo({ requires = false, evidence = [], retention = null, bundleTypes = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-retention-'));
  if (requires || evidence.length) {
    const base = join(dir, 'docs/governance/changes/CHG-1');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
      required_gates: ['assurance-cadence'],
      required_evidence: evidence,
      required_capabilities: requires ? { [CAPABILITY]: { required: true } } : {},
    }));
  }
  if (retention) {
    mkdirSync(join(dir, 'docs/governance'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/evidence-retention.json'), typeof retention === 'string' ? retention : JSON.stringify(retention));
  }
  if (bundleTypes) {
    mkdirSync(join(dir, 'docs/governance/evidence'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/evidence/manifest.json'), JSON.stringify({
      release_commit: 'a'.repeat(40),
      entries: bundleTypes.map((t) => ({ type: t, ref: `${t}.json`, sha256: 'x' })),
    }));
  }
  return dir;
}

test('INERT — no policy and no compiled requirement: silent, and it says so rather than reporting a green', () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.equal(r.present, false);
  } finally { clean(dir); }
});

test('INERT holds even for a repository that seals evidence — sealing is not a retention policy it never wrote', () => {
  const dir = repo({ bundleTypes: ['tests', 'reviews'] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.inert, true);
  } finally { clean(dir); }
});

test('MANDATORY-WHEN-COMPILED — the absent policy fails once a plan requires the capability, and names the change', () => {
  const dir = repo({ requires: true });
  try {
    const r = run(dir);
    assert.equal(r.required, true);
    assert.equal(r.inert, false);
    assert.ok(r.findings.some((f) => /requires the evidence_retention capability \[CHG-1\]/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() — the produced types come from the SEALED BUNDLE, and an uncovered one is named', () => {
  const dir = repo({ requires: true, retention: policy({ tests: entry() }, { immutable_archive_ref: WORM }), bundleTypes: ['tests', 'sbom'] });
  try {
    const r = run(dir);
    assert.equal(r.present, true);
    assert.equal(r.covered, 2);
    assert.ok(r.findings.some((f) => /ER-R03.*"sbom".*sealed into the evidence bundle at docs\/governance\/evidence\/manifest\.json/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() — a compiled plan\'s required_evidence counts as produced before any bundle exists', () => {
  const dir = repo({ requires: true, evidence: ['tests', 'shariah-attestation'], retention: policy({ tests: entry() }, { immutable_archive_ref: WORM }) });
  try {
    const r = run(dir);
    assert.ok(r.findings.some((f) => /ER-R03.*"shariah-attestation".*required by a compiled control plan/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

// The defect this pair exists against: the gate used to be armed by the MERE PRESENCE of
// docs/governance/evidence-retention.json, which the installer mounts by default at the `governed`
// tier. No shipped profile declares evidence_retention, so presence-arming could only ever fail
// adopters who never asked for it — a conventional repository sealing a penetration test, a DPIA
// or a UAT sign-off took a hard PR-lane failure from a Shari'ah-adjacent template it was given.
test('DORMANT ADOPTER — the mounted template plus an unlisted sealed evidence type is notices, exit 0', { skip: SKIP_NO_TEMPLATE }, () => {
  const dir = repo({
    retention: JSON.parse(readFileSync(RETENTION_PATH, 'utf8')),
    bundleTypes: ['tests', 'reviews', 'penetration-test', 'dpia', 'uat-signoff'],
  });
  try {
    const r = run(dir);
    assert.equal(r.required, false);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    for (const t of ['penetration-test', 'dpia', 'uat-signoff']) {
      assert.ok(r.notices.some((n) => n.startsWith('ER-R03') && n.includes(`"${t}"`)), `${t} not reported:\n${r.notices.join('\n')}`);
    }
  } finally { clean(dir); }
});

test('ARMED ADOPTER — the same tree fails once a compiled plan requires the capability', { skip: SKIP_NO_TEMPLATE }, () => {
  const dir = repo({
    requires: true,
    retention: JSON.parse(readFileSync(RETENTION_PATH, 'utf8')),
    bundleTypes: ['tests', 'reviews', 'penetration-test', 'dpia', 'uat-signoff'],
  });
  try {
    const r = run(dir);
    assert.equal(r.required, true);
    for (const t of ['penetration-test', 'dpia', 'uat-signoff']) {
      assert.ok(r.findings.some((f) => f.startsWith('ER-R03') && f.includes(`"${t}"`)), `${t} not enforced:\n${r.findings.join('\n')}`);
    }
    assert.deepEqual(requiringChanges(aggregateRequirements(dir)), ['CHG-1']);
  } finally { clean(dir); }
});

test('run() — with neither a bundle nor a compiled plan, coverage is UNCOVERED, said aloud', () => {
  const dir = repo({ retention: policy({ tests: entry() }, { immutable_archive_ref: WORM }) });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.equal(r.covered, 0);
    assert.ok(r.notices.some((n) => /cannot be enumerated.*UNCOVERED rather than confirmed/s.test(n)), r.notices.join('\n'));
  } finally { clean(dir); }
});

test('run() — a mounted policy that is not JSON fails once armed, and is reported while dormant', () => {
  const armed = repo({ requires: true, retention: '{ not json' });
  try {
    assert.ok(run(armed).findings.some((f) => /not valid JSON/.test(f)));
  } finally { clean(armed); }
  // Dormant it is still SAID — a broken file is never silently skipped — but a mounted file the
  // adopter never opted into being held to does not block their PR.
  const dormant = repo({ retention: '{ not json' });
  try {
    const r = run(dormant);
    assert.deepEqual(r.findings, []);
    assert.ok(r.notices.some((n) => /not valid JSON/.test(n)), r.notices.join('\n'));
  } finally { clean(dormant); }
});

test('run() — the SHIPPED template mounted into a dormant repository does not fail it', { skip: SKIP_NO_TEMPLATE }, () => {
  const doc = JSON.parse(readFileSync(RETENTION_PATH, 'utf8'));
  const dir = repo({ retention: doc, bundleTypes: ['tests', 'reviews', 'sbom'] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.ok(r.notices.some((n) => /ER-R08/.test(n)), 'the Islamic rows are reported as unproduced, never enforced');
  } finally { clean(dir); }
});

test('producedTypes and requiringChanges read the tree, not an assumption', () => {
  const dir = repo({ requires: true, evidence: ['tests'], bundleTypes: ['sbom'] });
  try {
    const produced = producedTypes(dir);
    assert.deepEqual([...produced.keys()].sort(), ['sbom', 'tests']);
    assert.match(produced.get('sbom'), /sealed into the evidence bundle/);
    assert.match(produced.get('tests'), /compiled control plan/);
    assert.deepEqual(requiringChanges(aggregateRequirements(dir)), ['CHG-1']);
  } finally { clean(dir); }
});
