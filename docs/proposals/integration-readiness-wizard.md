# Proposal — Integration Readiness Wizard + "How close are you?" landing surface

- Status: **Draft for review** (not yet approved — plan only, no code)
- Date: 2026-06-25
- Author: build loop, at user request
- Scope: two **product** surfaces (not harness machinery). If approved, each ships as a normal
  spec-first story under M5/M6 with its own `BACKOFFICE-NN` and contract tests.
- Relates to: PRD §3 (ports), §3.1 (deployment profiles), §10 (BD-01..16 adopting-bank
  decisions), §9 (M6 enterprise port-swaps).

## Why this exists (the problem being solved)

The product is feature-complete for demo (135/138 backlog items merged; M0–M5 live and
auto-deploying). The barrier to a **sale** is not missing features — it is that the *last mile*
(getting it running on a specific bank's systems) is **invisible to a buyer**. A prospect sees
ten polished consoles on synthetic data and cannot answer the only question that gates a
purchase decision:

> "What does it take to run this on **my** estate, and how long?"

Everything needed to answer that already exists in the architecture but is buried in prose:

- **Ports P1–P9** — every bank-specific system is already abstracted behind a port interface
  with a working `sim` adapter and an `enterprise` adapter stub (M6). The "remaining work" is a
  known, bounded list: write 9 adapters, each passing the *same* contract tests its sim passed.
- **BD-01..16** (PRD §10) — the 16 adopting-bank decisions, each with a sensible pre-set
  default. Today this is a static table no prospect ever reads.

This proposal turns those two assets into an interactive, personalized self-assessment that ends
in a circulatable artifact — reframing the demo from *"look at the features"* to *"look how
close **you** are to production."*

Two surfaces, designed to be built and sold together:

1. **Integration Readiness Wizard** (`/readiness`) — the interactive assessment + digest.
2. **"How close are you?" landing surface** — the prospect-facing reframe that drives a visitor
   from the demo into the wizard.

---

## Surface 1 — Integration Readiness Wizard

A DEMO-bannered, no-PII portal surface a prospect's solution architect completes in 5–10 min.
It writes **no regulated data** — its inputs are bank *system metadata* (e.g. "we use Okta"),
not PSU data — so it lives wholly inside the demo profile and is safe to drive live on a call.

### Flow

**Step 1 — Map your estate.** For each port, pick the bank's system from a curated dropdown
(UAE-bank-common options + "Other / in-house"). Proposed catalog (the exact list is config, not
code — see *Port catalog* below):

| Port | What it maps to | Example options offered |
|---|---|---|
| P1 Customer-care surface | Where care agents work | Portal-resident (default) · CRM-resident (Salesforce / MS Dynamics / Pega) · Other |
| P2 Enterprise IdP (OIDC) | Portal sign-in + MFA | Entra ID / Azure AD · Okta · ForgeRock · PingFederate · Internal OIDC · Other |
| P3 ITSM / alerting | Ticket routing | ServiceNow · Jira Service Management · BMC Remedy · Email fallback · Other |
| P4 Core banking adapter | Read-only balance/txn | Finacle · Flexcube · Temenos T24 · Mambu · In-house core · Other |
| P5 Enterprise APM | OTel bridge target | Dynatrace · AppDynamics · Datadog · New Relic · CloudWatch/X-Ray · Other |
| P6 Egress gateway | ALL Nebras-bound traffic | Existing egress gw (Apigee / Kong / MuleSoft / F5 / custom) — endpoint + cert-chain owner · Other |
| P7 Data catalogue (lineage) | BCBS 239 sink | Collibra · Alation · Informatica · Microsoft Purview · None yet · Other |
| P8 Onboarding handover (optional) | Funnel handoff | Bank onboarding system · Not integrating · Other |
| P9 Financial management system | TPP invoicing / AR | SAP · Oracle ERP / Fusion · MS Dynamics · Custom AR · Other |

**Step 2 — Confirm or override the 16 governance decisions (BD-01..16).** Each rendered with
its product default pre-selected and its impact line, so the architect is *confirming*, not
authoring. M1-blocking decisions (BD-01 IdP, BD-04 ITSM) and governance sign-offs (BD-13
cross-fintech aggregation) are visually flagged.

**Step 3 — Receive the digest** (below), on-screen and as a PDF export.

### The digest (the deliverable)

1. **Executive summary** — overall readiness score (0–100) + one-line verdict ("mostly standard
   protocols; P4 core needs scoping").
2. **Port-by-port readiness table** — per port: chosen system · adapter status (sim ✅ / enterprise
   to-write) · the **contract-test gate** it must pass (the port-swap acceptance gate already
   exists) · effort band (Low / Medium / Scoping) · the concrete config keys to set.
3. **Governance register** — the BD-01..16 answers, with blockers called out.
4. **Generated Bank Profile** — a pre-populated `enterprise.<bank>.tfvars` / profile JSON
   skeleton derived from the answers (this is real: `infra/terraform/environments/` already has
   this shape).
5. **"Already done for you"** — 9/9 sim adapters working, N tests green, the contract suite each
   enterprise adapter inherits. Makes the *bounded* nature of the remaining work explicit.
6. **Suggested sequencing** — the M6 port-swap order (P2 → P6 → P3 → P4 → P7 → P9 …) with the
   bank's specifics filled in.

### Scoring model (deterministic, testable)

Readiness is a deterministic function of the answers — no LLM, fully unit-testable, so the same
inputs always produce the same digest:

- Each port option carries a static **complexity band**: a standard protocol with a known
  adapter pattern (OIDC, REST, OTel) → **Low**; "Other / in-house" or "None yet" → **Scoping**;
  P6 is always **Medium+** (mTLS + scheme cert chain) even though it's mostly the bank's existing
  gateway config. Bands map to weights; weighted sum → score + per-port RAG.
- BD answers that select a *non-default* or a known blocker (BD-13 without governance sign-off)
  add flags, not score penalties — they surface as "decisions to close," not failures.

### Architecture (composes existing primitives — no new platform)

- **Frontend:** new `/readiness` route + a multi-step wizard component, token-only (Stitch
  reference — generate the screen in Stitch first if absent, per CLAUDE.md), DEMO-bannered.
- **BFF:** `GET /back-office/readiness/port-catalog` (serves the dropdown catalog + BD defaults)
  and `POST /back-office/readiness:assess` (stateless: answers in → digest out). Both new
  OpenAPI paths, contract-tested.
- **Logic module:** the port catalog + scoring rules live in one deterministic, unit-tested
  module (BFF or `packages/`). The catalog is data, so adding a vendor is a config edit.
- **PDF export:** reuse the existing analytics export pipeline (PDF/XLSX already supported).
- **No DB writes required** — keep it stateless and no-PII. (Optional later: persist a named
  profile as a synthetic record; not in v1.)

### Hard-stop compliance

- **No PII** — inputs are bank-system metadata only; nothing PSU-related touches it.
- **DEMO banner** on every step; permanently non-prod.
- **Scope-gated** — surface this to the OF Programme Manager persona (least-privilege; a new
  read-only `readiness:read` scope, or reuse an existing programme scope — decide at build).
- **Four-eyes:** not applicable (read-only self-assessment; writes nothing regulated).
- **Token-only design**, OpenAPI-bound, no Stitch mock values (CLAUDE.md UI rule).

### Out of scope for v1

- Persisting/comparing multiple saved profiles.
- Auto-generating actual adapter code stubs (a tempting follow-up; keep v1 to the digest).
- Any live connection test to a real bank system (that's M6 integration work, not a wizard).

---

## Surface 2 — "How close are you?" landing surface

A prospect-facing entry (extend the pre-sign-in screen or add a `/why` route) that reframes the
demo around production-readiness and funnels into the wizard. Sections:

1. **The problem** — "You passed CBUAE certification, but you can't *run* Open Finance yet:
   Nebras fees unverified, care has no tool, liability found only on the invoice."
2. **The two hats** — LFI + TPP-of-record, both run from one back office (already in README).
3. **See it live** — links into the demo (the INC-2026-0042 thread traced across consoles).
4. **The port-swap path** — the 9 ports, what's done (sim) vs. what you write (enterprise), and
   that each enterprise adapter passes the *same* contract tests.
5. **CTA → the Readiness Wizard** — "Find out how close *your* bank is" → `/readiness`.

Token-only, Stitch-referenced, DEMO-bannered. No new backend; pure presentation + a link to
Surface 1.

---

## Build sequencing (if approved)

1. Generate both screens in Stitch (layout/tokens) — cite the screen ids in the PRs.
2. Spec-first: add the two OpenAPI paths + acceptance criteria; contract tests fail first.
3. BFF: port catalog + deterministic scoring module → `:assess` + `/port-catalog` to green.
4. Portal: `/readiness` wizard + digest + PDF export; then the landing surface.
5. Each as its own `BACKOFFICE-NN` story/branch/PR per the standard workflow; coverage ≥80%.

Estimated as two small stories (landing) + one medium (wizard). All composes existing
primitives — no ADR required unless the new `readiness:read` scope is judged a platform
primitive (CLAUDE.md rule 6), in which case raise one and stop.

## Open questions for the reviewer

1. **Surface the wizard pre- or post-sign-in?** Pre-sign-in maximizes prospect reach but means a
   public unauthenticated route; post-sign-in keeps it inside the persona model. (Lean:
   post-sign-in under the Programme Manager persona, linked from a public landing teaser.)
2. **New `readiness:read` scope vs. reuse an existing programme scope?**
3. **Persist named profiles in v1, or keep stateless?** (Lean: stateless v1.)
