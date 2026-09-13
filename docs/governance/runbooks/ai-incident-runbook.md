# AI incident runbook — a deployed model goes wrong (cluster B)

`../loom/references/bank-grade-gap.md` grades the AI incident runbook **Absent**. This file is the
process behind that row: what happens when a model whose **output reaches a customer** produces a
wrong, unstable, or non-conforming outcome — it decides, prices, screens, classifies or explains,
and it was wrong. It is the sibling of `model-risk-operating-model-runbook.md` §6, which covers the
other case: the **build agent** misbehaving inside the SDLC. Same switch discipline, different blast
radius. Read §6 first if the incident is an agent that merged something it should not have.

> **Why a bundle cannot detect an incident.** THE HARNESS HOLDS NO INCIDENT DETECTION. It reads
> JSON records: a manifest that *declares* which metrics are monitored, a log that *records* a
> signal someone else wrote, a purification record that *states* an amount left. Nothing in this
> bundle watches a live model, evaluates a production output, pages a human, or moves money. The
> monitoring, alerting, on-call and screening that produce these records are the institution's
> runtime. A period with no incident record is **uncovered here, not clean**.

## Where this sits

| | |
|---|---|
| **Bank-grade-gap cluster** | **B · Model risk & AI governance** (the *AI incident runbook* row) |
| **Primary HG decisions** | HG-0010 (cease-use + accountable Senior Manager), HG-0006 (the agent/model is governed) |
| **Composes with** | HG-0001 / HG-0002 (the control plane — activate first), HG-0003 (the evidence seal that makes the incident reconstructable) |
| **Loom machinery it complements** | `model-manifest.json` `runtime.{monitoring,suspension,fallback}` + `model-provenance-check.mjs`; `operations-signal-check.mjs` (the log); `purification-check.mjs` (the money); `assurance-cycle-check.mjs` (⑥ Confirm); `evidence-seal-check.mjs` |

**Notation.** Every step below is tagged **[mechanical]** — a bundled gate checks a record in this
repository and fails the build if it is missing or malformed — or **[organisational]** — people,
runtime, reporting lines, money; nothing here enforces it and this runbook does not pretend
otherwise. A step tagged mechanical still only proves the *record*; it never proves the world.

## 1. Detection — the sources are the manifest's own metrics

The detection surface is not invented during the incident. It is the list each model already
declares in `docs/governance/model-manifest.json` under `runtime.monitoring` — decision-vs-outcome
drift, override rate, input-distribution shift, latency, and whatever else the role's tier demands.

1. **Every high-tier role declares a runtime block.** A tier that requires runtime governance and
   omits monitoring, a suspension threshold, or a fallback fails the build. — **[mechanical]**
   (`model-provenance-check.mjs`)
2. **Each declared metric is wired to a threshold, an alert, and a named recipient.** A metric on a
   dashboard nobody is paged by is a declaration, not a detector; the gate cannot tell the two
   apart. — **[organisational]**
3. **The fallback fails closed into a human queue.** For a model whose output carries domain or
   compliance significance, "on outage, let it through" books an outcome no determination ever
   produced. Queue for human review; never auto-approve. The manifest carries this as a
   declaration — **[mechanical]**; that the running system behaves that way — **[organisational]**.
4. **Detection opens an operations signal.** One entry in `docs/governance/operations-signal.json`,
   typed (`incident`, `drift`, `risk-materialised`, or `shariah-non-compliance`), severity-graded,
   routed, and traceable. `high`/`critical` need an `evidence_ref`; `caused_by_change` must resolve
   to a governed change if present. — **[mechanical]** (`operations-signal-check.mjs`)

## 2. Declare and classify

Use the severity model in `model-risk-operating-model-runbook.md` §6.1 — one taxonomy, not two.
Two extra questions decide this runbook's path, and both are asked at declaration time:

- **Did an output reach a customer?** If yes, section 4 applies and its clock has already started.
- **Does the harm have a domain dimension?** That is: did the wrong outcome *generate income* the
  institution is not entitled to keep — a charge raised on a non-conforming basis, a receipt from a
  transaction later found non-conformant. If yes, section 6 applies and the amount is never booked.

Both answers are recorded in the signal. — **[mechanical]** (the fields), **[organisational]** (the
judgement behind them).

## 3. Suspension — who holds the switch

The manifest's `runtime.suspension` states the threshold that suspends the model **and who holds the
switch**. The convention the template carries is that the **model-risk function** holds it — not the
delivery team that ships the model, not the business that benefits from it, and never the model.

1. **Trip it on the declared threshold, not on a debate.** The threshold is pre-committed precisely
   so that suspension is not renegotiated while it is costing money. — **[organisational]**
2. **Fall back per the manifest** — the human queue or a validated champion. Never fall back to an
   unpinned or unvalidated model to keep the service up. — **[organisational]**
3. **The switch is operable without the delivery team's cooperation.** A suspension that requires a
   deploy by the team whose model is suspended is not a control. — **[organisational]**
4. **Restoration is an approved act, not a rollback.** It needs a fresh eval against the *shipping*
   pin and the independent validator's sign-off; the gate fails a release whose eval was run against
   a different pin. — **[mechanical]** (`model-provenance-check.mjs`)
5. **Preserve evidence before remediation touches it** — manifest, prompts, decision log, gateway
   logs, the offending artifacts — and seal them. — **[mechanical]** (`evidence-seal-check.mjs`,
   `decision-log-check.mjs`) for the trail; **[organisational]** for the runtime logs it cannot see.

## 4. Customer notification

