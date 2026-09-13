# Model-risk operating model — governing the agent as a model (cluster B)

The build agent is a **model**. The `model-provenance-check.mjs` gate proves the release pinned
that model, ran a fresh eval against the shipping pin, and recorded a `validated_by`. That is
provenance, not model-risk management. Under SR 11-7, PRA SS1/23, ISO 42001, the EU AI Act and
NIST AI RMF, a model that reaches into a regulated SDLC must also be **tiered by an authority
that is not the builder, challenged by an independent function, monitored in production, and
governed by a committee that answers to the board — with a cease-use path when it goes wrong.**
This is `bank-grade-gap.md` **cluster B** and the adopter-side half of **HG-0006**; the repo-side
half — the manifest and the provenance gate — is `../loom/references/model-risk.md`. Where a step
says "the gate enforces," read *a declaration is checked*; where it says "you build," read *the
enforcement of record is yours*.

> **Why a bundle cannot enforce this.** A plugin cannot instantiate an organisationally-separate
> model-risk function, an observability pipeline watching a live model, a board committee, or an
> incident bridge — those are people, reporting lines, run-the-bank infrastructure the agent
> cannot reach, and an authority to say no. What the bundle gives you is the **seam** those
> controls attach to: the `model-provenance-check.mjs` gate (pin + eval-against-shipping-pin +
> `validated_by`), the `model-manifest.json` inventory seam, and the `model-risk-reviewer` /
> `change-watch` plugin agents. Nothing below is enforced by the harness; where the runbook says
> "the gate enforces X," it means the gate enforces that a *declaration exists and is internally
> consistent* — the enforcement of record is the platform or org mechanism named alongside it.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **B · Model risk & AI governance (SR 11-7 · PRA SS1/23 · EU AI Act · NIST AI RMF · ISO 42001)** |
| **Primary HG decision** | HG-0006 (the agent is an ungoverned model → AI/model-risk governance for the harness itself) |
| **Composes with** | HG-0001 / HG-0002 (the control plane this sits on — activate first), HG-0003 (the release evidence seal), HG-0010 (cease-use switch + accountable Senior Manager) |
| **Loom machinery it complements** | `model-provenance-check.mjs` gate + `model-manifest.json` seam; the `model-risk-reviewer` agent (② Assess); `change-watch` (① Watch); `evidence-seal-check.mjs` (HG-0003) for sealed provenance; `activation-runbook.md` (precondition) |

## What the bundle ships vs what you build

