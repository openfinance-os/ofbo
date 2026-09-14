---
artifact: roadmap-sketch
catalog: C
write_class: lives-on-the-floor
freeze: never
stage: floor
---

# Roadmap sketch — <RM-nnn>

> ## ⛔ WRITE CLASS · `lives-on-the-floor` — NEVER FROZEN
>
> This page **lives on the floor**. It is never frozen into `discovery/runs/`, no gate ever reads
> it, and no export ever checks it. That cuts both ways: write freely, and understand that
> **nothing downstream will catch what you write here**. On this page you are the control.
>
> **PII rule — before you type, not after.** No names. No contact details. No id, account or
> reference numbers. No verbatim customer detail. Bets are owned by **roles**, never by named
> people — a roadmap that lists individuals against dates is a performance record of those
> individuals, in a vendor's system, for as long as the page exists. If you cannot write it
> without naming someone, it does not belong on the floor at all.
>
> **A sketch is not a plan of record.** The backlog in git is the plan; this page is where the
> shape of the next few months is argued about before anything is committed. Copying it into
> `discovery/runs/` is the single move this write class forbids, and
> `scripts/floor-only-check.mjs` reports it as a crossing if it happens.

## Horizon

- **Sketch id:** `RM-001`
- **Period this covers:** <quarter or half — coarse on purpose>
- **Last argued over:** <yyyy-mm-dd>
- **Owner (role):** <hat, not a person>

## Bets on the board

> One row per bet, ordered by conviction rather than by date. `Confidence` is the honest column:
> a roadmap where everything is `high` is a commitment list wearing a roadmap's clothes.

| Bet id | One line | Horizon (now · next · later) | Confidence (low · medium · high) | Owning role | Backlog id, if any |
|---|---|---|---|---|---|
| B1 | | | | | |

## What we are deliberately not doing

> The half that makes a roadmap useful. Something declined here should be findable later by the
> person who asks "why didn't we…" — with the reason, not just the fact.

| Not doing | Why not, this period | Revisit when |
|---|---|---|
| | | |

## What would change this

> The triggers that would make the board wrong. Naming them now is what stops a sketch quietly
> becoming a commitment nobody re-examined.

- <trigger> → <which bets it moves>

## Where this meets the record

- **Bets promoted to the backlog:** <bet id → backlog id>
- **Bets that need a decision of record first:** <bet id → ADR · SDR · change classification>
- **Nothing on this page is a commitment** until it exists in `docs/backlog.yaml`.
