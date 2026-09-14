// The guardrail hooks' own suite (2.1.0, plan row 1.4). Until now the three hooks had nine cases
// inside guardrail-policy-check.test.mjs and no suite of their own; the evasions found in review
// (a write through the Bash tool, an underscore-separated ID, a colocated *.test.ts, `it["skip"]`,
// a block-commented expect, a tautology, the contract's .yml spelling, a claude/* branch) each get
// a case here so they cannot come back. Node built-in runner: `node --test`.
//
// Every hook is run as a process with a PreToolUse payload on stdin, exactly as Claude Code runs
// it, and judged on the deny DECISION in its stdout — never on its exit code, which is 0 always.
// Resolved across the BUNDLE (hooks/) and ADOPTED (.claude/hooks/) layouts; skipped cleanly when
// neither is present (a bare adoption at a tier without hooks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = ['.claude/hooks', 'hooks'].map((d) => join(HARNESS, d)).find((d) => existsSync(join(d, 'pii-guard.sh')));
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
const SKIP = !HOOKS_DIR ? 'hooks not installed at this tier' : (!HAVE_JQ ? 'jq not available' : false);

/** A git checkout on `branch`, so the tripwires see the branch they scope to. */
function repoOn(branch) {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  return dir;
}
const run = (script, toolInput, repo) => {
  const out = spawnSync('bash', [join(HOOKS_DIR, script)], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo || tmpdir() },
  });
  assert.equal(out.status, 0, `${script} must always exit 0 (a non-zero exit is a silent disarm): ${out.stderr}`);
  return out.stdout || '';
};
const denied = (out) => /"permissionDecision":\s*"deny"/.test(out);
const reasonOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.permissionDecisionReason; } catch { return ''; } };
const REAL_EID = ['784', '1990', '1234567', '1'].join('-');
const REAL_IBAN_DOTTED = ['ae07', '0331', '2345', '6789', '0123', '456'].join('.');

// ── pii-guard ────────────────────────────────────────────────────────────────────────────────

test('pii-guard: a write through the Bash tool is scanned (heredoc carrying an Emirates ID)', { skip: SKIP }, () => {
  const out = run('pii-guard.sh', { command: `cat > fixtures/customer.json <<'EOF'\n{ "eid": "${REAL_EID}" }\nEOF` });
  assert.ok(denied(out), 'a heredoc used to be a complete bypass of every file-tool hook');
  assert.match(reasonOf(out), /Emirates-ID-shaped/);
});

test('pii-guard: separators other than space/dot/hyphen no longer evade (underscore, slash, concatenation)', { skip: SKIP }, () => {
  for (const content of ['784_1990_1234567_1', '784/1990/1234567/1', 'const id = "784" + "199012345671";', 'id:784|1990|1234567|1']) {
    assert.ok(denied(run('pii-guard.sh', { content })), `not denied: ${content}`);
  }
});

test('pii-guard: a UAE mobile in international form is denied; the 000 synthetic block is allowed', { skip: SKIP }, () => {
  assert.ok(denied(run('pii-guard.sh', { content: 'call +971 50 123 4567 tomorrow' })));
  assert.ok(denied(run('pii-guard.sh', { new_string: 'mobile: 00971501234567' })));
  assert.ok(!denied(run('pii-guard.sh', { content: 'fixture mobile +971 50 000 1234' })), 'the synthetic block must pass');
  assert.match(reasonOf(run('pii-guard.sh', { content: '+971 55 987 6543' })), /UAE-mobile-shaped/);
});

test('pii-guard: an ordinary shell command and synthetic fixtures are allowed', { skip: SKIP }, () => {
  assert.ok(!denied(run('pii-guard.sh', { command: 'node --test scripts/*.test.mjs && git status' })));
  assert.ok(!denied(run('pii-guard.sh', { command: "printf '%s\\n' '999-1990-1234567-1' > fixtures/synthetic.txt" })));
  assert.ok(!denied(run('pii-guard.sh', { content: 'IBAN AE07 0000 0000 1234 5678 901' })), 'bank code 000 is the synthetic IBAN convention');
});

test('pii-guard: a lowercase, dotted IBAN is still caught after normalisation', { skip: SKIP }, () => {
  assert.ok(denied(run('pii-guard.sh', { content: REAL_IBAN_DOTTED })));
});

// ── spec-tripwire ────────────────────────────────────────────────────────────────────────────

