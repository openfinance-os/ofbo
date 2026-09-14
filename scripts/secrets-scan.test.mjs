// Tests for the history-aware secrets gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, ALLOW_MARKER } from './secrets-scan.mjs';

test('an AWS access key id is found', () => {
  const findings = scanText('aws_key = "AKIAIOSFODNN7EXAMPLE"', 'config.py'); // loom-allow-secret (fixture)
  assert.equal(findings.length, 1);
  assert.match(findings[0], /config\.py:1 — aws-access-key-id/);
});

test('a private key block is found', () => {
  const findings = scanText('-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'id_rsa'); // loom-allow-secret (fixture)
  assert.equal(findings.length, 1);
  assert.match(findings[0], /private-key-block/);
});

test('a github token is found', () => {
  const findings = scanText('token: ghp_0123456789abcdefghijklmnopqrstuvwxyzAB', 'ci.yml'); // loom-allow-secret (fixture)
  assert.equal(findings.length, 1);
  assert.match(findings[0], /github-token/);
});

test('an assigned credential is found', () => {
  const findings = scanText('const password = "s3cr3tPassw0rdValue42";', 'db.mjs'); // loom-allow-secret (fixture)
  assert.equal(findings.length, 1);
  assert.match(findings[0], /assigned-credential/);
});

test('placeholder credentials are not findings', () => {
  assert.deepEqual(scanText('api_key = "your-api-key-goes-here-x"', 'readme.md'), []);
  assert.deepEqual(scanText('password = "<fill-me-in-at-deploy-time>"', 'readme.md'), []);
});

test('ordinary code is clean', () => {
  const src = 'const total = items.reduce((a, b) => a + b.amount, 0);\nexport default total;';
  assert.deepEqual(scanText(src, 'sum.mjs'), []);
});

test(`the ${ALLOW_MARKER} marker exempts a line, visibly`, () => {
  const findings = scanText(`fixture = "AKIAIOSFODNN7EXAMPLE" # ${ALLOW_MARKER}: synthetic fixture`, 'test.py'); // loom-allow-secret (fixture)
  assert.deepEqual(findings, []);
});
