---
artifact: business-case
stage: handoff
design_profile: discovery/brand/design.md
run: "<slug>"
case_stage: "<1 | 2>"
write_class: decision-routed
authority: none
decision_record: "<ADR id or decision-envelope id once the funding decision is made — empty until then>"
---

# Business case — <slug>

> **Identifiers.** Gate ids (`D1`–`D9`) and run-level ids (`S-001` signal, `H1` hypothesis) are
> expanded in `discovery/GLOSSARY.md`. `SI-*` is a strategic intent from the institutional
> intake, where one exists.

> **What this is.** Delivery got cheap; change did not. The build is now the smaller part of
> what a change costs a regulated institution — organisational change, legal and contractual
> work, control-function time, operations and run, and the attention of the people who must
> approve it all move at the institution's pace, not the agent's. This document makes the case
> for **solving this problem**, against the **total cost of change** and against benefits that
> are the **D1 success measures** — so they are measured after launch, not forgotten. It is
> written in discovery, where the problem is framed, because the decision to fund belongs to the
> problem, not to a build.
>
> **What this is not.** It is not an approval. Write class `decision-routed`: the funding
> decision becomes real only as a signed decision record a second human merges (an ADR or a
> decision envelope under HG-0013); this document is the *proposal* that record cites. The Loom
> approves nothing. It is not a product approval either — PA1/PA2 (the product passport) carry
> the conduct-and-risk position; this carries the money and the change. And it is **not a
> solution**: the no-solutioning boundary (D4) holds here as everywhere in the left diamond.
> Costs are estimated for *a* change of this shape, at direction fidelity, and carry a band. If
> the Develop phase's chosen direction moves the total outside that band, the case is re-decided
> — never silently absorbed.
>
> **Two stages.** Stage 1 is a one-page pre-screen written from `problem-statement.md` alone,
> before the prototype — on a Factory Floor it is the catalog-C product brief hardened. Stage 2
> is the full case, written at hand-off with the validated direction and the stakeholder
> reaction in hand. Fill only the sections your stage needs; stage-2 sections are marked.

