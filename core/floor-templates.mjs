// Floor templates — the guided authoring surface, DERIVED from the git template (Factory Floor
// WS3 · D3.1). The floor exists so a product owner, a stakeholder or a second-line approver can
// do their part without opening a repository. That only works if the form they fill in asks for
// exactly what the gate will check — and the only way to keep those two in step is to stop
// maintaining them separately.
//
// So a floor template is not authored. It is GENERATED from the markdown template that already
// ships (`discovery/templates/*.md`), and a parity gate regenerates it on every run: edit the
// git template without regenerating and the build fails, the same way the copy table cannot
// drift from the copy manifest. Git-first is not a slogan here, it is the build order.
//
//   parseTemplate(md)              → the structure a markdown template declares
//   toFloorDefinition(parsed, …)   → the vendor-neutral definition a floor surface is built from
//
// Deliberately NOT a Notion client. This module makes no network call and names no vendor: it
// emits a definition, and mounting that definition on a workspace is the adopter's wiring, per
// the adapter contract. Swap the surface and the definitions do not change.
import { createHash } from 'node:crypto';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA_ID = 'loom.floor-template/v1';

/** How a floor artifact relates to the record — the banner every template carries (§6c). */
export const WRITE_CLASSES = new Set(['born-on-the-floor', 'decision-routed', 'lives-on-the-floor', 'read-only-mirror', 'never-writable']);

export const sha256 = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

