// Tests for the floor-only gate (Factory Floor WS3 · D3.3). Node built-in runner.
//
// Two controls, and for each one the negative that would pass if the control were absent:
//
//   - the BANNER. A template whose PII rule has slid below the fold would pass any whole-file
//     grep, and would still be a template an author meets after they have written the note. That
//     is the case the leading-block rule exists for, and it has a test of its own.
//   - the BOUNDARY. A catalog-C artifact copied into `discovery/runs/` is the one move this write
//     class forbids, and it arrives by ordinary copy-paste rather than by malice — sometimes with
//     its frontmatter stripped on the way, which is why identification does not rest on it alone.
//
// Every fixture value is synthetic and fabricated for this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_DIR, WRITE_CLASS, bannerBlockOf, checkTemplate, evaluate, identifyCatalogC, run } from './floor-only-check.mjs';

// TIER-AWARE (rc.24): this asserts properties of content that a `core` or `governed` adoption
// deliberately does not install. Absent content is not a failing test — it is a tier boundary — so
// these skip cleanly, the same "inert where absent" pattern the doc-integrity gate uses.
const CATALOG_C_PRESENT = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'floor/catalog-c'));

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BANNER = [
  '> ## ⛔ WRITE CLASS · `lives-on-the-floor` — NEVER FROZEN',
  '>',
  '> Nothing written here is ever carried into `discovery/runs/`, and no gate reads it.',
  '>',
  '> **PII rule — before you type, not after.** Roles and pseudonyms only; never a person.',
].join('\n');

const TEMPLATE = `---
artifact: fixture-note
catalog: C
write_class: ${WRITE_CLASS}
freeze: never
stage: floor
---

# Fixture note — <FX-nnn>

${BANNER}

## Who was in the room (roles, not names)

| Participant id | Role / hat |
|---|---|
| P-01 | |

## Points raised

- **Note id:** \`FX-001\`
- **Facilitator (role):** <hat>
`;

const template = (text = TEMPLATE) => [{ name: 'fixture-note.md', text }];
const codes = (findings) => findings.map((f) => f.slice(0, 6));

// ---------------------------------------------------------------------------------------------
// The suite as shipped.
// ---------------------------------------------------------------------------------------------

test('the catalog-C suite that ships in this bundle passes its own gate', { skip: !CATALOG_C_PRESENT && 'floor/catalog-c not installed at this tier' }, () => {
  const r = run(HARNESS);
  assert.deepEqual(r.findings, []);
  assert.ok(r.templates >= 4, `expected the shipped floor-only suite, saw ${r.templates} templates`);
  assert.equal(r.crossings, 0);
});

test('every shipped catalog-C template declares the write class and carries the banner', { skip: !CATALOG_C_PRESENT && 'floor/catalog-c not installed at this tier' }, () => {
  for (const name of readdirSync(join(HARNESS, CATALOG_DIR)).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(HARNESS, CATALOG_DIR, name), 'utf8');
    assert.deepEqual(checkTemplate(name, text), [], name);
    assert.match(bannerBlockOf(text), /lives-on-the-floor/);
    assert.match(bannerBlockOf(text), /never frozen/i);
  }
});

test('the fixture template passes, so every failure below is the mutation and not the fixture', () => {
  assert.deepEqual(evaluate({ templates: template() }).findings, []);
});

// ---------------------------------------------------------------------------------------------
// Control 1 · the banner.
// ---------------------------------------------------------------------------------------------

test('FC-R01 — a template with no banner at all is refused, as ONE finding naming all three parts', () => {
  const f = checkTemplate('fixture-note.md', TEMPLATE.replace(`${BANNER}\n\n`, ''));
  assert.deepEqual(codes(f), ['FC-R01'], 'a missing banner is one thing to fix, not three defects');
  assert.match(f[0], /no banner at all/);
  for (const want of [/lives-on-the-floor/, /NEVER FROZEN/, /PII rule/]) assert.match(f[0], want);
});

test('FC-R02 — a banner that names the class but not its consequence is refused', () => {
  const f = checkTemplate('fixture-note.md', TEMPLATE.replace('— NEVER FROZEN', ''));
  assert.deepEqual(codes(f), ['FC-R02']);
  assert.match(f[0], /a class name without its consequence teaches nothing/);
});

// THE ONE. A whole-file search would find the rule and pass. The rule is only a control where the
// author already is, so the check reads the leading block and nothing else.
test('FC-R03 — a PII rule pushed below the fold is refused, not credited', () => {
  const moved = `${TEMPLATE.replace('> **PII rule — before you type, not after.** Roles and pseudonyms only; never a person.\n', '')}
## Appendix — data protection

> **PII rule.** Roles and pseudonyms only; never a person.
`;
  assert.match(moved, /PII rule/, 'the fixture must still contain the rule somewhere, or this proves nothing');
  const f = checkTemplate('fixture-note.md', moved);
  assert.deepEqual(codes(f), ['FC-R03']);
  assert.match(f[0], /too late: an author meets it after writing, not before/);
});

