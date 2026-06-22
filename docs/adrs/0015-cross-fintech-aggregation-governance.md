# ADR 0015 — Cross-fintech aggregation governance (BD-13 / BACKOFFICE-33)

- Status: **Accepted — Option 1 + four-eyes on new-purpose registration** (user / BD-13 sign-off, 2026-06-22)
- Date: 2026-06-21
- Related: BACKOFFICE-33, BD-13, PRD §7 (BACKOFFICE-27/-33/-40) + §"Cross-fintech aggregation control"; migrations `0001_roles.sql`, `0002_tables.sql` (`query_purpose_registry`), `0003_rls.sql`; `services/bff/src/analytics/*`

## Context

The platform's value proposition (PRD §1) is *"aggregating data no individual fintech can see"* — executive/finance/risk/compliance views over **cross-fintech** data. By construction this is the one place the per-tenant RLS isolation (every Back Office table is row-level-secured by `bank_id`/tenant from day one) is deliberately **bypassed**: an aggregate must read across all fintechs.

That bypass is exactly the regulated risk. PDPL, the Al Tareq trust framework, and the bank's own data-governance posture all bear on *whether*, *for what purposes*, and *under what control* the bank may aggregate across the fintechs it hosts as TPP-of-record. Per CLAUDE.md rule 6 and PRD **BD-13**, this is a **human sign-off** (data governance + compliance), not an engineering call — and the PRD default is to **sequence single-fintech views first** and gate cross-fintech aggregation behind that sign-off.

## What already exists (substrate, M1) vs. what BACKOFFICE-33 adds

**Built (migrations 0001–0003):**
- `bank_internal_view` — a `NOLOGIN`, SELECT-only role with an RLS policy (`internal_view_select ... USING (true)`) that reads across `bank_id`. Nothing logs in as it yet.
- `query_purpose_registry` — a table modelled as a **preventative** control (PRD §: *"governs every `bank_internal_view` cross-fintech query — preventative, not audit-only"*; every insert is High-class).
- Per-tenant RLS on every table; aggregate matviews carry no RLS and grant SELECT only to `bank_internal_view`.

**Not yet wired (BACKOFFICE-33, the gap):** the analytics aggregation (`services/bff/src/analytics/*`, e.g. the BACKOFFICE-27 executive dashboard) does **not** currently run through the governed `bank_internal_view` path. BACKOFFICE-33 is: execute cross-fintech aggregates **as** `bank_internal_view`, **require** each query to match a registered purpose in `query_purpose_registry` (reject otherwise — preventative), and **High-class log** every bypass query with its text + row count. Output stays invisible to any tenant-scoped fintech.

## The decision (what BD-13 sign-off actually authorises)

Data governance + compliance must confirm three things before this is enabled:

1. **Permissibility** — cross-fintech aggregation by the bank (in its LFI / TPP-of-record dual role) is lawful for the intended purposes under PDPL + the scheme rules, and the bank's role basis for it is documented.
2. **Purpose set** — the concrete list of registered purposes that may run (e.g. "executive commercial dashboard", "regulatory periodic report", "platform risk monitoring") — only these go into `query_purpose_registry`.
3. **Control adequacy** — the preventative design (purpose-match-or-reject + High-class query log + tenant-invisible output + SELECT-only role) is sufficient, with the right reviewer/retention expectations.

## Options

1. **Proceed with the PRD control as specified (recommended).** Implement BACKOFFICE-33 exactly as the substrate intends — purpose-gated `bank_internal_view` execution + High-class query logging — and seed `query_purpose_registry` with the governance-approved purpose set. **Pros:** matches the PRD's preventative design; substrate already built; unblocks the executive/finance/risk/compliance aggregates' *governed* path. **Cons:** requires the purpose set + permissibility sign-off to be finalised first.
2. **Proceed with a tighter variant.** Add constraints beyond the PRD baseline if governance requires — e.g. per-purpose approver (four-eyes on registering a new purpose), row-count ceilings, k-anonymity/min-cohort thresholds on outputs, or time-boxed purpose validity. **Pros:** higher assurance. **Cons:** more build; some (e.g. k-anonymity) may over-constrain legitimate executive aggregates.
3. **Defer — single-fintech views only (status quo / PRD default).** Keep cross-fintech aggregation off; ship only per-fintech-scoped views until sign-off lands. **Pros:** zero residual risk; the PRD's own default sequencing. **Cons:** the headline cross-fintech dashboards remain ungoverned-or-absent in their proper form.

