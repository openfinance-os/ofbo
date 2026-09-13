// Tests for the approval-surface gate (Factory Floor WS5 · D5.1 + D5.4). Node built-in runner.
//
// Two controls, and for each the negative that would pass if the control were absent:
//
//   - THE BANNER. A catalog-B form whose routing note has slid below the fold would pass any
//     whole-file grep, and would still be a form whose author learns — after writing — that the
//     page they filled in decided nothing. That case has a test of its own, as it does in
//     `scripts/floor-only-check.test.mjs`, because it is the same mistake in a new catalog.
//   - THE MIRROR. A renamed, reordered or quietly dropped section reads perfectly well to whoever
//     is filling the form in. Nothing on the floor can tell them the record they are producing is
//     missing what its gate reads; only the comparison with the git template can, which is why the
//     absence of a `mirrors` declaration is itself a finding rather than a reason to skip.
//
// The surface half (D5.1) is exercised here at the pairing level — surface found, plan found, the
// two checked against each other. The rules themselves are tested in
// `core/floor-approval-surface.test.mjs`.
//
// Every fixture value is synthetic and fabricated for this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveApprovalSurface } from '../core/floor-approval-surface.mjs';
import { frontmatterOf } from './floor-only-check.mjs';
import {
  BANNER_REQUIREMENTS,
  CATALOG_DIR,
  SURFACE_DIR,
  checkForm,
  evaluate,
  loadPlans,
  mirrorDrift,
  run,
} from './approval-surface-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIRROR = `---
artifact: fixture-record
stage: deliver
---

# Fixture record — <FR-nnnn>

> Deliver. A decision the build loop may not make for itself.

## Context

> What forces the decision now.

## Options considered

- **What it is:**
- **Costs:**

## Compliance notes

| Control / gate | How this decision affects it |
|---|---|
| | |
`;

const BANNER = [
  '> ## 🔀 WRITE CLASS · `decision-routed` — WRITTEN HERE, DECIDED IN GIT',
  '>',
  "> **NON-AUTHORITATIVE · DECLARED, NOT ACTIVE.** WS5's entry gate has not passed.",
  '>',
  '> A floor-keeper carries this card into the repository as a **signed envelope**, and a human',
  '> with architecture authority merges the pull request.',
  '>',
  '> It mirrors `delivery/templates/fixture-record.md`, section for section.',
].join('\n');

const FORM = `---
artifact: fixture-card
catalog: B
write_class: decision-routed
mirrors: delivery/templates/fixture-record.md
floor_only: Inbox routing
stage: deliver
---

# Fixture card — <FR-nnnn>

${BANNER}

## Inbox routing

- **Blocked story:** <backlog item id>

## Context

> What forces the decision now, in the author's own words.

## Options considered

- **What it is:**
- **Costs:**

## Compliance notes

