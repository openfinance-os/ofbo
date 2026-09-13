// Tests for the route-policy and record-type compilers (2.1.0, plan row 2.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXED_STAGES, POLICY_PATH, compilePolicy, main as policyMain, stablePolicy, verify as verifyPolicy } from './record-policy-compile.mjs';
import { compileTypes, main as typesMain, verify as verifyTypes } from './record-types-compile.mjs';
import { renderPolicy, renderTypes } from '../core/providers/kosli.mjs';

const CATALOG = { controls: [
  { control_id: 'A', mechanism_ref: 'scripts/a-check.mjs', lane: 'pr', gate_family: 'Q' },
  { control_id: 'B', mechanism_ref: 'scripts/a-check.mjs', lane: 'pr', gate_family: 'Q' },
  { control_id: 'C', mechanism_ref: 'scripts/c-check.mjs', lane: 'release', gate_family: 'R' },
  { control_id: 'D', mechanism_ref: 'scripts/d-check.mjs', lane: 'deploy' },
  { control_id: 'E', mechanism_ref: 'scripts/e-check.mjs', lane: 'pr', execute: false },
  { control_id: 'F', mechanism_ref: 'docs/policy.md' },
] };
const TEXT = JSON.stringify(CATALOG);

test('the policy requires the fixed stages plus one record per runnable pr/release mechanism, deduped, and carries the catalog digest', () => {
  const p = compilePolicy(CATALOG, TEXT);
  assert.deepEqual(p.required.map((r) => r.name), [...FIXED_STAGES, 'gate.scripts-a-check', 'gate.scripts-c-check']);
  assert.deepEqual(p.required.find((r) => r.name === 'gate.scripts-a-check').controls, ['A', 'B']);
  assert.equal(p.catalog_sha256.length, 64);
  assert.equal(stablePolicy(p), stablePolicy(compilePolicy(CATALOG, TEXT)), 'byte-stable across compiles');
});

test('types: the generic gate type, one per gate family, and the two fixed stages, each with a schema and a pass condition as data', () => {
  const t = compileTypes(CATALOG, TEXT);
  assert.deepEqual(t.types.map((x) => x.name), ['loom-gate', 'loom-gate-q', 'loom-gate-r', 'loom-risk-class', 'loom-seal-anchor']);
  assert.deepEqual(t.types[1].controls, ['A', 'B']);
  assert.deepEqual(t.types[0].pass, { field: 'payload.result', in: ['pass', 'pass-cached'] });
  assert.equal(t.types[0].schema.properties.result.enum.length, 5);
});

test('--verify: inert without a stored policy; stale when the catalog moved; hand-edited when the digest matches but the body does not', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rpc-'));
  try {
    mkdirSync(join(cwd, 'docs/governance'), { recursive: true });
    writeFileSync(join(cwd, 'docs/governance/control-catalog.json'), TEXT);
    assert.equal(verifyPolicy(cwd).inert, true);
    assert.equal(verifyTypes(cwd).inert, true);
    return policyMain([], cwd).then(async (code) => {
      assert.equal(code, 0);
      assert.equal((await typesMain([], cwd)), 0);
      assert.deepEqual(verifyPolicy(cwd).findings, []); assert.deepEqual(verifyTypes(cwd).findings, []);
      const p = JSON.parse(readFileSync(join(cwd, POLICY_PATH), 'utf8')); p.required.pop();
      writeFileSync(join(cwd, POLICY_PATH), JSON.stringify(p));
      assert.ok(verifyPolicy(cwd).findings.some((f) => /edited by hand/.test(f)));
      writeFileSync(join(cwd, 'docs/governance/control-catalog.json'), JSON.stringify({ controls: [...CATALOG.controls, { control_id: 'Z', mechanism_ref: 'scripts/z.mjs', lane: 'pr' }] }));
      assert.ok(verifyPolicy(cwd).findings.some((f) => /catalog is now/.test(f)));
      assert.ok(verifyTypes(cwd).findings.some((f) => /catalog is now/.test(f)));
      assert.equal(await policyMain(['--verify'], cwd), 1);
      assert.equal(await policyMain([], cwd), 0);
      assert.equal(await policyMain(['--verify'], cwd), 0);
      assert.equal(await typesMain([], cwd), 0);
      assert.equal(await typesMain(['--verify'], cwd), 0);
    });
  } finally { setTimeout(() => rmSync(cwd, { recursive: true, force: true }), 0); }
});

test('the Kosli renderings name every required record in Rego and one create-or-update command per type, both stamped with the catalog digest', () => {
  const p = compilePolicy(CATALOG, TEXT); const t = compileTypes(CATALOG, TEXT);
  const rego = renderPolicy(p)['docs/governance/record/kosli-policy.rego'];
  for (const r of p.required) assert.ok(rego.includes(JSON.stringify(r.name).slice(1, -1)), r.name);
  assert.ok(rego.includes(p.catalog_sha256) && /package loom\.route/.test(rego) && /default allow := false/.test(rego));
  const files = renderTypes(t);
  const sh = files['docs/governance/record/kosli-types.sh'];
  assert.equal((sh.match(/kosli create attestation-type/g) || []).length, t.types.length);
  assert.ok(sh.includes(t.catalog_sha256));
  assert.ok(files['docs/governance/record/types/loom-gate.schema.json'].includes('"pass-cached"'));
  assert.ok(sh.includes(`--jq '.payload.result as $v | ["pass","pass-cached"] | index($v) != null'`));
});
