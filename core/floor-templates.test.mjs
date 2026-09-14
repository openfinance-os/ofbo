// Tests for floor-template generation and parity. Node built-in runner: `node --test`.
//
// The contract under test: a guided form on the collaboration surface is DERIVED from the git
// template, so a teammate is asked for exactly what the gate will check. Every test here is
// really the same question asked a different way — can the two drift without anyone noticing?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_ID,
  diff,
  gatesNamed,
  generate,
  parseTemplate,
  sha256,
  toFloorDefinition,
  WRITE_CLASSES,
} from './floor-templates.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEMPLATE = [
  '---',
  'artifact: demo-artifact',
  'stage: define',
  'run: "<slug>"',
  '---',
  '',
  '# Demo artifact — <slug>',
  '',
  '> Define (converge). Gates D1 (framing) and D6.',
  '',
  '## A prose section',
  '',
  'Write something here.',
  '',
  '## A table section',
  '',
  '| Element | Rating |',
  '|---|---|',
  '| | |',
  '',
  '## A field section (D6)',
  '',
  '- **First field:**',
  '- **Second field:** Yes / No',
  '',
].join('\n');

// --- parsing ---------------------------------------------------------------------------------

test('a template declares its identity, its gates and one entry per section', () => {
  const p = parseTemplate(TEMPLATE, { source: 'x/demo.md' });
  assert.equal(p.artifact, 'demo-artifact');
  assert.equal(p.stage, 'define');
  assert.equal(p.title, 'Demo artifact');
  assert.deepEqual(p.gates, ['D1', 'D6']);
  assert.match(p.guidance, /^Define \(converge\)/);
  assert.deepEqual(p.sections.map((s) => s.kind), ['rich_text', 'table', 'fields']);
});

test('a table section carries its columns; a field section carries its field names', () => {
  const p = parseTemplate(TEMPLATE);
  assert.deepEqual(p.sections[1].columns, ['Element', 'Rating']);
  assert.deepEqual(p.sections[2].fields, ['First field', 'Second field']);
});

test('a gate named in a section heading is recorded against that section', () => {
  const p = parseTemplate(TEMPLATE);
  assert.deepEqual(p.sections[2].gates, ['D6']);
  assert.equal(p.sections[0].gates, undefined, 'a section naming no gate claims none');
});