| Control / gate | How this decision affects it |
|---|---|
| | |
`;

const PLAN = {
  change_id: 'CHG-FIXTURE-0002',
  risk_tier: 'medium',
  plan_hash: 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
  required_gates: ['PA1', 'PA2'],
  required_approver_roles: ['engineering', 'product-owner', 'risk-second-line'],
  pa1_approver_roles: [],
};

const codes = (findings) => findings.map((f) => f.slice(0, 6));
const form = (text = FORM, mirror = MIRROR) => [{ name: 'fixture-card.md', text, mirror }];
const surfaceFor = (stage = 'PA1', plan = PLAN) => deriveApprovalSurface(plan, { stage }).surface;


// TIER-AWARE (rc.24): this asserts properties of content that a `core` or `governed` adoption
// deliberately does not install. Absent content is not a failing test — it is a tier boundary — so
// these skip cleanly, the same "inert where absent" pattern the doc-integrity gate uses.
const CATALOG_B_PRESENT = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'floor/catalog-b'));

// ---------------------------------------------------------------------------------------------
// The suite as shipped.
// ---------------------------------------------------------------------------------------------

test('the catalog-B suite that ships in this bundle passes its own gate', { skip: !CATALOG_B_PRESENT && 'floor/catalog-b not installed at this tier' }, () => {
  const r = run(HARNESS);
  assert.deepEqual(r.findings, []);
  assert.ok(r.forms >= 2, `expected the shipped ADR inbox card and SDR flow, saw ${r.forms} forms`);
});

test('every shipped catalog-B form mirrors a template that exists, and says so in its banner', { skip: !CATALOG_B_PRESENT && 'floor/catalog-b not installed at this tier' }, () => {
  for (const name of readdirSync(join(HARNESS, CATALOG_DIR)).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(HARNESS, CATALOG_DIR, name), 'utf8');
    const fm = frontmatterOf(text);
    assert.equal(fm.write_class, 'decision-routed', name);
    assert.equal(fm.catalog, 'B', name);
    assert.match(fm.mirrors, /^delivery\/templates\/.+\.md$/, name);
    const mirror = readFileSync(join(HARNESS, fm.mirrors), 'utf8');
    assert.deepEqual(checkForm(name, text, mirror), [], name);
  }
});

test('the shipped forms cover both of D5.4\'s artifacts — the ADR inbox card and the SDR flow', { skip: !CATALOG_B_PRESENT && 'floor/catalog-b not installed at this tier' }, () => {
  const mirrored = readdirSync(join(HARNESS, CATALOG_DIR))
    .filter((n) => n.endsWith('.md'))
    .map((n) => frontmatterOf(readFileSync(join(HARNESS, CATALOG_DIR, n), 'utf8')).mirrors);
  assert.ok(mirrored.includes('delivery/templates/adr.md'), mirrored.join(' · '));
  assert.ok(mirrored.includes('delivery/templates/solution-direction-record.md'), mirrored.join(' · '));
});

test('the fixture form passes, so every failure below is the mutation and not the fixture', () => {
  assert.deepEqual(evaluate({ forms: form() }).findings, []);
});

// ---------------------------------------------------------------------------------------------
// Control 1 · the banner.
// ---------------------------------------------------------------------------------------------

test('AS-R12 — a form with no banner at all is refused, as ONE finding naming every part', () => {
  const f = checkForm('fixture-card.md', FORM.replace(`${BANNER}\n\n`, ''), MIRROR);
  assert.deepEqual(codes(f), ['AS-R12'], 'a missing banner is one thing to fix, not four defects');
  assert.match(f[0], /no banner at all/);
  for (const r of BANNER_REQUIREMENTS) assert.ok(f[0].includes(r.want), r.id);
});

test('AS-R12 — a banner that does not name the write class, or does not say WS5 is not live', () => {
  for (const [from, to, want] of [
    ['`decision-routed`', '`floor-authored`', /named exactly: `decision-routed`/],
    ['**NON-AUTHORITATIVE · DECLARED, NOT ACTIVE.**', 'A note on status.', /in capitals: NON-AUTHORITATIVE/],
  ]) {
    const f = checkForm('fixture-card.md', FORM.replace(from, to), MIRROR);
    assert.deepEqual(codes(f), ['AS-R12'], f.join(' · '));
    assert.match(f[0], want);
  }
});

test('AS-R13 — a banner that never says how the decision becomes real is refused', () => {
  const noEnvelope = FORM.replace('as a **signed envelope**, and a human', 'for filing, and a human');
  const f = checkForm('fixture-card.md', noEnvelope, MIRROR);
  assert.deepEqual(codes(f), ['AS-R13']);
  assert.match(f[0], /reads like a filing location/);

  const noHuman = FORM
    .replace('and a human\n> with architecture authority merges the pull request.', 'and it is merged automatically.');
  const g = checkForm('fixture-card.md', noHuman, MIRROR);
  assert.deepEqual(codes(g), ['AS-R13']);
  assert.match(g[0], /wait for a robot that is not coming/);
});

// THE ONE. A whole-file grep would find the routing note and pass. It is only a control where the
// author already is, so the check reads the leading block and nothing else.
test('AS-R13 — a routing note pushed below the fold is refused, not credited', () => {
  const moved = `${FORM
    .replace('> A floor-keeper carries this card into the repository as a **signed envelope**, and a human\n> with architecture authority merges the pull request.\n>\n', '')}
## How this reaches the record

