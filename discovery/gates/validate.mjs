#!/usr/bin/env node
// Discovery gate validator — D1..D9. Pure Node, zero deps, deterministic.
//
//   node discovery/gates/validate.mjs discovery/runs/<slug> [--register <dir>] [--brand <path>] [--json]
//
// Exit 0 iff every applicable gate passes. Gates are mechanical: structure, references,
// presence — not taste.
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  read, frontMatter, section, filledRows, hasContent, signalIds, drIds, ctrlIds, obIds, listFiles, PLACEHOLDER,
} from './lib.mjs';
import { loadRegister, loadObligations } from './registers.mjs';
import { parseBrand, checkVisualHtml, checkVisualMarkdown, checkVisualOoxml, MARKER } from './brand.mjs';
import { aggregateRequirements, capabilityRequired } from '../../core/compiled-requirements.mjs';

const OOXML_EXTS = ['.xlsx', '.docx', '.pptx'];

const ARTIFACTS = {
  research: 'research-log.md',
  synthesis: 'synthesis.md',
  problem: 'problem-statement.md',
  dataGov: 'data-governance.md',
  prototype: 'prototype.md',
  reaction: 'stakeholder-reaction.md',
  handoff: 'handoff.md',
};

const SOLUTIONING = [
  { re: /\b(POST|GET|PUT|PATCH|DELETE)\s+\//, what: 'API route' },
  { re: /\bopenapi\b/i, what: 'OpenAPI spec reference' },
  { re: /\bCREATE\s+TABLE\b/i, what: 'SQL DDL' },
  { re: /\bendpoint\b/i, what: 'endpoint design' },
  { re: /\.(tsx?|jsx?)\b/, what: 'source-file reference' },
  { re: /\b(React|Next\.js|Postgres|GraphQL|Kafka|Redis)\b/, what: 'tech-stack choice' },
  { re: /\bgraphql\b/i, what: 'API technology' },
];

const REG_DRIVERS = /\b(CPS|MMS|PDPL|BCBS239|CPS-AI)\b|\bArt\.?\s*\d|\bclause\b/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * D6 asks whether the data-governance document is grounded in something a regulator wrote. The
 * built-in regex above answers that for the abbreviations the harness ships knowing; it cannot
 * see a Shariah authority's pronouncements, a standard-setter's standards, or any other
 * jurisdiction's vocabulary, so a document citing nothing else failed as "cites no regulatory
 * driver" — a false negative about a document that was entirely citation.
 *
 * The vocabulary is therefore MOUNTED DATA (`reg-drivers.json` beside the register), not gate
 * logic. Two properties hold by construction:
 *   · the built-in regex is kept and checked FIRST, so the mount can only ADD ways to pass —
 *     an adopter can never shorten this gate by editing a list it owns;
 *   · mounted terms are LITERALS, regex-escaped before use, so `.` matches a dot and nothing in
 *     that file can widen into `.*`.
 * With no file mounted, drivers is [] and this is the original check, byte for byte.
 *
 * Boundaries are applied only where the term actually has a word edge: real driver names end in
 * punctuation often enough ("Shari'ah Standard No.", "Art.") that a blind \b…\b would silently
 * never match them, which is the same false negative one level down.
 */
function citesRegulatoryDriver(text, drivers = []) {
  if (REG_DRIVERS.test(text)) return true;
  return drivers.some((term) => {
    const t = String(term).trim();
    if (!t) return false;
    const lead = /^\w/.test(t) ? '\\b' : '';
    const tail = /\w$/.test(t) ? '\\b' : '';
    return new RegExp(`${lead}${escapeRe(t)}${tail}`, 'i').test(text);
  });
}

function gate(id, name, issues, status) {
  return { id, name, status: status || (issues.length ? 'fail' : 'pass'), issues };
}

function scanSolutioning(label, text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^>/.test(t)) continue;        // guidance blockquotes
    if (/^- \[[ xX]\]/.test(t)) continue; // self-check checklists ("no endpoints…")
    for (const { re, what } of SOLUTIONING) {
      if (re.test(line)) out.push(`${label}: ${what} — "${line.trim().slice(0, 80)}"`);
    }
  }
  return out;
}

/**
 * Drop generated presentation before a solutioning scan. The renderer owns <style>/<script>
 * and emits them from design.md tokens, so a keyword hit inside them would be a renderer
 * defect, not a run leaking into the right diamond — scanning them would only teach authors
 * to distrust the gate. Authored content is what remains.
 */
function authoredHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

