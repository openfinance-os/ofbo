// Tests for the approval queue / WIP report. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byRole, outstanding, targetDays, validate, waitingSince } from './approval-status.mjs';

const NOW = Date.parse('2026-08-01T00:00:00Z');
const PLAN = {
  change_id: 'CHG-1',
  risk_tier: 'high',
  required_gates: ['PA1', 'PA2'],
  required_approver_roles: ['product-owner', 'risk-second-line', 'accountable-executive', 'compliance'],
  pa1_approver_roles: ['compliance'],
};
const ENVELOPE = {
  change_id: 'CHG-1',
  current_state: 'in-delivery',
  classification: { classified_at: '2026-07-01' },
  state_history: [
    { state: 'classified', at: '2026-07-01T00:00:00Z' },
    { state: 'permission-to-develop', at: '2026-07-10T00:00:00Z' },
    { state: 'in-delivery', at: '2026-07-25T00:00:00Z' },
  ],
};
const SLA = { default_target_days: 10, stages: { PA1: { target_days: 5 } }, roles: { compliance: { target_days: 2 } }, wip_limit_per_role: 1 };

test('the outstanding set comes from the gate\'s own derivation — every compiled role still owed', () => {
  const rows = outstanding(ENVELOPE, PLAN, { pa1: { decision: 'pending' } }, { sla: SLA, now: NOW });
  const pa1 = rows.filter((r) => r.stage === 'PA1').map((r) => r.role).sort();
  // pa1Roles() = core (product-owner, risk-second-line) + high tier (accountable-executive)
  // + the profile's pa1_approver_roles (compliance), intersected with the compiled roles.
  assert.deepEqual(pa1, ['accountable-executive', 'compliance', 'product-owner', 'risk-second-line']);
  assert.equal(rows.filter((r) => r.stage === 'PA2').length, 4);
});

test('a role that HAS approved leaves the queue; an approved stage still owing a role does not', () => {
  const passport = { pa1: { decision: 'approved', approvals: [{ role: 'product-owner', by: 'po-fatima' }] } };
  const rows = outstanding(ENVELOPE, PLAN, passport, { sla: SLA, now: NOW });
  const pa1 = rows.filter((r) => r.stage === 'PA1').map((r) => r.role);
  assert.ok(!pa1.includes('product-owner'));
  assert.ok(pa1.includes('risk-second-line'), 'an approved stage that still owes a role is still a queue');
});

test('age is measured from the state the change is SITTING in, not from its conception', () => {
  const rows = outstanding(ENVELOPE, PLAN, {}, { sla: SLA, now: NOW });
  assert.equal(rows[0].age_days, 7); // entered in-delivery on the 25th
  assert.equal(rows[0].age_basis, 'state_history');
  assert.equal(waitingSince(ENVELOPE).basis, 'state_history');
});

test('with no state_history the age falls back to classification and SAYS it is approximate', () => {
  const { state_history, ...noHistory } = ENVELOPE;
  const rows = outstanding(noHistory, PLAN, {}, { sla: SLA, now: NOW });
  assert.equal(rows[0].age_days, 31);
  assert.match(rows[0].age_basis, /approximate/);
  const undatable = outstanding({ ...noHistory, classification: {} }, PLAN, {}, { sla: SLA, now: NOW });
  assert.equal(undatable[0].age_days, null);
  assert.match(undatable[0].age_basis, /undatable/);
});

test('SLA targets resolve role → stage → default, and a breach is FLAGGED (never a failure)', () => {
  assert.equal(targetDays(SLA, 'PA1', 'compliance'), 2);   // role override wins
  assert.equal(targetDays(SLA, 'PA1', 'product-owner'), 5); // stage target
  assert.equal(targetDays(SLA, 'PA2', 'product-owner'), 10); // default
  assert.equal(targetDays(null, 'PA2', 'anyone'), 10);       // shipped default with no SLA file
  const rows = outstanding(ENVELOPE, PLAN, {}, { sla: SLA, now: NOW });
  const compliance = rows.find((r) => r.stage === 'PA1' && r.role === 'compliance');
  assert.equal(compliance.breached, true, '7d against a 2d target is over target');
  const po = rows.find((r) => r.stage === 'PA2' && r.role === 'product-owner');
  assert.equal(po.breached, false);
});

test('per-role aggregation is the WIP view; the soft limit is a flag', () => {
  const rows = outstanding(ENVELOPE, PLAN, {}, { sla: SLA, now: NOW });
  const agg = byRole(rows, SLA);
  assert.equal(agg.compliance.waiting, 2); // PA1 and PA2
  assert.equal(agg.compliance.over_wip_limit, true); // limit of 1
  assert.equal(agg.compliance.oldest_days, 7);
  assert.equal(byRole(rows, null)['product-owner'].over_wip_limit, false); // no limit declared
});

test('a terminal change and a change with no compiled plan queue nothing', () => {
  assert.deepEqual(outstanding({ ...ENVELOPE, current_state: 'closed' }, PLAN, {}, { sla: SLA, now: NOW }), []);
  assert.deepEqual(outstanding(ENVELOPE, null, {}, { sla: SLA, now: NOW }), []);
  assert.deepEqual(outstanding(ENVELOPE, { ...PLAN, required_gates: [] }, {}, { sla: SLA, now: NOW }), []);
});

test('--check validates the SLA SHAPE only; an absent SLA is valid', () => {
  assert.deepEqual(validate(null), []);
  assert.deepEqual(validate(SLA), []);
  assert.ok(validate({ default_target_days: -1 }).some((f) => /default_target_days must be a positive number/.test(f)));
  assert.ok(validate({ stages: { PA1: { target_days: 'soon' } } }).some((f) => /stages\.PA1\.target_days/.test(f)));
  assert.ok(validate({ roles: { compliance: { target_days: 0 } } }).some((f) => /roles\.compliance\.target_days/.test(f)));
  assert.ok(validate({ wip_limit_per_role: 2.5 }).some((f) => /wip_limit_per_role must be a positive integer/.test(f)));
});
