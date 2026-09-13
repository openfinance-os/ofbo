// The floor-only gate (Factory Floor WS3 · D3.3). Catalog C is the write class that never freezes:
// meeting notes, interview notes, briefs, roadmap sketches — authored on the collaboration surface,
// cited by id, and never copied into `discovery/runs/`.
//
// WHY THIS CATALOG NEEDS A GATE AT ALL, WHEN NOTHING IT PRODUCES IS EVER CHECKED. That is the
// reason, stated as the objection. Catalog C is where humans write prose about PEOPLE — who
// attended, what a named customer said, an interviewee's circumstances — and it is the catalog with
// the least protection, precisely because nothing freezes it and therefore no export gate ever
// reads it. The discipline has to live where a gate can still reach: in the TEMPLATE, and at the
// BOUNDARY.
//
// So this gate checks exactly two things, and it is worth being blunt about what that leaves out.
//
//   1. THE TEMPLATE. Every catalog-C template carries an unmistakable write-class banner naming
//      `lives-on-the-floor · never frozen`, and states the PII rule IN THE BANNER — at the point of
//      authoring, in the author's language, not in an appendix nobody scrolls to. A template whose
//      rule has drifted below the fold fails here, because a rule you have to look for is a rule
//      that is read after the note is written.
//   2. THE BOUNDARY. A catalog-C artifact found under `discovery/runs/**`, or named by a freeze
//      stamp, is a finding. It crossed a line this class does not have a crossing for. And because
//      it is now in git — where deletion is not removal — the crossed file is scanned for personal
//      data too, and reported with the escalation that fact deserves.
//
// WHAT IT DOES NOT DO: it does not read floor content, because floor content is not in git. The
// notes this catalog is about live on a vendor's surface, and no gate in this repository can see
// them. `core/floor-pii.mjs` is exported for the freezer, the floor-keeper and the human who reads
// before citing; this gate can only make sure the form asked the right question and that the answer
// never crossed. Anyone reporting this gate green as "catalog C is clean" has misread it.
//
//   node scripts/floor-only-check.mjs
//
// Silent where unadopted: a repository with no catalog-C templates and no self-declaring artifact
// under its runs is a clean no-op, and stays a clean no-op.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseTemplate } from '../core/floor-templates.mjs';
import { liveFindings, scanText } from '../core/floor-pii.mjs';

export const CATALOG_DIR = 'floor/catalog-c';
export const RUNS_DIR = 'discovery/runs';
export const STAMPS_SUBDIR = '.freeze';

/** The write class this gate is about. Catalog C is `lives-on-the-floor` and nothing else. */
export const WRITE_CLASS = 'lives-on-the-floor';

/**
 * What the banner must say, and it must say it in the LEADING quote block — see `bannerBlockOf`.
 * Three separate requirements rather than one regex over the file, because the three failures are
 * different mistakes: forgetting the class, naming the class without its consequence, and stating
 * the PII rule somewhere an author reaches after they have already typed.
 */
export const BANNER_REQUIREMENTS = Object.freeze([
  {
    code: 'FC-R01',
    id: 'write-class',
    re: /lives-on-the-floor/,
    want: 'the write class, named exactly: `lives-on-the-floor`',
    why: 'the one thing no form can infer for its author — what happens to what they write',
  },
  {
    code: 'FC-R02',
    id: 'consequence',
    re: /never frozen/i,
    want: 'the consequence, spelled out: NEVER FROZEN',
    why: 'a class name without its consequence teaches nothing. "lives-on-the-floor" reads like a location; "never frozen" is the sentence that changes what someone types',
  },
  {
    code: 'FC-R03',
    id: 'pii-rule',
    re: /PII rule/i,
    want: 'the PII rule, headed `PII rule`',
    why: 'this catalog is where prose about people gets written and nothing downstream will catch it. The rule belongs where the author already is, not in an appendix',
  },
]);

/**
 * Field and column labels that ask for a direct identifier. The structural half of the discipline:
 * make the safe thing the easy thing, and a form that asks for a name will be given one. A label
 * that also names a role, a pseudonym, a segment or a category is asking for the safe shape and is
 * allowed through.
 */
