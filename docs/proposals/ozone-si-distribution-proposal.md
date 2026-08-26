# Open Finance operations, out of the box

### A distribution partnership between MiddleLeap and Ozone

*Ozone connects the market to Open Finance. This partnership lets the market **run** it.*

- **Prepared by:** MiddleLeap — independent advisory and build partner, Dubai
- **Prepared for:** Ozone API — technology provider behind the UAE Open Finance API Hub
- **Status:** Discussion draft for a first working session · commercials indicative, for negotiation
- **Companion records:** ADR 0026 (accepted commercial positioning) · ADR 0027 (this partnership, proposed) · `multitenant-platform-blueprint.md` · `ozone-si-enablement-pack.md` · `ozone-channel-nebras-cbuae-note.md`

---

## 1. Executive summary

Ozone has already won the hard part of UAE Open Finance: the connectivity and trust layer. The
API Hub authorises every consent, issues every token, and mediates every call between a TPP and
an LFI; Ozone Connect gets each licensed institution certified and on the network. That is the
control plane, and it is Ozone's.

Connectivity is necessary but not sufficient. A bank or insurer can pass CBUAE certification and
still be unable to *operate* Open Finance the next morning: the API-Hub fees arrive unverified,
the 16 login-only LFI reports go unread, a customer-care call about a consent has no tool behind
it, an unauthorised-payment refund has no SLA-governed workflow, and a liability event is
discovered only on the monthly invoice. This is the **execution layer** — the back office that
turns *certified* into *operationally live* — and today the mandated long tail has no way to
build it.

MiddleLeap has built that layer. The **Open Finance Back Office (OFBO)** is a bank-neutral,
multi-tenant operations platform that runs an institution's Open Finance in both roles it must
play — LFI for inbound consented traffic, and TPP-of-record for the fintechs it hosts. It is
demonstrable today on a live, seeded demo, built vendor-neutrally against a nine-port
integration model, and multi-tenant by construction.

**The proposal is simple.** MiddleLeap builds and maintains the product; Ozone distributes it,
under Ozone's or the Al Tareq brand, through the system-integrator (SI) channel Ozone already
runs; SIs deliver each institution's integration. Ozone's offer to the market moves from
*connectivity* to *connectivity **plus** operations* — a more complete "Open Finance in a box"
for exactly the buyers who cannot or will not build custom.

> **MiddleLeap builds · Ozone distributes · SIs deliver.**

This document sets out the market, the gap, the product, why the fit is natural for Ozone, the
distribution and commercial model (mechanics only — figures are for us to negotiate), the
go-to-market motion, the proof, and the joint path to production.

---

## 2. The market and the moment

CBUAE Circular **C 03/2025** makes Open Finance mandatory. It obligates **every licensed bank
and every insurance company and broker** — on the order of **50 banks and 60+ insurers/brokers**,
plus exchange houses — against a fixed release calendar and a fixed per-event liability schedule.

- **The deadlines are close and non-negotiable:** Extended Data and Insurance Quotes (R4+,
  Apr 2026), Corporate suite (R5, Sep 2026), Insurance data-sharing onboarding (2026-Q3), and
  CAAP migration (2026-Q4). *(An industry-wide compliance deadline of 16 Sep 2026 is widely
  cited; treat as directional pending CBUAE confirmation.)*
- **The liability is real and per-event:** the scheme's Limitation of Liability Model attaches a
  specific amount to each operational failure — from AED 200 for an SLA miss, through AED 500
  for a consent-state failure, to AED 5,000 for a breaking-change mishandling and AED 10,000 for
  a fraud-prevention failure — under Nebras's own AED 5,000,000 per-claim cap.
- **The capacity does not exist across the tail.** Most mandated institutions have neither the
  engineering bench nor the runway to build a compliant back office in the time available.

This is the textbook condition for a shared, out-of-the-box capability: *compliance is not
optional, and building it is infeasible for most.* Ozone has solved this shape of problem before
— **CAAP**, where the tail could not build FAPI-grade authentication, so the scheme hosted it
centrally and extended it segment by segment. **Operations is the next CAAP.**

---

## 3. The gap Ozone does not yet fill

