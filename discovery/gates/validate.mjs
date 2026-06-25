#!/usr/bin/env node
// Discovery gate validator — D1..D8. Pure Node, zero deps, deterministic.
//
//   node discovery/gates/validate.mjs discovery/runs/<slug> [--register <dir>] [--brand <path>] [--json]
//
// Exit 0 iff every applicable gate passes. Gates are mechanical: structure, references,
// presence — not taste.
import { join, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  read, frontMatter, section, filledRows, hasContent, signalIds, drIds, ctrlIds, listFiles, PLACEHOLDER,
} from './lib.mjs';
import { loadRegister } from './registers.mjs';
import { parseBrand, checkVisualHtml, checkVisualMarkdown, checkVisualOoxml, MARKER } from './brand.mjs';

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

export function validateRun(runDir, opts = {}) {
  const p = (f) => join(runDir, f);
  const docs = {};
  for (const [k, f] of Object.entries(ARTIFACTS)) {
    const raw = read(p(f));
    docs[k] = { raw, ...frontMatter(raw), exists: existsSync(p(f)), file: f };
  }
  const register = opts.register !== null ? loadRegister(opts.registerDir) : null;
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
  {
    if (!register) {
      gates.push(gate('D6', 'Data-governance feasibility', ['register not mounted — skipped'], 'skip'));
    } else {
      const issues = [];
      if (!docs.dataGov.exists) issues.push(`${ARTIFACTS.dataGov} missing`);
      else {
        const drs = drIds(docs.dataGov.body);
        const ctrls = ctrlIds(docs.dataGov.body);
        if (drs.size === 0) issues.push('cites no DR-* risk category');
        for (const id of drs) if (!register.drIds.has(id)) issues.push(`DR id ${id} does not resolve in register`);
        for (const id of ctrls) if (!register.ctrlIds.has(id)) issues.push(`control ${id} does not resolve in register`);
        if (!REG_DRIVERS.test(docs.dataGov.body)) issues.push('cites no regulatory driver');
        const verdict = ((docs.dataGov.body.match(/Acceptable for delivery\?\*\*\s*(.*)/i) || [])[1] || '').trim();
        const unfilled = /^yes\s*\/\s*no\s*\/\s*conditional\s*[—-]?\s*$/i.test(verdict);
        if (!/(yes|no|conditional)/i.test(verdict) || PLACEHOLDER.test(verdict) || unfilled)
          issues.push('no residual-risk verdict');
      }
      gates.push(gate('D6', 'Data-governance feasibility', issues));
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
      if (!existsSync(p(wf))) issues.push(`wireframe asset ${wf} missing`);
      else if (!read(p(wf)).includes(MARKER)) issues.push(`${wf} missing brand marker`);
      issues.push(...scanSolutioning(`${ARTIFACTS.prototype} (over-specified)`, docs.prototype.body));
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
      }
      gates.push(gate('D9', 'Validation loop', issues));
    }
  }

  const ok = gates.every((g) => g.status !== 'fail');
  return { runDir, ok, gates };
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
  const opts = {
    registerDir: regIdx >= 0 ? args[regIdx + 1] : undefined,
    register: args.includes('--no-register') ? null : undefined,
    brandPath: brandIdx >= 0 ? args[brandIdx + 1] : undefined,
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

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
