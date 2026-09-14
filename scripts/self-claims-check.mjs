// The self-claims gate (rc.26). The Loom is exacting about claims made by the software it
// builds and, until this file, almost silent about claims it makes about ITSELF. Every defect
// found in the rc.18–rc.25 review was the same shape — a claim and its evidence drifting apart —
// and it drifted in both directions:
//
//   ten gates enforced but absent from the control catalog      evidence with no claim
//   three checklist rows claiming CI-proven with no bypass test  claim with no evidence
//   forty-two inversions in CI, ten credited by the checklist    evidence with no claim, again
//   a status board reporting "validated" on a repository where nine gates were red
//   prose citing a governance record the bundle does not ship
//
// Those were fixed one at a time, by hand, after a human noticed. This gate makes the class
// mechanical, in the method's own idiom: observed, not declared.
//
// WHAT IT CHECKS, and why each rule is shaped the way it is rather than stricter.
//
//   C1 · Prose citations resolve. A reference file or runbook that names `scripts/foo.mjs` must
//        name one that exists. Cheap, and it catches the dead-link class directly.
//
//   C2 · No BARE "CI-proven". The pilot playbook defines the term as "a negative bypass test in
//        .github/workflows/validate.yml demonstrates the rejection". A claim of that strength
//        must say which test, or say which PART of the row it covers. The checklist has three
//        honest shapes and the rule respects all three:
//          NAMED   `**CI-proven** (placeholder-owner negative test)`  → must link to evidence (C3)
//          SCOPED  `control-plane **CI-proven**; branch protection **live**` → a narrower claim,
//                  already honest about which half is which; no bypass test demanded
//          BARE    `**CI-proven**` with neither → FAILS. This is exactly the shape of the three
//                  rows a reviewer caught by hand.
//
//   C3 · A NAMED claim links to real evidence. Its row must name a gate in backticks, and that
//        gate must actually have an inversion (`if node scripts/<gate>.mjs`) in validate.yml.
//        Matching on the GATE rather than on the prose test-name is deliberate: names like
//        "superseded-pin negative test" are for humans and drift freely, while the inversion is
//        the thing that either exists or does not.
//
//   C4 · Uncredited inversions are REPORTED, never failed. CI runs far more negative tests than
//        the checklist cites, and that is fine — the checklist enumerates ATTACKS, not gates.
//        Forcing one row per inversion would manufacture rows nobody meant to write. So the
//        reverse drift is printed on every run and blocks nothing: visible, not tyrannical.
//        Silence about it is what let the first gap grow.
//
//   C5 · A documented CLI FLAG must exist (rc.32). Added because this gate missed one, and the
//        one it missed was in the gate written to stop exactly this: rc.29 shipped
//        discovery-sync-check.mjs whose header advertised `--reconcile`, and never implemented it.
//        Passing it printed a comparison and silently changed nothing, while the operator believed
//        a sync point had been stamped. C1 could not see it — C1 checks that a cited SCRIPT PATH
//        exists, and the script did exist; only its advertised behaviour did not.
//
//        The rule is deliberately narrow, because a broad one is unusable. A flag counts as
//        documented only when a comment line NAMES THIS FILE and shows the flag on it — the usage
//        lines every CLI here already carries:
//
//            //   node scripts/discovery-sync-check.mjs --upstream <dir> --reconcile
//
//        so a comment mentioning git's `--force-with-lease`, or another script's `--tier`, is not
//        a claim this file makes about itself. It then has to appear outside the file's own
//        full-line comments. Measured against the tree at the time it was written: 61 scripts
//        document flags, zero false positives, and it catches the rc.29 defect from the git blob.
//
// BUNDLE-ONLY, like doc-integrity and the installer contract. It reads this repository's own
// workflow and layout; an adopted tree has neither, so it exits clean there rather than
// inventing a verdict about files that were never meant to be present.
//
//   node scripts/self-claims-check.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// harness → loom-adopt → skills → middleleap-loom → plugins → repo root
const REPO = resolve(HARNESS, '../../../../..');
export const WORKFLOW = resolve(REPO, '.github/workflows/validate.yml');
export const PLAYBOOK = resolve(HARNESS, 'governance/runbooks/pilot-playbook.md');

