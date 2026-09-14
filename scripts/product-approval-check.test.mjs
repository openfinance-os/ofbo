// Tests for the product-approval gate (PA1/PA2). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { ACTIVE_STATUS, RULINGS_LOCATIONS, checkApprovals, conformingLanePa1, evaluate, loadRulings, resolveRulingBinding, run, pa1Roles, shariahLane, SECOND_LINE_ROLES } from './product-approval-check.mjs';
import { canonicalDecisionPayload, roleBindingHash, sha256 } from '../core/approval-attestations.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { existsSync } from 'node:fs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Fixtures resolve in BOTH layouts: the bundle and an adopted repo.
const J = (...candidates) => {
  const p = candidates.map((c) => `${HARNESS}/${c}`).find(existsSync);
  if (!p) throw new Error(`fixture not found: ${candidates.join(' | ')}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};
// In a BARE adoption the worked-example change is in neither layout; skip cleanly rather than
// throw at module load. The pure evaluate() logic still runs wherever the example is mounted.
const EXAMPLE_PRESENT = ['change-example/control-plan.json', 'docs/governance/changes/CHG-2026-0042/control-plan.json']
  .some((c) => existsSync(`${HARNESS}/${c}`));
if (!EXAMPLE_PRESENT) {
  test('product-approval gate (worked-example change is bundle-only — skipped in an adopted layout)', { skip: true }, () => {});
} else {
const PLAN = J('change-example/control-plan.json', 'docs/governance/changes/CHG-2026-0042/control-plan.json');
const PASSPORT = J('change-example/product-passport.json', 'docs/governance/changes/CHG-2026-0042/product-passport.json');
const REGISTRY = J('governance/identities.template.json', 'docs/governance/identities.json');
// 2.1.0 (4.2) — the plan compiles `dpia`, so a passing evaluation carries the record.
const DPIA = J('change-example/dpia.json', 'docs/governance/changes/CHG-2026-0042/dpia.json');
const LIFECYCLE = J('governance/data-lifecycle.template.json', 'docs/governance/data-lifecycle.json');
const ENVELOPE = J('change-example/change-envelope.json', 'docs/governance/changes/CHG-2026-0042/change-envelope.json');
const MANIFEST = J('governance/model-manifest.template.json', 'docs/governance/model-manifest.json');
const WITH_DPIA = { dpia: DPIA, dataLifecycle: LIFECYCLE };

test('the shipped worked example passes PA1', () => {
  assert.deepEqual(evaluate(PASSPORT, PLAN, REGISTRY, WITH_DPIA), []);
  assert.deepEqual(evaluate(PASSPORT, PLAN, REGISTRY, { ...WITH_DPIA, envelope: ENVELOPE, modelManifest: MANIFEST }), []);
});

test('a missing passport blocks a product change', () => {
  assert.match(evaluate(null, PLAN, REGISTRY)[0], /product passport missing/);
});

test('PA1 approved over a missing required section is not an approval', () => {
  const { 'credit-risk-appetite': _, ...sections } = PASSPORT.sections;
  const f = evaluate({ ...PASSPORT, sections }, PLAN, REGISTRY);
  assert.ok(f.some((x) => /required section credit-risk-appetite is missing/.test(x)));
});

test('PA1 without the second-line approval fails', () => {
  const pa1 = { ...PASSPORT.pa1, approvals: PASSPORT.pa1.approvals.filter((a) => a.role !== 'risk-second-line') };
  const f = evaluate({ ...PASSPORT, pa1 }, PLAN, REGISTRY);
  assert.ok(f.some((x) => /no approval for required role risk-second-line/.test(x)));
});

test('a free-text approver does not count; an AGENT approver never counts', () => {
  const freeText = { ...PASSPORT.pa1, approvals: PASSPORT.pa1.approvals.map((a) => a.role === 'risk-second-line' ? { ...a, by: 'Risk' } : a) };
  assert.ok(evaluate({ ...PASSPORT, pa1: freeText }, PLAN, REGISTRY).some((x) => /not in the registry/.test(x)));
  const agent = { ...PASSPORT.pa1, approvals: PASSPORT.pa1.approvals.map((a) => a.role === 'product-owner' ? { ...a, by: 'agent-loom-delivery' } : a) };
  assert.ok(evaluate({ ...PASSPORT, pa1: agent }, PLAN, REGISTRY).some((x) => /never approve/.test(x)));
});

test('a BUILDER cannot issue second-line approval even holding the role', () => {
  const registry = JSON.parse(JSON.stringify(REGISTRY));
  registry.identities.push({ id: 'risk-mole', kind: 'human', roles: ['risk-second-line'], groups: ['builders'] });
  const pa1 = { ...PASSPORT.pa1, approvals: PASSPORT.pa1.approvals.map((a) => a.role === 'risk-second-line' ? { ...a, by: 'risk-mole' } : a) };
  const f = evaluate({ ...PASSPORT, pa1 }, PLAN, registry);
  assert.ok(f.some((x) => /a builder cannot issue second-line approval/.test(x)));
});

test('PA2 approved demands every compiled control-function role and the full section set', () => {
  const pa2 = { decision: 'approved', approvals: [{ role: 'product-owner', by: 'po-fatima' }] };
  const f = evaluate({ ...PASSPORT, pa2 }, PLAN, REGISTRY);
  assert.ok(f.some((x) => /PA2: no approval for required role compliance/.test(x)));
  assert.ok(f.some((x) => /PA2: required section key-facts-statement is missing/.test(x)));
});

test('ownership must resolve: product owner and accountable executive by role', () => {
  const sections = { ...PASSPORT.sections, ownership: { product_owner: 'eng-omar', accountable_executive: 'exec-rashid' } };
  const f = evaluate({ ...PASSPORT, sections }, PLAN, REGISTRY);
  assert.ok(f.some((x) => /ownership\.product_owner.*does not hold the required role/.test(x)));
});

test('a plan with NEITHER PA gate compiles no product-approval requirements', () => {
  assert.deepEqual(evaluate(PASSPORT, { ...PLAN, required_gates: ['D', 'Q'] }, REGISTRY), []);
});

// PA2 is a product-approval route too — the one that grants permission to LAUNCH. Testing PA1
// alone meant a plan compiling PA2 without PA1 (which a conditional profile adding PA2 to a lower
// tier can produce) returned early and skipped EVERYTHING: ownership, the PA2 section set, the
// approver roles and every attestation on the launch gate.
test('a PA2-only plan still checks the launch approval, ownership and sections', () => {
  const pa2Only = { ...PLAN, required_gates: ['D', 'Q', 'PA2'] };
  const passport = {
    ...PASSPORT,
    sections: { ...PASSPORT.sections, ownership: { product_owner: 'nobody-at-all', accountable_executive: 'nobody-either' } },
    pa2: { decision: 'approved', approvals: [] },
  };
  const findings = evaluate(passport, pa2Only, REGISTRY);
  assert.ok(findings.some((f) => /ownership\.product_owner/.test(f)), 'ownership must still resolve');
  assert.ok(findings.some((f) => /PA2: no approval for required role/.test(f)), `PA2 roles unchecked: ${findings}`);
  // …and PA1's own checks stay off, because PA1 is not compiled.
  assert.ok(!findings.some((f) => /· PA1/.test(f)), `PA1 must not be demanded: ${findings}`);
});

// --- mandatory-when-compiled: attestation-backed approvals (Factory Floor WS2 · D2.5) ---------
// The capability activates from the compiled plan, never from a CI flag. It TIGHTENS the gate:
// a plan that does not compile it behaves exactly as it did before this path existed.

const ATTESTED_PLAN = { ...PLAN, required_capabilities: { 'approval_attestation': { required: true } } };

test('without the compiled capability the gate is unchanged — no attestation is demanded', () => {
  assert.deepEqual(evaluate(PASSPORT, PLAN, REGISTRY, WITH_DPIA), []);
});

test('with the capability compiled, a named approver alone is no longer enough', () => {
  const f = evaluate(PASSPORT, ATTESTED_PLAN, REGISTRY, { records: [] });
  assert.ok(f.some((x) => /no approval attestation — an approval recorded only as a name in a file is a claim, not evidence/.test(x)));
});

test('the attestation must match the stage and role it is offered for', () => {
  const stray = {
    schema: 'loom.approval-attestation/v1',
    change_id: PLAN.change_id, stage: 'PA2', outcome: 'approved', role: 'risk-second-line',
    subject: { registry_id: 'risk-lena' },
  };
  const f = evaluate(PASSPORT, ATTESTED_PLAN, REGISTRY, { records: [stray] });
  // PA1 finds no record for its stage — the PA2 record does not answer for PA1.
  assert.ok(f.some((x) => /PA1 · risk-second-line: no approval attestation/.test(x)));
});

// First existing candidate, or null — the bundle and an adopted repo hold these in different
// places, and the approval example is bundle-only (studied, never copied).
const FIND = (...candidates) => candidates.map((c) => `${HARNESS}/${c}`).find(existsSync) || null;

test('run() wires the whole path end to end in a real repo layout', (t) => {
  // evaluate() proves the logic; this proves the WIRING — that run() finds the approvals
  // directory, loads both issuer registries, digests the passport off disk, and threads them in.
  const srcs = {
    passport: FIND('change-example/product-passport.json', 'docs/governance/changes/CHG-2026-0042/product-passport.json'),
    approval: FIND('approval-attestation-example/pa1-risk-second-line.json'),
    identities: FIND('governance/identities.template.json', 'docs/governance/identities.json'),
    // The example's own registries — bundle-only, and marked `demo: true` so the gate refuses
    // them. The governance/ templates deliberately carry no working key material.
    attIssuers: FIND('approval-attestation-example/attestation-issuers.example.json'),
    asrIssuers: FIND('approval-attestation-example/assertion-issuers.example.json'),
  };
  if (Object.values(srcs).some((p) => !p)) {
    t.skip('bundle-only fixtures absent in this layout');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'pa-'));
  try {
    const base = join(dir, 'docs/governance/changes/CHG-2026-0042');
    const gov = join(dir, 'docs/governance');
    mkdirSync(join(base, 'approvals'), { recursive: true });
    const plan = { ...J('change-example/control-plan.json', 'docs/governance/changes/CHG-2026-0042/control-plan.json') };
    plan.required_capabilities = { ...plan.required_capabilities, approval_attestation: { required: true } };
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify(plan));
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-2026-0042', control_plan: 'control-plan.json' }));
    cpSync(srcs.passport, join(base, 'product-passport.json'));
    writeFileSync(join(base, 'dpia.json'), JSON.stringify(DPIA));
    cpSync(srcs.identities, join(gov, 'identities.json'));
    cpSync(srcs.attIssuers, join(gov, 'attestation-issuers.json'));
    cpSync(srcs.asrIssuers, join(gov, 'assertion-issuers.json'));
    // rc.38 (flow-plan Phase 4.1): this fixture's plan is MUTATED above (approval_attestation is
    // switched on), and required_capabilities is inside the per-role binding — correctly, because a
    // capability set is part of the route the approver was shown. So the shipped record's
    // binding_hash does not describe THIS plan and must be re-derived, which means re-signing.
    // The issuer ids and their `"demo": true` markings are kept: the point of the assertion below
    // is that a demo anchor is refused even when the cryptography is perfect, so only the KEY is
    // fresh, and only its public half is ever written.
    {
      const rec = JSON.parse(readFileSync(srcs.approval, 'utf8'));
      rec.bound_to.binding_hash = roleBindingHash(plan, rec.role, rec.bound_to);
      const payload = canonicalDecisionPayload(rec);
      rec.subject.assertion.nonce = sha256(payload);
      const keys = [['assertion-issuers.json', rec.subject.assertion.issuer], ['attestation-issuers.json', rec.transcription.attestation.issuer]];
      const signed = keys.map(([file, id]) => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const p = join(gov, file);
        const reg = JSON.parse(readFileSync(p, 'utf8'));
        const entry = (reg.issuers || []).find((e) => e.id === id);
        entry.verify = { ...entry.verify, public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
        assert.equal(entry.demo, true, `${id} must stay marked demo — the refusal is what this test asserts`);
        writeFileSync(p, JSON.stringify(reg, null, 2));
        return edSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
      });
      rec.subject.assertion.signature = signed[0];
      rec.transcription.attestation.signature = signed[1];
      writeFileSync(join(base, 'approvals/pa1-risk-second-line.json'), JSON.stringify(rec, null, 2));
    }

    const { findings, count } = run(dir);
    assert.equal(count, 1);
    // The role that carries a real attestation is satisfied — nothing is reported against it
    // beyond the demo-anchor refusal, which is the harness refusing its own reference keys.
    const real = findings.filter((f) => !/is marked `"demo": true`/.test(f));
    assert.ok(!real.some((f) => /risk-second-line/.test(f)), `risk-second-line should verify:\n${real.join('\n')}`);
    assert.ok(findings.some((f) => /risk-second-line.*is marked `"demo": true`/.test(f)),
      'a demo anchor must be refused through run() too, not only in the unit path');
    // The other compiled PA1 roles have no attestation, and the gate says so for each.
    for (const role of ['product-owner', 'accountable-executive']) {
      assert.ok(findings.some((f) => f.includes(role) && /no approval attestation/.test(f)), `expected ${role} to be refused`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the PA2 stage is attested in its own right — a PA1 record cannot grant permission to launch', () => {
  // Without this, changing the stage argument on the PA2 call site to 'PA1' passes the suite —
  // and a PA1 decision would satisfy permission to launch.
  const pa1Only = {
    schema: 'loom.approval-attestation/v1',
    change_id: PLAN.change_id, stage: 'PA1', outcome: 'approved', role: 'compliance',
    subject: { registry_id: 'comp-imran' },
  };
  const pa2 = { decision: 'approved', approvals: (PLAN.required_approver_roles || []).map((role) => ({ role, by: 'po-fatima' })) };
  const f = evaluate({ ...PASSPORT, pa2 }, ATTESTED_PLAN, REGISTRY, { records: [pa1Only] });
  assert.ok(f.some((x) => /PA2 · compliance: no approval attestation/.test(x)),
    `a PA1 record must not answer for PA2:\n${f.join('\n')}`);
});

test('a plan requiring attestation but compiling no PA gate is a defect, not a pass', () => {
  const noPa = { ...ATTESTED_PLAN, required_gates: ['D', 'Q'] };
  const f = evaluate(PASSPORT, noPa, REGISTRY, {});
  assert.ok(f.some((x) => /compiles neither PA1 nor PA2 \(gates: D, Q\)/.test(x)), `expected a finding, got: ${JSON.stringify(f)}`);
  // …and without the capability it stays silent, as before.
  assert.deepEqual(evaluate(PASSPORT, { ...PLAN, required_gates: ['D', 'Q'] }, REGISTRY, {}), []);
});

test('an attestation that does not bind the compiled plan hash is refused', () => {
  const rec = {
    schema: 'loom.approval-attestation/v1',
    change_id: PLAN.change_id, stage: 'PA1', outcome: 'approved', role: 'risk-second-line',
    subject: { registry_id: 'risk-lena', idp_subject: 'idp|x', assertion: { mechanism: 'ed25519', issuer: 'bank-idp' } },
    bound_to: { plan_hash: 'a-stale-hash', passport_digest: 'sha256:whatever' },
    origin: { system: 'notion', event_id: 'e1', nonce: 'n1' },
    transcription: { by: 'svc-floor-bridge' },
  };
  const f = evaluate(PASSPORT, { ...ATTESTED_PLAN, plan_hash: 'the-real-hash' }, REGISTRY, { records: [rec] });
  assert.ok(f.some((x) => /plan_hash does not match the compiled plan/.test(x)));
});

// --- the PA1 role gap (found by the Alpha Islamic Bank walkthrough) ----------------------------
//
// A compiled plan could name twelve approver roles while PA1 checked three, and the flat
// `required_approver_roles` list gave a reader no way to tell which was which. Nine roles —
// including every Shariah role — were unchecked at PA1, so an agent, a builder or an identity
// that does not exist could occupy one of those slots under a green gate.

test('a recorded approval is resolved even when this stage does not require that role', () => {
  const plan = { ...PLAN, risk_tier: 'high' };
  const notRequiredAtPa1 = plan.required_approver_roles.find((r) => !pa1Roles(plan).includes(r));
  assert.ok(notRequiredAtPa1, 'the fixture must have a role PA1 does not demand');
  for (const [who, re] of [
    ['agent-loom-delivery', /is an AGENT/],
    ['nobody-at-all', /is not in the registry/],
  ]) {
    const passport = {
      ...PASSPORT,
      pa1: { decision: 'approved', approvals: [...PASSPORT.pa1.approvals.filter((a) => a.role !== notRequiredAtPa1), { role: notRequiredAtPa1, by: who }] },
    };
    const f = evaluate(passport, plan, REGISTRY);
    assert.ok(f.some((x) => new RegExp(notRequiredAtPa1).test(x) && re.test(x)),
      `${who} in the ${notRequiredAtPa1} slot must be refused at PA1:\n${f.join('\n')}`);
    assert.ok(f.some((x) => /recorded, not required at this stage/.test(x)),
      'the finding must say the role was recorded rather than demanded');
  }
});

test('pa1Roles is a floor plus what the plan declares, never more than the plan compiled', () => {
  const base = { risk_tier: 'medium', required_approver_roles: ['product-owner', 'risk-second-line', 'compliance'] };
  assert.deepEqual(pa1Roles(base), ['product-owner', 'risk-second-line']);
  // a profile opts a role in…
  assert.deepEqual(pa1Roles({ ...base, pa1_approver_roles: ['compliance'] }), ['compliance', 'product-owner', 'risk-second-line']);
  // …but it can never bind a role the plan did not compile at all.
  assert.deepEqual(pa1Roles({ ...base, pa1_approver_roles: ['shariah-committee'] }), ['product-owner', 'risk-second-line']);
  // high tier adds the accountable executive, when compiled
  assert.deepEqual(pa1Roles({ risk_tier: 'high', required_approver_roles: ['accountable-executive'] }), ['accountable-executive']);
  assert.deepEqual(pa1Roles({ risk_tier: 'medium', required_approver_roles: ['accountable-executive'] }), []);
});

test('an islamic change binds the Shariah roles at PA1, not only at PA2', () => {
  // The uae-bank and islamic-product profiles add Shariah approver roles AND Shariah PA1 sections.
  // Requiring the analysis at PA1 while nobody with Shariah authority need approve it until PA2
  // is incoherent, so those profiles now declare their roles pa1-binding.
  // The vocabulary is fixed: `shariah-committee` is the ISSC (the body — a registry quorum is what
  // makes it one), `shariah-compliance` is the Shari'ah Compliance Function head, `shariah-audit`
  // is internal Shari'ah audit. `shariah-board` is retired and appears nowhere.
  const plan = {
    risk_tier: 'high',
    required_approver_roles: ['product-owner', 'risk-second-line', 'shariah-committee', 'shariah-audit', 'shariah-compliance'],
    pa1_approver_roles: ['shariah-committee', 'shariah-audit', 'shariah-compliance'],
  };
  for (const r of ['shariah-committee', 'shariah-audit', 'shariah-compliance']) {
    assert.ok(pa1Roles(plan).includes(r), `${r} must bind at PA1`);
  }
});

// --- role quorum and delegation, through the approval path (rc.38 · flow-plan Phase 4.5) ------

const QREG = {
  groups: { builders: '', 'second-line': '' },
  identities: [
    { id: 'risk-a', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'risk-b', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'eng-1', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'dep-1', kind: 'human', roles: [], groups: [] },
  ],
  quorum: { 'risk-second-line': 2 },
};

test('a quorum role needs K DISTINCT holders — one name twice is one approval', () => {
  const one = checkApprovals([{ role: 'risk-second-line', by: 'risk-a' }], ['risk-second-line'], QREG, 'q', 'PA1', {});
  assert.ok(one.findings.some((f) => /needs a quorum of 2 distinct holders — 1 recorded/.test(f)));
  assert.deepEqual(one.missing, ['risk-second-line']);

  const twice = checkApprovals(
    [{ role: 'risk-second-line', by: 'risk-a' }, { role: 'risk-second-line', by: 'risk-a' }],
    ['risk-second-line'], QREG, 'q', 'PA1', {});
  assert.ok(twice.findings.some((f) => /1 recorded \(risk-a\)/.test(f)));

  const two = checkApprovals(
    [{ role: 'risk-second-line', by: 'risk-a' }, { role: 'risk-second-line', by: 'risk-b' }],
    ['risk-second-line'], QREG, 'q', 'PA1', {});
  assert.deepEqual(two.findings, []);
  assert.deepEqual(two.missing, []);
});

test('EVERY approval in a quorum is resolved, not just the first', () => {
  const f = checkApprovals(
    [{ role: 'risk-second-line', by: 'risk-a' }, { role: 'risk-second-line', by: 'eng-1' }],
    ['risk-second-line'], QREG, 'q', 'PA1', {}).findings;
  assert.ok(f.some((x) => /eng-1 does not hold the required role/.test(x)));
  assert.ok(f.some((x) => /eng-1 is in the builders group/.test(x)));
});

test('a deputy satisfies a required role, and the deputy approval is announced', () => {
  const reg = structuredClone(QREG);
  delete reg.quorum;
  reg.identities.find((i) => i.id === 'risk-a').delegates = [
    { to: 'dep-1', from: '2026-07-01', until: '2026-12-31', granted_by: 'risk-b' },
  ];
  const notices = [];
  const res = checkApprovals([{ role: 'risk-second-line', by: 'dep-1' }], ['risk-second-line'], reg, 'q', 'PA1',
    { notices, now: Date.parse('2026-07-28T00:00:00Z') });
  assert.deepEqual(res.findings, []);
  assert.ok(notices.some((n) => /BY DELEGATION from risk-a/.test(n)));
});

test('with no quorum declared the default is 1 — every existing passport is unaffected', () => {
  const reg = structuredClone(QREG);
  delete reg.quorum;
  assert.deepEqual(checkApprovals([{ role: 'risk-second-line', by: 'risk-a' }], ['risk-second-line'], reg, 'q', 'PA1', {}).findings, []);
});

// The Shari'ah lane must be INERT for a conventional change. The shipped worked example (Meridian
// Trust's retail credit product) compiles no Shariah role, so an envelope carrying lane fields —
// however it got there — must change nothing at all about how it is evaluated.
test('the Shari’ah lane is dormant for a change whose plan compiles no Shariah role', () => {
  const notices = [];
  for (const envelope of [
    undefined,
    { flags: { structure_delta: true } },
    { flags: {}, issc_decision_ref: 'ISSC-2026-014' },
  ]) {
    assert.deepEqual(evaluate(PASSPORT, PLAN, REGISTRY, { ...WITH_DPIA, envelope, notices }), []);
  }
  assert.deepEqual(notices, [], 'a conventional change must not even be told which lane it took');
});
}

// --- A2 · builder ∩ Shari’ah = ∅ ---------------------------------------------------------------
//
// These fixtures are built in this file rather than read from the bundled worked example, so they
// run in a bare adoption too. Alpha Islamic Bank is the harness's fictional Islamic institution.
//
// The defect: the "builder cannot issue second-line approval" finding only fires for roles in
// SECOND_LINE_ROLES, and none of the three Shari'ah roles were in it. A builders-group identity
// holding `shariah-committee` signed the Shari'ah approval of their own change under a green gate.

const SHARIAH_ROLES = ['shariah-committee', 'shariah-compliance', 'shariah-audit'];

test('all three Shari’ah roles demand independence from the builders', () => {
  for (const role of SHARIAH_ROLES) assert.ok(SECOND_LINE_ROLES.has(role), `${role} must require builder-disjointness`);
  assert.ok(!SECOND_LINE_ROLES.has('shariah-board'), 'shariah-board is retired vocabulary');
});

test('a BUILDER holding a Shari’ah role cannot sign that Shari’ah approval', () => {
  for (const role of SHARIAH_ROLES) {
    const registry = {
      groups: { builders: '', 'second-line': '' },
      identities: [{ id: 'scholar-who-builds', kind: 'human', roles: [role], groups: ['builders'] }],
    };
    const { findings } = checkApprovals([{ role, by: 'scholar-who-builds' }], [role], registry, 'alpha', 'PA1', {});
    assert.ok(findings.some((f) => /scholar-who-builds is in the builders group — a builder cannot issue (second|third)-line approval/.test(f)),
      `${role}: a builder signing their own Shari'ah certification must be refused:\n${findings.join('\n')}`);
  }
});