/**
 * The content digest a stakeholder reaction binds to (D9, 2.1.0): sha256 over the prototype brief,
 * the wireframe asset, and every specs/*.json in name order, each prefixed by its name so a rename
 * or a swap between files changes the digest. Missing files contribute their absence, so a digest
 * taken before the wireframe existed does not equal one taken after.
 */
export function prototypeDigest(runDir, wireframe = 'wireframe.html') {
  const h = createHash('sha256');
  const parts = [ARTIFACTS.prototype, wireframe, ...listFiles(join(runDir, 'specs'), '.json').map((f) => `specs/${basename(f)}`).sort()];
  for (const name of parts) {
    const file = join(runDir, name);
    h.update(`\0${name}\0`);
    h.update(existsSync(file) ? readFileSync(file) : '<absent>');
  }
  return h.digest('hex');
}

/** signal id → its Source cell (column 2 of the research-log Signals table), normalised. */
export function signalSources(signalsBlock) {
  const out = new Map();
  for (const cells of filledRows(signalsBlock, ['signal id', 'source'])) {
    const id = (cells[0] || '').match(/\bS-\d{2,}\b/)?.[0];
    const src = (cells[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (id && src && !PLACEHOLDER.test(src)) out.set(id, src);
  }
  return out;
}

export function validateRun(runDir, opts = {}) {
  const p = (f) => join(runDir, f);
  const docs = {};
  for (const [k, f] of Object.entries(ARTIFACTS)) {
    const raw = read(p(f));
    docs[k] = { raw, ...frontMatter(raw), exists: existsSync(p(f)), file: f };
  }
  const register = opts.register !== null ? loadRegister(opts.registerDir) : null;
  const obligations = opts.obligations !== null ? loadObligations(opts.obligationsPath) : null;
  const brand = parseBrand(opts.brandPath || 'discovery/brand/design.md');
  const gates = [];

  // ---- D1 Problem framing -------------------------------------------------
  {
    const issues = [];
    if (!docs.problem.exists) issues.push(`${ARTIFACTS.problem} missing`);
    else {
      if (!hasContent(section(docs.problem.body, 'The problem'))) issues.push('no falsifiable problem stated');
      if (!hasContent(section(docs.problem.body, 'Target user'))) issues.push('no target user');
      if (filledRows(section(docs.problem.body, 'Success measures'), ['measure', 'baseline']).length === 0)
        issues.push('no success measure');
    }
    gates.push(gate('D1', 'Problem framing', issues));
  }

  // ---- D2 Evidence --------------------------------------------------------
  {
    const issues = [];
    const defined = signalIds(section(docs.research.body, 'Signals'));
    if (defined.size === 0) issues.push('no signals logged in research-log.md');
    const referenced = new Set([
      ...signalIds(docs.synthesis.body),
      ...signalIds(docs.problem.body),
    ]);
    for (const id of referenced) if (!defined.has(id)) issues.push(`${id} cited but not in research-log`);
    if (referenced.size === 0 && defined.size > 0) issues.push('synthesis/problem cite no signals (assertion without evidence)');
    // 2.1.0 — breadth. One signal, cited once, used to satisfy this gate: fifty unsourced claims
    // beside it passed. Discover is the DIVERGE half of the left diamond, and evidence that all
    // comes from one place is a single opinion with an id. The signals the framing rests on must
    // come from at least two distinct sources (the Source column of the research log).
    const sources = signalSources(section(docs.research.body, 'Signals'));
    const cited = [...referenced].filter((id) => defined.has(id));
    const distinct = new Set(cited.map((id) => sources.get(id)).filter(Boolean));
    if (cited.length > 0 && distinct.size < 2) {
      issues.push(`evidence rests on a single source (${[...distinct][0] ? JSON.stringify([...distinct][0]) : 'none recorded'}) — cite signals from at least two distinct sources, or the framing is one opinion with an id`);
    }
    gates.push(gate('D2', 'Evidence', issues));
  }

  // ---- D3 Scope & stakeholders -------------------------------------------
  {
    const issues = [];
    const stake = section(docs.problem.body, 'Stakeholders & scope');
    if (filledRows(stake, ['stakeholder', 'in/out']).length === 0) issues.push('no named stakeholders');
    if (!/out of scope/i.test(docs.problem.body) || /out of scope \(explicit\):\s*$/im.test(docs.problem.body))
      issues.push('no explicit out-of-scope boundary');
    gates.push(gate('D3', 'Scope & stakeholders', issues));
  }

  // ---- D4 No-solutioning boundary ----------------------------------------
  {
    let issues = [];
    for (const k of ['problem', 'synthesis', 'dataGov', 'handoff']) {
      if (docs[k].exists) issues = issues.concat(scanSolutioning(docs[k].file, docs[k].body));
    }
    gates.push(gate('D4', 'No-solutioning boundary', issues));
  }

  // ---- D5 Synthesis integrity --------------------------------------------
  {
    const issues = [];
    if (!docs.synthesis.exists) issues.push(`${ARTIFACTS.synthesis} missing`);
    else {
      const defined = signalIds(section(docs.research.body, 'Signals'));
      const themes = filledRows(section(docs.synthesis.body, 'Themes'), ['theme id', 'theme']);
      if (themes.length === 0) issues.push('no themes');
      for (const row of themes) {
        const cited = signalIds(row.join(' '));
        if (cited.size === 0) issues.push(`theme "${row[1] || row[0]}" traces to no signal`);
        for (const id of cited) if (!defined.has(id)) issues.push(`theme cites ${id} not in research-log`);
      }
      const method = (docs.synthesis.body.match(/\*\*Method:\*\*\s*(.*)/i) || [])[1] || '';
      if (!method || PLACEHOLDER.test(method)) issues.push('prioritisation method not stated');
    }
    gates.push(gate('D5', 'Synthesis integrity', issues));
  }

  // ---- D6 Data-governance feasibility ------------------------------------
  let d6Verdict = null;
  {
    if (!register) {
      // Fail-open is safe for a generic repo but not for a regulated one: once a bank/institution
      // profile is active (opts.requireRegister, set by the reference CI and the --require-register
      // flag / LOOM_REQUIRE_REGISTER env), a missing data-risk register is a BLOCK, not a skip —
      // the data-governance control cannot silently not-run under a regulated profile.
      if (opts.requireRegister) {
        gates.push(gate('D6', 'Data-governance feasibility', ['data-risk register is mandatory under the active regulated profile but is not mounted (docs/governance/data-risk-register/) — mount it or the data-governance control cannot run'], 'fail'));
      } else {
        gates.push(gate('D6', 'Data-governance feasibility', ['register not mounted — skipped'], 'skip'));
      }
    } else {
      const issues = [];
      if (!docs.dataGov.exists) issues.push(`${ARTIFACTS.dataGov} missing`);
      else {
        const drs = drIds(docs.dataGov.body);
        const ctrls = ctrlIds(docs.dataGov.body);
        if (drs.size === 0) issues.push('cites no DR-* risk category');
        for (const id of drs) if (!register.drIds.has(id)) issues.push(`DR id ${id} does not resolve in register`);
        for (const id of ctrls) if (!register.ctrlIds.has(id)) issues.push(`control ${id} does not resolve in register`);
        // 2.1.0 — with an obligations register mounted, the driver is an OBLIGATION ID, not a
        // regulation remembered in prose. The keyword vocabulary stays as the fallback for a repo that
        // has not mounted one; once it is mounted, D6 asks for the id the register can answer for.
        if (obligations) {
          const cited = obIds(docs.dataGov.body);
          if (cited.size === 0) issues.push('cites no obligation (OB-*) — the obligations register is mounted; cite the obligation the data position answers to, not the regulation from memory');
          for (const id of cited) if (!obligations.byId.has(id)) issues.push(`obligation ${id} does not resolve in docs/governance/obligations.json`);
          // the cited obligations should bear on the risks this document maps
          for (const id of cited) {
            const o = obligations.byId.get(id);
            if (o && Array.isArray(o.risk_ids) && drs.size && !o.risk_ids.some((r) => [...drs].some((d) => d === r || d.startsWith(r + '.') || d.startsWith(r + '-')))) {
              issues.push(`obligation ${id} maps to ${o.risk_ids.join(', ')}, none of which this document cites — the obligation and the risk mapping disagree`);
            }
          }
        } else if (!citesRegulatoryDriver(docs.dataGov.body, register.drivers)) issues.push('cites no regulatory driver');
        const verdict = ((docs.dataGov.body.match(/Acceptable for delivery\?\*\*\s*(.*)/i) || [])[1] || '').trim();
        const unfilled = /^yes\s*\/\s*no\s*\/\s*conditional\s*[—-]?\s*$/i.test(verdict);
        // \b-anchored: unanchored, the "no" inside "Not yet." counted as a verdict, so the one
        // sentence that means "we have not decided" passed the gate that exists to make someone
        // decide. A verdict is a whole word or it is not a verdict.
        if (!/\b(yes|no|conditional)\b/i.test(verdict) || PLACEHOLDER.test(verdict) || unfilled)
          issues.push('no residual-risk verdict');
        // 2.1.0 — the verdict VALUE is carried on the gate result. Until now nothing downstream read
        // it: a verdict of "No" was gate-green, and the waist gate admitted the feature. D6 still
        // asks only "was a decision made"; whether that decision admits the feature is the waist
        // gate's question (scripts/discovery-link-check.mjs), and it needs the word to ask it.
        d6Verdict = ((verdict.match(/\b(yes|no|conditional)\b/i) || [])[1] || '').toLowerCase() || null;
      }
      gates.push({ ...gate('D6', 'Data-governance feasibility', issues), verdict: d6Verdict });
    }
  }

  // ---- D7 Brand conformance ----------------------------------------------
  {
    const issues = [];
    const visualMd = ['research', 'synthesis', 'problem', 'dataGov', 'prototype', 'reaction', 'handoff'];
    const ooxml = OOXML_EXTS.flatMap((ext) => listFiles(runDir, ext));
    const haveVisuals = visualMd.some((k) => docs[k].exists) || listFiles(runDir, '.html').length > 0 || ooxml.length > 0;
    if (!brand.present && haveVisuals) {
      issues.push('brand profile design.md not mounted — cannot verify conformance');
    } else if (brand.present) {
      for (const k of visualMd) if (docs[k].exists) issues.push(...checkVisualMarkdown(docs[k].file, docs[k].fm));
      for (const html of listFiles(runDir, '.html')) issues.push(...checkVisualHtml(basename(html), read(html), brand));
      for (const f of ooxml) issues.push(...checkVisualOoxml(basename(f), readFileSync(f), brand));
    }
    gates.push(gate('D7', 'Brand conformance', issues));
  }

  // ---- D8 Tangibility (prototype) ----------------------------------------
  {
    const issues = [];
    if (!docs.prototype.exists) issues.push(`${ARTIFACTS.prototype} missing — no tangible prototype`);
    else {
      if (docs.prototype.fm.fidelity !== 'low') issues.push("prototype fidelity must be 'low' (validation, not delivery)");
      const wf = docs.prototype.fm.wireframe || 'wireframe.html';
      if (!existsSync(p(wf))) {
        issues.push(`wireframe asset ${wf} missing`);
      } else {
        const raw = read(p(wf));
        if (!raw.includes(MARKER)) issues.push(`${wf} missing brand marker`);
        // A prototype is three things — the brief, the asset a stakeholder reacts to, and the
        // structured content the asset renders from — and the fidelity line (§4) applies to all
        // three. Scanning only the brief left the two surfaces where over-specification actually
        // lands unchecked, so a wireframe could name a route or a stack while D8 reported PASS.
        issues.push(...scanSolutioning(`${wf} (over-specified)`, /\.html?$/i.test(wf) ? authoredHtml(raw) : raw));
      }
      issues.push(...scanSolutioning(`${ARTIFACTS.prototype} (over-specified)`, docs.prototype.body));
      // specs/ holds the JSON the renderer turns into the wireframe. It is authored by hand, so
      // it is exactly as capable of over-specifying as the brief is — and a run that renders its
      // wireframe (the documented path) puts all its authored content here.
      for (const spec of listFiles(join(runDir, 'specs'), '.json')) {
        issues.push(...scanSolutioning(`specs/${basename(spec)} (over-specified)`, read(spec)));
      }
    }
    gates.push(gate('D8', 'Tangibility', issues));
  }

  // ---- D9 Validation loop (make-tangible closes) -------------------------
  {
    // The prototype exists to be *reacted to* — a stakeholder reaction is the evidence the
    // make-tangible stage produces (canon §3/§4). D8 proves a prototype was built; D9 proves
    // it did its job: it was shown, and the reactions are recorded as fresh signals (→ D2).
    // Same trigger as D8 — only applies when a prototype exists.
    if (!docs.prototype.exists) {
      gates.push(gate('D9', 'Validation loop', ['no prototype — skipped'], 'skip'));
    } else {
      const issues = [];
      if (!docs.reaction.exists) {
        issues.push(`${ARTIFACTS.reaction} missing — prototype shown to no one (make-tangible loop left open)`);
      } else {
        const VERDICT = /\b(confirmed|refuted|uncertain|partially)\b/i;
        const rows = filledRows(section(docs.reaction.body, 'Reactions'), ['hypothesis', 'verdict']);
        if (rows.length === 0) issues.push('no stakeholder reactions recorded');
        else if (!rows.some((r) => VERDICT.test(r.join(' '))))
          issues.push('reactions record no verdict (confirmed/refuted/uncertain/partially)');
        // Every framing hypothesis the prototype names must carry a recorded reaction.
        const hyps = new Set((docs.prototype.body.match(/\bH\d+\b/g) || []));
        const reacted = new Set((docs.reaction.body.match(/\bH\d+\b/g) || []));
        for (const h of hyps) if (!reacted.has(h)) issues.push(`prototype hypothesis ${h} has no recorded reaction`);
        // Reactions are evidence, not opinion: cited signals must resolve in the research log.
        const defined = signalIds(section(docs.research.body, 'Signals'));
        const cited = signalIds(docs.reaction.body);
        if (cited.size === 0) issues.push('reactions cite no signal id — not logged as evidence (→ D2)');
        for (const id of cited) if (!defined.has(id)) issues.push(`reaction cites ${id} not in research-log`);
        // 2.1.0 — the reaction is bound to the prototype it reacted to. A reaction records that a
        // stakeholder looked at SOMETHING; without a binding, the prototype can be rewritten after
        // the reaction and the run stays green, so the reaction evidences a prototype nobody saw.
        // The binding is a content digest of the three prototype artifacts (brief, asset, specs),
        // not a git tree: writing handoff.md or the reaction itself must not invalidate it.
        const bound = docs.reaction.fm.prototype_digest;
        const actual = prototypeDigest(runDir, docs.prototype.fm.wireframe || 'wireframe.html');
        if (!bound || PLACEHOLDER.test(bound)) {
          issues.push(`reaction is not bound to the prototype it reacted to — add prototype_digest: ${actual} to ${ARTIFACTS.reaction} front-matter (node discovery/gates/validate.mjs <run> --prototype-digest prints it)`);
        } else if (bound !== actual) {
          issues.push(`prototype changed after the reaction was recorded (reaction bound to ${bound.slice(0, 12)}…, prototype is now ${actual.slice(0, 12)}…) — show the current prototype and record the reaction again, or restore the prototype that was shown`);
        }
      }
      gates.push(gate('D9', 'Validation loop', issues));
    }
  }

  const ok = gates.every((g) => g.status !== 'fail');
  return { runDir, ok, gates };
}

/**
 * rc.13 WS3 (closes F5): is the data-risk register MANDATORY? Derived from compiled policy — if any
 * governed change's compiled plan requires the `data_risk_register` capability (an institution or
 * regulated profile is in its envelope), the register is mandatory and a missing one FAILS D6 with
 * NO flag present. The --require-register flag / LOOM_REQUIRE_REGISTER env survive only as a manual
 * TIGHTENING: `flag OR compiled` can force the requirement on, but can never turn a compiled one
 * off. A CI-config change can no longer weaken a regulated build.
 */
export function registerMandatory(cwd, { flag = false } = {}) {
  return flag || capabilityRequired(aggregateRequirements(cwd), 'data_risk_register');
}

// ---- CLI -------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const runDir = args.find((a) => !a.startsWith('--'));
  const regIdx = args.indexOf('--register');
  const brandIdx = args.indexOf('--brand');
  if (!runDir) {
    console.error('usage: validate.mjs <runDir> [--register <dir>] [--brand <path>] [--json]');
    process.exit(2);
  }
  if (args.includes('--prototype-digest')) {
    const { fm } = frontMatter(existsSync(join(runDir, ARTIFACTS.prototype)) ? readFileSync(join(runDir, ARTIFACTS.prototype), 'utf8') : '');
    console.log(prototypeDigest(runDir, fm.wireframe || 'wireframe.html'));
    process.exit(0);
  }
  const opts = {
    registerDir: regIdx >= 0 ? args[regIdx + 1] : undefined,
    register: args.includes('--no-register') ? null : undefined,
    obligationsPath: (() => { const i = args.indexOf('--obligations'); return i >= 0 ? args[i + 1] : undefined; })(),
    brandPath: brandIdx >= 0 ? args[brandIdx + 1] : undefined,
    requireRegister: registerMandatory(process.cwd(), { flag: args.includes('--require-register') || process.env.LOOM_REQUIRE_REGISTER === '1' }),
  };
  const result = validateRun(runDir, opts);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nDiscovery gates — ${runDir}\n`);
    for (const g of result.gates) {
      const mark = g.status === 'pass' ? 'PASS' : g.status === 'skip' ? 'SKIP' : 'FAIL';
      console.log(`  [${mark}] ${g.id} ${g.name}`);
      for (const i of g.issues) console.log(`         - ${i}`);
    }
    console.log(`\n${result.ok ? 'OK — all applicable gates pass' : 'BLOCKED — gate failures above'}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv);
