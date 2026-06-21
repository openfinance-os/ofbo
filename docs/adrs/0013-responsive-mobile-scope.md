# ADR 0013 — Responsive / mobile scope for the portal

- Status: **Proposed** — awaiting human decision
- Date: 2026-06-21
- Related: UI-01 (App shell), `docs/ui-ux-review.md`; the Stitch project's mobile screens (Executive Mobile Pulse, Mobile Approval Queue/Detail, Mobile System Health)

## Context

The UI/UX review (2026-06-21) found the portal is **desktop-only in practice**: the
240px sidebar never becomes a drawer (no breakpoint behaviour anywhere), data tables lack
overflow guards, the top bar can't wrap, KPI grids collapse at three inconsistent
breakpoints, and the app-shell density toggle is wired to nothing. Yet the Stitch project
contains **finished mobile designs** (Executive Mobile Pulse, Mobile Approval Queue,
Mobile Approval Detail, Mobile System Health), implying mobile was intended.

This is a **scope decision**, not a bug: how responsive must the back office be? A bank
operator console is a primarily-desktop tool, but approvals (a 2-hour-expiry, time-
sensitive four-eyes action) have a real on-the-go use case — which is exactly what the
Stitch Mobile Approval Queue/Detail target. Humans decide (CLAUDE.md rule 6).

## Options

1. **Desktop-first + responsive-safe, mobile only for approvals (recommended).**
   Make the existing shell responsive-*safe* (off-canvas drawer sidebar below `lg`,
   `overflow-x-auto` on data tables, top-bar wrap, one consistent KPI grid ladder, wire or
   remove the density toggle) so nothing breaks on a small screen, and build the **Mobile
   Approval Queue/Detail** as the one genuinely mobile journey (time-sensitive approvals).
   **Pros:** fixes the real breakage + serves the one journey with a mobile use case;
   bounded scope. **Cons:** the other screens are usable-but-not-optimised on mobile.

2. **Full responsive build** — every screen responsive per the mobile Stitch designs +
   the mobile dashboards. **Pros:** complete mobile parity. **Cons:** large; most operator
   journeys (reconciliation three-way diff, registry tables) are poor fits for phones —
   high effort for low real-world use.

3. **Desktop-only, explicit.** Declare the portal desktop-only; drop the mobile Stitch
   screens; add a min-width notice. **Pros:** least work; honest. **Cons:** abandons the
   designed mobile approval journey; the density toggle still needs wiring or removal.

## Recommendation

**Option 1.** Responsive-safe shell + tables (fixes the actual breakage and the dead
density toggle) plus the mobile approval journey (the one screen with a real mobile need).
Defer broader mobile parity unless a stakeholder requires it.

## Decision

_Pending._ If Option 1: raise UX-10 (responsive-safe shell + table overflow + density
wiring + consistent KPI breakpoints) and a UI-1x story for the Mobile Approval Queue/Detail
(cite the Stitch mobile screen ids). If Option 3: a small "desktop-only" story + remove the
mobile Stitch screens.

## Consequences

- Option 1: UX-10 (shell/tables/density) becomes eligible; a mobile-approval UI story is added.
- Option 2: a dedicated responsive milestone.
- Option 3: drop mobile designs; record the constraint.
- The token layer is responsive-agnostic; this is layout/breakpoint work only.
