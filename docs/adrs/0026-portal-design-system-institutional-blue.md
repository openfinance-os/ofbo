# ADR 0026 — Retire Stitch as the appearance authority; adopt the in-repo "Institutional Blue" design system

- Status: **Accepted** — chosen by the user (2026-08-26)
- Date: 2026-08-26
- Supersedes: **ADR 0016** (Stitch-fidelity overhaul) *in its appearance-authority premise only* —
  ADR 0016's substantive decision (typed analytics panels over a generic renderer) stands and is
  unaffected. What lapses is "Stitch 'Refined' screens are canonical".
- Scope: the portal's **appearance authority and appearance layer**. Behaviour and data remain
  governed by `specs/backoffice-openapi.yaml`; this ADR does not touch an endpoint, a contract,
  or an acceptance criterion.

## Context

CLAUDE.md makes the Stitch project `8050269076066130289` **binding** for portal appearance
("Stitch = layout + design tokens"), `apps/portal/design/design.md` mirrors it, `tokens.ts`
codifies its Material 3 values verbatim, and `docs/design-conformance-audit.md` pins one
canonical Stitch screen id per route across 20 routes.

Two problems have accumulated.

**The reference has holes that block delivery.** Investigation Detail has no Stitch screen at
all — the audit records it as `MISSING REF`, and UIF-09b was gated on *generating the screen in
Stitch first*. UIF-07b sits behind the same kind of dependency. The sign-in screen is recorded
in the backlog as "the one surface outside the Stitch set". Work is blocked not on design
decisions but on populating an external tool.

**The values were never a brand.** `tokens.ts` is a generic Material 3 light theme. The portal
reads as a competent internal tool with no identity, which is a problem now that the build is
positioned publicly as MiddleLeap's reference evidence for The Loom and is going to LFIs
through the Ozone channel.

A full design system was developed against the live portal and the MiddleLeap brand —
tokens, dark theme, a validated chart palette, Arabic/RTL, density, interaction states, and the
regulated patterns (four-eyes, zero-PII, provenance). It resolves to a direction called
**Institutional Blue**, built from the portal's existing sign-in screen rather than from
scratch.

## Decision

### 1. Stitch is retired as the appearance authority

The repo becomes self-sufficient for appearance. There is no external design tool in the
critical path, and no `upload_design_md` round-trip.

**The new division of truth:**

| Concern | Authority |
|---|---|
| Behaviour + data | `specs/backoffice-openapi.yaml` (unchanged) |
| Design tokens | `apps/portal/design/tokens.ts` — **now the source, not a mirror** |
| Component & pattern specs | The "Open Finance Back Office Design System" project (Claude Design) |
| Human-readable mirror | `apps/portal/design/design.md` |

Pinned Stitch screen ids stop being a requirement. PRs cite the design-system **component or
pattern** they implement instead of a screen id.

### 2. Adopt Institutional Blue

- **Accent** `#2C5FC4`; **shell** `#141B2D` / `#1E2740` / `#6BA1F5`; ground `#F4F6FA`,
  surface `#FFFFFF`. Type: DM Sans (UI), Instrument Serif (display), JetBrains Mono
  (ids/amounts — unchanged), Material Symbols Outlined (icons — unchanged).
- The shell navy **is the navy already shipping** as `ext.nav`. The direction was chosen partly
  because it keeps it.
- **Four semantic states** replace the three-state triad: breach (red), aging (amber),
  awaiting (slate), reconciled (green). "Blocked on a counterparty" and "running out of clock"
  are different problems with different owners; conflating them in one amber was a modelling
  error the palette inherited.
- **The accent is never a status.** It marks one primary action per screen, the active nav item,
  and the focus ring. `--awaiting` is slate precisely so nothing meaning "waiting" can be
  mistaken for the colour meaning "act here".
- MiddleLeap's orange `#E65C2D` is scoped to the **provenance bar only** — the mark and the DEMO
  flag. Company brand and product brand stay separate, which keeps the door open to an adopting
  bank white-labelling the product.

### 3. Replace the retired control — do not simply delete it

**This is the condition on which the decision rests.** Stitch was not only a style reference; it
was the *verification basis* for `design-conformance-audit.md`. Removing it without a
replacement would mean nobody ever looks at a screen again.

