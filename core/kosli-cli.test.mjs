// Tests for the Kosli CLI seam and its record-and-replay double (2.1.0, phase 2 prep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binary, runKosli } from './kosli-cli.mjs';
import { calls, createFakeKosli, reset, respond } from './kosli-fake.mjs';

const withFake = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'kosli-fake-'));
  try { const { bin } = createFakeKosli(dir); return fn({ dir, env: { ...process.env, KOSLI_BIN: bin } }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

test('the binary is KOSLI_BIN when set, else `kosli` on PATH', () => {
  assert.equal(binary({}), 'kosli');
  assert.equal(binary({ KOSLI_BIN: ' /opt/kosli ' }), '/opt/kosli');
  assert.equal(binary({ KOSLI_BIN: '' }), 'kosli');
});

test('every invocation is recorded with its argv, stdin and cwd; the default answer is `{}` exit 0', () => withFake(({ dir, env }) => {
  const r = runKosli(['attest', 'generic', '--name', 'gate'], { env, stdin: '{"envelope":1}' });
  assert.equal(r.ok, true); assert.equal(r.status, 0); assert.deepEqual(r.json, {});
  const log = calls(dir);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].argv, ['attest', 'generic', '--name', 'gate']);
  assert.equal(log[0].stdin, '{"envelope":1}');
  assert.ok(typeof log[0].cwd === 'string' && log[0].cwd.length > 0);
  reset(dir);
  assert.deepEqual(calls(dir), []);
}));

test('a response rule matches by argv prefix and can fail the call; the failure is returned, not thrown', () => withFake(({ dir, env }) => {
  respond(dir, ['get', 'trail'], { stdout: { name: 'CHG-2026-0042', attestations: [] } });
  respond(dir, ['attest'], { stderr: 'Error: unauthorized', exit: 1 });
  const got = runKosli(['get', 'trail', 'CHG-2026-0042', '--output', 'json'], { env });
  assert.equal(got.ok, true); assert.equal(got.json.name, 'CHG-2026-0042');
  const bad = runKosli(['attest', 'generic'], { env });
  assert.equal(bad.ok, false); assert.equal(bad.status, 1); assert.match(bad.stderr, /unauthorized/); assert.equal(bad.json, null);
  assert.equal(calls(dir).length, 2, 'both calls reached the binary and were recorded');
}));

test('a binary that cannot be started is a finding-shaped result — never an exception', () => {
  const r = runKosli(['version'], { env: { ...process.env, KOSLI_BIN: '/definitely/not/here/kosli' } });
  assert.equal(r.ok, false); assert.equal(r.status, null); assert.match(r.stderr, /not found — set KOSLI_BIN/);
});

test('nothing reaches the binary unless the caller asks — an empty log is the proof a rejected envelope never left', () => withFake(({ dir }) => {
  assert.deepEqual(calls(dir), []);
}));
