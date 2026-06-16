# Open Finance Back Office (OFBO) — Build Conventions

Bank-neutral back office for UAE Open Finance (CBUAE / Al Tareq / Nebras), for a bank operating both the LFI and TPP-of-record roles. Spec canon: `docs/PRD_Open_Finance_Back_Office.md` + `specs/backoffice-openapi.yaml`. The OpenAPI contract is ground truth — if the spec is wrong, change the spec via PR first, then the tests, then the code.

## Stack (defaults — change only via an ADR in docs/adrs/)

- **Frontend:** React/Next.js (TypeScript), TanStack Query, OpenAPI-generated client. Vitest + Testing Library + Playwright.
- **UI/UX reference (binding):** build **every** portal screen — anywhere, not just the UI-00..09 track — against the **Stitch** project (`8050269076066130289`, "Regulated Institutional Interface") as the appearance reference. Division of truth: **Stitch = layout + design tokens**; **`specs/backoffice-openapi.yaml` = behaviour + data**. Screens are token-only (no raw hex/px), OpenAPI-bound (no Stitch mock values), DEMO-bannered, persona scope-gated, zero PII, four-eyes via `202` + `approval_request` (never inline). Cite the Stitch screen id in the PR; push token/design edits back via `upload_design_md`. If a needed screen isn't in Stitch, generate it there first.
- **Backend:** Node.js/TypeScript services. Reconciliation Engine and analytics are headless scheduled jobs (no public ingress).
- **Data:** Relational store (PostgreSQL-compatible) with row-level security from day one for all Back Office tables. Columnar warm storage (Parquet on object storage) for the 24-month+ tier.
- **Gateway:** The bank's existing API gateway; admin-scope enforcement at the gateway AND the service layer (defence in depth).
- **Observability:** OpenTelemetry everywhere; `x-fapi-interaction-id` propagated end-to-end. Enterprise APM is a bridge off the OTel stream, never a second instrumentation path.
- **IaC:** Terraform, region-parameterised.
- **CI/CD:** Quality gates per release — Q1 build+unit, Q2 static analysis+SAST, Q3 integration+contract tests, Q4 security review+dependency scan, Q4.5 BCBS 239 lineage validation, Q5 manual prod approval. Failed gate blocks merge. Release evidence bundle committed to git.

## Ports — never hardcode a vendor

Institution-specific systems are ports (PRD §3). Code against the port interface; the bank's mapping lives in configuration:
P1 customer-care surface · P2 enterprise IdP (OIDC) · P3 ITSM/alerting · P4 core banking adapter · P5 enterprise APM · P6 enterprise egress gateway (ALL Nebras-bound traffic; no direct egress — non-negotiable) · P7 data catalogue (lineage) · P8 onboarding handover · P9 financial management system (TPP counterparty registration + invoicing).

## Deployment profiles & adapters (PRD §3.1)

- Every port has TWO adapter implementations behind one interface: `adapters/<port>/sim/` (demo profile) and `adapters/<port>/enterprise/` (written at bank adoption, stub initially). Profile selection is config (`DEPLOY_PROFILE=demo|enterprise`) — application core code NEVER branches on profile.
- The **Nebras simulator** (`services/nebras-sim`) emulates the API Hub surfaces we consume (TPP Reports, Dataset, Consent Manager with <5s revoke acknowledgment, Case & Dispute Management) with deterministic synthetic UAE OF v2.1-shaped payloads and **injectable faults** (timeouts, consent drift, fee variances, liability-threshold crossings) via an admin endpoint — demos must be able to trigger breaks and signals on demand.
- Contract tests run against the port INTERFACE, so they bind both adapters: an enterprise adapter must pass exactly the tests the simulator passes (that is the port-swap acceptance gate, M6).
- Demo profile: seeded deterministic demo dataset; persistent DEMO banner on every screen; free-tier-friendly (serverless/sleep-tolerant — scheduled jobs must be resumable and idempotent); scope enforcement lives in BFF middleware + service layer (no enterprise gateway in demo — the double-enforcement rule still holds, the BFF is the first layer).
- Synthetic data only in BOTH profiles' non-prod. The demo environment is permanently non-prod: zero real PII, ever.

## Build order

M0 foundation → M1 substrate + demo deployment live (auto-deploy on merge) → **M2 Customer Care (E2) — first feature** → M3 Reconciliation (E1) → M4 Analytics (E3) → M5 hardening → M6 enterprise port-swaps. Every merged story must be demonstrable at the demo URL.

## API conventions (binding)

- Response envelope: `{ "data": { ... }, "meta": { "request_id", "timestamp" } }`
- Errors: `{ "error": { "code", "message", "remediation", "docs_url" } }`
- Cursor-based pagination only (no offset)
- kebab-case paths, snake_case JSON fields
- IDs: UUID v4
- Money: integer minor units + ISO 4217 (`{ "amount": 150000, "currency": "AED" }`)
- Idempotency: `Idempotency-Key` header (24h window)
- Four-eyes-gated operations return `202` + `approval_request` — never execute inline

## Workflow (every story)

1. One story per session/branch: `feature/BACKOFFICE-NN-short-name`. Follow the milestone order in PRD §9 (M0 → M5); E4 substrate before features.
2. Spec first: contract tests from the OpenAPI paths + the requirement's acceptance criteria MUST exist and fail before implementation.
3. Implement to green. Coverage ≥80%. Integration tests hit real stores (local/containerised).
4. Every commit and PR cites the BACKOFFICE-ID.
5. Audit-relevant operations: emit to `audit_high_sensitivity` (INSERT-only), redact PII at emission, propagate the trace id. Lineage emission (Q4.5) is part of each story's Definition of Done — never retrofit.
6. Compose, don't invent: no new platform primitives (gateways, auth paths, approval mechanisms). Extensions only. If something seems genuinely uncovered, raise an ADR and stop — humans decide.

## Hard stops (regulatory — non-negotiable)

- No PII in browser storage, operational logs, fixtures, test names, or telemetry. Synthetic test data only (no real PSU data, ever).
- FAPI 2.0 posture untouched: mTLS, PAR, PKCE; scheme certificate chain handled by the egress gateway (P6).
- Retention: INSERT-only audit, 24-month hot / 5-year immutable; no deletion path for regulated records.
- Scope hygiene per PRD §2: Customer Care ≠ Finance ≠ Risk scopes; the persona scope matrix is load-bearing — granting beyond it is an automatic review FAIL.
- UAE data residency for regulated production data; region is an IaC parameter.
- The Back Office never bypasses PSU consent; admin actions requiring PSU authority initiate normal Al Tareq flows.
- Adopting-bank defaults (PRD §10) are binding until the bank overrides them: 2-hour approval expiry, SLA clocks pause weekends, four-eyes on fraud revoke, portal-resident care surface.
