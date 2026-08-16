# ADR 0029 — Run the two OFBO reviewers in CI as advisory PR checks (HARNESS-16)

- Status: **Accepted** — approved by the user (2026-08-16). A control-plane change under
  HG-0002, so it needed a human control-plane owner rather than the build agent's own say-so;
  `@michartmann` is the resolvable owner on `/docs/adrs/` and `/.github/` under the interim
  CODEOWNERS arrangement.
- Date: 2026-08-15
- Realises the "AI reviewers remain as *advisory* PR checks" posture already chosen in
  HG-0001 (line 39). Follows ADR 0020 (Q2b doc-drift) and ADR 0021 (mutation testing) as
  precedent for adding a non-Q CI surface in its own workflow file.

## Context

AI review already happens on every story — but only **pre-PR, inside the build agent's own
session**. `.claude/skills/next-story/SKILL.md:35` dispatches `hard-stop-reviewer` (must
return `VERDICT: PASS`) and `contract-conformance-reviewer` (must return
`VERDICT: CONFORMANT`); HG-0001 counts those verdicts toward the merge criteria and
`docs/build-log.md` records them per story.

**The gap is self-attestation, not absence.** The agent runs its own reviewers, reports its
own verdicts, and writes them into its own build log. Nothing in GitHub verifies that the
review ran, or that the reported verdict matched what the reviewer actually said. Every other
control in this harness is enforced outside the agent's write scope — CODEOWNERS (HG-0002),
the Q gates, the branch protections. This one was not. Before this change, the CI pipeline
contained no model-based review of any kind: Q4 is named "security review" but is
`pnpm audit` + `semgrep p/secrets`.

## Decision

A new workflow, `.github/workflows/ai-review.yml`, runs both reviewers on every code-touching
pull request, in a fresh session on GitHub's infrastructure, and posts each verdict to the PR.

- **Own workflow file, not a job in `ci.yml`.** Same reasoning as `mutation.yml`: a
  non-universal, cost-bearing check, and the deterministic Q-gate file stays free of model
  calls. Deliberately **not** named `Q*` — that namespace means "deterministic merge gate",
  and a model call is neither.
- **Two independent check runs** (`fail-fast: false` matrix legs). A failing hard-stop review
  must never cancel the contract-conformance leg; an absent result is indistinguishable, on
  the checks tab, from a passing one. Same HARNESS-07 doctrine as `ci.yml:125-129`.
- **The prompt points at the agent definitions; it does not restate them.**
  `.claude/agents/hard-stop-reviewer.md` and `.claude/agents/contract-conformance-reviewer.md`
  are CODEOWNERS-protected and already specify a machine-parseable `VERDICT:` line. Inlining
  their checklists into the workflow would create a second, drifting copy of the canon — the
  exact failure Q2b exists to catch — so the workflow reads the same files the pre-PR
  reviewers read.
- **Red on a finding, but never a required check.** The job exits non-zero on `FAIL`/`DRIFT`
  so the finding is visible, and it is deliberately **not** added to branch protection. A
  human can merge over it. That is what HG-0001's "advisory" means: it will not block you,
  but it will not show green next to a finding either.
- **A review that did not complete is red, not green.** The verdict is parsed from the review
  file — a missing file, a missing `VERDICT:` line, or a malformed one all report
  "DID NOT COMPLETE" and fail. This is the whole point of the design: the failure mode worth
  engineering against is not a wrong verdict, it is a *missing* verdict that reads as a pass.
  Verified against twelve parse cases including a review with no verdict, `VERDICT: MAYBE`,
  and `VERDICT: PASS` appearing mid-prose — all three land on red.
- **Structural non-runs report loudly and are explicitly not passes.** Three conditions make
  the review impossible rather than merely failing: a fork PR (GitHub withholds secrets), an
  absent credential, and **a PR that edits this workflow file** (see below). Each emits a
  `::notice`, a step-summary block, and a PR comment saying **"This is not a pass"**,
  mirroring the q1b handling at `ci.yml:67-78`. None of them reds the job — each is a
  property of the situation rather than of the diff, and a fork PR would otherwise be
  permanently red through no fault of its author. Red stays reserved for "the review ran and
  had something to say". The PR comment is the load-bearing part: a structural non-run that
  left no trace on the PR would be a green check with nothing to explain it, which is the
  "absent control looks like a passing one" class this whole workflow exists to close.

### The review engine is a port, not a hardcoded vendor

PRD §3 says institution-specific systems are ports: code against the interface, keep the
mapping in configuration, never hardcode a vendor. That rule applies to the model reviewing
the bank's code at least as much as it applies to the bank's ITSM. So the engine is a port.

