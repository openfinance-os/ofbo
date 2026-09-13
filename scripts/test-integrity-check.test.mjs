// Tests for the Q1b test-integrity gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, TEST_FILE } from './test-integrity-check.mjs';

const M = (o) => new Map(Object.entries(o));
const T = 'src/thing.test.mjs';

test('unchanged tests pass', () => {
  const files = M({ [T]: "test('a', () => { assert.equal(1, 1); assert.ok(true); });" });
  assert.deepEqual(evaluate(files, files), []);
});

test('adding tests and assertions passes', () => {
  const base = M({ [T]: 'assert.equal(1, 1);' });
  const head = M({ [T]: 'assert.equal(1, 1); assert.ok(x); expect(y).toBe(2);', 'src/new.test.mjs': 'assert.ok(z);' });
  assert.deepEqual(evaluate(base, head), []);
});

test('a deleted test file is a finding', () => {
  const findings = evaluate(M({ [T]: 'assert.ok(1);' }), M({}));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /deleted/);
});

test('net assertion loss is a finding', () => {
  const base = M({ [T]: 'assert.equal(a, b); assert.ok(c); expect(d).toBe(e);' });
  const head = M({ [T]: 'assert.equal(a, b);' });
  const findings = evaluate(base, head);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /net assertion loss \(-2\)/);
});

test('an added .skip / .only marker is a finding', () => {
  const base = M({ [T]: "test('a', () => assert.ok(1));" });
  const head = M({ [T]: `test.${'skip'}('a', () => assert.ok(1));` });
  const findings = evaluate(base, head);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /marker/);
});

test('a newly commented-out assertion is a finding, even when counts hide it', () => {
  const base = M({ [T]: 'assert.ok(a);\nassert.ok(b);' });
  const head = M({ [T]: 'assert.ok(a);\n// assert.ok(b);\nassert.ok(a);' }); // net count unchanged
  const findings = evaluate(base, head);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /commented out/);
});

test('non-test files are outside the surface; test-file shapes are recognised', () => {
  assert.equal(TEST_FILE.test('src/app.mjs'), false);
  assert.equal(TEST_FILE.test('src/app.test.mjs'), true);
  assert.equal(TEST_FILE.test('pkg/foo_spec.js'), true);
  assert.equal(TEST_FILE.test('tests/integration.py'), true);
});

// ── 2.1.0 — the evasions of the per-file count (plan row 1.5) ─────────────────────────────────
test('the node:test / vitest options object and the decorators count as weakeners', () => {
  const base = M({ [T]: "test('a', () => assert.ok(x));" });
  for (const head of ["test('a', { skip: true }, () => assert.ok(x));", "it['skip']('a', () => assert.ok(x));", "xtest('a', () => assert.ok(x));", "fit('a', () => assert.ok(x));"]) {
    const f = evaluate(base, M({ [T]: head }));
    assert.ok(f.some((m) => /marker\(s\) added/.test(m)), `not caught: ${head}`);
  }
  const py = 'tests/test_api.py';
  const f = evaluate(M({ [py]: 'def test_a():\n    assert x' }), M({ [py]: '@pytest.mark.skip\ndef test_a():\n    assert x' }));
  assert.ok(f.some((m) => /marker/.test(m)));
});

test('a tautology does not offset a removed assertion, and adding one is itself a finding', () => {
  const base = M({ [T]: "test('a', () => { assert.equal(total, 3); assert.ok(list.length); });" });
  const head = M({ [T]: "test('a', () => { assert.ok(true); assert.ok(list.length); });" });
  const f = evaluate(base, head);
  assert.ok(f.some((m) => /net assertion loss \(-1\)/.test(m)), f.join('; '));
  assert.ok(f.some((m) => /tautological/.test(m)), f.join('; '));
  const jest = evaluate(M({ [T]: 'expect(a).toBe(1);' }), M({ [T]: 'expect(true).toBe(true);' }));
  assert.ok(jest.some((m) => /net assertion loss/.test(m)) && jest.some((m) => /tautological/.test(m)));
});

test('a block-commented expectation is a commented-out assertion', () => {
  const base = M({ [T]: 'expect(a).toBe(1);\nexpect(b).toBe(2);' });
  const head = M({ [T]: 'expect(a).toBe(1);\n/* later\n  expect(b).toBe(2);\n*/\nexpect(a).toBe(1);' });
  const f = evaluate(base, head);
  assert.ok(f.some((m) => /commented out/.test(m)), f.join('; '));
});

test('an emptied test file is a finding even though it still exists', () => {
  const base = M({ [T]: "test('a', () => assert.ok(x));\ntest('b', () => assert.ok(y));" });
  const head = M({ [T]: '// nothing here yet\n' });
  const f = evaluate(base, head);
  assert.ok(f.some((m) => /emptied: it had 2 case\(s\)/.test(m)), f.join('; '));
});

test('a new test file made of tautologies is fake coverage, and the surface-wide total sees a spread loss', () => {
  const fake = evaluate(M({ 'a.test.mjs': 'assert.ok(x);' }), M({ 'a.test.mjs': 'assert.ok(x);', 'c.test.mjs': 'assert.ok(true); expect(true).toBe(true);' }));
  assert.ok(fake.some((m) => /new test file carries 2 tautological/.test(m)), fake.join('; '));
  // per-file counts stay flat (one file gains what another lost) but a third file quietly loses one
  const base = M({ 'a.test.mjs': 'assert.ok(1);', 'b.test.mjs': 'assert.ok(2); assert.ok(3);' });
  const head = M({ 'a.test.mjs': 'assert.ok(1); assert.ok(2);', 'b.test.mjs': 'assert.ok(3);' });
  const f = evaluate(base, head);
  assert.ok(f.some((m) => /net assertion loss \(-1\)/.test(m)), 'the per-file rule still names b');
  const surface = evaluate(M({ 'a.test.mjs': 'assert.ok(1); assert.ok(2);' }), M({ 'a.test.mjs': 'assert.ok(1);', 'z.test.mjs': 'assert.ok(true);' }));
  assert.ok(surface.some((m) => /net assertion loss/.test(m)));
});
