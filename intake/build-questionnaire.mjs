// The questionnaire builder (2.3.0). intake/questionnaire.html is GENERATED: the template carries
// the page, this script embeds intake/questions.json and every intake/prefill/*.json into it, plus
// the digest of the question bank so an exported record says which bank it answered. Edit the
// bank or a pack, rebuild, commit. scripts/intake-check.mjs fails when the HTML and its sources
// disagree — the same discipline as the copy table and the floor forms.
//
//   node intake/build-questionnaire.mjs            # write intake/questionnaire.html
//
// Pure Node, no network, no dependency. The HTML it emits is opened locally in a browser by the
// people who answer; it saves to their browser and exports a JSON record. Nothing it produces is
// approved by being produced.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INTAKE = resolve(dirname(fileURLToPath(import.meta.url)));
export const MARKER = '/*LOOM:INTAKE-DATA*/';

export const questionsDigest = (bankText) => 'sha256:' + createHash('sha256').update(bankText).digest('hex');

/** Read the bank + packs from an intake directory. */
export function loadSources(intakeDir = INTAKE) {
  const bankText = readFileSync(join(intakeDir, 'questions.json'), 'utf8');
  const bank = JSON.parse(bankText);
  const packDir = join(intakeDir, 'prefill');
  const prefill = existsSync(packDir)
    ? readdirSync(packDir).filter((f) => f.endsWith('.json') && !f.includes('.template.')).sort()
        .map((f) => JSON.parse(readFileSync(join(packDir, f), 'utf8')))
    : [];
  return { bank, prefill, questions_digest: questionsDigest(bankText) };
}

/** The data block the page reads. `</script` cannot appear inside a script element, so it is escaped. */
export function dataBlock(sources) {
  const payload = { questions: sources.bank, prefill: sources.prefill, questions_digest: sources.questions_digest };
  return JSON.stringify(payload).replace(/<\/script/gi, '<\\/script');
}

/** Render the page from the template and the sources. Deterministic: same inputs, same bytes. */
export function render(intakeDir = INTAKE) {
  const tpl = readFileSync(join(intakeDir, 'questionnaire.template.html'), 'utf8');
  if (!tpl.includes(MARKER)) throw new Error(`questionnaire.template.html has no ${MARKER} marker`);
  return tpl.replace(MARKER, dataBlock(loadSources(intakeDir)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(INTAKE, 'questionnaire.html');
  writeFileSync(out, render());
  process.stdout.write(`questionnaire → ${out}\n`);
}
