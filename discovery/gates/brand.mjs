// Brand-profile (design.md) parsing + the D7 conformance check. Pure Node.
import { read } from './lib.mjs';
import { readZip } from '../render/office/zip.mjs'; // zip.mjs imports nothing → no cycle

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

const OOXML_EXT = { '.xlsx': 'xlsx', '.docx': 'docx', '.pptx': 'pptx' };
export const isOoxml = (name) => name.slice(name.lastIndexOf('.')) in OOXML_EXT;

// Content parts whose colours must be tokens; framework boilerplate (theme/master/layout,
// which carry standard Office colours) is excluded. Kept here to avoid a brand↔ooxml cycle.
const CONTENT_PART = {
  xlsx: (n) => n === 'xl/styles.xml' || n.startsWith('xl/worksheets/'),
  docx: (n) => n === 'word/document.xml',
  pptx: (n) => n.startsWith('ppt/slides/slide'),
};

/** D7 for a rendered OOXML binary (.xlsx/.docx/.pptx): the brand marker is embedded, and
 *  every colour in the CONTENT parts is a design.md token. Reads the STORED package without a
 *  decompression dependency. Synchronous (zip.mjs has no further imports). */
export function checkVisualOoxml(path, buf, brand) {
  const issues = [];
  if (!buf.includes(MARKER)) issues.push(`${path}: missing brand marker '${MARKER}'`);
  const fmt = OOXML_EXT[path.slice(path.lastIndexOf('.'))];
  const isContent = CONTENT_PART[fmt] || (() => false);
  const tokenHex = new Set([...brand.hexes].map((h) => h.replace('#', '').toUpperCase()));
  let parts;
  try { parts = readZip(buf); } catch (e) { return [`${path}: not a readable package (${e.message})`]; }
  for (const [name, data] of Object.entries(parts)) {
    if (!isContent(name)) continue;
    for (const m of data.toString('utf8').matchAll(/(?:srgbClr val|fgColor rgb|w:fill|w:color|fill)="(?:FF)?([0-9A-Fa-f]{6})"/g)) {
      const hex = m[1].toUpperCase();
      if (!tokenHex.has(hex)) issues.push(`${path}:${name}: colour #${hex} is not a design.md token`);
    }
  }
  return issues;
}
