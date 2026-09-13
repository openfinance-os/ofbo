#!/usr/bin/env bash
# PreToolUse guard (Write|Edit|MultiEdit|NotebookEdit, and Bash): blocks content introducing PII-shaped literals.
#
# 2.1.0 — bound to the Bash tool as well (settings.hooks.json, matcher "Bash"): the command string is
# scanned like written content, so a heredoc, `sed -i`, `printf > file` or `python -c` carrying a real
# ID is denied at the same point a Write would be. Before this the file-tool matcher was a complete
# bypass — write it through the shell and no hook ran.
# Loom hard stop: no real PII in fixtures, test names, logs, or telemetry — synthetic data only.
#
# The shapes are DATA, not code: they live in pii-patterns.json beside this script (F3). They used to
# be hardcoded here, which meant every new jurisdiction was a hand-edit of a security-critical shell
# script — and a review of shell quoting rather than of the shape being added. See that file's
# _adopt_comment to add your jurisdiction's shapes.
#
# Everything security-load-bearing stayed here:
#   - jq absent            → DENY (a guard that cannot parse its input must not run blind)
#   - patterns unloadable  → DENY (a guard that does not know what it is looking for is not a guard)
#   - separator-insensitive normalisation, so grouping cannot evade a shape
#   - `exit 0` ALWAYS: a non-zero exit is a NON-BLOCKING error in Claude Code, i.e. a silent disarm.
#     Every refusal in this file is a deny DECISION on stdout, never a failed process.
set -euo pipefail

# The pattern file is resolved beside this script — deliberately NOT from an environment variable.
# An env-overridable pattern path is a disarm switch: point it at an empty file and the guard passes
# everything while still reporting that it ran. It resolves in both layouts (hooks/ in the bundle,
# .claude/hooks/ in an adopted repo) because it travels with the script.
# Resolved with parameter expansion, not `dirname`: this line runs BEFORE the jq check, and a hook
# whose own path resolution depends on an external binary can lose that binary too.
case "${BASH_SOURCE[0]}" in */*) HOOK_DIR="${BASH_SOURCE[0]%/*}" ;; *) HOOK_DIR="." ;; esac
PATTERNS="$HOOK_DIR/pii-patterns.json"

# Fail CLOSED if jq is absent: a compliance guard that cannot parse its input must deny, not
# silently exit non-zero (which Claude Code treats as a NON-blocking error — a silent disarm).
# The deny JSON is emitted without jq precisely because jq is what is missing.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PII guard cannot run: jq is not installed, so this write cannot be scanned for PII-shaped literals. Failing closed — install jq to enable the guard."}}'
  exit 0
fi

input=$(cat)

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

# Fail CLOSED if the pattern file is missing, unparseable, or empty — same rationale as the jq check.
# Deleting or corrupting this file is the cheapest possible attack on the guard, and the failure it
# would otherwise produce is the worst kind: a run that looks clean because nothing was checked.
rows=$(jq -c '.patterns[]' "$PATTERNS" 2>/dev/null) || rows=""
if [ -z "$rows" ]; then
  deny "PII guard cannot run: its pattern file ($PATTERNS) is missing, unparseable, or declares no patterns, so this write cannot be scanned for PII-shaped literals. Failing closed — restore hooks/pii-patterns.json."
fi

content=$(printf '%s' "$input" | jq -r '
  (.tool_input.content // "") + "\n" +
  (.tool_input.new_string // "") + "\n" +
  (.tool_input.new_source // "") + "\n" +
  (.tool_input.command // "") + "\n" +
  ([.tool_input.edits[]?.new_string // empty] | join("\n"))')
# Separator-insensitive copy: EVERY non-alphanumeric character is stripped (2.1.0 — the old
# space/tab/dot/hyphen list let 784_1990_1234567_1, 784/1990/…, and "784" + "199012345671" through),
# then upcased so a lowercase ae07… cannot dodge the uppercase IBAN pattern. Newlines are KEPT so
# grep still works line by line and digits on one line do not run into digits on the next. Patterns
# are written against THIS form — see pii-patterns.json's _matching_comment.
normalized=$(printf '%s' "$content" | tr -cd '[:alnum:]\n' | tr '[:lower:]' '[:upper:]')

# The loop reads from a here-doc, NOT a pipe: a piped `while` runs in a subshell, where deny()'s
# `exit 0` would end the subshell and let the write through. That is a real disarm, one character wide.
while IFS= read -r row; do
  [ -n "$row" ] || continue
  id=$(printf '%s' "$row" | jq -r '.id // ""')
  match=$(printf '%s' "$row" | jq -r '.match // ""')
  allow=$(printf '%s' "$row" | jq -r '.allow // ""')
  reason=$(printf '%s' "$row" | jq -r '.reason // ""')
  # A malformed row is not skipped. Skipping it would silently drop a shape somebody believed was
  # being enforced, which is indistinguishable from never having added it.
  if [ -z "$match" ] || [ -z "$reason" ]; then
    deny "PII guard cannot run: pattern row ${id:-<unnamed>} in $PATTERNS is malformed (it needs a non-empty \`match\` and \`reason\`). Failing closed rather than skipping a shape somebody believes is enforced."
  fi

  hits=$(printf '%s' "$normalized" | grep -Eo "$match" || true)
  [ -n "$hits" ] || continue
  if [ -n "$allow" ]; then
    # `allow` is the synthetic-fixture exception: keep only the hits that are NOT allowed.
    hits=$(printf '%s\n' "$hits" | grep -Ev "$allow" || true)
    [ -n "$hits" ] || continue
  fi
  deny "${reason//\{match\}/$(printf '%s\n' "$hits" | head -1)}"
done <<EOF
$rows
EOF

exit 0
