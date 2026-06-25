#!/usr/bin/env node
// Self-contained branded renderers — document, deck, prototype. Pure Node, zero deps, NO
// external tool or service (no Stitch / Magic Patterns / Gamma). Structured content in,
// presentation out of design.md tokens. Output is one self-contained HTML file carrying the
// D7 brand marker; print a document to PDF, present a deck full-screen.
//
//   node discovery/render/render.mjs <document|deck|prototype> <spec.json> <out.html> [--brand <design.md>]
//
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTokens, tokenResolver } from './tokens.mjs';
import { MARKER } from '../gates/brand.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Shared branded shell. All colours/fonts come from tokens, so D7 (tokens-only) holds by
 *  construction. Layout px are literal (D7 checks colour + font, not spacing). */
function shell({ title, body, t, version, banner, extraCss = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- ${MARKER}@v${version} -->
<title>${esc(title)}</title>
<style>
  :root {
    --brand:${t('color.brand.primary')}; --on-brand:${t('color.brand.primary-ink')};
    --accent:${t('color.brand.accent')}; --warn:${t('color.status.warn')}; --danger:${t('color.status.danger')};
    --bg:${t('color.surface.bg')}; --card:${t('color.surface.card')};
    --ink:${t('color.ink.strong')}; --muted:${t('color.ink.muted')}; --border:${t('color.border.subtle')};
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:${t('font.family.sans')}; color:var(--ink); background:var(--bg); }
  .demo-banner { background:var(--warn); color:var(--on-brand); text-align:center;
    font-size:13px; padding:6px; letter-spacing:.04em; }
  .wordmark { color:var(--brand); font-weight:600; font-size:18px; }
  a { color:var(--brand); }
  ${extraCss}
</style>
</head>
<body>
<div class="demo-banner">${esc(banner)}</div>
${body}
</body>
</html>
`;
}

function blocks(list, _t) {
  return (list || []).map((b) => {
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.note) return `<div class="note">${esc(b.note)}</div>`;
    if (b.list) return `<ul>${b.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    if (b.table) {
      const h = `<tr>${b.table.headers.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
      const r = b.table.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      return `<table><thead>${h}</thead><tbody>${r}</tbody></table>`;
    }
    return '';
  }).join('\n');
}

export function renderDocument(spec, brand) {
  const t = tokenResolver(brand.tokens);
  const sections = (spec.sections || []).map((s) =>
    `<section><h2>${esc(s.heading)}</h2>${blocks(s.blocks, t)}</section>`).join('\n');
  const body = `<div class="wrap">
    <header class="cover">
      <span class="wordmark">${esc(spec.wordmark || 'OFBO')}</span>
      <h1>${esc(spec.title)}</h1>
      ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
    </header>
    ${sections}
  </div>`;
  const extraCss = `
    .wrap { max-width:820px; margin:0 auto; padding:40px 24px; }
    .cover { border-bottom:2px solid var(--brand); padding-bottom:16px; margin-bottom:24px; }
    h1 { font-size:28px; margin:8px 0 4px; } h2 { font-size:22px; margin:24px 0 8px; }
    .sub { color:var(--muted); font-size:13px; }
    p, li { font-size:15px; line-height:1.5; }
    .note { border-left:3px solid var(--brand); background:var(--card); padding:8px 12px; color:var(--muted); font-size:13px; }
    table { width:100%; border-collapse:collapse; margin:8px 0; font-size:13px; }
    th { background:var(--brand); color:var(--on-brand); text-align:left; padding:6px 8px; }
    td { padding:6px 8px; border-bottom:1px solid var(--border); }
    @media print { .demo-banner { position:fixed; top:0; left:0; right:0; } .wrap { padding-top:48px; } }`;
  return shell({ title: spec.title, body, t, version: brand.version, banner: brand.banner, extraCss });
}

export function renderDeck(spec, brand) {
  const t = tokenResolver(brand.tokens);
  const slides = [{ cover: true, title: spec.title, note: spec.subtitle }, ...(spec.slides || [])];
  const html = slides.map((s, i) => {
    const inner = s.cover
      ? `<span class="wordmark">${esc(spec.wordmark || 'OFBO')}</span><h1>${esc(s.title)}</h1>${s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}`
      : `${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}<h2>${esc(s.title)}</h2>
         ${s.bullets ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
         ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}`;
    return `<section class="slide${s.cover ? ' cover' : ''}"${i === 0 ? '' : ' hidden'}>${inner}<div class="pageno">${i + 1} / ${slides.length}</div></section>`;
  }).join('\n');
  const extraCss = `
    .slide { position:fixed; inset:28px 0 0 0; display:flex; flex-direction:column; justify-content:center;
      padding:0 64px; background:var(--bg); }
    .slide.cover { background:var(--card); }
    h1 { font-size:40px; margin:8px 0; } h2 { font-size:30px; margin:0 0 16px; }
    .kicker { color:var(--brand); font-weight:600; text-transform:uppercase; letter-spacing:.06em; font-size:13px; }
    li { font-size:20px; line-height:1.7; } .sub { color:var(--muted); }
    .note { color:var(--muted); border-left:3px solid var(--brand); padding:8px 12px; font-size:15px; margin-top:16px; }
    .pageno { position:absolute; bottom:24px; right:64px; color:var(--muted); font-size:13px; }`;
  const nav = `<script>
    var i=0,s=document.querySelectorAll('.slide');
    function go(n){s[i].hidden=true;i=Math.max(0,Math.min(s.length-1,n));s[i].hidden=false;}
    document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' ')go(i+1);if(e.key==='ArrowLeft')go(i-1);});
    document.addEventListener('click',function(){go(i+1);});
  </script>`;
  return shell({ title: spec.title, body: html + nav, t, version: brand.version, banner: brand.banner, extraCss });
}

export function renderPrototype(spec, brand) {
  const t = tokenResolver(brand.tokens);
  const tiles = (spec.tiles || []).map((tile) => {
    const pill = tile.status ? `<span class="pill" style="background:var(--${tile.status === 'ok' ? 'accent' : tile.status})">${esc(tile.pill || tile.status)}</span>` : '';
    return `<div class="card"><div class="label">${esc(tile.label)}</div>
      <div class="metric">${esc(tile.value || '')} ${pill}</div>
      ${tile.sub ? `<div class="sub">${esc(tile.sub)}</div>` : ''}</div>`;
  }).join('\n');
  const table = spec.table ? `<div class="card full"><div class="label">${esc(spec.table.label || '')}</div>
    <table><thead><tr>${spec.table.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${spec.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  const ghost = spec.affordance ? `<div class="card full"><div class="label">${esc(spec.affordance.label)}</div>
    <div class="ghost">${esc(spec.affordance.text)}</div></div>` : '';
  const body = `<div class="wrap">
    <div class="topbar"><span class="wordmark">${esc(spec.wordmark || 'OFBO')}</span>
      <span class="sub">${esc(spec.context || 'Discovery prototype')}</span></div>
    <h1>${esc(spec.title)}</h1>
    ${spec.intro ? `<div class="sub intro">${esc(spec.intro)}</div>` : ''}
    <div class="grid">${tiles}${table}${ghost}</div>
  </div>`;
  const extraCss = `
    .wrap { max-width:960px; margin:0 auto; padding:24px; }
    .topbar { display:flex; align-items:center; justify-content:space-between; }
    h1 { font-size:22px; margin:16px 0 4px; } .intro { margin-bottom:24px; }
    .sub { color:var(--muted); font-size:13px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; }
    .full { grid-column:1 / -1; }
    .label { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.04em; }
    .metric { font-size:28px; font-weight:600; margin-top:8px; }
    .pill { display:inline-block; font-size:13px; padding:2px 8px; border-radius:4px; color:var(--on-brand); }
    table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
    th { text-align:left; background:var(--brand); color:var(--on-brand); padding:6px 8px; }
    td { padding:6px 8px; border-bottom:1px solid var(--border); }
    .ghost { color:var(--muted); border:1px dashed var(--border); border-radius:4px; padding:10px; font-size:13px; }`;
  return shell({ title: spec.title, body, t, version: brand.version, banner: brand.banner, extraCss });
}

const RENDERERS = { document: renderDocument, deck: renderDeck, prototype: renderPrototype };

export function render(mode, spec, brand) {
  const fn = RENDERERS[mode];
  if (!fn) throw new Error(`unknown mode '${mode}' (document|deck|prototype)`);
  return fn(spec, brand);
}

// ---- CLI -------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  const [mode, specPath, outPath] = args.filter((a) => !a.startsWith('--'));
  const brandIdx = args.indexOf('--brand');
  if (!mode || !specPath || !outPath) {
    console.error('usage: render.mjs <document|deck|prototype> <spec.json> <out.html> [--brand <design.md>]');
    process.exit(2);
  }
  const brand = parseTokens(brandIdx >= 0 ? args[brandIdx + 1] : undefined);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  writeFileSync(outPath, render(mode, spec, brand));
  console.log(`rendered ${mode} -> ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
