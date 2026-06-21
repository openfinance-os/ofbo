# OFBO — Demo Script (presenter golden path)

A ~10-minute walkthrough that shows the **depth** of the Open Finance Back Office without any
real integration — everything runs on synthetic data. The story arc: **regulated, four-eyes-
gated, separation-of-duties, fully audited + lineage-tracked** — not a CRUD app.

The spine of the demo is **one incident, `INC-2026-0042`**, traced across every console: an
unauthorised payment that surfaces in Customer Care, Finance, Risk, Approvals, and Ops as **one
linked thread** — not five unrelated rows. Lead with it; everything else is supporting depth.

---

## 0. Setup

### Option A — hosted demo (zero setup, recommended)

Open the live portal: **https://ofbo-portal.michartmann.workers.dev** (auto-deployed on every
merge to `main`, smoke-gated). Sign in with any persona on the picker.

> **Warm it up ~60s before you present.** The DB is Supabase free-tier (Mumbai, nearest region
> to the UAE) and can auto-pause; a `*/5` cron now keeps it warm, but if the demo has been idle,
> prime all three surfaces so the first click is instant:
> ```bash
> curl -s https://ofbo-portal.michartmann.workers.dev/ -o /dev/null
> curl -s https://ofbo-bff.michartmann.workers.dev/back-office/health -o /dev/null
> curl -s https://nebras-sim-production.up.railway.app/health -o /dev/null
> ```
> Warm interaction latency is ~3s/screen (Cloudflare edge → Mumbai origin — physics, not a bug);
> cold is worse, so warm first.

### Option B — local stack

```bash
# REQUIRED: point at a Postgres. WITHOUT DATABASE_URL the BFF silently falls back to in-memory
# stores and every console shows EMPTY — none of the seeded depth below appears. See repo .env.
export DATABASE_URL=postgres://…            # local Postgres or the Supabase session pooler

pnpm db:reset && pnpm db:seed:demo          # rich "operating back office" — see below
.claude/skills/run-ofbo/smoke.sh --keep     # launches the Nebras sim + BFF, leaves them running
(cd apps/portal && pnpm build && PORT=3000 BFF_URL=http://localhost:8787 pnpm start &)
```

Open **http://localhost:3000**.

Every screen carries the persistent **DEMO banner** (a regulatory hard-stop: synthetic data
only, zero real PSU data). `pnpm db:seed:demo` stages a 30-day reconciliation history, **a dozen
breaks** (~7 flagged), **13 risk signals** across all types, **4 pending four-eyes approvals**,
7 disputes (incl. a cross-scheme one), plus Nebras service-desk cases and fraud incidents — and
the **`INC-2026-0042`** thread woven through Care/Finance/Risk/Approvals/Ops.

**Switching persona:** use **Switch persona** in the top bar (returns to the picker), then pick
the next role. The sidebar visibly changes to that persona's scope — that *is* the separation-of-
duties control, enforced again at the BFF.

The opening line: *"This is a bank-neutral back office for UAE Open Finance — the LFI and
TPP-of-record roles in one regulated console. Watch the guardrails, not the CRUD. And watch one
incident, `INC-2026-0042`, move across every screen."*

---

## 1. Customer Care — the incident begins  *(persona: Customer Care Agent)*

Sign in as **Customer Care Agent** → **Customer Care**.

1. **PSU Identity Lookup** — search `cust-0001`. The profile resolves with its **consent
   inventory** (TPP consents across Consumed/Suspended/Revoked states) and the **24-month event
   history**.
   - *Point out:* **no PSU PII** — only the internal id, scopes, and synthetic fintech names.
     The whole audit trail is PII-redacted at emission.
2. **The incident dispute** — `cust-0001` has an **in-progress `unauthorised_payment` dispute**
   (`INC-2026-0042`), an unauthorised payment via *Fictional Fintech 01*. Open it. Note the copy:
   *"Refund initiation is four-eyes-gated downstream"* — Care **cannot** refund alone.
3. **Admin-revoke** a Suspended consent (reason `TPP_REQUEST`). It propagates to the **Nebras
   Consent Manager via the P6 egress port** and records the **sub-5s acknowledgment** (the scheme
   SLA). One High-class audit row is written.

*Hold the thread:* "Remember `INC-2026-0042` — we'll see this same payment in Finance, Risk,
Approvals, and Ops."

---

## 2. Four-Eyes Approval — the load-bearing control  *(switch persona)*

Four approvals are **already pending**, each seeded so a *different* persona is the approver than
the initiator — including the **`INC-2026-0042` refund**.

- As **Customer Care Agent** → **Approvals**: the **PENDING `disputes.refund` for INC-2026-0042**
  shows dual **Initiator / Approver** cards (the initiator is a *colleague*, so you can action
  it). Click **Approve** → the refund executes only now, by a second principal. *The control:* an
  initiator is always **locked out of approving their own** request — even super-admin (enforced
  at the BFF, not just the UI).
- Switch to **Finance Analyst** → **Approvals**: a pending **invoice run** to approve.
- Switch to **Compliance Officer** → **Approvals**: a pending **CBUAE report** to approve.