test('spec-tripwire: a shell command that rewrites the contract on a feature branch is denied', { skip: SKIP }, () => {
  const repo = repoOn('feature/BACKOFFICE-7-add-field');
  try {
    for (const command of [
      "sed -i 's/v1/v2/' specs/backoffice-openapi.yaml",
      'cat > specs/backoffice-openapi.yaml <<EOF\nopenapi: 3.1.0\nEOF',
      'git mv specs/backoffice-openapi.yaml specs/backoffice-openapi-old.yaml',
      "node -e \"require('fs').writeFileSync('specs/backoffice-openapi.yaml','')\"",
      'echo "" >> specs/backoffice-openapi.yaml',
    ]) {
      const out = run('spec-tripwire.sh', { command }, repo);
      assert.ok(denied(out), `not denied: ${command}`);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('spec-tripwire: reading the contract from the shell is allowed', { skip: SKIP }, () => {
  const repo = repoOn('feature/BACKOFFICE-7-add-field');
  try {
    for (const command of ['cat specs/backoffice-openapi.yaml', 'git diff origin/main -- specs/backoffice-openapi.yaml', 'grep -n consent specs/backoffice-openapi.yaml']) {
      assert.ok(!denied(run('spec-tripwire.sh', { command }, repo)), `wrongly denied: ${command}`);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('spec-tripwire: claude/* branches are covered for relative and absolute OFBO contract paths', { skip: SKIP }, () => {
  const repo = repoOn('claude/wizardly-brahmagupta');
  try {
    for (const file_path of ['specs/backoffice-openapi.yaml', '/abs/repo/specs/backoffice-openapi.yaml']) {
      assert.ok(denied(run('spec-tripwire.sh', { file_path, content: 'x' }, repo)), `not denied: ${file_path}`);
    }
    assert.ok(!denied(run('spec-tripwire.sh', { file_path: 'src/app.ts', content: 'x' }, repo)));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('spec-tripwire: a dedicated spec branch and main are the sanctioned lanes', { skip: SKIP }, () => {
  for (const branch of ['feature/BACKOFFICE-7-spec-add-field', 'main']) {
    const repo = repoOn(branch);
    try {
      assert.ok(!denied(run('spec-tripwire.sh', { file_path: 'specs/backoffice-openapi.yaml', content: 'x' }, repo)), `wrongly denied on ${branch}`);
      assert.ok(!denied(run('spec-tripwire.sh', { command: "sed -i 's/a/b/' specs/backoffice-openapi.yaml" }, repo)), `wrongly denied on ${branch}`);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }
});

// ── test-tripwire ────────────────────────────────────────────────────────────────────────────

test('test-tripwire: colocated *.test.* files and the other conventions are in scope', { skip: SKIP }, () => {
  const repo = repoOn('feature/STORY-9-x');
  try {
    for (const file_path of ['src/foo.test.ts', 'src/foo.test.js', 'lib/__tests__/foo.js', 'tests/test_api.py', 'pkg/handler_test.go', 'src/test/java/FooTest.java']) {
      const out = run('test-tripwire.sh', { file_path, new_string: `it.${'skip'}("x", () => {})\n@pytest.mark.skip\nt.Skip()\n@Disabled` }, repo);
      assert.ok(denied(out), `not denied on ${file_path}`);
    }
    // a source file is not a test file — the tripwire never fires on it
    assert.ok(!denied(run('test-tripwire.sh', { file_path: 'src/foo.ts', new_string: `it.${'skip'}("x")` }, repo)));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('test-tripwire: evasions of the plain dot-skip regex are caught', { skip: SKIP }, () => {
  const repo = repoOn('claude/loop-run-3');
  try {
    const cases = {
      'bracket access': 'it["skip"]("x", () => {})',
      'spaces around the dot': 'test . only ("x", () => {})',
      'xtest / fit': 'xtest("x", () => {})\nfit("y", () => {})',
      'options object': "test('x', { skip: true }, () => {})",
      'block-commented expect': '/* temporarily\n   expect(total).toBe(3);\n*/',
      'hash-commented assert': '# assert result == 3',
      'tautology': 'expect(true).toBe(true);',
      'tautology assert.ok': 'assert.ok(true);',
      'python skip': '@pytest.mark.skip(reason="flaky")',
      'go skip': 't.Skip("later")',
    };
    for (const [name, new_string] of Object.entries(cases)) {
      assert.ok(denied(run('test-tripwire.sh', { file_path: 'tests/x.test.ts', new_string }, repo)), `not denied: ${name}`);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('test-tripwire: legitimate test authorship is allowed, and the testfix branch is the escape hatch', { skip: SKIP }, () => {
  const repo = repoOn('feature/STORY-9-x');
  try {
    const authored = "test('revoke propagates', () => {\n  const r = revoke(c);\n  expect(r.ack).toBeLessThan(5000);\n  // skipped items are reported, not hidden\n  assert.equal(skippedCount, 0);\n});";
    assert.ok(!denied(run('test-tripwire.sh', { file_path: 'src/consent.test.ts', new_string: authored }, repo)), 'adding a real case must never be blocked');
  } finally { rmSync(repo, { recursive: true, force: true }); }
  const fix = repoOn('feature/STORY-9-testfix-flaky-clock');
  try {
    assert.ok(!denied(run('test-tripwire.sh', { file_path: 'src/consent.test.ts', new_string: `it.${'skip'}("flaky until clock is injected")` }, fix)));
  } finally { rmSync(fix, { recursive: true, force: true }); }
});

test('every hook denies rather than disarms when jq is missing', { skip: !HOOKS_DIR && 'hooks not installed at this tier' }, () => {
  // the child's PATH is scrubbed so `command -v jq` fails inside the hook; bash itself is therefore
  // resolved here, absolutely, before the scrub
  const bash = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  for (const script of ['pii-guard.sh', 'spec-tripwire.sh', 'test-tripwire.sh']) {
    const out = spawnSync(bash, [join(HOOKS_DIR, script)], {
      input: JSON.stringify({ tool_input: { command: 'echo hi' } }), encoding: 'utf8',
      env: { PATH: '/nonexistent', CLAUDE_PROJECT_DIR: tmpdir() },
    });
    assert.equal(out.status, 0, `${script} exit`);
    assert.ok(denied(out.stdout || ''), `${script} must fail closed without jq`);
  }
});
