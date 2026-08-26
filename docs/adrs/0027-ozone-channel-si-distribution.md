# ADR 0027 — Ozone-as-channel + SI-delivery: a third distribution motion (full reseller / OEM white-label)

- Status: **Proposed** — awaiting human accept/reject
- Date: 2026-07-21
- Scope: adds a distribution motion to the accepted commercial positioning (ADR 0026). No code
  change is implied by this ADR; accepted, it shapes the outbound Ozone engagement and reuses the
  HOST-xx / INS-xx / VAL-01 backlog track already created by ADR 0026.
- Relates to: **ADR 0026** (accepted commercial positioning — Nebras VAS split + independent
  assurance), `docs/proposals/ozone-si-distribution-proposal.md` (the outbound proposal this ADR
  records), `docs/proposals/multitenant-platform-blueprint.md` (the hosting programme), the
  **COMMERCIAL** backlog track.

## Context

ADR 0026 evaluated three distribution strategies and accepted a dual motion: a **console tier**
distributed *through Nebras* (the operator) on the CAAP model, and an independent, paid
**assurance tier** sold *direct* to the LFI. It explicitly kept "hosted SaaS for the tail" alive
in parallel and demoted Tier-1 enterprise deploy to a later upmarket motion.

A distinct channel was not fully developed in ADR 0026: **Ozone — the technology provider behind
the API Hub — as a commercial distributor, using its existing system-integrator (SI)
relationships.** ADR 0026 refers to "Nebras (Ozone-powered)" but treats Ozone only as the hub's
technology substrate, not as a go-to-market partner in its own right.

Three facts make Ozone a first-class channel worth its own decision record:

1. **Ozone runs a productised partner program.** Publicly: a ladder of Referrer → Reseller →
   Premium Reseller, up to delivering a *dedicated, partner-branded Open Finance infrastructure
   with cross-tenant visibility*, backed by white-labeling, partner managers, sales enablement,
   and co-marketing. Distributing a value-adding ISV module through partners is Ozone's existing
   muscle.
2. **Ozone already holds the SI relationships** that integrate its platform at each LFI — the same
   relationships that would map OFBO's nine ports and swap its enterprise adapters. No new delivery
   network is required.
3. **Ozone is not the invoice-issuer.** The scheme (Nebras) invoices participants; Ozone provides
   the technology. This softens — though does not eliminate — the conflict-of-interest constraint
   that ADR 0026 found fatal to Nebras distributing the *assurance* tier.

The user has chosen to lead the Ozone engagement with a **full reseller / OEM white-label** model:
Ozone owns the customer relationship and resells OFBO under its own or the Al Tareq brand.

### The constraint carried over from ADR 0026

ADR 0026's structural finding still holds and must be honoured: OFBO's assurance modules exist to
**check the scheme's homework** (reconcile against Nebras invoices, monitor liability exposure
against the scheme, measure the hub's own acknowledgment times). Their regulatory credibility
depends on being *operated independently of the platform provider*. Because Ozone **powers the
hub**, an examiner could object to "the party that builds the hub also operating the tool that
audits the hub" — a weaker objection than the Nebras invoice-issuer conflict, but the same class
of problem. A full-white-label model that dissolved the assurance tier's independence would
destroy exactly the property that makes it durable and un-commoditisable.

## Decision (proposed)

Add a **third distribution motion** to the ADR 0026 set, and lead the Ozone engagement with it:

1. **Ozone-as-channel, SI-as-delivery, full reseller / OEM white-label.** Ozone takes OFBO to
   market as a value-adding layer inside its partner program, under its own or the Al Tareq brand,
   and owns the customer relationship, billing, first-line support, and commercial terms.
   MiddleLeap is the OEM product vendor (build, roadmap, maintenance, L3, platform operations).
   SIs deliver each institution's port mapping, adapter swap, Bank Profile and go-live. The value
   chain is **MiddleLeap builds · Ozone distributes · SIs deliver.**