export const DIRECT_IDENTIFIER = /^(?:names?|full names?|first names?|last names?|surnames?|e-?mails?|phones?|mobiles?|telephones?|contacts?|contact details?|addresses?|address|attendees?|participants? names?|emirates ids?|national ids?|ibans?|account numbers?|customer (?:reference|number)|dates? of birth|dob)\b/i;
export const IDENTIFIER_QUALIFIER = /\b(?:roles?|hats?|pseudonyms?|pseudonymous|segments?|categor(?:y|ies)|anonymi[sz]ed|synthetic|not (?:a )?names?|no names?)\b/i;

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Minimal frontmatter read — this gate needs `write_class`, `catalog` and `artifact`, nothing more. */
export function frontmatterOf(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(md || ''));
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const f = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (f) out[f[1]] = f[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/**
 * The leading quote block of the body — the banner, and only the banner. Reading the whole file
 * instead would let the rule be satisfied by a paragraph at the bottom, which is the exact failure
 * FC-R03 exists to catch: a rule an author meets after they have written the note is not a control,
 * it is a postscript. A file whose first `##` section arrives before any quote block has no banner.
 */
export function bannerBlockOf(md) {
  const body = String(md || '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const quoted = [];
  for (const line of body.split('\n')) {
    if (/^\s*>/.test(line)) quoted.push(line.replace(/^\s*>\s?/, ''));
    else if (quoted.length) break;
    else if (/^\s*##\s/.test(line)) return '';
  }
  return quoted.join('\n');
}

/** Findings for one catalog-C template. */
export function checkTemplate(name, text) {
  const findings = [];
  const at = `${CATALOG_DIR}/${name}`;
  if (typeof text !== 'string' || text.trim() === '') {
    return [`FC-R01: ${at}: unreadable or empty — a template that cannot be read cannot be shown to carry its banner`];
  }

  const fm = frontmatterOf(text);
  if (fm.write_class !== WRITE_CLASS) {
    findings.push(`FC-R04: ${at}: frontmatter declares write_class ${JSON.stringify(fm.write_class ?? null)}, not ${JSON.stringify(WRITE_CLASS)} — the generated floor form takes its banner from this field, so an undeclared template ships a form that promises the author nothing`);
  }

  const banner = bannerBlockOf(text);
  if (banner === '') {
    // One problem, one finding. Listing all three requirements against a file that has no banner
    // at all would read as three defects and hide that there is only one thing to do.
    findings.push(`FC-R01: ${at}: no banner at all — the file opens straight into its sections. A catalog-C template's leading block must carry ${BANNER_REQUIREMENTS.map((r) => r.want).join(', ')}. ${BANNER_REQUIREMENTS[0].why}`);
  } else {
    for (const r of BANNER_REQUIREMENTS) {
      if (r.re.test(banner)) continue;
      findings.push(`${r.code}: ${at}: the banner does not carry ${r.want}${r.re.test(text) ? ' — it appears further down the file, which is too late: an author meets it after writing, not before' : ''}. ${r.why}`);
    }
  }

  const parsed = parseTemplate(text, { source: at });
  for (const section of parsed.sections) {
    for (const label of [...(section.columns || []), ...(section.fields || [])]) {
      if (!DIRECT_IDENTIFIER.test(label) || IDENTIFIER_QUALIFIER.test(label)) continue;
      findings.push(`FC-R05: ${at} · ${section.name}: the field ${JSON.stringify(label)} asks for a direct identifier — a form that asks for a name will be given one. Ask for the role, the segment or the pseudonym instead, and the safe answer becomes the easy answer`);
    }
  }

  // The template's own body. A catalog-C template that ships an illustrative email address or a
  // realistic-looking id is teaching the behaviour its banner forbids, in the one place every
  // author of that artifact will read.
  for (const f of liveFindings(scanText(text, { where: at }))) {
    findings.push(`FC-R06: ${at}: the template's own body carries ${f.label} at line ${f.line}:${f.column} (${f.redacted}) — a template is an example, and this one is modelling the thing its banner forbids. Use a pseudonym, a category or a synthetic value carrying this repository's markers`);
  }
  return findings;
}

/**
 * Is this file, found in git, a catalog-C artifact? Two independent signals, deliberately: what the
 * file DECLARES about itself, and what it is NAMED. Declaration survives a rename; the name survives
 * a stripped frontmatter. Either one alone can be defeated by the ordinary copy-paste that this
 * gate exists to catch.
 */
export function identifyCatalogC(path, text, index) {
  const fm = frontmatterOf(text);
  if (fm.write_class === WRITE_CLASS) return `it declares write_class ${JSON.stringify(WRITE_CLASS)}`;
  if (String(fm.catalog || '').toUpperCase() === 'C') return 'it declares catalog C';
  const slug = basename(path).replace(/\.md$/i, '');
  if (index.has(slug)) return `it is named for the catalog-C template \`${slug}.md\``;
  if (fm.artifact && index.has(fm.artifact)) return `it declares artifact ${JSON.stringify(fm.artifact)}, which is a catalog-C template`;
  return null;
}

/**
 * Pure. Everything this gate decides, decided over text that has already been read.
 *
 *   templates: [{ name, text }]            — `floor/catalog-c/*.md`
 *   frozen:    [{ path, text }]            — every markdown file under `discovery/runs/**`
 *   stamps:    [{ label, file }]           — freeze stamps found in those runs
 */
export function evaluate({ templates = [], frozen = [], stamps = [] } = {}) {
  const findings = [];
  for (const t of templates) findings.push(...checkTemplate(t.name, t.text));

  const index = new Set();
  for (const t of templates) {
    index.add(basename(t.name).replace(/\.md$/i, ''));
    const artifact = frontmatterOf(t.text).artifact;
    if (artifact) index.add(artifact);
  }

  let crossings = 0;
  for (const f of frozen) {
    const why = identifyCatalogC(f.path, f.text, index);
    if (!why) continue;
    crossings++;
    findings.push(`FC-R07: ${RUNS_DIR}/${f.path}: a \`${WRITE_CLASS}\` artifact has been frozen into the record — ${why}. This class has no crossing: a frozen artifact may CITE a floor note by its id, and may never BE one. Remove it from the run and cite it instead`);
    // It is in git now, which is the part that cannot be undone by deleting the file.
    for (const p of liveFindings(scanText(f.text, { where: `${RUNS_DIR}/${f.path}` }))) {
      findings.push(`FC-R09: ${RUNS_DIR}/${f.path}: the crossed artifact carries ${p.label} at line ${p.line}:${p.column} (${p.redacted}) — this is now in git history, where deleting the file does not remove it. Treat it as a disclosure and follow your institution's process, not as a file to tidy up`);
    }
  }

  for (const s of stamps) {
    const slug = basename(String(s.file || '')).replace(/\.md$/i, '');
    if (!slug || !index.has(slug)) continue;
    crossings++;
    findings.push(`FC-R08: ${s.label}: a freeze stamp names \`${s.file}\`, a catalog-C artifact — the freezer was pointed at a page that never freezes. Fix the freezer's selection, not the stamp`);
  }

  return { findings, templates: templates.length, frozen: frozen.length, crossings };
}

/** Every markdown file under a directory, relative-pathed, skipping the freeze-stamp subdirectory. */
function walkMarkdown(dir, base = '', out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === STAMPS_SUBDIR) continue;
    const path = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) walkMarkdown(path, rel, out);
    else if (/\.md$/i.test(name)) {
      const text = readText(path);
      if (text !== null) out.push({ path: rel, text });
    }
  }
  return out;
}

