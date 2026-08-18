# ADR 0030 — Amending an accepted ADR: in-place for facts, supersession for decisions

- Status: **Accepted** — chosen by the user (2026-08-18), Option C of three put to them.
  A control-plane governance rule under HG-0002, so it needed a human control-plane owner
  rather than the build agent's own say-so.
- Date: 2026-08-18
- Prompted by ADR 0029, whose amendment table flagged this question rather than assuming an
  answer, after the hard-stop AI reviewer raised it twice on PR #318 at explicitly stated
  low-to-moderate confidence and declined to rule on it.

## Context

**The practice already existed and was undocumented.** Before this ADR there was no written
convention for editing an ADR after it reached `Status: Accepted`. What the repository actually
did was edit them in place, without recording that it had:

- **ADR 0007** was accepted on 2026-08-17 and substantively corrected the *same day* — commit
  `0f0a79a`, "correct VAT, query-window, and collection mechanics", **65 insertions and 22
  deletions**, changing the VAT posture, the query window and the collection mechanics of an
  accepted decision record. Nothing on the document says this happened; only `git log` knows.
- **ADR 0029** was accepted on 2026-08-16 and corrected on 2026-08-17 (engine status table,
  the codex bubblewrap finding, a verification record). It is the first ADR to carry an
  amendment table, which is why the question surfaced at all.

So the choice was never "should we start allowing this". It was: keep doing it silently, stop
doing it entirely, or do it with a record.

The single supersession precedent, **ADR 0012 → ADR 0016**, is a *decision reversal* (generic
analytics renderer → Stitch fidelity overhaul). It establishes no convention for factual
corrections, which is what both cases above actually were.

**Why this is not settled by the retention hard stop.** `CLAUDE.md` binds
`audit_high_sensitivity` and regulated data stores: INSERT-only, 24-month hot / 5-year
immutable, no deletion path. ADRs are not among them, and the reviewer was right that this is
where the question turns — if the adopting bank ever treats decision records as retained
regulated artefacts, the answer changes. ADR 0019 seals build provenance into release evidence
bundles committed to git; should an ADR ever be cited *as evidence* in such a bundle, revisit
this ADR before editing it in place.

## Decision

**In-place amendment is permitted for statements of fact. Supersession is required for changes
of decision. Either way the change is recorded on the document's face.**

The distinguishing test, and it is deliberately about *what changed*, not about how large the
diff is:

| what changed | route |
| --- | --- |
| the **decision** — the option chosen, or its scope | a new ADR that supersedes this one, per ADR 0012 → 0016 |
| a **statement of fact about the world** — what was built, what was measured, what a tool does, what a run proved | edit in place, and add a row to the ADR's amendments table |

Every ADR 0029 correction was the second kind: "codex has never run end to end" became "codex
ran, and does not work as written". The decision — advisory AI review as a swappable engine
port — never moved.

**The record required.** An ADR amended after acceptance carries a section headed
`Amendments after acceptance`, holding a table whose rows begin with an ISO date:

```
### Amendments after acceptance

| date | amendment |
| --- | --- |
| 2026-08-17 | Engine status table corrected — `codex` had been marked "never run end to end" when it had run and failed. |
```

The row says what became untrue and what replaced it. "Updated for accuracy" is not a row; a
reader must be able to tell from the table alone whether the thing they are relying on is one
of the things that changed.

**This is enforced, not merely written down.** `scripts/adr-amendment-check.mjs` runs in the
Q2c job and fails a pull request that modifies an ADR whose base-branch status is `Accepted`
unless that PR either adds a dated amendment row to it, or changes its status to `Superseded`.

"Modifies" is defined by what actually changes the record, not by git's status letter:

- a **rename** (`R*`/`C*`) — git never reports `M` for one, so renaming while editing would
  otherwise be the cheapest way around the rule;
- a **delete-plus-re-add of the same ADR number** — below git's rename-similarity threshold a
  full rewrite reports a separate `D` and `A`. That is an amendment wearing a deletion's
  clothes, and it is caught by pairing the two on the ADR number. Duplicate numbers are
  forbidden elsewhere (Q2b/Q2c), so such a pair always means "same record, rewritten".

**Outright deletion of an accepted ADR remains out of scope, deliberately** — but with one of its
two stated justifications now known to be false, which is recorded here rather than quietly
dropped. Removing a record is a different question from amending one, and this ADR states a rule
about modification. What still holds: the delete-plus-re-add pairing above closes the case where
"deletion" is really a rewrite, including when the rewrite is renumbered.

What does **not** hold, and was asserted here as fact until the hard-stop reviewer checked it:
`scripts/doc-link-check.mjs` does **not** block silent orphaning of an ADR. It resolves
*file-path* references only, and **no ADR is referenced by path anywhere in the set it scans**
(`CLAUDE.md`, `README.md`, the PRD, `control-mappings.ts`, and `*.md` under `docs/adrs`,
`docs/governance`, `.claude/skills`, `.claude/agents`). ADRs are cross-referenced by *number*
("ADR 0007"), which that check does not resolve. The `docs/adrs/NNNN-*.md` path references that do
exist live in `docs/backlog.yaml`, `docs/research/`, `docs/reviews/`,
`services/mcp-gateway/src/index.ts` and `.github/workflows/ai-review.yml` — every one of them
outside the scanned set. So deleting an accepted ADR outright is, today, green on both gates and
silent.

That is exactly the failure mode this ADR exists to prevent: a document asserting something its
history does not support. The carve-out may still be the right decision, but it must now rest on
its own merits rather than on a control that is not there. **Whether deletion of an accepted ADR
should require a record is therefore an open control-plane question for this ADR's owner**, and a
live one rather than a theoretical one. The `D`-path plumbing is the handle if it is tightened.

An unenforced convention is the failure mode this repository has hit repeatedly — a local rule
wearing a gate's clothes, per HARNESS-09 — and ADR 0007 is the proof that this particular one
would not have held on its own. The first draft of this check proved the same point about
itself: the hard-stop reviewer returned `VERDICT: FAIL (7 findings)` against it and reproduced
three live bypasses (a status regex that silently exempted two ADRs, a half-closed rename fix,
and the delete-plus-rewrite above). All are closed, with a regression test per finding.

## Consequences

- **A typo fix in an accepted ADR costs an amendment row.** The check cannot distinguish a
  substantive correction from a cosmetic one without making a judgement call in CI, and a gate
  that guesses is worse than one that is slightly heavy. If this proves noisy in practice, the
  proportionate relaxation is to require a row only when the diff *removes* lines — deletions
  being the thing that makes the record disagree with its own history — and that change should
  be an amendment to this ADR, recorded in its own table.
- **Discoverability is mechanical rather than documentary.** Nobody reads a process doc before
  editing an ADR. The check's failure message states the rule at the moment it is violated,
  which is the only point at which anyone wants to know it.
- **The check is intra-diff and needs base history.** It lives in Q2c, which already fetches
  the base ref for the number-reservation check, added as a separately guarded step so an
  earlier failure cannot skip it (HARNESS-07 doctrine). It is not a new job, because renaming
  or adding check-run names strands branch-protection rules pinned to the existing ones.
- **ADR 0007 is backfilled** by the same change that introduces this rule, since it is the one
  known case where the document and its history disagree with nothing to say so. Backfilling
  is itself an in-place amendment, and carries its own row.
- **`Proposed` ADRs are exempt.** They are drafts and have not been relied on. The rule attaches
  at acceptance, which is the point at which someone might be building against the document.
