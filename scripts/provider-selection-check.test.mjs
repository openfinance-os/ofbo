// Tests for the provider-selection gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, loadCatalog, isPlaceholder } from './provider-selection-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROLES = [
  { role: 'sca', control: 'Q4-SUPPLY', capability: 'sca' },
  { role: 'hardened-runtime', control: 'HG-0011', capability: 'hardened_runtime' },
  { role: 'shariah-governance', control: 'SHARIAH-GOV', capability: 'shariah_governance' },
  { role: 'runtime-guardrails', control: 'AI-INCIDENT', capability: 'runtime_guardrails' },
];
const catalogOf = (...entries) => new Map(entries);
const CATALOG = catalogOf(
  ['sca/snyk', { provider: 'snyk', satisfies_control: 'Q4-SUPPLY', adapter_id: 'snyk-sca' }],
  ['sca/trivy', { provider: 'trivy', satisfies_control: 'Q4-SUPPLY', adapter_id: 'trivy-sca' }],
  ['hardened-runtime/chainguard', { provider: 'chainguard', satisfies_control: 'HG-0011', adapter_id: 'chainguard-runtime' }],
  ['shariah-governance/internal-issc-register', { provider: 'internal-issc-register', satisfies_control: 'SHARIAH-GOV', adapter_id: 'internal-issc-register' }],
  ['runtime-guardrails/gateway-policy-enforcement', { provider: 'gateway-policy-enforcement', satisfies_control: 'AI-INCIDENT', adapter_id: 'gateway-policy-enforcement' }],
);
const ACTIVE = { adapter_id: 'snyk-sca', activation_evidence: { fetched_at: '2026-07-20T00:00:00Z', tamper_probe: 'rejected' } };
const PENDING = { adapter_id: 'snyk-sca', activation_evidence: { fetched_at: 'ADOPT: timestamp of your Snyk API read' } };
const SEL = { role: 'sca', provider: 'snyk', adapter_id: 'snyk-sca' };
const run = (o) => evaluate({ roles: ROLES, catalog: CATALOG, mounted: new Map(), ...o });

test('a mounted, active selection passes clean', () => {
  const r = run({ selections: [SEL], mounted: new Map([['snyk-sca', ACTIVE]]) });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.notices, []);
  assert.equal(r.selected, 1);
});

test('mounted but not yet activated is a NOTICE, not a failure — the honest resting state', () => {
  const r = run({ selections: [SEL], mounted: new Map([['snyk-sca', PENDING]]) });
  assert.deepEqual(r.findings, []);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /selected, not active/);
});

test('PS-R01: a role the catalog does not define', () => {
  const r = run({ selections: [{ ...SEL, role: 'dast' }] });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R01/);
});

test('PS-R02: a provider that does not exist under the role', () => {
  const r = run({ selections: [{ ...SEL, provider: 'acme-scanner' }] });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R02/);
});

test('PS-R03: two providers for one role is AD-R05 re-entered at selection time', () => {
  const r = run({
    selections: [SEL, { role: 'sca', provider: 'trivy', adapter_id: 'trivy-sca' }],
    mounted: new Map([['snyk-sca', ACTIVE]]),
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R03/);
  assert.equal(r.selected, 1, 'the duplicate is refused, not silently merged');
});

test('the same provider chosen for two DIFFERENT roles is fine — roles are what must be unique', () => {
  const r = run({
    selections: [SEL, { role: 'hardened-runtime', provider: 'chainguard', adapter_id: 'chainguard-runtime' }],
    mounted: new Map([['snyk-sca', ACTIVE], ['chainguard-runtime', { adapter_id: 'chainguard-runtime', activation_evidence: { fetched_at: '2026-07-20' } }]]),
  });
  assert.deepEqual(r.findings, []);
  assert.equal(r.selected, 2);
});

test('PS-R04: a provider filling a different control than the role claims', () => {
  const catalog = catalogOf(['sca/wrong', { provider: 'wrong', satisfies_control: 'HG-0011', adapter_id: 'wrong' }]);
  const r = evaluate({ roles: ROLES, catalog, mounted: new Map([['wrong', ACTIVE]]), selections: [{ role: 'sca', provider: 'wrong', adapter_id: 'wrong' }] });
  assert.ok(r.findings.some((f) => /PS-R04/.test(f)));
});

test('PS-R05: selecting without mounting is a preference, not a choice', () => {
  const r = run({ selections: [SEL] });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R05/);
});

