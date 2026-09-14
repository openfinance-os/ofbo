// The freeze-stamp gate (Factory Floor WS4 · D4.1). A discovery run that was frozen from a floor
// page carries, beside each exported file, a stamp naming the digest of exactly what was
// exported. This gate re-derives the digest and fails on any difference.
//
// What it is really defending. The D-gates re-run on the export, so a frozen artifact is what a
// gate reads — and the freeze is the moment the floor's draft becomes the record. Editing the
// frozen file afterwards is the quiet way to change what a gate saw without going back through
// the surface that produced it. That is not vandalism; it is the ordinary, well-intentioned
// "quick fix in the repo", and the whole point of a freeze is that there is no such thing.
//
//   node scripts/freeze-stamp-check.mjs
//
// The gate is silent where no run carries stamps — an adopter who has not adopted the floor
// freezes nothing, and their hand-authored discovery runs are unaffected. It tightens only where
// a freeze has actually happened.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { SCHEMA_ID, verifyStamp } from '../core/floor-export.mjs';

export const RUNS_DIR = 'discovery/runs';
export const STAMPS_SUBDIR = '.freeze';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** Every stamp in a run: `discovery/runs/<slug>/.freeze/*.json`. */
export function loadStamps(runDir) {
  const dir = `${runDir}/${STAMPS_SUBDIR}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    .map((n) => ({ name: n, stamp: readJson(`${dir}/${n}`) }));
}

/** Findings for one run directory. */
export function checkRun(runDir, slug = runDir) {
  const findings = [];
  let checked = 0;
  for (const { name, stamp } of loadStamps(runDir)) {
    const label = `${slug} · ${name}`;
    if (!stamp) { findings.push(`${label}: not readable as JSON`); continue; }
    if (stamp.schema !== SCHEMA_ID) { findings.push(`${label}: schema ${JSON.stringify(stamp.schema)} is not ${SCHEMA_ID}`); continue; }
    if (typeof stamp.file !== 'string' || !stamp.file) { findings.push(`${label}: the stamp names no file — a stamp that cannot say what it stamped proves nothing`); continue; }
    // A stamp may only vouch for a file inside its own run. Otherwise one run's freeze could be
    // made to certify another's, or a path could climb out of the run entirely.
    if (stamp.file.includes('..') || stamp.file.startsWith('/')) {
      findings.push(`${label}: stamp file ${JSON.stringify(stamp.file)} escapes the run directory`);
      continue;
    }
    checked++;
    findings.push(...verifyStamp(stamp, readText(`${runDir}/${stamp.file}`), label));
  }
  return { findings, checked };
}

export function run(cwd = process.cwd()) {
  const dir = `${cwd}/${RUNS_DIR}`;
  if (!existsSync(dir)) return { findings: [], runs: 0, checked: 0 };
  const findings = [];
  let runs = 0;
  let checked = 0;
  for (const slug of readdirSync(dir).sort()) {
    const runDir = `${dir}/${slug}`;
    if (!statSync(runDir).isDirectory()) continue;
    const r = checkRun(runDir, slug);
    if (r.checked > 0) runs++;
    checked += r.checked;
    findings.push(...r.findings);
  }
  return { findings, runs, checked };
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, runs, checked } = run();
  if (findings.length) {
    process.stderr.write('\nFreeze-stamp gate (D4.1) — FAIL\n\n');
    for (const f of findings) process.stderr.write(`  - ${f}\n`);
    process.stderr.write('\nA frozen artifact is what the D-gates read. If it needs to change, change it\non the floor and re-freeze — editing the frozen file in place changes what a\ngate saw without going back through the surface that produced it.\n');
    process.exit(1);
  }
  process.stdout.write(checked
    ? `Freeze-stamp gate (D4.1) — OK (${checked} frozen artifact${checked === 1 ? '' : 's'} across ${runs} run${runs === 1 ? '' : 's'})\n`
    : 'Freeze-stamp gate (D4.1) — no frozen artifacts (nothing has been frozen from a floor)\n');
}
