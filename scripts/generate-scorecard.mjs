// The scorecard generator (Loom 2.0-rc.7 W6). "The catalog wins" was a sentence, not a
// mechanism — so the narrative self-grade drifted from the machine catalog (different totals,
// stale rows). This generator makes the scorecard a PROJECTION of the control catalog: one
// artifact, one truth. The doc-integrity gate embeds its output in bank-grade-gap.md and fails
// the build on drift.
//
// Adopter-side capabilities a bundle cannot ship (real IAM, WORM, the pilot, a regulator exam)
// live in the catalog too — state `absent`/`defined` with `adopter_side: true` — so the whole
// truth, including what is out of a bundle's reach, is in one place.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const STATE_ORDER = ['mechanically-validated', 'defined', 'absent', 'platform-enforced', 'organisationally-enforced'];
const LABEL = {
  'mechanically-validated': 'Mechanically validated', 'defined': 'Defined', 'absent': 'Absent',
  'platform-enforced': 'Platform enforced', 'organisationally-enforced': 'Organisationally enforced',
};

/** Generate the scorecard markdown block from the control catalog. */
export function generateScorecard(harnessDir = process.cwd()) {
  const catalog = JSON.parse(readFileSync(resolve(harnessDir, 'governance/control-catalog.template.json'), 'utf8'));
  const controls = catalog.controls || [];
  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
  let adopterSide = 0;
  for (const c of controls) {
    if (counts[c.state] !== undefined) counts[c.state]++;
    if (c.adopter_side) adopterSide++;
  }
  const header = `| ${STATE_ORDER.map((s) => LABEL[s]).join(' | ')} |`;
  const sep = `|${STATE_ORDER.map(() => '---').join('|')}|`;
  const row = `| ${STATE_ORDER.map((s) => counts[s]).join(' | ')} |`;
  const note = `_Generated from the control catalog (${controls.length} controls; ${adopterSide} flagged \`adopter_side\`) by \`scripts/generate-scorecard.mjs\`. The catalog is the state of record — do not edit this block by hand; run \`node scripts/doc-integrity-check.mjs --fix\`._`;
  return [header, sep, row, '', note].join('\n');
}

// CLI: print the scorecard block.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(generateScorecard(resolve(process.argv[2] || '.')) + '\n');
}
