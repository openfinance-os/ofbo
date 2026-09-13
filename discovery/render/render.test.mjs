// Tests for the branded renderers. `node --test`. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, writingMode } from './render.mjs';
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

test('a crafted tile.status cannot break out of the CSS var() into markup', () => {
  const html = render('prototype', {
    title: 'T', wordmark: 'D',
    tiles: [{ label: 'L', value: 'V', status: 'x)"><script>alert(1)</script>' }],
  }, brand);
  assert.ok(!html.includes('<script>alert(1)'), 'status must not inject a script tag');
  // the sanitized token keeps only [a-z0-9-]
  assert.ok(html.includes('var(--xscriptalert1script)'), 'status reduced to a bare token');
});

test('unknown mode throws', () => {
  assert.throws(() => render('poster', {}, brand));
});

// --- writing direction (F5) ----------------------------------------------------------------
// The shell emitted a hard-coded `<html lang="en">` with no dir, and every direction-sensitive
// rule was a physical property — RTL was not expressible at all, by any brand.

test('lang/dir parse from brand front-matter, with defaults for a profile that says nothing', () => {
  assert.equal(brand.lang, 'en');
  assert.equal(brand.dir, 'ltr');
  const bare = parseTokens(resolve(ROOT, 'discovery/brand/examples/meridian-trust.design.md'));
  assert.equal(bare.lang, 'en', 'a profile with no lang: keeps the default');
  assert.equal(bare.dir, 'ltr', 'a profile with no dir: keeps the default');
});

test('an LTR brand renders byte-identically apart from the added dir attribute', () => {
  for (const mode of ['document', 'deck', 'prototype']) {
    const html = render(mode, SPECS[mode], brand);
    assert.ok(html.includes('<html lang="en" dir="ltr">'), `${mode}: both attributes emitted`);
    // Everything else is unchanged: removing the attribute restores the previous shell exactly.
    assert.ok(html.replace(' dir="ltr"', '').includes('<html lang="en">'), `${mode}: nothing else moved`);
  }
});

test('flipping dir changes ONE attribute and nothing else — no conditional CSS', () => {
  // The proof that mirroring comes from logical properties: same brand, same content, dir
  // overridden per artifact. If any rule were direction-specific, the two would differ elsewhere.
  for (const mode of ['document', 'deck', 'prototype']) {
    const ltr = render(mode, SPECS[mode], brand);
    const rtl = render(mode, { ...SPECS[mode], dir: 'rtl' }, brand);
    assert.equal(ltr.replace('dir="ltr"', 'dir="rtl"'), rtl, `${mode}: only the attribute differs`);
  }
});

test('no physical direction property survives in any renderer', () => {
  const PHYSICAL = /(border|margin|padding)-(left|right)\s*:|(^|[;{\s])(left|right)\s*:\s*[\d.]|text-align\s*:\s*(left|right)/;
  for (const mode of ['document', 'deck', 'prototype']) {
    const css = (render(mode, SPECS[mode], brand).match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    assert.ok(!PHYSICAL.test(css), `${mode}: physical direction property in the stylesheet`);
  }
  assert.ok(render('document', SPECS.document, brand).includes('border-inline-start'), 'logical property in use');
});

test('lang/dir are allow-listed, not escaped — a crafted value cannot reach the attribute', () => {
  const evil = { lang: '" onload="x', dir: 'rtl" onload="x' };
  const html = render('document', { ...SPECS.document, ...evil }, brand);
  assert.ok(!html.includes('onload'), 'rejected value must not be emitted at all');
  assert.ok(html.includes('<html lang="en" dir="ltr">'), 'falls back to the brand/default pair');
  // A regional tag is legitimate and survives; garbage does not.
  assert.deepEqual(writingMode({ lang: 'ar-AE' }, brand), { lang: 'ar-AE', dir: 'ltr' });
  assert.deepEqual(writingMode({ dir: 'sideways' }, brand), { lang: 'en', dir: 'ltr' });
});

// The direction seam, proved the same way the colour seam is: a third brand file, no code change.
test('the RTL example brand renders right-to-left and stays D7-conformant', () => {
  const RTL = resolve(ROOT, 'discovery/brand/examples/rtl-demo.design.md');
  const rtlBrand = parseTokens(RTL);
  const rtlTokens = parseBrand(RTL);
  assert.equal(rtlBrand.dir, 'rtl');
  assert.equal(rtlBrand.lang, 'ar');

  const html = render('prototype', SPECS.prototype, rtlBrand);
  assert.ok(html.includes('<html lang="ar" dir="rtl">'), 'direction comes from the brand alone');
  assert.ok(html.includes(MARKER));
  assert.equal(checkVisualHtml('rtl.html', html, rtlTokens).length, 0, 'D7 against its own brand');
  // …and D7 is real: the RTL brand's output fails the demo brand's token allow-list, and vice versa.
  assert.ok(checkVisualHtml('rtl.html', html, brandTokens).length > 0);
  assert.ok(checkVisualHtml('d.html', render('prototype', SPECS.prototype, brand), rtlTokens).length > 0);
});

test('the RTL example font stack is harvested by D7 (it ends in a generic family)', () => {
  // parseBrand only harvests backticked stacks ending in sans-serif|serif|monospace. A stack that
  // does not is invisible to the allow-list, so every artifact using it fails D7 for a token the
  // brand file defines — a self-inflicted failure with a confusing message.
  const rtlTokens = parseBrand(resolve(ROOT, 'discovery/brand/examples/rtl-demo.design.md'));
  const stack = parseTokens(resolve(ROOT, 'discovery/brand/examples/rtl-demo.design.md')).tokens['font.family.sans'];
  assert.ok(/(sans-serif|serif|monospace)$/.test(stack.trim()), 'stack ends in a generic family');
  assert.ok([...rtlTokens.fonts].some((f) => f.includes('noto naskh arabic')), 'harvested into the D7 allow-list');
});

// The seam: the SAME content rendered against a SECOND brand is a different-looking,
// still-conformant artifact — with no change to the renderer. This is the solution-agnostic
// proof, mechanically.
test('swapping the brand seam re-skins identical content (no code change)', () => {
  const MERIDIAN = resolve(ROOT, 'discovery/brand/examples/meridian-trust.design.md');
  const meridian = parseTokens(MERIDIAN);
  const meridianTokens = parseBrand(MERIDIAN);

  const demoHtml = render('deck', SPECS.deck, brand);
  const meridianHtml = render('deck', SPECS.deck, meridian);

  // Same machinery, both branded + marked.
  assert.ok(demoHtml.includes(MARKER) && meridianHtml.includes(MARKER));
  // Different brand actually applied: demo blue/Inter vs Meridian purple/serif.
  assert.ok(demoHtml.includes('#1F4DB8') && !demoHtml.includes('#5B2A86'));
  assert.ok(meridianHtml.includes('#5B2A86') && !meridianHtml.includes('#1F4DB8'));
  assert.ok(meridianHtml.includes('Georgia') && !meridianHtml.includes('Inter'));
  assert.notEqual(demoHtml, meridianHtml);

  // Each output is D7-conformant against ITS OWN brand…
  assert.equal(checkVisualHtml('d.html', demoHtml, brandTokens).length, 0);
  assert.equal(checkVisualHtml('d.html', meridianHtml, meridianTokens).length, 0);
  // …and D7 is a real check: each fails against the OTHER brand's token allow-list.
  assert.ok(checkVisualHtml('d.html', meridianHtml, brandTokens).length > 0);
  assert.ok(checkVisualHtml('d.html', demoHtml, meridianTokens).length > 0);
});
