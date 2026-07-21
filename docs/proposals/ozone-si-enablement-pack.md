# SI enablement pack — delivering OFBO for Ozone

### For system integrators in Ozone's delivery network

*A companion to the MiddleLeap × Ozone distribution proposal. This is the practitioner's view:
what an SI does to stand OFBO up at an institution, and how the SI earns.*

- **Audience:** SI delivery leads and solution architects briefed by Ozone
- **Product:** Open Finance Back Office (OFBO) — bank-neutral operations layer for UAE Open Finance
- **Status:** Draft for the first SI briefing
- **Companions:** `ozone-si-distribution-proposal.md` · `multitenant-platform-blueprint.md` · ADR 0022 (readiness endpoint) · ADR 0023/0024 (enterprise adapters)

---

## 1. Where the SI sits

The partnership has three parties with non-overlapping roles:

- **MiddleLeap** builds and maintains the product, ships releases, holds the contract-test suite,
  and provides L3 support and platform operations.
- **Ozone** owns the customer relationship, brand, and commercials, and briefs the SI.
- **The SI delivers** — it is the party that makes OFBO real on a given institution's estate.

The SI's deliverable is well-bounded and testable: **map nine ports, swap the adapters behind
them, apply the institution's Bank Profile, and pass the acceptance gate.** OFBO is engineered so
that this is a configuration-and-integration project, not a build.

**Why delivery is de-risked for the SI.** Every institution-specific system is a *port* — a named
interface with a defined contract. The application core never references a vendor. Each port ships
with two implementations: a simulator (demo) and an enterprise adapter, selected by configuration
(`DEPLOY_PROFILE`), never by branching in code. Crucially, **an enterprise adapter must pass
exactly the same contract tests the simulator passes.** That test suite is the SI's definition of
done — green tests mean the adapter is correct.

---

## 2. The delivery playbook (six steps)

### Step 1 — Scope with the Integration Readiness Wizard
Before any code, run the institution through the readiness self-assessment (public, pre-login,
zero-PII). It produces a **port-by-port readiness score (0–100)**, a RAG status per port, and a
generated **Bank Profile skeleton**. This is both the qualification artifact for Ozone's sale and
the SI's scoping input — it tells you which ports are easy (a supported IdP already in place) and
which carry the lead time (see the effort map in §3).

### Step 2 — Map the nine ports to the estate
For each port, identify the institution's system and the integration pattern:

| Port | Institution system | Typical pattern |
|---|---|---|
| P1 customer-care surface | Portal-resident, or CRM (e.g. Salesforce Service Cloud) | Embed or CRM adapter |
| P2 enterprise IdP | Entra ID / ForgeRock / PingFederate | OIDC/SAML2 + mandatory MFA |
| P3 ITSM & alerting | ServiceNow / Jira Service Management | Webhook / API adapter |
| P4 core banking (read) | Finacle / Flexcube / T24 | Read-only balance/txn feed for reconciliation |
| P5 enterprise APM | Dynatrace / AppDynamics / Datadog | Bridge off the OpenTelemetry stream |
| P6 scheme egress | The institution's FAPI 2.0 egress gateway | **All** Nebras-bound traffic; mTLS + scheme cert chain |
| P7 data catalogue | Collibra / Microsoft Purview | BCBS 239 lineage sink |
| P8 onboarding handover | The institution's onboarding funnel | Event handover (optional) |
| P9 financial system | SAP / Oracle ERP | TPP counterparty registration + invoicing |

### Step 3 — Integrate the enterprise adapters
Replace each `sim` adapter with the institution's `enterprise` adapter behind the same interface.
Some enterprise adapters are pre-staged to a sandbox-validated rung to shorten lead time (e.g. an
Entra ID adapter for P2 already exists; Salesforce Service Cloud for P1, ServiceNow for P3, and a
Kong-based option for P6 are named candidates). Enterprise adapters are **fail-closed**: an
unconfigured adapter throws rather than silently falling back to a simulator — so a half-configured
integration cannot go live by accident.

### Step 4 — Apply the Bank Profile
Configure the institution's operating defaults. The adopting-institution defaults are binding until
the institution overrides them — for example: 2-hour approval expiry, SLA clocks pause on weekends,
four-eyes on fraud revoke, and a portal-resident care surface. These are configuration, not code.

