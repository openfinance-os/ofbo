# OFBO Portal Design System — "Institutional Blue"

Human-readable mirror of `tokens.ts`. **`tokens.ts` is the source**, not this file and not
an external tool — ADR 0026 retired the Stitch project as the appearance authority.

> **Division of truth**
> `apps/portal/design/tokens.ts` — design tokens (source)
> "Open Finance Back Office Design System" (Claude Design) — component + pattern specs
> `specs/backoffice-openapi.yaml` — behaviour + data

## Typography

- **DM Sans** — all UI text, and all *rounded summary* figures.
- **Instrument Serif** — display only: page and section titles. One weight, so scale
  carries hierarchy. Never below 20px, never for figures.
- **JetBrains Mono** — ids, exact amounts, trace ids. Tabular by construction.
- **Material Symbols Outlined** — icons, variable axes `opsz 24, wght 300, FILL 0, GRAD 0`
  to match the 1.6px stroke weight of the rest of the UI.

**Two figure rules.** Rounded summary figures (`14`, `99.4%`, `1.20M`) are DM Sans 700 with
`tabular-nums`, so columns hold still as values update. Exact amounts and ids
(`AED 305,010.00`, `BRK-2026-0409`) are JetBrains Mono. A one-weight display serif can do
neither job — it ships proportional figures.

**Scale** — two tiers, nine steps, no half-pixels.
Text: 11 · 12 · 13 · 14 · 15. Display: 20 · 28 · 36 · 48.
**11 is reserved for tracked ALL-CAPS labels; the floor for any sentence is 12.**

## Colour

Role names are the public API and are deliberately **colour-neutral**. Components address
`surface`, `on-surface`, `outline` — never a hue. That is why the palette could change
wholesale while 96% of 1,809 call sites stayed untouched. *Never name a token for its colour.*

- **Accent** `secondary #2c5fc4` — institutional blue.
- **Shell** `ext.nav` `#141b2d` / `#1e2740` / `#6ba1f5` — the navy sidebar and sign-in panel.
  Kept from the live portal rather than reinvented (ADR 0026).
- **Ground** `surface #f4f6fa`, cards `surface-container-lowest #ffffff`.
- **Ink** `on-surface #121826`, secondary text `on-surface-variant #55607a`.
- **Company mark** `ext.demo #e65c2d` — MiddleLeap orange. Provenance bar only: the mark and
  the DEMO flag. Never in the application body.

### Status — four states, not three

| State | Token | Meaning |
|---|---|---|
| Breach | `#c4342f` | SLA missed, liability threshold crossed |
| Aging | `#b0740e` | Open, approaching its clock |
| Awaiting | `#77808f` | Parked on a counterparty — not our clock |
| Reconciled | `#1f8a5b` | Matched, settled |

"Blocked on a counterparty" and "running out of clock" are different problems with different
owners. Conflating them in one amber was a modelling error the palette inherited.

`break` remains as a **deprecated alias** of `aging` for one minor release (GOVERNANCE).

### The accent rule

**The accent is never a status.** It marks the one primary action per screen, the active nav
item, and the focus ring — nothing else.

`awaiting` sits on the accent's own hue, so its **chroma** is what keeps it distinguishable:
saturation is held at or below the "reads as grey" threshold. Confusability is a hue-and-chroma
question, not a contrast one — breach red and the accent blue sit at nearly the same luminance
while being 142° apart and in no danger of confusion. `design-tokens.spec.ts` asserts this.

## Shape, spacing, density

- **4px base unit**; `gutter` 16px, `container-padding` 24px.
- Radii: `sm` .125 / `DEFAULT` .25 / `md` .375 / `lg` .5 / `xl` .75 rem / `full` **9999px**.
  Inputs and buttons use `DEFAULT`; data containers `lg`; status badges `full` (a true pill).
- **Density:** `row-height-standard` 48px (comfortable), `row-height-dense` 32px (compact).
  Density changes geometry only — **never type**. A compact mode that shrinks text to fit more
  rows fails both the operator and WCAG.

## Accessibility

Claimed: **WCAG 2.1 AA** for colour contrast, focus visibility, reduced motion, text resize.
Every foreground/background pair the portal uses is asserted in `design-tokens.spec.ts`, so a
palette that regresses on contrast fails CI.

Status dots fall below 3:1 on their own and are legal only because **every dot ships with its
word** (1.4.1). Colour alone never carries state.

**Not yet claimed:** screen-reader labelling of the four-eyes flow, and a keyboard-trap audit
of the overlay components. Do not represent the portal as fully AA-conformant until both close.

## Binding rules (CLAUDE.md UI/UX convention)

- **Token-only:** no raw hex/px in components — `design-conformance.spec.ts` enforces it.
- **OpenAPI-bound:** no mock values on the wire.
- Every screen: persistent DEMO marker, persona scope-gated, zero PII in browser storage,
  logs or telemetry, four-eyes via `202` + `approval_request` (never inline).
- Cite the design-system component or pattern in the PR, and attach a screenshot of the built
  screen. With no external reference to diff against, the rendered review *is* the check.
- If a needed component is not in the system, add it there first — never invent it in a screen.
