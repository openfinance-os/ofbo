// Tests for the deterministic exporter (Factory Floor WS4 · D4.1). Node built-in runner.
//
// Two properties are on trial, and the negative tests matter more than the positive ones. A
// converter is easy to test for "does it render a paragraph" and easy to ship with a silent
// drop that nobody notices until a gate passes a document missing the paragraph where someone
// wrote down the risk. So most of what follows is about what it REFUSES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFUSED,
  SUPPORTED,
  exportPage,
  freezeStamp,
  richText,
  sha256,
  tryExport,
  verifyStamp,
} from './floor-export.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIND = (...c) => c.map((x) => `${HARNESS}/${x}`).find(existsSync) || null;

const rt = (s, ann = {}) => [{ plain_text: s, annotations: ann }];
const p = (s) => ({ type: 'paragraph', paragraph: { rich_text: rt(s) } });
const page = (blocks, over = {}) => ({ title: 'Problem statement', blocks, ...over });

// --- rendering ----------------------------------------------------------------------------------

test('the common block types render to the markdown a D-gate reads', () => {
  const { markdown } = exportPage(page([
    { type: 'heading_2', heading_2: { rich_text: rt('Signals') } },
    p('Two customers said the same thing.'),
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('first') } },
    { type: 'numbered_list_item', numbered_list_item: { rich_text: rt('second') } },
    { type: 'to_do', to_do: { rich_text: rt('done'), checked: true } },
    { type: 'to_do', to_do: { rich_text: rt('not done'), checked: false } },
    { type: 'quote', quote: { rich_text: rt('quoted') } },
    { type: 'divider', divider: {} },
    { type: 'code', code: { rich_text: rt('const a = 1;'), language: 'javascript' } },
  ]));
  for (const frag of ['# Problem statement', '## Signals', '- first', '1. second', '- [x] done', '- [ ] not done', '> quoted', '---', '```javascript', 'const a = 1;']) {
    assert.ok(markdown.includes(frag), `missing ${JSON.stringify(frag)} in:\n${markdown}`);
  }
});

test('annotations render in a fixed order, and a code span is literal', () => {
  assert.equal(richText(rt('x', { bold: true, italic: true })), '***x***');
  assert.equal(richText(rt('a_b', { code: true })), '`a_b`', 'a code span must not be escaped inside');
  assert.equal(richText([{ plain_text: 'link', href: 'https://x.example' }]), '[link](https://x.example)');
});

test('markdown metacharacters in page text cannot restructure the document', () => {
  const { markdown } = exportPage(page([p('a * b _ c [d](e) | f')]));
  assert.ok(!/(^|[^\\])\*/m.test(markdown.split('\n').slice(2).join('\n')), `unescaped * in:\n${markdown}`);
});

test('a table renders with its header separator, and cell pipes are escaped', () => {
  const row = (...cells) => ({ type: 'table_row', table_row: { cells: cells.map((c) => rt(c)) } });
  const { markdown } = exportPage(page([{
    type: 'table', table: { table_width: 2 },
    children: [row('Element', 'Rating'), row('a|b', 'high')],
  }]));
  assert.ok(markdown.includes('| Element | Rating |'), markdown);
  assert.ok(markdown.includes('|---|---|'), markdown);
  assert.ok(markdown.includes('a\\|b'), 'a pipe inside a cell must not add a column');
});

test('nested children are indented, not flattened', () => {
  const { markdown } = exportPage(page([{
    type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('parent') }, has_children: true,
    children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('child') } }],
  }]));
  assert.ok(/^- parent$/m.test(markdown) && /^ {2}- child$/m.test(markdown), markdown);
});

// --- determinism --------------------------------------------------------------------------------

test('the same page exports to the same bytes, whatever order the keys arrive in', () => {
  const a = exportPage(page([p('x')], { frontmatter: { artifact: 'problem-statement', run: 'r1', stage: 'define' } }));
  const b = exportPage(page([p('x')], { frontmatter: { stage: 'define', run: 'r1', artifact: 'problem-statement' } }));
  assert.equal(a.markdown, b.markdown, 'frontmatter key order must not change the bytes');
  assert.equal(a.digest, b.digest);
});

test('the digest is over the markdown exactly as written, and the tail is stable', () => {
  const { markdown, digest } = exportPage(page([p('x')]));
  assert.equal(digest, sha256(markdown));
  assert.ok(markdown.endsWith('\n') && !markdown.endsWith('\n\n'), 'exactly one trailing newline');
});

// --- fails closed: the property that matters ----------------------------------------------------

// Found against the LIVE API, not a fixture. The vendor renamed this payload key from `text` to
// `rich_text` at the 2022-06-28 version. Under an older pin every block still arrives — right type,
// right count, right order — and only the key differs. `richText()` used to answer '' for a missing
// field, so the page exported cleanly and produced a stable digest over almost nothing: 1619 bytes
// where the same page yields 4157. A version pin is set once and never looked at again, which is
// precisely what made this dangerous.
test('a block whose rich_text is ABSENT aborts — absent is not empty', () => {
  const wrongKey = { type: 'paragraph', paragraph: { text: rt('content the old API put under `text`'), color: 'default' } };
  const { markdown, findings } = tryExport(page([wrongKey]), { slug: 's' });
  assert.equal(markdown, null, 'a page of empty blocks must never export');
  assert.match(findings[0], /Absent is not empty/);
  assert.match(findings[0], /2022-06-28/, 'the message must name the likely cause');
});