test('internal Shari’ah audit is named as THIRD line in the refusal — it is not second line', () => {
  const registry = {
    groups: { builders: '' },
    identities: [{ id: 'auditor-who-builds', kind: 'human', roles: ['shariah-audit'], groups: ['builders'] }],
  };
  const { findings } = checkApprovals([{ role: 'shariah-audit', by: 'auditor-who-builds' }], ['shariah-audit'], registry, 'alpha', 'PA2', {});
  assert.ok(findings.some((f) => /a builder cannot issue third-line approval/.test(f)), findings.join('\n'));
});

// --- G1 · the conforming-change lane -----------------------------------------------------------
//
// The committee approves STRUCTURES; the Shari'ah Compliance Function clears changes that CONFORM
// to an already-approved structure. Without this, every Islamic change queues on a 3-scholar quorum
// that sits fortnightly. The lane REMOVES a quorum, so what unlocks it is the load-bearing part:
// the cited ruling must resolve, in the decision register, to an active, non-template row this
// change's product is within. A ruling id that only has to be a plausible STRING is a quorum that
// can be dropped by typing one.
//
// (Committee ratification of what flows through the lane is an organisational obligation. Nothing
// in the harness verifies it, so nothing here tests it — and the notice says so out loud.)

const ISLAMIC_PLAN = {
  change_id: 'CHG-ALPHA-0007',
  risk_tier: 'high',
  required_gates: ['PA1'],
  required_approver_roles: ['accountable-executive', 'product-owner', 'risk-second-line', 'shariah-committee', 'shariah-compliance'],
  pa1_approver_roles: ['shariah-committee', 'shariah-compliance'],
  pa1_sections: ['ownership', 'shariah-structure'],
  pa2_sections: ['shariah-approval'],
};