*The point:* every consequential action returns `202 + approval_request` and **never executes
inline** — it waits for a second set of eyes.

---

## 3. Separation of duties — the scope matrix is load-bearing  *(persona: Finance Analyst)*

As **Finance Analyst**, look at the sidebar: **Finance, Analytics, TPP Billing** — but **no Risk,
no Customer Care**. Try navigating to `/risk` directly → you're **bounced to the dashboard**.
Customer Care ≠ Finance ≠ Risk scopes; granting beyond the matrix is an automatic review failure.
(Same enforcement at the BFF, not just the UI.)

---

## 4. Reconciliation — the same payment, now a break  *(persona: Finance Analyst)*

**Finance** → Reconciliation Console.

- The **KPI row**: Total Lines / Matched (green) / Unmatched (red) / Disputed (amber), with a
  **30-day run history** behind the SLO dashboard.
- The **Break Queue**: a dozen breaks across the lifecycle, each showing the **three source refs**
  (A = Nebras billing, B = the bank's metering-of-record, C = fintech billing), variance, line
  type, and SLA clock. **One break carries the `INC-2026-0042` refs** — *"this is the same
  unauthorised payment the dispute is about, seen from the money side."*
- **Claim** a flagged break → it moves to *assigned* with your name + an SLA clock. **Resolve** it
  (outcome + a ≥20-char note). Open the **Investigation Detail** for the side-by-side three-source
  diff and the one-click **escalate-to-Nebras**.

---

## 5. Risk — the same payment, now a signal  *(persona: Risk Analyst)*

**Risk** view. **13 signals** across every type: consent anomalies, TPP behaviour (3σ), CoP
mismatch, Nebras liability approaching, agent anomaly, **predictive liability forecast**, and a
missed-LFI-report-cadence signal. **One `tpp_behaviour` signal is the `INC-2026-0042` thread** —
the unauthorised-payment pattern flagged for *Fictional Fintech 01*.

- The **predictive liability forecast** is a **regulated AI artefact** — open
  `docs/model-cards/predictive-liability-forecast.md`: deterministic + explainable, with drift
  monitoring and a recertification fallback to the deterministic monitor. *"AI for advance
  warning, never an automated control."*
- Triage a signal (acknowledge → investigate → close) — every transition is audited.

---

## 6. Ops + lineage — one incident, end to end  *(persona: super-admin to show everything)*

- **The thread closes in Ops:** the **Nebras service-desk case** for `INC-2026-0042` links the
  recon break, the PSU dispute, *and* the risk signal — and a **fraud incident** reported to the
  Nebras helpdesk has the customer's payments paused. *"One unauthorised payment — Care saw a
  dispute, Finance saw a break, Risk saw a signal, Ops raised a service-desk case and a fraud
  report, and the refund needed two sets of eyes. One incident, five consoles, fully linked."*
- **Cross-scheme double-compensation:** a separate seeded dispute is marked settled in the other
  scheme (Aani). Attempting `initiate-refund` on it returns **409** — the bank can't pay the same
  direct loss twice across schemes.
- **BCBS 239 lineage:** `GET /back-office/lineage/risk_signal` (Compliance) returns the
  column-level lineage tree — every regulated write is traceable end-to-end. The **Q4.5 gate** in
  CI fails the build if any table with rows lacks lineage.

---

## 7. Trigger a break, live  *(the "trigger breaks + signals on demand" requirement)*

**The reliable lever — `demo:break`.** It runs the real three-way reconciliation engine against
the demo DB with injected variance, producing a **genuinely new flagged break** in the queue
every time. Run it, then refresh the Reconciliation Console:

```bash
pnpm demo:break            # new flagged break appears in the queue on the next refresh
```

**Secondary — Nebras simulator fault injection.** The sim emulates the Hub with injectable
faults. These perturb the upstream Nebras surfaces; they surface in the back office via the
scheduled ingestion/reconciliation pass rather than instantly, so prefer `demo:break` for an
on-stage cause→effect moment.

```bash
pnpm demo:fault fee-variance 2026-05 999   # +999 fil fee variance into the period's TPP report
pnpm demo:fault revoke-delay 7000          # push a consent revoke past its 5s SLA (recorded in audit)
pnpm demo:fault rate-limit 3               # 429 the next 3 report polls → exercises back-off
pnpm demo:fault clear                      # remove all injected faults
```

> `demo:fault` reads `SIM_URL` + `SIM_ADMIN_TOKEN` from the repo `.env`. Without them it targets
> `localhost:8788` — so to drive the **hosted** sim, set those in your shell first, or it will
> silently no-op against nothing.

---

## Close

*"Every screen you saw is bound to the OpenAPI contract, token-gated by the persona matrix,
four-eyes-gated where it matters, PII-free, and lineage-tracked — and all of it port-abstracted
so the same application core runs against the bank's real systems by swapping a config flag, not
a line of code. And one incident, `INC-2026-0042`, walked through all of it as a single thread."*
