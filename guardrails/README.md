# Runtime-neutral guardrails (Loom 2.0-rc.13 · WS4)

The Loom is distributed as a **Claude Code** plugin marketplace, so its pre-write guardrails
(`hooks/pii-guard.sh`, `spec-tripwire.sh`, `test-tripwire.sh`) are Claude Code-specific: they run
as `PreToolUse` hooks and block the *action* before it happens. An adopter whose agents run under a
different runtime does **not** get those blocks — and the Loom must never imply they do.

`guardrail-policy.json` is the neutral policy: for every guardrail and every runtime, it states
exactly what is enforced, what is caught by a CI backstop instead, and what is simply uncovered.
`scripts/guardrail-policy-check.mjs` verifies the policy is honest — every `enforced`/`ci-backstop`
claim names a mechanism that exists, every `uncovered` state names none, and a blocking guardrail
enforced nowhere must be flagged as an acknowledged gap. The **capability matrix** below is generated
from the policy and gated by `doc-integrity-check.mjs`, so it can never drift from what actually ships.

The fourth column, **`production-agents`**, is the serving path — an agent answering a customer at
request time. Everything else in this bundle is build-time. An institution running agents in the
serving path gets nothing from a `PreToolUse` hook or a pull-request gate, and an absent column reads
as coverage, so the column is present and almost entirely `○ uncovered`: each cell names why the
mechanism does not reach there and what the adopter-side control would be. **The harness reads JSON
records; it does not watch production** — no evidence it can gather moves a cell in that column to
`● enforced`. The serving-side control itself is a named component with an owner and a decision log:
see `adapters/providers/runtime-guardrails/README.md`.

## Capability matrix

<!-- LOOM:GUARDRAIL-MATRIX:START -->
| Guardrail | Event | claude-code | github-actions | local-git | production-agents |
|---|---|---|---|---|---|
| `pii-literal` | before-file-write | ● enforced | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `test-integrity` | before-test-modification | ● enforced | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `contract-freeze` | before-contract-modification | ● enforced | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `control-plane-freeze` | before-file-write | ○ uncovered | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `brainkit-immutability` | before-file-write | ○ uncovered | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `network-egress` ⚠︎ | before-network-egress | ○ uncovered | ○ uncovered | ○ uncovered | ○ uncovered |
| `parser-fail-closed` | before-file-write | ● enforced | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `shariah-terminology` | before-file-write | ● enforced | ◐ CI backstop | ○ uncovered | ○ uncovered |
| `agent-customer-decision` ⚠︎ | before-customer-decision | ○ uncovered | ○ uncovered | ○ uncovered | ○ uncovered |

_● enforced at the point of action · ◐ no local block but a CI gate catches it before merge (the enforcement of record) · ○ uncovered — no mechanism · ⚠︎ acknowledged gap (blocking, enforced nowhere). Generated from `guardrails/guardrail-policy.json` by `scripts/guardrail-policy-check.mjs`; do not edit by hand — run `node scripts/doc-integrity-check.mjs --fix`._
<!-- LOOM:GUARDRAIL-MATRIX:END -->

## The principle

**The CI gate is the enforcement of record.** A local hook is defence-in-depth that stops a bad
write at the point of action; where a runtime has no such hook, the guardrail is enforced by a CI
gate before merge (`◐ CI backstop`). Only `● enforced` means the action itself is blocked. `○
uncovered` is an honest gap — wire the named local hook (or a runtime-appropriate equivalent) to
close it. `⚠︎` marks a blocking guardrail that is enforced **nowhere** in the bundle (e.g.
network-egress, which needs an egress-controlled runner or sandbox — an adopter-side control).

`agent-customer-decision` is the second `⚠︎` row and the reason the serving column exists. Where a
compiled plan requires human oversight (`profiles/products/ai-decision-system.json`), the harness can
read that the requirement was **chosen and approved**; it cannot read whether the deployed agent
took the human step on any given request. Marking that as a CI backstop would sell a plan declaration
as a request-time control — the exact substitution this policy exists to prevent — so it is
`uncovered` on all four runtimes and flagged as an acknowledged gap. Coverage the harness cannot see
is declared, never implied.

**`shariah-terminology` is the one row whose `● enforced` is conditional, and the matrix has no cell
for that.** The schema's three states — `enforced`, `ci-backstop`, `uncovered` — carry no word for
*installed but dormant until the adopter opts in*, which is exactly what ships: the hook's scope is
`.claude/hooks/shariah-surfaces.txt`, that file ships **empty**, and with no entries the hook reads
the path, finds no declared surface above it and **allows**. On a fresh install it blocks nothing.
Read the cell as *point-of-action block inside a surface the institution declared Islamic*, and the
row's `claude-code` note in `guardrail-policy.json` as the qualification. That dormancy is the design
— an Islamic control must never fail a conventional adopter — not a gap to be closed by widening the
default scope. The `github-actions` backstop (`shariah-emission-check.mjs`, SE-R07) is dormant on the
same condition but activates from the **compiled plan**, not from a file somebody remembered to edit:
once a plan requires `shariah_governance`, an absent or empty surfaces declaration is `SE-R00`.

## Adapters

- **`claude-code`** — the shipped `hooks/*.sh`, wired via `settings.hooks.json` as `PreToolUse`
  hooks. They fail **closed** (deny) when `jq` is missing, so a missing dependency cannot silently
  disarm a guard.
- **`github-actions`** — the CI gates (`scripts/*.mjs`) run on every PR. This is the enforcement of
  record: a control-plane write, a weakened test, a contract change or a PII literal that a local
  hook did not stop is caught here before merge.
- **`local-git`** — no pre-commit hooks ship today. To cover this runtime, wire the relevant
  `hooks/*.sh` as `pre-commit`/`pre-push` hooks; until then these cells read `○ uncovered`.
- **`production-agents`** — the serving path, where **nothing in this bundle runs**. No adapter ships
  and none can: a filter at request time is infrastructure an institution deploys and operates, not a
  file a plugin copies in. The cells name the shape of the missing control — an output/PII filter, a
  tool-use allowlist pinned to the approved contract, an egress allowlist at the model gateway,
  deploy-gate image provenance, a policy engine that denies when it is unreachable. Two properties
  make any of them evidence rather than assertion: the decision log is asserted by the serving
  platform, not by the agent being constrained, and a negative probe shows a violating action
  actually denied. Between probes, coverage is `uncovered` — not assumed clean.
