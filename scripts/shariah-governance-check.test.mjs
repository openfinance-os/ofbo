// Tests for the Shari'ah governance gate. Node built-in runner: `node --test`.
//
// Two halves, and the SILENT half matters more. Every rule is tested both ways — the failure it
// exists to catch, and the shape that must pass — but the load-bearing test is the inert one: a
// conventional adopter whose plans never compile `shariah_governance` must never see a finding
// from this file, even with a broken register sitting in the tree. A control that fires on
// somebody it does not govern is how a governance bundle stops being installable.
//
// Worked names are fictional throughout (Alpha Islamic Bank).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY,
  COMMITTEE_ROLE,
  DEFAULT_MINIMUM_MEMBERS,
  compositionFloor,
  evaluate,
  isPlaceholder,
  loadStructures,
  requiringChanges,
  run,
} from './shariah-governance-check.mjs';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────── */

const scholar = (n) => ({
  id: `issc-scholar-${n}`, kind: 'human', display: `Scholar ${n}`, roles: [COMMITTEE_ROLE],
  groups: ['second-line'], external: true, reconciliation_source: 'docs/governance/issc-register.json',
});
const REGISTRY = {
  identities: [
    scholar(1), scholar(2), scholar(3), scholar(4), scholar(5),
    { id: 'shariah-compliance-head', kind: 'human', roles: ['shariah-compliance'], groups: ['second-line'] },
    { id: 'shariah-audit-lead', kind: 'human', roles: ['shariah-audit'], groups: ['second-line'] },
    { id: 'agent-loom-delivery', kind: 'agent', roles: [], groups: ['builders'] },
  ],
  quorum: { [COMMITTEE_ROLE]: 3 },
};
const registryWith = (over) => ({ ...REGISTRY, ...over });

const seat = (n, over = {}) => ({
  identity_id: `issc-scholar-${n}`,
  hsa_approval_ref: `HSA/APP/2026/${100 + n}`,
  appointment_instrument: `AGM-RES-2026-0${n}`,
  appointment_date: '2026-01-15',
  ...over,
});
const REGISTER = {
  members: [seat(1), seat(2), seat(3), seat(4), seat(5)],
  scf: { lead_identity_id: 'shariah-compliance-head' },
  internal_audit: { lead_identity_id: 'shariah-audit-lead', outsourced: false },
  hsa_refs: ['HSA/CONST/2026/07'],
};
const registerWith = (over) => ({ ...REGISTER, ...over });

const RULINGS = {
  rulings: [
    { ruling_id: 'SR-0001', status: 'active', sharia_structures: ['Murabaha'], supersedes: null },
    { ruling_id: 'SR-0002', status: 'superseded', sharia_structures: ['Ijara'], supersedes: null },
    { ruling_id: 'SR-0003', status: 'active', sharia_structures: ['Ijara'], supersedes: 'SR-0002' },
    { ruling_id: 'SR-0004', status: 'withdrawn', sharia_structures: ['Tawarruq'], supersedes: null },
  ],
};

const check = (over = {}) => evaluate({ register: REGISTER, registry: REGISTRY, ...over });
const has = (findings, rule) => findings.some((f) => f.startsWith(`${rule}:`));

/* ── the shape that must pass ─────────────────────────────────────────────────────────────── */

