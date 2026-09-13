// Tests for the profit-distribution gate. Node built-in runner: `node --test`.
//
// Two properties carry more weight than the rest and are asserted from both sides throughout:
// a generic adopter is never failed by this gate, and a reserve movement with no committee
// approval always is. Nothing here rules on any Shari'ah question, and neither does the gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DIVERGENCE_THRESHOLD,
  divergence,
  evaluate,
  evaluateAll,
  isPlaceholder,
  parseAmount,
  parseRate,
  resolveThreshold,
  run,
} from './profit-distribution-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ is copied into an adopted tree, so this
// suite runs there too, where the template has been installed with its `.template` suffix dropped.
const PROFIT_TEMPLATE_PATH = [join(H, 'governance/profit-distribution.template.json'), join(H, 'docs/governance/profit-distribution.json')].find(existsSync);

const REGISTRY = {
  groups: { builders: '', 'second-line': '' },
  identities: [
    { id: 'agent-loom-delivery', kind: 'agent', roles: [], groups: ['builders'] },
    { id: 'eng-omar', kind: 'human', roles: ['engineering'], groups: ['builders'] },
    { id: 'shariah-compliance-head', kind: 'human', roles: ['shariah-compliance'], groups: ['second-line'] },
    { id: 'shariah-audit-lead', kind: 'human', roles: ['shariah-audit'], groups: ['second-line'] },
    { id: 'issc-scholar-1', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'], external: true, reconciliation_source: 'docs/governance/issc-register.json' },
    { id: 'issc-scholar-2', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'], external: true, reconciliation_source: 'docs/governance/issc-register.json' },
    { id: 'issc-scholar-3', kind: 'human', roles: ['shariah-committee'], groups: ['second-line'], external: true, reconciliation_source: 'docs/governance/issc-register.json' },
  ],
  quorum: { 'shariah-committee': 3 },
};

/** A structure-conformant run. Fictional pool of a fictional bank; no real institution is named. */
const RUN = {
  run_id: 'PD-2026-Q1-001',
  pool_id: 'alpha-islamic-unrestricted-pool',
  period_start: '2026-01-01',
  period_end: '2026-03-31',
  allocation_basis: 'Weightage table WT-2026-01; PER deducted from gross profit before the mudarib share, IRR from the accountholders share after it (SR-2026-004)',
  mudarib_share: 0.3,
  per_reserve_movements: [
    { reserve: 'PER', direction: 'to', amount: 412000, issc_approval_ref: 'SR-2026-011' },
    { reserve: 'IRR', direction: 'from', amount: 90000, issc_approval_ref: 'SR-2026-012' },
  ],
  expected_rate: 0.0375,
  distributed_rate: 0.0370,
  iah_disclosure_evidence_ref: 'docs/governance/evidence/iah-statement-2026-q1.pdf',
  approved_by: ['issc-scholar-1', 'issc-scholar-2', 'issc-scholar-3'],
  status: 'distributed',
};

const RULINGS = new Set(['SR-2026-004', 'SR-2026-011', 'SR-2026-012']);
const ev = (patch = {}, ctx = {}) => evaluate({ ...RUN, ...patch }, { registry: REGISTRY, rulingIds: RULINGS, ...ctx });
const only = (r) => { assert.equal(r.findings.length, 1, r.findings.join('\n')); return r.findings[0]; };

/* ── the clean case ───────────────────────────────────────────────────────────────────────── */

test('a structure-conformant run passes clean', () => {
  const r = ev();
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.notices, []);
  assert.equal(r.counted, true);
});

test('the shipped template reads as NO run — a fresh adoption has made no record, not a bad one', { skip: !PROFIT_TEMPLATE_PATH && 'profit-distribution template not present in this layout' }, () => {
  const template = JSON.parse(readFileSync(PROFIT_TEMPLATE_PATH, 'utf8'));
  assert.ok(Array.isArray(template.runs) && template.runs.length > 0, 'the template ships at least one example row');
  for (const row of template.runs) {
    const r = evaluate(row, { registry: REGISTRY });
    assert.equal(r.counted, false, 'an untouched template row must not count as a distribution run');
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
  }
});

/* ── PD-R01 identity ──────────────────────────────────────────────────────────────────────── */

test('PD-R01: a run with no run_id', () => {
  assert.match(only(ev({ run_id: undefined })), /PD-R01.*no run_id/s);
});

test('PD-R01: a file whose name disagrees with the record inside it', () => {
  const r = ev({}, { file: 'docs/governance/profit-distribution/PD-2026-Q2-001.json' });
  assert.match(only(r), /PD-R01.*two names for one run/s);
});

test('PD-R01: a run keyed by no pool — allocation is computed per pool, not per product', () => {
  assert.match(only(ev({ pool_id: '   ' })), /PD-R01.*pool/s);
});

/* ── PD-R02 the period ────────────────────────────────────────────────────────────────────── */

test('PD-R02: a period that closes before it opens', () => {
  const r = ev({ period_start: '2026-03-31', period_end: '2026-01-01' });
  assert.match(only(r), /PD-R02.*does not open before it closes/s);
});

test('PD-R02: an unparseable period bound', () => {
  const r = ev({ period_end: 'Q1' });
  assert.ok(r.findings.some((f) => /PD-R02.*period_end/s.test(f)), r.findings.join('\n'));
});

/* ── PD-R03 / PD-R04 the terms ────────────────────────────────────────────────────────────── */

test('PD-R03: no allocation_basis — the basis cannot be inferred and the gate must not pretend to', () => {
  assert.match(only(ev({ allocation_basis: undefined })), /PD-R03/);
});

test('PD-R04: mudarib_share absent makes the manager the residual claimant', () => {
  assert.match(only(ev({ mudarib_share: undefined })), /PD-R04.*implicit residual/s);
});

test('PD-R04: a share outside 0..1', () => {
  assert.match(only(ev({ mudarib_share: 30 })), /PD-R04.*outside 0\.\.1/s);
  assert.match(only(ev({ mudarib_share: -0.1 })), /PD-R04.*outside 0\.\.1/s);
});

test('PD-R04: a percent-written share is accepted and converted, not refused', () => {
  assert.deepEqual(ev({ mudarib_share: '30%' }).findings, []);
});

test('PD-R04: a share of exactly 0 or 1 is a boundary, not a violation', () => {
  assert.deepEqual(ev({ mudarib_share: 0 }).findings, []);
  assert.deepEqual(ev({ mudarib_share: 1 }).findings, []);
});

test('PD-R04: a share that is not a number at all', () => {
  assert.match(only(ev({ mudarib_share: 'the usual' })), /PD-R04.*not a rate or ratio/s);
});

/* ── PD-R05 the heart of the gate ─────────────────────────────────────────────────────────── */

test('PD-R05: a reserve movement with no issc_approval_ref is the defect this register exists for', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 412000 }] });
  const f = only(r);
  assert.match(f, /PD-R05/);
  assert.match(f, /per_reserve_movements\[0\]/);
  assert.match(f, /displaced commercial risk/);
});