The cleanest way to see the opportunity is the UAE model's own division of labour:

> **API Hub = control plane. LFI = execution layer.**

Ozone owns the control plane and the certification path onto it. What it does not yet give an
institution is the execution layer — the recurring, un-glamorous operational work that keeps a
participant compliant and commercially whole *after* go-live:

| Operational obligation | What it takes, day to day | Consequence of not having it |
|---|---|---|
| **Fee & settlement reconciliation** | Three-way match: API-Hub billing ↔ the bank's own logs ↔ downstream fintech billing, with break detection and dispute filing | Pay Nebras invoices blind; over-billing undetected; a prerequisite for payment go-live is missing |
| **Consent & dispute operations** | Search a PSU's consents across all TPPs; revoke (fraud path four-eyes-gated) with <5s scheme acknowledgment; investigate unauthorised payments; next-business-day refunds | Care and fraud calls have no tool behind them; refund SLAs breach |
| **Mandatory reporting** | Generate CBUAE-format reports; ingest the **16 login-only LFI reports that have no API**, with integrity hashes and missed-cadence alerts | Reports late or malformed; cadence discipline fails |
| **Liability exposure** | Monitor per-event exposure against the scheme's schedule *before* it crystallises | Liability discovered on the monthly invoice, not managed |
| **Governance, audit, lineage** | Four-eyes on sensitive actions; INSERT-only audit; BCBS 239 column-level lineage; 24-month/5-year retention | Fails examination; no defensible record |
| **TPP-of-record billing** | Register hosted fintechs, reconcile before invoicing, track margin | The bank's own Open Finance revenue book is unmanaged |

None of this is connectivity. All of it is mandatory. This is the layer the tail cannot build —
and the layer this partnership sells.

---

## 4. The solution — OFBO

**What it is.** OFBO is the internal control room for an institution's Open Finance business —
the screens and services staff use to *check the money, help customers, and watch the platform*.
It is built for the institution that wears two hats at once: an **LFI** holding PSU accounts and
serving inbound consented TPP traffic, and a **TPP-of-record** consuming other LFIs' APIs on
behalf of the fintechs it hosts — a billable, reconciled counterparty. Every reconciliation line
and liability event carries that role dimension.

**What it does — six capability areas, in business terms:**

1. **Reconciliation console** — daily three-way reconciliation, break detection with configurable
   thresholds, an SLA-clocked investigation workflow, one-click scheme dispute creation, monthly
   Finance sign-off, and TPP-of-record margin tracking.
2. **Customer care (consent & dispute operations)** — sub-second PSU consent search across the
   full CBUAE consent lifecycle and all TPPs; single/bulk/fraud revocation with <5s scheme
   acknowledgment; unauthorised-payment investigation with four-eyes-gated next-business-day
   refunds; CBUAE inquiry-bundle generation.
3. **Analytics & insight** — one executive dashboard (commercial and programme views), plus
   operations, compliance, risk and finance consoles; a proactive liability-event monitor; consent
   anomaly detection; cross-fintech aggregation the individual fintechs cannot see.
4. **A regulated substrate (built first, not retrofitted)** — RBAC scope enforcement, four-eyes
   approvals, INSERT-only high-sensitivity audit, mandatory MFA, OpenTelemetry tracing, BCBS 239
   lineage at write time, 5-year retention, PII redaction, and region-parameterised deployment.
5. **Integration enablers** — the nine port integrations to the institution's estate (see below).
6. **Scheme interaction & TPP billing** — a consuming-TPP registry with Trust Framework Directory
   sync, monthly TPP invoicing on a strict *reconcile-before-invoice* pipeline, and scheme
   fraud-incident and service-desk case tracking.

**Why it is productisable — three architectural facts that de-risk distribution:**

