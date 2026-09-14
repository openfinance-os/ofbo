// Tests for the data-lifecycle gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, validPeriod } from './data-lifecycle-check.mjs';

const PERSONAL = {
  category: 'customer_contact',
  classification: 'personal',
  lawful_basis: 'contract',
  retention: { period: 'P6Y' },
  erasure: { method: 'crypto-shred' },
  residency: 'onshore',
};
const one = (over) => ({ categories: [{ ...PERSONAL, ...over }] });

test('a complete personal-data category passes', () => {
  assert.deepEqual(evaluate(one()), []);
});

test('a non-personal category needs neither lawful basis nor erasure', () => {
  assert.deepEqual(evaluate({ categories: [{ category: 'metrics', classification: 'non-personal', retention: { period: 'P2Y' } }] }), []);
});

test('an unknown classification is rejected', () => {
  assert.match(evaluate(one({ classification: 'secret' }))[0], /classification must be/);
});

test('personal data without a lawful basis fails', () => {
  assert.ok(evaluate(one({ lawful_basis: '' })).some((x) => /needs a lawful_basis/.test(x)));
});

test('an unbounded retention fails', () => {
  assert.ok(evaluate(one({ retention: { period: 'indefinite' } })).some((x) => /retention must be a bounded period/.test(x)));
});

test('a justified indefinite hold passes', () => {
  assert.deepEqual(evaluate(one({ retention: { indefinite: true, justification: 'statutory AML record-keeping' } })), []);
});

test('an indefinite hold without justification fails', () => {
  assert.ok(evaluate(one({ retention: { indefinite: true } })).some((x) => /bounded period or a justified indefinite/.test(x)));
});

test('personal data with no erasure method fails (right-to-erasure)', () => {
  assert.ok(evaluate(one({ erasure: {} })).some((x) => /needs an erasure method/.test(x)));
});

test("erasure 'none' needs a legal-hold exemption", () => {
  assert.ok(evaluate(one({ erasure: { method: 'none' } })).some((x) => /needs a legal-hold exemption/.test(x)));
  assert.deepEqual(evaluate(one({ erasure: { method: 'none', exemption: 'AML statutory hold' } })), []);
});

test('personal data without residency fails', () => {
  assert.ok(evaluate(one({ residency: '' })).some((x) => /needs a declared residency/.test(x)));
});

test('an empty inventory is a finding', () => {
  assert.match(evaluate({ categories: [] })[0], /data inventory and its dispositions are undeclared/);
});

test('validPeriod accepts ISO-8601 and N-unit forms, rejects junk', () => {
  assert.ok(validPeriod('P7Y') && validPeriod('30 days') && validPeriod('6 months'));
  assert.ok(!validPeriod('forever') && !validPeriod('') && !validPeriod('someday'));
});
