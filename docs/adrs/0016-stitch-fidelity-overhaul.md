# ADR 0016 — Stitch-fidelity overhaul: typed analytics panels + a charting library

- Status: **Accepted** (user decision 2026-06-21; supersedes ADR 0012 Option 1)
- Date: 2026-06-21
- Supersedes: **ADR 0012** (Analytics generic renderer vs bespoke panels — was "Accepted Option 1")
- Related: `docs/design-conformance-audit.md`, `docs/ui-ux-review.md`, UX-11 (reopened),
  the new **UI-FIDELITY** backlog track, BACKOFFICE-27/-30/-31/-28 (analytics contracts),
  Stitch project `8050269076066130289` ("Refined" screens are canonical)

## Context

A live visual review (2026-06-21, portal vs Stitch "Refined" references, screenshots
captured for Dashboard / Analytics / Risk / Operations / Reconciliation / TPP / Care)
confirmed and sharpened the two prior audits: **token discipline is clean on every screen;
the entire gap is compositional.** The portal is a token-correct, structurally-faithful
skeleton with the design layer absent. Stitch's value lives in composition — named panels,
big-number hierarchy, radial gauges, sparklines, horizontal contribution bars, colored
status tags, prominent CTAs, status footers, dense executive layouts — and **none of those
primitives exist in the codebase** (`components/ui/` is entirely functional widgets; only
two files reference `<svg>` at all). Every screen therefore collapses to uniform KPI cards
and label/value tables on oversized empty canvases.

ADR 0012 accepted this (Option 1) as a deliberate demo simplification, closing UX-11
won't-do. **The user has reversed that decision** (2026-06-21): the demo's most
stakeholder-visible screens must look like their Stitch designs. ADR 0012 itself named the
path — Option 2 (typed, named contract sections + chart primitives) — as the post-demo
target. This ADR promotes Option 2 to active and records the two decisions it requires:
reverse the renderer choice, and add a charting dependency (a stack change → ADR per
CLAUDE.md).

## Decisions

### D1 — Reverse ADR 0012: adopt typed analytics panels (Option 2)

The generic `AnalyticsSection → MetricGrid / ObjectTable` renderer is replaced by a
**typed-section renderer**: the analytics contracts (`-27/-30/-31/-28`) are extended via a
**human-approved spec-change** so `data` carries named sections with a discriminated
`kind` (`kpi-strip` | `gauge` | `contribution-bars` | `status-cards` | `alert` |
`object-table`) + a typed payload. The renderer maps each `kind` to a real token-bound
component. One renderer still serves all analytics screens (the flexibility Option 1 was
protecting), but now with design fidelity. Free-form/unknown sections still degrade to the
existing labelled grid, so the change is backward-safe and the `{data, meta, freshness}`
envelope + stale-badging are untouched.

Rejected — Option 3 (hand-build each screen against specific fields): abandons the
single-renderer flexibility, highest maintenance, every new metric needs a UI change.

### D2 — Adopt a charting library (token-bound)

No viz primitives exist; building gauges/sparklines/bars by hand for every screen is the
larger cost. Adopt a charting library, wrapped behind token-bound `components/ui/`
primitives so **no raw hex/px reaches a chart** (the design-conformance gate still holds)
and screens never import the library directly.

- **Confirmed pick: `@visx/*`** (user acceptance 2026-06-21). D3-based, composable,
  tree-shakeable, SSR/RSC-safe — you compose the mark, so colors/radii come straight from
  `design/tokens.ts`. Best fit for our needs (radial gauge, sparkline, horizontal stacked
  bars, small dashboard lines), for token control, and for the Cloudflare Workers bundle
  (charts ship as client islands; the Worker server bundle is unaffected).
- Fallback: **Recharts** (batteries-included, faster to stand up, but heavier and less
  granular token control) — only if visx proves too low-level during UIF-01.
- Either way the library is isolated behind the primitive layer; screens never import it
  directly.

## Behavioural guardrails (binding — Stitch is appearance-only)

The Stitch "Refined" screens show **inline REVIEW/APPROVE buttons and mock numbers**. These
are appearance references only and MUST NOT be copied literally:

- Four-eyes stays `202` + `approval_request`, **never inline** — bespoke panels that show a
  pending-approvals queue (Dashboard, Operations) render counts/links to `/approvals`, not
  executable approve/reject controls.
- **No Stitch mock values** — every number, bar, and gauge binds to the OpenAPI contract.
- Token-only (no raw hex/px), DEMO-bannered, persona scope-gated, zero PII (gauges/feeds
  project away PSU identifiers exactly as today).

## Consequences

- Net-new token-bound viz/panel primitives (`KpiStat`, `Gauge`, `Sparkline`,
  `ContributionBar`, `StatusTag`, `SectionCard`, `StatStrip`) + the `@visx` dependency.
- A **human-approved spec-change** for typed analytics sections (the gate for bespoke
  Analytics/Risk/Operations). This ADR's acceptance is that human decision; the contract
  diff itself still rides its own spec-change PR through the four quality gates, and BFF
  analytics producers emit typed sections.
- Tracked as the **UI-FIDELITY** backlog track (foundation → contract gate → flagship
  bespoke → hand-built omissions → re-audit). **UX-11 is reopened** under it.
- `docs/design-conformance-audit.md` "accepted (ADR 0012)" notes on Analytics/Risk/Ops are
  no longer accepted-as-final; they become the acceptance criteria for UIF-03/-04/-05.
- ADR 0012 is marked **Superseded by ADR 0016**.
- Risk: scope. This is a milestone, not a polish pass; the sequencing front-loads the
  foundation + shell (highest visual ROI, no contract dependency) so value lands before the
  spec-change clears.
