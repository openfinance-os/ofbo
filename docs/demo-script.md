# OFBO — Demo Script (presenter golden path)

A ~10-minute cross-persona walkthrough that shows the **depth** of the Open Finance Back
Office without any real integration — everything below runs on synthetic data against the
local stack. The story arc: **regulated, four-eyes-gated, separation-of-duties, fully
audited + lineage-tracked** — not a CRUD app.

## 0. Setup (once)

```bash
# bring up the stack (Nebras sim + BFF + portal) on a fast local Postgres, then seed depth
pnpm db:reset && pnpm db:seed:demo          # rich "operating back office" — see below
.claude/skills/run-ofbo/smoke.sh --keep     # launches sim + BFF, leaves them running
(cd apps/portal && pnpm build && PORT=3000 BFF_URL=http://localhost:8787 pnpm start &)
```

Open **http://localhost:3000**. Every screen carries the persistent **DEMO banner** (a
regulatory hard-stop: synthetic data only, zero real PSU data). `pnpm db:seed:demo` stages:
a 30-day reconciliation history, ~11 open breaks, 16 risk signals across all types, **3
pending four-eyes approvals**, and 6 disputes (incl. a cross-scheme one).

The opening line: *"This is a bank-neutral back office for UAE Open Finance — the LFI and
TPP-of-record roles in one regulated console. Watch the guardrails, not the CRUD."*

---

## 1. Customer Care — PSU lookup, consent revoke, dispute  *(persona: Customer Care Agent)*

Sign in as **Customer Care Agent** → **Customer Care**.

1. **PSU Identity Lookup** — search `cust-0001` (bank_customer_id). The profile resolves with
   its **consent inventory** (6 TPP consents: SIP_PAYMENT + AISP_DATA_SHARING, with
   Consumed/Suspended/Revoked states) and the **24-month event history**.
   - *Point out:* **no PSU PII** — only the internal id, scopes, and synthetic fintech names.
     The whole audit trail is PII-redacted at emission.
2. **Admin-revoke** a Suspended consent (reason `TPP_REQUEST`). It propagates to the **Nebras
   Consent Manager via the P6 egress port** and records the **sub-5s acknowledgment** (the
   scheme SLA). One High-class audit row is written.
3. **Open a dispute** from the Investigation module (`unauthorised_payment`). Note the copy:
   *"Refund initiation is four-eyes-gated downstream"* — Care **cannot** refund alone.

---

## 2. Four-Eyes Approval — the load-bearing control  *(switch persona)*

The dispute refund, an invoice run, and a CBUAE report are **already pending** in the queue,
each seeded so a *different* persona is the approver than the initiator.

- As **Customer Care Agent** → **Approvals**: one **PENDING `disputes.refund`** with dual
  **Initiator / Approver** cards (the initiator is a *colleague*, so you can action it). Click
  **Approve** → it executes only now, by a second principal. *The control:* an initiator is
  always **locked out of approving their own** request — even super-admin (enforced at the BFF,
  not just the UI).
- Switch to **Finance Analyst** → **Approvals**: a pending **invoice run** to approve.
- Switch to **Compliance Officer** → **Approvals**: a pending **CBUAE report** to approve.

*The point:* every consequential action returns `202 + approval_request` and **never executes
inline** — it waits for a second set of eyes.

---

## 3. Separation of duties — the scope matrix is load-bearing  *(persona: Finance Analyst)*

As **Finance Analyst**, look at the sidebar: **Finance, Analytics, TPP Billing** — but **no
Risk, no Customer Care**. Try navigating to `/risk` directly → you're **bounced to the
dashboard**. Customer Care ≠ Finance ≠ Risk scopes; granting beyond the matrix is an automatic
review failure. (Same enforcement at the BFF, not just the UI.)

---

## 4. Reconciliation — the three-way engine + break workflow  *(persona: Finance Analyst)*

**Finance** → Reconciliation Console.

- The **KPI row**: Total Lines / Matched (green) / Unmatched (red) / Disputed (amber), with a
  **30-day run history** behind the SLO dashboard.
- The **Break Queue** (~11 open): each break shows the **three source refs** (A = Nebras
  billing, B = the bank's metering-of-record, C = fintech billing), variance, line type, and
  SLA clock.
- **Claim** a flagged break → it moves to *assigned* with your name + an SLA clock. **Resolve**
  it (outcome + a ≥20-char note). Open the **Investigation Detail** on another for the
  side-by-side three-source diff and the one-click **escalate-to-Nebras**.

---

## 5. Risk — anomaly monitors + the predictive "regulated AI" forecast  *(persona: Risk Analyst)*

**Risk** view. 16 signals across every type: consent anomalies, TPP behaviour (3σ), CoP
mismatch, Nebras liability approaching, agent anomaly, **predictive liability forecast**, and a
missed-LFI-report-cadence signal.

- The **predictive liability forecast** is a **regulated AI artefact** — open
  `docs/model-cards/predictive-liability-forecast.md`: deterministic + explainable, with drift
  monitoring and a recertification fallback to the deterministic monitor. *"AI for advance
  warning, never an automated control."*
- Triage a signal (acknowledge → investigate → close) — every transition is audited.

---

## 6. Cross-scheme guard + lineage  *(persona: super-admin to show everything)*

- **Cross-scheme double-compensation:** one seeded dispute is marked settled in the other
  scheme (Aani). Attempting `initiate-refund` on it returns **409** — the bank can't pay the
  same direct loss twice across schemes.
- **BCBS 239 lineage:** `GET /back-office/lineage/risk_signal` (Compliance) returns the
  column-level lineage tree — every regulated write is traceable end-to-end. The **Q4.5 gate**
  in CI fails the build if any table with rows lacks lineage.

---

## 7. Inject a fault, live  *(the "trigger breaks + signals on demand" requirement)*

The Nebras simulator emulates the Hub with **injectable faults**. Show the round-trip:

```bash
pnpm demo:fault fee-variance 2026-05 999   # inject a +999 fil fee variance into the period
# the TPP Report for that period now carries the perturbed line — the variance a
# reconciliation run would flag as a break against the bank's metering-of-record
pnpm demo:fault clear                       # remove all injected faults
```

Other faults: `revoke-delay <ms>` (push a consent revoke past its 5s SLA), `rate-limit <n>`
(429 the next N report polls → exercises the ingestion's exponential back-off).

---

## Close

*"Every screen you saw is bound to the OpenAPI contract, token-gated by the persona matrix,
four-eyes-gated where it matters, PII-free, and lineage-tracked — and all of it port-abstracted
so the same application core runs against the bank's real systems by swapping a config flag, not
a line of code."*
