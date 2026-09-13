// Tests for the Q4 supply-chain gate. Node built-in runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, checkReachability } from './supply-chain-check.mjs';

const GOOD = {
  sbom: { bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ type: 'library', name: 'left-pad', version: '1.3.0' }] },
  audit: { critical: 0, high: 0, moderate: 2, low: 5 },
  provenance: { subject: [{ name: 'app.tar', digest: { sha256: 'ab'.repeat(32) } }], predicate: { builder: { id: 'https://ci.example/builder' } } },
};

test('a complete, in-policy bundle passes', () => {
  assert.deepEqual(evaluate(GOOD), []);
});

test('each missing artifact is its own finding', () => {
  const findings = evaluate({ sbom: null, audit: null, provenance: null });
  assert.equal(findings.length, 3);
  assert.match(findings[0], /no SBOM/);
  assert.match(findings[1], /no dependency-audit/);
  assert.match(findings[2], /no build provenance/);
});

test('an empty SBOM inventory fails', () => {
  const findings = evaluate({ ...GOOD, sbom: { bomFormat: 'CycloneDX', components: [] } });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /no components/);
});

test('a critical vulnerability fails the policy', () => {
  const findings = evaluate({ ...GOOD, audit: { critical: 1, high: 0 } });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /1 critical/);
});

test('an audit report without counts is not evidence', () => {
  const findings = evaluate({ ...GOOD, audit: { status: 'ok' } });
  assert.match(findings[0], /does not state critical\/high/);
});

test('provenance without digests or builder fails', () => {
  const findings = evaluate({ ...GOOD, provenance: { subject: [{ name: 'x' }] } });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /sha256/);
  assert.match(findings[1], /no builder/);
});

// --- Reachability calibration -------------------------------------------------------------
// The report supplies facts; the gate constants supply policy. A sound claim gates on the
// reachable counts; an unsound one falls back to the strict totals rather than buying leniency.

const NOW = new Date('2026-07-26T00:00:00Z');
const REACH = { tool: 'snyk', method: 'transitive-call-graph', reachable: { critical: 0, high: 0 }, deferred_sla: '2026-09-30' };
const withAudit = (audit) => ({ ...GOOD, audit });

test('unreachable highs pass within the deferral budget, under an unexpired SLA', () => {
  const findings = evaluate(withAudit({ critical: 0, high: 8, reachability: REACH }), { now: NOW });
  assert.deepEqual(findings, []);
});

test('a reachable high fails even though the strict totals would too', () => {
  const audit = { critical: 0, high: 3, reachability: { ...REACH, reachable: { critical: 0, high: 1 } } };
  const findings = evaluate(withAudit(audit), { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /1 REACHABLE high/);
});

test('deferring more than the budget fails, and does not also report the raw total', () => {
  const findings = evaluate(withAudit({ critical: 0, high: 15, reachability: REACH }), { now: NOW });
  assert.equal(findings.length, 1, 'a usable claim replaces the totals gate rather than stacking on it');
  assert.match(findings[0], /15 unreachable high/);
});

test('an unreachable critical is never within budget', () => {
  const findings = evaluate(withAudit({ critical: 1, high: 0, reachability: REACH }), { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /1 unreachable critical/);
});

test('deferral without an SLA is a bypass, not a policy', () => {
  const { deferred_sla, ...noSla } = REACH;
  const findings = evaluate(withAudit({ critical: 0, high: 2, reachability: noSla }), { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /no remediation SLA/);
});

test('an expired SLA means overdue, not deferred', () => {
  const audit = { critical: 0, high: 2, reachability: { ...REACH, deferred_sla: '2026-01-31' } };
  const findings = evaluate(withAudit(audit), { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /has passed/);
});

test('an unattributed claim is unusable — the strict totals apply', () => {
  const audit = { critical: 0, high: 4, reachability: { reachable: { critical: 0, high: 0 } } };
  const findings = evaluate(withAudit(audit), { now: NOW });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /names no tool\/method/);
  assert.match(findings[1], /4 high vulnerability/);
});

test('reachable counts above the totals they are drawn from are unusable', () => {
  const audit = { critical: 1, high: 0, reachability: { ...REACH, reachable: { critical: 5, high: 0 } } };
  const findings = evaluate(withAudit(audit), { now: NOW });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /exceed the totals they are drawn from/);
  assert.match(findings[1], /1 critical vulnerability/);
});

test('a claim declaring no counts cannot suppress the totals gate', () => {
  const audit = { critical: 0, high: 9, reachability: { tool: 'snyk', method: 'call-graph' } };
  const findings = evaluate(withAudit(audit), { now: NOW });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /are not stated/);
  assert.match(findings[1], /9 high vulnerability/);
});

test('an audit with no reachability block behaves exactly as before', () => {
  assert.deepEqual(evaluate(withAudit({ critical: 0, high: 0 }), { now: NOW }), []);
  const findings = evaluate(withAudit({ critical: 0, high: 1 }), { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /1 high vulnerability/);
});

test('checkReachability separates a sound-but-failing claim from an unsound one', () => {
  const sound = checkReachability({ ...REACH, reachable: { critical: 0, high: 2 } }, { critical: 0, high: 4 }, NOW);
  assert.equal(sound.usable, true, 'well-formed: gate on it');
  assert.equal(sound.findings.length, 1);
  const unsound = checkReachability({ tool: 'x' }, { critical: 0, high: 4 }, NOW);
  assert.equal(unsound.usable, false, 'no method: fall back to the totals');
});
