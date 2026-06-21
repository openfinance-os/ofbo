# Design-conformance audit — portal screens vs Stitch (2026-06-21)

Audit of the built portal screens against their **Stitch** appearance references
(project `8050269076066130289`, "Regulated Institutional Interface"). Division of truth
per CLAUDE.md: **Stitch = layout + design tokens; OpenAPI = behaviour + data.** Verdicts
below judge *appearance/layout only* — data binding and behaviour are out of scope.

Method: per screen, the Stitch reference screenshot was viewed and the React
implementation read; layout/section/hierarchy + token usage compared.

## Headline

- **Token discipline is clean on all screens** — no raw hex/px anywhere; the
  `design-conformance.spec` gate is doing its job. **All drift is structural/compositional.**
- The drift resolves into **three** root causes, not eight independent problems:
  1. **Generic analytics renderer** (Analytics, Risk, Operations) — a documented architectural tradeoff.
  2. **Genuine omissions** in two hand-built screens (Reconciliation, TPP Billing).
  3. **Reference problems** (Investigation has no Stitch screen; Four-Eyes' real reference is the mobile queue).

## Canonical reference map + verdicts

| Route / component | Canonical Stitch screen | Verdict | Note |
|---|---|---|---|
| `/care` · care-console.tsx | `03c038c9…` Customer Care Console (Hardened) | **MINOR-DRIFT** | Missing Bulk-Revocation header btn + per-row Investigate; timeline simplified; `rounded-xl` vs `rounded-lg` |
| `/reconciliation` · recon-console.tsx | `46e55863…` Reconciliation Console (Refined) | **MAJOR-DRIFT** | Missing three-way comparison table, finance/margin KPIs, Margin-by-Fintech, Export/Sign-off actions; run-list in comparison slot. Break Queue conforms |
| `/reconciliation/breaks/[id]` · investigation-detail.tsx | **NONE EXISTS** | **MISSING REF** | All 3 "Investigation Detail View" Stitch screens are Risk/TPP forensics, not the finance three-source diff. Generate a finance investigation screen in Stitch |
| `/approvals` · approvals-portal.tsx | `a6eb7f25…` Mobile Approval Queue (only queue design) | **MINOR-DRIFT** | React desktop queue is a fair adaptation of the mobile queue; dual initiator/approver block + inline actions are additive & behaviourally correct. (Desktop "Four-Eyes Approval Portal" variants are single-request detail, not queues) |
| `/analytics` · analytics-dashboard.tsx | `93e9aaa9…` Analytics & Insights (Refined) | **MAJOR-DRIFT** | Generic metric-grid flattens bespoke panels (Liability Monitor, Compliance Hub, contribution bars, Generate-CBUAE-Pack) — see root cause #1 |
| `/risk` · risk-dashboard.tsx | `4f04802a…` Risk Management & Anomaly Detection | **MAJOR-DRIFT** | Generic renderer; missing risk-posture gauge, live anomaly stream, liability threshold bars + escalation — root cause #1 |
| `/operations` · operations-console.tsx | `cd4aaffd…` Operations Console (Refined) | **MAJOR-DRIFT** | Generic renderer flattens Platform-Health KPI strip, Certification Pipeline bars, Critical-Alerts card, Four-Eyes Audit Trail — root cause #1 |
| `/tpp-billing` · tpp-billing.tsx | `3d6d14a3…` TPP Billing & Registry (Refined) | **MAJOR-DRIFT** | Missing KPI row, onboarding alert, Billing Action Center, billing-cycle stepper, audit-trail feed; registry reduced to flat list (no columns/search/filter) |

(App shell, compliance-view audited separately / no dedicated bespoke Stitch screen.)

## Root cause #1 — the generic analytics renderer (Analytics, Risk, Operations)

> **RESOLVED — drift ACCEPTED (ADR 0012, Option 1, user decision 2026-06-21).** The generic
> renderer is kept for the demo; the MAJOR-DRIFT on Analytics/Risk/Operations is **by-design,
> not a defect**. Typed panel sections + chart primitives (ADR 0012 Option 2) are the
> post-demo target once the analytics contracts stabilise. UX-11 closed won't-do.

These three reuse one contract-driven `MetricGrid` / `AnalyticsSection`. Because the
`BACKOFFICE-27/-31` analytics contracts return **free-form** data, the renderer cannot
reproduce Stitch's named panels, charts, gauges, or progress bars — every screen collapses
to uniform KPI cards. This is an **architectural tradeoff documented in the component**,
not an accident. Closing it requires either *named-panel contracts* or *bespoke React per
Stitch region* → decided in **ADR 0012 (Option 1 accepted)**.

## Root cause #2 — genuine omissions (Reconciliation, TPP Billing)

Hand-built and token-clean, but missing first-class Stitch sections (the three-way
comparison table; the billing-cycle stepper + action center). These are buildable
enhancements against an existing, correct reference — backlog items, not architecture.

## Root cause #3 — reference problems (Investigation, Four-Eyes)

- **Investigation**: no finance-investigation screen exists in Stitch — the component is
  orphaned. Per CLAUDE.md ("if a needed screen isn't in Stitch, generate it there first"),
  generate a finance three-source-diff investigation screen, then re-audit. Not a defect.
- **Four-Eyes**: the desktop portal variants are single-request detail; the only queue
  design is the **Mobile Approval Queue**. The React desktop queue conforms to *that*
  (MINOR). The Stitch project lacks a desktop queue variant — consider generating one.

## Note on "missing" controls

Some Stitch controls are intentionally absent in React for **behavioural** reasons, not
drift: four-eyes actions must be `202`+approval (never inline), and bulk-revoke is
approval-gated. Stitch's inline action buttons are appearance references only.

## Recommendations (priority order)

1. **Fix the Stitch project's variant/reference gaps** (root cause #3): generate the
   finance Investigation screen (and optionally a desktop four-eyes queue); pin one
   canonical Stitch screen id per route in code per the CLAUDE.md convention.
2. **ADR on the generic-renderer tradeoff** (root cause #1): accept free-form analytics as
   a deliberate simplification, or commit to bespoke panels for Analytics/Risk/Operations.
3. **Backlog the genuine omissions** (root cause #2): three-way comparison table; TPP
   billing-cycle stepper + action center.
4. **Quick win**: Care console (MINOR) — bulk-revoke header + timeline treatment → conformant.
