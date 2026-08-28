# ADR 0034 — Machine-readable regulatory thresholds in the OpenAPI contract

- Status: **Proposed** — raised by BACKOFFICE-91, awaiting a human decision. CLAUDE.md rule 6 ("compose,
  don't invent … raise an ADR and stop") is why this record exists rather than a convention line.
- Date: 2026-08-28
- Scope: a **governance question**, not a product feature. One worked example already sits in the contract
  (`x-nfr18-exclusive-max-ms` on `nebras_propagation_ms`); this record asks whether that becomes a
  convention, stays a one-off, or comes out.
- Related: backlog **BACKOFFICE-91** (the story that introduced it) and **BACKOFFICE-95** (the operations
  SLO key set, where NFR-18's distributional half would be reported); **ADR 0030** (standards-baseline
  registry — the nearest precedent for governing a number the scheme supplies); `CLAUDE.md` §"API
  conventions"; `specs/backoffice-openapi.yaml`; `services/bff/src/consents/nebras-sla.ts`.

## Context

PRD NFR-18 requires a consent revoke to reach Nebras in under five seconds. STD-09 found that threshold
declared three times in code and collapsed it to one constant, `NEBRAS_SLA_MS`. BACKOFFICE-91 found the
fourth copy, in the artifact with the widest audience: `specs/backoffice-openapi.yaml` stated the bound as
free prose on `nebras_propagation_ms` — derived from nothing, compared by nothing. A scheme amendment would
have left the **published contract** telling integrators the old number while the services enforced the new
one, with no way for an integrator to discover the disagreement.

The fix that shipped states the bound twice on that field: once in prose, and once machine-readably as the
vendor extension `x-nfr18-exclusive-max-ms: 5000`. A test binds the extension to the constant, binds the
prose to the constant, and fails if any other duration appears in the node.

**That introduces a class of thing the contract did not previously carry.** The repo's existing extensions —
`x-required-scope`, `x-four-eyes`, `x-rate-limit-per-min`, `x-pure` — all describe how the *platform* treats
an operation. A machine-readable *regulatory threshold* is different in kind: the number originates outside
the repo, in a scheme document, and the extension asserts a conformance bound rather than a platform
behaviour.

**A correction, because the first draft of this ADR rested on it.** That draft said the four existing
extensions "are named in CLAUDE.md's binding conventions", making the new one exceptional for lacking a
governance record. The advisory hard-stop reviewer grepped `CLAUDE.md` and found none of the four; I
confirmed it — zero occurrences each. `x-required-scope` gets one passing mention in `docs/DEVELOPMENT.md`
as an example; the other three are documented nowhere outside the spec that uses them.

So the contrast the argument leaned on does not exist, and the honest version is less flattering to the
question: **no vendor extension in this contract has a governance record.** All four were established by
precedent, exactly the way this one would be. That cuts both ways — it removes "this one is uniquely
ungoverned" as an argument against, and it raises a larger question this ADR does not try to settle:
whether the existing four should be documented as conventions too. What survives is the narrower point,
which does not depend on the false contrast: a *regulatory conformance bound* sourced from an external
scheme document is a different kind of assertion from a platform behaviour, whatever the precedent is for
extensions generally.

Two independent advisory reviewers (hard-stop and contract-conformance, PR #347) raised the same point:
declining to *declare* it a convention does not un-introduce it. The next author needing the same thing
finds one worked example in the ground-truth document and no governance record — which is how a convention
gets established by precedent instead of by decision.

Four thresholds in the current canon are candidates if this generalises: NFR-18's revoke SLA, the 2-hour
approval expiry (PRD §10), the 24-hour `Idempotency-Key` window, and the Nebras Interaction Guide's dispute
stage clocks. None is machine-readable today.

## Options

**Option 1 — Adopt as a convention.** Add `x-<requirement>-<comparator>-<unit>` to CLAUDE.md's API
conventions, with the rules the worked example already follows: the key names the comparator (an inclusive
`max` and a strict `<` are different bounds — a one-millisecond window on a regulated control); the key
does not name a statistic it does not carry; and a test binds every occurrence in the field's schema node
to the single in-code constant. Retrofit the other three thresholds under their own stories.

*Cost:* a real surface to maintain, and `openapi-typescript` drops `x-` keys, so downstream SDK consumers
still read the bound as prose. The extension buys an in-repo regression guard, not machine-readability for
the people outside the repo — which weakens the main argument for generalising it.

**Option 2 — Keep it as a one-off, recorded.** The extension stays on this one field; this ADR is the
governance record that it is deliberately not a precedent. A future author wanting a second one reopens
this decision rather than copying.

*Cost:* an unreplicated mechanism in the ground-truth document is a thing every reader must ask about once.

**Option 3 — Remove the extension.** Keep the prose bound and the test that binds prose to constant.
BACKOFFICE-91's acceptance criteria are still met: the contract's number cannot drift from the code's,
because the test reads the description.

*Cost:* the strongest assertion in the guard (`toBe(NEBRAS_SLA_MS)` against a typed integer) is lost, and
the binding degrades to matching text. Nothing else in the contract then carries a regulatory bound a
machine can read.

## Recommendation

**Option 2**, on the evidence available. The generalisation argument for Option 1 is weakened by codegen:
the extension is invisible to every consumer outside this repo, so "machine-readable for integrators" is
not what it delivers, and retrofitting three more thresholds would buy three more in-repo guards at the cost
of a maintained convention. Option 3 is not free either — it trades a typed assertion for a text match on
the one control a regulator is most likely to ask about.

This is a recommendation, not a decision. **Humans decide** — that is the whole point of rule 6, and this
record exists because I should not settle a cross-cutting contract question inside a story PR.

## Consequences

- **If Option 1:** CLAUDE.md gains a convention line, and BACKOFFICE-91's extension becomes its first
  citation. Three retrofit stories get filed.
- **If Option 2 (recommended):** no code changes. This ADR is cited from the spec header and from
  `nebras-sla.ts`, both of which currently point here.
- **If Option 3:** the extension and its two assertions come out of `specs/backoffice-openapi.yaml` and
  `services/bff/test/nebras-sla.spec.ts`; the description, the comparator assertion, the no-unbound-copy
  count and the no-stale-duration guard all remain and still close BACKOFFICE-91.

Whichever is chosen, the contract keeps stating the bound in prose. A contract that says "see NFR-18" is
worse for the integrator than one that states the number, and no option here proposes removing it.