- **Vendor-neutral by construction (the port model).** Everything institution-specific is a
  *port* — a named integration point with a defined contract. The core never references a vendor;
  the adopting institution maps each port to its estate in configuration.

  | Port | What the institution supplies |
  |---|---|
  | P1 | Customer-care surface (portal-resident, or CRM such as Salesforce) |
  | P2 | Enterprise IdP (OIDC/SAML2) + mandatory MFA |
  | P3 | ITSM & alerting (ServiceNow, Jira SM, …) |
  | P4 | Core-banking read (Finacle, Flexcube, T24, …) — reconciliation inputs |
  | P5 | Enterprise APM, bridged off the OpenTelemetry stream |
  | P6 | Scheme egress gateway — **all** Nebras-bound traffic, FAPI 2.0 mTLS; no direct egress |
  | P7 | Data catalogue / BCBS 239 lineage sink (Collibra, Purview, …) |
  | P8 | Onboarding handover (optional) |
  | P9 | Financial system / ERP — TPP counterparty registration + invoicing (SAP, Oracle, …) |

- **Adapter swap, not rewrite.** Every port has two implementations behind one interface — a
  simulator (demo) and an enterprise adapter (bank adoption) — selected by configuration, never by
  branching in application code. Porting to an institution is *adapter replacement plus a Bank
  Profile*, and an enterprise adapter must pass exactly the tests the simulator passes. That is a
  clean, testable acceptance gate for every deployment — and the natural unit of SI delivery.

- **Multi-tenant from day one at the data layer.** Every regulated table carries a tenant key
  under forced row-level security; the platform is serverless and region-parameterised. Running
  many institutions from one platform is a hardening-and-provisioning programme, not a re-design
  (see §10 and the multi-tenant blueprint for the honest state of this).

**It is real today.** A live, seeded demo runs the whole story end to end — a single fraud
incident traced across five consoles (a dispute in Care, a break in Finance, a signal in Risk, a
four-eyes refund in Approvals, a scheme case in Operations) — with a fault-injection switch that
triggers a fee-variance break or a liability signal on demand, on synthetic data only.

---

## 5. Why this is a natural fit for Ozone

Ozone is not being asked to enter a new business. It is being offered a value-adding layer that
sits exactly where its existing offer stops, sold through the motion it already runs:

- **Ozone already powers the hub.** OFBO consumes the hub's surfaces through the single P6 egress
  and, for refunds and health checks, through Ozone Connect. It never re-implements the gateway,
  the resource server, or CAAP. It is strictly complementary — the operations layer on top of the
  connectivity Ozone provides.
- **Ozone already runs the distribution muscle.** Ozone's published partner program spans a
  ladder — Referrer, Reseller, Premium Reseller — up to *delivering a completely dedicated,
  partner-branded Open Finance infrastructure with visibility across tenants*, backed by
  white-labeling, dedicated partner managers, sales enablement, and co-marketing. OFBO drops into
  that program as a value-adding module, not a new SKU to invent.
- **Ozone already has the SIs.** The channel that integrates Ozone's platform at each institution
  is the same channel that maps OFBO's nine ports and swaps its enterprise adapters. No new
  delivery network is required.
- **It completes the story to the buyer who won't build.** For the mandated long tail and new
  entrants, "connect me" is half the ask; "let me run it" is the other half. A combined
  connectivity-plus-operations offer is materially harder for a competitor to match and materially
  easier for an institution to say yes to.

---

## 6. The distribution model — full reseller / OEM white-label

The lead model is **full reseller / OEM white-label**: Ozone takes OFBO to market as part of its
own offer, under its own or the Al Tareq brand, and owns the customer relationship end to end.

**Roles are clean and non-overlapping:**

| Party | Role | Owns |
|---|---|---|
| **MiddleLeap** | OEM product vendor | Product build, roadmap, maintenance, releases, L3 support, multi-tenant platform operations |
| **Ozone** | OEM reseller / distributor | The customer relationship, brand, commercial terms, billing, first-line support, channel enablement |
| **SIs** | Delivery | Per-institution port mapping, enterprise-adapter integration, Bank Profile configuration, go-live, certification support |

**Product packaging — two tiers on one codebase.** OFBO already separates along a compliance-vs-
assurance line, and that line is the packaging boundary:

- **Console tier** — the operational basics: consent operations and care, participant-side
  dispute case management, mandatory reporting with integrity hashes, the STR/AML trail, and the
  regulated audit/retention posture. **Non-adversarial; freely white-labellable and resellable**
  by Ozone (e.g. an "Al Tareq Operations Console"). This is the volume tier for the long tail.