Gates replace one human comparison, and they are machine-checkable:

| Gate | What it enforces | Status **as shipped in BACKOFFICE-81** |
|---|---|---|
| `design-conformance.spec.ts` | Token-only usage: no raw hex, arbitrary px, inline styles | exists, unchanged |
| AA contrast block in `design-tokens.spec.ts` | WCAG 2.1 AA on 14 enumerated light-theme pairs — body/secondary text, accent, nav chrome, all four status colours as text, DEMO and TRAINING markers | **shipped** |
| Status semantics in `design-tokens.spec.ts` | Four distinct states; no status may collide with the accent in hue or chroma | **shipped** |
| Dark-theme contrast | — | **NOT SHIPPED.** `tokens.ts` has no dark theme; the design system defines one, the portal does not yet consume it |
| `tokens.json` drift check | Machine-readable token export regenerated from source; CI fails if stale | **NOT SHIPPED.** Exists in the design-system project, not in this repo |

**Be precise about what this means.** The external control was removed in full; the replacement
shipped in part. Two of the five rows above are outstanding, and this ADR's condition is not
fully discharged until they land. They are tracked as follow-ups to BACKOFFICE-81, not as
optional polish.

What *is* discharged is the part that matters most immediately: the contrast gate is real, it
runs in Q1, and it enumerates the pairs the portal actually renders — including the ones the
first cut of it missed.

Plus one that is *not* automatable and must not be dropped: a **rendered visual review**. Each
UI story attaches a screenshot of the built screen, reviewed against the design-system cards.
The repo already produces these (`live-*.png` at root); this makes it a required step rather
than an occasional one.

The contrast gate is not theoretical, and it has now failed twice in its own authoring.

The design system's v0.1 palette shipped **seven contrast failures** — captions at 3.42:1
against a 4.5:1 requirement, placeholders at 2.79:1 against 3.0:1 — because the accessibility
rule lived in a document instead of a build step.

Then the *first cut of the gate itself* was scoped too narrowly: it omitted the status colours
and `ext.demo`, which were exactly the values the migration had regressed. The mandated DEMO
marker had fallen from 5.43:1 to **3.27:1** — the least readable element on a screen whose whole
job is to say "this is not production" — and the new gate could not see it. Caught in hard-stop
review before merge; the tokens were re-solved and the pair list widened to 14.

`design-conformance.spec.ts` checks that we *use* tokens; nothing checked whether the tokens are
*readable*. The lesson of both failures is the same: a gate scoped around what you already
believe is fine will confirm it.

## Consequences

### A recurring dependency class disappears

No UI work is blocked on Stitch *today* — UIF-07b and UIF-09b both closed once the missing
screens were generated. The point is that they were blocked at all: UIF-09b is recorded in the
backlog as "Stitch-gen first", and `design-conformance-audit.md` still carries Investigation
Detail as `MISSING REF`. Every future screen without a Stitch counterpart would have re-incurred
that cost — design work stalled on populating an external tool rather than on a design decision.

That class of dependency ends here. The **sign-in screen** also stops being an exception
recorded as "the one surface outside the Stitch set" and becomes a first-class design-system
surface — which matters, because it is the screen this direction was built from.

### Migration is small

Measured across `apps/portal/src`: **1,809 token-utility uses in 67 files, 68 distinct
utilities.**

| Class | Uses | Work |
|---|---|---|
| Values-only — token name unchanged | ~1,738 (96%) | none; `tokens.ts` values only |
| `break` → `aging` rename | 71 | mechanical |
| `awaiting` — new role | 0 today | added where amber currently overloads |
| Shell (`nav*`) | 82 | **unchanged** — this direction keeps the navy |

There are **no snapshot files**, so no visual-regression churn. Type is already effectively on
the target scale (224 `text-xs`, 162 `text-sm`). `font-sans` appears exactly **once**, so
Inter → DM Sans is a one-line change with `font-mono` (68) and `font-symbols` (39) untouched.

Estimate: **1–2 days**, versus 1–2 weeks for a warm-ground direction that would have inverted
the shell.

Token names surviving a full palette change is what made this cheap, and is why names are
chosen for their **role**, never their colour.