## Recommendation

**Option 1**, conditional on governance delivering items (1)–(3) above. The preventative substrate is already the PRD-blessed design and is built; the missing pieces are the **sign-off** and the **approved purpose set**, not the architecture. Adopt specific Option-2 constraints only where governance names a concrete need (most likely: four-eyes on registering a new purpose — cheap, high-assurance, composes with the existing approvals primitive).

## Decision

**Accepted by the user (BD-13 sign-off) on 2026-06-22: Option 1 + four-eyes on new-purpose
registration.** Implement the PRD control as specified; new purposes registered after the
seed go through the four-eyes approvals primitive (the `query_purpose_registry.approved_by`
column already supports it). BACKOFFICE-33 is unblocked.

### Approved starter purpose set (seeded pre-approved under this sign-off)

| `purpose_code` | Description | Consumer |
|---|---|---|
| `executive_dashboard` | Cross-fintech executive commercial + programme KPIs (incl. onboarding funnel) | BACKOFFICE-27 |
| `finance_view` | Cross-fintech fee accrual + TPP-aaS margin | BACKOFFICE-31 |
| `risk_monitoring` | Platform-wide risk signals + liability monitor | BACKOFFICE-30 |
| `operations_monitoring` | Platform health, certification pipeline, outages, recon SLO | BACKOFFICE-28 |
| `compliance_reporting` | Consent volumes, retention posture, dispute/risk backlogs | BACKOFFICE-29 |
| `regulatory_periodic_report` | CBUAE periodic cross-fintech regulatory report generation | BACKOFFICE-23/-35 |

### Build (each its own PR, normal flow)
1. A `beginInternalViewTx()` preamble (mirrors `beginAppTx`) — `BEGIN; SET LOCAL ROLE bank_internal_view` (no `app.bank_id` pin → reads the `internal_view_select USING(true)` MVs across `bank_id`), gated by a **purpose-match-or-reject** lookup in `query_purpose_registry` and a **High-class log** of each bypass query (purpose_code + row count; PII-redacted).
2. Seed the six approved purposes (`registered_by='system:bd-13-seed'`, `approved_by` set).
3. Route the analytics stores' aggregate reads from the single-tenant base tables to the cross-fintech MVs via the governed path, each declaring its `purpose_code`.
4. Four-eyes on registering a **new** purpose (via the approvals primitive → 202 + approval_request).
5. Tests: an unregistered purpose is **rejected**; a tenant-scoped (`ofbo_app`) role **cannot** read the aggregate output; the four-eyes new-purpose flow.

### Note on what changes
The current dashboards read SINGLE-TENANT (`ofbo_app` + RLS pinned to one `bank_id`) — they do not yet read the cross-fintech MVs. BACKOFFICE-33 is the switch to genuine cross-fintech reads under the governed role; in the single-bank demo the visible numbers may be unchanged, but the **governed control path** (role + purpose-gate + log) is what ships.

## Consequences

- The cross-fintech bypass is the single highest-sensitivity data path in the platform; whichever option, the invariant holds: **no tenant-scoped fintech can ever see cross-fintech output**, and every bypass query is preventatively purpose-checked + High-class logged.
- Demo profile: synthetic data only, so enabling it in demo carries no real-PII risk — but the **control wiring** (purpose-gate + log) should ship regardless, so the demo demonstrates the governed path, not an ungoverned shortcut.
- No spec/contract change is implied by the governance decision itself; the BACKOFFICE-33 implementation is internal (DB role + query path + audit), not a new API surface.
