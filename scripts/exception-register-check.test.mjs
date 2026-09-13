// Tests for the exception register. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCENTRATION_LIMIT, aggregate, effectiveLimit, evaluate, project } from './exception-register-check.mjs';

const NOW = Date.parse('2026-08-01T00:00:00Z');
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

const exemption = (over = {}) => ({
  control: 'Q2-SAST', owner: 'eng-omar', rationale: 'r', compensating_control: 'manual review',
  expires: inDays(90), approved_by: 'risk-lena', ...over,
});
const change = (id, exemptions, current_state = 'in-delivery') => ({ change_id: id, current_state, exemptions });
const cycle = (id, step, ra) => ({ cycle_id: id, steps: { [step]: { status: 'fail', risk_acceptance: ra } } });

test('both sources project into one register, with days-to-expiry and state', () => {
  const entries = project({
    changes: [change('CHG-1', [exemption()])],
    cycles: [cycle('AC-1', 'check', { accepted_by: 'risk-lena', rationale: 'r', expires: inDays(10) })],
  }, NOW);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, 'envelope-exemption');
  assert.equal(entries[0].days_to_expiry, 90);
  assert.equal(entries[0].state, 'open');
  assert.equal(entries[1].source, 'assurance-risk-acceptance');
  assert.equal(entries[1].ref, 'AC-1/check');
  assert.equal(entries[1].control, 'assurance-step:check');
  assert.equal(entries[1].days_to_expiry, 10);
});

test('a TERMINAL change contributes nothing — a closed change ships nothing to be excepted from', () => {
  const entries = project({ changes: [change('CHG-1', [exemption()], 'closed')] }, NOW);
  assert.deepEqual(entries, []);
});

test('WARNING BANDS at 30/14/7 days are NOTICES — they never fail the build', () => {
  for (const [days, band] of [[29, 30], [13, 14], [5, 7]]) {
    const entries = project({ changes: [change('CHG-1', [exemption({ expires: inDays(days) })])] }, NOW);
    const { findings, notices } = evaluate(entries);
    assert.deepEqual(findings, [], `${days}d out must not fail`);
    assert.equal(notices.length, 1);
    assert.match(notices[0], new RegExp(`${band}-day band`));
    assert.match(notices[0], /fresh second-line signature/);
  }
});

test('outside the bands there is silence; inside them there is warning; past them there is a block', () => {
  const quiet = evaluate(project({ changes: [change('CHG-1', [exemption({ expires: inDays(31) })])] }, NOW));
  assert.deepEqual(quiet.notices, []);
  assert.deepEqual(quiet.findings, []);
  const expired = evaluate(project({ changes: [change('CHG-1', [exemption({ expires: inDays(-1) })])] }, NOW));
  assert.deepEqual(expired.notices, []);
  assert.ok(expired.findings.some((f) => /EXPIRED/.test(f)), expired.findings.join('\n'));
});

test('an exception with no parseable end date is a policy change nobody approved', () => {
  const { findings } = evaluate(project({ changes: [change('CHG-1', [exemption({ expires: 'when we get to it' })])] }, NOW));
  assert.ok(findings.some((f) => /no parseable expiry/.test(f)));
});

test('CONCENTRATION — more than the limit open against ONE control fails', () => {
  const three = project({ changes: [change('CHG-1', [exemption(), exemption(), exemption()])] }, NOW);
  assert.deepEqual(evaluate(three).findings, [], 'at the limit is not over it');
  const four = project({ changes: [change('CHG-1', [exemption(), exemption(), exemption(), exemption()])] }, NOW);
  const { findings } = evaluate(four);
  assert.ok(findings.some((f) => /CONCENTRATION: 4 open exceptions against Q2-SAST/.test(f)), findings.join('\n'));
  // Spread across controls, the same four exceptions are not a concentration.
  const spread = project({ changes: [change('CHG-1', ['A', 'B', 'C', 'D'].map((c) => exemption({ control: c })))] }, NOW);
  assert.deepEqual(evaluate(spread).findings, []);
  // An EXPIRED exception is a failure in its own right and is not also counted as a pile.
  const expired = project({ changes: [change('CHG-1', [exemption(), exemption(), exemption(), exemption({ expires: inDays(-2) })])] }, NOW);
  assert.ok(!evaluate(expired).findings.some((f) => /CONCENTRATION/.test(f)));
});

test('the limit may be TIGHTENED by policy and never loosened past the shipped floor', () => {
  assert.equal(effectiveLimit(null).limit, CONCENTRATION_LIMIT);
  assert.equal(effectiveLimit({ concentration_limit: 1 }).limit, 1);
  const loose = effectiveLimit({ concentration_limit: 10 });
  assert.equal(loose.limit, CONCENTRATION_LIMIT, 'the floor is applied, not the file');
  assert.ok(loose.findings.some((f) => /may TIGHTEN and never loosen/.test(f)));
  const junk = effectiveLimit({ concentration_limit: 'lots' });
  assert.equal(junk.limit, CONCENTRATION_LIMIT);
  assert.ok(junk.findings.some((f) => /must be a positive integer/.test(f)));
  // Tightened to 1, two against one control is now a concentration.
  const two = project({ changes: [change('CHG-1', [exemption(), exemption()])] }, NOW);
  assert.ok(evaluate(two, { policy: { concentration_limit: 1 } }).findings.some((f) => /CONCENTRATION/.test(f)));
});

test('aggregation groups by control and by owner, expired excluded from the piles', () => {
  const entries = project({
    changes: [change('CHG-1', [exemption(), exemption({ control: 'Q4-SUPPLY', owner: 'ops-dana' }), exemption({ expires: inDays(-3) })])],
  }, NOW);
  const { by_control, by_owner } = aggregate(entries);
  assert.equal(by_control['Q2-SAST'].length, 1);
  assert.equal(by_control['Q4-SUPPLY'].length, 1);
  assert.equal(by_owner['ops-dana'].length, 1);
  assert.equal(by_owner['eng-omar'].length, 1);
});

test('an empty tree projects nothing and passes', () => {
  const { findings, notices } = evaluate(project({}, NOW));
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
});
