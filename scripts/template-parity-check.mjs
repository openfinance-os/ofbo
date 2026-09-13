// The template-parity gate (Factory Floor WS3 · D3.1). The floor's whole promise is that a
// non-technical teammate can fill in a guided form and the result passes the gates. That promise
// breaks silently the moment the form and the artifact drift: a section renamed in the markdown
// template, a column added to a risk table, and the floor keeps asking for last month's shape
// while the gate checks this month's. Nobody notices until an approval is refused for a field
// nobody was asked to fill.
//
// So the floor definitions are GENERATED and re-verified here, exactly as the copy table is
// re-verified against the copy manifest: each `floor/templates/*.json` names the git template it
// came from, and this gate regenerates it and fails on any difference — including a stale
// `source_digest`, which catches an edit to the markdown that was never carried across.
//
//   node scripts/template-parity-check.mjs          # verify (CI)
//   node scripts/template-parity-check.mjs --fix    # regenerate the definitions
//
// Adding a template pair: `--add <path-to-template.md> [write-class]`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { diff, generate } from '../core/floor-templates.mjs';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FLOOR_DIR = 'floor/templates';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const write = (p, def) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(def, null, 2)}\n`);
};

/**
 * Verify (or with `fix`, rewrite) every floor definition against the template it names.
 * Findings ([] ⇒ every pair is in step). The definitions ARE the index: a definition names its
 * own source, so there is no second list to fall out of date.
 */
export function run(cwd = HARNESS, { fix = false } = {}) {
  const dir = `${cwd}/${FLOOR_DIR}`;
  if (!existsSync(dir)) return { findings: [], count: 0, fixed: 0 };
  const findings = [];
  let count = 0;
  let fixed = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = `${dir}/${name}`;
    const stored = readJson(path);
    if (!stored) { findings.push(`${name}: not readable as JSON`); continue; }
    if (!stored.source) { findings.push(`${name}: names no \`source\` — a definition that cannot say where it came from cannot be checked`); continue; }
    const src = `${cwd}/${stored.source}`;
    if (!existsSync(src)) {
      findings.push(`${name}: its source template ${stored.source} does not exist — the pair is broken, not merely stale`);
      continue;
    }
    count++;
    const fresh = generate(src, { source: stored.source, writeClass: stored.write_class });
    const d = diff(stored, fresh, name);
    if (!d.length) continue;
    if (fix) { write(path, fresh); fixed++; } else findings.push(...d);
  }
  return { findings, count, fixed };
}

/** Add a new pair: generate the definition for a template that has none yet. */
export function add(cwd, sourceRel, writeClass = 'born-on-the-floor') {
  const src = `${cwd}/${sourceRel}`;
  if (!existsSync(src)) throw new Error(`no such template: ${sourceRel}`);
  const def = generate(src, { source: sourceRel, writeClass });
  if (!def.artifact) throw new Error(`${sourceRel}: template declares no \`artifact\` in its frontmatter`);
  const path = `${cwd}/${FLOOR_DIR}/${def.artifact}.json`;
  write(path, def);
  return path;
}

// CLI (skipped when imported by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--add') {
    const path = add(HARNESS, args[1], args[2]);
    process.stdout.write(`Generated ${path.replace(`${HARNESS}/`, '')}\n`);
  } else {
    const fix = args.includes('--fix');
    const { findings, count, fixed } = run(HARNESS, { fix });
    if (findings.length) {
      process.stderr.write('\nTemplate-parity gate — FAIL\n\n');
      for (const f of findings) process.stderr.write(`  - ${f}\n`);
      process.stderr.write('\nThe guided form on the floor is generated from the git template. Regenerate\nwith `node scripts/template-parity-check.mjs --fix` and commit the result, so a\nteammate filling the form is asked for exactly what the gate will check.\n');
      process.exit(1);
    }
    process.stdout.write(fix
      ? `Template-parity gate — OK (${count} pair${count === 1 ? '' : 's'}, ${fixed} regenerated)\n`
      : `Template-parity gate — OK (${count} pair${count === 1 ? '' : 's'} in step)\n`);
  }
}
