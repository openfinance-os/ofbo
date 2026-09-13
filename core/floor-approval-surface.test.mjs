// Tests for the approvals surface (Factory Floor WS5 · D5.1). Node built-in runner.
//
// Three controls carry this module, and for each one this file writes the negative that would PASS
// if the control were absent — the mutation that leaves a page looking entirely reasonable:
//
//   - DERIVED, NOT DRAWN. A page missing a section for a compiled role, and a page with a section
//     for a role the plan never compiled, both read fine to whoever is looking at them. The first
//     surfaces as a refusal at the gate for a role nobody was asked about; the second teaches the
//     institution a role set the compiler never agreed to. Neither is visible without the plan, so
//     the no-plan case is a test of its own: `verifyApprovalSurface(surface, null)` must refuse.
//     PA1 and PA2 bind DIFFERENT role sets, so a PA1 page relabelled PA2 is also tested.
//   - EVIDENCE CARRIED IN. An evidence block the approver can edit, or one assembled by the
//     approver, is indistinguishable on screen from one a floor-keeper assembled. Both directions
//     are tested, including the mirror failure — a floor-keeper who can write the decision.
//   - THE PEOPLE-PROPERTY. A text field labelled "Approver" accepts a typed name and looks like an
//     identity. So does a `people` property whose join pivots on a reassignable workspace id.
//
// Every fixture value is synthetic and fabricated for this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISION_ROUTE,
  EVIDENCE_BLOCKS,
  KEEPER_IDENTITY,
  NON_AUTHORITATIVE,
  PEOPLE_JOIN,
  SCHEMA_ID,
  STAGES,
  WRITE_CLASS,
  deriveApprovalSurface,
  digestOf,
  rolesFor,
  verifyApprovalSurface,
  verifySection,
} from './floor-approval-surface.mjs';
import { pa1Roles } from '../scripts/product-approval-check.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PLAN = {
  change_id: 'CHG-FIXTURE-0001',
  risk_tier: 'high',
  plan_hash: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  required_gates: ['D', 'PA1', 'PA2', 'Q'],
  required_approver_roles: ['accountable-executive', 'compliance', 'engineering', 'product-owner', 'risk-second-line'],
  pa1_approver_roles: ['compliance'],
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const codes = (findings) => findings.map((f) => f.slice(0, 6));
/**
 * Re-digest after a mutation, so each negative below reports the mutation and not a stale digest.
 * The digest check has a test of its own.
 */
const resign = (s) => { s.digest = digestOf(s); return s; };
const surfaceFor = (stage = 'PA1') => {
  const { surface, findings } = deriveApprovalSurface(PLAN, { stage });
  assert.deepEqual(findings, [], `the fixture must derive cleanly for ${stage}`);
  return surface;
};
// ---------------------------------------------------------------------------------------------
// Derivation: the page is the plan's role list, and the two stages are not the same page.
// ---------------------------------------------------------------------------------------------

test('the derived surface binds exactly the roles the compiler says bind at that stage', () => {
  const pa1 = surfaceFor('PA1');
  const pa2 = surfaceFor('PA2');
  // pa1Roles is the compiler's answer. This test asserts the surface uses it rather than
  // re-deriving "which roles matter at PA1", which is how two answers to one question start.
  assert.deepEqual(pa1.roles, pa1Roles(PLAN));
  assert.deepEqual(pa1.sections.map((s) => s.role), pa1Roles(PLAN));
  assert.deepEqual(pa2.roles, [...PLAN.required_approver_roles].sort());
  assert.notDeepEqual(pa1.roles, pa2.roles, 'PA1 and PA2 must bind different sets, or this whole module is decoration');
});

test('rolesFor knows only the two product-approval stages', () => {
  assert.deepEqual(STAGES, ['PA1', 'PA2']);
  assert.equal(rolesFor(PLAN, 'PA3'), null);
  assert.deepEqual(rolesFor({ required_approver_roles: ['b', 'a', 'a'] }, 'PA2'), ['a', 'b']);
});

test('a derived surface verifies against the plan it was derived from, at both stages', () => {
  for (const stage of STAGES) assert.deepEqual(verifyApprovalSurface(surfaceFor(stage), PLAN), []);
});

test('derivation is deterministic — same plan, same bytes, same digest', () => {
  assert.equal(JSON.stringify(surfaceFor('PA1')), JSON.stringify(surfaceFor('PA1')));
});

