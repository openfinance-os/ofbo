#!/usr/bin/env bash
# PreToolUse guard (Write|Edit): blocks content introducing PII-shaped literals.
# OFBO hard stop: no PII in fixtures, test names, logs, or telemetry — synthetic data only.
# Synthetic conventions enforced:
#   - Emirates IDs: real IDs start 784-… → blocked. Synthetic fixtures use the 999 prefix.
#   - UAE IBANs: blocked unless bank code is 000 (AEkk000…) — the synthetic marker.
set -euo pipefail

input=$(cat)
content=$(printf '%s' "$input" | jq -r '(.tool_input.content // "") + "\n" + (.tool_input.new_string // "")')

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

if printf '%s' "$content" | grep -Eq '784[- ]?[0-9]{4}[- ]?[0-9]{7}[- ]?[0-9]'; then
  deny "PII guard: Emirates-ID-shaped literal (784-…) detected. Real Emirates IDs are forbidden everywhere (CLAUDE.md hard stop). Synthetic fixtures must use the 999 prefix, e.g. 999-1990-1234567-1."
fi

ibans=$(printf '%s' "$content" | grep -Eo 'AE[0-9]{21}' || true)
if [ -n "$ibans" ]; then
  bad=$(printf '%s\n' "$ibans" | grep -Ev '^AE[0-9]{2}000' || true)
  if [ -n "$bad" ]; then
    deny "PII guard: real-shaped UAE IBAN detected ($(printf '%s' "$bad" | head -1)…). Synthetic IBANs must use bank code 000 (AEkk000…), per the no-PII hard stop."
  fi
fi

exit 0
