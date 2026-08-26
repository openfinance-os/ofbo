# Design-conformance audit — portal screens vs the design system

Audit of the built portal screens against the **Open Finance Back Office Design System**
("Institutional Blue"), mirrored in `apps/portal/design/`. Division of truth per CLAUDE.md:
**`apps/portal/design/tokens.ts` = design tokens; `specs/backoffice-openapi.yaml` = behaviour +
data.** Verdicts judge *appearance/layout only* — data binding and behaviour are out of scope.

> **ADR 0026 (2026-08-26) replaced the basis of this document.** It previously audited each route
> against a pinned screen id in the external Stitch project. Stitch was retired as the appearance
> authority, so per-route screen ids are gone and with them the `MISSING REF` verdict class —
> Investigation Detail had no Stitch counterpart and was recorded as un-auditable for two months.
>
> The prior revision (2026-06-22, UIF-10 gate) is preserved in git history. Its substantive finding
> stands: **no MAJOR-DRIFT remained**, and the three root causes it tracked were closed or reduced.

## What replaces the Stitch comparison

One human screenshot comparison became three machine-checkable gates plus one human step that is
deliberately *not* automated.

| Gate | Enforces | Where |
|---|---|---|
| Token-only | No raw hex, arbitrary px/rem/em, inline `style` props, or the retired `--ofbo-*` palette | `design-conformance.spec.ts` (Q1) |
| WCAG 2.1 AA contrast | The 14 enumerated foreground/background pairs — body and secondary text, accent, nav chrome, all four status colours as text, and the DEMO and TRAINING markers — asserted on every build | `design-tokens.spec.ts` (Q1) |
| Status semantics | Four distinct states; no status may collide with the accent in hue or chroma | `design-tokens.spec.ts` (Q1) |
| **Rendered review** | **A screenshot of the built screen, attached to the PR** | **human, per story** |

The rendered review is the load-bearing one. Retiring an external reference removes the thing that
forced anyone to *look* at a screen. Gates catch token drift and unreadable colour; they cannot
catch a broken layout, a wrapped heading, or a panel that renders empty. **A UI story without an
attached screenshot is not reviewable** — that is the trade ADR 0026 made explicit, and it is the
one part of this document that depends on discipline rather than CI.

**The contrast gate enumerates its pairs, and that list is the gate.** A pair not on it is not
checked. The first cut of this gate omitted the status colours and the DEMO marker — precisely
the values the Institutional Blue migration had regressed, with the mandated non-prod marker
down at 3.27:1. Adding a token means adding its pair; a gate scoped around what changed is not
a gate.

## Per-route status

Carried forward from the 2026-06-22 re-audit. Routes are no longer pinned to an external screen;
each is audited against the design-system components and patterns it composes.

| Route / component | Composed from | Status | Note |
|---|---|---|---|
| `/care` · care-console.tsx | attention rows, event timeline, status pills | **CONFORMANT** | Connected 24-month timeline (UIF-09); investigation module present |
| `/reconciliation` · recon-console.tsx | stat tiles, register table, outcome panel | **CONFORMANT** | Bespoke outcome panel (UIF-07). Three-source comparison + margin split tracked in UIF-07b |
| `/reconciliation/breaks/[id]` · investigation-detail.tsx | drawer, three-source diff | **AUDITABLE** | Previously `MISSING REF` — un-auditable for want of an external screen. That blocker is gone; audit against the drawer + table patterns |
| `/approvals` · approvals-portal.tsx | four-eyes pattern, queue rows | **CONFORMANT** | Dual initiator/approver block; `202` + `approval_request`, never inline |
| `/analytics` · analytics-dashboard.tsx | typed section renderer, gauge, contribution bars, KPI strip | **CONFORMANT** | ADR 0016 typed panels — unaffected by ADR 0026 |
| `/risk` · risk-dashboard.tsx | KPI strip, contribution bars, liability monitor | **CONFORMANT** | UIF-04 |
| `/operations` · operations-console.tsx | platform-health strip, pipeline bars, outages table | **CONFORMANT** | UIF-05 |
| `/tpp-billing` · tpp-billing.tsx | KPI overview row, columnar registry, search/filter | **CONFORMANT** | UIF-08/-08b/-08c. Billing-cycle stepper dropped as low-value |
| `/` · dashboard-command.tsx | system-health panel, four-eyes queue panel | **CONFORMANT** | UIF-06 |
| `/` (sign-in) · page.tsx | sign-in panel, persona cards, provenance bar | **CONFORMANT** | Previously recorded as "the one surface outside the Stitch set". It is now a first-class design-system surface — and the screen Institutional Blue was derived from |

## Rendered verification — 2026-08-26 (BACKOFFICE-81)

The first pass under the new rule. Portal run locally (`next dev`, port 3100), driven with
Playwright at **1440×900**, screens captured and inspected.

| Screen | Verdict | Note |
|---|---|---|
| `/` sign-in | **PASS** | Navy panel, cool ground, blue accent on persona tags and links. DEMO pill legible. |
| `/dashboard` | **PASS** | Navy shell with blue active item; four-eyes queue panel; footer DEMO statement present. |
| `/reconciliation` | **PASS** | Error state renders in the new breach red; primary action in the new blue. |
| `/care` | **PASS** | PSU lookup form, "Audited (high-sensitivity)" chip, primary button all correct. |
| `/guide` | **PASS** | Strongest of the set — navy hero, blue eyebrow, cool cards. |
| `/readiness` | **PASS** | Public route. Confirms the corrected DEMO orange is legible on its own tint. |

No console errors on any screen beyond the React DevTools notice.

### Finding — DEMO pill occludes the footer's bottom-right link

On every authenticated screen, the `DemoPill` (`fixed bottom-3 right-3 z-50`) sits over the
footer's right-hand link, truncating "Production readiness" to "Pro…".

**Pre-existing, not introduced by BACKOFFICE-81** — that commit changed the pill's colour only,
never its position. It is `pointer-events-none`, so the link stays clickable and the DEMO marker
itself is fully visible and legible; the regulatory requirement is met. This is a cosmetic
collision, and fixing it belongs in its own story rather than in a palette change.

### Not verified

**Status badges were not rendered in situ.** The four status colours drive
`status-badge.tsx`, which needs live BFF data; the BFF would not start in this environment
(no `.env`, and `tsx` did not finish compiling). Their contrast is asserted mathematically by
the AA block in `design-tokens.spec.ts`, but nobody has yet *seen* a breach, aging, awaiting or
reconciled badge on the new palette. **That is the first thing to check on the next UI story.**

## Open items

- **The per-route table above predates the palette change** and is carried forward, not
  re-verified — the six screens in the rendered pass are the exception.
- **Accessibility is claimed narrowly.** WCAG 2.1 AA for colour contrast, focus visibility, reduced
  motion and text resize — verified on every build. Screen-reader labelling of the four-eyes flow
  and a keyboard-trap audit of the overlay components are **open**. Do not represent the portal as
  fully AA-conformant until both close.
- **Status dots** fall below 3:1 alone and are legal only because every dot ships with its word
  (WCAG 1.4.1). Colour alone never carries state — worth re-checking on any new status surface.

## References

- ADR 0026 — retire Stitch; adopt Institutional Blue (this document's basis)
- ADR 0016 — typed analytics panels (substantive decision stands; appearance premise superseded)
- `apps/portal/design/design.md` — human-readable token mirror
- `docs/ui-ux-review.md` — the UX-track findings this audit does not duplicate
