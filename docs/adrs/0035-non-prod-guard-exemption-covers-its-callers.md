# ADR 0035 — The rule-7 lint exemption covers the non-prod guard and its callers

- Status: **Accepted** — user decision (2026-08-28), "Rule it intended", chosen from four options put
  to them after the advisory hard-stop reviewer raised the question on PR #346 and explicitly declined
  to settle it.
- Date: 2026-08-28
- Scope: a **governance ruling** on the scope of an existing exemption, not a new mechanism and not a
  product feature. It grants nothing new; it records what the existing `reset.ts` exemption is
  understood to cover, so the next reader and the next reviewer do not have to re-derive it.
- Related: `eslint.config.mjs` (the exemption and the `no-restricted-syntax` profile rule),
  `packages/db/src/reset.ts` (`assertNonProdBulkMutation`), `packages/db/test/non-prod-guard.spec.ts`
  (the compensating control), backlog **DEMO-SEED-ORPHAN-DECOMMISSION**; **ADR 0029** (advisory AI
  review), **ADR 0030** (the nearest precedent for a governance-only record raised under CLAUDE.md
  rule 6).

## Context

CLAUDE.md's deployment-profile rule is a hard stop: *application core code NEVER branches on profile*.
It is enforced mechanically by a `no-restricted-syntax` rule in `eslint.config.mjs` that matches
**reads** of `DEPLOY_PROFILE`, with one per-file exemption for `packages/db/src/reset.ts` — the
`db:reset` tool, which destroys demo data and must refuse to run outside the demo profile.

`DEMO-SEED-ORPHAN-DECOMMISSION` found that the three seed entry points (`db:seed`, `db:seed:tenants`,
`db:seed:demo`) had no such refusal at all, while writing synthetic rows into `audit_high_sensitivity`
— an INSERT-only table with no deletion path granted to any role. Rows landed there by a
misconfigured seed are permanent by construction.

The fix exported the existing guard from `reset.ts` and called it from all three. That closes the data
risk and introduces a governance question, which the advisory hard-stop reviewer raised: the ESLint
rule matches **reads**, and these three modules only **call** a function that reads. So they became
profile-conditional in a way the mechanical gate cannot see, while the exemption list names
`reset.ts` alone.

The reviewer flagged it at explicitly stated low confidence across three separate rounds, each time
declining to rule and asking for a human. On the third round it said the deciding factor was that the
ruling existed only as a claim in a config comment: *"I could not verify (d) from the repository — it
is a claim in a comment … If the owner ruling is real and recorded, this is closed."* This document is
that record. A comment asserting a human decision, with nothing behind it, is the same defect class
the branch it sits on was opened to remove.

## Options put to the user

1. **Rule it intended** — the exemption covers the guard and its callers. *(Chosen.)*
2. **Copy the guard** into each seed, so each reads `DEPLOY_PROFILE` directly and the ESLint rule sees
   all four — trading one read for four, and four copies of a security check to keep in step.
3. **Extend the ESLint `files:` allowlist** to name the three seeds, making the exemption explicit per
   file but growing every time a seed is added.
4. **Drop the guard** from the seeds, returning them to running under any profile.

## Decision

**Option 1.** The `reset.ts` exemption covers `assertNonProdBulkMutation` and the modules that call
it.

The reasoning the user's ruling rests on, recorded so it can be argued with rather than inherited:

- **All four modules are non-prod data tooling, not request-path core.** The rule protects application
  core code — the code that serves requests — from behaving differently by profile. `db:reset`,
  `db:seed`, `db:seed:tenants` and `db:seed:demo` are CLI entry points that exist to write or destroy
  demo data.
- **The branch is a refusal, not behaviour selection.** Nothing downstream differs by profile. Either
  the tool runs, or it throws. That is the narrowest possible form of profile-conditionality and the
  opposite of the divergence the rule exists to prevent.
- **Every alternative is worse against the same rule.** Option 2 turns one `DEPLOY_PROFILE` read into
  four and four copies of a control into four chances to change three. Option 3 is Option 1 with more
  maintenance and the same semantics. Option 4 reopens the permanent-audit-row risk that motivated the
  change.

## Amendment (2026-08-28, same day) — the premise was briefly false when this was written

An in-place factual correction; the decision above is unchanged. Recorded rather than quietly fixed,
because the ADR's first argument depends on it.

When this ADR was accepted, the guard was exported from `packages/db/src/reset.ts` and the three seeds
imported it from there. `packages/db/src/index.ts` re-exports all three seeds and
`services/bff/src/worker.ts` imports from `@ofbo/db` — so that import edge put `reset.ts` into the
**request-path service's module graph**, carrying `resetDatabase` (which TRUNCATEs every table in the
schema) and the one non-ports `DEPLOY_PROFILE` read along with it. Nothing called it, and a bundler may
have shaken it out; neither makes it acceptable.

That is exactly the line this ADR says its ruling does not cross — "all four modules are non-prod data
tooling, **not request-path core**". The advisory hard-stop reviewer found it on the same commit that
added this ADR, which means the record closing the rule-7 question was itself resting on a premise the
same change had quietly broken.

Fixed structurally rather than argued about: the guard is now its own module,
`packages/db/src/non-prod-guard.ts`, holding the refusal and nothing else — no pool, no SQL, no
truncation. The seeds import it from there, so `reset.ts` is reachable only from `db:reset` and is no
longer in the graph of anything `@ofbo/db` exports (verified by walking the import graph from
`packages/db/src/index.ts`). The ESLint exemption moved with the `DEPLOY_PROFILE` read.

The ruling's premise is now true as stated.

## Consequences

- `eslint.config.mjs` records the ruling at the exemption and cites this ADR, so the scope is readable
  where it applies rather than only here.
- **The caller set is closed by a test, not by prose.** `packages/db/test/non-prod-guard.spec.ts`
  asserts the callers against a declared allowlist — the same pattern `RAW_SQL_AUDIT_WRITERS` uses for
  raw audit writers. A new caller fails that test by name. This is the enforcement the lint rule
  structurally cannot provide, and this ruling is conditional on it continuing to exist.
- **That test is load-bearing, and it has been wrong three times** — a non-recursive scan whose regex
  matched the guard's own declaration; then a scan keyed on file *basename*, so any new caller in a
  file already named `seed.ts` collapsed into a declared entry; then a walk covering only three
  directories and skipping specs. It now keys on repo-relative path and walks from the root. Known
  residual holes, recorded rather than papered over: an aliased reference
  (`const g = assertNonProdBulkMutation`) and a `.js`/`.mjs` caller are still invisible. No such caller
  exists, and widening the match to a bare identifier would pull in every comment naming it.
- **This ruling does not extend to request-path code.** A module that serves requests appearing in the
  guarded set is the actual rule-7 violation, and the test's own docblock says so.
- The advisory reviewer may still raise the rule-7 question, since the checklist item is written
  mechanically. It should now be closable by citing this record.