- **Assurance tier** — three-way reconciliation, fee/invoice verification, the liability monitor
  and forecast, scheme-SLA observability, and TPP-of-record margin. This tier's whole value is
  that it *checks the scheme's homework* — it reconciles against Nebras invoices and measures the
  hub's own acknowledgment times.

> **Independence safeguard (please read — it protects the revenue, it does not shrink it).**
> Because the assurance tier audits the platform an institution connects through, its
> commercial credibility depends on its being seen to operate *independently* of the platform
> provider. An examiner will reasonably object if the party that builds the hub also operates the
> tool that audits the hub. This does **not** stop Ozone distributing the assurance tier. It
> means we structure it as **independently operated, Ozone-distributed** — MiddleLeap retains
> operational independence of the reconciliation and liability functions under contract (a
> documented separation of duties, data-processing stance, and audit posture), while Ozone
> carries it to market and shares in the revenue. The independence *is* the product; keeping it
> intact is what makes the assurance tier un-commoditisable and durable. See ADR 0027 for the
> mechanism.

**Tenancy tiers** (how institutions are hosted — detail in the multi-tenant blueprint):

- **Pooled, shared-schema with row-level security** — the near-zero-marginal-cost default for the
  long tail and Tier-2.
- **Dedicated cell / database** — for Tier-1 or high-sensitivity carriers, or where a regulator
  requires a hard boundary.
- **Region cells** — to satisfy per-institution data residency.

---

## 7. The commercial framework (mechanics, not figures)

Per your steer, this sets out *how the money works* and leaves every number to negotiation. The
structure follows how ISV-plus-channel-plus-SI partnerships are built, and how regulated
"as-a-service" offerings are priced.

**Three revenue streams:**

1. **Recurring subscription (per tenant).** An OEM licence MiddleLeap charges Ozone per hosted
   institution (or per tier band); Ozone sets its own end-customer price and keeps the margin. This
   is the annuity, and it scales with the mandate.
2. **One-time onboarding / integration (SI-led).** Each institution's port mapping, adapter swap,
   Bank Profile and go-live is delivery revenue for the SI, with a defined MiddleLeap role for
   product-side enablement and L3.
3. **Optional premium modules.** The assurance tier, the insurer module, and advanced analytics
   price as add-ons on top of the console-tier base.

**The money flow:** the institution pays **Ozone**; Ozone pays **MiddleLeap** the OEM subscription
(per-tenant or tiered); the **SI** bills integration and may take a share of recurring for
managed-service relationships. MiddleLeap additionally retains L3 and platform-operations
responsibility, funded within the OEM fee.

**Pricing philosophy — anchor to value, not to cost.** Two anchors make the buyer's ROI concrete
without a single feature-by-feature line item:

- **Liability exposure avoided.** OFBO turns operating discipline (revokes acknowledged in <5s,
  breaks resolved in-SLA, compliant notifications) into an auditable "AED liability avoided"
  figure, computed per institution. This is the number that lands hardest with a Tier-2 or insurer
  buyer — it reframes the subscription as insurance against a schedule they are already exposed to.
- **Build-versus-buy avoided.** The cost, time, and execution risk of building this in-house
  against the R4+/R5 deadlines — for an institution that has no bench to build it — is the second
  anchor.

**Structuring norms we will draw on (the basis, not the number):**

- Ozone's own partner ladder (Referrer / Reseller / Premium Reseller / dedicated infrastructure)
  gives a ready commercial spine to graft onto.
- Regulated "compliance/operations-as-a-service" offerings standardise on **tiered per-institution
  subscriptions** — and offerings with three tiers materially outperform single-price ones,
  because they map to the real spread of long-tail / Tier-2 / Tier-1 buyers.
- The clean ISV-builds / channel-distributes / SI-integrates split keeps each party earning in the
  currency it is best at: product annuity, channel margin, and project services respectively.

**IP and rights.** MiddleLeap retains all product IP. Ozone receives distribution rights, with
exclusivity, territory and term to be agreed (a natural first cut: UAE-market, time-boxed,
renewing on performance). The assurance-tier independence safeguard is a term of the agreement,
not an afterthought.