test('PD-R05: a placeholder approval reference is not an approval', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'IRR', direction: 'from', amount: 1, issc_approval_ref: 'ADOPT: SR-* ruling id' }] });
  assert.match(only(r), /PD-R05/);
});

test('PD-R05: `draft` earns no exemption — a movement is recorded when it happened', () => {
  const r = ev({ status: 'draft', per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 5 }] });
  assert.ok(r.findings.some((f) => /PD-R05/.test(f)), r.findings.join('\n'));
  assert.ok(r.notices.some((n) => /status is draft/.test(n)));
});

test('a run with NO reserve movements at all is fine — the reserves are optional instruments', () => {
  assert.deepEqual(ev({ per_reserve_movements: [] }).findings, []);
  assert.deepEqual(ev({ per_reserve_movements: undefined }).findings, []);
});

test('PD-R05 fires once per unapproved movement, not once per run', () => {
  const r = ev({ per_reserve_movements: [
    { reserve: 'PER', direction: 'to', amount: 1 },
    { reserve: 'IRR', direction: 'from', amount: 2 },
  ] });
  assert.equal(r.findings.filter((f) => /PD-R05/.test(f)).length, 2, r.findings.join('\n'));
});

/* ── PD-R06 movement shape ────────────────────────────────────────────────────────────────── */

test('PD-R06: a reserve outside PER|IRR', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'GENERAL', direction: 'to', amount: 1, issc_approval_ref: 'SR-2026-011' }] });
  assert.match(only(r), /PD-R06.*reserve must be PER \| IRR/s);
});

