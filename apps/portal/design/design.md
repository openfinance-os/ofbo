# OFBO Portal Design System (repo-canonical mirror)

Source of truth for **appearance** is the Stitch project **`8050269076066130289`**
("Open Finance Back Office"). `tokens.ts` is the machine-readable token source the
Tailwind preset consumes (UI-00b); this file is the human-readable mirror.
**Behaviour + data** remain governed by `specs/backoffice-openapi.yaml`.

> ✅ **Reconciled 2026-06-17** against the live Stitch screens' `tailwind-config`
> (Customer Care Console + Reconciliation Console — identical Material 3 base). The
> design system is **Material 3 (light theme)**. Re-pull + reconcile if Stitch changes;
> push repo-side edits back via `upload_design_md`.

## Typography
- **Inter** — all UI text. **JetBrains Mono** — ids, money amounts, trace ids.
  **Material Symbols Outlined** — icons. (From the Stitch Google-Fonts links.)

## Colour — Material 3 roles (verbatim from Stitch)
- **`primary` `#000000`**, **`primary-container` `#131b2e`** (the navy), `on-primary` white.
- **`secondary` `#0058be`** (blue), `secondary-container` `#2170e4`.
- Surfaces: `background`/`surface` `#f7f9fb`, `surface-container-lowest` `#ffffff` →
  `…-container-highest` `#e0e3e5`; `on-surface` `#191c1e`; `outline` `#76777d`.
- **`error` `#ba1a1a`** / `error-container` `#ffdad6`.
- Full M3 role set (fixed/inverse/tertiary/etc.) is in `tokens.ts`.

### OFBO semantic extensions (layered on the Stitch base)
The M3 config ships only `error`, so these are OFBO additions in `tokens.ts → ext`:
- **Status triad (load-bearing, every console):** breach = `#ba1a1a` (= Stitch error),
  break = amber `#b26a00`, reconciled = green `#146c2e`.
- **DEMO banner `#b54708`** — persistent on every screen (regulatory hard-stop).

## Spacing & shape (verbatim from Stitch)
- **4px base unit**; `gutter` 16px, `container-padding` 24px.
- **Density:** `row-height-standard` 48px (comfortable), `row-height-dense` 32px (compact).
- Radii: `DEFAULT` .125 / `lg` .25 / `xl` .5 / `full` .75 rem.
- Numeric spacing + type scales come from Tailwind defaults (also 4px-based).

## Screen inventory (Stitch, for UI-02..09 + extras)
Consoles: Customer Care, Reconciliation, Investigation Detail, Four-Eyes Approval,
Analytics & Insights, Risk Management & Anomaly Detection, TPP Billing & Registry,
Operations Console (each with Refined/Hardened iterations). Plus: Certificate Expiry &
Health Monitor, SLO & Error Budget, Shadow TPP Discovery, Bulk Revocation, CBUAE Inquiry,
Granular Consent Manager, PSU Consent Deep-Dive, Customer Interaction History, Incident
Command, and 4 mobile screens. Translate the latest (Refined/Hardened) variant per screen.

## Rules (binding — CLAUDE.md UI/UX convention)
- Token-only: no raw hex/px in components (CI lint enforces — UI-00b).
- OpenAPI-bound: no Stitch mock values on the wire.
- Every screen: DEMO banner, persona scope-gated, zero PII in browser storage/logs,
  four-eyes via `202` + `approval_request` (never inline). Cite the Stitch screen id in the PR.
