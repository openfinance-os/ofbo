#!/usr/bin/env bash
# PreToolUse tripwire (Write|Edit|MultiEdit|NotebookEdit): the spec-first loop commits contract/
# acceptance tests RED before implementing, then drives the code to green. The one
# move that turns a real red bar green without fixing the code is *weakening the test* —
# skipping it, narrowing an assertion, or commenting out an expectation. Frontier coding
# agents are documented to do exactly this under pressure to reach green (Anthropic
# reward-hacking research; independent agent-benchmark cheating audits, 2025).
#
# This hook blocks the blatant test-disabling edits locally on feature branches. It is
# deliberately narrow (skip/only/.fails/xit + commented-out expectations) to never get in
# the way of legitimate test *authorship* — adding cases is always allowed. The heavier,
# merge-blocking control of record is scripts/test-integrity.mjs (CI gate Q1b), which diffs
# against the merge base and counts net assertions. Defense in depth: hook here, gate there.
#
# Escape hatch: a dedicated test-fix branch (feature/<ID>-testfix-<slug>) — the
# same pattern spec-tripwire uses for spec-only branches. A genuine test defect is fixed in
# the open, on its own branch, not silently mid-implementation.
set -euo pipefail

# Fail CLOSED if jq is absent: without it the hook cannot tell whether this edit weakens a test,
# so it must deny rather than silently exit non-zero (a non-blocking error = silent disarm).
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Test tripwire cannot run: jq is not installed, so it cannot verify whether this edit disables or narrows a test. Failing closed — install jq."}}'
  exit 0
fi

input=$(cat)
# NotebookEdit carries notebook_path, not file_path — read both so a matched-path notebook cell is scanned.
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
[ -n "$file_path" ] || exit 0

# Is this a test file? Vitest/Jest specs and colocated *.test.* files (2.1.0 — `src/foo.test.ts`,
# the Jest/Vitest DEFAULT, was outside the old list), anything under a /test/ or /tests/ or
# /__tests__/ directory, Playwright e2e, and the Python / Go / Java / Kotlin conventions.
case "$file_path" in
  *.spec.ts | *.spec.tsx | *.spec.js | *.spec.jsx | *.spec.mjs | *.spec.cjs \
  | *.test.ts | *.test.tsx | *.test.js | *.test.jsx | *.test.mjs | *.test.cjs \
  | */test/* | */tests/* | */__tests__/* | *.e2e.ts | */e2e/* \
  | test_*.py | */test_*.py | *_test.py | *_test.go | *Test.java | *Tests.java | *Test.kt | *Spec.kt | *.feature) ;;
  *) exit 0 ;;
esac

branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null || true)

# Only enforce inside the autonomous loop's working branches. A test-fix branch (or a
# spec branch, which also legitimately reshapes tests) is the sanctioned escape hatch.
case "$branch" in
  feature/* | claude/*) ;;
  *) exit 0 ;;
esac
case "$branch" in
  *-testfix-* | *-spec-*) exit 0 ;;
esac

# The new content this edit introduces (Write content, Edit new_string, MultiEdit edits, or a
# NotebookEdit new_source — pii-guard already reads new_source; align so notebooks are covered too).
new_content=$(printf '%s' "$input" | jq -r '
  (.tool_input.content // "") + "\n" +
  (.tool_input.new_string // "") + "\n" +
  (.tool_input.new_source // "") + "\n" +
  ([.tool_input.edits[]?.new_string // empty] | join("\n"))')

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

# Test-disabling markers: skip/todo a case, or .only (which silently drops every OTHER
# test in the file — a way to hide a sibling failure), or vitest's .fails inversion, or the
# x-/f-prefixed disablers. 2.1.0 adds the spellings the old line missed: bracket access
# (`it["skip"]`), spaces around the dot, `xtest(`/`fit(`, the node:test / vitest options object
# (`{ skip: true }`), and the Python / Go / JVM decorators. Word-boundary-ish matching to avoid
# catching identifiers like "skipped".
if printf '%s' "$new_content" | grep -Eq '\b(it|test|describe|context|suite)\s*\.\s*(skip|only|todo|fails|failing)\b|\b(it|test|describe|context)\s*\[\s*["'"'"'](skip|only|todo)["'"'"']\s*\]|\b(xit|xdescribe|xtest|xcontext|fit|fdescribe|ftest)\s*\(|\{\s*(skip|todo|only)\s*:\s*(true|["'"'"'])|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bpytest\.skip\s*\(|\bt\.(Skip|SkipNow)\s*\(|@Disabled\b|@Ignore\b'; then
  deny "Test tripwire: this edit disables or narrows a test (skip/only/todo/fails, x-/f-prefixed, an options object, or a skip decorator) on branch '$branch'. The spec-first loop drives RED tests green by fixing the code, never by weakening the test. If the test itself is genuinely wrong, fix it in the open on a test-fix branch: feature/<ID>-testfix-<slug>."
fi

# Commented-out expectations — the quiet way to defang an assertion. Line comments in the
# JS/Python/SQL/Lua spellings, and (2.1.0) a block comment wrapping an expectation, matched
# across lines with grep -z so `/* … expect(...) … */` is one record.
if printf '%s' "$new_content" | grep -Eq '^\s*(//|#|--)\s*(expect|assert|should|t\.(is|deepEqual|truthy|falsy|throws))\b'; then
  deny "Test tripwire: this edit comments out an assertion (expect/assert) on branch '$branch'. Make the code satisfy the assertion; don't silence it. Genuine test defects belong on a test-fix branch (feature/<ID>-testfix-<slug>)."
fi
if printf '%s' "$new_content" | grep -Ezq '/\*([^*]|[[:space:]]|\*+[^*/])*(expect|assert)[[:space:]]*\('; then
  deny "Test tripwire: this edit wraps an assertion (expect/assert) in a block comment on branch '$branch'. A commented assertion is a silenced one. Genuine test defects belong on a test-fix branch (feature/<ID>-testfix-<slug>)."
fi

# Tautologies (2.1.0): an assertion that cannot fail keeps the count that Q1b compares while
# proving nothing. `expect(true).toBe(true)`, `assert(true)`, `assert.ok(true)`, `assert True`.
if printf '%s' "$new_content" | grep -Eq '\bexpect\s*\(\s*(true|1|!0)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual|toBeTruthy)\s*\(\s*(true|1)?\s*\)|\bassert(\.ok|\.equal|\.strictEqual)?\s*\(\s*(true|1)\s*(,\s*(true|1)\s*)?\)|^\s*assert\s+True\b'; then
  deny "Test tripwire: this edit adds a tautological assertion (it asserts true is true) on branch '$branch'. It keeps the assertion count while proving nothing. Assert the behaviour, or fix the test in the open on a test-fix branch (feature/<ID>-testfix-<slug>)."
fi

exit 0
