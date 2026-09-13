// Tests for the identity-registry gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTOR_ROLES, agentActorFindings, evaluate, isPlaceholder, resolveAcceptor, resolveApprover } from './identity-registry-check.mjs';

const REG = {
  groups: { builders: '', 'second-line': '' },
  identities: [
    { id: 'agent-1', kind: 'agent', roles: [], groups: ['builders'], model: { provider: 'p', model_id: 'm@2026-01', prompt_version: 'h@1.0.0' }, harness_role: 'delivery-loop', tool_permissions: ['Read', 'Edit'] },
    { id: 'eng-1', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'risk-1', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
  ],
};

test('a sound registry passes', () => {
  assert.deepEqual(evaluate(REG), []);
});

test('an agent holding approver roles is a finding', () => {
  const reg = { ...REG, identities: [...REG.identities, { id: 'agent-2', kind: 'agent', roles: ['compliance'], groups: [] }] };
  assert.ok(evaluate(reg).some((f) => /agent-2: an agent identity holds approver roles/.test(f)));
});

test('builders ∩ second-line must be empty', () => {
  const reg = { ...REG, identities: [...REG.identities, { id: 'both-1', kind: 'human', roles: ['risk-second-line'], groups: ['builders', 'second-line'] }] };
  assert.ok(evaluate(reg).some((f) => /both-1: is in BOTH builders and second-line/.test(f)));
});

test('duplicate ids, unknown groups and bad kinds are findings', () => {
  const reg = {
    groups: { builders: '' },
    identities: [
      { id: 'x', kind: 'human', roles: [], groups: [] },
      { id: 'x', kind: 'robot', roles: [], groups: ['ghosts'] },
    ],
  };
  const f = evaluate(reg);
  assert.ok(f.some((x) => /duplicate identity id/.test(x)));
  assert.ok(f.some((x) => /unknown group ghosts/.test(x)));
  assert.ok(f.some((x) => /kind must be human\|agent/.test(x)));
});

test('resolveApprover: free text, unknown ids, agents, and missing roles all fail', () => {
  assert.match(resolveApprover(REG, 'Risk', 'risk-second-line', 'x')[0], /not in the registry/);
  assert.match(resolveApprover(REG, '', 'risk-second-line', 'x')[0], /no identity given/);
  assert.ok(resolveApprover(REG, 'agent-1', undefined, 'x').some((f) => /never approve/.test(f)));
  assert.ok(resolveApprover(REG, 'eng-1', 'compliance', 'x').some((f) => /does not hold the required role/.test(f)));
  assert.deepEqual(resolveApprover(REG, 'risk-1', 'risk-second-line', 'x'), []);
});

// --- delegation and quorum (rc.38 · flow-plan Phase 4.5) -------------------------------------
//
// Both mechanisms exist to remove the single-named-human bus factor WITHOUT touching separation
// of duties, so every test below is about a rule the deputy inherits, or a window that closes.

const NOW = Date.parse('2026-07-28T00:00:00Z');
const DREG = (delegates, extra = {}) => ({
  groups: { builders: '', 'second-line': '', 'platform-admins': '' },
  identities: [
    { id: 'agent-1', kind: 'agent', roles: [], groups: ['builders'], runs_model: false },
    { id: 'eng-1', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'risk-1', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'], delegates },
    { id: 'risk-2', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'risk-3', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'dep-1', kind: 'human', roles: [], groups: [] },
    { id: 'grantor', kind: 'human', roles: ['compliance'], groups: ['second-line'] },
  ],
  ...extra,
});
const LIVE = [{ to: 'dep-1', from: '2026-07-20', until: '2026-08-20', granted_by: 'grantor' }];

test('a live delegation supplies the role, and SAYS it did', () => {
  const notices = [];
  const reg = DREG(LIVE);
  assert.deepEqual(evaluate(reg, { now: NOW }), []);
  assert.deepEqual(resolveApprover(reg, 'dep-1', 'risk-second-line', 'x', { notices, now: NOW }), []);
  assert.ok(notices.some((n) => /holds risk-second-line BY DELEGATION from risk-1 until 2026-08-20/.test(n)),
    'a deputy approval must never be indistinguishable from the holder\'s own');
});

test('a LAPSED delegation supplies nothing, and is reported rather than left in the file', () => {
  const reg = DREG([{ to: 'dep-1', from: '2026-01-01', until: '2026-02-01', granted_by: 'grantor' }]);
  assert.ok(resolveApprover(reg, 'dep-1', 'risk-second-line', 'x', { now: NOW }).some((f) => /does not hold the required role/.test(f)));
  const notices = [];
  evaluate(reg, { notices, now: NOW });
  assert.ok(notices.some((n) => /LAPSED at 2026-02-01/.test(n)));
});

test('a delegation not yet live supplies nothing either', () => {
  const reg = DREG([{ to: 'dep-1', from: '2026-12-01', until: '2026-12-31', granted_by: 'grantor' }]);
  assert.ok(resolveApprover(reg, 'dep-1', 'risk-second-line', 'x', { now: NOW }).some((f) => /does not hold the required role/.test(f)));
});

test('a delegation with no end date is refused — a permanent transfer wearing a temporary word', () => {
  const reg = DREG([{ to: 'dep-1', from: '2026-07-20', granted_by: 'grantor' }]);
  assert.ok(evaluate(reg, { now: NOW }).some((f) => /missing until \(a delegation with no end date/.test(f)));
});

test('an unparseable window is NOT a delegation — it fails closed', () => {
  const reg = DREG([{ to: 'dep-1', from: '2026-07-20', until: 'whenever', granted_by: 'grantor' }]);
  assert.ok(evaluate(reg, { now: NOW }).some((f) => /until "whenever" is not a parseable/.test(f)));
  assert.ok(resolveApprover(reg, 'dep-1', 'risk-second-line', 'x', { now: NOW }).some((f) => /does not hold the required role/.test(f)));
});

test('a second-line identity cannot deputise a BUILDER — the deputy inherits the independence', () => {
  const reg = DREG([{ to: 'eng-1', from: '2026-07-20', until: '2026-08-20', granted_by: 'grantor' }]);
  assert.ok(evaluate(reg, { now: NOW }).some((f) => /cannot deputise a BUILDER/.test(f)));
});

test('an AGENT cannot be a deputy', () => {
  const reg = DREG([{ to: 'agent-1', from: '2026-07-20', until: '2026-08-20', granted_by: 'grantor' }]);
  assert.ok(evaluate(reg, { now: NOW }).some((f) => /the deputy is an agent/.test(f)));
});

test('neither party may authorise the delegation, and the grantor must be second line', () => {
  for (const [who, re] of [['risk-1', /is a party to the delegation/], ['dep-1', /is a party to the delegation/], ['eng-1', /is not a second-line identity/]]) {
    const reg = DREG([{ to: 'dep-1', from: '2026-07-20', until: '2026-08-20', granted_by: who }]);
    assert.ok(evaluate(reg, { now: NOW }).some((f) => re.test(f)), who);
  }
});

test('a delegate cannot receive a role the delegator does not hold', () => {
  const reg = DREG(LIVE);
  assert.ok(resolveApprover(reg, 'dep-1', 'compliance', 'x', { now: NOW }).some((f) => /does not hold the required role compliance/.test(f)));
});

test('an unresolvable deputy inherits nothing', () => {
  const reg = DREG([{ to: 'nobody', from: '2026-07-20', until: '2026-08-20', granted_by: 'grantor' }]);
  assert.ok(evaluate(reg, { now: NOW }).some((f) => /the deputy is not in the registry/.test(f)));
});

test('a quorum may only raise the count, and must be satisfiable', () => {
  assert.deepEqual(evaluate(DREG(undefined, { quorum: { 'risk-second-line': 3 } }), { now: NOW }), []);
  assert.ok(evaluate(DREG(undefined, { quorum: { 'risk-second-line': 4 } }), { now: NOW })
    .some((f) => /only 3 human identities hold it — an unsatisfiable quorum/.test(f)));
  for (const bad of [0, -1, 1.5, '2', null]) {
    assert.ok(evaluate(DREG(undefined, { quorum: { compliance: bad } }), { now: NOW })
      .some((f) => /must be an integer ≥ 1/.test(f)), JSON.stringify(bad));
  }
});

// --- external identities ---------------------------------------------------------------------
//
// The identity map reconciles against the corporate directory and assumes a joiner/mover/leaver
// lifecycle. Committee appointees have neither. The pair below is the honest alternative, and both
// directions are tested because both failures are silent: an external identity nobody reconciles,
// and an employee who left the directory reconciliation by naming a register of their own.

const EXT = (extra) => ({ ...REG, identities: [...REG.identities, { id: 'ext-1', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'], ...extra }] });

test('an external identity must name the register that governs it instead of the directory', () => {
  assert.deepEqual(evaluate(EXT({ external: true, reconciliation_source: 'docs/governance/issc-register.json' })), []);
  assert.ok(evaluate(EXT({ external: true })).some((f) => /ext-1: external identities must name a reconciliation_source/.test(f)));
  assert.ok(evaluate(EXT({ external: true, reconciliation_source: '  ' })).some((f) => /must name a reconciliation_source/.test(f)));
  assert.ok(evaluate(EXT({ external: true, reconciliation_source: 'ADOPT: the register that governs them' }))
    .some((f) => /reconciliation_source is still an adoption marker/.test(f)));
});

test('a NON-external identity may not name a reconciliation_source — that is a hole, not an exemption', () => {
  assert.ok(evaluate(EXT({ reconciliation_source: 'docs/governance/some-list.json' }))
    .some((f) => /ext-1: names a reconciliation_source but is not external:true/.test(f)));
  assert.ok(evaluate(EXT({ external: false, reconciliation_source: 'docs/governance/some-list.json' }))
    .some((f) => /is not external:true/.test(f)));
  assert.deepEqual(evaluate(EXT({ external: false })), []);
});

test('external must be a boolean — a truthy string is not a declaration', () => {
  assert.ok(evaluate(EXT({ external: 'true', reconciliation_source: 'docs/governance/issc-register.json' }))
    .some((f) => /ext-1: external must be true or false \(got "true"\)/.test(f)));
  assert.ok(isPlaceholder('ADOPT: a register') && isPlaceholder('ADOPT-0001') && !isPlaceholder('docs/governance/issc-register.json'));
});

// The shipped template is what every adopter starts from, and it now carries the ISSC seats, the
// committee quorum and the external pair. A template the gate itself refuses is the worst possible
// first-run experience, so it is checked here rather than discovered on day one.
const IDENTITIES_PATH = [
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'governance', 'identities.template.json'),
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'governance', 'identities.json'),
].find(existsSync);
test('the shipped identities template satisfies its own gate', { skip: !IDENTITIES_PATH && 'identity registry not present in this layout' }, () => {
  const path = IDENTITIES_PATH;
  const template = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(evaluate(template), []);
  const scholars = template.identities.filter((i) => (i.roles || []).includes('shariah-committee'));
  assert.equal(scholars.length, 5, 'five seats — the regulatory minimum for the committee');
  for (const s of scholars) {
    assert.equal(s.external, true);
    assert.equal(s.reconciliation_source, 'docs/governance/issc-register.json');
    for (const f of ['hsa_approval_ref', 'appointment_instrument', 'appointment_date']) {
      assert.ok(isPlaceholder(s[f]), `${s.id}.${f} must ship as an ADOPT marker the adopter replaces`);
    }
  }
  // The committee is a BODY: three of five, a majority of the regulatory minimum. One member's
  // signature must never resolve as the committee's decision.
  assert.deepEqual(template.quorum, { 'shariah-committee': 3 });
  // Three lines, three people. Collapsing any two of them onto one identity is the defect.
  const holders = (role) => template.identities.filter((i) => (i.roles || []).includes(role)).map((i) => i.id);
  assert.equal(holders('shariah-compliance').length, 1);
  assert.equal(holders('shariah-audit').length, 1);
  assert.equal(new Set([...holders('shariah-committee'), ...holders('shariah-compliance'), ...holders('shariah-audit')]).size, 7);
  // Internal Shari'ah audit may never be outsourced, so it must resolve to an in-house human.
  const auditor = template.identities.find((i) => (i.roles || []).includes('shariah-audit'));
  assert.equal(auditor.kind, 'human');
  assert.ok(!auditor.external, 'internal Shari\'ah audit may not be outsourced — it cannot be an external identity');
  assert.ok(!('shariah-board' in (template.quorum || {})), 'shariah-board is retired vocabulary');
});

/* ---- 2.1.0 (hardening plan row 2.1): the agent as an actor ---- */

const AGENT = REG.identities[0];
const MANIFEST = { models: [{ role: 'delivery-loop', model_id: 'm@2026-01', prompt_version: 'h@1.0.0' }] };

test('ACTOR — an agent declares its model, its harness role and its tool permissions; silence on any is a finding', () => {
  assert.deepEqual(agentActorFindings(AGENT, { manifest: MANIFEST }), []);
  const { model: _m, ...noModel } = AGENT;
  assert.ok(agentActorFindings(noModel).some((f) => /carries no model block/.test(f)));
  assert.ok(agentActorFindings({ ...AGENT, model: { ...AGENT.model, model_id: 'latest' } }).some((f) => /floating tag, not a pin/.test(f)));
  assert.ok(agentActorFindings({ ...AGENT, model: { provider: 'p' } }).some((f) => /model.model_id is missing/.test(f)));
  const { harness_role: _r, ...noRole } = AGENT;
  assert.ok(agentActorFindings(noRole).some((f) => /no harness_role/.test(f)));
  const { tool_permissions: _t, ...noTools } = AGENT;
  assert.ok(agentActorFindings(noTools).some((f) => /tool_permissions must be an array/.test(f)));
  assert.deepEqual(agentActorFindings({ ...AGENT, tool_permissions: [] }, { manifest: MANIFEST }), [], 'an empty array means none, and is a declaration');
  assert.deepEqual(agentActorFindings({ id: 'h', kind: 'human', roles: ['engineering'] }), [], 'humans carry no actor block');
});

test('ACTOR — a service identity says runs_model: false, and then carries no model', () => {
  assert.deepEqual(agentActorFindings({ id: 'svc', kind: 'agent', runs_model: false }), []);
  assert.ok(agentActorFindings({ id: 'svc', kind: 'agent', runs_model: false, model: AGENT.model }).some((f) => /one or the other/.test(f)));
  assert.ok(agentActorFindings({ id: 'svc', kind: 'agent', runs_model: 'no' }).some((f) => /runs_model must be true or false/.test(f)));
});

test('ACTOR — the pins are cross-checked against the model manifest; no manifest is NOT VERIFIED, never a pass by silence', () => {
  assert.ok(agentActorFindings(AGENT, { manifest: { models: [] } }).some((f) => /not a role in the model manifest/.test(f)));
  assert.ok(agentActorFindings(AGENT, { manifest: { models: [{ role: 'delivery-loop', model_id: 'other@1', prompt_version: 'h@1.0.0' }] } }).some((f) => /the registry and the inventory disagree/.test(f)));
  assert.ok(agentActorFindings(AGENT, { manifest: { models: [{ role: 'delivery-loop', model_id: 'm@2026-01', prompt_version: 'h@9' }] } }).some((f) => /prompt_version .* is not the manifest's pin/.test(f)));
  const notices = [];
  assert.deepEqual(agentActorFindings(AGENT, { manifest: null, notices }), []);
  assert.ok(notices.some((n) => /NOT VERIFIED against the model manifest/.test(n)));
  assert.deepEqual(evaluate(REG, { manifest: MANIFEST }), []);
});

test('ACCEPTOR — a human outside builders holding a business role; agents, builders and role-less humans cannot accept', () => {
  const reg = { ...REG, identities: [...REG.identities, { id: 'po-1', kind: 'human', roles: ['product-owner'], groups: [] }] };
  assert.deepEqual(ACCEPTOR_ROLES, ['product-owner', 'business-owner']);
  assert.deepEqual(resolveAcceptor(reg, 'po-1', 'uat'), []);
  assert.ok(resolveAcceptor(reg, 'agent-1', 'uat').some((f) => /is an AGENT/.test(f)));
  assert.ok(resolveAcceptor(reg, 'eng-1', 'uat').some((f) => /in the builders group/.test(f)));
  assert.ok(resolveAcceptor(reg, 'risk-1', 'uat').some((f) => /holds none of the business roles/.test(f)));
  assert.ok(resolveAcceptor(reg, 'ghost', 'uat').some((f) => /not in the identity registry/.test(f)));
  assert.ok(resolveAcceptor(reg, '', 'uat').some((f) => /no identity given/.test(f)));
});