export function run(cwd = process.cwd()) {
  const catalogDir = `${cwd}/${CATALOG_DIR}`;
  const templates = existsSync(catalogDir)
    ? readdirSync(catalogDir).filter((n) => n.endsWith('.md')).sort().map((n) => ({ name: n, text: readText(`${catalogDir}/${n}`) }))
    : [];

  const runsDir = `${cwd}/${RUNS_DIR}`;
  const frozen = [];
  const stamps = [];
  if (existsSync(runsDir)) {
    for (const slug of readdirSync(runsDir).sort()) {
      const runDir = `${runsDir}/${slug}`;
      let stat;
      try { stat = statSync(runDir); } catch { continue; }
      if (!stat.isDirectory()) continue;
      walkMarkdown(runDir, slug, frozen);
      const stampDir = `${runDir}/${STAMPS_SUBDIR}`;
      if (!existsSync(stampDir)) continue;
      for (const name of readdirSync(stampDir).filter((n) => n.endsWith('.json')).sort()) {
        const stamp = readJson(`${stampDir}/${name}`);
        if (stamp && typeof stamp.file === 'string') stamps.push({ label: `${slug} · ${name}`, file: stamp.file });
      }
    }
  }
  return evaluate({ templates, frozen, stamps });
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, templates, crossings } = run();
  if (findings.length) {
    process.stderr.write('\nFloor-only gate (D3.3) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nCatalog C is the class nothing downstream checks. Its discipline lives in the\ntemplate banner and at the boundary — those are the two places a gate can still\nreach, and both are above.\n');
    process.exit(1);
  }
  process.stdout.write(templates
    ? `Floor-only gate (D3.3) — OK (${templates} catalog-C template${templates === 1 ? '' : 's'} banner-checked, ${crossings} crossing${crossings === 1 ? '' : 's'})\n`
      + 'This says the forms ask the right questions and nothing crossed into the record.\nIt says nothing about what is written on the floor — no gate here can read that.\n'
    : 'Floor-only gate (D3.3) — no catalog-C templates (the floor-only suite is not adopted)\n');
}
