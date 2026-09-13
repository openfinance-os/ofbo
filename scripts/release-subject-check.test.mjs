// Tests for the release-subject gate (rc.11 · WS1). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './release-subject-check.mjs';

const DIGEST = 'sha256:' + 'e'.repeat(64);
const valid = () => ({
  schema_version: '1.0',
  source: { repository: 'org/repo', commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', tree_digest: 'sha256:' + 'a'.repeat(64) },
  artifact: { name: 'service-image', uri: `registry.example/service@${DIGEST}`, digest: DIGEST },
  build: { builder_identity: 'github-actions://org/repo/workflow/release', workflow_ref: 'org/repo/.github/workflows/release.yml@refs/tags/v1', run_id: '123', built_at: '2026-07-20T09:10:00Z' },
});

test('a coherent immutable subject passes', () => {
  assert.deepEqual(evaluate(valid()), []);
});

test('a symbolic source commit fails — no binding subject (F2)', () => {
  const s = valid(); s.source.commit = 'release-v-demo';
  assert.ok(evaluate(s).some((f) => /not a 40-hex commit sha/.test(f)));
});

test('a tag-pinned (non-digest) artifact uri fails — the subject must be immutable', () => {
  const s = valid(); s.artifact.uri = 'registry.example/service:latest';
  assert.ok(evaluate(s).some((f) => /not pinned to artifact.digest/.test(f)));
});

test('a uri pinned to a DIFFERENT digest than declared fails', () => {
  const s = valid(); s.artifact.uri = `registry.example/service@sha256:${'b'.repeat(64)}`;
  assert.ok(evaluate(s).some((f) => /not pinned to artifact.digest/.test(f)));
});

test('a non-sha256 artifact digest fails', () => {
  const s = valid(); s.artifact.digest = 'latest';
  assert.ok(evaluate(s).some((f) => /is not a sha256/.test(f)));
});

test('a null artifact is allowed for a non-artifact repo when nothing is in production', () => {
  const s = valid(); s.artifact = null;
  assert.deepEqual(evaluate(s, { anyInProduction: false }), []);
});

test('a null artifact FAILS once a change is in production — a deployed thing has a digest', () => {
  const s = valid(); s.artifact = null;
  assert.ok(evaluate(s, { anyInProduction: true }).some((f) => /is in production/.test(f)));
});

test('a missing builder identity fails — provenance needs the builder', () => {
  const s = valid(); delete s.build.builder_identity;
  assert.ok(evaluate(s).some((f) => /build.builder_identity is missing/.test(f)));
});

test('a non-ISO build time fails', () => {
  const s = valid(); s.build.built_at = 'yesterday';
  assert.ok(evaluate(s).some((f) => /not an ISO-8601/.test(f)));
});

test('a missing tree digest fails', () => {
  const s = valid(); delete s.source.tree_digest;
  assert.ok(evaluate(s).some((f) => /tree_digest/.test(f)));
});