test('a five-seat register that agrees with the registry passes clean', () => {
  const { findings, notices } = check({ rulings: RULINGS, structures: [{ label: 'murabaha.json', issc_decision_ref: 'SR-0001' }] });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('a clean register with NO structures tree passes, and says the join checked nothing', () => {
  // Not a failure and not a pass: the gate is honest about the half of its objective that had
  // nothing to work on. Silence here would read as coverage.
  const { findings, notices } = check();
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /NOT VERIFIED/);
});

/* ── SG-R01 — composition ─────────────────────────────────────────────────────────────────── */

const fourSeats = (over = {}) => ({
  register: registerWith({ members: [seat(1), seat(2), seat(3), seat(4)], ...over }),
  registry: registryWith({
    identities: REGISTRY.identities.filter((i) => i.id !== 'issc-scholar-5'),
    quorum: { [COMMITTEE_ROLE]: 3 },
  }),
});

test('SG-R01: a committee below the configured minimum is not the body its approvals name', () => {
  const { findings } = check(fourSeats());
  assert.ok(has(findings, 'SG-R01'), findings.join('\n'));
  const f = findings.find((x) => x.startsWith('SG-R01'));
  assert.match(f, /4 seats against a composition minimum of 5/);
  assert.equal(DEFAULT_MINIMUM_MEMBERS, 5);
  // HONESTY GRAMMAR: the gate counts seats against configured data. It may not tell an adopter in
  // some other market what their law permits — the old wording ("cannot lawfully sit") did.
  assert.doesNotMatch(f, /lawful|unlawful|legal/i, f);
  assert.match(f, /rules on no jurisdiction's law/);
});

/* ── SG-R01 — the floor is MOUNTED DATA with a shipped default, not a baked-in legal fact ─── */

test('compositionFloor: the shipped default applies where the register declares nothing, and says where it came from', () => {
  const floor = compositionFloor(REGISTER);
  assert.equal(floor.minimum, DEFAULT_MINIMUM_MEMBERS);
  assert.deepEqual(floor.findings, []);
  // The default's PROVENANCE is recorded and quoted back — a number in a finding with no regime
  // behind it is the market-specific rule stated as universal law that this indirection prevents.
  assert.match(floor.source, /shipped default/);
  assert.match(floor.source, /Shari'ah Governance Standard/);
});

test('SG-R01: a market whose regime sets the floor at three passes a three-seat register', () => {
  const three = registerWith({
    members: [seat(1), seat(2), seat(3)],
    minimum_members: 3,
    minimum_members_source: 'Shari\'ah governance regulation of the adopting market, 2025 edition, art. 4',
  });
  const registry = registryWith({
    identities: REGISTRY.identities.filter((i) => !['issc-scholar-4', 'issc-scholar-5'].includes(i.id)),
    quorum: { [COMMITTEE_ROLE]: 2 },
  });
  assert.deepEqual(check({ register: three, registry }).findings, []);
  // …and the gate still BITES below the configured floor.
  const two = { ...three, members: [seat(1), seat(2)] };
  const { findings } = check({
    register: two,
    registry: registryWith({ identities: registry.identities.filter((i) => i.id !== 'issc-scholar-3'), quorum: { [COMMITTEE_ROLE]: 2 } }),
  });
  assert.match(findings.find((f) => f.startsWith('SG-R01')), /2 seats against a composition minimum of 3 \(Shari'ah governance regulation of the adopting market/);
});

test('SG-R01: a raised floor is checked against, with no instrument demanded — raising your own bar needs no permission', () => {
  const { findings } = check({ register: registerWith({ minimum_members: 7 }) });
  assert.match(findings.find((f) => f.startsWith('SG-R01')), /5 seats against a composition minimum of 7 \(declared in the register\)/);
});

test('SG-R01: an override that LOWERS the shipped floor without naming its instrument does not take effect', () => {
  const { findings } = check(fourSeats({ minimum_members: 4 }));
  assert.ok(findings.some((f) => /minimum_members lowers the composition floor to 4 .* names no instrument/.test(f)), findings.join('\n'));
  // the shipped default stands, so the four-seat register is still short
  assert.ok(findings.some((f) => /4 seats against a composition minimum of 5 \(shipped default/.test(f)), findings.join('\n'));
  // …and naming the instrument is what makes it take effect.
  const sourced = check(fourSeats({ minimum_members: 4, minimum_members_source: 'the adopting market\'s Shari\'ah governance rulebook, 2024' }));
  assert.deepEqual(sourced.findings, [], sourced.findings.join('\n'));
});

test('SG-R01: a minimum_members that is not a whole number of seats is refused, and the default stands', () => {
  for (const bad of ['5', 4.5, 0, -1, true, null]) {
    const floor = compositionFloor({ minimum_members: bad });
    assert.equal(floor.minimum, DEFAULT_MINIMUM_MEMBERS, JSON.stringify(bad));
    if (bad === null) { assert.deepEqual(floor.findings, [], 'null reads as absent'); continue; }
    assert.match(floor.findings[0] || '', /not a whole number of seats/, JSON.stringify(bad));
  }
});

test('SG-R01: no members array at all', () => {
  const { findings } = check({ register: registerWith({ members: undefined }) });
  assert.ok(has(findings, 'SG-R01'));
  assert.ok(findings.some((f) => /no `members` array/.test(f)));
});

/* ── SG-R02 — the register and the registry may not disagree ──────────────────────────────── */

test('SG-R02: a seat that resolves to nobody', () => {
  const { findings } = check({ register: registerWith({ members: [seat(1), seat(2), seat(3), seat(4), seat(5, { identity_id: 'scholar-nobody' })] }) });
  assert.ok(findings.some((f) => /SG-R02: seat scholar-nobody does not resolve/.test(f)), findings.join('\n'));
  // …and the scholar left behind in the registry is a SHADOW SCHOLAR, reported separately.
  assert.ok(has(findings, 'SG-R05'));
});

test('SG-R02: a seat held by an agent — a committee seat is a person', () => {
  const registry = registryWith({
    identities: [...REGISTRY.identities.filter((i) => i.id !== 'issc-scholar-5'),
      { id: 'issc-scholar-5', kind: 'agent', roles: [COMMITTEE_ROLE], groups: ['builders'] }],
  });
  const { findings } = check({ registry });
  assert.ok(findings.some((f) => /SG-R02: seat issc-scholar-5 is an agent identity/.test(f)), findings.join('\n'));
});

test('SG-R02: a seated human who does not hold the committee role in the registry', () => {
  const registry = registryWith({
    identities: REGISTRY.identities.map((i) => (i.id === 'issc-scholar-3' ? { ...i, roles: ['compliance'] } : i)),
    quorum: { [COMMITTEE_ROLE]: 3 },
  });
  const { findings } = check({ registry });
  assert.ok(findings.some((f) => /SG-R02: seat issc-scholar-3 does not hold shariah-committee/.test(f)), findings.join('\n'));
});

test('SG-R02: one person on two seats is a committee of four wearing five names', () => {
  const { findings } = check({ register: registerWith({ members: [seat(1), seat(2), seat(3), seat(4), seat(4)] }) });
  assert.ok(findings.some((f) => /SG-R02: issc-scholar-4 occupies two seats/.test(f)), findings.join('\n'));
  assert.ok(has(findings, 'SG-R05'), 'and scholar 5 is now unseated');
});

test('SG-R02: a seat with no identity_id at all', () => {
  const { findings } = check({ register: registerWith({ members: [seat(1), seat(2), seat(3), seat(4), seat(5, { identity_id: '' })] }) });
  assert.ok(findings.some((f) => /SG-R02: a seat names no identity_id/.test(f)), findings.join('\n'));
});

test('SG-R02: no identity registry at all — names that resolve to nothing are free text', () => {
  const { findings } = check({ registry: null });
  assert.ok(findings.some((f) => /SG-R02: no identity registry/.test(f)), findings.join('\n'));
  assert.ok(!has(findings, 'SG-R04'), 'quorum is not reported against a registry that is not there');
  assert.ok(!has(findings, 'SG-R05'));
});

/* ── SG-R03 — provenance, and the untouched template ──────────────────────────────────────── */

test('SG-R03: each provenance field is required on every seat', () => {
  for (const field of ['hsa_approval_ref', 'appointment_instrument', 'appointment_date']) {
    const { findings } = check({ register: registerWith({ members: [seat(1, { [field]: '' }), seat(2), seat(3), seat(4), seat(5)] }) });
    assert.ok(findings.some((f) => new RegExp(`SG-R03: seat issc-scholar-1 carries no ${field}`).test(f)), `${field}: ${findings.join('\n')}`);
  }
});

test('SG-R03: an unreplaced ADOPT marker is not an appointment', () => {
  const { findings } = check({ register: registerWith({ members: [seat(1, { hsa_approval_ref: 'ADOPT: the approval reference' }), seat(2), seat(3), seat(4), seat(5)] }) });
  assert.ok(findings.some((f) => /SG-R03: seat issc-scholar-1: hsa_approval_ref is still an adoption marker/.test(f)), findings.join('\n'));
});

test('isPlaceholder catches the marker forms the templates use, and nothing that merely looks like one', () => {
  for (const v of ['ADOPT: a reference', 'ADOPT-0001', 'TBD', 'TODO', 'n/a', '<ruling-id>', 'none']) assert.ok(isPlaceholder(v), v);
  for (const v of ['HSA/APP/2026/101', 'adopted-instrument', '2026-01-15', 'SR-0001']) assert.ok(!isPlaceholder(v), v);
});

/* ── SG-R04 — quorum ──────────────────────────────────────────────────────────────────────── */

test('SG-R04: no declared quorum means one scholar speaks for the committee', () => {
  const { findings } = check({ registry: registryWith({ quorum: undefined }) });
  assert.ok(findings.some((f) => /SG-R04: the identity registry declares no quorum/.test(f)), findings.join('\n'));
});

test('SG-R04: a quorum below a majority of the seats', () => {
  for (const k of [1, 2]) {
    const { findings } = check({ registry: registryWith({ quorum: { [COMMITTEE_ROLE]: k } }) });
    assert.ok(findings.some((f) => /SG-R04: the quorum for shariah-committee is \d+ of 5 seats; a majority is 3/.test(f)), `k=${k}: ${findings.join('\n')}`);
  }
});

test('SG-R04: a quorum larger than the number of holders is an outage wearing rigour', () => {
  const { findings } = check({ registry: registryWith({ quorum: { [COMMITTEE_ROLE]: 6 } }) });
  assert.ok(findings.some((f) => /only 5 human identities hold the role/.test(f)), findings.join('\n'));
});

test('SG-R04: a majority quorum, and a raised one, both pass', () => {
  for (const k of [3, 4, 5]) {
    const { findings } = check({ registry: registryWith({ quorum: { [COMMITTEE_ROLE]: k } }) });
    assert.deepEqual(findings, [], `k=${k}: ${findings.join('\n')}`);
  }
});

/* ── SG-R05 — the shadow scholar ──────────────────────────────────────────────────────────── */

test('SG-R05: a registry holder with no seat can sign approvals from outside the disclosed body', () => {
  const registry = registryWith({ identities: [...REGISTRY.identities, scholar(6)] });
  const { findings } = check({ registry });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0], /SG-R05: issc-scholar-6 holds shariah-committee .* occupies no seat/);
});

/* ── SG-R06 — internal Shari'ah audit may not be outsourced ───────────────────────────────── */

test('SG-R06: outsourced must be literally false', () => {
  for (const bad of [true, undefined, null, 'false', 'co-sourced', 0]) {
    const { findings } = check({ register: registerWith({ internal_audit: { lead_identity_id: 'shariah-audit-lead', outsourced: bad } }) });
    assert.ok(findings.some((f) => /SG-R06: internal_audit\.outsourced is /.test(f)), `${JSON.stringify(bad)}: ${findings.join('\n')}`);
  }
  assert.deepEqual(check().findings, [], 'and literal false passes');
});

test('SG-R06: an external identity in the third-line slot is the outsourcing wearing a label', () => {
  const registry = registryWith({
    identities: REGISTRY.identities.map((i) => (i.id === 'shariah-audit-lead'
      ? { ...i, external: true, reconciliation_source: 'docs/governance/issc-register.json' } : i)),
  });
  const { findings } = check({ registry });
  assert.ok(findings.some((f) => /SG-R06: internal_audit lead shariah-audit-lead is declared external:true/.test(f)), findings.join('\n'));
});

/* ── SG-R07 — the two standing desks ──────────────────────────────────────────────────────── */

test('SG-R07: a desk with no named head', () => {
  for (const [key, value] of [['scf', undefined], ['scf', 'ADOPT: the SCF head'], ['internal_audit', '']]) {
    const block = key === 'scf' ? { scf: { lead_identity_id: value } } : { internal_audit: { lead_identity_id: value, outsourced: false } };
    const { findings } = check({ register: registerWith(block) });
    assert.ok(findings.some((f) => new RegExp(`SG-R07: ${key}\\.lead_identity_id names nobody`).test(f)), `${key}/${value}: ${findings.join('\n')}`);
  }
});

test('SG-R07: a head who does not resolve, or does not hold the role, or is an agent', () => {
  const missing = check({ register: registerWith({ scf: { lead_identity_id: 'nobody' } }) });
  assert.ok(missing.findings.some((f) => /SG-R07: scf lead nobody does not resolve/.test(f)));

  const wrongRole = check({ register: registerWith({ scf: { lead_identity_id: 'shariah-audit-lead' } }) });
  assert.ok(wrongRole.findings.some((f) => /SG-R07: scf lead shariah-audit-lead does not hold shariah-compliance/.test(f)), wrongRole.findings.join('\n'));

  const agent = check({ register: registerWith({ internal_audit: { lead_identity_id: 'agent-loom-delivery', outsourced: false } }) });
  assert.ok(agent.findings.some((f) => /SG-R07: internal_audit lead agent-loom-delivery is an agent identity/.test(f)), agent.findings.join('\n'));
});

/* ── SG-R08 — the two-registers join ──────────────────────────────────────────────────────── */

const structure = (over = {}) => ({ label: 'murabaha-consumer.json', issc_decision_ref: 'SR-0001', ...over });

test('SG-R08: a structure bound to an ACTIVE ruling passes', () => {
  const { findings, notices } = check({ rulings: RULINGS, structures: [structure()] });
  assert.deepEqual(findings, [], findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('SG-R08: a citation that resolves to no ruling at all', () => {
  const { findings } = check({ rulings: RULINGS, structures: [structure({ issc_decision_ref: 'SR-9999' })] });
  assert.ok(findings.some((f) => /SG-R08: structure murabaha-consumer\.json cites ISSC decision "SR-9999", which is no ruling_id/.test(f)), findings.join('\n'));
});

test('SG-R08: superseded names its replacement; withdrawn leaves nothing behind', () => {
  const sup = check({ rulings: RULINGS, structures: [structure({ label: 'ijara-auto.json', issc_decision_ref: 'SR-0002' })] });
  assert.ok(sup.findings.some((f) => /status is "superseded".*SR-0003 replaces it/s.test(f)), sup.findings.join('\n'));

  const wd = check({ rulings: RULINGS, structures: [structure({ label: 'tawarruq-cash.json', issc_decision_ref: 'SR-0004' })] });
  assert.ok(wd.findings.some((f) => /status is "withdrawn".*Nothing in the register replaces it/s.test(f)), wd.findings.join('\n'));
});

test('SG-R08: a structure citing nothing is an implementation of nobody\'s decision', () => {
  for (const ref of [undefined, '', '   ', 'ADOPT: the ruling id', 'TBD']) {
    const { findings } = check({ rulings: RULINGS, structures: [structure({ issc_decision_ref: ref })] });
    assert.ok(findings.some((f) => /SG-R08: structure murabaha-consumer\.json names no issc_decision_ref/.test(f)), `${JSON.stringify(ref)}: ${findings.join('\n')}`);
  }
});

test('SG-R08: an absent rulings register is NOT VERIFIED — a notice, never a silent pass', () => {
  const { findings, notices } = check({ rulings: null, structures: [structure(), structure({ label: 'b.json' })] });
  assert.deepEqual(findings, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /NOT VERIFIED: 2 structure entries cite an ISSC decision/);
});

test('SG-R08: an unreadable structure file is not a bound one', () => {
  const { findings } = check({ rulings: RULINGS, structures: [{ label: 'broken.json', unreadable: true }] });
  assert.ok(findings.some((f) => /SG-R08: structure broken\.json is not readable JSON/.test(f)));
});

test('SG-R08: an unreadable entry is reported even when the rulings register is absent', () => {
  // The join used to be skipped wholesale when there were no rulings, so an unparseable structure
  // file went unmentioned. Being unable to resolve a citation is not a reason to stop reporting
  // that a file could not be read at all.
  const { findings } = check({ rulings: null, structures: [{ label: 'broken.json', unreadable: true }] });
  assert.ok(findings.some((f) => /SG-R08: structure broken\.json is not readable JSON/.test(f)), findings.join('\n'));
});

test('SG-R08: a shape the gate does not read is a FINDING, never a silent skip', () => {
  const { findings } = check({ rulings: RULINGS, structures: [{ label: 'odd.json', malformed: 'the file is a top-level number, not a structure object or an array of them' }] });
  assert.ok(findings.some((f) => /SG-R08: structure entry odd\.json is not a shape this gate reads/.test(f)), findings.join('\n'));
});

test('SG-R08: nothing to join is NOT VERIFIED — the objective claims a binding an empty tree does not supply', () => {
  // The catalogued objective ends "…every projected product structure is bound to an ACTIVE
  // ruling". With no structures the join covers nothing, and silence there reads as coverage.
  const absent = check({ rulings: RULINGS, structures: null });
  assert.deepEqual(absent.findings, []);
  assert.equal(absent.notices.length, 1);
  assert.match(absent.notices[0], /NOT VERIFIED: there is no docs\/governance\/shariah-structures\/ tree/);
  assert.match(absent.notices[0], /not a pass/);

  const empty = check({ rulings: null, structures: [] });
  assert.equal(empty.notices.length, 1);
  assert.match(empty.notices[0], /NOT VERIFIED: docs\/governance\/shariah-structures\/ projects no structure entries/);
});

test('SG-R08: where every entry is already a finding, the empty-tree notice does not restate it', () => {
  const { findings, notices } = check({ rulings: RULINGS, structures: [{ label: 'broken.json', unreadable: true }] });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.deepEqual(notices, []);
});

test('SG-R08: a decision register that is not the shape every reader expects resolves nothing', () => {
  for (const rulings of [{ rulings: { 'SR-0001': {} } }, [{ ruling_id: 'SR-0001', status: 'active' }], { decisions: [] }]) {
    const { findings } = check({ rulings, structures: [structure()] });
    assert.ok(findings.some((f) => /SG-R08: docs\/governance\/shariah-rulings\.json carries no `rulings` array/.test(f)), `${JSON.stringify(rulings)}: ${findings.join('\n')}`);
  }
});

/* ── loadStructures — both shapes an adopter reaches for ──────────────────────────────────── */

const tmp = () => mkdtempSync(join(tmpdir(), 'shariah-gov-'));
const clean = (d) => rmSync(d, { recursive: true, force: true });
const put = (dir, rel, doc) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
};

test('loadStructures reads one-file-per-structure, a structures array, and skips comment-only files', () => {
  const dir = tmp();
  try {
    put(dir, 'docs/governance/shariah-structures/murabaha.json', { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' });
    put(dir, 'docs/governance/shariah-structures/bundle.json', { structures: [{ issc_decision_ref: 'SR-0003' }, { structure_id: 'STR-03', issc_decision_ref: 'SR-0001' }] });
    put(dir, 'docs/governance/shariah-structures/_README.json', { _comment: 'a header is not a structure' });
    put(dir, 'docs/governance/shariah-structures/broken.json', '{ not json');
    put(dir, 'docs/governance/shariah-structures/notes.md', 'ignored');
    const rows = loadStructures(dir);
    assert.deepEqual(rows.map((r) => r.label), ['broken.json', 'bundle.json#0', 'STR-03', 'STR-01']);
    assert.equal(rows.find((r) => r.label === 'broken.json').unreadable, true);
    assert.equal(rows.find((r) => r.label === 'STR-01').issc_decision_ref, 'SR-0001');
  } finally { clean(dir); }
});

test('loadStructures reads a file written as a TOP-LEVEL JSON ARRAY — the third shape adopters write', () => {
  // The defect: `Array.isArray(doc.structures) ? doc.structures : [doc]` put the ARRAY ITSELF in
  // the row list, where it has no issc_decision_ref and every entry inside it vanished. A tree of
  // unchecked structures was then reported as a checked one.
  const dir = tmp();
  try {
    put(dir, 'docs/governance/shariah-structures/bundle.json', [
      { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' },
      { issc_decision_ref: 'SR-9999' },
    ]);
    const rows = loadStructures(dir);
    assert.deepEqual(rows.map((r) => r.label), ['STR-01', 'bundle.json#1']);
    assert.deepEqual(rows.map((r) => r.issc_decision_ref), ['SR-0001', 'SR-9999']);
    // and the join then actually sees the bad citation
    const { findings } = check({ rulings: RULINGS, structures: rows });
    assert.ok(findings.some((f) => /structure bundle\.json#1 cites ISSC decision "SR-9999"/.test(f)), findings.join('\n'));
  } finally { clean(dir); }
});

test('loadStructures marks a shape it cannot read rather than dropping it', () => {
  const dir = tmp();
  try {
    put(dir, 'docs/governance/shariah-structures/scalar.json', '"just a string"');
    put(dir, 'docs/governance/shariah-structures/nulled.json', 'null');
    put(dir, 'docs/governance/shariah-structures/nested.json', { structures: ['STR-07', 42] });
    const rows = loadStructures(dir);
    assert.deepEqual(rows.map((r) => r.label), ['nested.json#0', 'nested.json#1', 'nulled.json', 'scalar.json']);
    for (const r of rows) assert.ok(r.malformed || r.unreadable, JSON.stringify(r));
    assert.match(rows.find((r) => r.label === 'scalar.json').malformed, /top-level string/);
    assert.match(rows.find((r) => r.label === 'nested.json#1').malformed, /entry 1 is 42, not a structure object/);
  } finally { clean(dir); }
});

test('loadStructures reports a structures location that is not a listable directory', () => {
  const dir = tmp();
  try {
    put(dir, 'docs/governance/shariah-structures', { structure_id: 'STR-01' });
    const rows = loadStructures(dir);
    assert.equal(rows.length, 1);
    assert.match(rows[0].malformed, /cannot be listed/);
  } finally { clean(dir); }
});

test('loadStructures returns null — not an empty tree — where the repository has no structures', () => {
  const dir = tmp();
  try { assert.equal(loadStructures(dir), null); } finally { clean(dir); }
});

/* ── malformed governance JSON is ordinary — a stack trace is fail-closed and useless ─────── */

test('a malformed identity registry produces a finding, not a crash', () => {
  const cases = [
    ['identities is not an array', registryWith({ identities: { 'issc-scholar-1': {} } }), /carries no `identities` array/],
    ['an entry that is not an object', registryWith({ identities: [...REGISTRY.identities, null, 'issc-scholar-9'] }), /2 entries that are not an identity object/],
    ['a roles field that is not a list', registryWith({
      identities: REGISTRY.identities.map((i) => (i.id === 'issc-scholar-2' ? { ...i, roles: { [COMMITTEE_ROLE]: true } } : i)),
    }), /identity issc-scholar-2 carries a `roles` field that is not an array/],
  ];
  for (const [what, registry, expected] of cases) {
    const { findings } = check({ registry });
    assert.ok(findings.some((f) => expected.test(f)), `${what}: ${findings.join('\n')}`);
    for (const f of findings) assert.match(f, /^SG-R\d\d: /, what);
  }
});

test('a malformed register produces findings, not a crash', () => {
  for (const members of [['issc-scholar-1', 'issc-scholar-2'], [null, 42], [[]]]) {
    const { findings } = check({ register: registerWith({ members }) });
    assert.ok(findings.length > 0, JSON.stringify(members));
    assert.ok(has(findings, 'SG-R01') || has(findings, 'SG-R02') || has(findings, 'SG-R03'), findings.join('\n'));
  }
});

/* ── run(): mandatory-when-compiled, end to end off a real tree ───────────────────────────── */

function repo({ requires = true, register = REGISTER, registry = REGISTRY, rulings = null, structures = null, state = 'in-delivery' } = {}) {
  const dir = tmp();
  const base = 'docs/governance/changes/CHG-ALPHA-0007';
  put(dir, `${base}/change-envelope.json`, { change_id: 'CHG-ALPHA-0007', current_state: state, control_plan: 'control-plan.json' });
  put(dir, `${base}/control-plan.json`, {
    required_gates: [], required_evidence: [],
    required_capabilities: requires ? { [CAPABILITY]: { required: true } } : {},
  });
  if (registry) put(dir, 'docs/governance/identities.json', registry);
  if (register) put(dir, 'docs/governance/issc-register.json', register);
  if (rulings) put(dir, 'docs/governance/shariah-rulings.json', rulings);
  for (const [name, doc] of Object.entries(structures || {})) put(dir, `docs/governance/shariah-structures/${name}`, doc);
  return dir;
}

test('run() is INERT for an adopter whose plans never compile the capability — even with a broken register', () => {
  const dir = repo({ requires: false, register: { members: [], internal_audit: { outsourced: true } } });
  try {
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.equal(r.required, false);
    assert.deepEqual(r.findings, [], 'a generic adopter must never be failed by a Shari\'ah control');
    assert.deepEqual(r.notices, []);
  } finally { clean(dir); }
});

test('run() names the change that made the register mandatory when it is absent', () => {
  const dir = repo({ register: null });
  try {
    const r = run(dir);
    assert.equal(r.required, true);
    assert.equal(r.present, false);
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0], /SG-R00: a compiled plan requires the shariah_governance capability \[CHG-ALPHA-0007\]/);
  } finally { clean(dir); }
});

test('run() passes on a complete tree, structures joined to active rulings', () => {
  const dir = repo({ rulings: RULINGS, structures: { 'murabaha.json': { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' } } });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.deepEqual(r.notices, []);
    assert.equal(r.members, 5);
    assert.equal(r.inert, false);
  } finally { clean(dir); }
});

test('run() reports the join as NOT VERIFIED where structures exist and the decision register does not', () => {
  const dir = repo({ structures: { 'murabaha.json': { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' } } });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.notices.length, 1);
    assert.match(r.notices[0], /NOT VERIFIED/);
  } finally { clean(dir); }
});

test('run() refuses an unreadable composition register, and an unreadable decision register', () => {
  const bad = repo({ register: null });
  try {
    put(bad, 'docs/governance/issc-register.json', '{ not json');
    const r = run(bad);
    assert.ok(r.findings.some((f) => /SG-R00: .* not valid JSON/.test(f)), r.findings.join('\n'));
  } finally { clean(bad); }

  const dir = repo({ structures: { 'murabaha.json': { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' } } });
  try {
    put(dir, 'docs/governance/shariah-rulings.json', '{ not json');
    const r = run(dir);
    assert.ok(r.findings.some((f) => /SG-R08: .*shariah-rulings\.json is present but is not valid JSON/.test(f)), r.findings.join('\n'));
  } finally { clean(dir); }
});

test('run() refuses an unreadable identity registry instead of throwing out of the gate', () => {
  const dir = repo({ structures: { 'murabaha.json': { structure_id: 'STR-01', issc_decision_ref: 'SR-0001' } } });
  try {
    put(dir, 'docs/governance/identities.json', '{ "identities": [ , ] }');
    const r = run(dir);
    assert.ok(r.findings.some((f) => /SG-R02: the identity registry is present but is not valid JSON/.test(f)), r.findings.join('\n'));
    assert.equal(r.findings.filter((f) => /^SG-R02: no identity registry/.test(f)).length, 0, 'one cause, one finding');
  } finally { clean(dir); }
});

test('run() reports the join as NOT VERIFIED where the repository projects no structures at all', () => {
  const dir = repo({ rulings: RULINGS });
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, [], r.findings.join('\n'));
    assert.equal(r.notices.length, 1);
    assert.match(r.notices[0], /NOT VERIFIED: there is no docs\/governance\/shariah-structures\/ tree/);
  } finally { clean(dir); }
});

test('run() stays inert for a change whose plan requires some OTHER capability', () => {
  const dir = tmp();
  try {
    const base = 'docs/governance/changes/CHG-MERIDIAN-0001';
    put(dir, `${base}/change-envelope.json`, { change_id: 'CHG-MERIDIAN-0001', current_state: 'in-delivery', control_plan: 'control-plan.json' });
    put(dir, `${base}/control-plan.json`, { required_capabilities: { exposure_control: { required: true } } });
    const r = run(dir);
    assert.equal(r.inert, true);
    assert.deepEqual(r.findings, []);
  } finally { clean(dir); }
});

test('requiringChanges names only the changes that asked for the capability', () => {
  const agg = { changes: [
    { change_id: 'CHG-ALPHA-0007', capabilities: { [CAPABILITY]: { required: true } } },
    { change_id: 'CHG-MERIDIAN-0001', capabilities: { exposure_control: { required: true } } },
    { change_id: 'CHG-ALPHA-0009', capabilities: {} },
  ] };
  assert.deepEqual(requiringChanges(agg), ['CHG-ALPHA-0007']);
});

/* ── the shipped templates must not read as a decision ────────────────────────────────────── */

const TEMPLATE = [`${H}/governance/issc-register.template.json`, `${H}/../governance/issc-register.template.json`].find(existsSync);
const IDENTITIES = [`${H}/governance/identities.template.json`, `${H}/docs/governance/identities.json`].find(existsSync);

test('the untouched ISSC register template fails on PROVENANCE ONLY — the composition it ships is sound',
  { skip: !(TEMPLATE && IDENTITIES) && 'templates not present in this layout' }, () => {
    const register = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
    const registry = JSON.parse(readFileSync(IDENTITIES, 'utf8'));
    const { findings } = evaluate({ register, registry });
    // Every finding is SG-R03: the five seats, the quorum, the two desks and the outsourcing flag
    // are all shipped correct — what an adopter must supply is the appointment provenance, and
    // until they do, the template must NOT read as an appointed committee.
    assert.ok(findings.length > 0, 'an untouched template that passes is a template that appoints a committee');
    for (const f of findings) assert.match(f, /^SG-R03:/, findings.join('\n'));
    assert.equal(findings.length, register.members.length * 3);
  });