/** Prose files whose claims this gate holds to account. */
export function proseFiles() {
  const out = [resolve(HARNESS, '../SKILL.md'), resolve(HARNESS, '../../loom/SKILL.md')];
  for (const dir of [resolve(HARNESS, '../../loom/references'), resolve(HARNESS, 'governance/runbooks')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.push(join(dir, f));
  }
  return out.filter(existsSync);
}

/** The command-line entry points whose advertised flags this gate holds to account (C5). */
export function cliFiles() {
  const out = [resolve(HARNESS, 'adopt.mjs'), resolve(HARNESS, 'assess.mjs')];
  const dir = resolve(HARNESS, 'scripts');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) out.push(join(dir, f));
  }
  return out.filter(existsSync);
}

/**
 * Flags a file advertises ABOUT ITSELF. Only a full-line comment that names the file counts — the
 * usage lines these CLIs already carry. That narrowness is the point: a comment mentioning another
 * tool's flag (`git --force-with-lease`, `adopt.mjs --tier`) is not a claim this file makes.
 */
export function documentedFlags(text, name) {
  const flags = new Set();
  for (const line of text.split('\n')) {
    if (!/^\s*(\/\/|\*)/.test(line) || !line.includes(name)) continue;
    for (const m of line.matchAll(/--[a-z][a-z0-9-]*/g)) flags.add(m[0]);
  }
  return [...flags].sort();
}

/**
 * Documented flags the file never mentions outside its own full-line comments. Comment stripping is
 * deliberately conservative — only whole-line comments go, so a flag referenced anywhere in real
 * code counts as implemented. This errs toward MISSING a defect rather than inventing one: a gate
 * that cries wolf about flags gets switched off, and then it protects nothing.
 */
export function unimplementedFlags(text, name) {
  const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  return documentedFlags(text, name).filter((f) => !code.includes(f));
}

/** Gates the workflow runs a NEGATIVE test against — `if node scripts/X.mjs; then <error>; fi`. */
export function invertedGates(workflowText) {
  return new Set([...workflowText.matchAll(/if node (scripts\/[a-z0-9-]+\.mjs)/g)].map((m) => m[1]));
}

/** Classify one checklist row's status cell. See C2. */
export function classifyClaim(status) {
  if (!/\*\*CI-proven\*\*/.test(status)) return null;
  if (/\*\*CI-proven\*\*\s*\(/.test(status)) return 'named';
  // SCOPED: a qualifier immediately before the term names which part is proven
  // ("control-plane **CI-proven**", "declared **CI-proven**", "PA2 **CI-proven**").
  if (/[\w-]+\s+\*\*CI-proven\*\*/.test(status)) return 'scoped';
  return 'bare';
}

/** Rows of the adversarial checklist, parsed. */
export function checklistRows(playbookText) {
  const rows = [];
  playbookText.split('\n').forEach((line, i) => {
    if (!line.startsWith('|') || !line.includes('CI-proven')) return;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 3) return;
    const [attack, mechanism, status] = cells;
    rows.push({
      line: i + 1,
      attack,
      status,
      form: classifyClaim(status),
      gates: [...mechanism.matchAll(/`([a-z0-9-]+(?:-check|-scan))`/g)].map((m) => `scripts/${m[1]}.mjs`),
    });
  });
  return rows;
}

