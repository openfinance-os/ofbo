#!/usr/bin/env node
// Render real Office files (.xlsx/.docx/.pptx) from a JSON spec, against design.md tokens.
// Pure Node, zero dependencies — no Office, no Stitch/Magic Patterns/Gamma, no libraries.
//
//   node discovery/render/render-office.mjs <xlsx|docx|pptx> <spec.json> <out> [--brand <design.md>]
//
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTokens, tokenResolver } from './tokens.mjs';
import { BUILDERS } from './office/ooxml.mjs';

export function renderOffice(fmt, spec, brandObj) {
  const build = BUILDERS[fmt];
  if (!build) throw new Error(`unknown format '${fmt}' (expected xlsx|docx|pptx)`);
  return build(spec, tokenResolver(brandObj.tokens));
}

function main(argv) {
  const args = argv.slice(2);
  const [fmt, specPath, outPath] = args.filter((a) => !a.startsWith('--'));
  const bi = args.indexOf('--brand');
  const brandPath = bi >= 0 ? args[bi + 1] : 'discovery/brand/design.md';
  if (!fmt || !specPath || !outPath) {
    console.error('usage: render-office.mjs <xlsx|docx|pptx> <spec.json> <out> [--brand <design.md>]');
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const buf = renderOffice(fmt, spec, parseTokens(brandPath));
  writeFileSync(outPath, buf);
  console.log(`rendered ${fmt} -> ${outPath} (${buf.length} bytes, brand ${brandPath})`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
