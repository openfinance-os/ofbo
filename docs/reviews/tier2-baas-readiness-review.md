# Tier 2 BaaS Readiness Review — selling OFBO as a hosted Back Office as a Service

- Date: 2026-07-13
- Scope: commercial and technical readiness review of the current solution against one
  specific go-to-market intent: **selling OFBO to Tier 2 banks and insurance companies as a
  cost-efficient hosted "Back Office as a Service" (BOaaS)** — buyers mandated into UAE Open
  Finance who cannot justify building this from scratch.
- Status: review artifact (assessment only — no code, spec, or backlog changes). Follow-up
  work it recommends already exists as the COMMERCIAL track in `docs/backlog.yaml`
  (VAL-01, HOST-01/02/03, INS-01/02) plus a small number of new candidates listed in §7.
- Method: evidence-based inventory of the repository (backlog, ADRs, migrations, ports,
  CI, live demo) as of commit `99ab0dd` on `main`. Every material claim cites its source.

---

## 1. Executive summary

**Verdict: the product is real and the strategy for this exact segment is already accepted —
the gap is a short, well-understood hardening track, not a rebuild.**

- The core back office (Reconciliation E1, Customer Care E2, Analytics E3, plus scheme
  ops, TPP billing, approvals, audit, risk/compliance views) is **built, contract-tested,
  and live on a public demo** — roughly 127 of 135 backlog items done across M0–M5
  (`docs/backlog.yaml`, `README.md`). This is not a prototype: ~200 test spec files,
  integration tests against real Postgres, Playwright e2e, mutation testing on the
  security core, and five merge-blocking CI quality gates (`.github/workflows/ci.yml`).
- The commercial positioning for Tier 2 banks and insurers is **already decided and
  accepted**: ADR 0026 (`docs/adrs/0026-commercial-positioning-nebras-vas-split.md`,
  accepted 2026-07-04) names the segment explicitly — CBUAE Circular C 03/2025 obligates
  roughly **50 banks and 60+ insurers**, most without the engineering capacity to build any
  of this — and keeps "hosted SaaS for Tier 2 + insurers" alive as a parallel motion
  alongside the Nebras VAS channel.
- The architecture was built for this outcome: `bank_id` tenancy with forced row-level
  security on every regulated table from day one (`packages/db/migrations/0003_rls.sql`),
  vendor-neutral ports with profile-switched adapters (`packages/ports/src/registry.ts`),
  region-parameterised IaC (`infra/terraform/variables.tf`), serverless demo hosting.
  ADR 0026's own words: "hosting is a config posture, not a re-architecture."
- **But the runtime is single-tenant today.** One `BANK_ID` environment variable, no tenant
  resolution, no per-tenant configuration store, and one RLS-bypass role
  (`bank_internal_view`) that would be a cross-customer read path the moment a second
  tenant exists. Every one of these is already captured as a pending backlog item
  (HOST-01/02/03). Until HOST-02 and HOST-01 land, "multi-tenant SaaS" is a schema
  property, not a shippable claim.
- **For insurers specifically**, the domain model is bank-shaped: no insurance line types in
  the reconciliation engine, no insurance consent purposes, no insurer/broker personas, and
  no Open Insurance corpus in the data-risk register. INS-01/INS-02 scope the product work;
  the regulatory-register gap is new (§7).

Recommended sequence (detail in §8): **VAL-01 → HOST-02 → HOST-01 → first design-partner
bank tenant → INS-01 → INS-02 + Open Insurance register → first insurer tenant**, with
HOST-03 (cert custody ADR) and the compliance-certification track (SOC 2 / ISO 27001)
running in parallel from the start because they have the longest lead times.

---

## 2. What a Tier 2 buyer gets today (built and demonstrable)

### 2.1 Product inventory

All of the following is implemented, spec-bound to `specs/backoffice-openapi.yaml`
(89 paths), and demonstrable at the live demo URLs in `README.md`:

