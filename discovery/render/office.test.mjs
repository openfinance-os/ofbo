// Tests for the real OOXML builders (.xlsx/.docx/.pptx). `node --test`. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDERS } from './office/ooxml.mjs';
import { zip, readZip } from './office/zip.mjs';
import { parseTokens, tokenResolver } from './tokens.mjs';
import { parseBrand, checkVisualOoxml } from '../gates/brand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OFBO = resolve(ROOT, 'discovery/brand/design.md');
const MERIDIAN = resolve(ROOT, 'discovery/brand/examples/meridian-trust.design.md');
const t = (p) => tokenResolver(parseTokens(p).tokens);

const SPECS = {
  xlsx: { title: 'Sheet', sheetName: 'S', columns: ['A', 'B'], rows: [['x', { v: 'breach', status: 'danger' }], ['y', { v: 'ok', status: 'ok' }]] },
  docx: { title: 'Doc', subtitle: 'sub', sections: [{ heading: 'H', blocks: [{ p: 'para' }, { list: ['a', 'b'] }, { table: { headers: ['c1'], rows: [['v1']] } }, { note: 'n' }] }] },
  pptx: { title: 'Deck', subtitle: 's', slides: [{ title: 'S1', kicker: 'k', bullets: ['one', 'two'], note: 'n' }] },
};
const EXT = { xlsx: '.xlsx', docx: '.docx', pptx: '.pptx' };

test('zip round-trips a STORED entry', () => {
  const buf = zip([{ name: 'a/b.xml', data: 'hello' }]);
  assert.equal(readZip(buf)['a/b.xml'].toString('utf8'), 'hello');
});

for (const fmt of ['xlsx', 'docx', 'pptx']) {
  const brandTokens = parseBrand(OFBO);

  test(`${fmt}: valid package, marker embedded, D7-conformant`, () => {
    const buf = BUILDERS[fmt](SPECS[fmt], t(OFBO));
    assert.ok(Buffer.isBuffer(buf));
    const parts = readZip(buf);
    assert.ok(parts['[Content_Types].xml'], 'has content types');
    assert.ok(parts['docProps/core.xml'].includes('discovery/brand/design.md@v1'), 'marker in core props');
    assert.equal(checkVisualOoxml(`out${EXT[fmt]}`, buf, brandTokens).length, 0, 'D7 conformant');
  });

  test(`${fmt}: deterministic (byte-identical on rebuild)`, () => {
    assert.deepEqual(BUILDERS[fmt](SPECS[fmt], t(OFBO)), BUILDERS[fmt](SPECS[fmt], t(OFBO)));
  });

  test(`${fmt}: brand seam swaps — Meridian output fails D7 against OFBO tokens`, () => {
    const meridian = BUILDERS[fmt](SPECS[fmt], t(MERIDIAN));
    assert.equal(checkVisualOoxml(`out${EXT[fmt]}`, meridian, parseBrand(MERIDIAN)).length, 0, 'conformant to its own brand');
    assert.ok(checkVisualOoxml(`out${EXT[fmt]}`, meridian, brandTokens).length > 0, 'rejected by the other brand');
  });
}

test('xlsx header uses the brand primary fill', () => {
  const buf = BUILDERS.xlsx(SPECS.xlsx, t(OFBO));
  const styles = readZip(buf)['xl/styles.xml'].toString('utf8');
  assert.ok(styles.includes('FF1F4DB8'), 'brand primary as ARGB fill');
});

test('content is XML-escaped (no injection)', () => {
  const buf = BUILDERS.docx({ title: 'T', sections: [{ heading: '<x>', blocks: [{ p: 'a & b <z>' }] }] }, t(OFBO));
  const doc = readZip(buf)['word/document.xml'].toString('utf8');
  assert.ok(!doc.includes('<z>'), 'raw tag escaped');
  assert.ok(doc.includes('&amp;') && doc.includes('&lt;z&gt;'));
});

test('unknown format throws via builders map', () => {
  assert.equal(BUILDERS.pdf, undefined);
});