test('PS-R06: a compiled plan requiring the capability with nothing selected', () => {
  const r = run({ selections: [], requiredCapabilities: new Set(['sca']) });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R06/);
  assert.match(r.findings[0], /"sca"/);
});

test('PS-R06 does not fire for a capability no compiled plan requires', () => {
  assert.deepEqual(run({ selections: [] }).findings, []);
});

test('PS-R06 is satisfied by a selection that is merely mounted, not yet active', () => {
  const r = run({ selections: [SEL], mounted: new Map([['snyk-sca', PENDING]]), requiredCapabilities: new Set(['sca']) });
  assert.deepEqual(r.findings, [], 'requiring a DECISION is not the same as requiring it to be live');
});

/* ---- The two roles that must stay DORMANT until a plan names them ---- */

// A new row in roles.json makes a capability enforceable with zero code: PS-R06 reads the catalog
// generically. These two tests are the proof for each new row — armed when compiled, silent when not.
// The silence half matters more than the failure half: a conventional adopter who runs no Islamic
// product and serves no agent must never be failed by a control that has nothing to do with them.

test('PS-R06: an Islamic plan requiring shariah_governance with no provider selected', () => {
  const r = run({ selections: [], requiredCapabilities: new Set(['shariah_governance']) });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R06/);
  assert.match(r.findings[0], /"shariah_governance"/);
  assert.match(r.findings[0], /"shariah-governance"/);
});

test('shariah_governance is satisfied by a recorded, mounted choice', () => {
  const sel = { role: 'shariah-governance', provider: 'internal-issc-register', adapter_id: 'internal-issc-register' };
  const mounted = new Map([['internal-issc-register', { adapter_id: 'internal-issc-register', activation_evidence: { tamper_probe: 'rejected' } }]]);
  const r = run({ selections: [sel], mounted, requiredCapabilities: new Set(['shariah_governance']) });
  assert.deepEqual(r.findings, []);
  assert.equal(r.selected, 1);
});

test('shariah_governance stays SILENT for an adopter with no Islamic product in flight', () => {
  const r = run({ selections: [], requiredCapabilities: new Set(['sca']) });
  assert.equal(r.findings.length, 1, 'only the compiled capability is demanded');
  assert.ok(!/shariah/i.test(r.findings[0]), 'a conventional plan must not be failed by a Shari’ah role');
});

test('PS-R06: an AI-serving plan requiring runtime_guardrails with no provider selected', () => {
  const r = run({ selections: [], requiredCapabilities: new Set(['runtime_guardrails']) });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R06/);
  assert.match(r.findings[0], /"runtime_guardrails"/);
  assert.match(r.findings[0], /"runtime-guardrails"/);
});

test('runtime_guardrails is satisfied by a recorded, mounted choice', () => {
  const sel = { role: 'runtime-guardrails', provider: 'gateway-policy-enforcement', adapter_id: 'gateway-policy-enforcement' };
  const mounted = new Map([['gateway-policy-enforcement', { adapter_id: 'gateway-policy-enforcement', activation_evidence: { negative_probe: 'denied-and-logged' } }]]);
  const r = run({ selections: [sel], mounted, requiredCapabilities: new Set(['runtime_guardrails']) });
  assert.deepEqual(r.findings, []);
  assert.equal(r.selected, 1);
});

test('runtime_guardrails stays SILENT until a plan requires it — choosing is not owed by default', () => {
  assert.deepEqual(run({ selections: [] }).findings, []);
});

test('PS-R07: a half-completed selection is not a made decision', () => {
  const r = run({ selections: [{ role: 'sca', provider: 'ADOPT: a provider', adapter_id: 'snyk-sca' }] });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R07/);
});

test('the shipped template reads as NO selection — it must not fail an institution that has not chosen', () => {
  const template = { role: 'ADOPT: a role from adapters/providers/roles.json (e.g. sca)', provider: 'ADOPT: a provider', adapter_id: 'ADOPT: the adapter_id' };
  const r = run({ selections: [template] });
  assert.deepEqual(r.findings, []);
  assert.equal(r.selected, 0);
});

test('…but the same untouched template FAILS the moment a plan requires the capability', () => {
  const template = { role: 'ADOPT: a role', provider: 'ADOPT: a provider', adapter_id: 'ADOPT: the adapter_id' };
  const r = run({ selections: [template], requiredCapabilities: new Set(['sca']) });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /PS-R06/);
});