/** Gate ids named anywhere in a block of prose, including ranges written `D1–D8` or `D1-D8`. */
export function gatesNamed(text) {
  const found = new Set();
  const src = String(text || '');
  for (const m of src.matchAll(/\bD([1-9])\s*[–-]\s*D?([1-9])\b/g)) {
    for (let i = Number(m[1]); i <= Number(m[2]); i++) found.add(`D${i}`);
  }
  for (const m of src.matchAll(/\bD([1-9])\b/g)) found.add(`D${m[1]}`);
  return [...found].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

const frontmatterOf = (md) => {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const f = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (f) out[f[1]] = f[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
};

/**
 * Leading `> ` block of a chunk, unwrapped to one paragraph. Blank lines and the chunk's own
 * heading are skipped on the way in — the guidance sits under the title, not above it — but once
 * the quote has started, the first unquoted line ends it.
 */
const guidanceOf = (chunk) => {
  const quoted = [];
  for (const l of chunk.split('\n')) {
    if (/^\s*>/.test(l)) quoted.push(l.replace(/^\s*>\s?/, ''));
    else if (quoted.length) break;
    else if (l.trim() === '' || /^\s*#/.test(l)) continue;
    else break;
  }
  return quoted.join(' ').replace(/\s+/g, ' ').trim();
};

/** Header cells of the first markdown table in a chunk, or null. */
const tableColumnsOf = (chunk) => {
  const lines = chunk.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      return lines[i].split('|').slice(1, -1).map((c) => c.trim()).filter(Boolean);
    }
  }
  return null;
};

/** `- **Label:**` bullets — the named single-value fields a section asks for. */
const labelledFieldsOf = (chunk) =>
  [...chunk.matchAll(/^\s*[-*]\s+\*\*(.+?):?\*\*/gm)].map((m) => m[1].trim());

/**
 * The structure a markdown template declares: its identity, the gates it serves, and one entry
 * per `##` section with the shape of what it asks for.
 */
export function parseTemplate(md, { source = '' } = {}) {
  const text = String(md || '');
  const fm = frontmatterOf(text);
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const h1 = /^#\s+(.+)$/m.exec(body);
  // The title carries a run placeholder in every shipped template — the artifact is the part
  // before it, and the placeholder becomes the floor page's own title property.
  const title = (h1 ? h1[1] : fm.artifact || '').split('—')[0].trim();

  const chunks = body.split(/^##\s+/m);
  const preamble = chunks.shift() || '';
  const sections = chunks.map((chunk) => {
    const name = chunk.split('\n', 1)[0].trim();
    const rest = chunk.slice(name.length);
    const columns = tableColumnsOf(rest);
    const fields = labelledFieldsOf(rest);
    const gates = gatesNamed(`${name} ${guidanceOf(rest)}`);
    const section = {
      name,
      // Every section a template ships is something the artifact must carry. "Required" here
      // means the template asks for it — not that a gate parses that exact field. Where a gate
      // IS named, it is recorded, so the floor can say which check a blank will fail.
      required: true,
      kind: columns ? 'table' : fields.length ? 'fields' : 'rich_text',
      help: guidanceOf(rest),
    };
    if (columns) section.columns = columns;
    if (fields.length) section.fields = fields;
    if (gates.length) section.gates = gates;
    return section;
  });

  return {
    artifact: fm.artifact || '',
    stage: fm.stage || '',
    title,
    source,
    guidance: guidanceOf(preamble),
    gates: gatesNamed(body),
    sections,
  };
}

/**
 * The vendor-neutral floor definition: page properties plus the section shapes a guided form is
 * built from. `write_class` is the banner that tells a non-technical author what happens to what
 * they write — the one thing they must understand and the one thing no form can infer.
 */
export function toFloorDefinition(parsed, { writeClass = 'born-on-the-floor', sourceDigest = null } = {}) {
  if (!WRITE_CLASSES.has(writeClass)) throw new Error(`unknown write class ${JSON.stringify(writeClass)}`);
  // Only `born-on-the-floor` content is ever frozen: the freeze round-trip exports a floor page
  // into git and stamps it. Every other class either lives in git already, is routed elsewhere for
  // decision, or is a mirror — none of them has a freeze to record. So `frozen` is not merely an
  // unused option on those forms, it is a status nothing can write and nothing reads. An author who
  // selects it has marked their page with a lie the harness cannot detect, because no gate reads a
  // status the freeze round-trip never sets. The option and the block that gives it meaning are
  // therefore gated together, on purpose.
  const frozen = writeClass === 'born-on-the-floor';
  return {
    _comment: 'GENERATED from the git template named in `source` — do not hand-edit. Regenerate with `node scripts/template-parity-check.mjs --fix`; the gate fails when this file and its source disagree, so the guided form on the floor cannot drift from the artifact the gates read.',
    schema: SCHEMA_ID,
    artifact: parsed.artifact,
    title: parsed.title,
    stage: parsed.stage,
    write_class: writeClass,
    source: parsed.source,
    source_digest: sourceDigest,
    gates: parsed.gates,
    guidance: parsed.guidance,
    properties: [
      { name: 'Run', type: 'title', required: true, help: 'The discovery run this artifact belongs to.' },
      { name: 'Status', type: 'select', required: true, options: frozen ? ['draft', 'in review', 'gate-green', 'frozen'] : ['draft', 'in review', 'gate-green'] },
      ...(frozen ? [
        // The freeze/drift block (§6c · D-suite). Display-only on the floor: it is written by the
        // freeze round-trip, never by an author, and it is how a reader knows whether what they
        // are looking at is the record or a draft that has run ahead of it.
        { name: 'Frozen at', type: 'text', required: false, read_only: true, help: 'Commit sha of the merged snapshot. Empty until the first freeze.' },
        { name: 'Version', type: 'text', required: false, read_only: true },
        { name: 'Drift', type: 'select', required: false, read_only: true, options: ['none', 'draft ahead of record'], help: 'Never blocks. It says the draft and the record have diverged.' },
      ] : []),
    ],
    sections: parsed.sections,
  };
}

/** Generate a definition straight from a template file on disk. */
export function generate(absPath, { source, writeClass } = {}) {
  const md = readFileSync(absPath, 'utf8');
  return toFloorDefinition(parseTemplate(md, { source }), { writeClass, sourceDigest: sha256(md) });
}

/** Field-by-field differences between a stored definition and a fresh one. [] ⇒ in step. */
export function diff(stored, fresh, label = 'definition') {
  const findings = [];
  const strip = (d) => { const { _comment, ...rest } = d || {}; return rest; };
  const a = strip(stored);
  const b = strip(fresh);
  if (a.source_digest !== b.source_digest) {
    findings.push(`${label}: source_digest is stale — the git template changed and this definition was not regenerated`);
  }
  for (const key of ['artifact', 'title', 'stage', 'write_class', 'guidance']) {
    if (a[key] !== b[key]) findings.push(`${label}: ${key} differs (stored ${JSON.stringify(a[key])}, source says ${JSON.stringify(b[key])})`);
  }
  if (JSON.stringify(a.gates) !== JSON.stringify(b.gates)) {
    findings.push(`${label}: gates differ (stored ${JSON.stringify(a.gates)}, source says ${JSON.stringify(b.gates)})`);
  }
  // Properties, not just sections. The freeze/drift block, the Status options and their read-only
  // flags all live here, and they are derived from `write_class` — so leaving them out meant a
  // definition could offer a status nothing writes, or lose the freeze block entirely, and this
  // gate would still report the pair "in step". Two shipped decision-routed definitions were in
  // exactly that state when this comparison was added.
  if (JSON.stringify(a.properties) !== JSON.stringify(b.properties)) {
    findings.push(`${label}: properties differ — the page properties are derived from write_class, so a mismatch means the form offers or omits something the write class does not support\n      stored: ${JSON.stringify(a.properties)}\n      source: ${JSON.stringify(b.properties)}`);
  }
  const names = (d) => (d.sections || []).map((s) => s.name);
  if (JSON.stringify(names(a)) !== JSON.stringify(names(b))) {
    findings.push(`${label}: section list differs — a section added, removed or renamed in the template must reach the floor form, or an author is asked for the wrong things\n      stored: ${JSON.stringify(names(a))}\n      source: ${JSON.stringify(names(b))}`);
    return findings; // per-section comparison below would be noise once the lists disagree
  }
  for (const [i, s] of (b.sections || []).entries()) {
    const t = a.sections[i];
    if (JSON.stringify(t) !== JSON.stringify(s)) {
      findings.push(`${label} · ${s.name}: shape differs (stored ${JSON.stringify(t)}, source says ${JSON.stringify(s)})`);
    }
  }
  return findings;
}

// CLI: print the definition for one template — so an adopter can see what a form is built from.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node core/floor-templates.mjs <template.md> [write-class]\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(generate(path, { source: path, writeClass: process.argv[3] }), null, 2)}\n`);
}
