# Open Finance Back Office (OFBO)
## Product Requirements Document — v1.0 (Generic Seed Baseline)

| Field | Value |
|---|---|
| **Version** | 1.0 (generic seed) |
| **Date** | June 2026 |
| **Status** | Build baseline — bank-neutral; adopting bank completes the Bank Profile (§3) before build |
| **Scope** | UAE Open Finance (CBUAE / Al Tareq / Nebras API Hub), bank operating **both roles**: LFI (inbound TPP traffic) and TPP-of-record (outbound TPP-as-a-Service traffic) |
| **Companions** | `specs/backoffice-openapi.yaml` (API contract, 57 paths) · `CLAUDE.md` (build conventions) · `README.md` (build sequence) |

> **What this document is.** A complete, bank-neutral specification of the internal back office any UAE bank needs to *operate* Open Finance as a regulated business — not just pass certification. It was generalized from a production bank engagement: all institution-specific systems are expressed as **ports** (§3) that each adopting bank maps to its own estate. Everything anchored to the CBUAE scheme (Nebras, Al Tareq, RPSCS, liability framework, consent lifecycle) is kept verbatim because it applies identically to every licensed participant.

---

## 1. Product Brief

**What.** The Back Office is the internal control room for a bank's Open Finance business — the screens and services bank staff use to:

1. **Check the money** — three-way reconciliation between Nebras API Hub billing, the bank's own platform logs, and downstream fintech billing; payment-state reconciliation; consent-state drift detection.
2. **Help customers** — a PSU-centric consent view, emergency revocation, unauthorized-payment investigation with a next-business-day refund SLA (design target; statutory liability baseline is OF Regulation C 3/2025 Art 21 — exact refund-SLA instrument confirmed by bank Compliance, BD-09), and CBUAE-inquiry report generation.
3. **Watch the platform** — operations, compliance, risk, finance and executive dashboards aggregating data no individual fintech can see.

