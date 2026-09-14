// Tests for the assurance-case gate (rc.14 · WS6). Node runner: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './assurance-case-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ is copied into an adopted tree, so this
// suite runs there too, where the template has been installed as docs/governance/assurance-sla.json.
const TEMPLATE_PATH = [join(H, 'governance/assurance-sla.template.json'), join(H, 'docs/governance/assurance-sla.json')].find(existsSync);
const TEMPLATE = TEMPLATE_PATH ? JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) : null;

const SLA = {
  sources: ['siem', 'model-monitoring'],
  severities: {
    critical: { assessment_hours: 4, remediation_days: 7, requires_containment: true },
    high: { assessment_hours: 24, remediation_days: 30, requires_containment: true },
    low: { assessment_hours: 168, remediation_days: 180, requires_containment: false },
  },
  containment_actions: ['suspend-autonomy', 'block-release', 'rollback', 'model-fallback'],
};
const REGISTRY = { identities: [
  { id: 'risk-lena', kind: 'human', groups: ['second-line'] },
  { id: 'eng', kind: 'human', groups: ['builders'] },
  { id: 'agent-x', kind: 'agent', groups: ['builders'] },
] };
const CONTROLS = new Set(['HG-0006', 'HG-0002']);
const NOW = Date.parse('2026-07-25T00:00:00Z');

function kase(over = {}) {
  return {
    case_id: 'CASE-1',
    signal: { source: 'model-monitoring', severity: 'high', opened_at: '2026-07-24T08:00:00Z' },
    steps: {
      assess: { status: 'done', at: '2026-07-24T14:00:00Z' },
      map_controls: { status: 'done', controls: ['HG-0006'] },
      run_tests: { status: 'done' },
      assemble_evidence: { status: 'done' },
      second_line_decision: { status: 'done', by: 'risk-lena', decision: 'contain' },
      remediation: { status: 'closed', containment: ['model-fallback'] },
    },
    outcome: 'closed',
    ...over,
  };
}
const ev = (k, over = {}) => evaluate(k, { sla: SLA, registry: REGISTRY, controlIds: CONTROLS, now: NOW, ...over });

test('a well-run, contained, second-line-decided case within SLA passes', () => {
  assert.deepEqual(ev(kase()), []);
});

test('an undeclared signal source fails', () => {
  const k = kase(); k.signal.source = 'astrology';
  assert.ok(ev(k).some((f) => /is not a declared assurance source/.test(f)));
});

test('assessment past the severity window fails', () => {
  const k = kase(); k.steps.assess.at = '2026-07-26T08:00:00Z'; // >24h after opened_at
  assert.ok(ev(k).some((f) => /past the 24h window/.test(f)));
});

test('a mapped control not in the catalog fails', () => {
  const k = kase(); k.steps.map_controls.controls = ['NO-SUCH'];
  assert.ok(ev(k).some((f) => /is not in the control catalog/.test(f)));
});

test('a decision by a non-second-line human fails', () => {
  const k = kase(); k.steps.second_line_decision.by = 'eng';
  assert.ok(ev(k).some((f) => /is not a second-line human/.test(f)));
});

test('a high/critical breach with NO containment fails', () => {
  const k = kase(); delete k.steps.remediation.containment;
  assert.ok(ev(k).some((f) => /must be contained/.test(f)));
});

test('an invalid containment action fails', () => {
  const k = kase(); k.steps.remediation.containment = ['ignore-it'];
  assert.ok(ev(k).some((f) => /no valid containment action/.test(f)));
});

test('an OPEN breach past its remediation deadline blocks', () => {
  const old = kase({ outcome: 'open' });
  old.signal.opened_at = '2026-06-01T00:00:00Z'; // >30d before NOW
  old.steps.assess.at = '2026-06-01T06:00:00Z';
  old.steps.remediation = { status: 'open', containment: ['suspend-autonomy'] };
  assert.ok(ev(old).some((f) => /past its 30d remediation deadline/.test(f)));
});

test('an overdue OPEN breach with an unexpired second-line risk acceptance does NOT block', () => {
  const old = kase({ outcome: 'open' });
  old.signal.opened_at = '2026-06-01T00:00:00Z';
  old.steps.assess.at = '2026-06-01T06:00:00Z';
  old.steps.remediation = { status: 'open', containment: ['suspend-autonomy'], risk_acceptance: { accepted_by: 'risk-lena', expires: '2026-12-01T00:00:00Z' } };
  assert.ok(!ev(old).some((f) => /remediation deadline/.test(f)));
});

test('a missing lifecycle step fails', () => {
  const k = kase(); delete k.steps.run_tests;
  assert.ok(ev(k).some((f) => /lifecycle step "run_tests" is missing/.test(f)));
});

test('a low-severity signal needs no containment', () => {
  const k = kase(); k.signal.severity = 'low'; delete k.steps.remediation.containment;
  assert.deepEqual(ev(k), []);
});

/* ---- rc.46: the SLA is VOCABULARY. Sources and containments extend by data, never by code ---- */

test('the shipped SLA template declares the continuous-monitoring source and the two value-side containments', { skip: !TEMPLATE_PATH && 'assurance-sla not present in this layout' }, () => {
  assert.ok(TEMPLATE.sources.includes('shariah-compliance-monitoring'), 'a continuous Shari\'ah compliance monitoring feed has somewhere to open a case');
  assert.ok(TEMPLATE.containment_actions.includes('quarantine-income'));
  assert.ok(TEMPLATE.containment_actions.includes('suspend-product-offering'));
  // the original four are not displaced — an adopter on the shipped file loses nothing
  for (const a of ['suspend-autonomy', 'block-release', 'rollback', 'model-fallback']) assert.ok(TEMPLATE.containment_actions.includes(a));
});

test('a case on the shipped vocabulary passes with no code change — the gate reads the SLA', { skip: !TEMPLATE_PATH && 'assurance-sla not present in this layout' }, () => {
  const k = kase();
  k.signal.source = 'shariah-compliance-monitoring';
  k.steps.remediation.containment = ['quarantine-income', 'suspend-product-offering'];
  assert.deepEqual(evaluate(k, { sla: TEMPLATE, registry: REGISTRY, controlIds: CONTROLS, now: NOW }), []);
});

test('the new vocabulary is still REFUSED for an adopter who did not declare it', () => {
  // The local SLA above is a trimmed adopter file. Nothing is hardcoded: a containment the
  // institution never adopted is not a containment, and neither is a source it never wired.
  const c = kase(); c.steps.remediation.containment = ['quarantine-income'];
  assert.ok(ev(c).some((f) => /no valid containment action/.test(f)));
  const s = kase(); s.signal.source = 'shariah-compliance-monitoring';
  assert.ok(ev(s).some((f) => /is not a declared assurance source/.test(f)));
});
