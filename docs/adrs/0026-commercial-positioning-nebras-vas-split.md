# ADR 0026 — Commercial positioning: scheme-distributed console tier (Nebras VAS) + independent assurance tier

- Status: **Proposed** — awaiting human acceptance (commercial direction is a human decision;
  CLAUDE.md rule 6)
- Date: 2026-07-04
- Scope: how OFBO is packaged, distributed, and priced — and the ONE product-architecture
  constraint that follows from it (the independence split). No code change is implied by this
  ADR itself; accepted, it shapes the HOST-xx / INS-xx backlog track and any Nebras engagement.

## Context

OFBO is a complete, demonstrable LFI back office for UAE Open Finance (137 backlog items
shipped; reconciliation, care, compliance/STR, risk, TPP billing, approvals, audit/lineage
posture; 10-port vendor-neutral architecture; seeded Alpha Bank demo). Three distribution
strategies were evaluated in sequence:

1. **Tier 1 deploy-and-integrate** (the original M6 assumption): sell to large banks, swap
   enterprise adapters port-by-port. Sound engineering path, but Tier 1 procurement runs
   12–18 months — the slowest possible route to revenue and reference customers.
2. **Hosted SaaS for the mandated long tail**: CBUAE Circular C 03/2025 obligates ALL licensed
   banks AND insurance companies/brokers — roughly 50 banks and 60+ insurers, most without the
   engineering capacity to build any of this, all facing the same release deadlines (R4+
   Apr 2026, Corporate R5 Sep 2026) and the same per-event liability schedule. The architecture
   is already multi-tenant (bank_id + forced RLS day-one on every table), profile-switched
   (DEPLOY_PROFILE), serverless, and region-parameterised — hosting is a config posture, not a
   re-architecture.
3. **Scheme distribution via Nebras** (this ADR): Nebras already centrally hosts capability the
   long tail cannot build — CAAP (Centralized Authentication and Authorization Platform) is the
   precedent, offered as "consent management via CAAP or LFI" and extended segment-by-segment
   (Banking v1.2 → Insurance v2.0 → Exchange Houses v2.1, Dec 2025). A participant-side
   operations console is the natural next centrally-hosted capability: scheme health depends on
   the tail actually meeting revoke SLAs, dispute clocks, and reporting cadences, and Nebras
   carries the support cost when participants operate badly. Nebras also invoices every
   participant monthly — a VAS line on an existing invoice is distribution with zero new
   billing infrastructure.

### The structural constraint discovered

OFBO's highest-value modules exist to **check Nebras's homework**: the three-way reconciliation
disputes Nebras invoices, the liability monitor tracks exposure against the scheme, and the SLA
observability measures Nebras's own acknowledgment times. If Nebras hosts those modules, the
LFI's independent leg of every reconciliation collapses — an examiner will (correctly) refuse
"the invoice-issuer operates the invoice-verifier."

This conflict is not a marketing nuance; it is a product-architecture fault line. Handled
deliberately, it is also the moat: Nebras (Ozone-powered) could plausibly rebuild a console,
but it structurally cannot offer independent assurance of itself.

## Decision (proposed)

Split the product along the conflict-of-interest line and run BOTH distribution motions:

1. **Console tier — through Nebras, free/bundled (the CAAP model).** The non-adversarial
   compliance basics, OEM-licensed to Nebras (flat licence or per-participant fee on their
   billing rails), white-labelled (e.g. "Al Tareq Operations Console"):
   consent operations + care surface, participant-side dispute case management (mirror of the
   hub's Case & Dispute service), mandatory reporting with integrity hashes, the STR/AML trail,
   audit/retention posture. Funded the way CAAP is — through scheme economics — because raising
   tail compliance IS Nebras's product.
2. **Assurance tier — direct to the LFI, paid, independent.** Three-way reconciliation,
   fee/invoice verification, liability monitoring, scheme-SLA observability, TPP-aaS margin
   tracking. Positioning sentence: *"The scheme gives you the console; only an independent
   party can audit the scheme."* This tier is never offered through Nebras — the independence
   is the product.
3. **Hosted SaaS for Tier 2 + insurers stays alive in parallel** (not replaced by the Nebras
   channel — channel-concentration hedge), and **Tier 1 enterprise deploy (M6) becomes the
   later upmarket motion**, earned on hosted/VAS references rather than led with.

### Module assignment (the load-bearing table)

| Module | Tier | Rationale |
|---|---|---|
| Consent ops + care surface | Console (Nebras) | Non-adversarial; raises scheme compliance |
| Dispute case management (participant side) | Console (Nebras) | Mirrors hub service; reduces Nebras support load |
| Mandatory reporting + integrity hashes | Console (Nebras) | Scheme wants cadence discipline |
| STR/AML trail (P10 handoff) | Console (Nebras) | Regulatory basics; no scheme conflict |
| Three-way reconciliation + break workflow | **Assurance (direct)** | Disputes Nebras invoices |
| Fee/invoice verification, billing disputes | **Assurance (direct)** | Adversarial to the scheme by design |
| Liability monitor + predictive forecast | **Assurance (direct)** | Tracks exposure against the scheme |
| Scheme-SLA observability (revoke ack, hub latency) | **Assurance (direct)** | Measures Nebras itself |
| TPP-aaS pass-through billing + margin | **Assurance (direct)** | The bank's own commercial book |

## Consequences

- **Product**: the module boundary above becomes a packaging constraint — console-tier modules
  must be separable (deployable without the assurance modules) without violating the
  compose-don't-invent rule. Today they share one BFF; separation is a build-profile/flagging
  concern to be designed when (if) the Nebras engagement is real, NOT speculatively.
- **Moat**: the assurance tier is structurally un-commoditizable by the scheme operator. The
  free console tier becomes scheme-endorsed lead generation for it.
- **Risks accepted**: channel concentration on Nebras for the console tier (hedged by motion 3);
  CBUAE blessing likely required for a scheme-funded VAS (the CAAP precedent is the argument);
  Nebras "we'll build it" counter (answers: it exists today — demo URL — and the assurance tier
  they can never build).
- **Regulatory posture unchanged**: hosting in any motion keeps UAE data residency (region is an
  IaC parameter), RLS tenancy, INSERT-only audit, and the PII hard stops. A hosted/OEM motion
  additionally requires operator certifications (SOC 2 / ISO 27001), per-tenant P6 scheme-cert
  custody (HSM/KMS — own ADR when real), and re-scoping `bank_internal_view` before any second
  tenant exists (it is currently a cross-bank read designed for ONE bank's internal aggregation).
- **Follow-up backlog (not created by this ADR)**: HOST-01 tenant provisioning + per-tenant
  PRD §10 config; HOST-02 `bank_internal_view` re-scope; HOST-03 P6 cert-custody ADR; INS-01
  insurance line types + quote-fee reconciliation + insurance consent purposes; INS-02
  policy-centric care variant; VAL-01 liability-avoided KPI + ROI walkthrough screen (lands
  hardest with the Tier 2/insurer audience).

## Alternatives considered

- **Tier-1-first deploy-and-integrate**: rejected as the *leading* motion — slowest cycle,
  strongest procurement friction, and it monetizes the architecture's weakest claim (bespoke
  integration) instead of its strongest (multi-tenant, near-zero marginal cost per tenant).
- **Everything through Nebras (including assurance)**: rejected — the conflict of interest
  destroys the assurance tier's regulatory credibility and hands the whole product to the one
  counterparty able to commoditize the remainder.
- **Everything direct (no Nebras)**: viable but leaves the CAAP-shaped distribution channel —
  one deal, scheme endorsement, existing billing rails to every mandated participant — unused;
  50 sales cycles instead of one.

## Decision needed from the human

Accept/reject the split-and-dual-motion positioning, and if accepted: (a) authorize drafting
the Nebras engagement (the pitch one-pager is at `docs/proposals/nebras-vas-pitch.md`), and
(b) green-light the HOST/INS/VAL backlog entries.
