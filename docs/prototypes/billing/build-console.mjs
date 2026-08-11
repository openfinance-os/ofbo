#!/usr/bin/env node
// Injects the engine's run output and the render script into the console template,
// producing one self-contained HTML file with no external dependencies.
//
//   node run.mjs && node build-console.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const data = readFileSync(here('./out/run.json'), 'utf8');
const tpl = readFileSync(here('./console.template.html'), 'utf8');
const render = readFileSync(here('./console.render.js'), 'utf8');

// `</script>` inside JSON string values would close the host script tag early.
const safe = data.replace(/<\/script/gi, '<\\/script');

const html = tpl
  .replace('__RUN_DATA__', () => safe)
  .replace('__RENDER__', () => render);

const outPath = here('./ofbo-billing-console.html');
writeFileSync(outPath, html);
console.log(`ofbo-billing-console.html — ${(html.length / 1024).toFixed(0)} KB, self-contained`);