2. **Packaging follows the ADR 0026 module boundary, with an independence safeguard on the
   assurance tier under white-label.**
   - **Console tier** — resell/white-label freely (this is the volume tier for the long tail).
   - **Assurance tier** — distributed by Ozone, but **independently operated by MiddleLeap under
     contract**: a documented separation of duties, data-processing stance, and audit posture that
     keeps the reconciliation and liability functions operationally independent of the platform
     provider. Positioning: *independently operated, Ozone-distributed*. The independence is a term
     of the distribution agreement, not an afterthought.

3. **Commercials: mechanics fixed, figures deferred.** Three streams — recurring per-tenant OEM
   subscription (MiddleLeap → charged to Ozone, marked up to the LFI), one-time SI-led integration,
   and optional premium modules (assurance / insurer / analytics). Value-anchored to VAL-01
   "liability exposure avoided" and build-versus-buy avoided. No price points are set in this ADR
   (per the user's steer); tiers and rev-share are negotiated against Ozone's partner-program spine.

4. **This motion composes with, and does not replace, ADR 0026.** The Nebras VAS console motion,
   the direct assurance motion, and the Tier-1 enterprise deploy remain available. Ozone-as-channel
   is the primary engine for the mandated long tail and new entrants; it can run alongside a
   Nebras-scheme motion for the console tier where the scheme prefers to bundle centrally.

## Consequences

- **No new product architecture.** Packaging is the same console/assurance module boundary ADR
  0026 already defined; distribution is a commercial and contractual arrangement, plus the
  multi-tenant hosting programme the COMMERCIAL track already carries (HOST-01/02/03, INS-01/02,
  VAL-01). Compose-don't-invent holds — no new gateway, auth path, or approval primitive.
- **Independence becomes a contractual instrument.** The assurance-tier separation of duties must
  be written into the distribution agreement and be demonstrable to an examiner. This is the moat,
  not a constraint to minimise.
- **Operator posture unchanged from the blueprint.** Any hosted motion (including this one) makes
  the operator a PDPL Processor (Art 8 joint liability) under CBUAE Outsourcing C 14/2021, requires
  per-tenant residency and P6 scheme-cert custody, operator certifications (SOC 2 / ISO 27001 —
  Ozone already holds ISO/IEC 27001), and the `bank_internal_view` re-scope before a second tenant
  exists. None of these are created or removed by this ADR; they are prerequisites the roadmap
  already sequences.
- **Honesty posture preserved.** OFBO is represented as demo-proven, synthetic-only, with the
  multi-tenant control plane designed-and-backlogged; production hardening is joint partnership
  work. Nothing in the Ozone engagement asserts readiness that has not been earned.
- **Risks accepted:** channel concentration on Ozone for the reseller motion (hedged by the ADR
  0026 parallel motions); the residual assurance-independence optics under white-label (managed by
  the safeguard); dependence on Ozone's willingness to carry a partner module (mitigated by the
  fit — it completes their offer and rides their existing program).

## Alternatives considered

- **Referral / agency only** (MiddleLeap contracts every LFI directly; Ozone + SIs take referral
  fees): preserves MiddleLeap brand and margin and keeps the assurance tier cleanly independent,
  but underuses Ozone's channel and asks the least commitment — rejected as the *lead* model per
  the user's choice, retained as a fallback for the assurance tier via the independence safeguard.
- **Pure reseller with the whole stack white-labelled, no independence carve-out**: simplest for
  Ozone, but dissolves the assurance tier's independence and reopens the ADR 0026 conflict —
  rejected; the safeguard exists precisely to avoid this.
- **Stay with ADR 0026 as-is (Nebras + direct only)**: leaves the ready-made Ozone channel — an
  existing partner program, existing SIs, a partner-branded multi-tenant offering — unused, and
  routes long-tail distribution through the operator alone. Rejected as leaving the most efficient
  distribution path on the table.

## Decision needed from the human

Accept/reject adding the Ozone-as-channel motion as the lead go-to-market for the mandated long
tail, with the full-reseller/OEM-white-label model and the assurance-tier independence safeguard.
If accepted: authorise the outbound proposal (`docs/proposals/ozone-si-distribution-proposal.md`)
and its companions (SI enablement pack; Nebras/CBUAE note) as the basis for the Ozone engagement.
