// Tests for the BrainKit digest helpers (Loom 2.0-rc.8 WS7). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileDigest, packageDigestFrom, computeDigests, livePackageDigest, loadBrainkit } from './brainkit.mjs';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-core-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('packageDigestFrom is deterministic and order-independent', () => {
  const a = packageDigestFrom([{ section: 'x', digest: 'sha256:1' }, { section: 'y', digest: 'sha256:2' }]);
  const b = packageDigestFrom([{ section: 'y', digest: 'sha256:2' }, { section: 'x', digest: 'sha256:1' }]);
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('a change to any section digest changes the package digest', () => {
  const base = packageDigestFrom([{ section: 'x', digest: 'sha256:1' }]);
  const changed = packageDigestFrom([{ section: 'x', digest: 'sha256:2' }]);
  assert.notEqual(base, changed);
});

test('computeDigests reads real files; livePackageDigest folds them; a one-byte edit moves it', () => {
  withDir((dir) => {
    const bkDir = join(dir, 'institution', 'brainkit');
    mkdirSync(join(bkDir, 'identity'), { recursive: true });
    writeFileSync(join(bkDir, 'identity', 'design.md'), 'alpha');
    writeFileSync(join(bkDir, 'terminology.md'), 'beta');
    const manifest = {
      sections: [
        { section: 'identity', path: 'identity/design.md', digest: 'sha256:x' },
        { section: 'terminology', path: 'terminology.md', digest: 'sha256:y' },
      ],
    };
    const first = livePackageDigest(bkDir, manifest);
    const computed = computeDigests(bkDir, manifest);
    assert.equal(computed.sections.find((s) => s.section === 'identity').digest, fileDigest(join(bkDir, 'identity', 'design.md')));
    writeFileSync(join(bkDir, 'terminology.md'), 'betb'); // one byte
    assert.notEqual(livePackageDigest(bkDir, manifest), first);
  });
});

test('loadBrainkit returns null with no manifest and parses one when present', () => {
  withDir((dir) => {
    assert.equal(loadBrainkit(dir), null);
    const bkDir = join(dir, 'institution', 'brainkit');
    mkdirSync(bkDir, { recursive: true });
    writeFileSync(join(bkDir, 'manifest.json'), JSON.stringify({ brainkit_id: 'x' }));
    assert.equal(loadBrainkit(dir).manifest.brainkit_id, 'x');
  });
});
