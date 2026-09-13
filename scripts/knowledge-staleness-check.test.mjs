// Tests for the knowledge-currency gate. Node built-in runner: `node --test`.
//
// Two properties matter more than the field rules and are tested first and last: the gate is
// SILENT for a repository that pins nothing and compiles nothing (a conventional adopter never
// fails on this), and the shipped template — every row an untouched ADOPT placeholder — produces
// notices rather than findings until a compiled plan asks for the capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY, ageDays, evaluate, isPlaceholder, knownCapabilityNames, requiringChanges, run } from './knowledge-staleness-check.mjs';
import { aggregateRequirements } from '../core/compiled-requirements.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolved across the BUNDLE and ADOPTED layouts: scripts/ is copied into an adopted tree, so this
// suite runs there too, where the template has been installed with its `.template` suffix dropped.
const KNOWLEDGE_PINS_PATH = [join(H, 'governance/knowledge-pins.template.json'), join(H, 'docs/governance/knowledge-pins.json')].find(existsSync);
const NOW = Date.parse('2026-08-01T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

const pin = (over = {}) => ({
  id: 'open-finance-api-standard',
  publisher: 'The national open-finance standards body',
  artifact: 'API standards, including errata',
  pinned_version: 'v2.1-final + errata3',
  source_url: 'https://example.invalid/standards',
  last_verified: daysAgo(10),
  max_age_days: 60,
  required_by_capability: CAPABILITY,
  check_ref: null,
  owner_role: 'compliance',
  ...over,
});

// Default: the capability IS compiled-required, so currency rules bite. `exists` answers yes
// unless a test says otherwise.
const check = (pins, over = {}) => evaluate({ pins }, {
  requiredCapabilities: new Set([CAPABILITY]), now: NOW, ...over,
});

const clean = (d) => rmSync(d, { recursive: true, force: true });

test('a well-formed, freshly-verified pin passes clean', () => {
  const { findings, notices, count } = check([pin()]);
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
  assert.equal(count, 1);
});

test('KP-R01 — a mounted file with no pins array is a register with no register', () => {
  for (const doc of [{}, { pins: {} }, { pins: 'later' }]) {
    const { findings } = evaluate(doc, { now: NOW });
    assert.ok(findings.some((f) => /KP-R01/.test(f)), JSON.stringify(doc));
  }
});

test('KP-R02 — a pin needs an id, and two pins may not share one', () => {
  assert.ok(check([pin({ id: '' })]).findings.some((f) => /KP-R02: a pin has no id/.test(f)));
  assert.ok(check([pin({ id: 'ADOPT: name it' })]).findings.some((f) => /KP-R02: a pin has no id/.test(f)));
  assert.ok(check([pin(), pin()]).findings.some((f) => /duplicate pin id/.test(f)));
});

test('KP-R03 — an untouched template row is a NOTICE when nothing compiles the capability, a FINDING when something does', () => {
  const untouched = pin({
    publisher: 'ADOPT: the publisher', pinned_version: 'ADOPT: the edition', last_verified: 'ADOPT: ISO date',
    check_ref: 'ADOPT: path to the job, or null',
  });
  const dormant = check([untouched], { requiredCapabilities: new Set() });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.ok(dormant.notices.some((n) => /KP-R03.*still the shipped template row/.test(n)), dormant.notices.join('\n'));

  const live = check([untouched]);
  assert.ok(live.findings.some((f) => /KP-R03/.test(f)), live.findings.join('\n'));
  assert.deepEqual(live.notices, []);
  // The row is skipped after KP-R03: one finding, not a pile of consequential ones.
  assert.equal(live.findings.length, 1, live.findings.join('\n'));
});

test('KP-R03 does not swallow an EMPTY row — no placeholder was left, so the field rules bite', () => {
  const { findings } = check([{ id: 'bare' }], { requiredCapabilities: new Set() });
  assert.ok(findings.some((f) => /has no publisher/.test(f)), findings.join('\n'));
  assert.ok(findings.some((f) => /KP-R09/.test(f)));
  assert.ok(findings.some((f) => /KP-R05/.test(f)));
});

test('KP-R04 — a HALF-adopted row always fails, even where the capability is dormant', () => {
  for (const field of ['publisher', 'pinned_version', 'owner_role']) {
    const { findings } = check([pin({ [field]: 'ADOPT: fill me in' })], { requiredCapabilities: new Set() });
    assert.ok(findings.some((f) => new RegExp(`KP-R04.*${field}`).test(f)), `${field}: ${findings.join('\n')}`);
  }
  // A missing (rather than placeholder) publisher or edition is the same defect, differently written.
  assert.ok(check([pin({ publisher: '' })]).findings.some((f) => /KP-R04: .*has no publisher/.test(f)));
  assert.ok(check([pin({ pinned_version: undefined })]).findings.some((f) => /KP-R04: .*has no pinned_version/.test(f)));
});

test('KP-R05 — an unparseable last_verified FAILS rather than passes; a future date fails too', () => {
  const bad = check([pin({ last_verified: 'ADOPT: ISO date', publisher: 'A real publisher' })]);
  assert.ok(bad.findings.some((f) => /KP-R05.*no parseable last_verified/.test(f)), bad.findings.join('\n'));
  assert.ok(check([pin({ last_verified: 'last spring' })]).findings.some((f) => /KP-R05/.test(f)));
  assert.ok(check([pin({ last_verified: undefined })]).findings.some((f) => /KP-R05/.test(f)));
  const future = check([pin({ last_verified: daysAgo(-30) })]);
  assert.ok(future.findings.some((f) => /in the FUTURE \(30d\)/.test(f)), future.findings.join('\n'));
});

test('KP-R06 — a pin with no usable bound never goes stale, which is the unpinned state', () => {
  for (const bad of [undefined, 0, -30, '90', Infinity, null]) {
    const { findings } = check([pin({ max_age_days: bad })]);
    assert.ok(findings.some((f) => /KP-R06/.test(f)), JSON.stringify(bad));
  }
});

test('KP-R07 — stale is a FINDING when the capability is compiled-required, a NOTICE when it is not', () => {
  const stale = pin({ last_verified: daysAgo(200), max_age_days: 60 });
  const live = check([stale]);
  assert.ok(live.findings.some((f) => /KP-R07.*200d ago.*past its 60d bound/.test(f)), live.findings.join('\n'));
  assert.ok(/nobody has checked whether it moved/.test(live.findings[0]));

  const dormant = check([stale], { requiredCapabilities: new Set() });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.ok(dormant.notices.some((n) => /KP-R07.*reported rather than blocking/.test(n)), dormant.notices.join('\n'));
});

test('KP-R07 — a pin naming NO capability is unconditionally owned: stale is a finding even in a dormant repo', () => {
  const { findings } = check([pin({ required_by_capability: undefined, last_verified: daysAgo(90) })], { requiredCapabilities: new Set() });
  assert.ok(findings.some((f) => /KP-R07/.test(f)), findings.join('\n'));
});

test('KP-R07 boundary — exactly at the bound is fresh; one day past is not', () => {
  assert.deepEqual(check([pin({ last_verified: daysAgo(60), max_age_days: 60 })]).findings, []);
  assert.ok(check([pin({ last_verified: daysAgo(61), max_age_days: 60 })]).findings.some((f) => /KP-R07/.test(f)));
});

test('KP-R08 — null check_ref is legitimate; a ghost path is a control citing something nobody wrote', () => {
  assert.deepEqual(check([pin({ check_ref: null })]).findings, []);
  assert.deepEqual(check([pin({ check_ref: 'scripts/check-standards.mjs' })], { exists: () => true }).findings, []);
  const ghost = check([pin({ check_ref: 'scripts/check-standards.mjs' })], { exists: () => false });
  assert.ok(ghost.findings.some((f) => /KP-R08.*does not exist in this repository/.test(f)), ghost.findings.join('\n'));
  // An ADOPT check_ref on an otherwise-adopted row is undecided, which is neither of the two answers.
  assert.ok(check([pin({ check_ref: 'ADOPT: the job, or null' })]).findings.some((f) => /KP-R04.*check_ref/.test(f)));
  assert.ok(check([pin({ check_ref: 42 })]).findings.some((f) => /KP-R08.*neither a path nor null/.test(f)));
});

test('KP-R09 — a bound with no owner_role is a bound nobody keeps', () => {
  assert.ok(check([pin({ owner_role: '' })]).findings.some((f) => /KP-R09/.test(f)));
});

test('KP-R10 — a TYPO in required_by_capability cannot downgrade a stale pin to a notice', () => {
  const stale = pin({ last_verified: daysAgo(200), max_age_days: 60, required_by_capability: 'knowledge_currncy' });
  const known = new Set(['knowledge_currency', 'shariah_governance']);
  const r = check([stale], { requiredCapabilities: new Set([CAPABILITY]), knownCapabilities: known });
  assert.ok(r.findings.some((f) => /KP-R10.*"knowledge_currncy".*no compiled plan and no profile/s.test(f)), r.findings.join('\n'));
  // …and the staleness it was hiding is a FINDING, not the notice the typo used to buy.
  assert.ok(r.findings.some((f) => /KP-R07/.test(f)), r.findings.join('\n'));
  assert.deepEqual(r.notices, [], r.notices.join('\n'));
});

test('KP-R10 — a RECOGNISED but uncompiled capability still goes dormant: this is not a generic-adopter tax', () => {
  const stale = pin({ last_verified: daysAgo(200), max_age_days: 60, required_by_capability: 'shariah_governance' });
  const known = new Set(['knowledge_currency', 'shariah_governance']);
  const r = check([stale], { requiredCapabilities: new Set(), knownCapabilities: known });
  assert.deepEqual(r.findings, [], r.findings.join('\n'));
  assert.ok(r.notices.some((n) => /KP-R07.*reported rather than blocking/.test(n)), r.notices.join('\n'));
});

test('KP-R10 — the default known set is this gate\'s capability plus whatever a plan requires, so the check is never silently off', () => {
  const r = check([pin({ required_by_capability: 'invented_by_nobody' })], { requiredCapabilities: new Set() });
  assert.ok(r.findings.some((f) => /KP-R10/.test(f)), r.findings.join('\n'));
  assert.deepEqual(check([pin()], { requiredCapabilities: new Set() }).findings, []);
});

test('knownCapabilityNames reads the ADOPTER\'S tree — shipped profiles and compiled plans, not a baked-in taxonomy', () => {
  const names = knownCapabilityNames(H, aggregateRequirements(H));
  for (const n of ['knowledge_currency', 'shariah_governance', 'data_risk_register', 'model_risk']) {
    assert.ok(names.has(n), `${n} is declared by a shipped profile and must be recognised`);
  }
  assert.ok(!names.has('knowledge_currncy'));
  // A capability an institution invents in its OWN profile is recognised the moment it declares it.
  const dir = repo({ requires: true });
  try {
    mkdirSync(join(dir, 'profiles/institutions'), { recursive: true });
    writeFileSync(join(dir, 'profiles/institutions/house.json'), JSON.stringify({
      name: 'house', tiers: { medium: { capabilities: { house_specific_control: { required: true } } } },
    }));
    const local = knownCapabilityNames(dir, aggregateRequirements(dir));
    assert.ok(local.has('house_specific_control'), [...local].join(', '));
    assert.ok(local.has(CAPABILITY), 'the compiled plan\'s own capability is always known');
  } finally { clean(dir); }
});

test('the SHIPPED template is notices-only for a repository that compiles nothing, and all findings once it does', { skip: !KNOWLEDGE_PINS_PATH && 'knowledge-pins not present in this layout' }, () => {
  const doc = JSON.parse(readFileSync(KNOWLEDGE_PINS_PATH, 'utf8'));
  assert.ok(doc.pins.length >= 4);
  const dormant = evaluate(doc, { requiredCapabilities: new Set(), now: NOW });
  assert.deepEqual(dormant.findings, [], dormant.findings.join('\n'));
  assert.equal(dormant.notices.length, doc.pins.length);
  const live = evaluate(doc, { requiredCapabilities: new Set([CAPABILITY]), now: NOW });
  assert.equal(live.findings.length, doc.pins.length, live.findings.join('\n'));
  assert.deepEqual(live.notices, []);
});

test('helpers: ageDays and isPlaceholder', () => {
  assert.equal(ageDays(daysAgo(5), NOW), 5);
  assert.equal(ageDays('not a date', NOW), null);
  assert.ok(isPlaceholder('ADOPT: the publisher') && isPlaceholder('adopt — fill in'));
  assert.ok(!isPlaceholder('docs/governance/knowledge-pins.json') && !isPlaceholder(null));
});

// ── run(): the mandatory-when-compiled contract, on a real tree ────────────────────────────────

/** A tmp repo, optionally with one governed change whose plan requires the capability. */
function repo({ requires = false, pins = null, files = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-pins-'));
  if (requires) {
    const base = join(dir, 'docs/governance/changes/CHG-1');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'change-envelope.json'), JSON.stringify({ change_id: 'CHG-1', current_state: 'in-delivery', control_plan: 'control-plan.json' }));
    writeFileSync(join(base, 'control-plan.json'), JSON.stringify({
      required_gates: ['assurance-cadence'], required_evidence: [],
      required_capabilities: { [CAPABILITY]: { required: true, institution_owned: true } },
    }));
  }
  if (pins) {
    mkdirSync(join(dir, 'docs/governance'), { recursive: true });
    writeFileSync(join(dir, 'docs/governance/knowledge-pins.json'), typeof pins === 'string' ? pins : JSON.stringify({ pins }));
  }
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '// a real job\n');
  }
  return dir;
}

