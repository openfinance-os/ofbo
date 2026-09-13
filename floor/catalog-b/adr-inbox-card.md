---
artifact: adr-inbox-card
catalog: B
write_class: decision-routed
mirrors: delivery/templates/adr.md
floor_only: Inbox routing
stage: deliver
---

# ADR inbox — <ADR-NNNN>

> ## 🔀 WRITE CLASS · `decision-routed` — WRITTEN HERE, DECIDED IN GIT
>
> This card is where an architecture decision gets **written**. It is not where it gets **made**.
> What you type here is a draft of `delivery/templates/adr.md` — the git artifact this card
> mirrors, section for section — and nothing on this card unblocks a story or is read by any gate.
>
> **How it becomes real.** A floor-keeper carries this card into the repository as a **signed
> envelope** (`core/approval-attestations.mjs`), and **a human with architecture authority merges**
> the pull request. Until that merge the ADR is `proposed`, and a `proposed` ADR unblocks nothing.
> The build loop drafts, sets the story `blocked` with the ADR's path, and stops; the agent never
> self-merges an ADR (HG-0001). Recording a choice on this card routes it — it does not make it.
>
> **NON-AUTHORITATIVE · DECLARED, NOT ACTIVE.** WS5's entry gate has not passed: it needs an
> independent second-line review of the workstream's design, and that review does not exist. Read
> this card as a drafting surface and nothing more.
>
> **The sections below are not yours to change.** They are the ADR template's sections, in the ADR
> template's order, because a card that asks for different things than the record needs produces a
> record that fails its gate *after* the decision was taken.
> `scripts/approval-surface-check.mjs` refuses a card that has drifted from the template it mirrors.

## Inbox routing

> Floor-only — this block never travels into `docs/adrs/`. It is the *inbox* half of the card: who
> is waiting, what is stopped, and who holds the authority to decide. Roles, never names: the
> people-property on the approvals surface resolves an identity, a line of text here does not.

- **Blocked story:** <backlog item id>
- **Change:** <CHG-…>
- **Drafted by:** <agent identity — drafting is not deciding>
- **Decided by (role):** `solution-architect` · `enterprise-architect`
- **Waiting since:** <YYYY-MM-DD>
- **Second opinion asked of (role):** <role, or "none">

## Context

> What forces the decision now: the story that hit it, the constraint that bites, the option that
> was assumed and turned out not to hold. Name the inherited boundaries — the discovery hand-off's
> D6 conditions, the BrainKit's `technology-policy.json`, the contract the spec tripwire protects.
> One paragraph, no options yet.

## Options considered

> At least two real options, each argued fairly. An option nobody could choose is not an option; a
> straw man makes the record worthless to the next reader — and this card is read by whoever
> inherits the system, not by whoever is in the room today.

### Option A — <name>

- **What it is:**
- **Costs:**
- **Risks:**

### Option B — <name>

- **What it is:**
- **Costs:**
- **Risks:**

## Decision

> **Chosen: Option <X>.** Then the reasoning — why this option beats the others *against the
> success measures and the inherited conditions*, not in the abstract. Write it as a choice made,
> in the past tense, by a person: this text lands verbatim in the merged ADR.

## Consequences

- **Becomes true:**
- **Becomes harder:**
- **Revisit when:** <the condition or date that reopens this>

## Compliance notes

> Which HG entries, gates, controls, or regulatory expectations this touches — and how the decision
> leaves each one. If it touches none, say **none** rather than leaving the section empty: silence
> reads as an omission, not as a clean bill.

| Control / gate | How this decision affects it |
|---|---|
| | |

> **Not here:** implementation detail that belongs in the spec, and status updates that belong in
> the backlog. **Not here either:** an approval. If this decision needs a product-approval role to
> sign, that happens on the approvals surface and lands as a signed envelope — never as a tick on
> this card.