| Capability | Portal surface | Why a Tier 2 buyer cares |
|---|---|---|
| Three-way reconciliation (Nebras billing ↔ platform logs ↔ fintech billing), break workflow, monthly Finance sign-off, CBUAE export | `apps/portal/src/app/reconciliation` | Fee leakage detection and the regulator export, with zero build cost |
| PSU consent search, single/bulk/fraud revocation (<5s scheme SLA), 24-month audit timeline, dispute initiation, refund flow | `apps/portal/src/app/care` | The mandated care obligations (revoke SLA, next-business-day refund) out of the box |
| Executive / Operations / Compliance / Risk / Finance analytics, liability monitor, onboarding funnel, reconciliation SLO | `apps/portal/src/app/analytics`, `risk`, `operations`, `compliance`, `dashboard` | Board- and regulator-facing visibility without a data team |
| TPP counterparty registry + monthly invoicing (reconcile-before-invoice), respondent-side dispute clocks | `apps/portal/src/app/tpp-billing` | The TPP-of-record commercial book, relevant to any participant re-billing fintechs |
| Four-eyes approvals (202 + approval_request, never inline), INSERT-only high-sensitivity audit, STR/AML drafting trail | `apps/portal/src/app/approvals`, `audit` | Controls an examiner asks about on day one |
| Public Integration Readiness Wizard — prospect self-scores integration effort across ports P1–P9 and the 16 adopting-institution decisions | `apps/portal/src/app/readiness`, `maturity`; `services/bff/src/readiness/catalog.ts`; ADR 0022 | Already a **sales-enablement funnel**: a prospect can self-qualify before any call |
| Nebras simulator with injectable faults (timeouts, consent drift, fee variances, liability crossings) | `services/nebras-sim` | Demos break-and-fix scenarios on demand; later doubles as a training/UAT environment |

### 2.2 Quality and compliance evidence (the build-vs-buy differentiator)

The strongest sales argument against "we'll build it ourselves" is not the screens — it is
the regulated substrate that is *implemented*, not slideware:

- **INSERT-only audit enforced at the database**: no UPDATE/DELETE policy at any role plus
  explicit `REVOKE UPDATE, DELETE` on `audit_high_sensitivity`
  (`packages/db/migrations/0003_rls.sql`). No deletion path for regulated records anywhere.
- **Tenancy RLS from day one**: every regulated table carries `bank_id` and forced RLS keyed
  on a per-transaction setting (`packages/db/src/tenant-tx.ts`).
- **PII redaction as a shared library** (Emirates ID / IBAN / email patterns), applied at
  audit emission and telemetry boundaries (`packages/redaction/src/index.ts`).
- **BCBS 239 lineage at write time**, with a merge-blocking CI gate (Q4.5).
- **Four-eyes with self-approval rejected at a DB CHECK constraint**, superadmin actions
  marked in audit (`packages/db/migrations/0002_tables.sql`, `0004_superadmin.sql`).
- **Fail-closed egress**: the enterprise Nebras adapter cannot be constructed without a
  gateway URL + credentials — there is no code path for direct scheme egress
  (`packages/ports/src/adapters/enterprise/nebras-egress.ts`).
- **CI quality gates** Q1 build/unit, Q1b test-integrity (anti-reward-hacking), Q2
  lint/typecheck/SAST, Q3 integration + contract against real Postgres, Q3-e2e Playwright,
  Q4 dependency + secrets scan, Q4.5 lineage — all merge-blocking (`.github/workflows/ci.yml`);
  StrykerJS mutation testing on the rbac/auth/approvals core (`.github/workflows/mutation.yml`);
  sealed release-evidence bundles (`.github/workflows/release-evidence.yml`, ADR 0019).
- **Live auto-deploy**: every merge to `main` redeploys BFF, portal, and simulator and runs a
  smoke suite against the live URLs (`.github/workflows/deploy.yml`).

For a Tier 2 bank or insurer, this list is 12–24 months of platform engineering they do not
have to fund — which *is* the cost-efficiency pitch.

### 2.3 Ports: the integration story