### Files to change on acceptance

| File | Change |
|---|---|
| `CLAUDE.md` | Replace the UI/UX reference convention — text below |
| `apps/portal/design/tokens.ts` | New values; add `awaiting` + `shell`; rename `break` → `aging`; drop Stitch provenance comments |
| `apps/portal/design/design.md` | Rewrite: mirror of the design system, not of Stitch |
| `apps/portal/tailwind.config.ts` | Comment + the `aging`/`awaiting` roles |
| `apps/portal/src/app/globals.css` | One comment |
| `apps/portal/test/design-tokens.spec.ts` | Re-pin to the new values — **see the warning below** |
| `apps/portal/test/design-conformance.spec.ts` | Comments only; its rules do not depend on Stitch |
| `docs/design-conformance-audit.md` | Replace the Stitch-verdict structure with the gate + screenshot basis |
| `docs/backlog.yaml` | UI-track header; unblock UIF-07b / UIF-09b |
| `docs/adrs/0016-*.md` | Status line: superseded in its appearance-authority premise only |

**Historical documents are not rewritten.** ADRs 0002, 0012, 0013 and 0016, and
`docs/build-log.md`, record what was true when written. They keep their Stitch references.

### The test-integrity interaction — read before touching the specs

`design-tokens.spec.ts` pins the Stitch hex values. Editing those assertions looks exactly like
reward-hacking to the test-tripwire hook and the Q1b test-integrity gate (ADR 0019), and will be
blocked — correctly.

The spec change must go on a `feature/BACKOFFICE-NN-testfix-<slug>` branch citing this ADR. The
ADR is the authority for the change, never the convenience of a green build. Roughly 12 further
spec files assert token class names; those are mostly the `break` → `aging` rename.

### Proposed CLAUDE.md replacement

Replacing the current **UI/UX reference (binding)** bullet verbatim:

> **UI/UX reference (binding):** build **every** portal screen against the **Open Finance Back
> Office Design System** (Claude Design project; mirrored in `apps/portal/design/`). Division of
> truth: **`apps/portal/design/tokens.ts` = design tokens** (the source, not a mirror);
> **`specs/backoffice-openapi.yaml` = behaviour + data**. Screens are token-only (no raw
> hex/px), OpenAPI-bound, DEMO-bannered, persona scope-gated, zero PII, four-eyes via `202` +
> `approval_request` (never inline). Cite the design-system component or pattern in the PR and
> attach a screenshot of the built screen. Three gates enforce it: `design-conformance.spec.ts`
> (token-only), `checks/contrast.mjs` (WCAG 2.1 AA), and the tokens-drift check. If a needed
> component is not in the system, add it there first — never invent it in a screen.

### What this ADR does not claim

The system claims WCAG 2.1 AA for **colour contrast, focus visibility, reduced motion and text
resize**, verified on every build. It does **not** claim full AA. Two gaps are open, stated here
rather than rounded up in a sales deck:

- screen-reader labelling of the four-eyes flow
- a keyboard-trap audit of the overlay components

Do not represent the portal as fully AA-conformant until both close.

### Open items

- The MiddleLeap mark in the provenance bar is a **placeholder**; the real asset is required
  before any external use.
- The design system's 31 cards have not been rendered in a browser — sizes were derived
  arithmetically. A visual pass is required before this goes in front of an LFI. This is the
  same weakness that retiring Stitch makes structural, which is why the rendered-review step
  above is a condition of the decision and not a nice-to-have.
- The three regulated pattern cards (`patterns-four-eyes`, `patterns-pii`,
  `patterns-provenance`) encode regulatory obligations as design rules and need a compliance
  read, not a design review. `patterns-keyboard` asserts that no keyboard shortcut may execute a
  four-eyes action — that is a control, not a preference.

## References

- Design system: "Open Finance Back Office Design System" (Claude Design), v0.3
- ADR 0019 — build-harness hardening (test-integrity gate, provenance trailers)
- ADR 0016 — Stitch-fidelity overhaul (superseded in its appearance-authority premise)
- ADR 0002 — Tailwind adoption (unaffected)
- PRD §2 persona scope matrix; PRD §10 adopting-bank defaults