test('PD-R06: a direction-less movement can be read either way round', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'PER', amount: 1, issc_approval_ref: 'SR-2026-011' }] });
  assert.match(only(r), /PD-R06.*direction must be to \| from/s);
});

test('PD-R06: a non-positive or unparseable amount', () => {
  const bad = (amount) => ev({ per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount, issc_approval_ref: 'SR-2026-011' }] });
  assert.match(only(bad(0)), /PD-R06.*not positive/s);
  assert.match(only(bad(-5)), /PD-R06.*not positive/s);
  assert.match(only(bad('a lot')), /PD-R06.*not a number/s);
});

test('PD-R06: an amount written with thousands separators is read, not refused', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: '412,000', issc_approval_ref: 'SR-2026-011' }] });
  assert.deepEqual(r.findings, []);
});

test('PD-R06: per_reserve_movements that is not an array, and a movement that is not an object', () => {
  assert.match(only(ev({ per_reserve_movements: 'none' })), /PD-R06.*must be an ARRAY/s);
  assert.ok(ev({ per_reserve_movements: ['SR-2026-011'] }).findings.some((f) => /PD-R06.*not a movement object/s.test(f)));
});

/* ── PD-R07 the disclosure duty ───────────────────────────────────────────────────────────── */

test('PD-R07: a material divergence with no disclosure evidence', () => {
  const r = ev({ distributed_rate: 0.030, iah_disclosure_evidence_ref: undefined });
  const f = only(r);
  assert.match(f, /PD-R07/);
  assert.match(f, /EXPECTED and never guaranteed/);
});

test('PD-R07: the same divergence WITH disclosure evidence passes — the divergence is lawful', () => {
  assert.deepEqual(ev({ distributed_rate: 0.030 }).findings, []);
});

test('PD-R07: a divergence below the threshold owes nothing', () => {
  assert.deepEqual(ev({ distributed_rate: 0.0360, iah_disclosure_evidence_ref: undefined }).findings, []);
});

test('PD-R07: a distributed rate ABOVE the expected one diverges too — paying more is still a surprise', () => {
  const r = ev({ distributed_rate: 0.060, iah_disclosure_evidence_ref: undefined });
  assert.match(only(r), /PD-R07/);
});

test('PD-R07: a tightened threshold catches a divergence the default would let past', () => {
  const patch = { distributed_rate: 0.0360, iah_disclosure_evidence_ref: undefined };
  assert.deepEqual(ev(patch).findings, []);
  assert.match(only(ev(patch, { threshold: 0.01 })), /PD-R07/);
});

test('PD-R07: mixed units are refused rather than compared — a wrong answer is worse than none', () => {
  const r = ev({ expected_rate: '3.75%', distributed_rate: 0.0370 });
  assert.match(only(r), /PD-R07.*two orders of magnitude/s);
});

test('PD-R07: both rates written as percentages compare identically to both written bare', () => {
  assert.deepEqual(ev({ expected_rate: '3.75%', distributed_rate: '3.70%' }).findings, []);
  const r = ev({ expected_rate: '3.75%', distributed_rate: '3.00%', iah_disclosure_evidence_ref: undefined });
  assert.match(only(r), /PD-R07/);
});

test('PD-R07: an unstated or unparseable rate', () => {
  assert.match(only(ev({ expected_rate: undefined })), /PD-R07.*expected_rate/s);
  assert.match(only(ev({ distributed_rate: 'about 3%' })), /PD-R07.*distributed_rate/s);
});

test('PD-R07: an expectation of zero that was not met is material', () => {
  const r = ev({ expected_rate: 0, distributed_rate: 0.01, iah_disclosure_evidence_ref: undefined });
  assert.match(only(r), /expectation of zero/);
  assert.deepEqual(ev({ expected_rate: 0, distributed_rate: 0, iah_disclosure_evidence_ref: undefined }).findings, []);
});

test('a rate that exactly met expectation while the reserves moved is a NOTICE, never a failure', () => {
  const r = ev({ distributed_rate: 0.0375 });
  assert.deepEqual(r.findings, []);
  assert.ok(r.notices.some((n) => /reserves are doing the work/.test(n)), r.notices.join('\n'));
});

/* ── PD-R08 who approved ──────────────────────────────────────────────────────────────────── */

