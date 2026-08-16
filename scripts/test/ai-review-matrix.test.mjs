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
    active: 'claude',
    reviewers: [{ key: 'hard-stop', label: 'hard-stop', agent: '.claude/agents/hs.md' }],
    engines: [
      {
        key: 'claude',
        label: 'Claude',
        model: 'claude-opus-5',
        secret: 'TOK',
        attribution: '_by someone_',
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

test('every engine in the registry — active or not — has an adapter step', () => {
  // Stricter than buildMatrix, which only requires it for the ACTIVE engine. An engine
  // registered without an adapter is a trap: swapping `active` to it later looks like a
  // one-string change and silently would not be one. This keeps every swap safe.
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const e of config.engines) {
    assert.ok(
      workflow.includes(adapterGuard(e.key)),
      `engine "${e.key}" has an adapter step guarded by \`${adapterGuard(e.key)}\``,
    );
  }
});

test('the ACTIVE engine having no adapter step is rejected', () => {
  const config = validConfig();
  assert.throws(
    () => buildMatrix(config, workflowWith('some-other-engine'), { fileExists: ok }),
    /has no adapter step/s,
  );
});

test('a registered but NON-ACTIVE engine is simply not used', () => {
  const config = validConfig();
  config.engines.push({
    key: 'codex',
    label: 'Codex',
    model: null,
    secret: 'X',
    attribution: '_by nobody_',
  });
  const matrix = buildMatrix(config, workflowWith('claude', 'codex'), { fileExists: ok });
  assert.deepEqual(matrix.engine.map((e) => e.key), ['claude']);
});

test('swapping the reviewing model is the single `active` string', () => {
  const config = validConfig();
  config.engines.push({
    key: 'codex',
    label: 'Codex',
    model: null,
    secret: 'CODEX_API_KEY',
    attribution: '_by codex_',
  });
  const wf = workflowWith('claude', 'codex');

  assert.equal(buildMatrix(config, wf, { fileExists: ok }).engine[0].key, 'claude');
  config.active = 'codex';
  const swapped = buildMatrix(config, wf, { fileExists: ok });
  assert.equal(swapped.engine[0].key, 'codex');
  assert.equal(swapped.engine[0].secret, 'CODEX_API_KEY', 'the secret swaps with the engine');
  assert.equal(swapped.engine[0].model, '', 'null model becomes empty — adapter omits the flag');
});

test('EXACTLY ONE engine is in the matrix, whatever the registry holds — the cost ceiling', () => {
  // Structural, not conventional: `active` is one key, so no combination of registry entries
  // can produce a second review leg and quietly double the spend.
  const config = validConfig();
  for (const key of ['codex', 'gemini', 'another']) {
    config.engines.push({
      key,
      label: key,
      model: null,
      secret: 'S',
      attribution: '_x_',
    });
  }
  const matrix = buildMatrix(config, workflowWith('claude', 'codex', 'gemini', 'another'), {
    fileExists: ok,
  });
  assert.equal(matrix.engine.length, 1, 'four engines registered, one reviews');
});

test('an `active` naming an unregistered engine is rejected', () => {
  const config = validConfig();
  config.active = 'nonexistent';
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: ok }),
    /not a registered engine/,
  );
});

test('a missing `active` is rejected — nothing would review', () => {
  const config = validConfig();
  delete config.active;
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: ok }),
    /"active" must name the engine/,
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
  config.engines[0] = {
    key: 'claude',
    label: '',
    model: 42,
    secret: '',
    attribution: '',
  };
  assert.throws(
    () => buildMatrix(config, workflowWith('claude'), { fileExists: ok }),
    (err) => {
      assert.match(err.message, /missing or empty "label"/);
      assert.match(err.message, /missing or empty "secret"/);
      assert.match(err.message, /missing or empty "attribution"/);
      assert.match(err.message, /"model" must be a non-empty string or null/);
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

test('workflow parity is enforced for EVERY engine, not per-engine', () => {
  // Regression guard for a real defect. Parity used to be a per-engine flag, true only for
  // claude because claude-code-action enforces an equivalent rule itself. That made swapping
  // `active` silently swap a security control in or out: the CLI engines authenticate with a
  // plain repository secret and have no such rule of their own, so codex ran happily on a PR
  // that rewrote this very workflow. Preflight must gate on the diff alone.
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  // '# ADAPTERS START\n' anchored to the newline on purpose: the header prose says
  // "ADAPTERS START/END markers", so a bare '# ADAPTERS START' matches that comment first
  // and silently yields an empty slice.
  const preflight = workflow.slice(
    workflow.indexOf('- name: Preflight'),
    workflow.indexOf('# ADAPTERS START\n'),
  );
  assert.ok(preflight.length > 0, 'the preflight step was found');
  assert.ok(
    !/requires_workflow_parity|NEEDS_PARITY/.test(workflow),
    'no per-engine parity flag survives anywhere in the workflow',
  );
  // The whole control plane, not just the workflow: each of these can decide what the
  // reviewer executes or which secret it is handed.
  for (const path of [
    '.github/workflows/ai-review.yml',
    '.github/ai-review.config.json',
    'scripts/ai-review-matrix.mjs',
  ]) {
    assert.ok(preflight.includes(path), `preflight guards ${path} for parity`);
  }
});

test('the registry carries no per-engine parity flag', () => {
  // The matrix must not re-introduce it as a matrix value either.
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  for (const e of config.engines) {
    assert.ok(
      !('requires_workflow_parity' in e),
      `engine "${e.key}" carries no parity flag — parity is a harness rule, not an engine property`,
    );
  }
  const matrix = buildMatrix(config, readFileSync(WORKFLOW_PATH, 'utf8'), { fileExists: existsSync });
  assert.ok(!('requires_workflow_parity' in matrix.engine[0]), 'nor does the built matrix');
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