---

## 8. Go-to-market motion

The motion runs through Ozone and its SIs, and it reuses assets that already exist:

1. **Top of funnel — credibility and try-before-you-buy.** The open **Open Finance Data Sandbox**
   (an OpenFinance-OS Commons contribution — synthetic UAE personas across banking, insurance and
   ATM, spec-accurate to Standards v2.1, reachable five ways including npm, PyPI and an MCP server)
   lets a prospect's engineers touch coherent Open Finance data in minutes, and demonstrates deep
   command of the Standards. The live OFBO demo lets a solutions engineer run a "here is what
   running your Open Finance looks like" walkthrough on the first call.
2. **Qualification.** The Integration Readiness Wizard turns the port model into a self-assessment
   — a prospect gets a port-by-port readiness score and a generated Bank Profile skeleton, which is
   also the SI's scoping input.
3. **Pilot.** A scoped SI-led pilot stands the console tier up for the institution on synthetic
   data, then swaps the first ports.
4. **Rollout.** White-label deployment, tenant provisioning, and (where wanted) the assurance-tier
   add-on.

**Segment sequencing mirrors the CAAP extension calendar** (banking → insurance → exchange
houses), so the rollout rides a cadence the market already understands. A sensible lighthouse is
**2–3 insurers or exchange houses** on the 2026 onboarding calendar — small enough to move fast,
visible enough to reference.

---

## 9. Proof and credibility

Everything in this proposal is demonstrable, and we are deliberate about what is proven versus
what is planned:

- **The Data Sandbox** — open (MIT code, CC0 data), vendor-neutral, ~38 synthetic personas across
  three domains, hardened by thousands of automated tests, pinned to a single Standards SHA. It is
  *not* a sales asset — and that is precisely why it earns trust: it never names or ranks an
  institution, and it demonstrates competence rather than asserting it. It is arm's-length evidence
  of the same command of Standards v2.1 an institution is buying in a back office.
- **The live OFBO demo** — the full six-capability story on seeded synthetic data, with the
  fault-injection switch that makes regulatory behaviour visible on a call.
- **A repeatable build method** — a governed discovery→delivery harness with human sign-off at
  every merge, INSERT-only audit and lineage as a definition-of-done, and a documented
  data-risk-control map.
- **Track record** — MiddleLeap's team has led UAE firsts: a first bank certification and first
  live licensed-TPP transactions.

> **Honest maturity, stated plainly.** OFBO is **demo-proven, not production-proven**, and runs on
> **synthetic data only** today. Its data plane is multi-tenant; the multi-tenant *control plane*
> (per-request tenant identity, re-scoped aggregation, per-tenant certificate custody, operator
> certifications) is **designed and backlogged, not yet built**. Production hardening and the first
> tenant provisioning are the joint work of this partnership — not a claim we are making. Our
> brand runs on numbers we can count; we will not represent readiness we have not earned.

---

## 10. Roadmap to production, and what we need from Ozone

The path from "demo-live" to "first paying tenant in production" is a sequenced, human-gated
programme — detailed in `multitenant-platform-blueprint.md`. In brief:

1. **Isolation hardening** — re-scope the cross-institution aggregation path and move tenant
   identity onto every request, behind a permanent cross-tenant isolation CI gate. *(Non-negotiable
   before a second tenant exists.)*
2. **Tenant provisioning** — self-service stand-up of a new institution with its own configuration.
3. **Per-tenant identity, egress and certificate custody** — each institution on its own FAPI 2.0
   scheme certificate through its own P6 path.
4. **Operator assurance** — SOC 2 / ISO 27001 for the hosting operator (Ozone already holds
   ISO/IEC 27001), the C 14/2021 outsourcing posture, per-tenant transparency and kill-switch.
5. **Insurer module and the liability-avoided ROI screen.**

**What we ask of Ozone to start:**

- **Channel commitment** — a decision to carry OFBO as a value-adding layer in the partner program.
- **A lighthouse customer** — one or two willing institutions from the 2026 onboarding calendar.
- **SI enablement** — a first delivery partner briefed on the port-mapping playbook (pack attached).
- **Scheme positioning support** — a joint conversation with Nebras/CBUAE on the outsourcing and
  independence posture (framing attached).

