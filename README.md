# Open Finance Back Office (OFBO)

A bank-neutral back office for the internal operations a UAE bank needs to run Open Finance as a regulated business — covering **both roles**: LFI (inbound TPP traffic) and TPP-of-record (outbound TPP-as-a-Service traffic). Built against the CBUAE / Al Tareq / Nebras scheme.

> **Status:** M0–M5 delivered and demonstrable on the live demo. Milestones M0 (foundation) → M1 (substrate + demo live) → M2 (Customer Care) → M3 (Reconciliation) → M4 (Analytics) → M5 (hardening) are complete, including the full portal UI/UX-fidelity track (dark-navy institutional shell, real OFBO brand mark, demo-framed persona switch). **M6 (per-bank enterprise port-swaps) is the remaining milestone.** 127 of the 135 backlog items are done; the rest are human-gated decisions (ADRs / governance) or per-bank adoption work. The latest feature in flight is governed cross-fintech aggregation (BACKOFFICE-33 / ADR 0015 / BD-13).

## Understanding Open Finance (start here)

> New to the scheme? The same explanation ships **inside the product** as an introductory
> guide at **`/guide`** (reachable from the sign-in screen and from the "About this screen"
> help button in the top bar), with a per-screen overlay that tells you why each console
> exists. This section mirrors that guide for readers landing on the repo first.

**Open Finance, in one paragraph.** Open Finance lets a customer (the **PSU** — payment service user) give a licensed third party permission to read their bank data or initiate a payment on their behalf. The customer is always in control and can withdraw permission at any time. In the UAE this runs through one regulated ecosystem:

| Actor | What it is |
|---|---|
| **CBUAE** | The Central Bank of the UAE — the regulator. Mandates Open Finance, licenses participants, and sets the obligations the bank must evidence on demand. |
| **Al Tareq** | The trust framework: the rulebook, the FAPI 2.0 security profile (mTLS · PAR · PKCE), the consent model, and the certificate chain that lets a bank and a fintech trust each other. |
| **Nebras (the API Hub)** | The central platform every participant connects through — consent management, the TPP register, billing/settlement reports, case & dispute management. OFBO consumes Nebras surfaces; it never talks to fintechs directly. |

**The bank wears two hats — OFBO runs both.** Newcomers usually picture only the first; a discrepancy in either role is the bank's to find and fix.

- **LFI (account-holder)** — a Licensed Financial Institution that holds the customer's accounts and serves consented third-party requests. *Inbound traffic.*
- **TPP-of-record (TPP-as-a-Service)** — the bank also acts as a Third-Party Provider for its own products, consuming other banks' data on the customer's behalf, which makes it a billable, reconciled counterparty. *Outbound traffic.*

**The guardrails underneath every screen.** OFBO is a regulated control surface, not a CRUD app — four things are true everywhere because the scheme and CBUAE supervision require the bank to *prove* them:

- **Four-eyes on consequential actions** — refunds, revocations, invoice runs and regulator reports return an `approval_request` (`202`) that a second, different person must approve; an initiator can never approve their own.
- **Separation of duties** — Customer Care ≠ Finance ≠ Risk; each role sees only its screens, enforced again at the service layer (not just hidden in the UI).
- **Insert-only audit + BCBS 239 lineage** — every privileged action is appended to an immutable trail; every regulated figure carries column-level lineage (where the number came from).
- **Zero PII · secure egress · FAPI 2.0** — no real customer data ever (the demo is synthetic-only, permanently non-prod); all scheme-bound traffic leaves through one secure egress gateway (P6).

**A tour of the screens — and why each is required.** Each role only sees the screens its mandate covers (that separation is itself a control).