/** Findings (blocking) plus notices (reported, never blocking). Pure — inputs are text. */
export function evaluate({ playbook, workflow, prose = [], clis = [], exists = existsSync }) {
  const findings = [];
  const notices = [];

  // C1 — prose may not cite a gate that does not exist.
  for (const { file, text } of prose) {
    for (const m of text.matchAll(/`(scripts\/[a-z0-9-]+\.(?:mjs|sh))`/g)) {
      if (!exists(resolve(HARNESS, m[1]))) findings.push(`${file}: cites \`${m[1]}\`, which does not exist`);
    }
  }

  // C5 — a CLI may not advertise a flag it does not handle.
  for (const { file, name, text } of clis) {
    for (const flag of unimplementedFlags(text, name)) {
      findings.push(
        `${file}: its usage documents \`${flag}\`, which appears nowhere in the code — passing it ` +
          'does nothing, silently, while the operator believes it worked',
      );
    }
  }

  if (playbook === null || workflow === null) return { findings, notices, rows: [] };

  const inverted = invertedGates(workflow);
  const rows = checklistRows(playbook);
  const credited = new Set();

  for (const r of rows) {
    if (r.form === 'bare') {
      findings.push(
        `pilot-playbook.md:${r.line} "${r.attack}" claims **CI-proven** without naming its negative test ` +
          'or scoping the claim — the playbook defines the term as a demonstrated bypass rejection',
      );
      continue;
    }
    if (r.form !== 'named') continue;
    if (!r.gates.length) {
      findings.push(
        `pilot-playbook.md:${r.line} "${r.attack}" claims a named negative test but its mechanism cell ` +
          'names no gate in backticks — the claim cannot be linked to the test that backs it',
      );
      continue;
    }
    const backed = r.gates.filter((g) => inverted.has(g));
    r.gates.forEach((g) => backed.includes(g) && credited.add(g));
    if (!backed.length) {
      findings.push(
        `pilot-playbook.md:${r.line} "${r.attack}" claims a negative test, but no gate it names ` +
          `(${r.gates.join(', ')}) has an inversion in validate.yml`,
      );
    }
  }

  // C4 — the reverse drift. Reported so it is visible; never a failure (see the header).
  for (const g of [...inverted].sort()) {
    if (!credited.has(g)) notices.push(g);
  }
  return { findings, notices, rows };
}

export function main() {
  process.stdout.write('\nSelf-claims gate — the bundle is held to its own claims\n\n');
  if (!existsSync(WORKFLOW) || !existsSync(PLAYBOOK)) {
    process.stdout.write('  bundle-only check — this repository layout is not present, nothing to verify\n\n');
    return 0;
  }
  const prose = proseFiles().map((f) => ({ file: f.slice(REPO.length + 1), text: readFileSync(f, 'utf8') }));
  const clis = cliFiles().map((f) => ({ file: f.slice(REPO.length + 1), name: basename(f), text: readFileSync(f, 'utf8') }));
  const { findings, notices, rows } = evaluate({
    playbook: readFileSync(PLAYBOOK, 'utf8'),
    workflow: readFileSync(WORKFLOW, 'utf8'),
    prose,
    clis,
  });

  if (notices.length) {
    process.stdout.write(
      `  ${notices.length} gate(s) run a negative test in CI that the adversarial checklist does not credit.\n` +
        '  Not a failure — the checklist enumerates attacks, not gates — but the drift is worth seeing:\n',
    );
    for (const n of notices) process.stdout.write(`    · ${n}\n`);
    process.stdout.write('\n');
  }

  if (findings.length) {
    process.stdout.write('Self-claims gate — FAIL\n\n');
    for (const f of findings) process.stdout.write(`  - ${f}\n`);
    process.stdout.write('\nA claim of this strength must name the evidence that backs it, or scope itself\nto the part it covers. See governance/runbooks/pilot-playbook.md.\n\n');
    return 1;
  }
  const named = rows.filter((r) => r.form === 'named').length;
  const scoped = rows.filter((r) => r.form === 'scoped').length;
  const flagged = clis.filter((c) => documentedFlags(c.text, c.name).length);
  const flagCount = flagged.reduce((n, c) => n + documentedFlags(c.text, c.name).length, 0);
  process.stdout.write(
    `  ${rows.length} CI-proven claim(s): ${named} named and linked to a real inversion, ${scoped} scoped to a part\n` +
      `  ${prose.length} prose file(s) checked — every gate they cite exists\n` +
      `  ${flagCount} documented flag(s) across ${flagged.length} CLI(s) — every one of them is handled\n` +
      '\nSelf-claims gate — OK\n\n',
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
