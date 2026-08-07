# ADR 0028 — Multi-tenant tenancy model (operator → tenant-group → bank_id)

- Status: **Proposed** — awaiting human decision (cross-cutting tenancy primitive; CLAUDE.md rule 6).
- ⚠️ **Implementation has landed ahead of acceptance (flagged 2026-08-06, DOCS-01).** This record is
  still Proposed, but its substance is merged on `main`: migration `0030_tenant_group.sql`
  (tenant groups + the re-scoped `bank_internal_view` bypass), `packages/db/src/seed-tenants.ts`,
  the `MULTITENANT_DEMO` worker flag and the portal tenant switcher — with backlog HOST-02 delivered
  and HOST-01 part-built. CLAUDE.md rule 6 says a genuinely-uncovered gap raises an ADR **and stops**;
  that did not happen here, so the decision is now being asked retrospectively. **A human must
  Accept, amend, or reject this record** — nothing in this PR presumes the answer, and the status
  is deliberately left as Proposed. If rejected, the merged tenancy scaffold has to be unwound;
  that cost is the reason this is flagged rather than quietly reconciled.
- Date: 2026-07-21
- Numbering: renumbered 0027 → 0028 on 2026-07-26. PR #294 (this ADR) and PR #295 (ADR 0027,
  Ozone-as-channel) were open concurrently and both claimed 0027; #295 merged first, so this
  record took the next free number. Caught by the Q2b duplicate-ADR-number check (ADR 0020) —
  the same collision class that renumbered ADR 0018 → 0019 while PR #250 was open.
- Related: `docs/proposals/multitenant-platform-blueprint.md` (decision **D-1**), **ADR 0026** (hosted-SaaS motion),
  **ADR 0015** (governed cross-fintech aggregation), **ADR 0006** (LFI/TPP wall), backlog **HOST-01/02/03**;
  migrations `0002_tables.sql`, `0003_rls.sql`, `0026_internal_view_role_membership.sql`; `packages/db/src/tenant-tx.ts`,
  `governed-aggregate.ts`; `services/bff/src/worker.ts`, `auth.ts`.

## Context

OFBO was built as **one deployment per adopting bank**: every regulated table carries `bank_id uuid NOT NULL`
with `FORCE ROW LEVEL SECURITY` from day one (`0002_tables.sql`, `0003_rls.sql`), but `bank_id` is a **deploy-time
constant** — a single `BANK_ID` env var read once at Worker boot and frozen into ~30 stores
(`services/bff/src/worker.ts:105`). ADR 0026 (Accepted) added a **hosted-SaaS motion** for the mandated long
tail (~50 banks + 60+ insurers under CBUAE C 03/2025); the blueprint (`docs/proposals/multitenant-platform-blueprint.md`)
set out the operating model. This ADR fixes the **tenancy model** those depend on — the load-bearing D-1 decision.

Two facts force the decision:

1. **The data plane is already multi-tenant; the control plane is not.** RLS can isolate N tenants today, but
   nothing derives *which* tenant an inbound request belongs to — the authenticated principal knows *who* and
   *what scopes*, never *which institution* (`auth.ts:48`; no tenant claim in `verifyToken` /
   `verifyAgentSession`, `packages/ports/src/interfaces.ts:20`).
2. **The one deliberate RLS-bypass path silently becomes a cross-customer leak.** `bank_internal_view` is a
   `USING (true)` SELECT role that reads across every `bank_id` (`tenant-tx.ts:28`, `0003_rls.sql:33`), reached
   only through `runGovernedAggregate` (`governed-aggregate.ts:88`). Designed as "one bank aggregating across the
   fintechs it hosts" (ADR 0015), under a shared operator the *same code path* reads across **competing
   institutions**. This must be re-scoped **before a second tenant exists** (HOST-02).

## Decision drivers

