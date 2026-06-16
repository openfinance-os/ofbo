# OFBO Portal Design System (repo-canonical mirror)

Source of truth for **appearance** is the Stitch project **`8050269076066130289`**
("Regulated Institutional Interface"). This file is the repo mirror of Stitch's
`design.md`; `tokens.ts` is the machine-readable token source the Tailwind preset
consumes (UI-00b). **Behaviour + data** remain governed by `specs/backoffice-openapi.yaml`.

> ⚠️ Authored while the Stitch MCP connection was unreachable — values are the
> documented spec. **Reconcile against the live Stitch `design.md`** once Stitch is
> restored, and push any repo-side edits back via `upload_design_md`.

## Typography
- **Inter** — all UI text. **JetBrains Mono** — ids, money amounts, trace ids, code.
- Type scale: `xs .75 / sm .875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 / 3xl 1.875` rem.

## Colour
- **Primary navy `#0F172A`** — brand ink, sidebar/topbar.
- **Status triad (load-bearing, used on every console):** breach = red `#DC2626`,
  break = amber `#D97706`, reconciled = green `#16A34A`; info = `#0A6CFF`.
- Surfaces: white / `#F8FAFC` raised / `#F1F5F9` sunken / `#E2E8F0` border.
- **DEMO banner `#B54708`** — persistent on every screen (regulatory hard-stop).

## Spacing & shape
- **4px spacing base** (`space[1]` = 4px); scale 0,1,2,3,4,5,6,8,10,12.
- Radii: `sm .25 / md .5 / lg .75` rem, `full`.

## Density
- **comfortable** (default) and **compact** row-height/padding pairs for dense tables
  (break queues, run lists).

## Rules (binding — CLAUDE.md UI/UX convention)
- Token-only: no raw hex/px in components (CI lint enforces — UI-00b).
- OpenAPI-bound: no Stitch mock values on the wire.
- Every screen: DEMO banner, persona scope-gated, zero PII in browser storage/logs,
  four-eyes via `202` + `approval_request` (never inline). Cite the Stitch screen id in the PR.