test('PD-R08: an agent can never approve a distribution run', () => {
  const r = ev({ approved_by: 'agent-loom-delivery' });
  const f = only(r);
  assert.match(f, /PD-R08.*AGENT/s);
  assert.match(f, /no agent authors or approves a Shari'ah determination/);
});

test('PD-R08: an identity outside the registry, and a run nobody approved', () => {
  assert.match(only(ev({ approved_by: 'the committee' })), /PD-R08.*not in the identity registry/s);
  assert.match(only(ev({ approved_by: undefined })), /PD-R08.*nobody approved/s);
  assert.match(only(ev({ approved_by: 'ADOPT: registry id of the committee' })), /PD-R08.*nobody approved/s);
});

test('PD-R08: a human holding neither Shari\'ah role', () => {
  assert.match(only(ev({ approved_by: 'eng-omar' })), /PD-R08.*holds none of/s);
  assert.match(only(ev({ approved_by: 'shariah-audit-lead' })), /PD-R08.*holds none of/s,
    'third-line audit certifies what was built; it does not approve the run it will later audit');
});

test('PD-R08: the Shari\'ah Compliance Function alone may approve — no quorum attaches to a desk', () => {
  assert.deepEqual(ev({ approved_by: 'shariah-compliance-head' }).findings, []);
  assert.deepEqual(ev({ approved_by: ['shariah-compliance-head'] }).findings, []);
});

test('PD-R08: one scholar is one scholar — a committee approval below quorum is refused', () => {
  const r = ev({ approved_by: ['issc-scholar-1'] });
  const f = only(r);
  assert.match(f, /PD-R08.*approved by 1 committee member\(s\).*quorum for shariah-committee is 3/s);
  assert.match(f, /rules as a BODY/);
  assert.match(only(ev({ approved_by: ['issc-scholar-1', 'issc-scholar-2'] })), /PD-R08.*quorum/s);
});

test('PD-R08: one member signing twice is one signature', () => {
  const r = ev({ approved_by: ['issc-scholar-1', 'issc-scholar-1', 'issc-scholar-2'] });
  assert.ok(r.findings.some((f) => /appears twice/.test(f)), r.findings.join('\n'));
  assert.ok(r.findings.some((f) => /quorum/.test(f)), 'the duplicate does not count toward quorum');
});

test('PD-R08: with no registry loaded, an approval does not silently pass', () => {
  const r = evaluate(RUN, { registry: null, rulingIds: RULINGS });
  assert.equal(r.findings.length, 3, r.findings.join('\n'));
  assert.ok(r.findings.every((f) => /PD-R08.*no identity registry found/s.test(f)));
});

/* ── PD-R12 status, PD-R13 citations ──────────────────────────────────────────────────────── */

test('PD-R12: a status outside draft|approved|distributed', () => {
  assert.match(only(ev({ status: 'paid' })), /PD-R12/);
  assert.deepEqual(ev({ status: undefined }).findings, []);
});

test('PD-R13: an SR-* citation that resolves to no ruling is a citation of a ghost', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 1, issc_approval_ref: 'SR-9999-001' }] });
  assert.match(only(r), /PD-R13.*citation of a ghost/s);
});

test('PD-R13 cannot run with no rulings register — and says NOT VERIFIED instead of passing in silence', () => {
  const r = evaluate({ ...RUN, per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 1, issc_approval_ref: 'SR-9999-001' }] }, { registry: REGISTRY });
  assert.deepEqual(r.findings, []);
  assert.ok(r.notices.some((n) => /SR-9999-001" NOT VERIFIED — no rulings register/.test(n)), r.notices.join('\n'));
});

test('a register that is PRESENT but empty is a register: every SR-* citation then resolves to nothing', () => {
  const r = evaluate({ ...RUN, per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 1, issc_approval_ref: 'SR-9999-001' }] },
    { registry: REGISTRY, rulingIds: new Set() });
  assert.match(only(r), /PD-R13.*citation of a ghost/s);
});

test('run(): a repo with no rulings register reports each SR-* citation NOT VERIFIED', () => {
  const dir = repo({ runs: [RUN] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.equal(r.notices.filter((n) => /NOT VERIFIED — no rulings register/.test(n)).length, 2, r.notices.join('\n'));
  } finally { clean(dir); }
});

test('a minute reference is NOT resolved, and the gate says so instead of pretending it did', () => {
  const r = ev({ per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 1, issc_approval_ref: 'ISSC minute 2026/03/14 item 7' }] });
  assert.deepEqual(r.findings, []);
  assert.ok(r.notices.some((n) => /NOT RESOLVED here/.test(n)), r.notices.join('\n'));
});

