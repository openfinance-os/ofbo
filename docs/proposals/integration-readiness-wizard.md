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

One **public, pre-login** surface (per the resolved decisions below): the **Integration Readiness
Wizard** at `/readiness` — opening with a prospect-facing hero ("how close are *you*?") that flows
straight into the assessment + digest. The standalone landing page folds into the wizard's hero
step rather than being a separate screen.

---

## Surface 1 — Integration Readiness Wizard

A DEMO-bannered, no-PII, **public pre-login** surface a prospect's solution architect completes
in 5–10 min — *no account, no sign-in*. It writes **no regulated data** — its inputs are bank
*system metadata* (e.g. "we use Okta"), not PSU data — so it lives wholly inside the demo profile
and is safe to drive live on a call or hand a cold prospect.

> **Decisions locked (2026-06-25, user):** pre-login/public · no persona gate (open to anyone) ·
> persistent named profiles in v1. The wizard *is* the prospect-facing hook; Surface 2 (landing
> framing) folds into its hero step rather than being a separate gated screen.

### Flow

**Step 0 — The hook (hero).** Public framing before any input: *"Running Open Finance as a UAE
bank? You've passed CBUAE certification — but can you operationally run it yet? See how fast you
could go live, and exactly what integration it takes on your estate."* One CTA → start the
assessment.

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

**Step 3 — Receive the digest** (below), on-screen and as a PDF export. Optionally **name and
save** the profile (v1) — returns a shareable link the architect can circulate internally and
reopen later to revise.

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

### Architecture (composes existing primitives — but introduces one new auth pattern)

- **Frontend:** new **public, pre-login** `/readiness` route + a multi-step wizard component,
  token-only (Stitch reference — generate the screen in Stitch first if absent, per CLAUDE.md),
  DEMO-bannered. Reachable directly and linked from the sign-in screen; no auth gate.
- **BFF — public endpoints (new pattern, see below):**
  - `GET /public/readiness/port-catalog` — serves the dropdown catalog + BD defaults (static).
  - `POST /public/readiness:assess` — answers in → digest out (deterministic, no auth).
  - `POST /public/readiness/profiles` — create a named profile, returns an opaque shareable
    slug/token. `GET /public/readiness/profiles/{slug}` — reopen it. (v1 persistence.)
  - All under a clearly-separated `/public/*` namespace, contract-tested, rate-limited.
- **Logic module:** the port catalog + scoring rules live in one deterministic, unit-tested
  module (BFF or `packages/`). The catalog is data, so adding a vendor is a config edit.
- **PDF export:** reuse the existing analytics export pipeline (PDF/XLSX already supported).
- **Persistence (v1):** a new `readiness_profiles` table — *non-regulated bank system-metadata
  only*, never `audit_high_sensitivity`, never a regulated record. Keyed by an unguessable slug;
  no PII; demo-profile only. Updatable (revise & re-save), unlike the INSERT-only audit store.

### The new auth pattern — flag for an ADR at build time

Every existing BFF route is admin-scoped (enforced at BFF middleware **and** service layer —
defence in depth, CLAUDE.md). A **public unauthenticated** route is therefore a genuinely new
auth path, and CLAUDE.md rule 6 ("compose, don't invent — no new auth paths") says invent one
only via an ADR that a human accepts. **So the build's first step is an ADR** proposing the
`/public/*` carve-out, with these guardrails as the decision's terms:

- Strictly **read-mostly + no-PII + no regulated tables**; the only write is a `readiness_profiles`
  upsert of bank system-metadata.
- **Rate-limited** at the edge (Cloudflare) and per-IP in the worker; abuse/spam-bounded since
  anyone can POST.
- **Demo-profile only** — not deployed in the enterprise profile (where a bank wouldn't expose a
  public marketing endpoint inside its regulated estate anyway).
- Never reachable from, and never able to reach, any admin-scoped handler or regulated store.