| Screen | What it helps you do | Why the ecosystem requires it |
|---|---|---|
| **Dashboard** | See at a glance whether the operation is healthy and whether anything needs you. | Open Finance is a live, supervised operation — the bank must know, and be able to show, it's up and reconciled. |
| **Approvals** | Approve/reject a colleague's consequential action (never your own). | The scheme treats refunds and fraud revocations as high-impact; mandatory dual control prevents a single operator — or a compromised account — causing or hiding harm. |
| **Customer Care** | Look up a PSU, see and revoke the consents they granted, manage unauthorised-payment disputes. | Consent is the foundation of Open Finance; the scheme requires fast revocation (sub-5s ack to the Nebras Consent Manager) and dispute handling. |
| **Finance — Reconciliation** | Find, claim, resolve and escalate the breaks where the bank's metering, the fintech's billing and the Nebras report disagree. | Traffic is billed and settled between participants through Nebras; the bank must reconcile and evidence it, in both roles. |
| **Analytics & Insights** | Understand fee accrual, TPP-aaS margin, data freshness and service levels. | Open Finance is a regulated business line; the bank needs trustworthy, lineage-backed numbers to run it and to show service levels are met. |
| **TPP Billing & Registry** | Keep the counterparty register in step with Nebras and run outbound invoicing (four-eyes). | As a TPP-of-record the bank is a billable participant; counterparties must be registered and traffic invoiced and settled accurately. |
| **Compliance** | Produce and approve CBUAE reports; trace any figure with column-level lineage. | CBUAE supervises participants and expects timely, accurate reporting plus provable data integrity (BCBS 239). |
| **Risk** | Spot and triage fraud/anomaly signals and respond (incl. four-eyes fraud revocation). | Opening accounts to third parties widens the fraud surface; the scheme allocates liability, so exposure must be detected before it crosses a threshold. |
| **Operations** | Keep the service inside its SLOs, manage incidents, run the Nebras case & dispute desk. | Availability and incident handling are scheme obligations — a participant that's down degrades the whole ecosystem. |
| **Agent Registry** | Register (four-eyes) and revoke the programmatic identities — service accounts, agents, MCP integrations — that hold admin scopes. | Admin-scope access is powerful whether a person or a machine wields it; least-privilege, four-eyes issuance, revocation and audit must govern non-human actors too. |
| **Audit Log** | Answer "who did what" across every operator, append-only and PII-redacted. | Accountability and non-repudiation are core to a regulated scheme; the immutable record is retained for supervision and disputes. |

These screens are not silos: a single event — say an unauthorised payment — surfaces as a **dispute** in Customer Care, a **reconciliation break** in Finance, a **risk signal** in Risk, a **case** in Operations, and a **four-eyes refund** in Approvals, linked as one audited, lineage-tracked thread. That end-to-end traceability is the point of running Open Finance from one back office.

## Live demo

Auto-deploys on every merge to `main` (`.github/workflows/deploy.yml`): BFF → Cloudflare, portal → Cloudflare (OpenNext), simulator → Railway, then the smoke acceptance suite runs against the live URLs — a broken demo fails the pipeline.

| Surface | URL |
|---|---|
| Portal (Cloudflare Workers / OpenNext) | https://ofbo-portal.michartmann.workers.dev |
| BFF (Cloudflare Worker) | https://ofbo-bff.michartmann.workers.dev |
| Nebras simulator (Railway) | https://nebras-sim-production.up.railway.app |

The demo profile (PRD §3.1) runs on free tiers with **synthetic data only** — persistent DEMO banner, deterministic seeded data, a fault-injection endpoint on the Nebras simulator (trigger a fee-variance break or liability signal live during a demo), and zero real PII. The demo is permanently non-production.

## Canon (ground truth)

| File | Purpose |
|---|---|
| `docs/PRD_Open_Finance_Back_Office.md` | Complete PRD: personas, ports model, architecture, all 80 requirements (BACKOFFICE-01..80), data model, NFRs, build sequence (M0–M6), adopting-bank decision checklist (BD-01..16) |
| `specs/backoffice-openapi.yaml` | API contract — **76 paths, 10 tags**, admin-scoped. The contract is ground truth: if the spec is wrong, change it via PR first, then tests, then code |
| `CLAUDE.md` | Build conventions: stack defaults, ports model, API conventions, per-story workflow, regulatory hard stops |
| `docs/architecture-overview.md` | Component architecture — system context, ports P1–P9, BFF feature modules, data layer, shared packages (+ `docs/diagrams/` SVGs) |
| `docs/backlog.yaml` | Machine-readable work queue (drives the autonomous build loop) |

