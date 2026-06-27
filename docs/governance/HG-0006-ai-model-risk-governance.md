# HG-0006 — AI/model-risk governance for the harness (CBUAE Responsible-AI / NIST AI RMF-aligned)

- Status: **Proposed** — awaiting bank model-risk / governance decision
- Date: 2026-06-20 · re-anchored 2026-06-27 (regulatory basis updated — see Context)
- Scope: harness / AI-SDLC governance
- Related: HG-0001..0005 (the controls this governs); docs/model-cards/ (the pattern already used for BACKOFFICE-65); the harness bank-readiness review (2026-06-20)

## Context

The build harness *is an AI model operating inside the bank's SDLC* — it makes design,
code, review, and (today) merge/deploy decisions. The bank already governs an in-product
AI artefact (BACKOFFICE-65 predictive liability: model card + recertification + drift +
fallback). The **harness itself has none of that governance**: no model card, no
validation, no documented human-in-the-loop points, no change-control on the
behaviour-defining config (skills, `CLAUDE.md`, reviewer prompts — which the agent has
been editing), no kill-switch, and no monitoring of agent decisions/cost. Under model-risk
and responsible-AI expectations, an unvalidated, self-modifying model driving production
change is not acceptable.

**Regulatory re-anchoring (2026-06-27).** This record originally framed the requirement as
"SR 11-7-equivalent." The US interagency model-risk guidance was **revised on 17 April 2026
and now explicitly *excludes* generative and agentic AI** as "novel and rapidly evolving"
(with an RFI on banks' AI use forthcoming), so SR 11-7 is no longer the controlling anchor for
a GenAI harness. The governing basis is now: the **CBUAE Guidance Note on the Responsible
Adoption and Use of AI/ML (2026)** — board-level accountability, "complete operational control"
over deployed models, annual bias audits, **three-tier risk-calibrated human oversight**, and a
mandatory **immediate cease-use capability** (the kill-switch, HG-0010) — layered over **NIST AI
RMF + the Generative AI Profile (AI 600-1)** and certifiable under **ISO/IEC 42001**. SR 11-7
remains useful as a *validation discipline* (inventory → validate → monitor), not as the GenAI
compliance authority. (UAE primary sources — the CBUAE Guidance Note date and DIFC Reg 10 / CP3
— should be confirmed against the regulator's rulebook before reliance in a formal filing.)

## Requirements & regulatory basis

- **Model risk management.** Inventory, document, validate, and monitor the model; define
  its intended use and limits; independent review of changes.
- **Human-in-the-loop.** Documented points where a human must decide (merge, prod, control
  changes — HG-0001/0002/0005).
- **Behaviour change-control.** Prompts/skills/CLAUDE.md/reviewer definitions are the
  model's "configuration" — versioned and human-approved (not self-edited; HG-0002).
- **Controllability.** A **kill-switch** to halt the loop, and monitoring/observability of
  what the agent did, decided, and spent.

## Options

1. **Treat the harness as a governed model (recommended).**
   - A **harness model card** (intended use, scope, limits, the human-in-the-loop map,
     known failure modes incl. the concurrency near-loss and DoD-overstatement seen this
     session).
   - **Independent validation** of the harness against a control checklist before it runs
     unattended; periodic re-validation.
   - **Change-control on behaviour config** (skills/CLAUDE.md/reviewer prompts) via the
     immutable control plane (HG-0002) + human approval.
   - **Kill-switch** (disable the loop / hooks) and **run observability** (decisions,
     diffs, cost, escalations) retained externally (HG-0003).
   - **Pros:** brings the harness under the same model-risk regime the bank already applies
     to product AI; makes unattended operation defensible. **Cons:** governance overhead;
     formal validation effort.
2. **Lightweight: model card + kill-switch only**, defer formal validation. Pragmatic
   interim; weaker assurance.
3. **No formal governance** (treat the harness as "just a tool"). **Rejected** — it makes
   consequential production-change decisions; that is a model, and an ungoverned one.

## Recommendation

**Option 1** — govern the harness as a model: card, independent validation,
config change-control, kill-switch, and monitored runs.

## Decision

_Pending._ Once accepted: author the harness model card, define the validation checklist
+ cadence, put behaviour config under HG-0002 change-control, implement the kill-switch,
and wire run observability into the external evidence store (HG-0003).

## Consequences

- The harness becomes an inventoried, validated, monitored, controllable model with
  documented human gates — the umbrella that ties HG-0001..0005 together.
- Behaviour-config changes are human-approved; the agent stops self-modifying its rules.
- Adds governance overhead, accepted as the cost of unattended operation in a bank.