**Proposed:** <YYYY-MM-DD> · **Proposer:** <role> · **Decision requested:** <fund discovery → delivery · continue · stop>
**Decision authority (from `institution/brainkit/governance.md`):** <ADOPT: role or committee>
**Threshold band (ADOPT: the institution's own):** <e.g. below / above the committee threshold>

## 1. The problem, and the intent it serves

> Quote, do not restate. The problem is frozen in `problem-statement.md`; a business case that
> re-frames it has left the run.

- **Problem (D1):** `problem-statement.md` — <one line, quoted>
- **Target user:** <from the problem statement>
- **Strategic intent:** <`SI-nn` — one line> — or *"no strategic intent recorded"*, stated plainly
- **Evidence base (D2):** <count> signals, <count> `[synthetic]`

## 2. The case for acting, and the case for not

> **"Do nothing" is a mandatory row** — the cost of the problem continuing is the baseline every
> benefit is measured against, and it is the row most often left out. The other rows are *ways
> of framing the response*, not solution options: what is compared here is scope and timing, not
> mechanism. A row that names a technology, a vendor or a system design fails D4.

| # | Option | What it means for the target user | Cost of this option, per year | Why it was set aside / kept |
|---|---|---|---|---|
| 0 | **Do nothing** | The problem continues as evidenced in `synthesis.md` | <cost of the problem continuing> | The baseline |
| 1 | Solve the problem as framed (this case) | <the direction the prototype made tangible, in the user's terms> | <total cost of change, §4> | |
| 2 | Solve a narrower slice first | <what is deferred> | | |
| 3 | Defer one planning cycle | <what is lost by waiting> | | |

## 3. Benefits — the D1 success measures, valued

> **The rule that keeps this honest:** a benefit that is not a D1 success measure is not a
> benefit of *this* problem. Either it belongs in the problem statement (re-freeze the run) or
> it is dropped. The `product-eval-check` gate later scores every D1 measure against the
> shipping commit, so what is written here is what will be measured, by construction.

| D1 measure | Baseline → target | Value driver | Value (ADOPT: currency) | From when | Measured how (→ `docs/governance/product-evals.json`) | Confidence |
|---|---|---|---|---|---|---|
| | | <revenue · cost · loss avoided · capital · regulatory> | | | | <high / medium / low> |

- **Benefits finance does not count (ADOPT: from intake block H):** <list — and state whether any
  benefit above depends on them>
- **Dis-benefits:** <what gets worse for someone, and for whom>
- **What the stakeholder reaction said about these (D9, stage 2):** <which measures the reactors
  recognised as theirs, and which they did not — cite `S-NNN`>

## 4. Total cost of change

> A **band**, not a figure: discovery knows the shape of the change, not its build. One-off and
> recurring, separately. The build row is the one the Loom can later instrument (the token
> ledger, `token-report`); every other row is a human estimate and says so. **The rows most
> often under-counted are marked ▲.**

| Cost line | One-off (band) | Recurring / yr (band) | Basis of estimate | Owner role | Confidence |
|---|---|---|---|---|---|
| Build — agent and human (facilitation, review, four-eyes) | | | Comparable past change; refined by the SDR in Develop | engineering | |
| ▲ Organisational change — process, training, comms | | | | operations / HR | |
| ▲ Legal and contractual — NDAs, vendor onboarding, outsourcing notification | | | | legal | |
| ▲ Control functions — risk, compliance, data protection, model risk, audit | | | | risk second line | |
| ▲ Operations and run — support, monitoring, on-call, hosting | | | | operations | |
| Third parties and licences | | | | procurement | |
| Decommissioning / migration of what this replaces | | | | | |
| Contingency (ADOPT: institution's own rate) | | | | | |
| **Total (band)** | | | | | |

**Re-decision trigger:** if the Develop phase's Solution Direction Record puts the total outside
<the band above>, this case returns to its decision authority before a backlog item is admitted.

## 5. Financial summary *(stage 2)*

> Use the institution's mandated method (ADOPT: from intake block H). If there is none, say so
> and show payback only — do not invent a hurdle rate.

| Measure | Value (at the band's midpoint) | Method / assumption |
|---|---|---|
| Horizon | <years> | ADOPT |
| Hurdle / discount rate | <%> | ADOPT: source |
| NPV | | |
| IRR | | |
| Payback | | |

**Sensitivity** — three cases, each moving one thing:

| Case | What moves | Effect on NPV / payback |
|---|---|---|
| Benefits −30 % | | |
| Change costs at the top of the band | | |
| Launch slips <n> months | | |

## 6. Risk and governance position

> Cite; do not re-assess. The positions below are held elsewhere and this case inherits them.

- **Data-governance verdict (D6):** `data-governance.md` — <Yes / Conditional / No>, conditions carried: <list or "none">
- **Product approval (PA1/PA2), if compiled for this change:** <passport id and status, or "not compiled at this tier">
- **Dependencies:** <teams, third parties, decisions this rests on — by role and reference, never by design>
- **Assumptions that would change the answer:** <three at most, each falsifiable>

## 7. Exposure and first value *(stage 2)*

- **Staged rollout expected:** <the pilot-playbook cohorts a change of this shape would pass through>
- **First value date:** <when the first D1 measure is expected to move>
- **Kill criteria:** <what observation ends this change before it completes, and who calls it>

## 8. Benefits realisation

> Someone owns each measure after launch, and there is a date on which someone looks.

| D1 measure | Owner role | First review | Subsequent cadence | Where the number will come from |
|---|---|---|---|---|
| | | | | |

## 9. Roster — who this goes to

> This table is the **roster**, not the approval. The decision is recorded in `decision_record`
> (front-matter) as an ADR or decision envelope merged by a human other than the proposer.
> Names resolve through `docs/governance/identities.json`; roles only here.

| Role | Function | Consulted / decides |
|---|---|---|
| Proposer | | proposes |
| Finance | | consulted |
| Risk, second line | | consulted |
| Accountable executive | | **decides** |

> **Not here:** any system design, data model, technology or vendor choice, or a re-framing of
> the problem. If writing this case changed your mind about the problem, that is a discovery
> finding — take it back through the run, do not resolve it in a spreadsheet.
