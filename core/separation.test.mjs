// Tests for the shared separation-of-parties rule (2.1.0). Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityKey, sameIdentity, separationFinding, requireSeparate } from './separation.mjs';

test('identityKey reads a string or any of the usual identity-bearing keys, case-folded and trimmed', () => {
  assert.equal(identityKey(' Sara-2L '), 'sara-2l');
  assert.equal(identityKey({ registry_id: 'svc-bridge' }), 'svc-bridge');
  assert.equal(identityKey({ id: 'Dev-Omar' }), 'dev-omar');
  assert.equal(identityKey({ observed_by: 'watcher-1' }), 'watcher-1');
  assert.equal(identityKey(''), null);
  assert.equal(identityKey(null), null);
  assert.equal(identityKey({ unrelated: 'x' }), null);
});

test('sameIdentity is true only when both sides resolve to one party; unknown is never the same', () => {
  assert.ok(sameIdentity('sara-2l', 'SARA-2L'));
  assert.ok(sameIdentity({ registry_id: 'svc-bridge' }, 'svc-bridge'));
  assert.ok(!sameIdentity('sara-2l', 'dev-omar'));
  assert.ok(!sameIdentity(null, null), 'two unknowns must not read as one party');
  assert.ok(!sameIdentity('', ''));
  assert.ok(!sameIdentity(undefined, 'x'));
});

test('separationFinding keeps the caller\'s rule id and names both roles', () => {
  const f = separationFinding({ code: 'PR2', what: 'review r-7', actor: 'agent-a', roleA: 'reviewer', roleB: 'author' });
  assert.match(f, /^PR2: review r-7: the reviewer and the author are the same identity \("agent-a"\)/);
  assert.match(f, /must be separable/);
});

test('requireSeparate resolves through an injected registry lookup and reports a collapse', () => {
  const registry = { 'alias-sara': { id: 'sara-2l' }, 'sara-2l': { id: 'sara-2l' }, 'omar': { id: 'dev-omar' } };
  const resolve = (k) => registry[k] || null;
  assert.deepEqual(requireSeparate({ code: 'X', what: 'w', a: 'sara-2l', roleA: 'a', b: 'omar', roleB: 'b', resolve }), []);
  const f = requireSeparate({ code: 'X', what: 'w', a: 'alias-sara', roleA: 'approver', b: 'sara-2l', roleB: 'transcriber', resolve });
  assert.equal(f.length, 1);
  assert.match(f[0], /approver and the transcriber are the same identity/);
  // an unresolvable party is not compared — that is the identity gate's finding, not this one's
  assert.deepEqual(requireSeparate({ code: 'X', what: 'w', a: 'ghost', roleA: 'a', b: 'ghost', roleB: 'b', resolve }), [separationFinding({ code: 'X', what: 'w', actor: 'ghost', roleA: 'a', roleB: 'b' })], 'without a resolver hit the raw keys are compared');
});
