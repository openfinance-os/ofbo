// Tests for the environment gate (rc.39 · flow-plan Phase 5.1). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CLASSIFICATIONS, evaluate } from './environments-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REGISTRY = {
  identities: [
    { id: 'eng-omar', kind: 'human', groups: ['builders'] },
    { id: 'ops-dana', kind: 'human', groups: [] },
    { id: 'padmin-zoe', kind: 'human', groups: ['platform-admins'] },
    { id: 'agent-loom-delivery', kind: 'agent', groups: ['builders'] },
  ],
};

const env = (over = {}) => ({
  id: 'dev', purpose: 'integration', data_classification: 'synthetic', identity: 'eng-omar',
  promotion_source: null, approval_required: false, url: 'https://dev.bank.test', ...over,
});
const ladder = (...over) => ({
  environments: [
    env(),
    env({ id: 'staging', promotion_source: 'dev', data_classification: 'masked', identity: 'ops-dana', url: 'https://staging.bank.test' }),
    env({ id: 'production', promotion_source: 'staging', data_classification: 'personal', identity: 'padmin-zoe', approval_required: true, url: 'https://bank.test' }),
    ...over,
  ],
});
const check = (doc) => evaluate(doc, { registry: REGISTRY });

test('a coherent three-rung ladder passes with no findings and no notices', () => {
  const { findings, notices } = check(ladder());
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('an empty or absent estate declaration is a finding, not an empty pass', () => {
  assert.match(check({}).findings[0], /no `environments` array/);
  assert.match(check({ environments: [] }).findings[0], /no `environments` array/);
});

test('SHAPE — purpose, url, data_classification and approval_required are each required', () => {
  for (const [field, bad, re] of [
    ['purpose', '', /no purpose/],
    ['url', '', /no url/],
    ['data_classification', 'whatever', /data_classification must be/],
    ['approval_required', 'yes', /approval_required must be true or false/],
  ]) {
    const doc = ladder();
    doc.environments[0][field] = bad;
    assert.ok(check(doc).findings.some((f) => re.test(f)), `${field}: ${check(doc).findings.join('\n')}`);
  }
  assert.ok(DATA_CLASSIFICATIONS.includes('personal'));
});

test('duplicate environment ids are refused', () => {
  const doc = ladder(env({ id: 'dev', promotion_source: 'staging' }));
  assert.ok(check(doc).findings.some((f) => /duplicate environment id/.test(f)));
});

test('LADDER — exactly one root; zero roots and two roots are both findings', () => {
  const two = ladder();
  two.environments[1].promotion_source = null;
  assert.ok(check(two).findings.some((f) => /2 root environments/.test(f)));
  const none = ladder();
  none.environments[0].promotion_source = 'production';
  assert.ok(check(none).findings.some((f) => /no root environment/.test(f)));
});

test('LADDER — an undeclared source, a self-reference, and a cycle each fail', () => {
  const undeclared = ladder();
  undeclared.environments[1].promotion_source = 'preprod';
  assert.ok(check(undeclared).findings.some((f) => /is not a declared environment/.test(f)));

  const selfref = ladder();
  selfref.environments[1].promotion_source = 'staging';
  assert.ok(check(selfref).findings.some((f) => /promotes from itself/.test(f)));

  const cyclic = ladder();
  cyclic.environments[0].promotion_source = 'production';
  assert.ok(check(cyclic).findings.some((f) => /contains a cycle/.test(f)), check(cyclic).findings.join('\n'));
});

test('IDENTITY — the promoter must resolve, and with no registry at all it does not count', () => {
  const ghost = ladder();
  ghost.environments[2].identity = 'nobody';
  assert.ok(check(ghost).findings.some((f) => /does not resolve in the identity registry/.test(f)));
  const { findings } = evaluate(ladder(), { registry: null });
  assert.ok(findings.some((f) => /cannot be resolved — no identity registry found/.test(f)));
});

test('IDENTITY — an approval-required environment may not be promoted into by a builder or an agent', () => {
  const builder = ladder();
  builder.environments[2].identity = 'eng-omar';
  assert.ok(check(builder).findings.some((f) => /in the builders group/.test(f)));

  const agent = ladder();
  agent.environments[2].identity = 'agent-loom-delivery';
  assert.ok(check(agent).findings.some((f) => /is an agent/.test(f)));

  // …but a builder promoting into a NON-approval environment is ordinary first-line work.
  assert.deepEqual(check(ladder()).findings, []);
});

test('PERSONAL — real customer data behind an unattended promotion fails', () => {
  const doc = ladder();
  doc.environments[1].data_classification = 'personal';
  assert.ok(check(doc).findings.some((f) => /holds personal data with approval_required false/.test(f)));
});

test('TERMINAL — the environment nothing promotes out of must require approval', () => {
  const doc = ladder();
  doc.environments[2].approval_required = false;
  doc.environments[2].data_classification = 'masked'; // isolate the terminal rule from the personal one
  const { findings } = check(doc);
  assert.ok(findings.some((f) => /nothing promotes out of it/.test(f)), findings.join('\n'));
});

test('a ladder still carrying the shipped placeholder URLs NOTICES loudly and still passes', () => {
  const doc = ladder();
  for (const e of doc.environments) e.url = `https://${e.id}.credit.example.invalid`;
  const { findings, notices } = check(doc);
  assert.deepEqual(findings, []);
  assert.equal(notices.length, 3);
  assert.match(notices[0], /shipped template's placeholder/);
});

// The shipped template is itself a coherent ladder — a worked example that does not pass its own
// gate teaches the wrong shape. It resolves against the shipped identity registry, and it prints
// the placeholder notice, which is the point: green, and audibly not yours.
test('the SHIPPED environments template is a valid ladder against the shipped registry', { skip: !existsSync(`${H}/governance/environments.template.json`) && 'bundle-only fixture' }, () => {
  const doc = JSON.parse(readFileSync(`${H}/governance/environments.template.json`, 'utf8'));
  const registry = JSON.parse(readFileSync(`${H}/governance/identities.template.json`, 'utf8'));
  const { findings, notices } = evaluate(doc, { registry });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.equal(notices.length, 3, 'every shipped url is a placeholder and must say so');
});
