#!/usr/bin/env bash
# PreToolUse tripwire (Write|Edit|MultiEdit): the spec-first loop commits contract/
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
# Escape hatch: a dedicated test-fix branch (feature/BACKOFFICE-NN-testfix-<slug>) — the
# same pattern spec-tripwire uses for spec-only branches. A genuine test defect is fixed in
# the open, on its own branch, not silently mid-implementation.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$file_path" ] || exit 0

# Is this a test file? Vitest specs (.spec / .int.spec / .smoke.spec), anything under a
# /test/ or /tests/ directory, or a Playwright e2e spec.
case "$file_path" in
  *.spec.ts | *.spec.tsx | */test/* | */tests/* | *.e2e.ts | */e2e/*) ;;
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

# The new content this edit introduces (Write content, Edit new_string, or each MultiEdit).
new_content=$(printf '%s' "$input" | jq -r '
  (.tool_input.content // "") + "\n" +
  (.tool_input.new_string // "") + "\n" +
  ([.tool_input.edits[]?.new_string // empty] | join("\n"))')

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

# Test-disabling markers: skip/todo a case, or .only (which silently drops every OTHER
# test in the file — a way to hide a sibling failure), or vitest's .fails inversion, or the
# x-prefixed disablers. Word-boundary-ish matching to avoid catching identifiers like "skipped".
if printf '%s' "$new_content" | grep -Eq '\b(it|test|describe)\.(skip|only|todo)\b|\b(it|test)\.fails\b|\b(xit|xdescribe)\('; then
  deny "Test tripwire: this edit disables or narrows a test (it.skip/.only/.todo/.fails/xit) on branch '$branch'. The spec-first loop drives RED tests green by fixing the code, never by weakening the test. If the test itself is genuinely wrong, fix it in the open on a test-fix branch: feature/BACKOFFICE-NN-testfix-<slug>."
fi

# Commented-out expectations — the quiet way to defang an assertion.
if printf '%s' "$new_content" | grep -Eq '^\s*//\s*(expect|assert)\b'; then
  deny "Test tripwire: this edit comments out an assertion (expect/assert) on branch '$branch'. Make the code satisfy the assertion; don't silence it. Genuine test defects belong on a test-fix branch (feature/BACKOFFICE-NN-testfix-<slug>)."
fi

exit 0
