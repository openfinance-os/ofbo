#!/usr/bin/env bash
# PreToolUse guard (Write|Edit|MultiEdit|NotebookEdit): a TERMINOLOGY tripwire for declared Islamic
# customer-facing prose surfaces. It blocks a write that puts interest/APR wording into copy a
# customer reads on a surface the institution has declared Islamic — where the return is a PROFIT or
# a RENTAL and never interest.
#
# WHAT IT RULES ON: NOTHING. This hook makes NO Shari'ah determination and must never appear to.
# It does not decide whether a product is permissible, whether a structure is genuine, or whether a
# document is acceptable. SCHOLARS DECIDE SHARI'AH — the Shari'ah committee (ISSC) rules, the
# Shari'ah Compliance Function monitors, internal Shari'ah audit tests. This is a spellcheck with a
# deny button: it catches the conventional word that arrived by copy-paste from the conventional
# product's copy, which is how the defect actually happens. Passing it means nothing was said in the
# wrong vocabulary on a declared surface. It does not mean the copy is right, and it never means
# "Shari'ah-compliant" — the honest phrase for what any gate here can show is STRUCTURE-CONFORMANT.
#
# DORMANT BY DEFAULT. Scope comes entirely from .claude/hooks/shariah-surfaces.txt, which ships EMPTY.
# No declared surface ⇒ every write is allowed and this hook is invisible. A conventional adopter is
# never blocked by an Islamic control.
#
# THREE LAYERS, in order, and each one exists against a specific false positive that would otherwise
# get this hook switched off within a week:
#   1. PATH SCOPE   — only paths under a declared prefix are read at all.
#   2. IDENTIFIER STRIP — fenced blocks, backticked spans, URLs and PascalCase/camelCase/snake_case
#      tokens are removed first. A mapping layer MUST be able to name `InterestRate` as a field of
#      the standard it is mapping AWAY from; a gate that blocked that would be blocking the fix.
#   3. PROSE MATCH  — only then, and only on what is left, which is somebody addressing a customer.
#
# LANGUAGE SCOPE — READ THIS BEFORE EXTENDING. The terms below are ENGLISH ONLY, deliberately. The
# Arabic and transliterated forms that would matter on a UAE surface are not guesswork an engineer
# gets to do: a wrong term here either blocks legitimate copy or, far worse, implies the surface is
# screened in a language it is not. A vetted non-English term list is COMPLIANCE-OWNED ADOPTER
# CONTENT — obtained from the Shari'ah Compliance Function, reviewed like any other control content,
# and added by the adopter. Until then this hook covers English and says so.
#
# The merge-time reader of the same ground is scripts/shariah-emission-check.mjs (SE-R07), which sees
# the whole tree rather than one write. This hook is the fast path, not the enforcement of record.
#
# `exit 0` ALWAYS: a non-zero exit is a NON-BLOCKING error in Claude Code, i.e. a silent disarm.
# Every refusal here is a deny DECISION on stdout, never a failed process.
set -euo pipefail

