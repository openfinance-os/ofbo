# ADR 0032 — Deleting an accepted ADR requires a record (supersedes ADR 0031)

- Status: **Accepted** — chosen by the user (2026-08-22), closing the question ADR 0031 left open.
  A control-plane governance rule under HG-0002, so it needed a human owner rather than the build
  agent's own say-so.
- Date: 2026-08-22
- Supersedes: **ADR 0031** — amending an accepted ADR: in-place for facts, supersession for decisions.
- Prompted by: the hard-stop AI reviewer on PR #324, which showed that ADR 0031's deletion carve-out
  rested on a control that does not exist.

## Why this is a new ADR rather than an edit

ADR 0031's own rule requires it. Its routing table sends *"the decision — the option chosen, **or
its scope**"* to a superseding ADR, and *"a statement of fact about the world"* to an in-place
amendment. Bringing deletion into scope changes the scope of the decision, not a fact about it —
so the convention obliges a supersession, and this is the convention applying to itself.

The factual half was already handled the other way: ADR 0031 stated as fact that
`scripts/doc-link-check.mjs` blocked silent orphaning, that turned out to be false, and it was
corrected in place with a dated amendment row. Fact corrected in place; decision superseded here.
Both halves of ADR 0031's rule were exercised by the same finding.

## Context

ADR 0031 carved outright deletion of an accepted ADR out of scope, and gave two grounds. One still
holds: the delete-plus-re-add pairing catches a "deletion" that is really a rewrite, including a
renumbered one. The other did not survive checking.

**The claim that failed.** ADR 0031 asserted that `doc-link-check.mjs` "already fails a PR that
deletes an ADR still referenced by a current-state doc", so silent orphaning was blocked. The
hard-stop reviewer checked it rather than accepting it, and it is false:

- that check resolves **file-path** references only;
- **no ADR is referenced by path anywhere in the set it scans** — `CLAUDE.md`, `README.md`, the PRD,
  `control-mappings.ts`, and `*.md` under `docs/adrs`, `docs/governance`, `.claude/skills`,
  `.claude/agents`;
- ADRs are cross-referenced by **number** ("ADR 0007"), which it cannot resolve;
- the `docs/adrs/NNNN-*.md` path references that do exist all live *outside* that set —
  `docs/backlog.yaml`, `docs/research/`, `docs/reviews/`, `services/mcp-gateway/src/index.ts`,
  `.github/workflows/ai-review.yml`.

So deleting an accepted ADR was green on both gates and silent — exactly the outcome the exemption
claimed to make impossible. That is the failure mode ADR 0031 exists to prevent (a document
asserting what its history does not support), occurring in the paragraph that justified an
exemption to it.

## Decision

**An accepted ADR may not be removed from the tree. Supersede it and leave the document in place.**

ADR 0031's two routes are carried forward unchanged:

| what changed | route |
| --- | --- |
| a **statement of fact** — what was built, measured, or proved | edit in place **+ a dated amendment row** |
| the **decision** — the option chosen, or its scope | a new ADR that supersedes this one |
| the ADR is **no longer wanted at all** | **supersede it; do not delete the file** |

There is deliberately no "satisfying" route for a deletion, because there is no edit to a file that
no longer exists which could carry the record. The remedy is to not delete it.

**Why keeping the file is the right remedy and not merely the enforceable one.** ADR 0012 was
superseded on 2026-06-21 and is still in the tree, still readable, still explaining why the generic
analytics renderer was chosen and then reversed. That is the value at stake. A deleted record takes
its reasoning with it, and `git log` is not a substitute for the same reason ADR 0031 gave for
amendments in the first place: **nobody reads git log before relying on a decision.** Supersession
costs one status line and preserves everything; deletion saves one file and destroys the context.

## Consequences

- **Cost, measured before adopting the rule rather than assumed.** No ADR has ever been deleted in
  this repository — numbers `0001`–`0032` run without a gap, and no deletion appears in the history
  of `docs/adrs/*.md`. The rule therefore constrains a thing that has never happened, at the price
  of one status line if it ever does. That asymmetry is why closing the exemption was cheap.
- **A `Proposed` ADR may still be deleted.** The rule attaches at acceptance, exactly as ADR 0031's
  did. Drafts have not been relied on.
- **A rewrite is still a rewrite.** The delete-plus-re-add pairing is unchanged, including across a
  renumber. Deletion detection is the *leftover* case — a deleted ADR with no added counterpart.
- **The gate's message carries the remedy.** A red here states that the record must be superseded
  rather than removed, and points at ADR 0012 as the worked example, because the failure message is
  the only documentation anybody reads at the moment they need it.
- **The known limits of ADR 0031 are inherited unchanged**, and are recorded in
  `scripts/adr-amendment-check.mjs`: route 2 trusts the status line, `ADR_BASE_REF` can be pointed
  at `HEAD`, and this step shares the `q2c` check-run. None is newly introduced here.

## What this does not decide

Whether ADRs are *regulated records* under `CLAUDE.md`'s retention hard stop. They are still not:
that stop binds `audit_high_sensitivity` and the regulated stores, and no ADR is sealed into an
ADR 0019 evidence bundle today. This ADR makes a governance choice about decision records, not a
regulatory classification. ADR 0031's revisit condition is carried forward: **if an ADR is ever
cited as evidence in a release bundle, revisit this before editing or removing it.**