test('isPlaceholder recognises the ADOPT forms the templates actually use', () => {
  assert.ok(isPlaceholder('ADOPT: a role'));
  assert.ok(isPlaceholder('ADOPT-run-your-probe'));
  assert.ok(!isPlaceholder('snyk'));
  assert.ok(!isPlaceholder('adopted-scanner'), 'a real value that merely starts with "adopt" is not a placeholder');
});

/* ---- The shipped catalog is real, and every role in it is actually offered a choice ---- */

test('the bundled role catalog and provider files agree with each other', () => {
  const rolesPath = `${HARNESS}/adapters/providers/roles.json`;
  if (!existsSync(rolesPath)) return; // adopted layouts without the bundle catalog: nothing to check
  const roles = JSON.parse(readFileSync(rolesPath, 'utf8')).roles;
  const catalog = loadCatalog(HARNESS);
  assert.ok(roles.length > 0, 'the catalog defines no roles');
  for (const role of roles) {
    for (const key of ['role', 'control', 'capability', 'purpose']) {
      assert.ok(role[key], `role ${role.role}: missing ${key}`);
    }
    const providers = [...catalog.keys()].filter((k) => k.startsWith(`${role.role}/`));
    // The whole point of the restructure: a role with one provider is the old directory again.
    assert.ok(providers.length >= 2, `role ${role.role} offers ${providers.length} provider(s) — a role with fewer than two is not a choice`);
    for (const key of providers) {
      assert.equal(catalog.get(key).satisfies_control, role.control, `${key} fills the wrong control`);
    }
  }
});

test('every bundled provider carries the adapter fields the contract requires', () => {
  const catalog = loadCatalog(HARNESS);
  if (catalog.size === 0) return;
  for (const [key, p] of catalog) {
    for (const field of ['adapter_id', 'system', 'satisfies_control', 'capability', 'role', 'provider']) {
      assert.ok(p[field], `${key}: missing ${field}`);
    }
    assert.ok(p.evidence?.kind, `${key}: no evidence.kind`);
    assert.ok(Array.isArray(p.evidence?.envelope_fields) && p.evidence.envelope_fields.length, `${key}: no envelope_fields`);
  }
});

test('bundled provider adapter_ids are unique across the whole catalog', () => {
  const catalog = loadCatalog(HARNESS);
  const ids = [...catalog.values()].map((p) => p.adapter_id);
  assert.equal(new Set(ids).size, ids.length, 'two providers share an adapter_id — mounting both would collide');
});

test('every role capability is actually declared by a shipped profile — PS-R06 must be able to fire', () => {
  const rolesPath = `${HARNESS}/adapters/providers/roles.json`;
  if (!existsSync(rolesPath)) return;
  const roles = JSON.parse(readFileSync(rolesPath, 'utf8')).roles;
  // Scan every shipped profile, not just the base: a residency-driven role may legitimately be
  // required by a jurisdiction profile instead. What must never happen is a role whose capability
  // NO profile requires — PS-R06 would then be armed and unable to fire, and the whole mechanism
  // would be decorative: a catalog nobody is ever obliged to choose from.
  const declared = new Set();
  for (const dir of ['profiles', 'profiles/jurisdictions', 'profiles/products', 'profiles/institutions']) {
    const d = `${HARNESS}/${dir}`;
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d).filter((n) => n.endsWith('.json'))) {
      const profile = JSON.parse(readFileSync(`${d}/${name}`, 'utf8'));
      for (const tier of Object.values(profile.requirements || {})) {
        for (const cap of Object.keys(tier.capabilities || {})) declared.add(cap);
      }
      // Conditionals count too. A capability required only when a flag fires is still a capability
      // a shipped profile requires — and it is the RIGHT home for a control whose trigger is a
      // property of the change rather than its risk tier. Scanning only tiers made that placement
      // look like an unreferenced role and pushed the capability up to a tier where it over-fires.
      for (const cond of profile.conditional || []) {
        for (const cap of Object.keys(cond.adds?.capabilities || {})) declared.add(cap);
      }
    }
  }
  for (const role of roles) {
    assert.ok(declared.has(role.capability),
      `role ${role.role} names capability ${JSON.stringify(role.capability)}, which no shipped profile requires — the role can never become mandatory`);
  }
});
