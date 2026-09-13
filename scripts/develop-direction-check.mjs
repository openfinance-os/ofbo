// HG-0009 — the develop-diverge gate (2.1.0, plan row 1.8). The right diamond is a diamond only
// if it diverges before it converges: the `develop` skill fans out N solution directions, judges
// them, and converges on one in a Solution Direction Record (SDR). HG-0009 named that as a
// decision in 1.11; nothing checked it. A record naming one direction dressed as a choice, or a
// "judgment" with no criterion, passed everything — the diamond was a straight line with a table.
//
// This gate reads every SDR under docs/develop/ (and every one a backlog item names in `sdr:`)
// and fails when:
//   · fewer than three directions are recorded as explored — a real alternative must have been
//     live at the moment of the decision;
//   · the judgment names no criterion, or scores nothing — "we picked the best" is not a method;
//   · no direction is chosen — a record that explored and never converged is not a record;
//   · a backlog item's `sdr:` points at a file that is not there.
// It is structural, like the D gates: it checks that the shape of a decision exists, never that
// the decision was right. The judge's rationale is the human reviewer's to read.
//
// Run from the repo root: `node scripts/develop-direction-check.mjs` (exit 1 on any finding).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { frontMatter, section, filledRows, hasContent, PLACEHOLDER } from '../discovery/gates/lib.mjs';

export const SDR_DIR = 'docs/develop';
export const BACKLOG = 'docs/backlog.yaml';
export const MIN_DIRECTIONS = 3;

/** Findings for one SDR's text. [] ⇒ the record shows a real divergence and a real convergence. */
export function evaluate(text, label = 'SDR') {
  const findings = [];
  const { fm, body } = frontMatter(text);
  if (!fm.handoff || PLACEHOLDER.test(fm.handoff)) findings.push(`${label}: names no hand-off (front-matter handoff:) — a direction record answers a discovery, not a request`);

  // Directions: a table row counts when its Direction cell is filled with something a human wrote.
  const directions = filledRows(section(body, 'The directions explored'), ['direction', 'shape'])
    .filter((cells) => cells[1] && !PLACEHOLDER.test(cells[1]));
  if (directions.length < MIN_DIRECTIONS) {
    findings.push(`${label}: ${directions.length} direction(s) explored, HG-0009 requires at least ${MIN_DIRECTIONS} — one direction dressed as a choice is a straight line, not a diamond`);
  }

  // Judgment: at least one named criterion, and at least one score that is not a placeholder.
  const judgment = filledRows(section(body, 'The judgment'), ['criterion']);
  const criteria = judgment.filter((cells) => cells[0] && !PLACEHOLDER.test(cells[0]));
  if (criteria.length === 0) findings.push(`${label}: the judgment names no criterion — how the directions were scored must be stated (D1 measures, D6 conditions, institutional fit)`);
  else if (!criteria.some((cells) => cells.slice(1).some((c) => c && !PLACEHOLDER.test(c)))) {
    findings.push(`${label}: the judgment scores nothing — every criterion row is unfilled`);
  }

  // Convergence: the chosen direction is written down.
  // Guidance blockquotes (`> …`) are the template's, not the author's: strip them before asking
  // whether anything was written, or an unfilled copy of the template reads as converged.
  const chosen = section(body, 'The chosen direction').split('\n').filter((l) => !l.trim().startsWith('>')).join('\n');
  if (!hasContent(chosen)) findings.push(`${label}: no chosen direction — the record explored and never converged`);
  return findings;
}

/** `sdr:` references from the backlog text (any nesting style; quoted or bare). */
export function sdrRefs(backlogText) {
  return [...new Set([...backlogText.matchAll(/\bsdr:\s*["']?([^\s"',}]+)/g)].map((m) => m[1]))];
}

export function check(cwd = process.cwd()) {
  const findings = [];
  const notices = [];
  const seen = new Set();
  const dir = `${cwd}/${SDR_DIR}`;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      const path = `${SDR_DIR}/${name}`;
      seen.add(path);
      findings.push(...evaluate(readFileSync(`${cwd}/${path}`, 'utf8'), path));
    }
  }
  if (existsSync(`${cwd}/${BACKLOG}`)) {
    for (const ref of sdrRefs(readFileSync(`${cwd}/${BACKLOG}`, 'utf8'))) {
      if (seen.has(ref)) continue;
      if (!existsSync(`${cwd}/${ref}`)) { findings.push(`${BACKLOG}: sdr: ${ref} — no such record; a backlog item that names a direction record it does not have is claiming a convergence that never happened`); continue; }
      seen.add(ref);
      findings.push(...evaluate(readFileSync(`${cwd}/${ref}`, 'utf8'), ref));
    }
  }
  if (seen.size === 0) notices.push(`no Solution Direction Record under ${SDR_DIR}/ and no backlog item names one — nothing for HG-0009 to examine yet`);
  return { findings, notices, examined: seen.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, notices, examined } = check();
  for (const n of notices) process.stdout.write(`  note: ${n}\n`);
  if (findings.length) {
    process.stderr.write('\nDevelop-diverge gate (HG-0009) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nThe right diamond diverges before it converges: a Solution Direction Record names at\nleast three directions, the criteria they were judged on, and the one chosen.\n');
    process.exit(1);
  }
  process.stdout.write(`Develop-diverge gate (HG-0009) — OK (${examined} direction record(s) examined)\n`);
}
