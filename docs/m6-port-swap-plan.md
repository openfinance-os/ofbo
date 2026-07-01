# M6 Enterprise Port-Swap Plan

> **Status:** planning runbook (not a story). Tracks how the nine ports move from
> **rung ③** (pre-staged adapter, sandbox-validated against an injected fake — ADR 0023 P2
> Entra + ADR 0024 for the other eight) to **rung ④** (production: real tenant, credentials,
> residency) at bank adoption. Backlog anchors: `M6-PORT-SWAPS`, `M6-KONG-METERING`.
>
> Each swap is an independent per-bank integration project. The acceptance gate for every
> port is the same: the enterprise adapter must pass **exactly** the contract suite the sim
> passes (`packages/ports/test/port-contracts.spec.ts` + the per-adapter `*.spec.ts`), and the
> application core never branches on profile — selection stays in `registry.ts::getAdapter`.

## The fidelity ladder (recap)

`① stub → ② contract-green (injected fake) → ③ sandbox-validated → ④ production @ adoption`

All nine adapters are at **rung ③** today and **fail-closed**: an unconfigured enterprise
adapter throws a clear config error — it never silently runs a fake under
`DEPLOY_PROFILE=enterprise`. A swap = supplying the Bank-Profile config + credentials, then
validating against the real backend; it is configuration + promotion, not new code.

## Decision point — Kong Konnect (gates `M6-KONG-METERING`)

This is a **bank-estate fact, not an OFBO choice**: *is Kong Konnect the bank's API gateway /
metering layer?* ADR 0024 admits Kong only as a **metering input** — never as the P9 invoicing
engine (the reconcile-before-invoice gate, four-eyes, dispute-withholding and net-settlement
stay inside OFBO).