---

## 11. Risks and how we manage them

| Risk | Management |
|---|---|
| **Channel concentration** on one distributor | Multi-tier packaging keeps direct and scheme motions open in parallel; term-boxed exclusivity |
| **Assurance-tier independence** challenged by an examiner | Independence safeguard (§6): independently operated, Ozone-distributed; documented separation of duties |
| **Operator liability** under a shared platform | The operator is a PDPL Processor (Art 8 joint liability) under CBUAE Outsourcing C 14/2021; per-tenant outsourcing agreements, onshore system-of-record, back-to-back liability allocation |
| **Data residency** across tenants | Region cells; residency as a per-tenant property, not one global parameter |
| **Production hardening** not yet done | Framed as joint partnership work with a gated plan; nothing represented as production-ready before it is |
| **"Ozone/Nebras could build it"** | It exists now (demo URL); the assurance tier is structurally un-buildable by the platform operator; the mandate window rewards speed over a fresh build |

---

## 12. Next steps

1. **A 45-minute working demo** — the Alpha Bank walkthrough: consent revoke → dispute → report →
   refund → scheme case, with a fault injected live.
2. **A commercial working session** — packaging, tiers, and the OEM/rev-share mechanics against
   your partner-program spine.
3. **A scoped lighthouse pilot** — 2–3 institutions on the 2026 calendar, one SI briefed.
4. **A joint scheme conversation** — Nebras/CBUAE on the outsourcing and independence posture.

**Let's put a working session in the calendar.**

---

## Appendix A — Module-to-tier assignment (from ADR 0026)

| Module | Tier | Rationale |
|---|---|---|
| Consent operations + care surface | Console | Non-adversarial; raises scheme compliance |
| Dispute case management (participant side) | Console | Mirrors the hub service; reduces support load |
| Mandatory reporting + integrity hashes | Console | Scheme wants cadence discipline |
| STR/AML trail | Console | Regulatory basics; no scheme conflict |
| Three-way reconciliation + break workflow | **Assurance** | Disputes scheme invoices |
| Fee/invoice verification, billing disputes | **Assurance** | Adversarial to the scheme by design |
| Liability monitor + predictive forecast | **Assurance** | Tracks exposure against the scheme |
| Scheme-SLA observability | **Assurance** | Measures the hub itself |
| TPP-of-record pass-through billing + margin | **Assurance** | The institution's own commercial book |

## Appendix B — Tenant segments (from the multi-tenant blueprint)

| Segment | Isolation | Packaging |
|---|---|---|
| Tier-2 banks | Pooled RLS; dedicated cell on request | Console + optional assurance |
| Tier-1/2 insurers & brokers | Pooled; dedicated cell for large carriers | Console + insurer module |
| Exchange houses | Pooled | Console tier |
| Long-tail fintechs / new entrants | Pooled | Console tier |
| Tier-1 banks | Dedicated DB / their own estate | Enterprise deploy (later, upmarket) |

## Appendix C — Glossary (terms used exactly)

- **LFI** — Licensed Financial Institution (bank/insurer/broker/exchange house) implementing Ozone
  Connect and serving consented TPP traffic.
- **TPP** — Third-Party Provider; consumes APIs via the API Hub only, never directly.
- **API Hub** — Nebras-operated, Ozone-powered central platform: authorization server, TPP-facing
  resource server, gateway, and consent store. The control plane.
- **Ozone Connect** — the LFI-side connection standard an institution implements; not a "resource
  server".
- **Nebras / Al Tareq** — the operator / the consumer-facing trust-framework brand.
- **CAAP** — Centralized Authentication and Authorization Platform; the scheme-hosted precedent for
  "capability the tail cannot build".
- **TPP-of-record** — an LFI acting as a TPP-as-a-Service for the fintechs it hosts; a billable,
  reconciled counterparty.

---

*All demo data is synthetic; no real PSU data exists anywhere in the system. Commercials in this
document are indicative and subject to negotiation. Contact: [owner to insert].*