A model that decided wrongly about a person owes that person a statement. The duty, its wording and
its clock are set by the market's consumer-protection and data-protection law, which live in the
jurisdiction profile's disclosure sections — **not in this runbook and not in the agent's memory**
(see `../loom/references/jurisdiction-scale-out.md`).

1. **Identify the affected population from the runtime, not from the model card.** Who was decided
   about, over what window, on which pin. — **[organisational]**
2. **Say what was wrong, what is being done, and what redress applies.** Where the wrong output fed
   a disclosure the customer relied on, the correction is itself a disclosure and takes the same
   review path as the original (PA2 mandated-disclosure section). — **[organisational]**; the
   *approved section* it must conform to is **[mechanical]** in the compiled plan.
3. **Notify the supervisor where the regime requires it, on the regime's clock.** The harness
   carries no clock and no regulator's address. — **[organisational]**
4. **File the notification as the signal's `evidence_ref`.** — **[mechanical]**

## 5. Remediation

1. **Root-cause to the model layer**: which role, which pin, which declared metric should have
   caught it and why it did not. A metric that could never have caught this class of failure is the
   finding. — **[organisational]**
2. **Feed the fix back as a governed change**: a new eval case, a tightened threshold, a prompt
   change (which re-enters tiering and validation), a guardrail. — **[organisational]** for the
   content; **[mechanical]** for the lane — an incident fix touching governed paths cannot take the
   routine lane, and a plan that is not recompiled fails `change-envelope-check.mjs`.
3. **Where the root cause is a data-contract gap rather than a bug**, record it in the data-risk
   register with its compensating control instead of papering over it in code. — **[mechanical]**
   (the register is a gated seam), **[organisational]** (the row's content).

## 6. Purification — where the harm has a domain dimension

Not every incident produces money. Where it does — income arising from a non-conforming outcome —
the amount is **quantified, approved, and given away. It is never booked as income**, never a
provision, and never netted off the cost of remediation. In an Islamic-finance instance this is
purification of non-permissible income; the same shape applies wherever a domain forbids retaining
a receipt (late-payment charges on a structure-conformant facility are the standing example).

1. **Route the signal to `purification` with a `PUR-*` link.** For a `shariah-non-compliance`
   signal the route options are exactly `purification`, `issc-escalation` or `register`; `accepted`
   is refused, because waiving a breach of this kind is the accountable body's decision recorded in
   a case with names on it, never a triager's justification field. — **[mechanical]**
   (`operations-signal-check.mjs`)
2. **Write the record** under `docs/governance/purification/<PUR-id>.json`: bound to the signal, a
   positive amount with a currency, `computed_by` (an agent may compute — it is arithmetic over
   transactions), `approved_by` (a **non-agent** holding `shariah-compliance` or
   `shariah-committee`), a `method_ref` that exists on disk and cites the approved PA2
   purification method, and disposal evidence dated at or after the breach was opened. —
   **[mechanical]** (`purification-check.mjs`)
3. **The determination itself is the body's.** Whether the income is non-permissible, what method
   quantifies it, and where it goes are rulings. **No gate here rules on permissibility — scholars
   decide; the harness records that they did.** — **[organisational]**
4. **The money actually leaving is not observable from this repository.** The gate proves a complete,
   bound, approved record exists. It never proves a transfer happened. — **[organisational]**

This section is **dormant for adopters it does not apply to**: where no compiled plan requires the
relevant domain capability, `purification-check.mjs` is inert and nothing in it can fail a build.

## 7. Confirm at cadence, and close the loop

1. **The incident and its records are confirmed in the next assurance cycle** — ⑥ Confirm, signed by
   an authenticated human with second-line authority. Where the institution runs a domain assurance
   stream, that stream's `confirm_roles` role-lock the confirmation to the accountable body. —
   **[mechanical]** (`assurance-cycle-check.mjs`)
2. **The signal routes back into Discovery** where the fix is a problem rather than a patch — that
   is what the `discovery` route is for, and it is how an incident becomes evidence rather than a
   memory. — **[mechanical]** (the routed link resolves), **[organisational]** (deciding it should).
3. **Post-mortem, committee, board.** `model-risk-operating-model-runbook.md` §6.3 owns this and it
   is not repeated here. — **[organisational]**

## Honest limits

- **No detection ships.** Every mechanical step above validates a record after the fact. The alert
  that fires, the screening that flags a non-conforming transaction, the switch that is thrown —
  all runtime, all the institution's.
- **Declaration is not behaviour.** `runtime.monitoring`, `runtime.suspension` and `runtime.fallback`
  are strings in a manifest. The gate proves they were written, never that they were honoured.
- **Silence is not health.** An empty operations log after launch is itself a finding precisely
  because the harness cannot distinguish "nothing happened" from "nothing was sensed".
- **No domain determination is made anywhere in this runbook.** Sections 2 and 6 route harm to the
  people entitled to rule on it. That routing is the control; the ruling is not the harness's.

## Cross-references

- `model-risk-operating-model-runbook.md` — §6 (build-agent cease-use, the severity taxonomy, the
  post-incident loop); §2–§5 (tiering, challengers, monitoring, committee).
- `governance-and-accountability-runbook.md` — HG-0010, the named Senior Manager, the cease-use drill.
- `security-testing-and-resilience-runbook.md` — §4, the SEV pipeline and major-incident reporting
  the notification duty in section 4 plugs into.
- `../loom/references/continuous-assurance.md` — the six-step cycle and domain streams (step 7).
- `../loom/references/jurisdiction-scale-out.md` — where the market's notification and disclosure
  vocabulary lives, and why it is data rather than code.
- `../loom/references/model-risk.md` — the repo-side half: the manifest seam and the provenance gate.
