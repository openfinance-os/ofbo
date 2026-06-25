// Shared helpers for the discovery gate validator. Pure Node, zero deps.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PLACEHOLDER = /<[^>\n]+>|\bTBD\b|\bTODO\b|^\s*\|\s*\|\s*$/;

/** Read a UTF-8 file, or return '' if absent. */
export function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Split simple `key: value` YAML front-matter from a markdown body. */
export function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\w.-]+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

/** Content under a `## Heading` (until the next `##`/`#` of same-or-higher level). */
export function section(text, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'mi');
  const m = text.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^#{1,2}\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Rows of a markdown table inside `block`, as arrays of trimmed cells (no header/sep). */
export function tableRows(block) {
  const rows = [];
  for (const line of block.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // separator row
    const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

/** A table row counts as "filled" when ≥1 cell has real content (no placeholder). */
export function filledRows(block, headerHints = []) {
  return tableRows(block).filter((cells, i) => {
    if (i === 0 && headerHints.some((h) => cells.join(' ').toLowerCase().includes(h))) return false;
    const meaningful = cells.filter((c) => c && !PLACEHOLDER.test(c));
    return meaningful.length > 0;
  });
}

/** Has the heading any non-placeholder prose/rows? */
export function hasContent(block) {
  if (!block) return false;
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.some((l) => !PLACEHOLDER.test(l) && l.replace(/[|>#*\-\s]/g, '').length > 0);
}

/** All signal ids (S-001 …) mentioned in a text. */
export function signalIds(text) {
  return new Set((text.match(/\bS-\d{2,}\b/g) || []));
}

/** All DR-* ids: categories (DR-2.1), domains (DR-2), risk statements (DR-2.1-001). */
export function drIds(text) {
  return new Set((text.match(/\bDR-\d+(?:\.\d+)?(?:-\d+)?\b/g) || []));
}

/** All CTRL-* control ids. */
export function ctrlIds(text) {
  return new Set((text.match(/\bCTRL-[A-Z0-9-]+\b/g) || []));
}

export function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
}