test('INERT — no pins file and no compiled requirement: silent, and it says so rather than reporting a green', () => {
  const dir = repo();
  try {
    const r = run(dir, { now: NOW });
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.notices, []);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.equal(r.present, false);
  } finally { clean(dir); }
});

test('MANDATORY-WHEN-COMPILED — the absent file fails once a plan requires the capability, and names the change', () => {
  const dir = repo({ requires: true });
  try {
    const r = run(dir, { now: NOW });
    assert.equal(r.required, true);
    assert.equal(r.inert, false);
    assert.ok(r.findings.some((f) => /requires the knowledge_currency capability \[CHG-1\]/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() — a stale pin blocks in a repo that compiles the capability, and only NOTICES in one that does not', () => {
  const stale = [pin({ last_verified: daysAgo(400), max_age_days: 30 })];
  const live = repo({ requires: true, pins: stale });
  try {
    const r = run(live, { now: NOW });
    assert.ok(r.findings.some((f) => /KP-R07/.test(f)), r.findings.join('\n'));
  } finally { clean(live); }

  const dormant = repo({ pins: stale });
  try {
    const r = run(dormant, { now: NOW });
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.ok(r.notices.some((n) => /KP-R07/.test(n)));
    assert.equal(r.present, true);
    assert.equal(r.required, false);
  } finally { clean(dormant); }
});

test('run() — check_ref is resolved against the repo tree, not asserted', () => {
  const ok = repo({ requires: true, pins: [pin({ check_ref: 'scripts/standards-currency.mjs' })], files: ['scripts/standards-currency.mjs'] });
  try { assert.deepEqual(run(ok, { now: NOW }).findings, []); } finally { clean(ok); }

  const ghost = repo({ requires: true, pins: [pin({ check_ref: 'scripts/standards-currency.mjs' })] });
  try { assert.ok(run(ghost, { now: NOW }).findings.some((f) => /KP-R08/.test(f))); } finally { clean(ghost); }
});

test('run() — on a real tree, a mistyped required_by_capability fails instead of quietly excusing the pin', () => {
  const stale = pin({ last_verified: daysAgo(400), max_age_days: 30 });
  // The same stale row, once with a name the tree uses and once with a typo of it.
  const good = repo({ pins: [stale] });
  try {
    const r = run(good, { now: NOW });
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.ok(r.notices.some((n) => /KP-R07/.test(n)), 'a recognised, uncompiled capability is still dormant');
  } finally { clean(good); }

  const typo = repo({ pins: [pin({ ...stale, required_by_capability: 'knowledge_currency ' })] });
  try {
    const r = run(typo, { now: NOW });
    assert.ok(r.findings.some((f) => /KP-R10/.test(f)), r.findings.join('\n'));
    assert.ok(r.findings.some((f) => /KP-R07/.test(f)), 'the staleness the typo was hiding blocks');
  } finally { clean(typo); }
});

test('run() — an unparseable pins file is a finding, not a crash', () => {
  const dir = repo({ pins: '{ not json' });
  try { assert.ok(run(dir, { now: NOW }).findings.some((f) => /not valid JSON/.test(f))); } finally { clean(dir); }
});

test('requiringChanges names the changes whose plan carries the capability, and falls back to the family', () => {
  const dir = repo({ requires: true });
  try {
    assert.deepEqual(requiringChanges(aggregateRequirements(dir)), ['CHG-1']);
  } finally { clean(dir); }
  // A plan with no per-change capability record still names somebody, via the family it rides with.
  const agg = { changes: [{ change_id: 'CHG-9', families: ['assurance-cadence'], capabilities: {} }] };
  assert.deepEqual(requiringChanges(agg), ['CHG-9']);
});
