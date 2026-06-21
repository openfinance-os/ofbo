# ADR 0012 — Analytics generic renderer vs bespoke panels

- Status: **Accepted — Option 1** (user decision, 2026-06-21)
- Date: 2026-06-21
- Related: UI-06/-07/-09 (Analytics, Risk, Operations screens), BACKOFFICE-27/-30/-31/-28 (free-form analytics contracts), `docs/design-conformance-audit.md`, `docs/ui-ux-review.md`

## Context

The Analytics, Risk, and Operations screens reuse one **contract-driven generic
renderer** (`AnalyticsSection` → `MetricGrid` / `ObjectTable`). This was a deliberate
choice: the `-27/-30/-31/-28` analytics contracts return **free-form** data
(`{data, meta, freshness}` where `data` is open-shaped), so the renderer formats whatever
keys arrive as a uniform labelled metric grid rather than hand-built panels.

The design-conformance audit (2026-06-21) found this flattens the bespoke Stitch designs
for these three screens — the Liability Monitor, Compliance Hub, risk-posture gauge,
certification-pipeline bars, contribution charts, and Four-Eyes Audit Trail all collapse
to generic KPI cards (MAJOR-DRIFT on all three). Token discipline is clean; the gap is
purely compositional. This is a genuine **architecture decision** (not a bug): the
free-form contract and the bespoke design are in tension. Per CLAUDE.md rule 6, humans decide.

## Options

1. **Keep the generic renderer; accept the simplification (recommended for demo).**
   Record that free-form analytics renders generically by design; treat the bespoke Stitch
   panels as aspirational. **Pros:** zero work; the renderer is robust and degrades well
   (stale-badging, depth-capping); new analytics views render with no UI change. **Cons:**
   the three executive-facing screens never look like their designs; charts/gauges/progress
   bars never appear; lowest design fidelity on the most stakeholder-visible screens.

2. **Name the panels in the contract, render semi-bespoke.** Extend the analytics
   contracts so `data` carries typed, named sections (panel kind + payload: kpi-strip /
   progress-bars / gauge / table / alert-card); the renderer maps each kind to a real
   component. **Pros:** design fidelity without hard-coding per screen; one renderer still
   serves all analytics; charts/gauges become possible. **Cons:** a spec change
   (human-approved) + new chart primitives + each analytics producer must emit typed
   sections — meaningful backend + contract work.

3. **Hand-build each screen bespoke.** Replace the generic renderer on Analytics/Risk/Ops
   with purpose-built React per Stitch design, bound to specific contract fields.
   **Pros:** highest fidelity. **Cons:** abandons the free-form contract's flexibility;
   most code; every new metric needs a UI change; highest maintenance.

## Recommendation

**Option 1 for the demo (record it explicitly), with Option 2 as the post-demo target.**
The generic renderer is the right call while analytics contracts are still settling;
once they stabilise, a typed-panel contract (Option 2) buys design fidelity without
sacrificing the single-renderer flexibility. Option 3 only if a specific screen must be
pixel-faithful before the contract is ready.

## Decision

**Option 1, accepted by the user on 2026-06-21.** Keep the generic renderer for the demo;
the MAJOR-DRIFT on Analytics/Risk/Operations is **by-design, not a defect** — recorded as
accepted in `docs/design-conformance-audit.md`. UX-11 (bespoke/typed panels) is closed
won't-do for now; Option 2 (typed panel sections + chart primitives, via a human-approved
spec change) remains the post-demo target once the analytics contracts stabilise.

## Consequences

- Option 1: the three screens stay generic; `docs/design-conformance-audit.md` should
  mark their drift "accepted (ADR 0012)". No code change.
- Option 2/3: net-new chart/panel primitives + (Option 2) a human-approved analytics
  contract change; tracked as UX-11 (blocked on this ADR).
- Either way, token discipline and the freshness/`{data,meta,freshness}` envelope are unaffected.
