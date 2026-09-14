// The deterministic exporter (Factory Floor WS4 · D4.1). A floor page becomes a frozen artifact
// in `discovery/runs/<slug>/`, and the D-gates re-run on the export — so the thing that passed is
// the thing that landed, not the thing that was on screen.
//
// Two properties carry the whole design, and both are unusual enough to state plainly.
//
// DETERMINISTIC. The same blocks must produce the same bytes, on any machine, in any order of
// object keys, at any time. So there is no clock in here, no locale, no iteration over unsorted
// object keys, and no "smart" formatting that depends on anything but the input. A freeze whose
// output drifted would produce a new digest for unchanged content — every re-freeze would look
// like an edit, and drift detection would become noise nobody reads.
//
// FAILS CLOSED. An unknown block type, a truncated child list, or a block whose children could
// not be read ABORTS the export. It does not skip the block, and it does not export what it
// managed to read. This is the property that is easy to get wrong in the tempting direction: a
// converter that silently drops what it does not understand produces a document that looks
// complete, passes the gates, and is missing the paragraph where someone wrote down the risk.
// Partial evidence presented as whole evidence is worse than no evidence, so there is no partial
// mode and no `--force`.
//
// Deliberately NOT a Notion client. It makes no network call: it takes blocks that have already
// been fetched and returns text. Fetching is the adopter's freezer service, per the adapter
// contract, and keeping the conversion pure is what makes it testable without a workspace.
import { createHash } from 'node:crypto';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.freeze-stamp/v1';

export const sha256 = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

/**
 * Block types this exporter renders. Anything else aborts — see the module header. Adding a type
 * here is a deliberate act: it means someone has decided what that block MEANS in markdown, and
 * that the D-gates can still read the result.
 */
export const SUPPORTED = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do',
  'code', 'quote', 'callout', 'divider', 'table', 'table_row',
]);

/** Types we know exist and deliberately refuse, with the reason an author will need. */
export const REFUSED = new Map([
  ['child_page', 'a nested page is a separate artifact — freeze it on its own, or the export silently flattens a boundary the gates rely on'],
  ['child_database', 'a database is not a document; its rows are records, and flattening them loses the shape a gate reads'],
  ['synced_block', 'a synced block is a view of content that lives elsewhere — freezing it would record a copy whose source can change afterwards'],
  ['image', 'an attachment is not text; it cannot be digested from the page alone and its URL expires'],
  ['file', 'an attachment is not text; it cannot be digested from the page alone and its URL expires'],
  ['pdf', 'an attachment is not text; it cannot be digested from the page alone and its URL expires'],
  ['embed', 'an embed renders someone else\'s content, which is not ours to freeze'],
  ['bookmark', 'a bookmark is a link whose target can change after the freeze'],
  ['link_to_page', 'a link to a page is a reference, not content — the gate would read an empty section as complete'],
  ['unsupported', 'the vendor itself reports this block as unsupported by its API — nothing can be read from it'],
]);

class ExportError extends Error {
  constructor(reason, at) { super(reason); this.name = 'ExportError'; this.at = at; }
}

/** Abort with a message that names WHERE, so an author can find the block on the page. */
const abort = (reason, at) => { throw new ExportError(reason, at); };

/**
 * Notion rich text → markdown. Annotation order is FIXED (code, bold, italic, strikethrough,
 * then link) rather than following the object's key order, because two runs that differ only in
 * key order must produce identical bytes.
 */
