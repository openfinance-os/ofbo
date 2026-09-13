# Governance operating model & production proof — the operating model around the loop (cluster F)

A name in an org chart is not accountability. The bundled harness fences the build loop — the agent cannot merge its own work, cannot toggle its own protection, holds no admin rights (HG-0001 / HG-0002 / HG-0004, `activation-runbook.md`) — and it seals the release evidence so the story cannot be rewritten after the fact (HG-0003, `evidence-seal-check.mjs`). That is a *governable* loop. It is **not** the operating model a regulated institution must run *around* the loop before it goes near production, because that operating model is people, reporting lines, a change board, a wired kill-switch, a supervised pilot, and a regulator's opinion — none of which a plugin can ship. This is `bank-grade-gap.md` **cluster F**, where the *named accountable officer* (HG-0010) is **Named-only** and the *senior-manager regime / board oversight / RACI*, *supervised production pilot*, *legacy / core-banking integration*, and *live regulator examination* rows are all **Absent**.

> **Why a bundle cannot enforce this.** A plugin bundle cannot appoint a Senior Manager, convene a board, run a CAB, revoke an identity, integrate your core-banking, or obtain a regulator's no-objection — those are people, reporting lines, platform mechanisms the agent cannot reach, and a supervisor's written opinion. The shipped `operating-model.json` seam and `operating-model-check.mjs` gate make the declarations and identity joins checkable; they do not make any of those facts true. The enforcement of record is always the platform mechanism, institution record or regulator filing named alongside the step.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **F · Operating model & production proof (SMR/SMCR · examination)** |
| **Primary HG decisions** | HG-0005 (promotion + rehearsed rollback), HG-0010 (cease-use switch + accountable officer) |
| **Composes with** | HG-0001 / HG-0002 / HG-0004 (the control plane this governs — activate first), HG-0006 (model-risk accountability under the same Senior Manager) |
| **Loom machinery it complements** | `activation-runbook.md` (the control plane this model governs); `evidence-seal-check.mjs` + `evidence-manifest.json` (the MI + regulator trail); `change-watch` / `risk-reviewer` agents (to instrument a pilot); continuous-assurance ⑥ Confirm & report |

## What the bundle ships vs what you build

Be ruthless about the split. Almost every load-bearing row is you.

