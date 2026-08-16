// HARNESS-16 — guard tests for the AI-review engine registry (scripts/ai-review-matrix.mjs).
//
// These are the port's contract tests. The one that earns its place is "an enabled engine
// with no adapter step is rejected": adding an engine takes two edits, and doing only the
// first would otherwise produce a matrix leg that runs, executes no adapter, writes no
// review, and reports the generic "DID NOT COMPLETE" — a real non-review wearing the costume
// of a transient failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  buildMatrix,
  adapterGuard,
  CONFIG_PATH,
  WORKFLOW_PATH,
} from '../ai-review-matrix.mjs';

const ok = () => true;

/** A minimal valid registry; tests mutate a clone of it. */
function validConfig() {
  return {
    reviewers: [{ key: 'hard-stop', label: 'hard-stop', agent: '.claude/agents/hs.md' }],
    engines: [
      {
        key: 'claude',
        label: 'Claude',
        enabled: true,
        model: 'claude-opus-5',
        secret: 'TOK',
        attribution: '_by someone_',
        requires_workflow_parity: true,
      },
    ],
  };
}

const workflowWith = (...keys) => keys.map(adapterGuard).join('\n');

test('the real repository registry builds a matrix', () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const matrix = buildMatrix(config, workflow, { fileExists: existsSync });

  assert.ok(matrix.reviewer.length >= 1, 'at least one reviewer');
  assert.ok(matrix.engine.length >= 1, 'at least one enabled engine');
  // Every agent definition the registry points at must actually exist — buildMatrix checks
  // this, and this assertion documents that the real files are the ones being checked.
  for (const r of matrix.reviewer) assert.ok(existsSync(r.agent), `${r.agent} exists`);
});

test('every engine in the registry — enabled or not — has an adapter step', () => {
  // Stricter than buildMatrix, which only requires it for ENABLED engines. A disabled engine
  // shipped without an adapter is a trap: enabling it later looks like a one-line config
  // change and silently is not.
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const e of config.engines) {
    assert.ok(
      workflow.includes(adapterGuard(e.key)),
      `engine "${e.key}" has an adapter step guarded by \`${adapterGuard(e.key)}\``,
    );
  }
});

test('an ENABLED engine with no adapter step is rejected', () => {
  const config = validConfig();
  assert.throws(
    () => buildMatrix(config, workflowWith('some-other-engine'), { fileExists: ok }),
    /enabled but .* has no adapter step/s,
  );
});

test('a DISABLED engine with no adapter step is allowed through buildMatrix', () => {
  const config = validConfig();
  config.engines.push({
    key: 'not-built-yet',
    label: 'Nope',
    enabled: false,
    model: null,
    secret: 'X',
    attribution: '_by nobody_',
    requires_workflow_parity: false,
  });
  const matrix = buildMatrix(config, workflowWith('claude'), { fileExists: ok });
  assert.deepEqual(matrix.engine.map((e) => e.key), ['claude'], 'disabled engine is excluded');
});

test('no enabled engine at all is rejected — every review would be a non-review', () => {
  const config = validConfig();
  config.engines[0].enabled = false;
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: ok }),
    /no engine is enabled/,
  );
});

test('a reviewer pointing at a missing agent definition is rejected', () => {
  const config = validConfig();
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: () => false }),
    /does not exist/,
  );
});

test('duplicate keys are rejected', () => {
  const dupEngine = validConfig();
  dupEngine.engines.push({ ...dupEngine.engines[0] });
  assert.throws(
    () => buildMatrix(dupEngine, workflowWith('claude'), { fileExists: ok }),
    /duplicate engine key/,
  );

  const dupReviewer = validConfig();
  dupReviewer.reviewers.push({ ...dupReviewer.reviewers[0] });
  assert.throws(
    () => buildMatrix(dupReviewer, workflowWith('claude'), { fileExists: ok }),
    /duplicate reviewer key/,
  );
});

test('malformed engine fields are rejected, and every problem is reported at once', () => {
  const config = validConfig();
  config.engines[0] = { key: 'claude', label: '', enabled: 'yes', model: 42, secret: '' };
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: ok }),
    (err) => {
      assert.match(err.message, /missing or empty "label"/);
      assert.match(err.message, /"enabled" must be true or false/);
      assert.match(err.message, /"model" must be a non-empty string or null/);
      assert.match(err.message, /missing or empty "secret"/);
      return true;
    },
  );
});

test('model: null is preserved as an empty string so the adapter can omit the flag', () => {
  const config = validConfig();
  config.engines[0].model = null;
  const matrix = buildMatrix(config, workflowWith('claude'), { fileExists: ok });
  assert.equal(matrix.engine[0].model, '');
});

test('the engine-agnostic core carries no provider-specific identifiers', () => {
  // The port only holds if the shared steps are engine-blind. Provider names belong in the
  // adapter steps and the registry — anywhere else is the drift that makes "swap the engine"
  // untrue. Scoped to the steps after the adapters, which is where the core lives.
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const core = workflow.slice(workflow.indexOf('# ADAPTERS END'));
  assert.ok(core.length > 0, 'the ADAPTERS END marker delimits the engine-agnostic core');
  for (const token of ['claude', 'anthropic', 'openai', 'codex', 'gemini', 'cursor']) {
    assert.ok(
      !new RegExp(token, 'i').test(core),
      `the engine-agnostic core must not mention "${token}"`,
    );
  }
});
