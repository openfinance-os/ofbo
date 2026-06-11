#!/usr/bin/env bash
# PreToolUse tripwire (Write|Edit): the OpenAPI contract is ground truth and changes
# via its own spec-only PR (see .claude/skills/spec-change) — never mid-feature.
# Blocks edits to specs/backoffice-openapi.yaml while on feature/BACKOFFICE-* branches,
# except dedicated spec branches (feature/BACKOFFICE-NN-spec-<slug>).
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

case "$file_path" in
  */specs/backoffice-openapi.yaml | specs/backoffice-openapi.yaml) ;;
  *) exit 0 ;;
esac

branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null || true)

if [[ "$branch" == feature/BACKOFFICE-* && "$branch" != *-spec-* ]]; then
  jq -n --arg reason "Spec tripwire: specs/backoffice-openapi.yaml must not change on a feature branch ($branch). The contract changes via its own spec-only PR first — use the spec-change skill (branch feature/BACKOFFICE-NN-spec-<slug>)." \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
fi

exit 0
