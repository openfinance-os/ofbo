// Tests for the BrainKit estate-registry gate (rc.15 · WS7). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, summarise } from './brainkit-registry-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const D = (n) => 'sha256:' + String(n).repeat(64).slice(0, 64);
const registry = (over = {}) => ({
  releases: [
    { brainkit_id: 'bk', version: '1.0.0', package_digest: D(1), status: 'active', released_at: '2026-06-01T00:00:00Z' },
    { brainkit_id: 'bk', version: '0.9.0', package_digest: D(9), status: 'revoked', revocation_reason: 'bad source', released_at: '2026-04-01T00:00:00Z' },
  ],
  adoption_inventory: [
    { repository: 'org/a', brainkit_id: 'bk', version: '1.0.0', package_digest: D(1), acknowledged_at: '2026-06-02T00:00:00Z' },
  ],
  ...over,
});

test('a consistent registry with no repo on a revoked release passes', () => {
  assert.deepEqual(evaluate(registry()), []);
});

test('the ESTATE-WITHDRAWAL invariant — a repo pinning a REVOKED release fails', () => {
  const r = registry({ adoption_inventory: [{ repository: 'org/a', brainkit_id: 'bk', version: '0.9.0', package_digest: D(9), acknowledged_at: '2026-04-02T00:00:00Z' }] });
  assert.ok(evaluate(r).some((f) => /pins a REVOKED release/.test(f)));
});

test('a repo pinning an unregistered version fails', () => {
  const r = registry({ adoption_inventory: [{ repository: 'org/a', brainkit_id: 'bk', version: '2.0.0', package_digest: D(2), acknowledged_at: '2026-06-02T00:00:00Z' }] });
  assert.ok(evaluate(r).some((f) => /not in the registry/.test(f)));
});

test('an adoption with no acknowledgement receipt fails', () => {
  const r = registry(); delete r.adoption_inventory[0].acknowledged_at;
  assert.ok(evaluate(r).some((f) => /no acknowledgement receipt/.test(f)));
});

test('a mismatched pinned digest fails', () => {
  const r = registry(); r.adoption_inventory[0].package_digest = D(5);
  assert.ok(evaluate(r).some((f) => /does not match the registered release digest/.test(f)));
});

test('a non-semver version fails', () => {
  const r = registry(); r.releases[0].version = '1.x';
  assert.ok(evaluate(r).some((f) => /is not semver/.test(f)));
});

test('a revoked release with no reason fails', () => {
  const r = registry(); delete r.releases[1].revocation_reason;
  assert.ok(evaluate(r).some((f) => /records no revocation_reason/.test(f)));
});

test('summarise answers "which repositories use it" per release', () => {
  const s = summarise(registry());
  const active = s.find((x) => x.release === 'bk@1.0.0');
  assert.deepEqual(active.repositories, ['org/a']);
});

// The Meridian example is bundle-only (not installed into an adopted repo) — skip cleanly there.
const EXAMPLE = resolve(HARNESS, 'brainkit-example/brainkit-registry.json');
test('the shipped Meridian estate-registry example is consistent', { skip: !existsSync(EXAMPLE) }, () => {
  assert.deepEqual(evaluate(JSON.parse(readFileSync(EXAMPLE, 'utf8'))), []);
});