/* ── PD-R10 duplicates, PD-R11 the threshold ──────────────────────────────────────────────── */

test('PD-R10: two records of one run', () => {
  const r = evaluateAll([{ run: RUN, file: null }, { run: RUN, file: null }], { registry: REGISTRY, rulingIds: RULINGS });
  assert.match(only(r), /PD-R10.*two records of one run/s);
  assert.equal(r.count, 2);
});

test('evaluateAll does not count untouched template rows toward the register', () => {
  const blank = { run_id: 'ADOPT: id', pool_id: 'ADOPT: pool', period_start: 'ADOPT: date', period_end: 'ADOPT: date', allocation_basis: 'ADOPT: basis', mudarib_share: 'ADOPT: share', approved_by: 'ADOPT: who' };
  const r = evaluateAll([{ run: RUN, file: null }, { run: blank, file: null }], { registry: REGISTRY, rulingIds: RULINGS });
  assert.deepEqual(r.findings, []);
  assert.equal(r.count, 1);
});

test('PD-R11: the threshold may be tightened and never loosened', () => {
  assert.deepEqual(resolveThreshold(null), { threshold: DEFAULT_DIVERGENCE_THRESHOLD, findings: [] });
  assert.equal(resolveThreshold({ rate_divergence_threshold: 0.02 }).threshold, 0.02);
  const loose = resolveThreshold({ rate_divergence_threshold: 0.5 });
  assert.equal(loose.threshold, DEFAULT_DIVERGENCE_THRESHOLD, 'a loosened threshold is refused AND not honoured');
  assert.match(loose.findings[0], /PD-R11.*only ever be TIGHTENED/s);
  assert.match(resolveThreshold({ rate_divergence_threshold: 0 }).findings[0], /PD-R11/);
  assert.match(resolveThreshold({ rate_divergence_threshold: '10%' }).findings[0], /PD-R11/);
});

/* ── the small parsers ────────────────────────────────────────────────────────────────────── */

test('parseRate keeps the unit rather than normalising a convention it cannot know', () => {
  assert.deepEqual(parseRate(0.0375), { value: 0.0375, unit: 'bare' });
  assert.deepEqual(parseRate('3.75%'), { value: 3.75, unit: 'percent' });
  assert.deepEqual(parseRate(' 3.75 % '), { value: 3.75, unit: 'percent' });
  assert.deepEqual(parseRate('-0.5'), { value: -0.5, unit: 'bare' });
  assert.equal(parseRate('roughly 3%'), null);
  assert.equal(parseRate(undefined), null);
});

test('parseAmount reads numbers and numeric strings, and nothing else', () => {
  assert.equal(parseAmount(412000), 412000);
  assert.equal(parseAmount('412,000'), 412000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('a lot'), null);
  assert.equal(parseAmount(Infinity), null);
});

test('divergence is relative, and an unmet expectation of zero is infinite', () => {
  assert.equal(divergence(0.04, 0.04), 0);
  assert.equal(divergence(0.04, 0.02), 0.5);
  assert.equal(divergence(4, 2), 0.5, 'unit-agnostic: the same numbers in percent give the same answer');
  assert.equal(divergence(0, 0), 0);
  assert.equal(divergence(0, 0.01), Infinity);
});

test('isPlaceholder recognises the ADOPT forms the templates use, and nothing else', () => {
  assert.ok(isPlaceholder('ADOPT: your distribution run id'));
  assert.ok(isPlaceholder('ADOPT-2026-Q1'));
  assert.ok(!isPlaceholder('PD-2026-Q1-001'));
  assert.ok(!isPlaceholder('adopted-pool-basis'), 'a real value that merely starts with "adopt" is not a placeholder');
});

/* ── run(): mandatory-when-compiled, off a real tree ──────────────────────────────────────── */