const ISLAMIC_REGISTRY = {
  groups: { builders: '', 'second-line': '', 'shariah-function': '' },
  identities: [
    { id: 'po-noor', kind: 'human', roles: ['product-owner'], groups: ['builders'] },
    { id: 'exec-mariam', kind: 'human', roles: ['accountable-executive'], groups: [] },
    { id: 'risk-yusuf', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'scholar-a', kind: 'human', roles: ['shariah-committee'], groups: ['shariah-function'] },
    { id: 'scholar-b', kind: 'human', roles: ['shariah-committee'], groups: ['shariah-function'] },
    { id: 'scholar-c', kind: 'human', roles: ['shariah-committee'], groups: ['shariah-function'] },
    { id: 'shc-huda', kind: 'human', roles: ['shariah-compliance'], groups: ['second-line'] },
  ],
  // Majority of the CBUAE minimum of five. This number is the whole reason the lane exists.
  quorum: { 'shariah-committee': 3 },
};

const islamicPassport = (approvals, extra = {}) => ({
  sections: {
    ownership: { product_owner: 'po-noor', accountable_executive: 'exec-mariam' },
    'shariah-structure': { structure: 'Murabaha', ownership_sequencing: 'bank takes title before sale' },
    ...(extra.sections || {}),
  },
  pa1: { decision: 'approved', approvals },
  ...(extra.rest || {}),
});