A floor-keeper carries this card into the repository as a **signed envelope**, and a human with
architecture authority merges the pull request.
`;
  assert.match(moved, /signed envelope/, 'the fixture must still contain the note somewhere, or this proves nothing');
  const f = checkForm('fixture-card.md', moved, MIRROR);
  assert.ok(f.some((x) => x.startsWith('AS-R13') && /too late: an author meets it after writing, not before/.test(x)), f.join(' · '));
});

test('AS-R11 — a form that does not declare catalog B or its write class is refused', () => {
  for (const [from, to, want] of [
    ['catalog: B', 'catalog: C', /not "B"/],
    ['write_class: decision-routed', 'write_class: born-on-the-floor', /promises the author nothing/],
    ['catalog: B\n', ''], // absent entirely
  ]) {
    const f = checkForm('fixture-card.md', FORM.replace(from, to), MIRROR);
    assert.ok(f.some((x) => x.startsWith('AS-R11')), f.join(' · '));
    if (want) assert.ok(f.some((x) => want.test(x)), f.join(' · '));
  }
});

test('AS-R11 — an empty or unreadable form is one finding, not a parse crash', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const f = checkForm('fixture-card.md', bad, MIRROR);
    assert.deepEqual(codes(f), ['AS-R11']);
  }
});

// ---------------------------------------------------------------------------------------------
// Control 2 · the mirror.  THE ONE: a form that reads perfectly well and produces a broken record.
// ---------------------------------------------------------------------------------------------

test('AS-R14 — a form that will not name the template it mirrors cannot be checked, so it fails', () => {
  const f = checkForm('fixture-card.md', FORM.replace('mirrors: delivery/templates/fixture-record.md\n', ''), MIRROR);
  assert.deepEqual(codes(f), ['AS-R14']);
  assert.match(f[0], /cannot be kept in step with it/);
});

test('AS-R14 — a mirror path that escapes the repository is refused', () => {
  for (const path of ['../../elsewhere/adr.md', '/etc/adr.md']) {
    const f = checkForm('fixture-card.md', FORM.replace('delivery/templates/fixture-record.md', path), MIRROR);
    assert.ok(f.some((x) => x.startsWith('AS-R14') && /escapes the repository/.test(x)), f.join(' · '));
  }
});

test('AS-R14 — a mirror named in frontmatter but missing from the tree is a broken pair', () => {
  const f = checkForm('fixture-card.md', FORM, null);
  assert.deepEqual(codes(f), ['AS-R14']);
  assert.match(f[0], /broken, not merely stale/);
});

test('AS-R14 — frontmatter is for the gate; the author must be able to see it in the banner', () => {
  const f = checkForm('fixture-card.md', FORM.replace('> It mirrors `delivery/templates/fixture-record.md`, section for section.\n', ''), MIRROR);
  assert.deepEqual(codes(f), ['AS-R14']);
  assert.match(f[0], /the banner does not name/);
});

test('AS-R15 — a renamed section is refused, and the finding shows both lists', () => {
  const f = checkForm('fixture-card.md', FORM.replace('## Options considered', '## Options we looked at'), MIRROR);
  assert.deepEqual(codes(f), ['AS-R15']);
  assert.match(f[0], /the section list has drifted/);
  assert.match(f[0], /"Options we looked at"/);
  assert.match(f[0], /"Options considered"/);
});

test('AS-R15 — a dropped section, an added one, and a reordered pair are each refused', () => {
  const dropped = FORM.replace(/## Compliance notes[\s\S]*$/, '');
  assert.deepEqual(codes(checkForm('fixture-card.md', dropped, MIRROR)), ['AS-R15']);

  const added = `${FORM}\n## A section of our own\n\n> Undeclared.\n`;
  const f = checkForm('fixture-card.md', added, MIRROR);
  assert.deepEqual(codes(f), ['AS-R15']);
  assert.match(f[0], /must be declared in its `floor_only` frontmatter/);

  const swapped = FORM
    .replace('## Context\n\n> What forces the decision now, in the author\'s own words.\n\n', '')
    .replace('## Compliance notes', '## Context\n\n> Moved.\n\n## Compliance notes');
  assert.deepEqual(codes(checkForm('fixture-card.md', swapped, MIRROR)), ['AS-R15']);
});

test('AS-R15 — a table column dropped on the floor is a column the record will be missing', () => {
  const thinner = FORM
    .replace('| Control / gate | How this decision affects it |\n|---|---|\n| | |', '| Control / gate |\n|---|\n| |');
  const f = checkForm('fixture-card.md', thinner, MIRROR);
  assert.deepEqual(codes(f), ['AS-R15']);
  assert.match(f[0], /asks for a different shape/);
});

test('AS-R15 — a floor-only declaration cannot launder a mirrored section, or go stale', () => {
  const launder = FORM.replace('floor_only: Inbox routing', 'floor_only: Inbox routing, Compliance notes');
  const f = checkForm('fixture-card.md', launder, MIRROR);
  assert.ok(f.some((x) => /cannot be used to drop a section the record needs/.test(x)), f.join(' · '));

  const stale = FORM.replace('floor_only: Inbox routing', 'floor_only: Triage');
  const g = checkForm('fixture-card.md', stale, MIRROR);
  assert.ok(g.some((x) => /a stale declaration is how a renamed section stops being compared/.test(x)), g.join(' · '));
});