test('an EMPTY rich_text array is still fine — an empty paragraph is a real thing to write', () => {
  const { markdown, findings } = tryExport(page([{ type: 'paragraph', paragraph: { rich_text: [] } }, p('after')]), { slug: 's' });
  assert.deepEqual(findings, []);
  assert.match(markdown, /after/);
});

test('a code block with an absent rich_text aborts too, not just prose blocks', () => {
  const { markdown, findings } = tryExport(page([{ type: 'code', code: { text: rt('x'), language: 'bash' } }]), { slug: 's' });
  assert.equal(markdown, null);
  assert.match(findings[0], /code block carries no `rich_text`/);
});

test('an unknown block type ABORTS the export — it is never dropped', () => {
  const { markdown, findings } = tryExport(page([p('kept'), { type: 'invented_block', invented_block: {} }]));
  assert.equal(markdown, null, 'nothing is written when any block cannot be rendered');
  assert.match(findings[0], /invented_block/);
  assert.match(findings[0], /worse than no document/);
});

test('every deliberately refused type aborts, and says why', () => {
  for (const type of REFUSED.keys()) {
    const { markdown, findings } = tryExport(page([{ type, [type]: {} }]));
    assert.equal(markdown, null, `${type} must abort`);
    assert.match(findings[0], new RegExp(`\`${type}\` is refused`));
  }
});

test('a truncated block list aborts — a fragment must never be frozen as a whole', () => {
  const { markdown, findings } = tryExport(page([p('only the first page of blocks')], { has_more: true }));
  assert.equal(markdown, null);
  assert.match(findings[0], /truncated/);
  assert.match(findings[0], /incomplete artifact as a complete one/);
});

// This is what a permission gap looks like from inside a pure function: the parent says it has
// children and none arrived. Rendering the parent alone would drop them in silence.
test('a block that declares children but carries none aborts', () => {
  const { markdown, findings } = tryExport(page([{
    type: 'paragraph', paragraph: { rich_text: rt('parent') }, has_children: true,
  }]));
  assert.equal(markdown, null);
  assert.match(findings[0], /permission gap/);
});

test('a ragged table aborts rather than shifting columns', () => {
  const row = (...cells) => ({ type: 'table_row', table_row: { cells: cells.map((c) => rt(c)) } });
  const { findings } = tryExport(page([{
    type: 'table', table: { table_width: 2 }, children: [row('a', 'b'), row('c')],
  }]));
  assert.match(findings[0], /has 1 cells, table_width is 2/);
});

test('a table whose rows were not read aborts — an empty table reads as an answered question', () => {
  const { findings } = tryExport(page([{ type: 'table', table: { table_width: 2 } }]));
  assert.match(findings[0], /reads as an answered question/);
});

test('the abort names where the block is, so an author can find it', () => {
  const { findings } = tryExport(page([p('a'), p('b'), { type: 'nope', nope: {} }]), { slug: 'run-7' });
  assert.match(findings[0], /run-7 › block\[2\]/);
});

test('no refused type is also listed as supported', () => {
  for (const t of REFUSED.keys()) assert.ok(!SUPPORTED.has(t), `${t} cannot be both`);
});

// --- the freeze stamp ---------------------------------------------------------------------------

test('a stamp verifies its file, and an edit after the freeze is a finding', () => {
  const { markdown, digest } = exportPage(page([p('the frozen text')]));
  const stamp = freezeStamp({ slug: 'r1', file: 'problem-statement.md', digest, exportedAt: '2026-07-25T10:00:00Z', exportedBy: 'svc-floor-freezer' });
  assert.deepEqual(verifyStamp(stamp, markdown), []);
  const f = verifyStamp(stamp, `${markdown}one quick fix in the repo\n`);
  assert.equal(f.length, 1);
  assert.match(f[0], /does not match its freeze stamp/);
  assert.match(f[0], /re-freeze it rather than editing in place/);
});

test('a missing file, a missing stamp and a wrong schema are each refused', () => {
  const stamp = freezeStamp({ slug: 'r1', file: 'x.md', digest: sha256('x') });
  assert.match(verifyStamp(stamp, null)[0], /is missing/);
  assert.match(verifyStamp(null, 'x')[0], /no freeze stamp/);
  assert.match(verifyStamp({ ...stamp, schema: 'other/v1' }, 'x')[0], /is not loom\.freeze-stamp\/v1/);
});

test('the stamp carries no clock of its own — the caller supplies the time', () => {
  const s = freezeStamp({ slug: 'r1', file: 'x.md', digest: sha256('x') });
  assert.equal(s.exported_at, null, 'a module with a clock cannot be deterministic');
  assert.equal(s.exported_by, null);
});

// --- the shipped worked example -------------------------------------------------------------

const EX = FIND('floor-export-example/fetched-page.json');
if (!EX) {
  test('shipped export example (bundle-only — skipped in this layout)', { skip: true }, () => {});
} else {
  test('the shipped example exports, and its lists stay tight', () => {
    const { markdown, findings } = tryExport(JSON.parse(readFileSync(EX, 'utf8')));
    assert.deepEqual(findings, []);
    assert.ok(/- Fewer than 1 in 20[^\n]*\n- Those who do/.test(markdown), `list must be tight:\n${markdown}`);
    assert.ok(markdown.includes('| Signal | Source | Strength |'));
  });

  test('the shipped ABORT example refuses, and writes nothing', () => {
    const path = FIND('floor-export-example/fetched-page-aborts.json');
    const { markdown, findings } = tryExport(JSON.parse(readFileSync(path, 'utf8')));
    assert.equal(markdown, null);
    assert.match(findings[0], /truncated/);
  });
}