| Concern | The bundle ships (Enforced repo-side) | You build (the institution's, org-side) |
|---|---|---|
| Accountable Senior Manager | `operating-model-check.mjs` requires one registered, non-builder accountable executive and the references that should evidence the mandate; it appoints nobody | The regulator-registered accountability (SoR / CBUAE approved individual) + the IAM binding tying the kill-switch and prod gate to that person's credential |
| Board / risk-committee oversight | The sealed evidence bundle (`evidence-seal-check.mjs`, HG-0003) + the ⑥ report as MI inputs | The committee, its terms of reference, its minuted decisions, and the standing MI pack |
| RACI / responsibilities map | The operating-model gate requires all nine activities, one accountable human per row, no build authority on controlled decisions, and IAM-binding references | The actual RACI, wired to real IAM groups and exercised by the institution |
| Change management / CAB (HG-0005, promotion) | Sealed evidence to attach to a change ticket | The CAB, the change system of record, environment segregation, and the promotion gate that refuses prod without an approved ticket |
| Rehearsed rollback (HG-0005, rollback) | Nothing — no rollback or promotion gate ships | The rollback capability, the drill, and the evidence the drill worked on the shipping release |
| Cease-use kill-switch (HG-0010) | Nothing that trips it — the HG-0010 decision, no more | The wired switch: identity revocation, pipeline halt, and the fact that only the named owner can trip it |
| Supervised production pilot | `change-watch` / `risk-reviewer` agents + sealed evidence to instrument it | The pilot itself: capped scope, dual-run, heightened supervision, second-line embedded |
| Legacy / core-banking integration | Nothing — the harness is synthetic-only by design | The anti-corruption layer, idempotency, reconciliation, and maker-checker on core writes |
| Regulator engagement / no-objection | The examinable, sealed evidence trail to support a submission | The engagement, the submission, and the regulator's written non-objection |

The single honest line, from cluster F: *the harness makes declarations legible, joined and evidence sealed; it does not make the accountability, the oversight, the pilot, or the exam **exist**.* The `operating-model.json` seam now ships and becomes mandatory for a high-tier regulated-bank plan. This runbook remains the org-side work that makes its declarations operational.

## The accountability chain, and where the harness sits

| Layer | Owns | Reports to | The bundle's contribution |
|---|---|---|---|
| **Build agent** | Proposes change; runs its reviewer agents and gates | Delivery / engineering leadership | The four-eyes fence + reviewer agents (Enforced) — **never** an approver |
| **Platform admin** | Activates and holds the control plane | Delivery / engineering leadership | `activation-runbook.md`, `control-plane-check.mjs` (HG-0001 / 0002 / 0004) |
| **Accountable SM** (HG-0010) | The loop's safe operation, controls, cease-use, evidence | The board risk committee | A structurally checked identity and mandate reference; nothing that appoints them |
| **Board / risk committee** | Oversight, scope approval, standing MI | The board | The MI inputs (sealed bundle + ⑥ report) — **never** the quorum or the minute |
| **Regulator** | Supervision, no-objection | — | The examinable trail — **never** the opinion |

The decisive property, mirroring the control-plane rule (`activation-runbook.md`): **AI proposes; humans and a protected control plane dispose.** The build agent appears in this chain only as a proposer — never as an approver, an accountable officer, or a kill-switch holder. If the agent identity sits in any approval, promotion, control-plane, or cease-use role, the control plane is not activated (return to `activation-runbook.md`).

## Preconditions

- **The control plane is already activated** per `activation-runbook.md` — HG-0001 / 0002 / 0004 verified (agent identity cannot merge, cannot toggle protection, holds no admin rights). This operating model governs a loop that is already fenced. Building governance on an un-activated control plane is theatre.
- **A recognised senior-management / approved-individual regime is in force** — SMCR, the CBUAE controlled-function regime, or equivalent. If your jurisdiction has none, cluster F cannot be closed to a bank-grade standard; document that as a limit and stop.
- **The evidence bundle is sealed** — `evidence-seal-check.mjs` (HG-0003) green — so the MI you take to the board and the trail you take to the regulator are tamper-evident, not narrated.
- **A change-management system of record exists** (a CAB, a change register) that the promotion pipeline can be made to reference. If prod changes are ungoverned today, fix that first — this runbook wires the loop *into* your change control, it does not replace it.
- **Sponsorship exists** to appoint an accountable Senior Manager. Without a real appointment, steps 1, 6, and 9 have no anchor.

## 1. Appoint and register the accountable Senior Manager (HG-0010)

The autonomous build loop authors change into a regulated SDLC. Under SMCR and the CBUAE regime, a system that can affect the safety and soundness of the institution has an **accountable Senior Manager** — a single, named human who answers for it.

1. **Name one accountable executive.** Map the loop to an existing Senior Management Function holder — typically the executive accountable for technology or operations — rather than inventing a figurehead. One person, not a committee. Accountability that is shared is accountability that is absent.
2. **Give them a specific, written responsibility** for the loop: its safe operation, its controls, its cease-use, and the evidence it produces. Under SMCR this is a line in a **Statement of Responsibilities**; under the CBUAE regime it is the approved individual's documented mandate. This is the regulator-facing artefact.
3. **Record the appointment in your governance operating model** (step 3), so change and cease-use reference a written accountability rather than folklore.
4. **Bind the identity, not just the name.** The kill-switch (step 6), the prod-promotion approval (step 4), and the pilot go/no-go (step 7) must be exercisable **only** through credentials attributed to this person or their formally-recorded deputy.

**Enforcement of record:** the **regulator-registered Statement of Responsibilities / approved-individual mandate**, plus the **platform binding** that attributes the switch and the prod gate to that credential. `operating-model-check.mjs` requires those references and resolves the identity; that is structural hygiene, not appointment. Do not describe the gate as "enforcing accountability."

## 2. Establish board / risk-committee oversight

An accountable SM reports upward. A regulated institution running an autonomous build loop owes its board and risk committee **standing, evidenced oversight** — not a one-off approval to launch.

1. **Assign the loop to a committee** — the board risk committee, or a technology / model-risk sub-committee with a reporting line to it. Record it in the committee's terms of reference.
2. **Define the standing MI pack.** Per cycle, at minimum: gate pass/fail trend, control-plane integrity status, model-provenance and drift status (HG-0006), open risk items from `risk-reviewer`, cease-use readiness, and any prod-scope changes. Source it from the **sealed evidence bundle and the ⑥ report step** so the MI is reconstructable, not slideware. This is where BCBS 239's "accurate, complete, timely, reconcilable" expectation bites.
3. **Reserve the decisions that must be the committee's:** approving the move from synthetic to non-synthetic scope (step 7), approving each expansion of the pilot's blast radius, and receiving cease-use invocations after the fact.
4. **Set a cadence and a trigger.** Scheduled review plus event-driven escalation — a cease-use event, a control-plane regression, or a failed rollback drill escalates immediately, not at the next quarterly.

**Enforcement of record:** the **committee's terms of reference and its minuted decisions**, plus **your** prod-promotion gate configured to require the committee's recorded approval for scope changes. The harness supplies the MI inputs and the audit trail; it cannot convene, quorum, or minute a board, and it ships no prod-promotion gate. That is the institution's, entirely.

## 3. Document the responsibilities map (RACI) and wire it to IAM

A RACI in a wiki is a picture of accountability. The control is the RACI **resolved to real platform identities** — every accountable role is a person, every responsible role is a group that exists in your IAM.

Baseline RACI for the loop (adapt, don't copy blindly):

| Activity | Build agent | Platform admin | Accountable SM | Risk / 2nd line | CAB | Board committee |
|---|---|---|---|---|---|---|
| Propose change (author, open PR) | **R** | I | I | I | — | — |
| Approve merge (four-eyes, HG-0001) | — | **R** | A | C | — | — |
| Activate / change control plane | — | **R** | A | C | I | I |
| Approve prod promotion (HG-0005) | — | R | **A** | C | **R** | I |
| Rehearse & sign off rollback | — | R | A | C | C | I |
| Invoke cease-use (HG-0010) | — | R | **A** | C | I | I |
| Model-risk sign-off (HG-0006) | — | I | A | **R** | — | I |
| Approve synthetic→prod scope | — | I | R | C | C | **A** |
| Oversight & MI | — | I | R | R | I | **A** |

Rules that make it a control, not a diagram:
1. **Exactly one `A` per row.** If two names share the `A`, neither is accountable.
2. **The build agent is never `A` and never `R` on any approval, promotion, control-plane, or cease-use row.** *AI proposes; humans and a protected control plane dispose.* If the agent identity appears in an approver group, the control plane is not activated (return to `activation-runbook.md`).
3. **Every `A` and approval-`R` resolves to a real IAM group.** The merge row maps to CODEOWNERS; the prod row maps to the promotion-approver group; the CAB row maps to the change-approval group.

**Enforcement of record:** the **IAM group memberships and CODEOWNERS / branch-protection configuration** — the RACI is only real to the extent the platform enforces it. The activated control plane (`activation-runbook.md`, `control-plane-check.mjs`) enforces the merge and control-plane rows; the prod, CAB, and cease-use rows resolve to IAM groups you own. `operating-model-check.mjs` now checks the complete RACI and its declared IAM joins, not the live groups.

*The shipped operating-model seam.* `docs/governance/operating-model.json` records the accountable SM, oversight committee, kill-switch owner, nine-activity RACI, four protected IAM bindings, change-management linkage and independent re-performance route. `operating-model-check.mjs` is mandatory-when-compiled through the high-tier regulated-bank profile.

> **Honest limit.** The gate checks *declarations* and identity joins. A green result proves the record is populated and internally consistent; it proves nothing about whether the named person is competent, present, appointed or exercising the responsibility. It never means "governance enforced." That evidence lives in regulator filings, committee minutes and independently observed IAM bindings.

## 4. Integrate change management and the CAB (HG-0005, promotion half)

HG-0005 is *promotion + rehearsed rollback*. `bank-grade-gap.md` grades it Named-only: the decision is right, the enforcement is the adopter's. This step wires the promotion half into your change control.

1. **Segregate environments.** dev → staging → prod, with the agent identity scoped to dev / feature only (per HG-0004). Prod credentials are never in the agent's reach.
2. **Make a change ticket the entry condition for prod.** The promotion pipeline must refuse a prod deploy unless it carries a reference to an **approved change record** in your CAB / change system of record. No ticket, no promotion — enforced by the pipeline, not by policy.
3. **Route standard vs. non-standard changes correctly.** Pre-authorised, low-risk, reversible changes may follow a standard-change path with the accountable SM's standing delegation; anything touching prod scope, core-banking, or the control plane is a normal change requiring CAB review. Do not let "standard change" become a bypass.
4. **Attach the sealed evidence bundle to the ticket.** The CAB reviews evidence-by-construction (gate results, model provenance, data-lifecycle dispositions), not a hand-written summary. This is where the loop earns its keep: the change record is pre-populated with tamper-evident evidence.
5. **Record the change-ticket linkage in your operating model.** The gate checks that the system and promotion mechanism are named and that production tickets are required. Ticket status and freshness remain the deployment pipeline's evidence.

**Enforcement of record:** the **change-management system of record + the promotion gate that will not deploy to prod without a live, approved ticket linked to it.** The harness contributes the sealed evidence to attach; it ships no promotion gate, does not run your CAB, holds no prod credentials, and performs no deploy. DORA's change-management expectations and your prod-change control are the institution's.

## 5. Rehearse rollback and prove it (HG-0005, rollback half)

The second half of HG-0005 is the one demos skip. A rollback that has never been exercised on the shipping release is a hope, not a control.

1. **Define the rollback for the change class** — redeploy previous artefact, feature-flag kill, data-migration reverse or compensating transaction. A forward-only change (an irreversible migration) needs an explicit compensating plan or it does not promote.
2. **Rehearse it in staging against the actual release candidate**, not a stand-in. Record RTO / RPO achieved against target.
3. **Capture the rehearsal as evidence**: timestamp, release identifier, operator, outcome, RTO / RPO. Seal it into the evidence bundle.
4. **Set a freshness window.** A rollback rehearsed against a *different* release than the one shipping is stale — your promotion gate should treat a missing or stale rehearsal timestamp as a fail, the same anti-stale logic `model-provenance-check.mjs` applies to evals (`../loom/references/model-risk.md`). For rollback, that gate is **yours to build; none ships.**

**Enforcement of record:** the **rehearsed rollback capability and its dated evidence**, plus the **promotion gate that blocks release if the rehearsal is absent or stale.** The bundle ships **no rollback or freshness gate**; the rollback mechanism, the drill, and the staging environment that makes the drill meaningful are the institution's. A gate proving a timestamp exists would not prove the rollback works — only the rehearsal does, and only the adopter can run it.

## 6. Wire the cease-use kill-switch and its owner (HG-0010)

HG-0010 pairs a **mandatory cease-use capability** with a **named accountable officer**. Step 1 named the officer; this step wires the switch so the name means something.

1. **Define what cease-use halts:** the agent identity's ability to author and open PRs, the promotion pipeline, and any autonomous action against the loop's scope. Decide graceful (drain then stop) or hard (immediate freeze) per scope — a prod-affecting loop needs a hard stop available.
2. **Implement it as a platform mechanism, not a Slack message.** Options: revoke / disable the agent service identity in IAM, flip a global pipeline pause the agent cannot un-flip, or pull a feature flag outside the agent's write scope. It must be **outside the agent's reach** — the same immutability property as the control plane (HG-0002).
3. **Restrict who can trip it** to the accountable SM (step 1) and formally-recorded deputies. Log every invocation to the audit trail with actor, time, reason, and scope.
4. **Rehearse it.** An untested switch is `activation-runbook.md`'s live incident in a new costume — *configured but not activated.* Trip it in a controlled window; confirm the agent identity is genuinely inert; confirm restoration is itself a controlled, approved action.
5. **Record the owner in your operating model** so the gate can reconcile cease-use ownership with the accountable executive and RACI. The live credential binding remains an observed platform control.

**Enforcement of record:** the **IAM / pipeline mechanism that halts the loop and can only be tripped by the named owner's credential** — plus the audit log of invocations. The bundle ships **no gate** here; it cannot revoke your agent's identity or pause your pipeline. The switch is the platform's, the accountability is the regulator's filing, and the rehearsal is the adopter's discipline. Never call HG-0010 "enforced by the harness" — the harness enforces none of it.

## 7. Run a supervised production pilot on non-synthetic scope

`bank-grade-gap.md` grades this **Absent** and is blunt about why: the Loom is proven on synthetic data in one greenfield domain, permanently non-production. Moving to real scope is a program, not a gate — and it is where every prior step is finally load-bearing.

1. **Board approves the move** from synthetic to non-synthetic scope (step 2). This is the single most consequential decision in cluster F; it is a human committee decision, never an automated pass.
2. **Cap the blast radius.** Start with a bounded, reversible, low-materiality slice — read-only or non-customer-impacting first, tight feature-flag scope, a hard ceiling on volume / value. Expand only on evidence and only with recorded approval.
3. **Dual-run / shadow first where feasible.** The loop's output runs alongside the incumbent process, with humans comparing, before it runs *instead of* it. Real-scope confidence is earned by comparison, not asserted.
4. **Embed the second line.** Risk and compliance observe the pilot directly — not a post-hoc report. The organisationally-independent 2nd-line function is graded **Absent** in cluster C (`independent-assurance-runbook.md`); if you do not have one, the pilot is self-supervised, which is not supervision. Say so.
5. **Arm the kill-switch (step 6) and staff its owner** for the pilot's duration. Cease-use readiness is a precondition of go-live, verified, not assumed.
6. **Instrument with the harness.** `change-watch` (① Watch) and `risk-reviewer` (② Assess) run continuously; every cycle seals evidence. The evidence bundle is your pilot's flight recorder and your later regulator submission's spine.
7. **Define exit criteria up front** — the conditions under which the pilot expands, holds, or is ceased. Ambiguous exit criteria turn a pilot into permanent unsupervised production.

**Enforcement of record:** the **pilot governance charter, the capped-scope configuration in the platform (feature flags, volume / value ceilings), and the second-line sign-offs.** The harness instruments and evidences the pilot; it cannot *be* the pilot, cap your scope, or supply your independent second line. This is run-the-bank work a build-time frame was never scoped to do.

## 8. Address legacy / core-banking integration

Graded **Absent**, and named as "the integration cost the demo never paid." The harness is synthetic-only by design; the moment the loop touches core-banking, a control surface the bundle does not model appears.

1. **Mediate core access through an anti-corruption layer.** The loop never writes core-banking directly; it goes through an integration boundary the bank already governs — with the bank's existing segregation, not the harness's.
2. **Require idempotency and reconciliation** on every core-affecting operation. Autonomous authorship raises the cost of a non-idempotent retry; reconciliation is the safety net the demo never needed.
3. **Preserve maker-checker on core writes.** Where the core-banking platform enforces dual control, the loop is a *maker* at most — the checker is a human, mediated by the core's own controls, not the harness's four-eyes.
4. **Treat core credentials as out of agent scope, permanently.** They live in the bank's vault, exercised by the integration boundary, never by the agent identity.

**Enforcement of record:** the **bank's existing core-banking access controls — segregation, maker-checker, reconciliation — applied to the loop's integration boundary.** The harness contributes nothing here and should claim nothing. This is the adopter's core-banking control estate, and the loop is a constrained client of it.

## 9. Regulator engagement and no-objection

Graded **Absent** — "the proof the method has not yet earned." No bundle produces a regulator's non-objection; you engage, you submit, they decide.

1. **Engage early and in writing.** Brief your supervisor (CBUAE, PRA, or equivalent) on the autonomous build loop, its accountability (step 1), its controls, and its cease-use — before the pilot, not after an incident.
2. **Lead with the examinable trail.** The sealed evidence bundle (`evidence-seal-check.mjs`, HG-0003), the control-plane integrity gate (`control-plane-check.mjs`, HG-0002), the model provenance (`model-provenance-check.mjs`, HG-0006), and this operating model give the supervisor something reconstructable to examine rather than narrated. This is the concrete value of evidence-by-construction at exam time.
3. **Seek explicit non-objection for the pilot's scope**, where your regime expects it. A supervisory notification or written no-objection is the artefact; treat proceeding without it, where it is expected, as an unclosed control.
4. **Feed exam findings back into the operating model** — new prescribed responsibilities, new MI, new gate conditions. Regulator engagement is a cycle, like continuous assurance, not a launch milestone.

**Enforcement of record:** the **regulator's written non-objection / supervisory position** — a document only the regulator can issue. The harness's contribution is the examinable evidence that supports the submission. Until a live examination has happened, this row stays honestly Absent; do not represent an internal readiness review as a regulator exam.

## Regulation mapping

| Framework | What it bears on |
|---|---|
| **SMCR** | The single accountable Senior Manager over the loop and its Statement of Responsibilities |
| **CBUAE senior-manager / controlled-function + Corporate Governance regime** | The approved-individual accountability and board oversight (UAE) |
| **DORA** | Change-management and operational-resilience expectations on promotion and rollback |
| **SR 11-7 / PRA SS1/23 / EU AI Act / ISO 42001** | Model accountability sitting under the accountable SM (HG-0006) |
| **BCBS 239** | Accurate, complete, timely, reconcilable risk MI to the board |

Named, not clause-cited. Cite your own regulator's clause numbers in your ADRs.

## How it plugs into the Loom

- **Sits on** the activated control plane (HG-0001 / HG-0002 / HG-0004 via `activation-runbook.md`) — activate it first, or the operating model governs a loop the agent can still rewrite.
- **Consumes** the sealed evidence bundle (`evidence-seal-check.mjs`, HG-0003) as the MI the board reads and the trail the regulator examines — reconstructable, not narrated.
- **Instruments** a supervised pilot with `change-watch` (① Watch) and `risk-reviewer` (② Assess); every cycle seals evidence into the bundle.
- **Runs continuously** via the assurance lifecycle (`../loom/references/continuous-assurance.md`) ⑥ Confirm & report — the four-eyes (HG-0001) and MI stay human. Agents make the operating model's *evidence* evidence-by-construction, never its *accountability*.
- **Ships a structural operating-model gate.** It validates the declaration and joins it to identities; every load-bearing organisational fact remains the institution's to establish and evidence.

## Verify — evidence, not vibes

Cluster F is where "we have a policy" is most tempting and least sufficient. Every box below demands an artefact, an attribution, or an attempted-and-rejected test — not a document that merely asserts the control.

**Accountability (steps 1–3, HG-0010)**
- [ ] The accountable Senior Manager is a **single named individual** with a **regulator-registered** Statement of Responsibilities / approved-individual mandate covering the loop — produce the filing, not a slide.
- [ ] The kill-switch and prod-promotion approval are **attributed to that person's credential** in IAM — demonstrated, not asserted.
- [ ] The RACI has **exactly one `A` per row**, and the **build agent appears in no approval, promotion, control-plane, or cease-use cell** — checked against the actual CODEOWNERS and approver groups.
- [ ] `operating-model-check.mjs` is green, and the report states in one sentence that green means "roles are declared and resolve," not "governance is enforced."

**Change & rollback (steps 4–5, HG-0005)**
- [ ] A prod deploy **attempted without a linked, approved change ticket is rejected by the pipeline** (attempted-and-rejected).
- [ ] A prod deploy **attempted with a stale / closed ticket is rejected** — freshness, not mere presence.
- [ ] A rollback has been **rehearsed against the actual shipping release candidate**, with dated evidence and RTO / RPO recorded, sealed into the bundle.
- [ ] Your promotion gate **blocks release when the rehearsal timestamp is absent or stale** (attempted-and-rejected) — remembering the harness ships no such gate; you built it.

**Cease-use (step 6, HG-0010)**
- [ ] The kill-switch has been **tripped in a controlled rehearsal**, and the agent identity was verified **genuinely inert** afterward — not "we believe it would stop."
- [ ] Only the **named owner (and recorded deputies)** can trip it; an attempt by any other identity is **rejected and logged** (attempted-and-rejected).
- [ ] Restoration is itself a **controlled, approved action**, evidenced in the audit trail.

**Oversight (step 2)**
- [ ] The oversight committee's **terms of reference name the loop**, and there is a **minuted decision** approving its current scope.
- [ ] The standing MI pack is **sourced from the sealed evidence bundle** (reconstructable), and the last pack maps to a real, sealed bundle.

**Production proof (steps 7–9)**
- [ ] The move to non-synthetic scope carries a **board / committee approval on record** — a human decision, not an automated pass.
- [ ] The pilot runs with **capped blast radius** (feature-flag / volume / value ceilings) demonstrable in config, the **kill-switch armed and owned**, and the **second line embedded** — or the absence of an independent second line is documented as a limit.
- [ ] Core-banking access, if in scope, is **mediated through the bank's existing segregation / maker-checker / reconciliation** — the agent holds **no core credentials** (attempted-and-rejected: agent cannot reach core directly).
- [ ] Regulator engagement is **evidenced in writing**, and any required **non-objection for the pilot scope is obtained** — or its absence is recorded as an unclosed control.

Only when every box holds an artefact is cluster F **closed for the pilot's scope** — and even then, honestly: closed for *that* scope, on *that* release, under *that* supervision. Record the result as an ADR per `../loom/references/governance.md`, keep the status honest, and re-run this verification on every scope expansion. The operating model is a control that must stay activated, not a milestone you pass once.

## Cross-references

- **HG catalog** (`../loom/references/governance.md`): **HG-0005** (promotion + rehearsed rollback — the decision this operationalises); **HG-0010** (cease-use switch + accountable officer); **HG-0001** (four-eyes merge — the approver group this operating model sits above, activate first); **HG-0006** (model-risk accountability under the same Senior Manager).
- **Bank-grade gap** (`../loom/references/bank-grade-gap.md`): **cluster F**. This runbook is the org-side work behind the *senior-manager regime / board oversight / RACI*, *supervised production pilot*, *legacy / core-banking integration*, and *live regulator examination* rows — all **Absent** — and the *named accountable officer* (HG-0010) **Named-only** row. None of it flips to Enforced from inside the plugin.
- **Gates & agents this complements:** `operating-model-check.mjs`; `activation-runbook.md` (activate first); `evidence-seal-check.mjs` (HG-0003) + `evidence-manifest.json`; `control-plane-check.mjs` (HG-0002); `model-provenance-check.mjs` (HG-0006); `change-watch` / `risk-reviewer` (① Watch / ② Assess); continuous-assurance ⑥ (`../loom/references/continuous-assurance.md`); the sibling `independent-assurance-runbook.md` (the 2nd / 3rd lines this pilot embeds).
- **Frameworks** (named, not clause-cited): SMCR; CBUAE senior-manager / controlled-function + Corporate Governance; DORA; SR 11-7 / PRA SS1/23 / EU AI Act / ISO 42001; BCBS 239.