**Why.** Without it, a bank can pass CBUAE certification but cannot *run* Open Finance: Nebras fees go unverified (scheme compensation amounts of AED 200–10,000 per incident under the Limitation of Liability Model v2.1; Nebras's own cap is AED 5M of direct losses per claim), a customer-care call about a consent has no tool behind it, and liability events are discovered only on the monthly invoice. The Back Office is the gap between "compliant" and "operationally live."

**The dual-role premise.** The bank is simultaneously:
- **LFI** — its customers' accounts are accessed by third-party TPPs via Al Tareq; the bank owes consent management, CoP, refund SLAs and LFI-side liability.
- **TPP-of-record** — the bank consumes its own (or other LFIs') APIs on behalf of downstream fintech clients (TPP-as-a-Service), paying Nebras per-call fees and re-billing fintechs with margin.

The Back Office is the surface where these two roles are operationally reconciled — every reconciliation line, liability event and certification track carries the role dimension.

**Architectural posture.** No new platform. Two front-ends (an Internal Portal and a customer-care console) over the bank's existing Open Finance platform API with new admin scopes, plus three small new services (reconciliation, analytics/reports, approvals). Same gateway, same identity model, same observability as the rest of the platform.

---

## 2. Users & Personas

Eight internal personas, written in role terms only. Scope hygiene is load-bearing for audit defensibility: Customer Care holds `consents:admin` / `disputes:admin`; Finance holds `finance:*` / `billing:*` but never consent-admin; Risk holds only the narrow `consents:admin:fraud-revoke`; Compliance is read-only across data classes plus report generation. The **single exception** is the Platform Super Administrator — a deliberately constrained do-everything role (guardrails below the table).

| Persona | Surface | Core jobs | Key scopes |
|---|---|---|---|
| **OF Operations Analyst** | Internal Portal — Operations Console | Platform/Nebras health, SLA tracking, certification pipeline, onboarding-handover health, outage coordination | `platform:operations:read/write`, `certification:read` |
| **Customer Care Agent (OF)** | Customer-Care Console (port P1) | PSU consent search (bank customer ID / IBAN / Emirates ID), revoke (<5s to Nebras), unauthorized-payment investigation + next-business-day refund, complaint cases | `consents:admin`, `disputes:admin`, `audit:read` |
| **OF Compliance Officer** | Internal Portal — Compliance View | CBUAE periodic reports <10 min, inquiry bundles, 5-year retention and residency verification, regulatory release-gap tracking | `audit:read`, `compliance:reports:*` |
| **OF Finance Analyst** | Internal Portal — Reconciliation Console + Finance View | Daily three-way reconciliation, break workflow (p50 ≤2 / p90 ≤5 business days), Nebras disputes, monthly sign-off, TPP-aaS margin | `finance:reconciliation:*`, `finance:disputes:write`, `billing:read` |
| **OF Risk Analyst** | Internal Portal — Risk View | Consent/TPP anomalies, CoP mismatch trends, proactive Nebras-liability monitoring (500ms end-to-end API response SLA; the LFI's internal share is bank-configurable, default 250ms), fraud-flagged revocations, STR triggers | `risk:read`, `risk:investigations:write`, `consents:admin:fraud-revoke` |
| **Commercial Desk Head** | Internal Portal — Executive Dashboard (Commercial angle) | Cross-fintech revenue/margin by product family, pipeline, onboarding funnel | `platform:analytics:read`, `commercial:read`, `pipeline:read` |
| **OF Programme Manager** | Internal Portal — Executive Dashboard (Programme angle) + Ops Console | Adoption, LFI/TPP certification status, CBUAE mandatory-release calendar alignment, multi-entity group visibility | `platform:analytics:read`, `programme:read`, `certification:read` |
| **Platform Super Administrator** | All surfaces | Full visibility and capability across every view and operation: platform administration, RBAC/user management, threshold and configuration management, incident recovery, demo/walkthrough driving | `platform:superadmin` (union of all scopes) + every scope individually |

**Super Administrator guardrails (non-negotiable).** The role exists for platform administration, incident recovery, and demonstrations — not daily operations. (a) Assigned to at most two named individuals per environment, never to service accounts or automations. (b) `platform:superadmin` is a *marker* scope: every action it performs is High-class audited with the marker recorded, and any session under it auto-raises an informational ITSM ticket and a Risk View signal — super-admin activity is anomalous by definition. (c) **Four-eyes is never bypassed**: a super admin initiating a gated operation still requires a *different* principal to approve; self-approval is rejected at the approvals service regardless of scope. (d) Mutating actions require a recorded justification (≥20 chars). (e) Compliance reviews super-admin session logs monthly. (f) **Demo profile exception:** the super admin is the default pre-provisioned walkthrough login so every feature is showcasable from one account; guardrails (b)–(d) still run, which itself demonstrates the control story.

Existing platform personas (fintech operators, relationship managers, AI agents, PSUs) are unchanged; RM surfaces may consume read-only back-office signals.

---

## 3. Bank Profile — the ports model

Everything institution-specific is a **port**: a named integration point with a defined contract. The adopting bank maps each port to its estate before build; the Back Office core never references a vendor.

| Port | Contract | What the bank supplies |
|---|---|---|
| **P1 — Customer-Care Surface** | Console consuming `consents:admin` / `disputes:admin` / `audit:read` endpoints; short-lived tokens carrying `act` (agent identity) + `sub` (PSU) claims | Default build: **portal-resident care console** (part of the Internal Portal). Alternative: CRM-resident console (the bank's case-management platform) calling the same endpoints |
| **P2 — Enterprise IdP** | OIDC for Internal Portal sign-in; mandatory MFA via conditional-access policy; admin-scope claims minted by the platform Auth Service on token exchange | Any OIDC/SAML2 enterprise identity provider |
| **P3 — ITSM & Alerting** | REST ticket creation with team routing (Risk/Compliance, IT Support, Payment Operations); documented fallback channel (e.g., mailbox); optional parallel paging fan-out for severity-critical | The bank's ITSM platform |
| **P4 — Core Banking Adapter** | Read-only: balance polling (~60s cadence) + on-demand transaction history for reconciliation | The bank's core banking system |
| **P5 — Enterprise APM** | Consumes the platform's OpenTelemetry stream (OTel is the canonical instrumentation; the APM is a bridge, never a second instrumentation path) | The bank's APM, if any — CloudWatch/X-Ray suffice standalone |
| **P6 — Enterprise Egress Gateway** | ALL Nebras-bound traffic proxies through the bank's enterprise edge: FAPI 2.0 mTLS termination, scheme certificate chain (Root CA → Al Tareq Intermediate → bank end-entity), audit logging. **No direct egress path — non-negotiable** | The bank's existing Nebras egress gateway (every certified LFI has one) |
| **P7 — Enterprise Data Catalogue** | Column-level BCBS 239 lineage emission at write time for every Back Office table; validated by the lineage CI gate (Q4.5) | The bank's data catalogue / lineage store |
| **P8 — Bank Onboarding Handover** | The API by which bank-side customer onboarding hands off to the Open Finance platform; health metrics (success, p50/p90 latency, payload errors) surfaced in the Ops Console; entry-path dimension (`DIRECT_SIGNUP` vs `ONBOARDING_HANDOVER`) on funnel metrics | The bank's onboarding integration, if any (port is optional) |
| **P9 — Financial Management System** | Invoicing + accounts-receivable adapter: register a TPP as an invoiceable counterparty, issue monthly invoice instructions (line items from Nebras billing records), receive settlement/payment status back | The bank's ERP / financial management system |

**Configuration parameters** (set once per bank, consumed platform-wide):

| Parameter | Type | Example values |
|---|---|---|
| `channel` taxonomy | Enum on every record | `internal_retail`, `internal_sme`, `internal_corporate`, `external_direct`, `external_tpp_aas` |
| `bank_id` tenancy | Schema-level | Single entity, or multiple licensed entities in a group (each with separate LFI certification) |
| Residency region | IaC parameter | Regulator-acceptable region per the bank's data-residency assessment; UAE region for regulated production data |
| Break thresholds | Per fee class | Default: >1 fils fee variance; >0 consent-count drift |
| Report templates | Per CBUAE report type | Registered once by engineering, parameterised self-service by Compliance |
| Complaint SLA matrix | Per case class | Default: the bank's standard complaint SLA matrix until an OF-specific one lands |

### 3.1 Deployment profiles — Demo first, Enterprise later

The Back Office ships with **two deployment profiles** selected by configuration. Every port has two adapter implementations behind the same interface: a **simulator** (in-repo, runs anywhere) and an **enterprise adapter** (written during bank adoption). The application core never knows which is active — porting to a bank is adapter replacement plus the Bank Profile, never a rewrite.

**Demo profile.** Runs entirely on free/low-cost hosting with synthetic data. Purpose: showcase the build feature-by-feature, support sales/demo walkthroughs, and serve as the working reference implementation. Constraints: synthetic PSUs only (zero real PII — same hard stop as everywhere), a persistent `DEMO` watermark banner on every screen, and seeded deterministic data so demos are repeatable.

**Enterprise profile.** The bank swaps simulators for enterprise adapters port-by-port (each swap is an independent integration project), applies its Bank Profile (§3), and deploys into its regulated environment. Demo-profile components that have no enterprise role (the Nebras simulator, the mock IdP tenant) are simply not deployed.

| Port | Demo simulator | Enterprise swap |
|---|---|---|
| P1 Care surface | Portal-resident console (the default build — no simulation needed) | Optional CRM-resident console |
| P2 IdP | Free-tier hosted OIDC provider (with MFA enabled) or a bundled dev OIDC server; demo personas pre-provisioned (one login per §2 persona) | Bank's enterprise IdP |
| P3 ITSM | In-app `tickets` table + ticket-queue screen in the Ops Console | Bank's ITSM REST integration |
| P4 Core banking | Seeded synthetic accounts/transactions service | Core banking adapter |
| P5 APM | OTel → console/file exporter (or free-tier observability service) | Bank's APM bridge |
| P6 Egress gateway | **Nebras simulator** — an in-repo service emulating the API Hub surfaces the Back Office consumes: TPP Reports, Dataset, Consent Manager (incl. 5s revoke acknowledgment), Case & Dispute Management — serving deterministic synthetic UAE OF v2.1-shaped payloads, including injectable faults (timeouts, drift, fee variances) so reconciliation breaks and liability events can be demonstrated on demand | Bank's enterprise egress gateway → real Nebras |
| P7 Data catalogue | Lineage events written to a local `lineage_events` table, browsable from the Compliance View | Bank's data catalogue feed |
| P8 Onboarding handover | Synthetic funnel-event generator | Bank's onboarding integration |
| P9 Financial management | In-app invoicing module: registers TPP counterparties, renders monthly PDF invoices from simulator billing records, tracks mock settlement | Bank's ERP / AR integration |

The Nebras simulator is the most valuable demo asset: it makes every regulatory behaviour demonstrable without scheme connectivity — a consent revocation propagating in under 5 seconds, a fee-variance break appearing in the Reconciliation Console, a liability threshold crossing into the Risk View.

---

## 4. Solution Architecture

### 4.1 Services

| Service | Status | Stack guidance | Notes |
|---|---|---|---|
| **Internal Portal** (UI + BFF) | New | SPA + stateless BFF | BFF validates IdP (P2) tokens, token-exchanges to platform API. Hosts six views + (default) the care console (P1) |
| **Reconciliation Engine** | New | Scheduled job, no public ingress | **Prerequisite for payment go-live.** Relational store |
| **Analytics service** (aggregator + report generator) | New | Batch + streaming; columnar exports (Parquet) to object storage | Needed before the first CBUAE periodic-reporting cycle |
| **Customer-Care Console** | New | Per port P1 | Prerequisite for payment go-live (refund SLA) |
| **Consent / Payment services** | Extended | Existing platform services | Admin-scoped endpoints only — no domain change, no certification-surface change |
| **Auth Service** | Extended | Existing | IdP federation + admin-scope minting — **critical path, first build item** |
| **Audit / Notification services** | Extended | Existing | PSU-centric audit extension; care-surface hand-off pattern |
| **API Gateway** | Extended | Existing gateway | Admin-scope enforcement plugins; scope checks at gateway **and** service layer (defence in depth) |

### 4.2 Identity planes (three, by design)

1. **Enterprise IdP (P2)** — Internal Portal users (the seven personas). MFA mandatory.
2. **Care-surface identity** — per P1: portal-resident inherits P2; CRM-resident uses the bank's enterprise SSO with connected-app token exchange.
3. **CAAP / Al Tareq** — PSU consent, untouched. *The Back Office never bypasses PSU consent*; admin actions requiring PSU authority initiate normal Al Tareq flows.

**Consent source-of-truth invariant (centralised UAE model).** Consents are created, stored, and managed **only in the API Hub** — the bank must not maintain independent consent state. The platform's consent records (`consent_admin_event` and the audit mirror) are a synchronized operational/audit mirror of Hub state, never an authority. "Drift detection" (BACKOFFICE-30/-37) is a mirror-integrity check against the Hub, and admin revocations execute via the Hub's Consent Manager — never locally first.

OAuth2 `client_credentials` remains the service-to-service pattern, mTLS where transport requires it.

### 4.3 Integration topology

No net-new external integrations. Three Nebras endpoints today consumed manually via the Nebras Admin Portal become programmatic feeds — all via the egress gateway (P6):

| Integration | Direction | Notes |
|---|---|---|
| Nebras TPP Reports API | Outbound, FAPI 2.0 mTLS | Polling per Nebras schedule; fallback = last good snapshot + amber freshness timestamp |
| Nebras Dataset API | Outbound, FAPI 2.0 mTLS | Same pattern |
| Nebras Consent Manager | Outbound, FAPI 2.0 mTLS | Drift check (existing) + **admin revoke (new)** — 5s revoke SLA; queue + retry; P1 ITSM ticket if >5s |
| Nebras Case & Dispute Management | Outbound | Dispute case creation from reconciliation breaks and customer-care investigations |
| **Trust Framework Directory** (Raidiam-operated) | Outbound read, mTLS (`POST /token` then `GET /participants`, `GET /organisations` + `/contacts`, `/softwarestatements`, `/authorisationservers`) | Scheduled sync of scheme-registered TPPs into the consuming-TPP registry; not version-bound to the OF release cycle |
| **Nebras billing records** | Inbound (email-delivered today) | Monthly billing records ingested via verified manual upload (same pattern as the LFI reports, BACKOFFICE-67); automated feed when Nebras provides one |
| Core banking (P4) | Outbound read | Reconciliation inputs |
| ITSM (P3) | Outbound | Tickets by event type with team routing |
| Data catalogue (P7) | Outbound | Lineage emission |
| Financial management system (P9) | Outbound | TPP counterparty registration + monthly invoice instructions; settlement status back |
| IdP (P2) | Inbound OIDC | Internal Portal RP |

**Known scheme limitation.** 16 Nebras LFI Reports (availability, performance, billing, consent, payments, CoP et al. per API Hub Docs v8) are login-only with **no API equivalent**. Mitigation is a manual download + verified ingest workflow (BACKOFFICE-67) on a defined cadence; a standing request to Nebras to API-enable them is the Phase-2 ask. This applies to every LFI identically.

### 4.4 Observability & pipeline

OpenTelemetry in every service — traces, metrics, logs — propagating `x-fapi-interaction-id` end-to-end; sinks are the cloud-native stack plus the APM bridge (P5). CI/CD runs five quality gates per release: **Q1** build + unit, **Q2** static analysis + SAST, **Q3** integration + contract tests, **Q4** security review + dependency scan, **Q4.5** BCBS 239 lineage validation against P7, **Q5** manual approval to production. A release evidence bundle (control mappings, test results, scan outputs, lineage proofs) is committed to git per release.

---

## 5. Data Model

New Back Office tables are born in a relational store with row-level security (RLS) from day one. Every table carries `channel` and the schema carries `bank_id`. Lifecycle: 24-month hot → columnar warm storage → 5-year immutable; deletion attempts denied and logged.

| Table | Purpose | Audit posture |
|---|---|---|
| `reconciliation_log` | Daily three-way run: matched/unmatched/disputed counts, channel, timestamps | — |
| `reconciliation_break` | Flagged break: three source line-refs, variance, status, assignee, SLA clock, reopen count | Immutable on resolution |
| `dispute_case` | Unauthorized-payment investigation: PSU, payment ref, SLA clock, refund status/deadline | High-class audit |
| `audit_high_sensitivity` | Actor persona, target PSU, scope used, action, trace-id, PII-redacted body | **INSERT-only RLS** (no UPDATE/DELETE at any role), 5-yr |
| `compliance_report` | Generated reports: type, period, classification, storage path, integrity hash | Immutable archive, 5-yr |
| `risk_signal` | Consent/TPP anomalies, liability-threshold crossings, context | High-class on threshold change |
| `approval_request` | Four-eyes workflow: initiator, approver, operation, status, expiry | Immutable on resolution |
| `consent_admin_event` | Denormalized consent lifecycle events | Read-only materialized view of the audit table |
| `query_purpose_registry` | Governs every `bank_internal_view` cross-fintech query — **preventative** control, not audit-only | Every insert High-class |
| `tpp_counterparty` | Consuming-TPP registry: directory `OrganisationId`, legal/contact details (directory-synced), production status, financial-system registration state, invoicing status, fee accruals | High-class on registration-state change |

**Cross-fintech aggregation control.** Executive aggregates run as a dedicated `bank_internal_view` database role with SELECT-only RLS bypass; every bypass query is logged High-class with query text and row count, and must match a registered purpose in `query_purpose_registry`. No tenant-scoped fintech can ever see this output.

---

## 6. API Surface

Canonical contract: `specs/backoffice-openapi.yaml` — 57 paths, 9 tags, all on the existing platform REST API with new admin scopes (no parallel internal API).

| Tag | Paths | Scope | Notes |
|---|---|---|---|
| reconciliation | 13 | `finance:reconciliation:*` | Runs, replay, break lifecycle, monthly sign-off, thresholds, CBUAE export |
| analytics | 9 | `platform:analytics:read` | Five persona views, onboarding funnel, handover health, liability monitor |
| reports | 7 | `compliance:reports:generate` | Generate/approve/submit; PSU inquiry bundles (PDF+XLSX) |
| approvals | 5 | `approvals:*` | Shared four-eyes primitive; gated operations return `202` + approval_request |
| audit | 5 | `audit:read` | Events, lineage view, consent/PSU trails (24-month) |
| consents-admin | 5 | `consents:admin`, `:fraud-revoke` | PSU search; revoke <5s p99 to Nebras; four-eyes on bulk |
| disputes | 5 | `disputes:admin` | Next-business-day SLA; four-eyes on refund; reuses the Ozone Connect refund flow |
| risk-signals | 2 | `risk:*` | List + status patch |
| tpp-billing | 8 | `billing:read/write` | Counterparty registry + directory sync, P9 registration, billing-record ingest, reconcile-before-invoice, four-eyes invoice runs (409 if unreconciled) |

Conventions (binding, see `CLAUDE.md`): `{data, meta}` envelope; cursor pagination only; kebab-case paths / snake_case JSON; integer minor units + ISO 4217; `Idempotency-Key` header; `x-fapi-interaction-id` end-to-end.

---

## 7. Functional Requirements (BACKOFFICE-01..80)

Priorities: **Must** (build scope), **Should** (fast-follow hardening), **Could/Phase 2** (deferred). IDs are stable and must appear in every commit, PR and test that implements them.

### 7.1 Epic E1 — Reconciliation Console

| ID | Requirement | Priority | Acceptance (condensed) |
|---|---|---|---|
| BACKOFFICE-01 | Daily automated three-way reconciliation: Nebras billing datasets ↔ platform internal API logs ↔ downstream fintech billing | Must | Run completes <60 min of Nebras daily roll-up; matched/unmatched/disputed line items across all three sources written to `reconciliation_log`. Matches technically-successful calls only; applies the Commercial & Pricing Model v1.0 fee schedule (payment initiation 2.5 fils; balance/CoP-with-payment 0.5 fils incl. its bundling window — verify window duration against current scheme docs; data sharing 2.5 fils per 100 lines) |
| BACKOFFICE-02 | Break detection with configurable thresholds | Must | Variance above threshold (default >1 fils fee / >0 consent drift) creates `reconciliation_break` with all three source refs; Finance notified for fee breaks, Operations for consent breaks |
| BACKOFFICE-03 | Break investigation workflow: flag → assign → investigate → resolve/escalate | Must | Claiming transitions to `assigned`, records claimant, starts SLA clock (p50 ≤2 / p90 ≤5 business days), removes from other claimants' queues |
| BACKOFFICE-04 | Resolution outcomes: resolved-matched, resolved-internal-correction, escalated-to-nebras-dispute, escalated-to-fintech-billing | Must | Terminal-state transition with mandatory note (≥20 chars), timestamp, immutable audit record; reopen requires Compliance scope + justification |
| BACKOFFICE-05 | One-click Nebras dispute case creation from a break | Must | Creates Nebras Case & Dispute Management case via FAPI 2.0 mTLS with evidence bundle; Nebras case ID persisted; dispute state machine tracks |
| BACKOFFICE-06 | Monthly reconciliation summary and Finance sign-off | Must | Month-close job generates PDF+XLSX (breaks, resolutions, open disputes, TPP-aaS margin); Finance Analyst applies IdP-attested digital sign-off; report locked and archived 5-yr |
| BACKOFFICE-07 | TPP-as-a-Service pass-through billing and margin tracking | Must | Nebras per-call fee (bank as TPP-of-record) correlated with downstream fintech billing entry; margin computed per fintech and product family (SIP/AISP/CoP) |
| BACKOFFICE-08 | Reconciliation export for CBUAE compliance reporting | Must | CBUAE-format audit-trail export (XLSX + PDF cover) within 10 min with per-line cryptographic integrity hashes |
| BACKOFFICE-09 | Reconciliation Console SLO dashboard | Should | Open breaks by age, p50/p90 resolution time (30-day rolling), dispute pipeline, last/next run, pass rate — <1.5s p95 |
| BACKOFFICE-10 | Reconciliation replay for missed/failed runs | Should | Replay over date range from buffered source data; idempotent if sources unchanged |
| BACKOFFICE-11 | Three-source side-by-side diff view per break | Must | Nebras line, platform log line, fintech billing line with variance highlighted; linked FAPI transaction trace via `x-fapi-interaction-id` |
| BACKOFFICE-12 | Configurable break thresholds per fee class | Should | Threshold edits take effect next run, never retroactive; High-class audited (old/new values); Finance + Compliance notified |
| BACKOFFICE-13 | OTel traces per run, per line | Must | Span attributes: run_id, line_type, three sources, variance, decision |
| BACKOFFICE-14 | Reconciliation data retention lifecycle | Must | 24-mo hot → warm storage; 5-yr immutable; deletion forbidden by RLS |
| BACKOFFICE-15 | Console accessibility (WCAG 2.1 AA) | Should | Keyboard-only and screen-reader traversal of break list and detail views |

### 7.2 Epic E2 — Customer Care (Consent & Dispute Operations)

| ID | Requirement | Priority | Acceptance (condensed) |
|---|---|---|---|
| BACKOFFICE-16 | PSU-centric consent search by bank customer ID, IBAN, or Emirates ID | Must | <500ms p95; all active + historical (24-mo) consents across all TPPs with TPP identity, purpose, scope, **full CBUAE lifecycle status** (AwaitingAuthorization/Authorized/Rejected/Suspended/Consumed/Expired/Revoked), last access; search High-class audited with agent identity |
| BACKOFFICE-17 | Single-consent revocation with regulatory reason code | Must | Codes: TPP_REQUEST, CLIENT_INSTRUCTION, REGULATORY (FRAUD_SUSPECTED reserved for Risk); propagation to Nebras Consent Manager <5s p99; tokens invalidated; PSU notified; High-class audit |
| BACKOFFICE-18 | Emergency PSU-wide bulk revocation | Must | Four-eyes approved; all active consents revoked in parallel <5s total; single grouped audit record with all revocation IDs; consolidated PSU notification |
| BACKOFFICE-19 | 24-month per-PSU consent audit-trail timeline | Must | Chronological full-lifecycle timeline across all TPPs with one-click drill-down to full audit records |
| BACKOFFICE-20 | Unauthorized-payment investigation workflow | Must | From PSU payment history: consent-validity-at-time-of-payment, Risk Information Block, CoP outcome, IPP payment trace, one-click dispute creation linked to Nebras Case & Dispute Management (reads via existing LFI/TPP API services — reuse, not rebuild) |
| BACKOFFICE-21 | Next-business-day refund for unauthorized payments | Must | Four-eyes approved refund instruction queued; case → `refund_initiated`; regulatory-SLA timer recorded for compliance reporting. SLA target: end of next business day (statutory baseline OF Reg C 3/2025 Art 21; exact refund-SLA instrument confirmed per BD-09) |
| BACKOFFICE-22 | Fraud-suspected revocation (Risk narrow scope) | Must | `consents:admin:fraud-revoke` only; <5s propagation; PSU notification deferred per fraud policy; Compliance notified; STR draft auto-created in the bank's STR workflow |
| BACKOFFICE-23 | CBUAE inquiry response per PSU | Must | PDF+XLSX bundle <10 min: 24-mo consent trail, payment records, CoP outcomes, disputes — with line-level integrity hashes |
| BACKOFFICE-24 | Complaint case management lifecycle | Should | open → in-progress → escalated → resolved → closed; SLA timers per the bank's complaint SLA matrix; linked to consent/payment/dispute records |
| BACKOFFICE-25 | Care-surface token minting with `act` + `sub` claims | Must | Console-originated API calls carry agent identity (`act`) and PSU (`sub`); tokens ≤15 min, request-scoped |
| BACKOFFICE-26 | Console design-system + Al Tareq brand conformance | Should | No critical design findings; Al Tareq CX/brand guidelines applied where PSU-facing artefacts surface |
| BACKOFFICE-61 | Multi-authorisation payment-consent visibility | Should | Full authoriser list with per-authoriser status and pending threshold; multi-auth revocation = single propagation within the 5s SLA |
| BACKOFFICE-62 | Refund via the formal Ozone Connect refund flow | Must | `GET /payment-consents/{consentId}/refund` family via the egress gateway (P6); 5 IPP status codes tracked; timestamp recorded as RPSCS SLA evidence (existing handler reuse) |
| BACKOFFICE-63 | AML GO portal submission for STR drafts | Should (Ph2) | Approved STR drafts flow to the CBUAE AML GO portal via the bank's existing STR workflow — the Back Office never submits directly |
| BACKOFFICE-64 | Call/transcript linkage on dispute cases | Should | `originating_call_id` links the contact-centre recording via the bank's existing integration; same RBAC posture as the dispute; null for non-voice channels |

### 7.3 Epic E3 — Analytics & Insights

| ID | Requirement | Priority | Acceptance (condensed) |
|---|---|---|---|
| BACKOFFICE-27 | Single consolidated Executive Dashboard, persona-aware angles | Must | <1.5s p95: cross-fintech consent volumes, payment volumes + success rate, revenue per product family, TPP-aaS margin, integration pipeline, onboarding funnel. Two pivotable angles: *Commercial* (revenue/margin/pipeline) and *Programme* (adoption/certification/release calendar). One canonical dashboard |
| BACKOFFICE-28 | Operations Console for platform health | Must | Nebras connectivity + response-time SLA tracking (500ms end-to-end; LFI internal allocation bank-configurable, default 250ms), certification status **per role** (LFI path: Sandbox → Pre-Prod CX → Prod → Live-Proving ≥2 TPPs; TPP path: FAPI RP cert per app + Functional + CX + Live-Proving ≥1 LFI), TPP onboarding pipeline, onboarding-handover health, active outages |
| BACKOFFICE-29 | Compliance View | Must | Consent volumes with one-click periodic-report generation, residency posture, retention status, dispute + STR backlogs, inquiry history, delivery-vs-CBUAE-release-calendar gap |
| BACKOFFICE-30 | Risk View | Must | Consent anomaly signals (frequency, platform↔Nebras drift), TPP behavioural anomalies (volume spikes, off-pattern timing, CoP mismatch trends), proactive liability monitor |
| BACKOFFICE-31 | Finance View | Must | MTD Nebras fee accrual, TPP-aaS margin by fintech and product family, open dispute count, deep-link to Reconciliation Console |
| BACKOFFICE-32 | Nebras TPP Reports + Dataset API ingestion | Must | Scheduled FAPI 2.0 mTLS polling → Parquet on object storage → materialized aggregates refreshed <5 min p95 of publication; Nebras rate limits respected with exponential back-off |
| BACKOFFICE-33 | Cross-fintech aggregation via `bank_internal_view` role | Must | SELECT-only RLS bypass; every query High-class logged (text + row count) and matched against `query_purpose_registry`; output invisible to tenant-scoped fintechs |
| BACKOFFICE-34 | Onboarding funnel metric surfacing | Must | Five metrics (cycle time, handover count, stage abandonment, cross-sell conversion, entry-path mix) with drill-down by entry path (DIRECT_SIGNUP vs ONBOARDING_HANDOVER) |
| BACKOFFICE-35 | Self-service CBUAE periodic report generation | Must | Compliance parameterises pre-registered templates (period, scope, classification, format); <10 min p95; PDF+XLSX; archived 5-yr; CBUAE-bound reports require four-eyes before submission; engineering only defines templates |
| BACKOFFICE-36 | Proactive Nebras-liability event monitor (threshold-based) | Must | Signals keyed by issue × liable party (**LFI or TPP — the bank plays both roles**) × scheme amount per the Limitation of Liability Model v2.1 (consent-state failure 500; revocation failure 350; SCA/auth error 500; data breach 750; SLA-execution failure tiered 350/250/200 by delay; consumer-protection violation 1,000; deprecation mismanagement 2,500; LFI breaking-change 5,000; fraud-prevention failure 10,000); ITSM ticket to Risk + Ops; ingests liability events from both LFI-side and TPP-side services; thresholds configurable per class |
| BACKOFFICE-37 | Consent-pattern anomaly detection | Must | Streaming detection (e.g., consent revoked+re-granted >5×/24h per PSU; >100 PSU lookups/agent/hour) → Risk signal with context; session flagged |
| BACKOFFICE-38 | TPP behavioural profiling | Should | 3σ baseline deviations (volume, hour-of-day, CoP mismatch spikes) → profiling signal in Risk View |
| BACKOFFICE-39 | Programme-level reporting view | Must | Certification status, TPP onboarding readiness, CBUAE mandatory-release calendar alignment (delivery-vs-deadline gap), multi-entity group visibility where the bank operates several licensed entities |
| BACKOFFICE-40 | Data-freshness indicator on every aggregated view | Must | Source publish time + view refresh time; amber when older than threshold (default 2× source cadence) with cause tooltip |
| BACKOFFICE-41 | Analytics exports (PDF/XLSX/CSV) | Should | <30s p95; integrity hash; requester identity logged |
| BACKOFFICE-42 | Audit-trail drill-down from Compliance and Risk Views | Must | Signal → underlying High-class audit record with `audit:read` enforcement; drill-down itself logged |
| BACKOFFICE-65 | Predictive liability forecasting | Could (Ph2) | 24h-ahead liability probability per class from ≥90 days telemetry; regulated AI artefact (model card, drift monitoring, recertification); threshold monitor continues as deterministic fallback |
| BACKOFFICE-66 | Scheme certificate expiry monitoring | Should | Root CA → Al Tareq Intermediate → bank end-entity chain: amber 60d, red + ITSM ticket 30d, critical ticket + audit entry 7d |
| BACKOFFICE-67 | Manual cadence ingest of the 16 login-only Nebras LFI Reports | Must | Defined cadence (daily availability/performance, weekly consent, monthly billing); upload writes `compliance_report` record with integrity hash + lineage emission; missed cadence raises ITSM ticket + Risk signal |
| BACKOFFICE-68 | Dynamic Account Opening reconciliation coverage | Should | DAO API calls included in three-way matching; data-sharing-fee thresholds as default until DAO volumes observed |
| BACKOFFICE-69 | CAAP user registration/deregistration audit | Should | High-class record per register/deregister event; streaming anomaly watch (e.g., >10 registrations/device/hour) |
| BACKOFFICE-70 | LFI Ozone Connect health-check surfacing | Could | `GET /health` status, uptime, last failure on the Ops Console platform-health screen |

### 7.4 Epic E4 — Cross-Cutting Substrate (build first)

| ID | Requirement | Priority | Acceptance (condensed) |
|---|---|---|---|
| BACKOFFICE-43 | RBAC enforcement against the scope inventory | Must | Every action verified against required scope; 403 + audited denial (persona, attempted scope, reason). `platform:superadmin` (BACKOFFICE-80) satisfies any scope check but stamps the marker on the audit record |
| BACKOFFICE-44 | Four-eyes approval flow for high-blast-radius operations | Must | Bulk revocation, CBUAE-bound report submission (+ any bank-policy additions): pending state, second authorised principal approves, bounded window (default 2 business hours), timeout reverts |
| BACKOFFICE-45 | High-class audit trail, append-only | Must | `audit_high_sensitivity` INSERT-only RLS at every role incl. superuser; persona, target PSU, scope, timestamp, trace-id, PII-redacted body |
| BACKOFFICE-46 | ITSM ticket-raising for anomalous audit patterns | Must | Threshold-crossed anomalies (PSU-lookup volume, repeated 403s, off-hours admin use) → ticket with team routing; session flagged in Risk View; optional parallel paging for severity-critical |
| BACKOFFICE-47 | Mandatory MFA on every Internal Portal sign-in | Must | IdP conditional-access policy; no MFA-skip; failures audited |
| BACKOFFICE-48 | OTel emission, end-to-end trace propagation | Must | Spans/metrics/logs per request via `x-fapi-interaction-id`; cloud-native sinks + APM bridge (P5) |
| BACKOFFICE-49 | BCBS 239 lineage emission at write time | Must | Column-level lineage to the data catalogue (P7) on every new-table write; validated by gate Q4.5; readable from Compliance View |
| BACKOFFICE-50 | 5-year retention across all Back Office data | Must | 24-mo hot → warm; 5-yr queryable + immutable; no deletion path; attempts denied + High-class logged |
| BACKOFFICE-51 | PII redaction at log emission and in non-prod | Must | Emirates ID, names, account numbers, IBAN masked via shared redaction library; prod PII only in audit-class records |
| BACKOFFICE-52 | Service-to-service mTLS via the gateway | Must | Non-mTLS calls 403 + logged |
| BACKOFFICE-53 | Agentic spend-control for admin-scope MCP tools | Could (Ph2) | Per-agent caps, allowlists, per-session approval thresholds at the gateway |
| BACKOFFICE-54 | Data-classification metadata on every record | Must | internal-confidential / confidential-restricted / restricted; mismatches trigger Compliance review |
| BACKOFFICE-55 | Region-parameterised deployment from day one | Must | Same IaC module deploys to any approved region per the bank's residency assessment |
| BACKOFFICE-56 | Quality gates Q1–Q5 (+Q4.5) per release | Must | Build+unit / static+SAST / integration+contract / security+deps / lineage / manual prod approval; failed gate blocks merge |
| BACKOFFICE-57 | Release evidence bundle committed to git | Must | Control mappings, test results, scan outputs, lineage proofs, git-anchored per release tag |
| BACKOFFICE-58 | SLO observability in the Operations Console | Should | Budget burn rate, error budget remaining, SLO target — no separate APM login |
| BACKOFFICE-59 | Training environment for Customer Care | Could (Ph2) | Synthetic-PSU dataset mirroring production; training actions never touch production audit |
| BACKOFFICE-60 | Programmatic admin-scope access for internal automation | Could (Ph2) | DCR-registered automations with four-eyes-approved registration; none in initial build |

### 7.5 Epic E5 — Integration enablers

Nebras feeds via the egress gateway (P6), care-surface connectivity (P1), core banking read (P4), data catalogue (P7), IdP federation (P2), APM bridge (P5), ITSM (P3), financial management system (P9), Trust Framework Directory sync. These have the longest external lead times — start them first.

### 7.6 Epic E6 — Scheme Interaction & TPP Billing

Derived from the Nebras Interaction Guide for LFIs/TPPs (v4, Mar 2025) and the Trust Framework Directory APIs. The guide pre-dates v2.1-final/API Hub v8 — **specific SLAs, contacts, and process details must be re-verified against current scheme documentation before becoming acceptance criteria** (BD-15/BD-16). The TPP-billing model below reflects current operational reality: the LFI receives monthly billing records from Nebras (by email) and must itself issue invoices to each consuming TPP.

| ID | Requirement | Priority | Acceptance (condensed) |
|---|---|---|---|
| BACKOFFICE-71 | Consuming-TPP registry with Trust Framework Directory sync | Must | Scheduled sync (via P6, mTLS directory token) of `GET /participants` + `GET /organisations` (+ `/contacts`, `/softwarestatements`, `/authorisationservers`) into `tpp_counterparty`; new, changed, and decommissioned TPPs flagged in the Ops Console; the registry is the bank-side master list of TPPs consuming the bank's LFI APIs — scheme registration is automatic on the API Hub, bank-side registration is not |
| BACKOFFICE-72 | TPP financial-system onboarding workflow | Must | When a TPP is detected active in production (directory presence + first observed traffic in the bank's API logs), an onboarding task is raised to register it as an invoiceable counterparty in the financial management system (P9), seeded with directory org details; registration state tracked on `tpp_counterparty`; **unbilled-traffic alert**: traffic observed from a TPP with no completed financial-system registration raises an ITSM ticket + Finance View signal |
| BACKOFFICE-73 | Monthly TPP invoicing from Nebras billing records — **reconcile before invoice** | Must | Pipeline order is binding: (1) Nebras monthly billing records ingested (verified manual upload; integrity hash + lineage, same pattern as BACKOFFICE-67); (2) records reconciled against the bank's **own** API logs/metering per consuming TPP — Nebras figures are never blindly trusted; (3) variances above threshold create `reconciliation_break` records (standard E1 workflow) and a Nebras billing query within the 30-day dispute window; (4) only reconciled-clean or resolved lines flow into invoice instructions to P9 — disputed lines are withheld from the TPP's invoice and carried to the next cycle or credit-noted on resolution; (5) receivables/settlement tracked, incl. net-settlement effects where the bank also owes Nebras fees as TPP-of-record. Month-close sign-off (BACKOFFICE-06) covers both payables and receivables sides |
| BACKOFFICE-74 | Trust Framework participant administration | Should | Registry of the bank's own directory roles (Org Admin, PBC, PTC, STC) with named holders, individual + organisational T&C/DocuSign status, and a turnover workflow (role-holder departure triggers replacement nomination); onboarding-stage SLA tracking per the Interaction Guide |
| BACKOFFICE-75 | Respondent-side dispute scheme clocks | Must | When the bank is the respondent in a Nebras-raised dispute: response within 3 business days, formal resolution within 15 business days, appeal within 3 business days of verdict, implementation within 3 business days of final verdict; `dispute_case` carries these clocks with amber/red breach warnings; breach risk surfaced to Compliance (supervisory-action exposure) |
| BACKOFFICE-76 | Cross-scheme dispute guard (Aani / Al Tareq) | Should | OF-initiated inter-bank payment disputes record a cross-scheme reference (Aani case ID where one exists); a double-compensation check blocks settling the same direct loss in both schemes; the 2-hour Aani fund-recall window is surfaced in unauthorized-payment triage; consumer-protection-authority escalation (e.g., Sanadak) recordable on the case |
| BACKOFFICE-77 | Nebras fraud-incident reporting and scheme-imposed holds | Must | The fraud workflow (BACKOFFICE-22) includes a "report to Nebras helpdesk" step with case-reference capture; scheme-imposed holds/temporary revocations on the bank (systemic-fraud P1 events) are surfaced in Ops + Risk Views; customer operational-pause state tracked until fraud resolution; Nebras P1–P4 severity taxonomy mapped to the ITSM (P3) priority scheme |
| BACKOFFICE-78 | Outbound downtime and change notifications | Must | Planned bank maintenance/version releases trigger a notification workflow to Nebras ≥10 days in advance with acknowledgment tracking; breaking changes additionally enforce the 30-day notice + dual-running checklist (mitigates the AED 5,000 liability class BACKOFFICE-36 only monitors); LFI downtime notices propagate to downstream TPP-aaS customers; Trust Framework status pages ingested into the Ops Console |
| BACKOFFICE-79 | Nebras service-desk case tracking | Should | Any case raised with the Nebras service desk (incident, billing query, onboarding, general) is trackable in the Ops Console by Nebras case reference with type, priority, and the Interaction Guide SLA table applied; linked to the originating break, dispute, or signal where one exists |
| BACKOFFICE-80 | Platform Super Administrator role with mandatory guardrails | Must | `platform:superadmin` grants the union of all scopes across all surfaces. Guardrails enforced in code, not policy: marker scope recorded on every High-class audit record; active super-admin session auto-raises an informational ITSM ticket + Risk View signal; four-eyes self-approval rejected at the approvals service regardless of scope; mutating actions require ≥20-char justification; role assignable only to named human principals (registration of a service account with this scope is rejected); monthly Compliance review query pre-built in the Compliance View. Demo profile: super admin is the default pre-provisioned walkthrough login with guardrails live |

---

## 8. Non-Functional Requirements (highlights of 40)

| Class | Targets |
|---|---|
| Performance | Portal TTI <1.5s p95 · consent lookup <500ms p95 · reconciliation run <60 min · report generation <10 min · revoke propagation <5s p99 · anomaly detection <1 min |
| Availability | Internal Portal 99.5% business hours / 99.0% off-hours · care surface 99.9% · Reconciliation Engine 99% (tolerates 24h outage) |
| Security | FAPI 2.0 mTLS to Nebras · service-to-service mTLS · AES-256 at rest · HSM-held production scheme keys · mandatory MFA · INSERT-only audit · scope checks at gateway AND service layer |
| Regulatory | ≥5-yr record retention, promptly available to CBUAE (OF Reg C 3/2025 **Art 13** — verified) · ≥99% refunds by end of next business day (design target; instrument per BD-09) · BCBS 239 lineage at write time · zero PII leakage in operational logs/telemetry |

---

## 9. Build Sequence (milestones, not calendar)

Each milestone gates the next; one feature at a time within a milestone. This is the order an AI-assisted build (e.g., Claude Code, one story per session) should follow. **Deploy early, deploy always:** the demo environment (§3.1) goes live at M1 and every merged story is visible in it thereafter — the demo *is* the showcase of the gradual build.

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Repo foundation** | Monorepo scaffold, CI with gates Q1–Q3, OpenAPI client generation + failing contract stubs for all 57 paths, relational schema (10 tables, RLS, INSERT-only audit), synthetic test data + seeded demo dataset, port interfaces defined with simulator stubs | CI green on empty implementations; schema applied to the free-tier database; zero real PII anywhere |
| **M1 — Substrate + demo goes live (E4)** | IdP federation (P2 simulator) + admin-scope minting, scope enforcement middleware (BFF + service layer), audit write path + PII redaction library, four-eyes primitive, `query_purpose_registry`, **Nebras simulator v1** (consent + reports surfaces), ITSM simulator, demo deployment pipeline (auto-deploy on merge) | **Demo URL live:** persona login (MFA) → portal shell → admin-scoped echo; audit record emitted and visible; DEMO banner present |
| **M2 — Customer Care (E2) — first feature** | PSU-centric search, single/bulk/fraud revocations with reason codes, 24-month audit timeline, unauthorized-payment investigation, dispute + refund flow (Nebras simulator acknowledges revokes <5s and tracks dispute/refund states) | BACKOFFICE-16..23, -25, -62 green; demo walkthrough: search a synthetic PSU → revoke a consent → open a dispute → four-eyes refund → audit trail shows it all |
| **M3 — Reconciliation (E1)** | Matching core against Nebras-simulator billing datasets (with injectable fee variances), break workflow, three-source diff view, monthly close, CBUAE export | BACKOFFICE-01..08, -11, -13, -14 green; demo walkthrough: inject a fee variance → break appears → claim → resolve/escalate → month-close report |
| **M4 — Analytics & Reports (E3)** | Ingestion from the simulator, aggregation under `bank_internal_view`, five views, Report Generator, liability monitor (simulator-injectable threshold crossings), manual LFI-report ingest | BACKOFFICE-27..37, -39, -40, -42, -67 green; demo walkthrough: liability event fires → Risk View signal → ITSM ticket in queue |
| **M3a — TPP Billing (E6 core)** | Trust Framework Directory sync + consuming-TPP registry (-71), financial-system onboarding workflow with unbilled-traffic alert (-72), monthly TPP invoicing from Nebras billing records (-73), respondent-side dispute clocks (-75) | Demo walkthrough: new TPP appears in directory sim → onboarding task → registered in P9 sim → billing records ingested → invoices rendered per TPP → reconciliation ties out |
| **M4a — Scheme operations (E6 rest)** | Nebras fraud reporting + scheme-imposed holds (-77), outbound downtime/change notifications (-78); Should items -74, -76, -79 land in M5 | Breaking-change checklist demonstrable; hold/pause states visible in Ops + Risk Views |
| **M5 — Hardening** | All Should items (incl. -74, -76, -79), accessibility, SLO surfacing, certificate-expiry monitor, DAO coverage, CAAP audit | ≥90% first-time gate pass; demo environment passes the full six-view walkthrough |
| **M6 — Enterprise adoption (per bank)** | Swap simulators for enterprise adapters port-by-port (P2 IdP → P6 egress/real Nebras → P3 ITSM → P4 core banking → P7 catalogue → optional P1 CRM console), apply Bank Profile, deploy to the bank's regulated environment | Each swapped port passes the same contract tests the simulator passed; certification posture unchanged |

> **Note on go-live blockers.** The demo-first ordering puts Customer Care before Reconciliation. For an actual bank payment go-live (M6), **both** E1 and E2 remain prerequisites — the ordering here optimizes showcase value during the build, not regulatory sequencing.

---

## 10. Adopting-Bank Decision Checklist (complete before M1)

| # | Decision | Default if undecided |
|---|---|---|
| BD-01 | IdP for the Internal Portal (P2) | — (blocks M1; decide first) |
| BD-02 | Care surface: portal-resident or CRM-resident (P1) | Portal-resident (endpoints identical either way) |
| BD-03 | Fraud-revoke scope: narrow single-scope or four-eyes on every fraud revoke | Four-eyes (stricter) |
| BD-04 | ITSM platform + team routing map (P3) | — (M1; email fallback documented meanwhile) |
| BD-05 | Channel taxonomy values | internal_retail / internal_sme / internal_corporate / external_direct / external_tpp_aas |
| BD-06 | Residency region(s) + classification triggers | UAE region for regulated production data |
| BD-07 | Nebras API rate limits confirmed with scheme | Exponential back-off, conservative cadence |
| BD-08 | CBUAE periodic-report templates + submission channel | PDF + XLSX; manual submission until confirmed |
| BD-09 | Refund-SLA instrument confirmation by bank Compliance (retention is settled: OF Reg C 3/2025 Art 13, ≥5 years — verified Jun 2026) | Build on next-business-day refund as the SLA target; Art 21 liability baseline applies regardless |
| BD-10 | `Suspended` consent state implemented in the bank's platform (7-state lifecycle) | Build 7-state model; feature-flag Suspended UI |
| BD-11 | Complaint SLA matrix for OF cases | Bank's standard complaint matrix |
| BD-12 | Multi-entity (`bank_id`) scope: single entity or group | Single entity; schema supports group |
| BD-13 | Cross-fintech aggregation governance sign-off (data governance + compliance) for `bank_internal_view` | — (blocks BACKOFFICE-33 only; sequence single-fintech views first) |
| BD-14 | Demo hosting stack (demo profile only — not a bank decision) | Three-service default: Cloudflare (portal/BFF + cron) + Supabase (Postgres/RLS + Auth + storage) + Railway (simulator + jobs); see README |
| BD-15 | LFI-to-TPP fee collection model confirmation: LFI-issued invoices from emailed Nebras billing records (current operational reality, BACKOFFICE-73) vs Nebras-collected pass-through with net settlement (Interaction Guide v4 §5.11/5.13) — confirm the current scheme arrangement and whether both flows co-exist | Build BACKOFFICE-73 on the LFI-issued-invoice model; keep net-settlement reconciliation in scope |
| BD-16 | Re-verify Interaction Guide v4 figures against current scheme docs: dispute/respondent clocks, incident P1–P4 SLAs, notification notice periods, service-desk channels | Build on v4 figures as defaults; clocks configurable per class |

---

## Appendix A — Glossary

**LFI** Licensed Financial Institution (the bank, inbound role) · **TPP** Third-Party Provider (the bank's outbound role for TPP-as-a-Service) · **PSU** Payment Service User (the bank's customer) · **Nebras** the CBUAE Open Finance platform operator (API Hub) · **Al Tareq** the CBUAE Open Finance scheme/trust framework · **CoP** Confirmation of Payee · **SIP** Single Instant Payment · **AISP** Account Information Service · **CAAP** the scheme's centralized authentication & authorization platform · **Ozone Connect** the scheme's LFI connection standard · **RPSCS** Retail Payment Services & Card Schemes regulation · **PDPL** UAE Personal Data Protection Law · **BCBS 239** risk-data aggregation and lineage principles · **STR** Suspicious Transaction Report · **AML GO** the CBUAE AML reporting portal · **IPP** Instant Payments Platform · **DAO** Dynamic Account Opening · **High-class audit** events written to the INSERT-only `audit_high_sensitivity` table.