export function richText(rt, at = 'rich_text') {
  // ABSENT IS NOT EMPTY, and treating it as empty is how a freeze silently loses a whole page.
  // Found against the live API: the vendor renamed this field from `text` to `rich_text` at the
  // 2022-06-28 version. Under an older pin every block still arrives, with the right type and the
  // right count — only the payload key differs. This function used to answer `''` for a missing
  // field, so the page exported cleanly, aborted nothing, and produced a stable digest over almost
  // no content: 1619 bytes where the same page yields 4157. A misconfigured version pin is exactly
  // the kind of thing that is set once and never looked at again, which is what made it dangerous.
  // An empty ARRAY is still fine — an empty paragraph is a real thing an author can write.
  if (rt === undefined || rt === null) {
    abort('a block carries no `rich_text` at all. Absent is not empty, so this aborts rather than '
      + 'exporting a block with no content. The usual cause is an API version older than the one '
      + 'that renamed `text` to `rich_text` (2022-06-28) — check the pinned version before looking '
      + 'anywhere else', at);
  }
  if (!Array.isArray(rt)) abort('rich_text is not an array', at);
  return rt.map((t, i) => {
    if (!t || typeof t !== 'object') abort(`rich_text[${i}] is not an object`, at);
    // `plain_text` is what the API returns for every type, including mentions and equations —
    // using it means an unrecognised inline type degrades to its text rather than vanishing.
    const raw = typeof t.plain_text === 'string' ? t.plain_text
      : typeof t.text?.content === 'string' ? t.text.content
        : abort(`rich_text[${i}] carries no plain_text — nothing can be read from it`, at);
    const a = t.annotations || {};
    let s = escapeInline(raw);
    if (a.code) s = `\`${raw}\``;            // code spans are literal: no escaping inside
    if (a.bold) s = `**${s}**`;
    if (a.italic) s = `*${s}*`;
    if (a.strikethrough) s = `~~${s}~~`;
    const href = t.href || t.text?.link?.url || null;
    if (typeof href === 'string' && href.length) s = `[${s}](${href})`;
    return s;
  }).join('');
}

/**
 * Escape the markdown metacharacters that would otherwise change the document's structure.
 * `|` is deliberately absent: it is structural only inside a table, and escaping it everywhere
 * would put stray backslashes into ordinary prose. Table cells escape it themselves, including
 * inside code spans — which this function leaves alone — because a pipe there still adds a column.
 */