| Concern | The bundle ships (repo-side seam / gate / agent) | You build (the institution's, org-side) |
|---|---|---|
| Model inventory | `model-manifest.json` seam; gate fails on an incomplete or floating entry | Enterprise model register; the manifest is a projection of it, not the source of truth |
| Tiering | Gate enforces *a tier is declared* and drives the mandatory controls | The tiering *decision* + criteria, owned by an independent function, ratified by the committee |
| Eval before release | Gate requires a passing eval run against the shipping pin (anti-stale) | The eval rig, its thresholds, and their meaningfulness |
| Challenger models | Gate can require a comparative block in the manifest | The challenger rig and the champion/challenger decision |
| Independent validation | `validated_by` field + `model-risk-reviewer` agent (challenge material) | The org-separate MRM function and its reporting line to the CRO / board |
| Drift monitoring | `change-watch` — build/event-time scan only | Continuous **runtime** telemetry, thresholds, alerting, and response |
| Committee / board oversight | CODEOWNERS can protect the tiering thresholds (HG-0002) | The committee, its terms of reference, and board reporting |
| AI incident response | The manifest tells you *which* model; HG-0010 names the switch | The wired cease-use path, on-call, severity model, and runbook |

Do not describe any right-hand item as "enforced by the harness." The gate enforces that a
*declaration exists and is internally consistent*; the institution enforces that the declaration
is true.

## The model-risk lifecycle, and where the harness sits

| Stage | Owns it (org-side) | The bundle's contribution |
|---|---|---|
| **Inventory & pin** | Delivery proposes; the enterprise register is the org's record | `model-manifest.json` seam + `model-provenance-check.mjs` (a floating pin fails the build) |
| **Tier** | Independent function decides; committee ratifies | Gate enforces a tier is *declared* and drives the tier's controls |
| **Eval before release** | The eval rig, thresholds, and their meaning | Gate requires a passing eval **against the shipping pin** |
| **Independent validation** | The organisationally-separate MRM function | `validated_by` field + `model-risk-reviewer` agent (② Assess challenge material) |
| **Runtime monitoring** | The org's observability platform + on-call | `change-watch` — build/event-time drift only, **not** live-model watching |
| **Govern & cease-use** | Committee, board, accountable Senior Manager | HG-0010 names the switch; the wiring is the org's |

The decisive property, mirroring the control-plane rule (`activation-runbook.md`): **the authority
that tiers, validates, monitors, and can stop the model must not be the model, nor the team that
ships it.** An agent reviewing an agent is not independence; a validation team inside the delivery
org is not independence either.

## Preconditions

- **HG-0001 / HG-0002 activated** per `activation-runbook.md`. This runbook assumes the control
  plane is real: branch protection with no bypass, CODEOWNERS on control-plane paths, and a
  least-privilege agent identity that is **not** in any approver group. Model-risk controls on an
  inert control plane are theatre — the tiering threshold you protect below is only protected if
  CODEOWNERS is actually enforced (`control-plane-check.mjs` green on a recent release).
- **HG-0006 gate wired.** `model-provenance-check.mjs` is a **required** status check on `main`,
  and `docs/governance/model-manifest.json` exists with one entry per model role.
- **A named Senior Manager (HG-0010)** accountable for the autonomous build system, under your
  accountability regime (SMCR, or the local equivalent). Model risk needs an owner before it
  needs a process. If this role is unfilled, stop and fill it — everything below reports to it.
- **A model-risk (validation) function that does not report to engineering.** If you do not have
  one, Step 1 stands it up; the rest of the runbook assumes it exists.
- Access to your production model-serving telemetry (gateway logs, token/latency/refusal metrics)
  and your observability / SIEM platform. Runtime monitoring (Step 4) has no home without it.

## 1. Stand up the independent model-risk function

The `validated_by` field and the `model-risk-reviewer` agent are hygiene. The **control** is an
organisationally-separate function that owns validation and can say no. An agent reviewing an
agent is not independence; a validation team inside the delivery org is not independence either.

1. **Establish the function outside the build/delivery line.** It reports to the CRO or the board
   risk committee, not to the engineering lead who owns the harness. Minimum viable: a named
   model-risk lead with a mandate, a budget line, and the authority to block a release. Document
   the reporting line — an org chart is the evidence.
2. **Give it the three validation activities, adapted to an agentic model:**
   - *Evaluation of conceptual soundness* — is the agent+prompt design fit for the SDLC task, and
     are its eval metrics measuring the right thing? The gate cannot judge this; see
     `../loom/references/model-risk.md`, "Honest limits — provenance, not competence."
   - *Ongoing monitoring* — owns the runtime signals in Step 4 and the drift response.
   - *Outcomes analysis* — samples the agent's shipped work and checks derivation vs. retrieval
     (complements HG-0012), reward-hacking (complements Q1b), and eval-to-production divergence.
3. **Define its independence from the `model-risk-reviewer` agent.** The agent is a *first-line
   challenge tool* the function uses; it is not the function. The function reviews the agent's
   verdicts, tunes its prompt, and owns the cases the agent misses. Record this so an examiner does
   not mistake the plugin agent for the independent function — `../loom/references/bank-grade-gap.md`
   grades that function **Named-only** (the field and the agent ship; the function is yours).
4. **Wire authority over the gate's thresholds (HG-0002).** The `ADOPT:` markers in
   `model-manifest.json` that set which tiers require an eval and a validation are a
   **control-plane file**. Add them to CODEOWNERS with the model-risk function as owner, so the
   build agent — and delivery engineers — cannot lower a threshold to get green. This is the seam
   that makes the function's authority non-bypassable rather than advisory.

**Enforcement of record:** the reporting line (org structure + CODEOWNERS on the threshold file),
not the `validated_by` string. The string is a claim; the org chart and the protected file are the
control.

## 2. Model-risk tiering governance

The gate enforces that a `risk_tier` is *declared* and consistent; it cannot enforce that the tier
is *right*. Tiering is a judgement the independent function owns and the committee ratifies.

### 2.1 Tiering criteria

Score each model role against these axes; the highest axis sets the floor.

| Axis | Low | Medium | High |
|---|---|---|---|
| Autonomy at merge | proposes, human writes | proposes + drafts, human edits | authors + self-drafts the PR |
| Blast radius | docs/tests only | app code behind a gate | control-plane-adjacent or infra |
| Reversibility | trivially revertable | revert with effort | hard to unwind / data-affecting |
| Data reached | synthetic only | internal non-personal | personal / confidential (see D-cluster) |
| Human review depth | line-by-line | spot-check | rubber-stamp risk |
| AI-Act exposure | minimal | limited-risk | high-risk system component |

Anything touching the control plane, real data, or auto-promotion is **high** by default — tier
down only with a written, committee-ratified justification.

### 2.2 Controls by tier

| Control | Low | Medium | High |
|---|---|---|---|
| Pinned model + prompt (gate) | required | required | required |
| Eval vs. shipping pin (gate) | optional | required | required |
| Challenger comparison (Step 3) | — | recommended | required |
| Independent validation `validated_by` | — | function sign-off | function sign-off + committee note |
| Runtime drift monitoring (Step 4) | sampled | dashboarded | alerted + on-call |
| Revalidation cadence | annual | semi-annual | quarterly or on material change |
| Cease-use rehearsal (Step 6) | — | tabletop | live drill |

Set the `ADOPT:` markers to match this matrix so the gate refuses a high-tier release lacking an
eval or a validation. The **matrix is the policy; the markers are its enforcement of record** —
keep them in sync and CODEOWNERS-protected (Step 1.4).

### 2.3 Tiering process

1. On any new model role, or on a material change to an existing one (new model id, new prompt
   family, expanded scope), the delivery team proposes a tier in the manifest PR.
2. The `model-risk-reviewer` agent challenges the proposed tier at ② Assess.
3. The **independent function ratifies or overrides** the tier before merge; for high-tier, the
   committee notes it (Step 5). The gate blocks merge until `validated_by` is present at the
   required tiers — but presence is not correctness; the function's sign-off is.
4. Record the tiering rationale in the model register, not just the manifest. The manifest is a
   build-time projection; the register is the record of record.

## 3. Challenger models

A champion model with no challenger has no benchmark — you cannot tell a degraded champion from a
hard task. The gate can *require* a challenger block; it cannot *run* the comparison. The rig is
yours.

1. **Nominate a challenger per high-tier role** — a different model family, a different prompt
   strategy, or a held-back prior version. Diversity is the point: a challenger from the same
   family drifts the same way.
2. **Run champion and challenger on the same eval set each release.** Record both verdicts in the
   manifest's eval block (`champion` / `challenger`, each with `evaluated_model_id`,
   `evaluated_prompt_version`, score). The anti-stale check applies to both — a challenger scored
   against last quarter's pin is not a benchmark.