- Preserve the day-one RLS substrate and the near-zero-marginal-cost claim that makes the long tail viable.
- Support a **customer that is a group of licensed entities** (PRD §3, BD-12: "single entity, or multiple
  licensed entities in a group, each with separate LFI certification").
- Keep "cross-fintech aggregation" (a customer looking across its own fintechs/channels) working, while making
  "cross-customer aggregation" **impossible**.
- Compose existing primitives only — no new gateway, auth path, or approval mechanism (CLAUDE.md rule 6).

## The model

Introduce the **tenant/customer as a first-class concept above `bank_id`**, without changing the RLS unit:

```
Operator (the platform runner — a PDPL Processor / outsourced service provider)
  └─ Tenant group / Customer  (an adopting institution; one or more licensed entities)
        └─ bank_id            (a licensed entity — the RLS isolation unit, UNCHANGED)
              └─ channel / client_id / tpp_counterparty  (fintech & product relationships within an entity)
```

- **`bank_id`** stays the RLS isolation unit. `ofbo_app` stays pinned to a single `bank_id` per transaction
  (`beginAppTx`) — unchanged.
- A **`tenant_group` + `tenant_group_member(tenant_group_id, bank_id)`** mapping (HOST-02) expresses which
  entities belong to which customer. The demo bank becomes a **single-member group**, so current behaviour and
  every existing test hold.
- **`bank_internal_view` is re-scoped** from `USING (true)` to the caller's tenant group: a governed aggregate
  reads only the `bank_id`s in the caller's group — "cross-fintech within a customer" is preserved,
  "cross-customer" is made impossible.
- **Tenant becomes a per-request property of the authenticated principal** — resolved in `createAuthMiddleware`,
  attached to `Principal`, and used to pin `app.bank_id` (and the audit row's tenant) per request instead of one
  deploy-time constant.

## Options considered

1. **Tenant-group above `bank_id`, shared-schema RLS (recommended).** Add the mapping table, re-scope the bypass
   role, and make tenant a per-request principal property. *Pros:* reuses the entire day-one substrate; the
   isolation unit is unchanged; near-zero marginal cost per tenant; the demo stays valid as a single-member
   group. *Cons:* the control-plane surface (token claim → `Principal` → per-request store binding) must be built
   (~30 stores bind tenant at construction today); the bypass re-scope needs care to keep governed-aggregate
   tests green.
2. **Redefine `bank_id` to mean the customer (collapse entities into channels).** *Pros:* no new table. *Cons:*
   destroys the group/multi-entity model (BD-12) and the separate-LFI-certification reality; conflates the RLS
   unit with the commercial customer; a bigger data-model change than option 1.
3. **Physical isolation only — DB/deployment per tenant.** *Pros:* strongest boundary; simplest mental model.
   *Cons:* abandons the near-zero-marginal-cost economics that justify the long-tail utility; the blueprint keeps
   this as a **per-tenant upgrade** (silo/cell) for Tier-1/sensitive tenants, not the default.

## Recommendation

**Option 1**, with **tiered isolation** layered on top (blueprint §2.3): pooled shared-schema-RLS as the default
for console-tier / long-tail / Tier-2; **silo/cell as a paid upgrade** for Tier-1 and high-sensitivity carriers;
**region cells** for per-tenant residency. The isolation model is a per-tenant *deployment* choice; the tenancy
*data model* (this ADR) is the same in all tiers.

## Consequences

- **HOST-02 re-scope is the critical-path prerequisite** and must land before any second tenant. It is
  backward-compatible: with no group pinned (single-tenant default) the policy reads as today; with a group
  pinned (multi-tenant) it is strictly group-scoped. Production hardening (fail-closed when unpinned) is a marked
  follow-up.
- **Per-request tenant context** threads through: a tenant claim in P2/agent tokens
  (`interfaces.ts`), a `bank_id`/`tenant` field on `Principal` (`auth.ts`), and per-request store binding
  (`worker.ts` constructs stores per request already, so the tenancy object is built from the resolved tenant).
  Headless cron jobs (`worker.ts:190`) iterate the tenant registry.
- **Governed aggregation** keeps its control envelope unchanged — purpose-match-or-reject + High-class bypass log
  + four-eyes new-purpose — but now `beginInternalViewTx(tenantGroupId)` pins the caller's group so the bypass
  can never cross a customer boundary. `query_purpose_registry` stays per-`bank_id`.
- **Four-eyes / super-admin / scope matrix gain a tenant dimension** (blueprint §3.7): the second approver must be
  same-tenant; an operator super-admin over all tenants is re-scoped to tenant-scoped admin + audited operator
  break-glass. (Own ADR — blueprint D-5.)
- **Regulatory posture unchanged per tenant**: UAE residency (region as an IaC/cell parameter), INSERT-only
  audit, 5-year no-deletion retention, P6 single egress, consent-only-in-Hub, the scope matrix, 202/four-eyes —
  all hold, now evaluated per tenant. The operator becomes a PDPL **Processor** under CBUAE Outsourcing C 14/2021
  (blueprint §3.1 / D-3) and must custody per-tenant scheme certificates (HOST-03 / D-4).
- **Demo**: a flagged multi-tenant demo (Alpha Bank + a Tier-2 bank + a Takaful insurer) seeds each as its own
  single-member tenant group and demonstrates the isolation on screen; the demo profile stays **single-tenant by
  default** (blueprint §6). Zero-PII and the DEMO banner hold per tenant.

## Decision needed from the human

Accept/reject the tenant-group-above-`bank_id` model (option 1) + tiered isolation. On acceptance: (a) HOST-02
re-scope ships first; (b) HOST-01 provisioning + per-tenant §10 config follows; (c) the super-admin re-scope and
HOST-03 cert-custody ADRs are raised (blueprint D-4/D-5). The three-tenant demo scaffold that accompanies this
ADR implements the model additively behind a flag so the decision can be *seen* before it is ratified.

_Pending._
