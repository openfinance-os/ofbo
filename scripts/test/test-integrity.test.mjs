import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const gate = resolve('scripts/test-integrity.mjs');
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'ofbo-test-integrity-'));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  git(cwd, 'config', 'user.name', 'Fixture');
  copyFileSync(gate, join(cwd, 'test-integrity.mjs'));
  writeFileSync(join(cwd, 'feature.ts'), 'export const value = 1;\n');
  writeFileSync(join(cwd, 'feature.test.ts'), "test('value', () => expect(1).toBe(1));\n");
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'base');
  return cwd;
}

test('OFBO Q1b rejects a newly skipped test on an implementation change', () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, 'feature.ts'), 'export const value = 2;\n');
    writeFileSync(join(cwd, 'feature.test.ts'), `test.${'skip'}('value', () => expect(2).toBe(2));\n`);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-qm', 'weaken test');
    const result = spawnSync(process.execPath, ['test-integrity.mjs'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'HEAD~1', GITHUB_HEAD_REF: 'feature/BACKOFFICE-999-check' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /introduces a test-disabling marker/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('OFBO Q1b accepts a strengthened test alongside an implementation change', () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, 'feature.ts'), 'export const value = 2;\n');
    writeFileSync(join(cwd, 'feature.test.ts'), "test('value', () => { expect(2).toBe(2); expect(2).toBeGreaterThan(1); });\n");
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-qm', 'strengthen test');
    const result = spawnSync(process.execPath, ['test-integrity.mjs'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'HEAD~1', GITHUB_HEAD_REF: 'feature/BACKOFFICE-999-check' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no weakening detected/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