Ten ports (P1–P10; the PRD's nine plus the P10 STR workflow) each have a simulator adapter
and a named enterprise adapter behind one interface, selected in exactly one place
(`packages/ports/src/registry.ts`). Contract tests bind the interface, so an enterprise
adapter must pass exactly the suite the simulator passes
(`packages/ports/test/port-contracts.spec.ts`) — that is the M6 port-swap acceptance gate.
Per ADR 0024, one adapter (P2 Microsoft Entra, ADR 0023) is at full reference fidelity; the
other nine are pre-staged fail-closed implementations that throw when unconfigured rather
than silently simulating. Honest framing for a buyer: **the integration pattern is proven,
the per-institution last mile is per-deal work** — and in the hosted BOaaS motion most of
that last mile collapses, because the operator (not the buyer) runs the P5/P6/P7 side and
Tier 2 buyers typically take default SaaS options for P1/P3 (care surface, ITSM).

---

## 3. Fit with the accepted commercial strategy (ADR 0026)

ADR 0026 evaluated three distribution motions and accepted a **dual-motion split**:

1. **Console tier** (consent ops + care, dispute case management, mandatory reporting,
   STR/AML trail) — distributable through Nebras as a scheme VAS, white-labelled, on the
   CAAP precedent (pitch: `docs/proposals/nebras-vas-pitch.md`).
2. **Assurance tier** (three-way reconciliation, fee/invoice verification, liability
   monitor, scheme-SLA observability, TPP-aaS margin) — **never through Nebras**, because
   the invoice-issuer cannot operate the invoice-verifier. The independence is the product.
3. **Hosted SaaS for Tier 2 + insurers in parallel** — the motion this review assesses —
   explicitly kept alive as the channel-concentration hedge, with Tier 1 enterprise deploy
   (M6) deferred to a later upmarket motion.

Implications for the Tier 2 BOaaS pitch:

- **The direct hosted motion can sell BOTH tiers to one buyer** — the conflict-of-interest
  line constrains what *Nebras* may host, not what an independent operator may. For a Tier 2
  bank, "console + assurance from one independent SaaS" is in fact the strongest bundle: the
  scheme cannot offer the assurance half at all (ADR 0026's stated moat).
- **The tier boundary is still a packaging requirement.** If the Nebras VAS motion also
  proceeds, console-tier modules must become separable (deployable without assurance
  modules). Today they share one BFF; ADR 0026 explicitly defers that separation until a
  Nebras engagement is real. The Tier 2 motion does not need the split — but pricing should
  anticipate it (console-tier price point must survive Nebras later giving a console away).
- **The assurance tier is where the ROI narrative lives** for a cost-conscious Tier 2 buyer:
  fee-variance recovery plus liability-exposure-avoided in AED terms against the published
  per-event schedule (AED 200–10,000 per event, Nebras cap AED 5M — PRD §
  regulatory anchors). VAL-01 exists precisely to turn this into a headline KPI and a
  closing ROI demo screen, and the backlog notes it "lands hardest with the Tier 2/insurer
  audience". It is the cheapest high-leverage item on the whole track.

---

## 4. Gap analysis — what stands between today's codebase and a first paying tenant

Ranked by blocking order. Items marked ✅ have an accepted backlog entry; items marked ➕
are new candidates raised by this review (§7).

### 4.1 Blocking before ANY second tenant (multi-tenancy hardening)

| # | Gap | Evidence | Backlog |
|---|---|---|---|
| 1 | `bank_internal_view` is a cross-`bank_id` SELECT (`USING (true)`) designed for one bank's internal cross-fintech aggregation. With a second tenant it becomes a **cross-customer read path** on reconciliation, disputes, and audit tables. | `packages/db/migrations/0003_rls.sql`; ADR 0015 | ✅ HOST-02 (explicitly "BEFORE any second tenant exists") |
| 2 | Runtime is single-tenant: one hardcoded `BANK_ID` env default in the worker, no tenant table, no tenant claim in auth tokens, no per-request tenant resolution. | `services/bff/src/worker.ts` | ✅ HOST-01 (depends on HOST-02) |
| 3 | PRD §10 adopting-institution defaults are constants in code, not per-tenant config: 2-business-hour approval expiry (`services/bff/src/approvals/service.ts`), UAE weekend SLA calendar (`services/bff/src/business-hours.ts`), fraud-revoke four-eyes gating, fee schedule (`services/bff/src/reconciliation/fee-schedule.ts`). | files cited | ✅ HOST-01 acceptance ("read from per-tenant config everywhere they are enforced") |
| 4 | Per-tenant P6 scheme-certificate custody: each LFI holds its own FAPI 2.0 cert chain; a hosted egress gateway means custodying tenant certs (HSM/KMS, rotation, revocation, audit). Undesigned. | ADR 0026 consequences | ✅ HOST-03 (ADR-authoring story, human-gated) |

### 4.2 Blocking for insurers specifically

| # | Gap | Evidence | Backlog |
|---|---|---|---|
| 5 | Reconciliation `line_type` enum and fee schedule have no insurance lines (quote fees are tiered 5–12.5 fils); no insurance consent purposes; no policy/quote synthetic shapes in the simulator. Spec-first contract change. | `packages/db/migrations/0002_tables.sql`; `services/bff/src/reconciliation/fee-schedule.ts` | ✅ INS-01 |
| 6 | Care surface and personas are account/payment-centric; no policy-centric care view, no insurer-operations or broker personas. | `apps/portal/src/app/care`; PRD §2 | ✅ INS-02 (depends on INS-01) |
| 7 | The data-risk register contains **no Open Insurance / Insurance Data Sharing corpus** — it is a CPS (Circular 8/2020) + exchange-house set. The insurance regulatory basis currently rests on ADR 0026 / pitch assertions, not an ingested regulation set. | `docs/governance/data-risk-register/regulations.json` | ➕ new (§7, REG-INS) |
| 8 | PRD, spec, and profile vocabulary are bank-worded ("Core Banking Adapter" P4, "adopting-bank" BD-xx, `bank_id`). Architecture generalises (ADR 0026: config posture, not re-architecture) but sales collateral and the readiness wizard catalog need insurer wording. | `docs/PRD_Open_Finance_Back_Office.md` §3, §10; `services/bff/src/readiness/catalog.ts` | ➕ partially covered by INS-01/02; wizard/catalog wording is new (§7) |

### 4.3 Blocking for production operation (any buyer, first tenant included)

| # | Gap | Evidence | Backlog |
|---|---|---|---|
| 9 | FAPI 2.0 posture (mTLS, PAR, PKCE, scheme cert chain) is **delegated to the P6 gateway by design and unproven** — only `x-fapi-interaction-id` propagation is in-code. Correct architecture; no live proof until a real gateway swap. | `packages/ports/src/adapters/enterprise/nebras-egress.ts`; ADR 0024 | M6 rung-④; BACKOFFICE-52 (mTLS) deliberately blocked to M6 |
| 10 | Operator certifications: a hosted/OEM motion requires SOC 2 / ISO 27001 (ADR 0026 consequences). Longest lead time of anything on this list (typically 9–12 months to a Type II report) — must start before the product work finishes, not after. | ADR 0026 | ➕ new (§7, CERT-01) |
| 11 | `infra/terraform` is a self-described skeleton (region-parameterisation + invariant tests, no full provisioning stack). Fine for the demo; a hosted regulated deployment needs the real stack (network isolation, KMS, backup/restore, residency evidence). | `infra/terraform/` | partially M6; hosting-specific work is new (§7) |
| 12 | Several M4a/M5 stories were merged on locally-run gates while GitHub Actions billing was blocked ("Merged on local gates (CI billing-blocked)" in `docs/build-log.md`). Current CI is green, but a buyer's due diligence should be met with a clean full-pipeline re-run on `main` as evidence. | `docs/build-log.md` | ➕ cheap: one evidence re-run (§7) |

### 4.4 Commercial gaps with no backlog item yet

| # | Gap | Evidence | Notes |
|---|---|---|---|
| 13 | **No white-label/theming seam** — "OFBO" mark and demo brand are hardcoded in the portal shell; the brand seam exists only in the discovery harness (`discovery/brand/design.md`, with a worked second brand at `discovery/brand/examples/meridian-trust.design.md`). ADR 0026 envisions white-labelling; the portal cannot deliver it yet. | `apps/portal/src` app shell | Needed for OEM/VAS; *optional* for direct Tier 2 SaaS v1 |
| 14 | **No pricing model artifact.** ADR 0026 sets the tier structure but nothing prices the hosted motion (per-tenant flat, per-event, % of recovered variance…). VAL-01's ROI figure is the natural anchor for value-based pricing. | — | Business decision; needs a one-pager before first outreach |
| 15 | **Payables side unbuilt** (ADR 0007, Proposed): the product reconciles what the institution is owed and what Nebras charges, but the TPP-of-record *payables/net-settlement* leg is an open ADR. Relevant to Tier 2 banks acting as TPP-of-record; mostly irrelevant to insurers. | `docs/adrs/0007-tpp-of-record-payables-net-settlement.md` | Scope decision per segment |
| 16 | **Dual-role data wall labeled, not enforced** (ADR 0006, Proposed): LFI↔TPP-of-record segregation is a taxonomy without an enforcement mechanism. For dual-hat Tier 2 banks this will surface in risk assessments. | `docs/adrs/0006-lfi-tpp-data-segregation.md` | Accept/schedule before dual-hat tenants |

---

## 5. The cost-efficiency argument (why this sells to Tier 2)

The demo-profile posture is accidentally a near-perfect low-cost onboarding funnel:

1. **Zero-commitment self-qualification.** The public Integration Readiness Wizard
   (ADR 0022) lets a prospect self-score their integration effort across all ports and the
   16 profile decisions before any sales conversation — the readiness score is the
   qualification artifact.
2. **Sandbox-first onboarding at near-zero marginal cost.** The demo profile (serverless,
   sim adapters, deterministic seeded synthetic data, DEMO banner) means a prospect tenant
   can be stood up as a sandbox with no enterprise integration at all — the same posture the
   demo runs today on free-tier infrastructure. The simulator's fault injection doubles as
   guided evaluation ("watch the console catch this fee variance").
3. **Graduated go-live.** Ports move from sim to enterprise adapter one at a time
   (the M6 pattern, ADR 0024), so a Tier 2 buyer pays integration cost only for the ports
   they actually need — and in a hosted model P5/P6/P7 are the operator's problem, while a
   small institution's P1/P3/P9 needs are often "none yet" (portal-resident care surface is
   already the PRD §10 default).
4. **The ROI close.** VAL-01 turns the seeded scenario into an AED figure (liability
   exposure avoided + fee variance recovered) — a number a Tier 2 CFO can compare directly
   against a SaaS subscription. ADR 0026's economics claim — "multi-tenant, near-zero
   marginal cost per tenant" — is credible *after* HOST-01/02, and not before.

---

## 6. Risks and caveats (what a buyer's due diligence will find)

Stated plainly, because each one is discoverable and none is fatal:

1. **"Multi-tenant" is schema-true, runtime-false today.** One tenant, hardcoded; the
   cross-tenant read role exists. HOST-02 → HOST-01 close this; do not market "multi-tenant
   SaaS" until the HOST-01 isolation integration test (two tenants, one BFF, full RLS
   isolation proof) is green.