test('gate ranges are expanded — D1–D8 is eight gates, not two', () => {
  assert.deepEqual(gatesNamed('Delivery-ready iff D1–D8 green'), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  assert.deepEqual(gatesNamed('Gates D1 (framing), D3 (scope), D4'), ['D1', 'D3', 'D4']);
  assert.deepEqual(gatesNamed('no gates here'), []);
});

test('the guidance blockquote is found under the heading, not above it', () => {
  // A naive reader stops at the H1 and reports no guidance — which would silently strip the one
  // piece of help text a non-technical author most needs.
  assert.match(parseTemplate(TEMPLATE).guidance, /Gates D1 \(framing\) and D6/);
});

// --- the emitted definition -------------------------------------------------------------------

test('a born-on-the-floor definition carries the freeze/drift block; a routed one does not', () => {
  const parsed = parseTemplate(TEMPLATE, { source: 'x/demo.md' });
  const born = toFloorDefinition(parsed, { writeClass: 'born-on-the-floor' });
  const routed = toFloorDefinition(parsed, { writeClass: 'decision-routed' });
  const names = (d) => d.properties.map((p) => p.name);
  for (const p of ['Frozen at', 'Version', 'Drift']) assert.ok(names(born).includes(p), `born template needs ${p}`);
  for (const p of ['Frozen at', 'Version', 'Drift']) assert.ok(!names(routed).includes(p));
  assert.equal(born.schema, SCHEMA_ID);
});

test('the `frozen` status is offered only where a freeze can actually happen', () => {
  const parsed = parseTemplate(TEMPLATE, { source: 'x/demo.md' });
  const statusOf = (wc) => toFloorDefinition(parsed, { writeClass: wc })
    .properties.find((p) => p.name === 'Status').options;

  // Only born-on-the-floor content is exported and stamped by the freeze round-trip.
  assert.ok(statusOf('born-on-the-floor').includes('frozen'));

  // Everywhere else `frozen` is a status nothing writes and no gate reads — an author selecting it
  // would mark the page with a claim the harness cannot contradict. It must not be on the menu.
  for (const wc of ['decision-routed', 'lives-on-the-floor', 'read-only-mirror', 'never-writable']) {
    assert.ok(!statusOf(wc).includes('frozen'), `${wc} must not offer a status it can never reach`);
    assert.deepEqual(statusOf(wc), ['draft', 'in review', 'gate-green']);
  }

  // The option and the block that gives it meaning travel together, in both directions.
  for (const wc of [...WRITE_CLASSES]) {
    const d = toFloorDefinition(parsed, { writeClass: wc });
    const offersFrozen = d.properties.find((p) => p.name === 'Status').options.includes('frozen');
    const hasBlock = d.properties.some((p) => p.name === 'Frozen at');
    assert.equal(offersFrozen, hasBlock, `${wc}: the frozen status and the freeze block disagree`);
  }
});

test('the freeze block is read-only — an author never writes the record own state', () => {
  const d = toFloorDefinition(parseTemplate(TEMPLATE), { writeClass: 'born-on-the-floor' });
  for (const name of ['Frozen at', 'Version', 'Drift']) {
    assert.equal(d.properties.find((p) => p.name === name).read_only, true, `${name} must be read-only`);
  }
});

test('an unknown write class is refused rather than silently defaulted', () => {
  assert.throws(() => toFloorDefinition(parseTemplate(TEMPLATE), { writeClass: 'whatever' }), /unknown write class/);
});

// --- drift: the whole point --------------------------------------------------------------------

test('an edited template makes its definition stale, by digest alone', () => {
  const parsed = parseTemplate(TEMPLATE, { source: 'x/demo.md' });
  const stored = toFloorDefinition(parsed, { sourceDigest: sha256(TEMPLATE) });
  const edited = `${TEMPLATE}\nA trailing sentence that changes nothing structural.\n`;
  const fresh = toFloorDefinition(parseTemplate(edited, { source: 'x/demo.md' }), { sourceDigest: sha256(edited) });
  assert.ok(diff(stored, fresh).some((f) => /source_digest is stale/.test(f)));
});

test('a renamed section is caught and both lists are shown', () => {
  const stored = toFloorDefinition(parseTemplate(TEMPLATE, { source: 'x/demo.md' }));
  const renamed = TEMPLATE.replace('## A prose section', '## A renamed section');
  const fresh = toFloorDefinition(parseTemplate(renamed, { source: 'x/demo.md' }));
  const f = diff(stored, fresh);
  assert.ok(f.some((x) => /section list differs/.test(x)));
  assert.ok(f.some((x) => /A renamed section/.test(x)), 'the finding must show what it became');
});

test('a column added to a table is caught even though the section list is unchanged', () => {
  const stored = toFloorDefinition(parseTemplate(TEMPLATE, { source: 'x/demo.md' }));
  const widened = TEMPLATE.replace('| Element | Rating |', '| Element | Rating | Owner |').replace('|---|---|', '|---|---|---|');
  const fresh = toFloorDefinition(parseTemplate(widened, { source: 'x/demo.md' }));
  assert.ok(diff(stored, fresh).some((x) => /shape differs/.test(x) && /Owner/.test(x)));
});

test('a gate added to the template reaches the definition', () => {
  const stored = toFloorDefinition(parseTemplate(TEMPLATE, { source: 'x/demo.md' }));
  const fresh = toFloorDefinition(parseTemplate(TEMPLATE.replace('and D6.', 'and D6, and now D9.'), { source: 'x/demo.md' }));
  assert.ok(diff(stored, fresh).some((x) => /gates differ/.test(x)));
});

test('a properties drift is caught — sections alone were never the whole definition', () => {
  const parsed = parseTemplate(TEMPLATE, { source: 'x/demo.md' });
  const fresh = toFloorDefinition(parsed, { writeClass: 'decision-routed' });

  // The exact state two shipped decision-routed definitions were in: identical sections, identical
  // gates, identical write_class — and a Status select offering a `frozen` nothing can write. The
  // gate compared sections only, so it called the pair "in step".
  const stored = JSON.parse(JSON.stringify(fresh));
  stored.properties.find((p) => p.name === 'Status').options.push('frozen');
  assert.ok(diff(stored, fresh).some((x) => /properties differ/.test(x)),
    'a status the write class cannot reach must not pass as in-step');

  // The other direction: losing the freeze block from a born-on-the-floor definition is a silent
  // removal of the only thing that tells a reader whether they hold the record or a draft.
  const born = toFloorDefinition(parsed, { writeClass: 'born-on-the-floor' });
  const stripped = JSON.parse(JSON.stringify(born));
  stripped.properties = stripped.properties.filter((p) => p.name !== 'Frozen at');
  assert.ok(diff(stripped, born).some((x) => /properties differ/.test(x)));

  // And a read_only flag flipped: an author who can write the record's own state is the defect
  // the read-only flags exist to prevent, and it is invisible at section granularity.
  const unlocked = JSON.parse(JSON.stringify(born));
  unlocked.properties.find((p) => p.name === 'Drift').read_only = false;
  assert.ok(diff(unlocked, born).some((x) => /properties differ/.test(x)));
});

test('identical definitions produce no findings — the gate is not noisy', () => {
  const a = toFloorDefinition(parseTemplate(TEMPLATE, { source: 'x/demo.md' }), { sourceDigest: sha256(TEMPLATE) });
  const b = toFloorDefinition(parseTemplate(TEMPLATE, { source: 'x/demo.md' }), { sourceDigest: sha256(TEMPLATE) });
  assert.deepEqual(diff(a, b), []);
});

// --- the shipped pairs --------------------------------------------------------------------------

const FLOOR = `${HARNESS}/floor/templates`;
if (!existsSync(FLOOR)) {
  test('shipped floor templates (absent in this layout — skipped)', { skip: true }, () => {});
} else {
  test('every shipped definition regenerates identically from its git template', () => {
    const files = readdirSync(FLOOR).filter((n) => n.endsWith('.json'));
    assert.ok(files.length > 0, 'expected shipped pairs');
    for (const name of files) {
      const stored = JSON.parse(readFileSync(`${FLOOR}/${name}`, 'utf8'));
      assert.ok(existsSync(`${HARNESS}/${stored.source}`), `${name}: source ${stored.source} must exist`);
      const fresh = generate(`${HARNESS}/${stored.source}`, { source: stored.source, writeClass: stored.write_class });
      assert.deepEqual(diff(stored, fresh), [], `${name} has drifted from ${stored.source}`);
    }
  });

  test('the privacy template reaches the floor with its D6 shape intact', () => {
    // The data-governance artifact is the one a non-technical author most needs guiding through,
    // and the one whose gate is least forgiving — so its shape is pinned explicitly.
    const d = JSON.parse(readFileSync(`${FLOOR}/data-governance.json`, 'utf8'));
    assert.deepEqual(d.gates, ['D6']);
    assert.equal(d.write_class, 'born-on-the-floor');
    const risk = d.sections.find((s) => /Risk mapping/.test(s.name));
    assert.equal(risk.kind, 'table');
    for (const col of ['`DR-*` category', 'Mitigating `CTRL-*`']) {
      assert.ok(risk.columns.includes(col), `the register mapping needs the ${col} column`);
    }
  });
}
