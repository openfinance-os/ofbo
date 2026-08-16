#!/usr/bin/env node
// HARNESS-16 — build the ai-review job matrix from the engine registry, and refuse to build
// one that would silently not review.
//
// The AI-review port is engine-agnostic: read a CODEOWNERS-protected reviewer definition,
// diff the PR against its base, write a review whose last line is a `VERDICT:` line. Each
// engine is an adapter satisfying that contract (PRD §3 ports doctrine applied to CI).
//
// THE LOAD-BEARING CHECK is `adapter exists`. Adding an engine takes two edits — a registry
// entry and a guarded step in the workflow — and the failure mode of doing only the first is
// the worst one available: a matrix leg that runs, finds no adapter step to execute, produces
// no review file, and would otherwise surface as the generic "DID NOT COMPLETE". This script
// turns that into a loud, specific, zero-cost failure BEFORE any model is invoked.
//
// Run by the `config` job of .github/workflows/ai-review.yml. Guarded by
// scripts/test/ai-review-matrix.test.mjs, which runs in the discovery-gates job.

import { readFileSync, existsSync } from 'node:fs';

export const CONFIG_PATH = '.github/ai-review.config.json';
export const WORKFLOW_PATH = '.github/workflows/ai-review.yml';

/** The guard an adapter step must carry for `key` to count as implemented. */
export function adapterGuard(key) {
  return `matrix.engine.key == '${key}'`;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Validate the registry and produce the job matrix.
 *
 * @param {object} config       parsed .github/ai-review.config.json
 * @param {string} workflowText raw text of .github/workflows/ai-review.yml
 * @param {object} [opts]
 * @param {(p: string) => boolean} [opts.fileExists] injectable for tests
 * @returns {{reviewer: object[], engine: object[]}}
 * @throws {Error} listing every problem found, not just the first
 */
export function buildMatrix(config, workflowText, opts = {}) {
  const fileExists = opts.fileExists ?? existsSync;
  const problems = [];

  const reviewers = Array.isArray(config?.reviewers) ? config.reviewers : [];
  const engines = Array.isArray(config?.engines) ? config.engines : [];

  if (reviewers.length === 0) problems.push('no reviewers declared');
  if (engines.length === 0) problems.push('no engines declared');

  const seenReviewer = new Set();
  for (const [i, r] of reviewers.entries()) {
    const at = `reviewers[${i}]`;
    for (const field of ['key', 'label', 'agent']) {
      if (!isNonEmptyString(r?.[field])) problems.push(`${at}: missing or empty "${field}"`);
    }
    if (isNonEmptyString(r?.key)) {
      if (seenReviewer.has(r.key)) problems.push(`${at}: duplicate reviewer key "${r.key}"`);
      seenReviewer.add(r.key);
    }
    // A renamed or moved agent definition would otherwise reach the model as a prompt
    // pointing at a file that is not there — and the reviewer would improvise.
    if (isNonEmptyString(r?.agent) && !fileExists(r.agent)) {
      problems.push(`${at}: agent definition "${r.agent}" does not exist`);
    }
  }

  const seenEngine = new Set();
  const enabled = [];
  for (const [i, e] of engines.entries()) {
    const at = `engines[${i}]`;
    for (const field of ['key', 'label', 'secret', 'attribution']) {
      if (!isNonEmptyString(e?.[field])) problems.push(`${at}: missing or empty "${field}"`);
    }
    for (const flag of ['enabled', 'requires_workflow_parity']) {
      if (typeof e?.[flag] !== 'boolean') problems.push(`${at}: "${flag}" must be true or false`);
    }
    // null is meaningful: "let the engine choose its own default model".
    if (!(e?.model === null || isNonEmptyString(e?.model))) {
      problems.push(`${at}: "model" must be a non-empty string or null`);
    }
    if (isNonEmptyString(e?.key)) {
      if (seenEngine.has(e.key)) problems.push(`${at}: duplicate engine key "${e.key}"`);
      seenEngine.add(e.key);
      if (e.enabled === true) {
        enabled.push(e);
        if (!workflowText.includes(adapterGuard(e.key))) {
          problems.push(
            `${at}: engine "${e.key}" is enabled but ${WORKFLOW_PATH} has no adapter step ` +
              `guarded by \`${adapterGuard(e.key)}\`. An enabled engine with no adapter would ` +
              `produce no review at all — add the adapter step, or set "enabled": false.`,
          );
        }
      }
    }
  }

  if (engines.length > 0 && enabled.length === 0) {
    problems.push('no engine is enabled — every review would be a non-review');
  }

  if (problems.length > 0) {
    throw new Error(
      `${CONFIG_PATH} is not usable:\n` + problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  return {
    reviewer: reviewers.map((r) => ({ key: r.key, label: r.label, agent: r.agent })),
    engine: enabled.map((e) => ({
      key: e.key,
      label: e.label,
      model: e.model ?? '',
      secret: e.secret,
      attribution: e.attribution,
      // Stringified: GitHub Actions expressions compare matrix values as strings.
      requires_workflow_parity: String(e.requires_workflow_parity),
    })),
  };
}

// --- CLI: prints `matrix=<json>` for $GITHUB_OUTPUT -------------------------------------
// Entry-point detection follows scripts/adr-number-check.mjs:221 — same convention, and it
// avoids a global that eslint.config.mjs does not grant to scripts/**/*.mjs.
if (process.argv[1] && process.argv[1].endsWith('ai-review-matrix.mjs')) {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
    const matrix = buildMatrix(config, workflowText);
    const legs = matrix.reviewer.length * matrix.engine.length;
    console.error(
      `ai-review-matrix: ${matrix.reviewer.length} reviewer(s) x ${matrix.engine.length} ` +
        `enabled engine(s) = ${legs} check run(s): ` +
        matrix.engine.map((e) => e.label).join(', '),
    );
    console.log(`matrix=${JSON.stringify(matrix)}`);
  } catch (err) {
    console.error(`::error title=AI review registry::${err.message.split('\n')[0]}`);
    console.error(err.message);
    process.exit(1);
  }
}
