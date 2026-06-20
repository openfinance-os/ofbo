#!/usr/bin/env bash
# SessionStart hook: surface the worktree-isolation policy.
# This repo runs concurrent autonomous build loops against ONE shared checkout.
# A past session reset the working directory mid-commit and nearly lost work, so
# build/feature/source changes must be isolated in a git worktree. The hard gate
# is worktree.bgIsolation="worktree" (blocks Edit/Write in the main checkout for
# background sessions until EnterWorktree is called); this reminder explains why.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"WORKTREE-ISOLATION POLICY (enforced): this repo runs concurrent autonomous build loops on one shared checkout; a prior session reset the working directory mid-commit and nearly lost work. Build/feature/source changes MUST be made in an isolated git worktree — call EnterWorktree before editing source files. For background sessions, worktree.bgIsolation=worktree HARD-BLOCKS Edit/Write in the main checkout until EnterWorktree is called. Docs-only updates to main (build-log, backlog status, ADR status) remain allowed by convention."}}
JSON