test('the label sits on the page AND on every section, with the route to the real decision', () => {
  const s = surfaceFor('PA2');
  assert.equal(s.authority, 'none');
  assert.equal(s.banner, NON_AUTHORITATIVE);
  assert.equal(s.write_class, WRITE_CLASS);
  assert.match(s.banner, /entry gate has not passed/);
  assert.match(s.banner, /signed envelope/);
  for (const section of s.sections) {
    assert.equal(section.authority, 'none', `${section.role} carries the label`);
    assert.equal(section.banner, NON_AUTHORITATIVE, `${section.role} carries the banner — a section is what gets screenshotted`);
    assert.equal(section.decision_arrives_as.via, DECISION_ROUTE.via);
  }
});

test('every section carries all three evidence blocks, assembled for that role and read-only', () => {
  for (const section of surfaceFor('PA2').sections) {
    assert.deepEqual(section.evidence.map((e) => e.evidence), EVIDENCE_BLOCKS.map((b) => b.key));
    for (const e of section.evidence) {
      assert.equal(e.read_only, true);
      assert.equal(e.assembled_by, KEEPER_IDENTITY);
      assert.equal(e.assembled_for, section.role);
      assert.deepEqual(e.writable_by, []);
      assert.equal(e.filled_by, undefined, 'evidence is assembled, never filled in');
    }
  }
});

test('the approver is a people-property bound to the P6 join, and there is no text field beside it', () => {
  for (const section of surfaceFor('PA1').sections) {
    assert.equal(section.approver.type, 'people');
    assert.equal(section.approver.free_text, false);
    assert.deepEqual(section.approver.resolves_through, PEOPLE_JOIN);
    assert.equal(section.approver.resolves_through.pivot, 'idp_subject');
    for (const f of section.fields) assert.notEqual(f.type, 'people');
  }
});

test('derivation refuses what it cannot honestly derive, and emits nothing at all', () => {
  for (const [args, want] of [
    [[PLAN, { stage: 'PA3' }], /AS-R10.*not one of PA1 \| PA2/s],
    [[null, { stage: 'PA1' }], /AS-R10.*nothing here to derive it from/s],
    [[{ required_gates: ['PA1'] }, { stage: 'PA1' }], /AS-R10.*nothing here to derive it from/s],
    [[{ ...PLAN, required_gates: ['D'] }, { stage: 'PA1' }], /AS-R10.*does not compile PA1/s],
    [[{ ...PLAN, required_approver_roles: [] }, { stage: 'PA2' }], /AS-R10.*compiles no approver role/s],
  ]) {
    const { surface, findings } = deriveApprovalSurface(...args);
    assert.equal(surface, null, 'a surface that cannot be derived is not emitted in a reduced form');
    assert.equal(findings.length, 1, findings.join(' · '));
    assert.match(findings[0], want);
  }
});

test('derivation says out loud that the two stages differ, and which sections are second-line', () => {
  const { notices } = deriveApprovalSurface(PLAN, { stage: 'PA1' });
  assert.ok(notices.some((n) => /PA2 binds 5/.test(n)), notices.join(' · '));
  assert.ok(notices.some((n) => /second-line/.test(n) && /compliance/.test(n)), notices.join(' · '));
});

// ---------------------------------------------------------------------------------------------
// Control 1 · derived, not drawn.  THE ONE: a page that looks complete.
// ---------------------------------------------------------------------------------------------

test('AS-R03 — a page missing a section for a compiled role is refused', () => {
  const s = surfaceFor('PA1');
  const dropped = s.sections.pop().role;
  s.roles = s.sections.map((x) => x.role);
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R03']);
  assert.match(f[0], new RegExp(`no section for compiled role ${dropped}`));
  assert.match(f[0], /for a role nobody was asked about/);
});

test('AS-R03 — a surface checked against NO plan is refused, not credited', () => {
  // The whole control rests on the plan. A caller that forgets it must not get a pass, or every
  // hand-drawn page in the estate is one omitted argument away from looking verified.
  const f = verifyApprovalSurface(surfaceFor('PA1'), null);
  assert.deepEqual(codes(f), ['AS-R03']);
  assert.match(f[0], /cannot be checked against nothing/);
});

