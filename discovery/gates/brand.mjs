// Brand-profile (design.md) parsing + the D7 conformance check. Pure Node.
import { read } from './lib.mjs';

export const MARKER = 'discovery/brand/design.md';

/** Extract the allow-listed token VALUES from design.md so rendered artifacts can be checked
 *  against them: every hex/font that appears in a visual artifact must be a defined token. */
export function parseBrand(designMdPath) {
  const text = read(designMdPath);
  const hexes = new Set((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()));
  // font-family token values live in backticked cells, e.g. `"Inter", ... sans-serif`
  const fonts = new Set();
  for (const m of text.matchAll(/`([^`]*(?:sans-serif|serif|monospace)[^`]*)`/g)) {
    fonts.add(normFont(m[1]));
  }
  return { hexes, fonts, present: text.length > 0, version: (text.match(/profile_version:\s*(\d+)/) || [])[1] || '1' };
}

function normFont(s) {
  return s.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

/** D7 for a rendered HTML/visual artifact: marker present, and every literal colour/font it
 *  uses is a defined design.md token value (tokens-only, enforced on output). */
export function checkVisualHtml(path, html, brand) {
  const issues = [];
  if (!html.includes(MARKER)) {
    issues.push(`${path}: missing brand marker '${MARKER}'`);
  }
  const usedHex = new Set((html.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()));
  for (const h of usedHex) {
    if (!brand.hexes.has(h)) issues.push(`${path}: raw colour ${h} is not a design.md token`);
  }
  for (const m of html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)) {
    const f = m[1].toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    const ok = [...brand.fonts].some((tok) => tok === f || tok.includes(f) || f.includes(tok));
    if (!ok) issues.push(`${path}: font-family '${m[1].trim()}' is not a design.md token`);
  }
  return issues;
}

/** D7 for a markdown artifact: must declare the design_profile front-matter. */
export function checkVisualMarkdown(path, fm) {
  return fm.design_profile === MARKER ? [] : [`${path}: front-matter design_profile must be '${MARKER}'`];
}