function repo({ requiresShariah = true, runs = null, register = null, rulings = null, state = 'in-delivery' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'profit-'));
  const base = join(dir, 'docs/governance/changes/CHG-ISL-1');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-ISL-1', current_state: state, control_plan: 'control-plan.json' }));
  writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
    required_gates: [], required_evidence: [],
    required_capabilities: requiresShariah ? { shariah_governance: { required: true } } : { exposure_control: { required: true } },
  }));
  writeFileSync(join(dir, 'docs/governance/identities.json'), JSON.stringify(REGISTRY));
  if (rulings) writeFileSync(join(dir, 'docs/governance/shariah-rulings.json'), JSON.stringify({ rulings }));
  if (register) writeFileSync(join(dir, 'docs/governance/profit-distribution.json'), JSON.stringify(register));
  if (runs) {
    mkdirSync(join(dir, 'docs/governance/profit-distribution'), { recursive: true });
    for (const r of runs) writeFileSync(join(dir, `docs/governance/profit-distribution/${r.run_id}.json`), JSON.stringify(r));
  }
  return dir;
}
const clean = (d) => rmSync(d, { recursive: true, force: true });

test('run(): a generic adopter is INERT — no records, no Shari\'ah capability, no findings', () => {
  const dir = repo({ requiresShariah: false });
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.deepEqual(r.findings, []);
    assert.equal(r.count, 0);
  } finally { clean(dir); }
});

test('run(): PD-R09 fires the moment a compiled plan requires shariah_governance, naming the change', () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.equal(r.required, true);
    assert.equal(r.inert, false);
    assert.equal(r.findings.length, 1, r.findings.join('\n'));
    assert.match(r.findings[0], /PD-R09/);
    assert.match(r.findings[0], /shariah_governance capability \[CHG-ISL-1\]/);
  } finally { clean(dir); }
});

test('run(): a recorded run satisfies PD-R09 and is itself checked', () => {
  const dir = repo({ runs: [RUN], rulings: [{ ruling_id: 'SR-2026-011' }, { ruling_id: 'SR-2026-012' }] });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.equal(r.count, 1);
  } finally { clean(dir); }
});

test('run(): a run recorded under the WRONG filename is caught end to end', () => {
  const dir = repo({ runs: [{ ...RUN, run_id: 'PD-2026-Q1-001' }] });
  try {
    // rename the record's id without renaming the file
    writeFileSync(join(dir, 'docs/governance/profit-distribution/PD-2026-Q1-001.json'), JSON.stringify({ ...RUN, run_id: 'PD-2026-Q2-001' }));
    const r = run(dir);
    assert.ok(r.findings.some((f) => /PD-R01.*two names for one run/s.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run(): the single-file register is read too, and its threshold governs the runs', () => {
  const diverging = { ...RUN, distributed_rate: 0.0360, iah_disclosure_evidence_ref: undefined };
  const dir = repo({ register: { rate_divergence_threshold: 0.01, runs: [diverging] } });
  try {
    const r = run(dir);
    assert.equal(r.count, 1);
    assert.ok(r.findings.some((f) => /PD-R07/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run(): records present WITHOUT the capability compiled are still checked — not inert', () => {
  const dir = repo({ requiresShariah: false, runs: [{ ...RUN, per_reserve_movements: [{ reserve: 'PER', direction: 'to', amount: 1 }] }] });
  try {
    const r = run(dir);
    assert.equal(r.inert, false);
    assert.equal(r.required, false);
    assert.ok(r.findings.some((f) => /PD-R05/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run(): a malformed record is reported, never skipped', () => {
  const dir = repo({ runs: [RUN] });
  try {
    writeFileSync(join(dir, 'docs/governance/profit-distribution/broken.json'), '{ not json');
    const r = run(dir);
    assert.ok(r.findings.some((f) => /broken\.json: not valid JSON/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run(): a repository with no changes tree and no records is inert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profit-bare-'));
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.deepEqual(r.findings, []);
  } finally { clean(dir); }
});

/* ── the shipped identity registry actually satisfies this gate ───────────────────────────── */

test('the shipped identity template can approve a run: quorum of 3, and audit is not an approver', () => {
  const path = [`${H}/governance/identities.template.json`, `${H}/docs/governance/identities.json`].find(existsSync);
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const scholars = registry.identities.filter((i) => (i.roles || []).includes('shariah-committee')).map((i) => i.id);
  assert.ok(scholars.length >= 3, 'the shipped registry must be able to reach the committee quorum');
  const ok = evaluate({ ...RUN, approved_by: scholars.slice(0, 3) }, { registry });
  assert.deepEqual(ok.findings, [], ok.findings.join('\n'));
  const audit = registry.identities.find((i) => (i.roles || []).includes('shariah-audit'));
  assert.match(only(evaluate({ ...RUN, approved_by: audit.id }, { registry })), /PD-R08/);
});