## Architecture at a glance

pnpm monorepo. The Next.js **portal** (dark-navy institutional shell, persona scope-gated, DEMO-bannered) calls the **BFF** (Hono) over an OpenAPI-generated client; the BFF reaches every external system through **port interfaces (P1–P9)** — each with a `sim` adapter (demo) and an `enterprise` adapter (M6) selected by config, never by branching in app code. Headless scheduled jobs (reconciliation engine, liability/cert/cadence monitors) run with no public ingress. Data lives in **Postgres with row-level security from day one**, INSERT-only audit, and BCBS 239 lineage emitted at write time. Cross-fintech aggregate reads run through a **governed path** (the `bank_internal_view` role gated by a four-eyes `query_purpose_registry` — ADR 0015 / BD-13), never the single-tenant app role. See `docs/architecture-overview.md` for the full map.

```
apps/portal        Next.js portal (Stitch design system, persona scope-gated)
services/bff       Hono BFF — feature modules (E1/E2/E3) + headless worker
services/nebras-sim  Nebras API Hub simulator (+ fault injection)
packages/ports     P1–P9 port interfaces, registry, sim adapters
packages/db        Postgres stores, audit, lineage, retention, RLS (migrations 0001–0026)
packages/contracts OpenAPI-generated types + routes
packages/{redaction,synthetic-data,release-evidence}
```

## Run locally

```bash
pnpm install
pnpm gen                 # generate the OpenAPI client/types
pnpm test                # unit suite
pnpm test:integration    # integration suite (needs DATABASE_URL → a Postgres with the schema)
```

Driving the demo stack locally (BFF on :8787, Nebras sim on :8788) is covered by the `run-ofbo` workflow. Profile selection is config: `DEPLOY_PROFILE=demo|enterprise`.

## CI / quality gates

`.github/workflows/ci.yml` runs on every push/PR — a failed gate blocks merge:

| Gate | Checks |
|---|---|
| Q1 | build + unit + generated-artifact drift |
| Q2 | static analysis + SAST (lint, typecheck, semgrep) |
| Q3 | integration + contract tests, portal E2E (Playwright) |
| Q4 | security review + dependency scan |
| Q4.5 | BCBS 239 lineage validation (P7) |
| Q5 | manual prod approval — evidenced at release time via the release-evidence bundle |

## Build conventions

Work milestone by milestone (PRD §9), **one story per branch/PR**, each citing its `BACKOFFICE-NN`. Spec-first: contract + acceptance tests exist and fail before implementation; implement to green (coverage ≥80%). Compose, don't invent — no new platform primitives; genuinely-uncovered gaps raise an ADR (`docs/adrs/`) and stop for a human decision. Full rules in `CLAUDE.md`.

Per-story prompt pattern:

```
Implement BACKOFFICE-<NN> from docs/PRD_Open_Finance_Back_Office.md §7.
1. Read the requirement and the matching paths in specs/backoffice-openapi.yaml; list files you'll touch and your plan.
2. Write the contract + acceptance tests first; show me them failing.
3. Implement to green. CLAUDE.md rules apply. Branch feature/BACKOFFICE-<NN>-<slug>.
```

## Adopting bank: the path to production

M6 swaps each simulator for an enterprise adapter, port-by-port (P1–P9) — each swap must pass exactly the contract tests the simulator passed (the port-swap acceptance gate). Before M6, complete the Bank Profile: PRD §3 (ports) and §10 (decisions BD-01..16). UAE data residency, FAPI 2.0 posture (mTLS/PAR/PKCE via the egress gateway P6), and the retention/audit rules are non-negotiable hard stops.
