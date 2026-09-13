#!/usr/bin/env node
// Identifier legibility gate. The Loom's ids are terse on purpose — they exist so a claim can
// cite exactly what it rests on — but a reader should never have to guess at one. A markdown
// file that uses them must either expand the first use or link the glossary.
//
//   node scripts/id-legibility-check.mjs [--json]
//
// Deliberately lenient: it checks the FIRST use per file, not every use. Expanding all of them
// would bloat the prose, which is the opposite of the goal. Pure Node, zero deps.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The gate names are the validator's, verbatim. If a gate is renamed there, this map is wrong
// and the glossary is wrong with it — keep all three in step.
const GATE_NAMES = {
  D1: 'Problem framing',
  D2: 'Evidence',
  D3: 'Scope & stakeholders',
  D4: 'No-solutioning boundary',
  D5: 'Synthesis integrity',
  D6: 'Data-governance feasibility',
  D7: 'Brand conformance',
  D8: 'Tangibility',
  D9: 'Validation loop',
};

const GLOSSARY = /glossary\.md/i;

// A Factory Floor DECISION id: D<n>.<n>. It must carry the word "Decision" or a reader
// resolves it to discovery gate D<n> — a wrong referent, not merely a terse one. DR-* is a
// register id and is excluded.
const FLOOR_DECISION = /(?<!DR-)(?<!Decision )(?<![\w.])D(\d)\.(\d)(?![\w.])/g;

// The negative lookahead is load-bearing: without it "Decision D5.4" matches as gate "D5"
// (the word boundary holds before the dot), so one mistake gets reported as two and a
// correctly-written floor id is flagged as a bare gate id.
const GATE_ID = /\bD([1-9])\b(?!\.\d)/;

// The Loom's own trees. Scanning every markdown file in an adopting repo would police docs
// the Loom does not own — an adopter labelling a diagram "D1" would fail their build for a
// vocabulary they never opted into. The gate speaks only for the files the harness installs.
const LOOM_OWNED = [
  /^discovery\//, /^delivery\//, /^guardrails\//,
  /^docs\/governance\//, /^docs\/develop\//,
  /^\.claude\/(skills|agents)\//,
  /^plugins\/middleleap-loom\//,   // the source repo, where the bundle itself lives
];

// Two kinds of file are out of bounds even inside a Loom-owned tree.
//
//   GENERATED — floor forms are produced from the git templates and parity-gated. Editing the
//   output is how the output stops matching its source; the pointer belongs in the template,
//   and regeneration carries it.
//
//   INSTITUTIONAL — a BrainKit is the institution's own content, sealed by digest. The Loom
//   does not write in it, and a gate that demanded the Loom's vocabulary there would be
//   asserting ownership the method explicitly disclaims.
//   ACCEPTED RECORDS — an ADR is a decision as it was taken, signed and dated. A completed
//   discovery run is the same kind of thing: evidence, gate-checked and reviewed, for one
//   problem at one moment. Amending either to add a pointer rewrites a record after the fact,
//   which is precisely what a governance method must not do casually — and it is unnecessary,
//   because a run scaffolded from the templates inherits their pointer already. Policing
//   finished runs would only ever catch runs written before this gate existed, at the cost of
//   pushing people to edit their own evidence. Legibility is a property of living documentation.
const NOT_OURS_TO_EDIT = [
  /(^|\/)floor\//,
  /(^|\/)brainkit(-example)?\//,
  /(^|\/)institution\//,
  /(^|\/)adrs?\//,
  /(^|\/)discovery\/runs\//,
];

export function isLoomOwned(path) {
  if (NOT_OURS_TO_EDIT.some((re) => re.test(path))) return false;
  return LOOM_OWNED.some((re) => re.test(path));
}

/** Issues for one file. Empty array means the file is legible. */
export function checkFile(path, text) {
  const issues = [];

  // The glossary is the expansion. Asking it to link itself is circular.
  if (/(^|\/)glossary\.md$/i.test(path)) return issues;

  // First use per file, consistently with how the prose itself is written. A document that
  // establishes "Decision D5.4" once has told the reader which numbering scheme it is in;
  // demanding the word on all forty occurrences of a floor-heavy table makes it harder to
  // read, not easier, and that would be the opposite of the point.
  if (!/Decision D\d\.\d/.test(text)) {
    const m = FLOOR_DECISION.exec(text);
    FLOOR_DECISION.lastIndex = 0;                 // the regex is /g — reset for the next file
    if (m) {
      const line = text.slice(0, m.index).split('\n').length;
      issues.push(
        `${path}:${line}: floor decision id "D${m[1]}.${m[2]}" must be written "Decision D${m[1]}.${m[2]}" — bare, it reads as discovery gate D${m[1]}`,
      );
    }
  }

  // A file that tells the reader where to look has discharged its duty.
  if (GLOSSARY.test(text)) return issues;

  const first = text.match(GATE_ID);
  if (!first) return issues;

  const id = `D${first[1]}`;
  const line = text.slice(0, first.index).split('\n').length;
  // Look a little way past the id for its name — "D4 (No-solutioning boundary)" and
  // "D4 — No-solutioning boundary" both count.
  const window = text.slice(first.index, first.index + 120);
  if (!window.includes(GATE_NAMES[id])) {
    issues.push(
      `${path}:${line}: first use of ${id} is bare — write "${id} (${GATE_NAMES[id]})", or link the glossary`,
    );
  }
  return issues;
}

function main(argv) {
  const json = argv.includes('--json');
  const files = execSync('git ls-files "*.md"', { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).filter(isLoomOwned);
  const issues = files.flatMap((f) => {
    try { return checkFile(f, readFileSync(f, 'utf8')); } catch { return []; }
  });

  if (json) {
    console.log(JSON.stringify({ ok: issues.length === 0, count: issues.length, issues }, null, 2));
  } else {
    console.log('\nIdentifier legibility gate\n');
    for (const i of issues) console.log(`  - ${i}`);
    console.log(
      issues.length
        ? `\nBLOCKED — ${issues.length} issue(s). Expand the first use, or link the glossary.\n`
        : `\nIdentifier legibility gate — OK (${files.length} markdown file(s), every id findable)\n`,
    );
  }
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv);