test('FC-R03 — a template with no PII rule anywhere is refused without the "too late" wording', () => {
  const f = checkTemplate('fixture-note.md', TEMPLATE.replace('> **PII rule — before you type, not after.** Roles and pseudonyms only; never a person.\n', ''));
  assert.deepEqual(codes(f), ['FC-R03']);
  assert.equal(/too late/.test(f[0]), false);
});

test('FC-R04 — a template that does not declare its write class is refused', () => {
  for (const fm of [`write_class: born-on-the-floor`, 'stage: floor']) {
    const f = checkTemplate('fixture-note.md', TEMPLATE.replace(`write_class: ${WRITE_CLASS}`, fm));
    assert.match(f[0], /^FC-R04/);
    assert.match(f[0], /the generated floor form takes its banner from this field/);
  }
});

// A banner block that only starts after the first section is not a banner: it is a paragraph.
test('the banner must precede the first section, not follow it', () => {
  const late = TEMPLATE.replace(`${BANNER}\n\n## Who`, '## Who');
  assert.equal(bannerBlockOf(late), '');
  assert.match(checkTemplate('fixture-note.md', late)[0], /no banner at all/);
});

// ---------------------------------------------------------------------------------------------
// Control 2 · the form asks for the safe shape.
// ---------------------------------------------------------------------------------------------

test('FC-R05 — a form that asks for a name is refused', () => {
  const named = TEMPLATE.replace('| Participant id | Role / hat |', '| Name | Email |');
  const f = checkTemplate('fixture-note.md', named);
  assert.deepEqual(codes(f), ['FC-R05', 'FC-R05']);
  assert.match(f[0], /a form that asks for a name will be given one/);
});

test('FC-R05 — a labelled field asking for contact details is refused too', () => {
  const f = checkTemplate('fixture-note.md', TEMPLATE.replace('- **Facilitator (role):**', '- **Phone:**'));
  assert.deepEqual(codes(f), ['FC-R05']);
});

test('FC-R05 — the same word qualified by a role or pseudonym is allowed through', () => {
  for (const label of ['Name (pseudonym)', 'Contact (role)', 'Attendees (roles, not names)']) {
    const ok = TEMPLATE.replace('| Participant id | Role / hat |', `| ${label} | Role / hat |`);
    assert.deepEqual(checkTemplate('fixture-note.md', ok), [], label);
  }
});

test('FC-R06 — a template modelling the behaviour its own banner forbids is refused', () => {
  // Not a reserved documentation domain, so it does not read as one of this repository's
  // synthetic markers — which is exactly the example a template must never ship.
  const bad = TEMPLATE.replace('| P-01 | |', '| P-01 | reach a.hartley@northwind-bank.ae |');
  const f = checkTemplate('fixture-note.md', bad);
  assert.deepEqual(codes(f), ['FC-R06']);
  assert.match(f[0], /modelling the thing its banner forbids/);
  assert.equal(f[0].includes('a.hartley'), false, 'the finding must not reprint the value');
});

test('FC-R06 — a synthetic example carrying this repository’s markers is left alone', () => {
  const ok = TEMPLATE.replace('| P-01 | |', '| P-01 | p-01@example.com |');
  assert.deepEqual(checkTemplate('fixture-note.md', ok), []);
});

// ---------------------------------------------------------------------------------------------
// Control 3 · the boundary. A catalog-C artifact under discovery/runs never should have crossed.
// ---------------------------------------------------------------------------------------------

test('FC-R07 — a catalog-C artifact frozen into discovery/runs is refused', () => {
  const r = evaluate({ templates: template(), frozen: [{ path: 'r1/fixture-note.md', text: TEMPLATE }] });
  assert.match(r.findings[0], /^FC-R07/);
  assert.match(r.findings[0], /has been frozen into the record/);
  assert.match(r.findings[0], /may CITE a floor note by its id, and may never BE one/);
  assert.equal(r.crossings, 1);
});

test('FC-R07 — identification does not rest on any single signal', () => {
  const index = new Set(['fixture-note']);
  // declares the write class, under a name nobody would recognise
  assert.match(identifyCatalogC('r1/notes-from-tuesday.md', `---\nwrite_class: ${WRITE_CLASS}\n---\n# x\n`, index), /declares write_class/);
  // declares the catalog, and nothing else
  assert.match(identifyCatalogC('r1/notes.md', '---\ncatalog: C\n---\n# x\n', index), /declares catalog C/);
  // frontmatter stripped on the way in — the name is what is left
  assert.match(identifyCatalogC('r1/fixture-note.md', '# Fixture note\n\nSome prose.\n', index), /named for the catalog-C template/);
  // renamed AND stripped of write_class, but still declaring the artifact
  assert.match(identifyCatalogC('r1/tuesday.md', '---\nartifact: fixture-note\n---\n# x\n', index), /declares artifact/);
  // an ordinary discovery artifact is not one of ours
  assert.equal(identifyCatalogC('r1/problem-statement.md', '---\nartifact: problem-statement\nstage: discover\n---\n# Problem statement\n', index), null);
});