### Step 5 — Support certification
OFBO produces the operational evidence the institution needs for the scheme's LFI certification
path — functional testing (Ozone Connect Test Suite + Postman, 100% pass), CX certification
(consent/auth screens against the Al Tareq brand/CX rules), penetration test, stress test, and live
proving with ≥2 TPPs. The SI's role is to wire OFBO into that evidence flow, not to re-run the
scheme's own certification.

### Step 6 — Go-live and handover
Run the port-swap acceptance gate (enterprise adapters green against the contract suite), confirm
the regulated substrate is intact (INSERT-only audit, BCBS 239 lineage at write time, scope matrix,
four-eyes, P6-only egress, UAE residency), and hand over to the institution's operations team with
MiddleLeap L3 behind it.

---

## 3. Effort map — where the lead time lives

Start the long-lead ports first. From heaviest to lightest, typically:

1. **P6 scheme egress + certificate custody** — the FAPI 2.0 cert chain and the "no direct egress"
   rule make this the hardest and least skippable integration. In a hosted/multi-tenant deployment
   it also carries the per-tenant certificate-custody decision (operator KMS/HSM vs BYO-egress).
2. **P4 core banking** — read-only balance/transaction access for reconciliation; core-banking
   change windows are slow.
3. **P2 enterprise IdP** — OIDC/SAML2 + mandatory MFA; usually well-understood but governance-gated.
4. **P9 financial system** — TPP counterparty registration and invoicing into ERP/AR.
5. **P7 lineage, P3 ITSM, P5 APM, P1 care surface** — adapter-shaped, lower lead time.
6. **P8 onboarding handover** — optional.

The readiness wizard's per-port RAG tells you which of these are already green at a given
institution, so scoping is evidence-led rather than assumed.

---

## 4. Pre-sales assets the SI can use today

- **The Open Finance Data Sandbox** — open, synthetic UAE personas across banking, insurance and
  ATM, spec-accurate to Standards v2.1, reachable five ways (hosted explorer, raw fixtures, embed,
  npm/PyPI packages, MCP server). Use it to show a prospect coherent Open Finance data in minutes.
- **The live OFBO demo** — the full operations story on seeded synthetic data, with a
  fault-injection switch (trigger a fee-variance break or a liability signal live on a call).
- **The Integration Readiness Wizard** — the "how close are you to production?" self-assessment that
  doubles as the SI's scoping tool.

---

## 5. How the SI earns

- **One-time integration / onboarding** — the port mapping, adapter swap, Bank Profile
  configuration, certification support and go-live is the SI's project-services revenue. It is the
  natural, repeatable unit of delivery, and it recurs with every new institution the channel signs.
- **Optional recurring managed-service share** — where an SI runs the institution's operations as a
  managed service on top of OFBO, a share of the recurring subscription can be structured into the
  arrangement.
- **Repeatability compounds.** Because delivery is port mapping against a fixed contract suite —
  not bespoke build — an SI's second and third institutions are faster and more profitable than the
  first. The pre-staged enterprise adapters and the readiness wizard are the leverage.

---

## 6. What MiddleLeap gives the SI

- The product, its releases, and the **contract-test suite that defines "done"** for every adapter.
- **L3 support and platform operations** behind the SI's first-line delivery.
- Enablement on the port model, the pre-staged adapters, and the Bank Profile.
- The demo and sandbox assets for pre-sales.

---

## 7. Non-negotiables the SI must preserve

These are hard stops. A delivery that breaks any of them fails review, regardless of schedule:

- **No PII** in browser storage, logs, fixtures, or telemetry — synthetic data only in non-prod.
- **All** scheme-bound traffic exits through P6; **no direct egress**, ever.
- **INSERT-only** audit; 24-month hot / 5-year immutable retention; no deletion path for regulated
  records.
- **Scope matrix** intact — Customer Care ≠ Finance ≠ Risk scopes; granting beyond it is an
  automatic review fail.
- **UAE data residency** for regulated production data (region is an infrastructure parameter).
- **Four-eyes** on sensitive operations, returned as a pending approval — never executed inline.

---

*OFBO is demo-proven and synthetic-only today; production hardening and multi-tenant provisioning
are sequenced in the multi-tenant blueprint. This pack describes the target delivery motion the
partnership is building toward.*