3. **Define the promotion rule before the numbers land** — e.g. "challenger promotes only on a
   material, sustained margin ratified by the function," never automatically. Pre-committing the
   rule is the anti-reward-hacking discipline (Q1b's logic, applied to model selection).
4. **Keep at least one challenger cold** as a fallback champion for the incident path (Step 6): if
   the live champion must be ceased, you need a validated model to fall back to, not a scramble.

**Enforcement of record:** the eval rig producing a comparative block the gate requires, plus the
function's ratified promotion decision in the register. The manifest block is the receipt; the rig
and the decision are the control.

## 4. Ongoing runtime drift monitoring

**This is the step the harness does not cover.** `change-watch` scans for model/eval drift on a
schedule and on events — it catches *a new model version dropped* or *the eval went stale*. It does
**not** watch the live model behaving in production. Continuous runtime monitoring is a
run-the-bank control the institution builds on its own observability platform.
`../loom/references/bank-grade-gap.md` grades production drift monitoring **Named-only** for exactly
this reason.

### 4.1 Signals to instrument

| Signal | Source | Drift it catches |
|---|---|---|
| Provider version / silent update | model gateway response metadata | vendor changed the model under a pinned alias |
| Refusal / safety-stop rate | gateway logs | prompt or policy drift, capability regression |
| Output shape conformance | post-generation validators | agent producing off-spec artifacts |
| Eval-to-production divergence | replay prod samples through the eval | the eval no longer represents live behaviour |
| Gate-rejection rate for agent PRs | CI telemetry | quality regression, reward-hacking attempts |
| Token / latency / cost envelope | gateway metrics | prompt bloat, degraded reasoning, incident precursor |
| Human-override rate at merge | PR data | reviewers increasingly correcting the agent |

### 4.2 Thresholds and response

1. **Set a baseline** per high-tier role from its release eval and first weeks of production, and
   store it beside the model register.
2. **Define warn / breach thresholds** on each signal (e.g. refusal rate > baseline + N%, or
   eval-to-production divergence beyond tolerance). Warn → the function investigates; breach →
   Step 6 incident path.
3. **Pipe breaches to the model-risk function's on-call**, not to a dashboard nobody watches.
   Alerting is the enforcement of record; a Grafana panel is not a control.
4. **Detect the silent-update case explicitly.** A pinned alias that resolves to a new provider
   build is undetectable by the gate (the pin string is unchanged) — only runtime metadata
   comparison catches it. Treat a detected silent update as an automatic revalidation trigger and a
   candidate cease-use event.
5. **Feed monitoring back into `change-watch` and the register.** A runtime breach should raise a
   ① Watch horizon item and a revalidation task, closing the loop between run-the-bank telemetry
   and the build-time assurance lifecycle (`../loom/references/continuous-assurance.md`).

**Enforcement of record:** the production telemetry pipeline with alerting wired to the independent
function's on-call. The harness provides the pinned manifest that tells you *which* model to
compare against; the watching is yours.

## 5. Model committee and board oversight

Someone must own model risk above the function and answer to the board for the autonomous build
loop. The gate has no concept of a committee; this is pure operating model.

1. **Charter a model risk committee** (or extend an existing one) with authority over the build
   loop's model. Terms of reference: approve the tiering policy, ratify high-tier tiers and
   challenger promotions, review runtime drift trends, and own the AI incident post-mortems.
   Membership includes the independent function, the accountable Senior Manager (HG-0010), risk,
   and — for real-data scope — data protection.
2. **Give the committee authority over the gate's thresholds via CODEOWNERS** (Step 1.4). This is
   the seam that turns "the committee decides tiering" from a paper claim into a platform control:
   the `ADOPT:` markers change only with committee-owned review. Without this wiring, "board
   oversight" is a slide, not a control.
3. **Set a reporting line to the board risk committee** — a standing pack: model inventory by tier,
   validation status, open drift breaches, incidents, and challenger results. Quarterly for
   high-tier at minimum; on any SEV incident, immediately.
4. **Minute the decisions.** The committee's ratifications are records — seal the relevant ones into
   the evidence bundle (HG-0003, `evidence-seal-check.mjs`) so an examiner can reconstruct who
   tiered what and when. `../loom/references/bank-grade-gap.md` grades senior-manager regime /
   board oversight / RACI **Absent** (cluster F) until these minutes exist.

**Enforcement of record:** the committee's terms of reference + CODEOWNERS on the threshold file +
minuted, sealed decisions. Authority that cannot touch the gate is advisory; authority wired to
CODEOWNERS is a control.

## 6. AI incident response and cease-use (HG-0010)

`../loom/references/bank-grade-gap.md` grades the AI incident runbook **Absent**. When the agent
misbehaves — prompt-injection-driven action, a silent model swap, a reward-hacked green, a
data-boundary breach — you need a rehearsed path, not an improvisation. The switch is HG-0010; this
is the process behind it.

### 6.1 Severity model

| Severity | Trigger | Response |
|---|---|---|
| SEV-1 | Agent acted with production or real-data impact; control-plane breach | Cease-use now; incident bridge; notify Senior Manager + committee; regulator-notification clock starts |
| SEV-2 | Reward-hacked green merged; silent model update on high-tier role | Freeze the affected role; revalidate; committee review |
| SEV-3 | Runtime drift breach without merge impact; challenger anomaly | Function investigates; scheduled revalidation |

### 6.2 The cease-use path (HG-0010)

1. **Wire the kill-switch before you need it.** Cease-use = revoke the agent's service identity /
   gateway access so it can neither push nor call the model, *and* flip branch protection to block
   its identity (it already cannot merge if HG-0001 is active). The switch must be operable by the
   Senior Manager and on-call **without** the agent's cooperation — an agent that can veto its own
   cease-use is not a control.
2. **Fall back to a validated champion** — the cold challenger from Step 3.4 — or halt the loop.
   Never fall back to an unpinned or unvalidated model to keep shipping.
3. **Preserve evidence.** Seal the model manifest, prompts, gateway logs, and the offending
   artifacts (HG-0003) before remediation touches them. The provenance the gate captured is what
   makes the incident reconstructable — this is why pinning is the precondition for everything.

### 6.3 Post-incident

1. Root-cause to the model layer: which role, which pin, which drift signal should have caught it,
   why it did not.
2. Feed fixes back — a new eval case, a tightened threshold, a challenger swap, a prompt change
   (which itself re-enters the tiering and validation flow).
3. Committee post-mortem (Step 5); board notification for SEV-1/2; assess external serious-incident
   reporting duties (the EU AI Act's serious-incident duty / your local regulator) with the
   accountable Senior Manager.

**Enforcement of record:** the wired cease-use path operable without the agent, plus the on-call and
severity process. The runbook is paper; the revoke-and-halt mechanism nobody can bypass is the
control.

## Regulation mapping

| Framework | What it bears on |
|---|---|
| **SR 11-7** | Inventory, tiering, independent validation, ongoing monitoring, outcomes analysis, benchmarking — Steps 1–4 |
| **PRA SS1/23** | Model governance, independent validation, development standards, benchmarking — Steps 1, 3, 5 |
| **ISO 42001** | AI management system: leadership, planning/risk, operation — Steps 2, 5 |
| **EU AI Act** | Risk classification, human oversight, serious-incident reporting — Steps 2, 5, 6 |
| **NIST AI RMF** | Govern / Map / Measure / Manage — Steps 5, 2, 4, 6 |
| **SMCR** | Accountable Senior Manager over the autonomous build system (HG-0010) — Preconditions, Steps 5–6 |

Named, not clause-cited. Cite your own regulator's clause numbers in your ADRs, against the live
standard — never a number you have not verified.

## How it plugs into the Loom

- **Sits on** the activated control plane (HG-0001 / HG-0002 via `activation-runbook.md`) — activate
  it first, or the tiering thresholds and manifest the function protects are rewritable by the agent.
- **Anchors** `model-provenance-check.mjs` (HG-0006): the gate proves the release pinned its model +
  prompt, ran a fresh eval against the shipping pin, and carries a `validated_by`; this runbook
  supplies the tiering authority, the independent function, the runtime monitoring, and the cease-use
  behaviour those declarations stand for.
- **Consumes** the `model-risk-reviewer` (② Assess) and `change-watch` (① Watch) agents as *inputs*
  to the independent function's challenge and monitoring — never as the verdict, and never as the
  function itself.
- **Seals** its committee ratifications and incident records into the release evidence bundle via
  `evidence-seal-check.mjs` (HG-0003), so the tiering and validation trail is reconstructable.
- **Runs continuously** via the assurance lifecycle (`../loom/references/continuous-assurance.md`):
  `change-watch` raises drift as a ① Watch horizon item; the independent function owns ② Assess and
  the runtime signals; provenance seals every release. Accountability and cease-use stay human —
  agents make model risk *evidenced*, not *governed*.

## Verify — evidence, not vibes

Provenance without an operating model is a receipt for a control that does not exist. A checked box
here must be backed by an artifact an examiner can inspect.

- [ ] **Independence is structural, not nominal.** Org chart shows the model-risk function reporting
      outside the build/delivery line; the CODEOWNERS entry on the `model-manifest.json` threshold
      markers names that function — and the build agent's identity is not an owner (attempted
      threshold-lowering PR by the agent identity was **rejected**).
- [ ] **The gate cannot be talked past.** A high-tier release with a missing or stale eval, or a
      missing `validated_by`, was **attempted and blocked** by `model-provenance-check.mjs`.
- [ ] **Tiering is ratified, not self-served.** A tiering decision record exists in the model
      register with the function's sign-off (and, for high-tier, a committee note) — not merely a
      `risk_tier` string in the manifest.
- [ ] **A challenger actually ran.** The latest high-tier eval block carries both champion and
      challenger verdicts, each scored against the **shipping** pin, with a pre-committed promotion
      rule on file.
- [ ] **Runtime monitoring alerts a human.** A synthetic drift breach (e.g. injected refusal-rate
      spike or a simulated silent model swap) fired an alert to the function's on-call — not just a
      dashboard panel — and raised a `change-watch` horizon item.
- [ ] **The committee has teeth.** Terms of reference exist; the last board risk pack shows model
      inventory by tier, validation status, and open drift breaches; at least one committee
      ratification is sealed in the evidence bundle (`evidence-seal-check.mjs`, HG-0003).
- [ ] **Cease-use works without the agent.** A drill revoked the agent's identity/gateway access and
      halted the loop **without the agent's cooperation** (attempted-and-confirmed), fell back to a
      validated champion, and preserved a sealed evidence snapshot.
- [ ] **The accountable officer is real (HG-0010).** A named Senior Manager is documented as
      accountable for the autonomous build system, and appears in the incident and committee RACI.
- [ ] **Status is honest.** Each control above is recorded as an ADR per
      `../loom/references/governance.md` with a truthful state — and any control still Named-only or
      Absent says so, rather than borrowing the gate's green.

Only when every box is backed by an artifact is HG-0006 an **operating model**, not a manifest field.
The gate proves which model reasoned; this runbook proves the institution can tier, challenge, watch,
govern, and stop it — none of which the bundle can ship for you.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): **HG-0006** (the decision this
  operationalises); **HG-0001 / HG-0002** (activate first); **HG-0003** (the evidence seal that
  makes tiering and incident records reconstructable); **HG-0010** (cease-use switch + accountable
  Senior Manager).
- **Model-risk reference** (`../loom/references/model-risk.md`): the repo-side half — the
  `model-manifest.json` inventory and the `model-provenance-check.mjs` provenance gate, plus its
  own "Honest limits" (provenance, not competence).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): **cluster B**. This runbook is the
  org-side half that moves *independent model validation function* and *production drift monitoring*
  from **Named-only**, and *AI incident runbook* from **Absent**, toward enforced. Adjacent:
  cluster **C** (independent assurance — `independent-assurance-runbook.md`) and cluster **F**
  (senior-manager regime / board oversight).
- **Gates & agents this complements:** `model-provenance-check.mjs` (HG-0006) + `model-manifest.json`;
  the `model-risk-reviewer` (② Assess) and `change-watch` (① Watch) agents; `evidence-seal-check.mjs`
  (HG-0003); continuous-assurance ① / ② (`../loom/references/continuous-assurance.md`);
  `activation-runbook.md` (precondition).
- **Frameworks** (named, not clause-cited): SR 11-7; PRA SS1/23; ISO 42001; EU AI Act; NIST AI RMF;
  SMCR.