// Everything PA1 binds on a high-tier change EXCEPT the Shari'ah roles — the lane is the only
// variable under test here.
const BASE_APPROVALS = [
  { role: 'product-owner', by: 'po-noor' },
  { role: 'risk-second-line', by: 'risk-yusuf' },
  { role: 'accountable-executive', by: 'exec-mariam' },
];
// The decision register the cited ruling has to resolve in — `{ present, doc }`, the shape
// loadRulings() returns. Every status the register can carry is represented, because each one
// fails the lane differently: one moved, one is gone, one was never issued, one is still template.
const ruling = (over = {}) => ({
  issued_by: 'issc-secretariat', issued_at: '2026-04-02', evidence_path: 'minutes/2026-04-02.pdf',
  product_ids: ['PRD-ALPHA-1'], sharia_structures: ['Murabaha'], status: 'active', supersedes: null, ...over,
});
const RULINGS = {
  present: true,
  doc: {
    rulings: [
      ruling({ ruling_id: 'SR-0001' }),
      ruling({ ruling_id: 'SR-0002', status: 'superseded' }),
      ruling({ ruling_id: 'SR-0003', supersedes: 'SR-0002' }),
      ruling({ ruling_id: 'SR-0004', status: 'withdrawn' }),
      // Institution-wide filing: no product scope, so coverage is not checkable against it.
      ruling({ ruling_id: 'SR-0005', product_ids: [] }),
      // governance/shariah-rulings.template.json, mounted and never edited.
      ruling({
        ruling_id: 'SR-0009',
        issued_by: 'ADOPT: the registry id of the COMMITTEE or its secretariat',
        issued_at: 'ADOPT: RFC 3339 date the ruling was issued',
        evidence_path: 'ADOPT: path or reference to the signed ruling itself',
        product_ids: ['ADOPT: the product ids this ruling governs'],
      }),
    ],
  },
};
const CONFORMING = { change_id: 'CHG-ALPHA-0007', product_id: 'PRD-ALPHA-1', flags: { islamic: true }, issc_decision_ref: 'SR-0001' };
// What evaluate() is handed for a repository that has mounted its register.
const ISLAMIC_CTX = (over = {}) => ({ envelope: CONFORMING, rulings: RULINGS, ...over });