If the reviewer prefers to avoid a public endpoint entirely, the fallback is a **fully client-side
wizard** (catalog + scoring shipped as static data in the portal bundle; profiles saved to a
shareable URL hash or a public KV namespace) — no BFF auth change at all. Noted as the alternative
in the ADR.

### Hard-stop compliance

- **No PII** — inputs are bank-system metadata only; nothing PSU-related touches it.
- **DEMO banner** on every step; permanently non-prod.
- **No persona gate** (per decision) — it's public; the access-control story is the `/public/*`
  carve-out + rate-limiting above, not a scope. There is **no** new `readiness:read` admin scope.
- **Four-eyes:** not applicable (no regulated write; profile save is non-regulated metadata).
- **Token-only design**, OpenAPI-bound, no Stitch mock values (CLAUDE.md UI rule).

### Out of scope for v1

- Comparing/diffing multiple saved profiles side by side (single named profile is in).
- Auto-generating actual adapter code stubs (a tempting follow-up; keep v1 to the digest).
- Any live connection test to a real bank system (that's M6 integration work, not a wizard).

---

## Surface 2 — the pre-login hero (folded into the wizard)

With the wizard now public/pre-login, the separate "landing page" collapses into **Step 0 of the
wizard itself** plus the demo's sign-in screen. The framing content still matters — it's just no
longer a distinct gated route:

1. **The problem** — "You passed CBUAE certification, but you can't *run* Open Finance yet:
   Nebras fees unverified, care has no tool, liability found only on the invoice."
2. **The two hats** — LFI + TPP-of-record, both run from one back office (already in README).
3. **See it live** — links into the demo (the INC-2026-0042 thread traced across consoles).
4. **The port-swap path** — the 9 ports, what's done (sim) vs. what you write (enterprise), and
   that each enterprise adapter passes the *same* contract tests.
5. **CTA → start the assessment** — "Find out how close *your* bank is."

Token-only, Stitch-referenced, DEMO-bannered. This is the wizard's hero (Step 0) and a teaser
link from the sign-in screen — not a second backend or a second gated screen.

---

## Build sequencing (if approved)

1. **ADR first** — propose the `/public/*` unauthenticated carve-out (terms + the client-side
   fallback alternative). Human accepts before any public route is built (CLAUDE.md rule 6).
2. Generate the wizard screen(s) in Stitch (layout/tokens) — cite the screen ids in the PRs.
3. Spec-first: add the OpenAPI paths (`/public/readiness/*`) + acceptance criteria; contract
   tests fail first.
4. BFF: port catalog + deterministic scoring module → `:assess` + `/port-catalog` to green;
   then `readiness_profiles` upsert/read (persistence) + rate-limiting.
5. Portal: public `/readiness` wizard (Step 0 hero → estate → BD-01..16 → digest) + PDF export +
   save/share; sign-in-screen teaser link.
6. Each as its own `BACKOFFICE-NN` story/branch/PR per the standard workflow; coverage ≥80%.

Estimated as one ADR + ~one medium wizard story + one small persistence story. No new admin
scope; the only invented primitive is the public auth path, which the ADR governs.

## Decisions — resolved (2026-06-25, user)

1. **Pre- or post-sign-in?** → **Pre-login / public.** The wizard is the prospect hook itself;
   maximizes reach. Cost: a public unauthenticated route → governed by the ADR above.
2. **New `readiness:read` scope vs. reuse?** → **Neither.** It's public; no persona gate, no new
   admin scope. Access control is the `/public/*` carve-out + rate-limiting.
3. **Persist named profiles in v1?** → **Yes.** `readiness_profiles` table (non-regulated bank
   metadata, no PII, shareable slug, demo-only, updatable).

## Open questions remaining for the reviewer

1. **Public BFF endpoint vs. fully client-side wizard?** Both deliver the pre-login experience;
   the ADR will put both on the table. (Lean: public `/public/*` BFF endpoints — keeps the
   catalog/scoring server-authoritative and testable; client-side is the lighter fallback.)
2. **Green light to start the build** (ADR → spec → BFF → portal), or revise the plan further?
