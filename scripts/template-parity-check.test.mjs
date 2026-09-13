// Tests for the template-parity gate (Factory Floor WS3 · D3.1). Node runner: `node --test`.
//
// This gate shipped WITHOUT a regression suite and was catalogued honestly for it — the one gate
// in the floor group whose entry carried a note saying so instead of a `test_ref`. These tests
// retire that gap.
//
// The property under test is the promise the floor makes to a non-technical author: fill in the
// guided form and the result passes the gates. That breaks SILENTLY the moment the form and the
// git template drift — a section renamed, a field added — and nobody notices until an approval is
// refused for a field nobody was asked to fill. So the failure mode to pin is not "the gate
// errors" but "the gate stays green while the pair has parted company".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOOR_DIR, run } from './template-parity-check.mjs';
import { generate } from '../core/floor-templates.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR_PRESENT = existsSync(join(HARNESS, FLOOR_DIR));

/** A throwaway copy of the bundle's floor + template trees, so mutations cannot touch the repo. */
function sandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    for (const sub of ['floor/templates', 'discovery/templates', 'delivery/templates']) {
      const src = join(HARNESS, sub);
      if (existsSync(src)) { mkdirSync(join(dir, sub), { recursive: true }); cpSync(src, join(dir, sub), { recursive: true }); }
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const anyDefinition = (dir) => {
  const d = join(dir, FLOOR_DIR);
  const f = readdirSync(d).find((n) => n.endsWith('.json'));
  return join(d, f);
};

test('the shipped pairs are in step', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  const { findings, count } = run(HARNESS);
  assert.deepEqual(findings, []);
  assert.ok(count > 0, 'a green run over zero pairs is not evidence');
});

test('NEGATIVE — a renamed section in the git template is caught', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  // The exact drift the gate exists for: the markdown moves, the form keeps asking last month's
  // shape. Caught by regenerating, not by a hand-kept list.
  sandbox((dir) => {
    const def = JSON.parse(readFileSync(anyDefinition(dir), 'utf8'));
    const src = join(dir, def.source);
    const md = readFileSync(src, 'utf8');
    const firstHeading = md.match(/^## .+$/m);
    assert.ok(firstHeading, 'fixture template has no section heading to rename');
    writeFileSync(src, md.replace(firstHeading[0], `${firstHeading[0]} RENAMED`));
    const { findings } = run(dir);
    assert.ok(findings.length > 0, 'a renamed section left the gate green');
  });
});

test('NEGATIVE — a stale source_digest is caught even when the sections still match', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  // The subtle one the header calls out: an edit to the markdown that was never carried across.
  // Section lists can still agree while the definition is pinned to content that has moved.
  sandbox((dir) => {
    const p = anyDefinition(dir);
    const def = JSON.parse(readFileSync(p, 'utf8'));
    def.source_digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    writeFileSync(p, `${JSON.stringify(def, null, 2)}\n`);
    const { findings } = run(dir);
    assert.ok(findings.length > 0, 'a stale digest left the gate green');
  });
});

test('NEGATIVE — a hand-edited form (added property) is caught', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  // Definitions are GENERATED; a human editing one directly is drift by another route.
  sandbox((dir) => {
    const p = anyDefinition(dir);
    const def = JSON.parse(readFileSync(p, 'utf8'));
    def.properties = [...(def.properties || []), 'invented-by-hand'];
    writeFileSync(p, `${JSON.stringify(def, null, 2)}\n`);
    const { findings } = run(dir);
    assert.ok(findings.length > 0, 'a hand-edited definition left the gate green');
  });
});

test('--fix regenerates a drifted definition back into step', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  sandbox((dir) => {
    const p = anyDefinition(dir);
    const def = JSON.parse(readFileSync(p, 'utf8'));
    def.source_digest = 'sha256:deadbeef';
    writeFileSync(p, `${JSON.stringify(def, null, 2)}\n`);
    assert.ok(run(dir).findings.length > 0);
    const fixed = run(dir, { fix: true });
    assert.ok(fixed.fixed > 0, '--fix reported nothing rewritten');
    assert.deepEqual(run(dir).findings, [], 'the tree is still drifted after --fix');
  });
});

test('a definition naming a source that does not exist is a finding, not a crash', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  sandbox((dir) => {
    const p = anyDefinition(dir);
    const def = JSON.parse(readFileSync(p, 'utf8'));
    def.source = 'discovery/templates/never-written.md';
    writeFileSync(p, `${JSON.stringify(def, null, 2)}\n`);
    assert.doesNotThrow(() => {
      const { findings } = run(dir);
      assert.ok(findings.length > 0, 'a missing source left the gate green');
    });
  });
});

test('a layout with no floor is a clean no-op, not a false green over nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-empty-'));
  try {
    const { findings, count } = run(dir);
    assert.deepEqual(findings, []);
    assert.equal(count, 0, 'count must report zero so a vacuous pass is legible');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('generate() is deterministic — the same source yields the same definition', { skip: !FLOOR_PRESENT && 'floor not installed at this tier' }, () => {
  // Parity is only meaningful if regeneration is stable; a nondeterministic generator would make
  // every run a coin flip and the gate worse than useless.
  const def = JSON.parse(readFileSync(anyDefinition(HARNESS), 'utf8'));
  const abs = join(HARNESS, def.source);
  const a = generate(abs, { source: def.source, writeClass: def.write_class });
  const b = generate(abs, { source: def.source, writeClass: def.write_class });
  assert.deepEqual(a, b);
});
