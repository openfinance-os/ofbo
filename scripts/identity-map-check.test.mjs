// Tests for the identity-map gate (Factory Floor P6). Node built-in runner: `node --test`.
//
// Two things this file exists to pin. First, that the gate TIGHTENS and never loosens: a
// repository that has not adopted the Factory Floor sees no change at all. Second, that the
// escape hatch which would make it pointless — "copied the template, never filled it in, gate is
// green, capability compiled" — is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_ID } from '../core/identity-map.mjs';
import { changesRequiringMap, evaluate, run } from './identity-map-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIND = (...c) => c.map((x) => `${HARNESS}/${x}`).find(existsSync) || null;

const REGISTRY = {
  groups: { builders: ['eng-sam'], 'second-line': ['risk-lena'] },
  identities: [
    { id: 'risk-lena', kind: 'human', roles: ['risk-second-line'], groups: ['second-line'] },
    { id: 'comp-imran', kind: 'human', roles: ['compliance'], groups: [] },
  ],
};
const ENTRY = {
  notion_person_id: 'p1', idp_subject: 'u:1', registry_id: 'comp-imran',
  roles_at_mapping: ['compliance'],
  verification: { method: 'assertion-derived', reference: 'enrol-1' },
  mapped_at: '2026-05-04T09:14:11Z', mapped_by: 'risk-lena', status: 'active',
};
const MAP = { schema: SCHEMA_ID, entries: [ENTRY] };
const RECON = { observed_at: '2026-07-24T00:00:00Z', observed_by: 'obs-platform' };
const NOW = Date.parse('2026-07-25T00:00:00Z');

test('no map and no compiled requirement is not a finding — the gate only tightens', () => {
  assert.deepEqual(evaluate(null, REGISTRY, { now: NOW }), []);
});

// The escape hatch, closed. Copying a template is not adopting a control, and a compiled
// requirement that finds nothing to resolve against must never read as satisfied.
test('a compiled requirement with no map, or an empty one, is a plan defect', () => {
  for (const m of [null, { schema: SCHEMA_ID, entries: [] }]) {
    const f = evaluate(m, REGISTRY, { now: NOW, required: ['CHG-1'] });
    assert.equal(f.length, 1);
    assert.match(f[0], /bound but not joined/);
  }
});

test('a copied-but-empty map is unadopted, not stale — no reconciliation is demanded', () => {
  assert.deepEqual(evaluate({ schema: SCHEMA_ID, entries: [] }, REGISTRY, { now: NOW }), []);
});

// …but the moment one entry exists, currency has to be proven.
test('one entry is enough to require a fresh reconciliation observation', () => {
  const f = evaluate(MAP, REGISTRY, { now: NOW });
  assert.ok(f.some((x) => /IM-R24/.test(x)), f.join('\n'));
  assert.deepEqual(evaluate(MAP, REGISTRY, { now: NOW, reconciliation: RECON }), []);
});

// --- the shipped templates ----------------------------------------------------------------------

test('the shipped map template is empty of entries and carries no forbidden field', () => {
  const path = FIND('governance/identity-map.template.json', 'docs/governance/identity-map.json');
  if (!path) return; // absent in this layout
  const t = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(t.schema, SCHEMA_ID);
  assert.deepEqual(t.entries, [], 'the template ships no mappings — a mapping is a human act');
  const text = JSON.stringify(t.entries);
  for (const f of ['email', 'display_name']) assert.ok(!text.includes(f), `${f} must not appear in entries`);
  // The gate must be quiet on a freshly adopted repo that has not populated it.
  assert.deepEqual(evaluate(t, REGISTRY, { now: NOW }), []);
});

// --- run() wiring -------------------------------------------------------------------------------

test('run() finds the map, the reconciliation and the changes that compile the capability', () => {
  const dir = mkdtempSync(join(tmpdir(), 'im-'));
  try {
    const gov = join(dir, 'docs/governance');
    const change = join(gov, 'changes/CHG-2026-0099');
    mkdirSync(change, { recursive: true });
    writeFileSync(join(gov, 'identities.json'), JSON.stringify(REGISTRY));
    writeFileSync(join(gov, 'identity-map.json'), JSON.stringify(MAP));
    writeFileSync(join(change, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-2026-0099', control_plan: 'control-plan.json' }));
    writeFileSync(join(change, 'control-plan.json'), JSON.stringify({
      change_id: 'CHG-2026-0099', required_gates: ['D', 'Q', 'PA1'],
      required_capabilities: { identity_map: { required: true } },
    }));

    assert.deepEqual(changesRequiringMap(dir), ['CHG-2026-0099']);
    // No observation on disk yet → the map's currency is unproven.
    const before = run(dir);
    assert.equal(before.present, true);
    assert.equal(before.active, 1);
    assert.equal(before.required, 1);
    assert.ok(before.findings.some((f) => /IM-R24/.test(f)), before.findings.join('\n'));

    // …lay one down, freshly stamped, and the gate goes quiet.
    writeFileSync(join(gov, 'identity-map-reconciliation.json'), JSON.stringify({
      observed_at: new Date(Date.now() - 3600_000).toISOString(), observed_by: 'obs-platform',
    }));
    assert.deepEqual(run(dir).findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a change that does not compile the capability does not summon the requirement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'im-'));
  try {
    const change = join(dir, 'docs/governance/changes/CHG-2026-0100');
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-2026-0100' }));
    writeFileSync(join(change, 'control-plan.json'), JSON.stringify({ change_id: 'CHG-2026-0100', required_gates: ['D', 'Q'] }));
    assert.deepEqual(changesRequiringMap(dir), []);
    assert.deepEqual(run(dir).findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