test('shariahLane reads the DECLARED flag: a structure delta is said out loud, or it is conforming', () => {
  assert.equal(shariahLane({}, { flags: { structure_delta: true } }), 'structure-delta');
  assert.equal(shariahLane({}, { flags: { structure_delta: false } }), 'conforming');
  assert.equal(shariahLane({}, { flags: { islamic: true } }), 'conforming');
  assert.equal(shariahLane({}, undefined), 'conforming');
  // Not truthiness — a string is a declaration nobody made in the shape the flag requires.
  assert.equal(shariahLane({}, { flags: { structure_delta: 'yes' } }), 'conforming');
  // A plan carrying its own copy answers when the envelope is not to hand; the envelope wins.
  assert.equal(shariahLane({ flags: { structure_delta: true } }, undefined), 'structure-delta');
  assert.equal(shariahLane({ flags: { structure_delta: true } }, { flags: {} }), 'conforming');
});

test('a CONFORMING change against a RESOLVING, ACTIVE ruling passes PA1 on shariah-compliance alone', () => {
  const notices = [];
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY, ISLAMIC_CTX({ notices }));
  assert.deepEqual(findings, [], `the conforming lane must not queue on the committee:\n${findings.join('\n')}`);
  // …and the lane it took is on the record, with the ruling it conformed to.
  assert.ok(notices.some((n) => /Shari'ah lane = CONFORMING against ISSC decision "SR-0001"/.test(n)),
    `the lane must be announced, or an auditor cannot tell three scholars from one officer:\n${notices.join('\n')}`);
  assert.ok(notices.some((n) => /scholars decide Shari'ah/.test(n)), 'the notice must say what was NOT checked');
  // Honesty grammar: the notice claims exactly what the code did, and disclaims the rest.
  assert.ok(notices.some((n) => /CHECKED: that ruling resolves in docs\/governance\/shariah-rulings\.json to a row whose status is "active"/.test(n)),
    `the notice must name what the binding actually proved:\n${notices.join('\n')}`);
  assert.ok(notices.some((n) => /product PRD-ALPHA-1 is listed in that ruling's product_ids/.test(n)), notices.join('\n'));
  assert.ok(notices.some((n) => /ratification .* is an organisational obligation NO gate here verifies/.test(n)),
    `the compensating control must be stated as an unverified obligation, not claimed:\n${notices.join('\n')}`);
});

// THE DEFECT. The only test on the ruling that buys a 3-scholar quorum for one signature used to be
// "is a non-empty string" — so a typo, a withdrawn ruling or an id nobody ever issued bought the
// relaxation exactly as well as a real decision did.
test('a ruling id that does not RESOLVE in the register does not open the lane', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, issc_decision_ref: 'SR-NEVER-ISSUED' } }));
  assert.ok(findings.some((f) => /no row in docs\/governance\/shariah-rulings\.json carries that ruling_id/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)),
    `the committee binding must stand when the citation resolves to nothing:\n${findings.join('\n')}`);
});