2. **Enterprise adapters are fail-closed pre-stages, not live integrations.** Only P2
   (Entra) is reference-fidelity. Honest positioning: the port-swap gate is proven by
   contract tests; no production institution has been through it yet.
3. **FAPI is an architectural contract, not a demonstrated capability** (§4.3 #9). The
   first hosted tenant's go-live requires the P6 gateway + cert custody path to be real.
4. **CI evidence gap on some historical merges** (§4.3 #12) — pre-empt with a clean
   full-pipeline re-run and the sealed release-evidence bundle.
5. **Insurance claims are currently assertions.** Until INS-01 ships and an Open Insurance
   corpus is in the data-risk register, the insurer pitch is "designed to absorb insurance"
   — not "supports insurance". Sequence outreach accordingly (banks first).
6. **Scheme-timeline pressure cuts both ways.** ADR 0026 cites release deadlines R4+
   (Apr 2026 — already passed at review date) and Corporate R5 (Sep 2026). Mandated
   participants scrambling at deadlines are motivated buyers, but the pitch must be
   truthful about what is live-today vs. HOST/INS-track.
7. **Single-operator concentration.** The whole stack currently deploys to one Cloudflare +
   Railway + Supabase demo estate (ADR 0005). A regulated hosted offering needs the
   residency-compliant production estate (§4.3 #11) and an exit/BYO-deploy story (which M6
   conveniently already is).

---

## 7. New backlog candidates raised by this review

Proposals only — adding them to `docs/backlog.yaml` is a human scope decision
(compose-don't-invent: none of these invent platform primitives).

- **REG-INS (new):** ingest an Open Insurance / Insurance Data Sharing regulation corpus
  into the data-risk register seam (`docs/governance/data-risk-register/`), mirroring the
  CPS ingestion, so insurer-facing claims trace to register entries. Natural companion to
  INS-01's spec change.
- **CERT-01 (new):** start the SOC 2 / ISO 27001 operator-certification track (scoping,
  control mapping to the already-implemented substrate, auditor selection). Longest lead
  time on the critical path to hosted revenue; the existing audit/lineage/four-eyes
  evidence makes the control-mapping unusually cheap.
- **HOST-04 (new, candidate):** white-label/theming seam for the portal (token-level brand
  swap, name/mark/config per tenant), porting the pattern already proven in
  `discovery/brand/examples/meridian-trust.design.md`. Required for the Nebras OEM motion;
  nice-to-have for direct Tier 2 SaaS.
- **EVID-01 (new, cheap):** one clean full-pipeline CI run on `main` + refreshed sealed
  release-evidence bundle as the due-diligence artifact answering the "local gates" caveat.
- **Wizard wording:** extend `services/bff/src/readiness/catalog.ts` copy to
  insurer-neutral vocabulary once INS-01 lands (P4 = "core banking / policy administration
  system", BD-xx = "adopting-institution decisions").

Also recommended: drive ADR 0006 (dual-role wall enforcement) and ADR 0007 (payables) from
Proposed to a decision before the first dual-hat Tier 2 tenant — both will surface in that
buyer's risk review.

---

## 8. Recommended go-to-market sequencing

Build order (product) interleaved with commercial milestones:

| Step | Work | Why this order |
|---|---|---|
| 1 | **VAL-01** (liability-avoided KPI + ROI screen) | Cheapest item; strengthens every motion; converts the demo into a closing tool. No substrate changes. |
| 2 | **HOST-02** (`bank_internal_view` re-scope) | Hard prerequisite for any second tenant; small, additive migration + isolation tests. |
| 3 | **HOST-01** (tenant provisioning + per-tenant §10 config) | The moment "hosted SaaS" is a true claim: two tenants, one BFF, RLS isolation proven by integration test. |
| ∥ | **HOST-03** (cert-custody ADR) + **CERT-01** (SOC 2/ISO track) + pricing one-pager | Long-lead items; start now, they gate go-live not sales conversations. |
| 4 | **First design-partner Tier 2 bank** (sandbox tenant on the demo posture → graduated port swaps) | Banks first: zero domain-model gap; the readiness wizard is the qualification funnel; discounted design-partner pricing buys the reference + the first M6 rung-④ proof (which retires risk #2/#3). |
| 5 | **INS-01** (insurance line types, quote-fee reconciliation, consent purposes) + **REG-INS** | Spec-first contract change; unlocks truthful insurer outreach. |
| 6 | **INS-02** (policy-centric care, insurer/broker personas) | Completes the insurer-facing surface. |
| 7 | **First insurer tenant** | 60+ mandated insurers, mostly with no build option at all — the least contested segment once INS-01/02 are real. |

Deliberately **not** on this path: the Console/Assurance BFF separation (only needed if the
Nebras VAS engagement becomes real — ADR 0026 defers it), Tier 1 M6 enterprise deploys
(the later upmarket motion), and the payables leg (ADR 0007 — schedule against the first
dual-hat TPP-of-record tenant, not before).

---

## 9. Bottom line

OFBO is unusually well positioned for the Tier 2/insurer BOaaS motion because the two things
that normally kill such a pivot — a single-customer data model and a compliance substrate
that exists only on slides — are already solved in the opposite direction: tenancy is in the
schema from day one, and the regulated controls are implemented and gate-enforced. What
remains is a short, already-scoped hardening track (HOST-02 → HOST-01, plus cert custody and
operator certification) before the hosted claim is true, and one spec-first domain extension
(INS-01/02) before the insurer claim is true. The recommended posture for outreach starting
now: sell the demo and the readiness wizard today, sign design partners on the sandbox
posture, and let the HOST track land before the first production tenant goes live.
