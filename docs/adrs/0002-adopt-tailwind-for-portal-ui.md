# ADR 0002 — Adopt Tailwind CSS for the portal UI (UI-00)

- Status: **Accepted** — approved by the user (2026-06-16) to proceed with Tailwind.
- Date: 2026-06-16
- Story: UI-00-DESIGN-SYSTEM — codify the Stitch design system as a repo-canonical token preset
- Supersedes the M1 shell's ad-hoc `--ofbo-*` CSS palette (to be retired, not preserved).

## Context

The portal (`apps/portal`, Next.js on Cloudflare Workers via OpenNext) currently
ships only the M1 shell (login + dashboard + demo-banner/scope-echo/audit-panel),
styled with a hand-rolled `globals.css` and an ad-hoc `--ofbo-*` palette. The UI track
(UI-00..09) translates the Stitch "Regulated Institutional Interface" screens into the
console; per the binding CLAUDE.md UI/UX convention, **Stitch is the appearance source
of truth** and the OpenAPI contract is behaviour/data.

CLAUDE.md: *stack defaults change only via an ADR.* Adopting Tailwind is a new stack
dependency, hence this ADR.

## Decision

Adopt **Tailwind CSS** as the portal styling system, driven by a **repo-canonical
design-token preset** generated from the Stitch design system:

- Tokens live in `apps/portal/design/` (`tokens.ts` = typed source of truth, `design.md`
  = human-readable mirror of the Stitch `design.md`). They are framework-agnostic data.
- A Tailwind **preset** (`tailwind.config`) consumes those tokens — colours, type scale
  (Inter + JetBrains Mono), 4px spacing base, radii, density. No raw values in components.
- CI lint fails on raw hex/px in components (tokens-only enforcement).
- The M1 shell migrates onto tokens; the `--ofbo-*` palette is removed (reconciled).

## Consequences

- New deps in `apps/portal`: `tailwindcss`, `postcss`, `autoprefixer` (+ a tokens→preset
  wiring). **Requires `pnpm` to add the dep + update `pnpm-lock.yaml`.**
- Tailwind compiles at Next build time — verified by the deploy/CI build, not by the
  Vitest component tests (which assert rendered markup/classes, not compiled CSS).

## Rollout note (environment blockers at time of writing)

This ADR is Accepted, but completing UI-00 is currently gated by the local environment:
1. **`pnpm` unavailable** in the build shell (only `npm`, which would corrupt the pnpm
   workspace) → cannot add Tailwind / update the lockfile cleanly.
2. **CI/Actions billing block** → cannot verify the Next+Tailwind build or merge.
3. **Stitch MCP unreachable** (`Incompatible auth server: does not support dynamic
   client registration`) → cannot pull the live `design.md` or translate the actual
   screens (UI-02..09).

Therefore UI-00 lands in two parts:
- **UI-00a (this change):** the ADR + the canonical design tokens (`apps/portal/design/`),
  codified from the documented Stitch token spec — install-free and verifiable now.
  Reconcile against Stitch's `design.md` once the MCP connection is restored.
- **UI-00b (deferred):** Tailwind preset wiring + `globals.css` migration + the raw-value
  lint rule — once `pnpm` + CI are available. Then UI-01 (app shell) and the screen
  translations (UI-02..09), which need Stitch reachable.