test('a SUPERSEDED ruling does not open the lane, and the finding names its replacement', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, issc_decision_ref: 'SR-0002' } }));
  assert.ok(findings.some((f) => /"SR-0002" — its status is "superseded", not "active"; SR-0003 replaces it/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('a WITHDRAWN ruling leaves nothing to conform to, and the finding says so rather than naming a successor', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, issc_decision_ref: 'SR-0004' } }));
  assert.ok(findings.some((f) => /"withdrawn".*nothing in the register replaces it/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('an UNTOUCHED TEMPLATE row does not open the lane however "active" it says it is', () => {
  // governance/shariah-rulings.template.json ships rows with status "active". Mounted unedited,
  // citing SR-0009 would otherwise resolve, read active, and drop the quorum on a shipped example.
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, issc_decision_ref: 'SR-0009' } }));
  assert.ok(findings.some((f) => /still an adoption template \(issued_by, issued_at, evidence_path are unset or an ADOPT marker\)/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('a ruling that governs ANOTHER product does not clear this one', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, product_id: 'PRD-ALPHA-9' } }));
  assert.ok(findings.some((f) => /governs PRD-ALPHA-1 and this change is against product PRD-ALPHA-9/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('coverage is only claimed where both sides say something — and the notice says when it did not', () => {
  const notices = [];
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  // An institution-wide filing declares no product scope: the lane still opens, and the notice
  // refuses to imply a coverage check that did not happen.
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ envelope: { ...CONFORMING, issc_decision_ref: 'SR-0005' }, notices }));
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(notices.some((n) => /coverage NOT checked — the ruling declares no product scope, or the envelope names no product_id/.test(n)), notices.join('\n'));
});

// THE REGISTER-ABSENT CHOICE, made explicit and tested. The lane is REFUSED, not opened with a
// caveat: a quorum relaxation granted on a citation nothing in the repository can resolve would let
// the least-governed repository take the most-relaxed route. Falling back to the committee binding
// costs an unregistered adopter exactly what they had before the lane existed, and it is announced.
test('with NO decision register the relaxation is refused, not granted with a NOT-VERIFIED caveat', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  for (const rulings of [undefined, { present: false, doc: null, path: null }]) {
    const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY, { envelope: CONFORMING, rulings });
    assert.ok(findings.some((f) => /carries no docs\/governance\/shariah-rulings\.json to resolve it against — the relaxation is REFUSED/.test(f)), findings.join('\n'));
    assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)),
      `the committee binding must stand when the register is absent:\n${findings.join('\n')}`);
  }
});