const escapeInline = (s) => String(s).replace(/([\\`*_[\]<>])/g, '\\$1');

/** Code blocks take their text verbatim — and, like richText(), refuse an absent field. */
const plain = (rt, at = 'code') => {
  if (rt === undefined || rt === null) {
    abort('a code block carries no `rich_text` — absent is not empty (see richText: the field was '
      + '`text` before the 2022-06-28 API version)', at);
  }
  if (!Array.isArray(rt)) abort('code rich_text is not an array', at);
  return rt.map((t) => (typeof t?.plain_text === 'string' ? t.plain_text : t?.text?.content ?? '')).join('');
};

/**
 * One block → its markdown lines. `depth` indents nested list items. Children are rendered
 * recursively, and a block that DECLARES children but carries none aborts: that is what a
 * permission gap looks like from here, and exporting the parent alone would silently drop them.
 */
function renderBlock(block, depth, at) {
  if (!block || typeof block !== 'object') abort('block is not an object', at);
  const type = block.type;
  if (typeof type !== 'string') abort('block has no type', at);
  if (REFUSED.has(type)) abort(`block type \`${type}\` is refused — ${REFUSED.get(type)}`, at);
  if (!SUPPORTED.has(type)) {
    abort(`block type \`${type}\` is not supported by this exporter — the export aborts rather than dropping it, because a document that looks complete and is missing a paragraph is worse than no document`, at);
  }
  const body = block[type] || {};
  const pad = '  '.repeat(depth);
  const lines = [];

  switch (type) {
    case 'paragraph': lines.push(pad + richText(body.rich_text, at)); break;
    case 'heading_1': lines.push(`# ${richText(body.rich_text, at)}`); break;
    case 'heading_2': lines.push(`## ${richText(body.rich_text, at)}`); break;
    case 'heading_3': lines.push(`### ${richText(body.rich_text, at)}`); break;
    case 'bulleted_list_item': lines.push(`${pad}- ${richText(body.rich_text, at)}`); break;
    case 'numbered_list_item': lines.push(`${pad}1. ${richText(body.rich_text, at)}`); break;
    case 'to_do': lines.push(`${pad}- [${body.checked ? 'x' : ' '}] ${richText(body.rich_text, at)}`); break;
    case 'quote': lines.push(`${pad}> ${richText(body.rich_text, at)}`); break;
    case 'divider': lines.push('---'); break;
    case 'code': {
      // Code is taken PLAIN — annotations inside a code block are display, and rendering them
      // would change the bytes an author sees against the bytes a gate reads.
      const lang = typeof body.language === 'string' ? body.language : '';
      lines.push(`\`\`\`${lang === 'plain text' ? '' : lang}`, plain(body.rich_text, at), '```');
      break;
    }
    case 'callout': {
      const icon = typeof body.icon?.emoji === 'string' ? `${body.icon.emoji} ` : '';
      lines.push(`${pad}> ${icon}${richText(body.rich_text, at)}`);
      break;
    }
    case 'table': {
      const rows = block.children;
      if (!Array.isArray(rows)) abort('table carries no rows — a table whose children were not read exports as an empty table, which reads as an answered question', at);
      if (rows.length === 0) abort('table has zero rows', at);
      const width = Number(body.table_width) || (rows[0]?.table_row?.cells || []).length;
      const cells = (r, i) => {
        if (r?.type !== 'table_row') abort(`table child ${i} is ${JSON.stringify(r?.type)}, not table_row`, at);
        const c = r.table_row?.cells;
        if (!Array.isArray(c)) abort(`table row ${i} carries no cells`, at);
        if (c.length !== width) abort(`table row ${i} has ${c.length} cells, table_width is ${width} — a ragged table would silently shift columns`, at);
        // Escape any pipe not already escaped — including inside a code span, where a raw pipe
        // would still add a column and shift every cell to its right.
        return c.map((cell, j) => richText(cell, `${at} · row ${i} cell ${j}`).replace(/(?<!\\)\|/g, '\\|'));
      };
      const head = cells(rows[0], 0);
      lines.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
      for (let i = 1; i < rows.length; i++) lines.push(`| ${cells(rows[i], i).join(' | ')} |`);
      return lines; // rows are the children; do not recurse
    }
    case 'table_row': abort('table_row outside a table', at); break;
    default: abort(`unhandled supported type \`${type}\``, at);
  }

  // A block that says it has children must carry them. `has_children: true` with nothing
  // attached is exactly what a permission gap or an unfetched page looks like from in here.
  if (block.has_children === true && !Array.isArray(block.children)) {
    abort(`block \`${type}\` declares children but none were provided — this is what a permission gap or a partial fetch looks like, and exporting the parent alone would drop them silently`, at);
  }
  for (const [i, child] of (block.children || []).entries()) {
    lines.push(...renderBlock(child, depth + 1, `${at} › ${type}[${i}]`));
  }
  return lines;
}

/**
 * Convert a fetched page into markdown.
 *
 * `page`: { title?, blocks: [...], has_more?: boolean, frontmatter?: {...} }
 * Returns { markdown, digest } — or throws ExportError with a reason an author can act on.
 *
 * `has_more` is the truncation signal: the vendor paginates, and a caller that stopped early
 * would hand us a page that is genuinely incomplete. Exporting it would freeze a fragment.
 */
export function exportPage(page, { slug = '' } = {}) {
  if (!page || typeof page !== 'object') abort('no page to export', slug || 'page');
  const at = slug || page.title || 'page';
  if (page.has_more === true) {
    abort('the block list is truncated (`has_more`) — the page was not fully read, and freezing a fragment would record an incomplete artifact as a complete one', at);
  }
  if (!Array.isArray(page.blocks)) abort('page carries no blocks array', at);

  const out = [];
  // Frontmatter keys are SORTED — the same page must export to the same bytes whatever order the
  // caller happened to build the object in.
  const fm = page.frontmatter && typeof page.frontmatter === 'object' ? page.frontmatter : null;
  if (fm) {
    out.push('---');
    for (const k of Object.keys(fm).sort()) {
      const v = fm[k];
      if (v === undefined || v === null) continue;
      out.push(`${k}: ${typeof v === 'string' && /[:#]/.test(v) ? JSON.stringify(v) : String(v)}`);
    }
    out.push('---', '');
  }
  if (typeof page.title === 'string' && page.title.trim()) out.push(`# ${page.title.trim()}`, '');

  // Consecutive list items stay TIGHT — no blank line between them. A blank line makes markdown
  // render a "loose" list with paragraph spacing, and the frozen file would then differ in style
  // from the hand-authored template it sits beside, for no reason a reader could explain.
  const LIST = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);
  for (const [i, block] of page.blocks.entries()) {
    out.push(...renderBlock(block, 0, `${at} › block[${i}]`));
    const next = page.blocks[i + 1];
    if (LIST.has(block?.type) && next && block.type === next.type) continue;
    out.push('');
  }

  // Exactly one trailing newline, no trailing blank lines: a stable tail keeps the digest stable
  // across callers that do or do not append their own newline.
  const markdown = `${out.join('\n').replace(/\n+$/, '')}\n`;
  return { markdown, digest: sha256(markdown) };
}