test('AS-R04 — a section for a role the plan did not compile is refused', () => {
  const s = surfaceFor('PA1');
  const invented = clone(s.sections[0]);
  invented.role = 'head-of-innovation';
  invented.name = 'Approval · head-of-innovation';
  invented.approver.role = 'head-of-innovation';
  for (const e of invented.evidence) e.assembled_for = 'head-of-innovation';
  s.sections.push(invented);
  s.roles.push('head-of-innovation');
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R04']);
  assert.match(f[0], /invents an approver/);
});

test('AS-R03 — a PA1 page relabelled PA2 is refused: the stages bind different sets', () => {
  const s = surfaceFor('PA1');
  s.stage = 'PA2';
  const f = verifyApprovalSurface(resign(s), PLAN);
  // engineering binds at PA2 and not at PA1, so the relabelled page is silently short of it.
  assert.deepEqual(codes(f), ['AS-R03']);
  assert.match(f[0], /no section for compiled role engineering/);
});

test('AS-R10 — a stale derivation is caught by the plan hash even when the roles still match', () => {
  const s = surfaceFor('PA1');
  const f = verifyApprovalSurface(s, { ...PLAN, plan_hash: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' });
  assert.deepEqual(codes(f), ['AS-R10']);
  assert.match(f[0], /the page binds a role set that is no longer the plan's/);
});

test('AS-R10 — a surface whose digest does not match its content is refused', () => {
  const s = surfaceFor('PA1');
  s.sections[0].note = 'edited by hand after derivation';
  const f = verifyApprovalSurface(s, PLAN);
  assert.deepEqual(codes(f), ['AS-R10']);
  assert.match(f[0], /not the surface that was derived/);
});

test('AS-R10 — two sections for one role, an unknown stage, and a stage the plan did not compile', () => {
  const dup = surfaceFor('PA1');
  dup.sections.push(clone(dup.sections[0]));
  assert.ok(verifyApprovalSurface(resign(dup), PLAN).some((f) => /a second section for/.test(f)));

  const stage = surfaceFor('PA1');
  stage.stage = 'PA9';
  assert.ok(verifyApprovalSurface(resign(stage), PLAN).some((f) => /AS-R10.*is not one of PA1 \| PA2/s.test(f)));

  const uncompiled = surfaceFor('PA1');
  assert.ok(verifyApprovalSurface(uncompiled, { ...PLAN, required_gates: ['D'] })
    .some((f) => /AS-R10.*does not compile PA1/s.test(f)));
});

// ---------------------------------------------------------------------------------------------
// Control 2 · evidence carried in, assembled by a floor-keeper, never by the approver.
// ---------------------------------------------------------------------------------------------

test('AS-R05 — an evidence block the approver can write is refused, in every disguise', () => {
  for (const [mutate, want] of [
    [(e) => { e.read_only = false; }, /an evidence block the approver can edit/],
    [(e) => { e.writable_by = ['approver']; }, /writable by nobody on this surface/],
    [(e) => { e.assembled_by = 'approver'; }, /assembled_by is "approver"/],
    [(e) => { e.filled_by = 'approver'; }, /evidence is ASSEMBLED, not filled in/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s.sections[0].evidence[0]);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.deepEqual(codes(f), ['AS-R05'], f.join(' · '));
    assert.match(f[0], want);
  }
});

test('AS-R05 — a section whose whole evidence pack is assembled by the approver is refused', () => {
  const s = surfaceFor('PA1');
  s.sections[0].assembled_by = 'approver';
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R05']);
  assert.match(f[0], /never by the approver reading it/);
});

test('AS-R08 — a missing evidence block is refused (a smaller pack is a remembered one)', () => {
  const s = surfaceFor('PA1');
  s.sections[0].evidence = s.sections[0].evidence.filter((e) => e.evidence !== 'gate_results');
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R08']);
  assert.match(f[0], /no gate_results evidence block/);
});

test('AS-R08 — evidence assembled for a different role is refused', () => {
  const s = surfaceFor('PA1');
  s.sections[0].evidence[1].assembled_for = 'engineering';
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R08']);
  assert.match(f[0], /judging someone else's question/);
});

test('AS-R05 — an evidence block moved in among the approver\'s own fields is refused', () => {
  const s = surfaceFor('PA1');
  s.sections[0].fields.push({ name: 'Supporting notes I gathered', kind: 'evidence', filled_by: 'approver', writable_by: ['approver'] });
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R05']);
  assert.match(f[0], /never collected with it/);
});

test('AS-R09 — the mirror failure: the hand that assembles must not record the decision', () => {
  for (const [mutate, want] of [
    [(s) => { s.fields[0].writable_by = ['approver', KEEPER_IDENTITY]; }, /must not be the hand that records/],
    [(s) => { s.fields[0].filled_by = KEEPER_IDENTITY; }, /the assembler deciding/],
    [(s) => { s.fields[0].writable_by = ['svc-floor-bridge']; }, /only the approver writes/],
    [(s) => { delete s.fields[0].writable_by; }, /a field anyone may write/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s.sections[0]);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.ok(f.length >= 1, 'the mutation must be refused');
    assert.deepEqual([...new Set(codes(f))], ['AS-R09'], f.join(' · '));
    assert.ok(f.some((x) => want.test(x)), f.join(' · '));
  }
});

test('AS-R10 — a section that carries evidence and collects nothing is a reading exercise', () => {
  const s = surfaceFor('PA1');
  s.sections[0].fields = [];
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R10']);
  assert.match(f[0], /no select field for the approver's decision/);
});

// ---------------------------------------------------------------------------------------------
// Control 3 · the people-property resolves through P6, and free text is not a shape this has.
// ---------------------------------------------------------------------------------------------

test('AS-R06 — a free-text approver is refused however it is dressed', () => {
  for (const [mutate, want] of [
    [(s) => { s.approver.type = 'text'; }, /a name typed into a text field is not an identity/],
    [(s) => { s.approver.type = 'rich_text'; }, /not "people"/],
    [(s) => { s.approver.free_text = true; }, /accepts an unmapped human/],
    [(s) => { delete s.approver; }, /accepts anyone who types/],
    [(s) => { s.approver.role = 'engineering'; }, /resolves for whoever is asked/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s.sections[0]);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.ok(f.some((x) => x.startsWith('AS-R06') && want.test(x)), f.join(' · '));
  }
});

test('AS-R06 — a text field beside the people-property, which is where a typed name arrives', () => {
  for (const label of ['Approver name', 'Name', 'Email', 'Display name', 'Signatory', 'Who approved']) {
    const s = surfaceFor('PA1');
    s.sections[0].fields.push({ name: label, type: 'rich_text', filled_by: 'approver', writable_by: ['approver'] });
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.deepEqual(codes(f), ['AS-R06'], `${label}: ${f.join(' · ')}`);
  }
});

test('AS-R07 — a people-property that does not resolve through the P6 join is refused', () => {
  for (const [mutate, want] of [
    [(s) => { delete s.approver.resolves_through; }, /resolves to a workspace account/],
    [(s) => { s.approver.resolves_through.pivot = 'notion_person_id'; }, /pivot is the identity-provider subject/],
    [(s) => { s.approver.resolves_through.pivot = 'email'; }, /comparing addresses is refused at review/],
    [(s) => { s.approver.resolves_through.join = 'directory-lookup'; }, /the only join that turns a bound subject into a proven one/],
    [(s) => { s.approver.resolves_through.map = 'docs/people.json'; }, /the second-line-owned map, or nothing/],
    [(s) => { s.approver.resolves_through.resolves_to = 'notion_person_id'; }, /ends at a registry identity/],
    [(s) => { s.approver.resolves_through.email = '<an address>'; }, /the map has no field for it/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s.sections[0]);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.ok(f.some((x) => x.startsWith('AS-R07') && want.test(x)), f.join(' · '));
  }
});

// ---------------------------------------------------------------------------------------------
// The label, and the page that starts to look like the control.
// ---------------------------------------------------------------------------------------------

test('AS-R01 — an unlabelled surface is refused: schema, authority, banner, write class, route', () => {
  for (const [mutate, want] of [
    [(s) => { s.schema = 'loom.floor-approval-surface/v2'; }, /cannot be shown to be non-authoritative/],
    [(s) => { s.authority = 'delegated'; }, /an approval page carries none/],
    [(s) => { s.banner = `${NON_AUTHORITATIVE} (pilot)`; }, /verbatim or it is a finding/],
    [(s) => { delete s.banner; }, /missing or altered/],
    [(s) => { s.write_class = 'born-on-the-floor'; }, /mis-states that to the person reading it/],
    [(s) => { delete s.decision_arrives_as; }, /read as the decision/],
    [(s) => { s.decision_arrives_as = { via: 'the approvals page' }; }, /never as a checkbox on a page/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.ok(f.some((x) => x.startsWith('AS-R01') && want.test(x)), f.join(' · '));
  }
});

test('AS-R01 — a section that has lost its own banner is refused even when the page carries one', () => {
  // THE ONE for labelling. A page-level banner is read once; a section is read by the person
  // deciding, and it is the section that gets screenshotted into a chat and quoted in a review.
  const s = surfaceFor('PA1');
  delete s.sections[1].banner;
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R01']);
  assert.match(f[0], /an approver reads their own section, not the page header/);
});

test('AS-R02 — a surface that starts to look like the control is refused', () => {
  for (const [mutate, want] of [
    [(s) => { s.sections[0].approvals = [{ by: 'u-someone' }]; }, /would read as governance authority/],
    [(s) => { s.sections[0].attestation = { signature: 'x' }; }, /stays in the envelope/],
    [(s) => { s.sections[0].decides = true; }, /claims this surface decides/],
    [(s) => { s.gate_input = true; }, /claims this surface decides, gates or grants/],
    [(s) => { s.sections[0].fields[0].options.push('approved'); }, /written as a verdict/],
    [(s) => { s.sections[0].fields[0].options = ['pending', 'signed off']; }, /the reader's eye/],
    [(s) => { s.sections[0].fields.push({ name: 'Sign-off', type: 'rich_text', filled_by: 'approver', writable_by: ['approver'] }); }, /named as a verdict/],
  ]) {
    const s = surfaceFor('PA1');
    mutate(s);
    const f = verifyApprovalSurface(resign(s), PLAN);
    assert.ok(f.some((x) => x.startsWith('AS-R02') && want.test(x)), f.join(' · '));
  }
});

test('the plan-hash exemption is granted at the envelope and nowhere a person reads', () => {
  // `plan_hash` is an authority field. It is permitted on the surface envelope because that is
  // what makes this derivation checkable against its compilation — and refused inside a section,
  // where it would sit beside a tick and read as the control that produced it.
  assert.deepEqual(verifyApprovalSurface(surfaceFor('PA1'), PLAN), []);
  const s = surfaceFor('PA1');
  s.sections[0].plan_hash = PLAN.plan_hash;
  const f = verifyApprovalSurface(resign(s), PLAN);
  assert.deepEqual(codes(f), ['AS-R02']);
  assert.match(f[0], /indistinguishable on screen/);
});

test('a surface that is not an object, and a section that is not one', () => {
  for (const bad of [null, 'a page', 42, []]) {
    assert.match(verifyApprovalSurface(bad, PLAN)[0], /AS-R01.*nothing here to label/s);
  }
  assert.match(verifySection(null)[0], /AS-R10.*not an object/s);
  const s = surfaceFor('PA1');
  s.sections = 'two sections';
  assert.match(verifyApprovalSurface(resign(s), PLAN).at(-1), /AS-R10.*must not look alike/s);
});

// ---------------------------------------------------------------------------------------------
// Against the plan that actually ships in this bundle.
// ---------------------------------------------------------------------------------------------

test('the bundled change-example plan derives a surface that verifies, at both stages', (t) => {
  // The compiled plan is BUNDLE demonstration data — `copy-manifest.json` deliberately does not
  // install it, and the adoption dry-run stages it at the governed path instead. So look in both
  // places and skip where neither exists, rather than failing an adopter's suite for the absence of
  // a fixture they were never given. This is the same FIND-or-skip shape used by
  // scripts/product-approval-check.test.mjs and core/floor-export.test.mjs.
  const src = [
    'change-example/control-plan.json',
    'docs/governance/changes/CHG-2026-0042/control-plan.json',
  ].map((c) => `${HARNESS}/${c}`).find(existsSync);
  if (!src) { t.skip('the bundled change-example is absent in this layout'); return; }
  const plan = JSON.parse(readFileSync(src, 'utf8'));
  for (const stage of STAGES) {
    const { surface, findings } = deriveApprovalSurface(plan, { stage });
    assert.deepEqual(findings, [], `${stage}: ${findings.join(' · ')}`);
    assert.deepEqual(verifyApprovalSurface(surface, plan), []);
    assert.equal(surface.schema, SCHEMA_ID);
    assert.ok(surface.sections.length > 0);
  }
  const pa1 = deriveApprovalSurface(plan, { stage: 'PA1' }).surface;
  const pa2 = deriveApprovalSurface(plan, { stage: 'PA2' }).surface;
  assert.ok(pa2.roles.length > pa1.roles.length, 'the bundled plan binds more roles at launch than at develop');
});
