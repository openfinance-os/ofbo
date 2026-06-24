// Tests for the branded renderers. `node --test`. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './render.mjs';
import { parseTokens } from './tokens.mjs';
import { parseBrand, checkVisualHtml, MARKER } from '../gates/brand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DESIGN = resolve(ROOT, 'discovery/brand/design.md');
const brand = parseTokens(DESIGN);
const brandTokens = parseBrand(DESIGN); // hex/font allow-list for the D7 check

const SPECS = {
  document: { title: 'Doc', subtitle: 'sub', sections: [{ heading: 'H', blocks: [{ p: 'para' }, { list: ['a', 'b'] }, { table: { headers: ['x'], rows: [['1']] } }, { note: 'n' }] }] },
  deck: { title: 'Deck', subtitle: 's', slides: [{ title: 'S1', kicker: 'k', bullets: ['one', 'two'], note: 'n' }] },
  prototype: { title: 'Proto', intro: 'i', tiles: [{ label: 'L', value: '9.4s', status: 'danger', pill: 'breach', sub: 'sub' }], table: { label: 'T', headers: ['a'], rows: [['1']] }, affordance: { label: 'Export', text: 'ghost' } },
};

test('tokens parse from design.md', () => {
  assert.equal(brand.tokens['color.brand.primary'], '#1F4DB8');
  assert.ok(brand.tokens['font.family.sans'].includes('Inter'));
});

for (const mode of ['document', 'deck', 'prototype']) {
  test(`${mode} renders, carries the marker, and is brand-conformant (D7)`, () => {
    const html = render(mode, SPECS[mode], brand);
    assert.ok(html.includes(MARKER), 'marker present');
    const issues = checkVisualHtml(`${mode}.html`, html, brandTokens);
    assert.equal(issues.length, 0, 'D7 issues: ' + JSON.stringify(issues));
  });

  test(`${mode} is deterministic`, () => {
    assert.equal(render(mode, SPECS[mode], brand), render(mode, SPECS[mode], brand));
  });
}

test('content is HTML-escaped (no injection)', () => {
  const html = render('document', { title: 'T', sections: [{ heading: '<x>', blocks: [{ p: '<script>bad</script>' }] }] }, brand);
  assert.ok(!html.includes('<script>bad'), 'script content escaped');
  assert.ok(html.includes('&lt;script&gt;bad'));
});

test('unknown mode throws', () => {
  assert.throws(() => render('poster', {}, brand));
});