/** Try to export; return findings instead of throwing. `[]` ⇒ exported. */
export function tryExport(page, opts) {
  try { return { ...exportPage(page, opts), findings: [] }; } catch (e) {
    if (e.name !== 'ExportError') throw e;
    return { markdown: null, digest: null, findings: [`${e.at}: ${e.message}`] };
  }
}

/**
 * The freeze stamp: what the freezer records beside the exported file so the record can prove,
 * later and offline, that the bytes on disk are the bytes that were exported.
 */
export function freezeStamp({ slug, file, digest, source, exportedAt, exportedBy }) {
  return {
    _comment: 'Written by the freeze round-trip. `digest` is over the exported markdown exactly as committed — scripts/freeze-stamp-check.mjs re-derives it, so an edit to the frozen file after the freeze is a finding, not a silent change.',
    schema: SCHEMA_ID,
    slug,
    file,
    digest,
    source: source || null,          // the floor page this came from
    exported_at: exportedAt || null, // supplied by the caller — this module has no clock
    exported_by: exportedBy || null, // the freezer's registry identity
  };
}

/** Does a frozen file still match its stamp? Findings ([] ⇒ untouched since the freeze). */
export function verifyStamp(stamp, content, label = 'freeze') {
  const findings = [];
  if (!stamp || typeof stamp !== 'object') return [`${label}: no freeze stamp — a frozen artifact with no stamp cannot be shown to be the thing that was frozen`];
  if (stamp.schema !== SCHEMA_ID) return [`${label}: stamp schema ${JSON.stringify(stamp.schema)} is not ${SCHEMA_ID}`];
  if (typeof stamp.digest !== 'string' || !stamp.digest.startsWith('sha256:')) {
    findings.push(`${label}: stamp carries no sha256 digest`);
    return findings;
  }
  if (typeof content !== 'string') return [`${label}: the frozen file named by the stamp is missing`];
  const actual = sha256(content);
  if (actual !== stamp.digest) {
    findings.push(`${label}: ${stamp.file || 'the frozen file'} does not match its freeze stamp (stamped ${stamp.digest.slice(0, 23)}…, actual ${actual.slice(0, 23)}…) — the record was edited after the freeze, so re-freeze it rather than editing in place`);
  }
  return findings;
}

// CLI: export a fetched page from a JSON file, so an adopter can see exactly what their freezer
// would commit — and watch it fail closed on a page it cannot render.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-export.mjs <fetched-page.json>\n');
    process.exit(2);
  }
  let page;
  try { page = JSON.parse(readFileSync(path, 'utf8')); } catch { process.stderr.write(`cannot read ${path}\n`); process.exit(2); }
  const { markdown, digest, findings } = tryExport(page);
  if (findings.length) {
    process.stderr.write(`\nExport ABORTED — nothing is written.\n\n  - ${findings.join('\n  - ')}\n\nThe exporter fails closed on purpose: a partial export reads as a complete\nartifact, and the gates would pass it.\n`);
    process.exit(1);
  }
  process.stdout.write(`${markdown}\n--- digest ---\n${digest}\n`);
}