test('mirrorDrift is silent when the lists agree and the shapes match', () => {
  assert.deepEqual(mirrorDrift(FORM, MIRROR, new Set(['Inbox routing'])), []);
  // Without the floor-only declaration the same pair drifts — the declaration is load-bearing.
  assert.equal(mirrorDrift(FORM, MIRROR, new Set()).length, 1);
});

// ---------------------------------------------------------------------------------------------
// The surface half (D5.1): the pairing, not the rules.
// ---------------------------------------------------------------------------------------------

test('a derived surface paired with its plan passes the gate', () => {
  const r = evaluate({ surfaces: [{ name: 'CHG-FIXTURE-0002.PA1.json', surface: surfaceFor('PA1') }], plans: [{ change_id: PLAN.change_id, plan: PLAN }] });
  assert.deepEqual(r.findings, []);
  assert.equal(r.surfaces, 1);
  assert.equal(r.plans, 1);
});

test('AS-R10 — a surface naming a change no plan claims is refused, and still checked', () => {
  const surface = surfaceFor('PA1');
  const f = evaluate({ surfaces: [{ name: 'orphan.json', surface }], plans: [] }).findings;
  assert.deepEqual([...new Set(codes(f))], ['AS-R10', 'AS-R03']);
  assert.match(f[0], /no compiled control plan under docs\/governance\/changes names it/);
  assert.match(f[1], /cannot be checked against nothing/);
});

test('AS-R03 — a hand-drawn surface short of a compiled role fails through the gate too', () => {
  const surface = surfaceFor('PA2');
  surface.sections = surface.sections.filter((s) => s.role !== 'risk-second-line');
  surface.roles = surface.sections.map((s) => s.role);
  const f = evaluate({ surfaces: [{ name: 'pa2.json', surface }], plans: [{ change_id: PLAN.change_id, plan: PLAN }] }).findings;
  assert.ok(f.some((x) => x.startsWith('AS-R03') && /risk-second-line/.test(x)), f.join(' · '));
});

test('AS-R10 — a surface file that is not a JSON object is one finding, not a crash', () => {
  for (const surface of [null, 'a page', 7]) {
    assert.deepEqual(codes(evaluate({ surfaces: [{ name: 'x.json', surface }] }).findings), ['AS-R10']);
  }
});

// ---------------------------------------------------------------------------------------------
// run(): silent where unadopted, and real over a repository on disk.
// ---------------------------------------------------------------------------------------------

test('run is a clean no-op in a repository that has adopted neither surface', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-approval-surface-'));
  try {
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.surfaces, 0);
    assert.equal(r.forms, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run pairs surfaces with plans and forms with mirrors, over a repository on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-approval-surface-'));
  try {
    mkdirSync(`${dir}/docs/governance/changes/CHG-FIXTURE-0002`, { recursive: true });
    writeFileSync(`${dir}/docs/governance/changes/CHG-FIXTURE-0002/control-plan.json`, JSON.stringify(PLAN, null, 2));
    mkdirSync(`${dir}/${SURFACE_DIR}`, { recursive: true });
    writeFileSync(`${dir}/${SURFACE_DIR}/pa1.json`, JSON.stringify(surfaceFor('PA1'), null, 2));
    mkdirSync(`${dir}/${CATALOG_DIR}`, { recursive: true });
    mkdirSync(`${dir}/delivery/templates`, { recursive: true });
    writeFileSync(`${dir}/delivery/templates/fixture-record.md`, MIRROR);
    writeFileSync(`${dir}/${CATALOG_DIR}/fixture-card.md`, FORM);

    assert.deepEqual(loadPlans(dir).map((p) => p.change_id), ['CHG-FIXTURE-0002']);
    const ok = run(dir);
    assert.deepEqual(ok.findings, []);
    assert.equal(ok.surfaces, 1);
    assert.equal(ok.forms, 1);

    // The two failures an adopting repository actually produces: the plan recompiles and nobody
    // regenerates the page, and someone tidies a section name on the floor.
    writeFileSync(
      `${dir}/docs/governance/changes/CHG-FIXTURE-0002/control-plan.json`,
      JSON.stringify({ ...PLAN, required_approver_roles: [...PLAN.required_approver_roles, 'compliance'], plan_hash: 'd4'.repeat(32) }, null, 2),
    );
    writeFileSync(`${dir}/${CATALOG_DIR}/fixture-card.md`, FORM.replace('## Context', '## Background'));
    const bad = run(dir);
    assert.ok(bad.findings.some((f) => f.startsWith('AS-R10') && /no longer the plan's/.test(f)), bad.findings.join(' · '));
    assert.ok(bad.findings.some((f) => f.startsWith('AS-R15')), bad.findings.join(' · '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