test('FC-R08 — a freeze stamp naming a catalog-C artifact is refused', () => {
  const r = evaluate({ templates: template(), stamps: [{ label: 'r1 · fixture-note.json', file: 'fixture-note.md' }] });
  assert.match(r.findings[0], /^FC-R08/);
  assert.match(r.findings[0], /the freezer was pointed at a page that never freezes/);
  assert.equal(r.crossings, 1);
});

test('FC-R08 — a stamp for an ordinary discovery artifact is not a crossing', () => {
  const r = evaluate({ templates: template(), stamps: [{ label: 'r1 · problem-statement.json', file: 'problem-statement.md' }] });
  assert.deepEqual(r.findings, []);
  assert.equal(r.crossings, 0);
});

// The escalation. Once it is in git the file is not the problem; the history is.
test('FC-R09 — personal data in a crossed artifact is escalated, not merely noted', () => {
  const crossed = `---\nwrite_class: ${WRITE_CLASS}\n---\n\n# Interview note\n\nMs Amina Al-Farsi, reachable on 050 555 0143.\n`;
  const r = evaluate({ frozen: [{ path: 'r1/interview-note.md', text: crossed }] });
  assert.deepEqual(codes(r.findings), ['FC-R07', 'FC-R09', 'FC-R09']);
  assert.match(r.findings[1], /now in git history, where deleting the file does not remove it/);
  assert.equal(r.findings.join('\n').includes('Al-Farsi'), false, 'the escalation must not reprint the disclosure');
});

test('a crossed artifact is caught even where no catalog templates are present to index', () => {
  // The self-declaring signal has to work on its own: an adopter can delete the template
  // directory, and that must not disarm the boundary for artifacts that name their own class.
  const r = evaluate({ templates: [], frozen: [{ path: 'r1/whatever.md', text: `---\nwrite_class: ${WRITE_CLASS}\n---\n# x\n` }] });
  assert.match(r.findings[0], /^FC-R07/);
});

// ---------------------------------------------------------------------------------------------
// Silence where unadopted.
// ---------------------------------------------------------------------------------------------

test('a repository with no catalog-C templates and no runs is a clean no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fo-'));
  try { assert.deepEqual(run(dir), { findings: [], templates: 0, frozen: 0, crossings: 0 }); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hand-authored discovery runs are untouched by the gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fo-'));
  try {
    mkdirSync(join(dir, 'discovery/runs/hand-authored/evidence'), { recursive: true });
    writeFileSync(join(dir, 'discovery/runs/hand-authored/problem-statement.md'), '---\nartifact: problem-statement\n---\n\n# Problem statement\n\nWritten by a person.\n');
    writeFileSync(join(dir, 'discovery/runs/hand-authored/evidence/notes.md'), '# Notes\n\nOrdinary evidence.\n');
    const r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.frozen, 2);
    assert.equal(r.crossings, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the gate reads a real tree end to end, catalog and crossing alike', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fo-'));
  try {
    mkdirSync(join(dir, CATALOG_DIR), { recursive: true });
    writeFileSync(join(dir, CATALOG_DIR, 'fixture-note.md'), TEMPLATE);
    mkdirSync(join(dir, 'discovery/runs/r1/.freeze'), { recursive: true });
    let r = run(dir);
    assert.deepEqual(r.findings, []);
    assert.equal(r.templates, 1);

    // Now somebody copies the note into the run, and stamps it for good measure.
    writeFileSync(join(dir, 'discovery/runs/r1/fixture-note.md'), TEMPLATE);
    writeFileSync(join(dir, 'discovery/runs/r1/.freeze/fixture-note.json'), JSON.stringify({ file: 'fixture-note.md' }));
    r = run(dir);
    assert.deepEqual(codes(r.findings), ['FC-R07', 'FC-R08']);
    assert.equal(r.crossings, 2);
    // The stamp directory itself is never mistaken for content.
    assert.equal(r.frozen, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unreadable or empty catalog-C template is a finding, not a skip', () => {
  assert.match(checkTemplate('empty.md', '')[0], /^FC-R01/);
  assert.match(checkTemplate('empty.md', null)[0], /unreadable or empty/);
});

test('evaluate is pure — the same inputs give the same findings', () => {
  const input = { templates: template(), frozen: [{ path: 'r1/fixture-note.md', text: TEMPLATE }], stamps: [{ label: 'r1 · x.json', file: 'fixture-note.md' }] };
  assert.deepEqual(evaluate(input), evaluate(input));
  assert.deepEqual(evaluate(), { findings: [], templates: 0, frozen: 0, crossings: 0 });
});
