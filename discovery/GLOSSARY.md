# Glossary — every identifier the Loom uses

The Loom uses short identifiers so a gate, a signal, or a decision can be cited precisely and
traced mechanically. They are terse by design and opaque on first contact. This file is the
single expansion of all of them; everything else links here rather than repeating it, so the
expansion cannot drift.

If you are reading a Loom document and hit an id you don't recognise, it is in one of the
tables below.

## Discovery gates — `D1`–`D9`

The nine checks a discovery run must pass before it can hand off to delivery. Mechanical:
they check structure, references, and presence — not taste. Enforced by
`discovery/gates/validate.mjs`, which prints each gate with its name.

| Id | Name | Fails when |
|---|---|---|
| `D1` | Problem framing | No falsifiable problem, no target user, or no success measure |
| `D2` | Evidence | A claim cites a signal that does not exist, or cites none at all |
| `D3` | Scope & stakeholders | No named stakeholders, or no explicit out-of-scope boundary |
| `D4` | No-solutioning boundary | A discovery artifact specifies a build — the left diamond leaking into the right |
| `D5` | Synthesis integrity | A theme traces to no signal, or no prioritisation method is stated |
| `D6` | Data-governance feasibility | No risk category or regulatory driver cited, an id that does not resolve against the register, or no residual-risk verdict |
| `D7` | Brand conformance | A visual artifact omits the brand marker or hard-codes a colour, size, or font |
| `D8` | Tangibility | No prototype brief and wireframe, or the prototype over-specifies |
| `D9` | Validation loop | A prototype exists that nobody reacted to |

## Quality gates — `Q1`–`Q5`

The delivery-side checks. A failed gate blocks merge. The set scales with the project; the
pattern is fixed — each gate answers one question, mechanically.

| Id | Name | Question it answers |
|---|---|---|
| `Q1` | build + unit | Does it compile and pass its own tests? |
| `Q1b` | test integrity | Did any test get weakened to reach green? (the anti-reward-hacking gate) |
| `Q2` | static + SAST | Lint, types, security static analysis |
| `Q2b` | doc integrity | Do current-state docs still point at files that exist? |
| `Q3` | integration + contract | Does it work against real local stores and honour the contract end to end? |
| `Q4` | security + dependencies | Dependency audit, secrets scan |
| `Q4.5` | lineage | Does every data store emit the lineage the regulator expects? |
| `Q5` | production approval | A human, at release time — evidenced, not implied |

## Run-level identifiers — authored inside a discovery run

Created by whoever runs the discovery. Local to one run, and the reason evidence stays
traceable: every downstream claim cites the id of the thing it rests on.

| Example | Expansion | What it is |
|---|---|---|
| `S-001` | **Signal** | One observation from research, with a source and a confidence. Everything downstream must trace back to one (that is gate `D2`) |
| `T-1` | **Theme** | A cluster of signals, named in synthesis. Every theme cites at least one signal (gate `D5`) |
| `H1` | **Hypothesis** | A framing hypothesis the prototype makes tangible, so a stakeholder can confirm or refute it (gate `D9`) |
| `SI-01` / `SI-P01` | **Strategic intent** (pursued / parked) | Not run-level: an institution-level id from the BrainKit's `strategy.md`. A problem statement or business case cites the intent it serves, or says it serves none. No gate reads it (2.2.0) |
| `G-01` | **Gap** | An open question the run has not answered. Recorded so it stays visible rather than being silently assumed |
| `I-1` | **Inference** | A plausible reading the evidence does *not* actually support. Carried explicitly so it can never pass as a finding |

## Governance identifiers

| Example | Expansion | Where it lives |
|---|---|---|
| `DR-1.1-001` | **Data Risk** — domain `DR-1`, category `DR-1.1`, statement `DR-1.1-001` | The data-risk register (the `D6` seam) |
| `CTRL-001` | **Control** | The data-risk register |
| `HG-0001` | **Harness Governance** decision | The governance catalog (`references/governance.md`) |
| `WS0`–`WS9` | **Workstream** | Factory Floor programme structure |
| `PA1` / `PA2` | **Product Approval**, first and second line | The regulated-bank profile |
| `R1`–`R6` | **Operational readiness** checks | Per-service readiness records |
| `Decision D5.4` | A **Factory Floor decision** record | Factory Floor. See the collision note below |

## The one collision worth knowing about

`D5` is a **discovery gate** (Synthesis integrity). `Decision D5.4` is a **Factory Floor
decision**. They are unrelated, and the resemblance is an accident of two numbering schemes
meeting.

The word `Decision` is therefore mandatory on the floor ids, at least on first use in any
document, and `scripts/id-legibility-check.mjs` enforces it. A bare `D5.4` is a bug in the
prose, because a reader has every reason to resolve it to gate `D5`.

## Why these are not renamed

The obvious fix — expand the identifiers themselves, `D8` becoming `DIS-8` — was considered
and rejected. `D1`–`D9` and `Q1`–`Q5` appear in adopters' branch-protection
required-status-checks, in the control catalogue, and in every discovery run already written.
Renaming means either breaking those or teaching the validator two names for one gate, and a
gate that answers to two names is harder to trust than a terse one.

So the ids stay, and the burden moves to the prose: expand on first use, link this file, and
let a gate keep it that way.