test('a register that is present but unreadable resolves nothing, and unlocks nothing', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY,
    ISLAMIC_CTX({ rulings: { present: true, doc: null, path: 'docs/governance/shariah-rulings.json' } }));
  assert.ok(findings.some((f) => /present but is not valid JSON, so ISSC decision "SR-0001" resolves to nothing/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('this gate looks for the decision register where the other Shari’ah gates put it', async () => {
  // The path and the "active" spelling are declared per gate (so one gate's refactor cannot stop
  // another from loading), which makes DRIFT the risk that swap buys. Three gates pointing at three
  // paths would mean a ruling that resolves for one control and not for another.
  let compared = 0;
  for (const path of ['./shariah-governance-check.mjs', './profit-distribution-check.mjs']) {
    let m;
    try { m = await import(path); } catch { continue; } // a sibling mid-refactor is not this gate's failure
    if (m.RULINGS_LOCATIONS) { assert.deepEqual(m.RULINGS_LOCATIONS, RULINGS_LOCATIONS, path); compared++; }
    if (m.ACTIVE_STATUS) assert.equal(m.ACTIVE_STATUS, ACTIVE_STATUS, path);
  }
  assert.ok(compared > 0, 'no sibling gate declares RULINGS_LOCATIONS any more — the register moved and this gate did not');
});

test('resolveRulingBinding answers each way independently of the lane that calls it', () => {
  assert.equal(resolveRulingBinding('SR-0001', RULINGS, 'PRD-ALPHA-1').bound, true);
  assert.equal(resolveRulingBinding('  SR-0001  ', RULINGS, 'PRD-ALPHA-1').bound, true, 'ids are compared trimmed');
  assert.equal(resolveRulingBinding('sr-0001', RULINGS, 'PRD-ALPHA-1').bound, false, 'ids are not case-folded — a register is a lookup, not a guess');
  for (const ref of ['SR-0002', 'SR-0004', 'SR-0009', 'SR-NEVER-ISSUED']) {
    assert.equal(resolveRulingBinding(ref, RULINGS, 'PRD-ALPHA-1').bound, false, ref);
  }
  // No register handle at all: nothing resolves, and nothing throws.
  assert.equal(resolveRulingBinding('SR-0001', undefined, 'PRD-ALPHA-1').bound, false);
  assert.equal(resolveRulingBinding('SR-0001', { present: true, doc: {} }, 'PRD-ALPHA-1').bound, false, 'a register with no rulings array resolves nothing');
});

test('loadRulings distinguishes absent from unreadable from readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-rulings-'));
  try {
    assert.deepEqual(loadRulings(dir), { present: false, doc: null, path: null });
    mkdirSync(join(dir, 'docs/governance'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/shariah-rulings.json'), '{ not json');
    const broken = loadRulings(dir);
    assert.equal(broken.present, true);
    assert.equal(broken.doc, null, 'unreadable is present-with-no-doc, never absent');
    writeFileSync(join(dir, 'docs/governance/shariah-rulings.json'), JSON.stringify(RULINGS.doc));
    assert.equal(loadRulings(dir).doc.rulings.length, RULINGS.doc.rulings.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the conforming lane without an issc_decision_ref fails, and the committee still binds', () => {
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]);
  for (const envelope of [
    { change_id: 'CHG-ALPHA-0007', flags: { islamic: true } },              // absent
    { change_id: 'CHG-ALPHA-0007', issc_decision_ref: '' },                 // empty
    { change_id: 'CHG-ALPHA-0007', issc_decision_ref: '   ' },              // whitespace
    { change_id: 'CHG-ALPHA-0007', issc_decision_ref: 'ADOPT: the ISSC ruling id' }, // never replaced
    { change_id: 'CHG-ALPHA-0007', issc_decision_ref: 'TBD' },
    { change_id: 'CHG-ALPHA-0007', issc_decision_ref: '<ruling-id>' },
  ]) {
    const findings = evaluate(passport, ISLAMIC_PLAN, ISLAMIC_REGISTRY, ISLAMIC_CTX({ envelope }));
    assert.ok(findings.some((f) => /names no issc_decision_ref/.test(f)),
      `${JSON.stringify(envelope.issc_decision_ref)} must not open the lane:\n${findings.join('\n')}`);
    assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)),
      `the committee binding must stand when the lane does not open:\n${findings.join('\n')}`);
  }
});

test('a STRUCTURE-DELTA change still demands the full committee quorum', () => {
  const envelope = { ...CONFORMING, flags: { islamic: true, structure_delta: true } };
  const notices = [];
  // Compliance alone, with a perfectly good ruling reference: not enough. A new structure is the
  // committee's to approve, and citing an old ruling is not a route around that.
  const one = evaluate(islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }]),
    ISLAMIC_PLAN, ISLAMIC_REGISTRY, ISLAMIC_CTX({ envelope, notices }));
  assert.ok(one.some((f) => /no approval for required role shariah-committee/.test(f)), one.join('\n'));
  assert.ok(notices.some((n) => /Shari'ah lane = STRUCTURE-DELTA/.test(n)), notices.join('\n'));

  // Two scholars is a committee short of its quorum, and the gate counts.
  const two = evaluate(islamicPassport([
    ...BASE_APPROVALS,
    { role: 'shariah-compliance', by: 'shc-huda' },
    { role: 'shariah-committee', by: 'scholar-a' },
    { role: 'shariah-committee', by: 'scholar-b' },
  ]), ISLAMIC_PLAN, ISLAMIC_REGISTRY, ISLAMIC_CTX({ envelope }));
  assert.ok(two.some((f) => /shariah-committee needs a quorum of 3 distinct holders — 2 recorded/.test(f)), two.join('\n'));

  // Three distinct scholars: the structure is approved by the body, and PA1 is clean.
  const full = [
    ...BASE_APPROVALS,
    { role: 'shariah-compliance', by: 'shc-huda' },
    { role: 'shariah-committee', by: 'scholar-a' },
    { role: 'shariah-committee', by: 'scholar-b' },
    { role: 'shariah-committee', by: 'scholar-c' },
  ];
  const three = evaluate(islamicPassport(full), ISLAMIC_PLAN, ISLAMIC_REGISTRY, ISLAMIC_CTX({ envelope }));
  assert.deepEqual(three, [], three.join('\n'));

  // …and the structure-delta path does not depend on the register at all: it never asked for a
  // relaxation, so having no register to resolve a ruling in changes nothing about it.
  for (const rulings of [undefined, { present: true, doc: null }, RULINGS]) {
    assert.deepEqual(evaluate(islamicPassport(full), ISLAMIC_PLAN, ISLAMIC_REGISTRY, { envelope, rulings }), [],
      'a declared structure delta binds the committee and asks the register for nothing');
  }
});