| Answer | Action |
|---|---|
| **Yes — Kong is the gateway** | Unblock `M6-KONG-METERING`. Raise: (a) a Kong implementation of the **P6** `NebrasEgressPort` (routes Nebras-bound traffic through Kong, which holds FAPI mTLS), and (b) a **Kong-metering feed** into `BACKOFFICE-73` step 2 as the bank's own per-TPP meter. Both tests-first, fail-closed, against `port-contracts.spec.ts`. |
| **No — not Kong** | Close `M6-KONG-METERING` (won't-do). The existing vendor-neutral P6 egress-gateway adapter stands as the M6 target; the bank's own metering source feeds `BACKOFFICE-73`. |
| **Not decided** | Keep blocked. Decision owner: bank platform/architecture team. No OFBO work proceeds on it. |

## Recommended sequencing

PRD §7.5: the external-integration ports have the longest lead times — start them first.
P2 (Entra) already has the most complete adapter (the reference template), so the
highest-leverage *next* swap is **P6**, the regulated spine.

| # | Port | Why this order |
|---|---|---|
| 1 | **P6** Nebras egress | The spine: reconciliation, consent-revoke (<5s SLA), refunds, directory-sync all depend on it; longest lead time (FAPI 2.0 mTLS + PAR/PKCE + scheme cert chain at the egress gateway). Nothing regulated is "live" until this swaps. |
| 2 | **P2** IdP (Entra) | Portal sign-in + agent sessions; smallest gap to ④ (reference adapter). Real tenant, JWKS verifier, conditional-access MFA. Can run in parallel with P6. |
| 3 | **P7** lineage | BCBS 239 / Q4.5 obligation; point the OpenLineage emitter at the bank's catalogue. |
| 4 | **P4** core banking | Reconciliation inputs (balances/transactions) — needed for the real three-way recon once P6 is live. |
| 5 | **P3** ITSM | Ticket routing for the signals P6/P4 start producing. |
| 6 | **P5** APM | OTLP bridge to the bank's APM; low-risk, vendor-neutral. |
| 7 | **P1** care surface | Only if the bank chooses the CRM-resident console; the portal-resident default needs no swap. |
| 8 | **P9** financial system | Invoice-execution transport; depends on the reconcile-before-invoice pipeline (OFBO-side) being exercised against real P6 data. |
| 9 | **P8** onboarding handover | Optional port; swap only if the bank has an onboarding integration to surface in the funnel. |

## Per-port swap checklist

For each port: ① set the Bank-Profile config (below) in the enterprise environment; ② point at
the bank's **sandbox** first and run the per-adapter spec against it; ③ promote to the real
backend; ④ confirm `getAdapter(<port>, 'enterprise')` resolves and the port contract passes;
⑤ confirm UAE data residency for any regulated data; ⑥ rotate any rung-② stand-in secret
(e.g. bearer-token env → the real OAuth/connected-app/DCR flow).

| Port | Adapter (rung ③) | Config / env keys | Rung-④ "real backend" work |
|---|---|---|---|
| P1 care | `salesforce-care-surface.ts` | `SALESFORCE_INSTANCE_URL`, `SALESFORCE_TOKEN_EXCHANGE_URL`, `SALESFORCE_BEARER_TOKEN`, `SALESFORCE_API_VERSION` | Connected-app OAuth (replace bearer stand-in); Service Cloud Voice recording object mapping |
| P2 IdP | `p2-entra.ts` | `P2_OIDC_ISSUER`, `P2_OIDC_CLIENT_ID`, `P2_PERSONA_CLAIM`, `P2_PERSONA_MAPPING`, `P2_AGENT_SIGNING_KEY` | Real JWKS verifier (jose); conditional-access MFA; agent sessions → DCR client-credentials/mTLS (ADR 0018 Option 1) |
| P3 ITSM | `servicenow-itsm.ts` | `SERVICENOW_INSTANCE_URL`, `SERVICENOW_BEARER_TOKEN`, `SERVICENOW_TABLE`, `SERVICENOW_ASSIGNMENT_GROUPS` | Connected-app OAuth; map teams → real `assignment_group` sys_ids |
| P4 core banking | `core-banking.ts` | `CORE_BANKING_URL`, `CORE_BANKING_TOKEN` | Map the core's payload → the canonical `{amount,currency,as_of}` / txn shape (integer minor units) |
| P5 APM | `otlp-apm.ts` | `OTEL_EXPORTER_OTLP_ENDPOINT` (or `_TRACES_ENDPOINT`), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | Point at the bank's OTLP collector; auth headers |
| P6 egress | `nebras-egress.ts` | `EGRESS_GATEWAY_URL`, `EGRESS_GATEWAY_TOKEN` | The gateway holds FAPI mTLS + cert chain; service-to-service OAuth2 client_credentials; **all** Nebras traffic via the gateway (no direct egress) |
| P7 lineage | `openlineage.ts` | `OPENLINEAGE_URL`, `OPENLINEAGE_NAMESPACE`, `OPENLINEAGE_API_KEY` | Point at Marquez/DataHub/Collibra/Purview; confirm column-level facets ingest |
| P8 onboarding | `onboarding-handover.ts` | `ONBOARDING_URL`, `ONBOARDING_TOKEN` | Map the bank's onboarding payload → canonical funnel/case shape (optional port) |
| P9 financial | `financial-system.ts` | `FINANCIAL_SYSTEM_URL`, `FINANCIAL_SYSTEM_TOKEN` | ERP/AR endpoints for counterparty + invoice-run + settlement; **execution only** — reconcile-before-invoice stays in OFBO |

## Definition of done (per swap)

- `getAdapter(<port>, 'enterprise')` resolves with the Bank Profile set; **throws** clearly when unset (fail-closed verified).
- The port's contract assertions pass against the bank's sandbox (rung ③→④ promotion).
- Lineage (Q4.5) and High-class audit emit unchanged through the real adapter.
- UAE data-residency confirmed for the port's regulated data.
- Any rung-② stand-in secret rotated to the real credential flow; secret stored in the bank's secret manager, not env literals.
- Release-evidence bundle updated; the readiness maturity dashboard reflects the port at ④.