**The contract** is fixed and engine-agnostic: read a CODEOWNERS-protected reviewer
definition, diff the PR against its base, write a review to `$REVIEW_FILE` whose last line is
a `VERDICT:` line. An adapter is never trusted to set the job's status.

**The verdict parse is the port's contract test.** It binds every adapter identically, which
is the same acceptance rule ADR 0024 sets for the enterprise port adapters — an enterprise
adapter must pass exactly the tests the simulator passes. An engine that cannot produce a
parseable verdict fails as DID NOT COMPLETE rather than being quietly accepted.

**Which engines run is configuration** — `.github/ai-review.config.json`. One enabled engine
is a swap; two is a cross-check at twice the cost and twice the check runs. Adding an engine
is a registry entry plus one guarded adapter step; everything after the `ADAPTERS END` marker
in the workflow is engine-blind, and `scripts/test/ai-review-matrix.test.mjs` asserts that the
core never names a provider. Engine-specific facts that would otherwise leak into the core
live in the registry instead: the comment attribution (attributing a Codex review to Claude
Code would misstate which model produced the verdict) and `requires_workflow_parity` (the
anti-exfiltration rule below belongs to one engine's tooling, not to the port).

**The failure mode worth engineering against** is a half-added engine: a registry entry with
no adapter step would produce a matrix leg that runs, executes nothing, writes no review, and
surfaces as the generic DID NOT COMPLETE — a real non-review wearing the costume of a
transient failure. `scripts/ai-review-matrix.mjs` refuses to build such a matrix, so the
`config` job fails loudly and specifically before a single token is spent. Verified: an
enabled engine without an adapter exits 1 with an `::error`; a disabled one is simply excluded.

**No repository-variable override, deliberately.** Under HG-0006 the reviewer prompts and the
model serving them are model configuration, and HG-0002 puts model configuration under
`control-plane-owners`. An admin-settable `vars.` override would move part of that decision
outside CODEOWNERS review. Changing which model reviews the agent's work is a control-plane
PR, by design — the convenience is not worth the hole.

**Claude is the only engine enabled.** A Codex adapter ships alongside it at `enabled: false`.
It is a real adapter, not a stub — written against the `@openai/codex` CLI surface verified
against v0.147.0 (`codex exec` with `--model`, `--sandbox`, `-o`) rather than against an
action reference that could not be confirmed to exist. It has **never executed end to end**,
because no `CODEX_API_KEY` is configured; its first run must be treated as unproven. It fails
loudly rather than silently: a wrong invocation writes no review file, and the core reports
DID NOT COMPLETE.

### The workflow-validation skip (found by running it)

`claude-code-action` refuses to hand its GitHub App token to a run whose own workflow file
differs from the version on the default branch — an anti-exfiltration control, so a PR cannot
rewrite the workflow *and* obtain the token. The first run of this workflow, on the PR that
introduces it, therefore skipped with *"Workflow validation failed… your workflow will begin
working once you merge your PR."*

Two things followed. First, the design behaved correctly under it: the action's skip produced
no review file, and the three-way parse refused to show green, reporting DID NOT COMPLETE.
That is the intended failure mode, observed live rather than argued for. Second, it exposed a
real defect — the check reported the *symptom* ("the reviewer produced no review file") rather
than the cause, so a future control-plane PR editing this file would hit the same wall with no
idea why. Preflight now detects the condition directly by diffing this workflow against the
default branch, and reports the actual reason and that it self-resolves on merge.

The practical consequence for reviewers: **any PR that edits `ai-review.yml` cannot exercise
the reviewers on itself.** That is a genuine limitation, not a workaround — the first real
review this workflow performs will be on the PR *after* the one that merges it.

### What this explicitly does not claim

The CI reviewer is the same model family reviewing the same agent's output. It runs with no
shared context, which removes "grades its own homework in the same conversation" and makes
the verdict externally observable. It is **not** separation of duties, and HG-0001 already
says so directly: *"AI reviewing AI is not four-eyes"* (line 58). The human-merge requirement
is untouched. Anyone reading a green check here should read it as "an independent run of the
same reviewer found nothing", not as an approval.

## Consequences

- The verdicts that HG-0001 counts toward merge are now produced on a surface the build agent
  cannot write to, and are visible on the PR rather than only in the agent's own build log.
- **Cost.** Opus 5 at $5/$25 per MTok, roughly 100–200k input and 5–10k output per reviewer,
  is about **$0.50–$1.25 per reviewer** — **~$1–$2.50 per PR** for both. Billed to the Claude
  subscription behind `CLAUDE_CODE_OAUTH_TOKEN`. It runs on every push to a PR
  (`synchronize`), so a story with many pushes multiplies that; `concurrency.cancel-in-progress`
  limits the waste from rapid successive pushes. If this proves expensive in practice, the
  cheaper knob is narrowing the trigger to `opened` + `ready_for_review`, at the cost of the
  check no longer reflecting current HEAD.
- **A path-filtered PR shows no check at all**, rather than a skipped one. `paths-ignore`
  omits docs-only and discovery-only PRs. Acceptable for an advisory check, but stated here
  rather than left to be discovered. Note the consequence that a PR touching *only*
  `.claude/agents/*.md` — a change to the reviewers themselves — is not reviewed by them;
  that path is covered by CODEOWNERS and human review instead.
- **Residency (HG-0011).** A GitHub-hosted runner calling `api.anthropic.com` is cross-border
  inference over repository content. This is HG-0011 **Option 3 (status quo provider proxy)**,
  which that policy permits only "while the environment is synthetic-only and non-prod"
  (line 48) — true of this repo, which is permanently non-prod with zero real PII. It is
  **not** compliant for real or confidential context, and must move at the M6 enterprise swap.
- **The M6 swap path is config, not a rewrite** — `use_bedrock` / `use_vertex` / `use_foundry`
  inputs, or `ANTHROPIC_BASE_URL` pointed at the bank's onshore gateway. **One caveat that
  bites:** `CLAUDE_CODE_OAUTH_TOKEN` is bound to one person's Claude subscription and pins the
  job to the first-party API. The M6 move therefore also requires replacing it with an API key
  or, better, workload identity federation (`anthropic_federation_rule_id` +
  `anthropic_organization_id`, which stores no long-lived secret). Recording it here so the
  swap is not discovered to be two changes instead of one. The engine port makes this a
  narrower change than it would otherwise be: an onshore-routed engine is a new registry entry
  and a new adapter step, and the reviewers, prompt, verdict parse, and reporting are untouched.
- **A second enabled engine doubles the cost and the check runs**, since engines are crossed
  with reviewers. Two engines on two reviewers is four check runs at ~$1–2.50 each per push.
  Cross-checking is a deliberate spend, not a default.
- **HG-0006 (AI model risk governance).** The reviewer prompts are model configuration. They
  remain under `/.claude/` and therefore under `control-plane-owners`; this workflow adds no
  new prompt surface, which is precisely why it reads the agent files instead of inlining them.
- **Known coverage gap.** Both reviewers are deliberately narrow — "review ONLY for the
  hard-stop list" and "only contract fidelity". Neither hunts general correctness bugs, so no
  PR check does. Anthropic's hosted Code Review is the obvious candidate, and was rejected for
  *this* job (below) but not for that one. Revisit at M6, when the ZDR and onshore-gateway
  constraints that rule it out today are decided either way.

## Alternatives considered

- **Anthropic's hosted Code Review** (managed service, no workflow file, enabled in admin
  settings). Rejected for this job on three counts. First, it **cannot source its rules from
  the agent files**: `REVIEW.md` is injected verbatim, `@` imports are not expanded and
  referenced files are not read, so both checklists would have to be duplicated into a second
  copy free to drift from the CODEOWNERS-protected originals. Second, it **forecloses the
  HG-0011 M6 path** — it runs only on Anthropic infrastructure, with no Bedrock/Vertex/onshore
  option, and is unavailable to organizations with Zero Data Retention enabled; a
  CBUAE-regulated adopting bank may require both. Third, its check run always completes with a
  neutral conclusion and cannot go red, and it costs $15–25 per review against ~$1–2.50 here.
  It remains the right tool for the general bug-hunting gap noted above.
- **Making the check required in branch protection.** Rejected — it contradicts HG-0001's
  explicit "advisory" posture and would let a model's false positive block a merge with no
  human override short of an admin bypass.
- **Inlining the checklists into the workflow prompt.** Rejected — it is the drift Q2b exists
  to catch, and it would move model configuration out from under the `/.claude/` CODEOWNERS
  rule that HG-0006 relies on.
- **One job running both reviewers.** Rejected — HARNESS-07. A failing first review would hide
  whether the second one ran.
- **Reusing the action's own PR-comment behaviour** (`--comment` on the packaged code-review
  skill). Rejected — it reviews for general correctness against its own criteria, not against
  the OFBO hard-stop and contract checklists, and it gives no machine-readable verdict to
  gate on.