test('the conforming lane does not open when the plan compiles no shariah-compliance role', () => {
  const plan = {
    ...ISLAMIC_PLAN,
    required_approver_roles: ISLAMIC_PLAN.required_approver_roles.filter((r) => r !== 'shariah-compliance'),
    pa1_approver_roles: ['shariah-committee'],
  };
  const findings = evaluate(islamicPassport(BASE_APPROVALS), plan, ISLAMIC_REGISTRY, ISLAMIC_CTX());
  assert.ok(findings.some((f) => /a lane with nobody in it is not a lane/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /no approval for required role shariah-committee/.test(f)), findings.join('\n'));
});

test('the conforming lane substitutes shariah-compliance even when the profile bound it only at PA2', () => {
  // The role is compiled but not pa1-binding. The lane cannot clear a change through a function
  // nobody signed for, so the substitution ADDS the requirement rather than dropping one.
  const plan = { ...ISLAMIC_PLAN, pa1_approver_roles: ['shariah-committee'] };
  const res = conformingLanePa1(plan, CONFORMING, pa1Roles(plan), 'alpha · PA1', RULINGS);
  assert.equal(res.lane, 'conforming');
  assert.equal(res.substituted, true);
  assert.ok(!res.roles.includes('shariah-committee'));
  assert.ok(res.roles.includes('shariah-compliance'));
  const findings = evaluate(islamicPassport(BASE_APPROVALS), plan, ISLAMIC_REGISTRY, ISLAMIC_CTX());
  assert.ok(findings.some((f) => /no approval for required role shariah-compliance/.test(f)), findings.join('\n'));
});

test('conformingLanePa1 is inert where no committee is bound — no roles moved, nothing announced', () => {
  // Dormancy does not depend on the register being absent: a repository with no Shari'ah role
  // compiled is untouched whether or not one is mounted, and whichever lane the envelope declares.
  const roles = ['product-owner', 'risk-second-line'];
  const inert = { roles, lane: null, substituted: false, ref: null, findings: [], notices: [] };
  for (const envelope of [{ flags: { structure_delta: true } }, CONFORMING, undefined]) {
    for (const rulings of [undefined, RULINGS, { present: true, doc: null }]) {
      assert.deepEqual(conformingLanePa1({ required_approver_roles: roles }, envelope, roles, 'x · PA1', rulings), inert);
    }
  }
});

test('the conforming lane never reaches PA2 — permission to LAUNCH keeps the full committee', () => {
  const plan = { ...ISLAMIC_PLAN, required_gates: ['PA1', 'PA2'] };
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }], {
    sections: { 'shariah-approval': { issc_decision_ref: 'SR-0001' } },
    rest: {
      pa2: {
        decision: 'approved',
        approvals: [...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }],
      },
    },
  });
  const findings = evaluate(passport, plan, ISLAMIC_REGISTRY, ISLAMIC_CTX());
  assert.ok(findings.some((f) => /PA2: no approval for required role shariah-committee/.test(f)), findings.join('\n'));
  assert.ok(!findings.some((f) => /PA1: no approval for required role shariah-committee/.test(f)),
    `PA1 must still take the conforming lane:\n${findings.join('\n')}`);
});

test('a builder in the Shari’ah compliance seat cannot clear their own change through the lane', () => {
  // The lane's whole safety rests on the clearing officer being independent. A builders-group
  // shariah-compliance holder would otherwise self-clear every conforming change.
  const registry = structuredClone(ISLAMIC_REGISTRY);
  registry.identities.push({ id: 'shc-builder', kind: 'human', roles: ['shariah-compliance'], groups: ['builders'] });
  const passport = islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-builder' }]);
  const findings = evaluate(passport, ISLAMIC_PLAN, registry, ISLAMIC_CTX());
  assert.ok(findings.some((f) => /shc-builder is in the builders group/.test(f)), findings.join('\n'));
});

// run() is where the register is actually READ. evaluate() proves the rule; only this proves that
// the rule is fed from docs/governance/shariah-rulings.json rather than from an argument a test
// supplied — which is the difference between a control and a well-tested function.
test('run() resolves the cited ruling off disk: the register on the filesystem decides the lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-lane-'));
  try {
    const base = join(dir, 'docs/governance/changes/CHG-ALPHA-0007');
    const gov = join(dir, 'docs/governance');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(gov, 'identities.json'), JSON.stringify(ISLAMIC_REGISTRY));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify(ISLAMIC_PLAN));
    writeFileSync(join(base, 'product-passport.json'),
      JSON.stringify(islamicPassport([...BASE_APPROVALS, { role: 'shariah-compliance', by: 'shc-huda' }])));
    const envelope = (ref) => writeFileSync(join(base, 'change-envelope.json'),
      JSON.stringify({ ...CONFORMING, control_plan: 'control-plan.json', issc_decision_ref: ref }));

    // No register on disk: the relaxation is refused and the committee binding stands.
    envelope('SR-0001');
    const bare = run(dir);
    assert.equal(bare.count, 1);
    assert.ok(bare.findings.some((f) => /the relaxation is REFUSED/.test(f)), bare.findings.join('\n'));
    assert.ok(bare.findings.some((f) => /no approval for required role shariah-committee/.test(f)), bare.findings.join('\n'));

    // Mount the register: the same change, same passport, now clears on the compliance signature.
    writeFileSync(join(gov, 'shariah-rulings.json'), JSON.stringify(RULINGS.doc));
    const mounted = run(dir);
    assert.deepEqual(mounted.findings, [], mounted.findings.join('\n'));
    assert.ok(mounted.notices.some((n) => /Shari'ah lane = CONFORMING against ISSC decision "SR-0001"/.test(n)), mounted.notices.join('\n'));

    // Withdraw that ruling in the file and nothing else: the lane closes again.
    writeFileSync(join(gov, 'shariah-rulings.json'), JSON.stringify({
      rulings: RULINGS.doc.rulings.map((r) => (r.ruling_id === 'SR-0001' ? { ...r, status: 'withdrawn' } : r)),
    }));
    const withdrawn = run(dir);
    assert.ok(withdrawn.findings.some((f) => /"SR-0001" — its status is "withdrawn"/.test(f)), withdrawn.findings.join('\n'));
    assert.ok(withdrawn.findings.some((f) => /no approval for required role shariah-committee/.test(f)), withdrawn.findings.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
