// The doc-integrity gate (Loom 2.0-rc.7 W4/W6). Prose drifts from machinery — that is how the
// adoption guide came to say "all six gates" long after the sixteenth shipped, and how the
// self-grade kept stale rows. This gate makes drift a build failure: named blocks in the canon
// are GENERATED from the source of truth (the copy manifest, the control catalog), embedded
// between markers, and re-verified on every run.
//
//   <!-- LOOM:<BLOCK>:START -->  …generated…  <!-- LOOM:<BLOCK>:END -->
//
// verify (default) fails when the embedded block differs from a fresh generation; --fix
// rewrites the blocks. Targets that do not exist (e.g. in an adopted layout that carries no
// bundle docs) are skipped — this is a bundle-level check. Run from the harness dir:
// `node scripts/doc-integrity-check.mjs [--fix]`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The generated blocks: file → { block-name → async generator }. The generators dynamic-import
// their sources (adopt.mjs is bundle-only and not present in an adopted layout) so this gate
// LOADS everywhere and is simply inert where the bundle docs are absent.
export const TARGETS = [
  { file: resolve(HARNESS, '../SKILL.md'), block: 'COPY-TABLE', gen: async () => (await import('../adopt.mjs')).copyTable() },
  { file: resolve(HARNESS, '../../loom/references/bank-grade-gap.md'), block: 'SCORECARD', gen: async () => (await import('./generate-scorecard.mjs')).generateScorecard(HARNESS) },
  { file: resolve(HARNESS, 'guardrails/README.md'), block: 'GUARDRAIL-MATRIX', gen: async () => (await import('./guardrail-policy-check.mjs')).generateGuardrailMatrix(HARNESS) },
];

const marker = (block, which) => `<!-- LOOM:${block}:${which} -->`;

/** Extract the current content between a block's markers, or null if the markers are absent. */
export function extractBlock(text, block) {
  const s = text.indexOf(marker(block, 'START'));
  const e = text.indexOf(marker(block, 'END'));
  if (s < 0 || e < 0) return null;
  return text.slice(s + marker(block, 'START').length, e).trim();
}

function replaceBlock(text, block, content) {
  const s = text.indexOf(marker(block, 'START'));
  const e = text.indexOf(marker(block, 'END'));
  return text.slice(0, s + marker(block, 'START').length) + '\n' + content + '\n' + text.slice(e);
}

/** Findings ([] ⇒ every embedded block matches its generator). `fix` rewrites instead. */
export async function run(fix = false) {
  const findings = [];
  for (const t of TARGETS) {
    if (!existsSync(t.file)) continue; // bundle-only doc; absent in an adopted layout
    const text = readFileSync(t.file, 'utf8');
    const want = (await t.gen()).trim();
    const have = extractBlock(text, t.block);
    if (have === null) { findings.push(`${t.file}: no ${t.block} markers — cannot keep it generated`); continue; }
    if (have !== want) {
      if (fix) { writeFileSync(t.file, replaceBlock(text, t.block, want)); }
      else findings.push(`${t.file}: ${t.block} is stale — regenerate with \`node scripts/doc-integrity-check.mjs --fix\``);
    }
  }
  return findings;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fix = process.argv.includes('--fix');
  const findings = await run(fix);
  if (findings.length) {
    process.stderr.write('\nDoc-integrity gate — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nGenerated docs must match their source of truth. Run with --fix, commit, and the drift is gone.\n');
    process.exit(1);
  }
  process.stdout.write(`Doc-integrity gate — OK${fix ? ' (blocks regenerated)' : ''}\n`);
}