# Resolved with parameter expansion, not `dirname`: this line runs BEFORE the jq check, and a hook
# whose own path resolution depends on an external binary can lose that binary too.
case "${BASH_SOURCE[0]}" in */*) HOOK_DIR="${BASH_SOURCE[0]%/*}" ;; *) HOOK_DIR="." ;; esac
SURFACES="$HOOK_DIR/shariah-surfaces.txt"

# ── DORMANCY IS DECIDED FIRST, AND WITHOUT jq ───────────────────────────────────────────────────
# ORDER IS LOAD-BEARING HERE, and getting it wrong was a real defect: the jq fail-closed deny used
# to run BEFORE this check, so on a machine without jq an Islamic control that the adopter had never
# opted into denied EVERY write in the repository. Dormancy that depends on an external binary being
# installed is not dormancy. So the opt-in question — "has this institution declared any Islamic
# surface at all?" — is answered with shell builtins only, and a repository that has declared none
# leaves this hook before it can fail at anything.
#
# An ABSENT or EMPTY surfaces file is therefore NOT a fail-closed case, and the difference from
# pii-guard.sh is deliberate. pii-patterns.json IS that guard's substance — without it, it does not
# know what it is looking for, and the safe answer is to refuse. This file is a SCOPE list: no
# entries means no declared Islamic surfaces, which is the true and common state, and denying every
# write over a missing opt-in file would make an Islamic control mandatory for adopters who have no
# Islamic product.
[ -f "$SURFACES" ] || exit 0
declared=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  trimmed="${line%"${line##*[![:space:]]}"}"
  trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
  [ -n "$trimmed" ] || continue
  declared="yes"; break
done < "$SURFACES"
[ -n "$declared" ] || exit 0

# Only now — with at least one surface declared, i.e. the institution HAS opted in — does the guard
# have something to protect, and only now is failing closed the honest answer. Without jq it cannot
# tell WHICH file is being written, so it cannot know whether the write is in scope; denying is the
# only truthful response. Exiting non-zero would be a non-blocking error, i.e. a silent disarm.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Shariah term guard cannot run: this repository declares Islamic surfaces in .claude/hooks/shariah-surfaces.txt, but jq is not installed, so the guard cannot read which file this write targets or scan it. Failing closed — install jq, or empty the surfaces list if the declaration was made in error."}}'
  exit 0
fi

deny() {
  jq -n --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
[ -n "$file_path" ] || exit 0

# Make the path repository-relative so a declared prefix matches whichever form the tool passed.
rel="$file_path"
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then rel="${rel#"$CLAUDE_PROJECT_DIR"/}"; fi
rel="${rel#./}"

# ── Layer 1: PATH SCOPE ─────────────────────────────────────────────────────────────────────────
# Literal prefix test, not a glob: a surface list is a list of places, and glob semantics in a scope
# list is how a stray `*` silently widens a control nobody re-read.
in_scope=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  prefix="${line%"${line##*[![:space:]]}"}"   # trim trailing whitespace
  prefix="${prefix#"${prefix%%[![:space:]]*}"}"
  [ -n "$prefix" ] || continue
  if [ "${rel#"$prefix"}" != "$rel" ]; then in_scope="$prefix"; break; fi
done < "$SURFACES"
[ -n "$in_scope" ] || exit 0

content=$(printf '%s' "$input" | jq -r '
  (.tool_input.content // "") + "\n" +
  (.tool_input.new_string // "") + "\n" +
  (.tool_input.new_source // "") + "\n" +
  ([.tool_input.edits[]?.new_string // empty] | join("\n"))')

# ── Layer 2: IDENTIFIER STRIP ───────────────────────────────────────────────────────────────────
# Remove everything that is not somebody addressing a customer, in this order: fenced code blocks,
# backticked spans, URLs, camelCase/PascalCase tokens, snake_case tokens. Note what is NOT stripped:
# bare ALL-CAPS words, because APR is one of the terms this hook exists to catch.
stripped=$(printf '%s\n' "$content" \
  | awk '/^[[:space:]]*(```|~~~)/ { fenced = !fenced; next } { print (fenced ? "" : $0) }' \
  | sed -E 's/`[^`]*`/ /g' \
  | sed -E 's#https?://[^[:space:]]+# #g' \
  | sed -E 's/([A-Z]?[a-z][a-z0-9]*)([A-Z][A-Za-z0-9]*)+/ /g' \
  | sed -E 's/[A-Za-z0-9]+(_[A-Za-z0-9]+)+/ /g')

# Idiomatic English uses of "interest" that are not the financial one. Stripped BEFORE matching so a
# conflict-of-interest disclosure on an Islamic surface is not read as a riba disclosure.
ALLOW='in the interest of|in the best interests?|best interests of|interests of the customer|conflicts? of interest|vested interest|interest group'
stripped=$(printf '%s\n' "$stripped" | sed -E "s/($ALLOW)/ /Ig")

# ── Layer 3: PROSE MATCH ────────────────────────────────────────────────────────────────────────
# Longest form first so the deny names the most specific wording found. Word edges are written out
# rather than using \b, which is a GNU extension.
EDGE_L='(^|[^[:alnum:]_-])'
EDGE_R='($|[^[:alnum:]_-])'
TERMS_ANYCASE='annual percentage rate|compound interest|accrued interest|interest-bearing|interest bearing|interest rate|interest'
# ALL-CAPS terms match case-SENSITIVELY: "Apr 2026" is a month, not an annual percentage rate.
TERMS_CAPS='APR|APY'

hit=$(printf '%s\n' "$stripped" | grep -Eio "$EDGE_L($TERMS_ANYCASE)$EDGE_R" | head -1 || true)
if [ -z "$hit" ]; then
  hit=$(printf '%s\n' "$stripped" | grep -Eo "$EDGE_L($TERMS_CAPS)$EDGE_R" | head -1 || true)
fi

if [ -n "$hit" ]; then
  term=$(printf '%s' "$hit" | sed -E 's/^[^[:alnum:]]+//; s/[^[:alnum:]]+$//')
  deny "Shariah term guard [SHARIAH-TERM]: this write puts \"$term\" into customer-facing prose on a declared Islamic surface ($rel, matched by the prefix \"$in_scope\" in .claude/hooks/shariah-surfaces.txt). On these surfaces the return is a PROFIT or a RENTAL, never interest. If you are citing a field name of a standard, backtick it or use its identifier form — both are stripped before matching. To take this path out of scope, edit .claude/hooks/shariah-surfaces.txt; do not reword the control. This hook rules on no Shari'ah question — it checks vocabulary on a surface the institution declared. The merge-time reader is scripts/shariah-emission-check.mjs (SE-R07)."
fi

exit 0
