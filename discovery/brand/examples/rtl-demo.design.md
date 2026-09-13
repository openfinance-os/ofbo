---
profile_id: design.md
profile_version: 1
entity: "RTL Demo (synthetic)"
status: demo
banner: "DEMO — right-to-left rendering demo · synthetic, non-production"
lang: ar
dir: rtl
---

# Brand profile — RTL Demo (a right-to-left brand behind the same seam)

> **Identifiers.** Gate ids (`D1`–`D9`, `Q1`–`Q5`) and run-level ids (`S-001` signal,
> `T-1` theme, `H1` hypothesis) are expanded in `discovery/GLOSSARY.md`. They stay Latin in
> every writing direction.

This is a **third brand instance**, mounted behind the *same seam* as `design.md` and
`meridian-trust.design.md`, and it exists to prove one thing the other two cannot: the harness
can render **right-to-left**. Until `lang`/`dir` became brand front-matter, the renderer emitted
a hard-coded `<html lang="en">` with no direction at all, so an RTL artifact was not expressible
— no token could have fixed it, because the defect was in the shell, not the palette.

Identical token **names**, different **values** and a different **direction**. The renderer and
gate D7 read this file exactly as they read the other two — no code changes to swap.

> Render any run's specs against this brand with `--brand`:
> `node discovery/render/render.mjs deck <spec.json> <out.html> --brand discovery/brand/examples/rtl-demo.design.md`

**What direction is, and is not.** `dir: rtl` is a layout property of a brand. It is not a
jurisdiction, not a language requirement, and not a claim of any kind about the institution
rendering through it or about the products it sells. A conventional bank may be RTL; an Islamic
one may be LTR. Nothing downstream reads this file for anything but tokens, banner text, and the
two attributes on `<html>`.

**Why the banner text is English.** The harness ships no translated content, and a demo profile
inventing some would be pretending to a translation nobody reviewed. An adopter replaces
`banner` with its own text in its own language; `lang: ar` here describes what the *seam* is
demonstrating, and the sample strings are the harness's own.

## Conformance marker

Same contract as every other instance — every rendered artifact carries
`<!-- discovery/brand/design.md@v1 -->` and uses token values only.

## 1. Design tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `color.brand.primary` | `#0F6E63` | Primary actions, headers, links |
| `color.brand.primary-ink` | `#FFFFFF` | Text on primary |
| `color.brand.accent` | `#2E7D32` | Positive / success / "within tolerance" |
| `color.status.warn` | `#A8620A` | Caution / nearing threshold |
| `color.status.danger` | `#A32020` | Breach / liability crossing |
| `color.surface.bg` | `#F6F9F8` | Page background |
| `color.surface.card` | `#FFFFFF` | Card / panel |
| `color.ink.strong` | `#10201E` | Primary text |
| `color.ink.muted` | `#596966` | Secondary text |
| `color.border.subtle` | `#DCE7E5` | Dividers, table rules |

### Typography

The sans stack leads with faces that cover the script and ends in a generic family, because the
D7 font allow-list is harvested from backticked stacks ending in `sans-serif`/`serif`/`monospace`
— a stack ending in a named face would be invisible to the harvest and every artifact using it
would fail D7.

| Token | Value |
|---|---|
| `font.family.sans` | `"Noto Naskh Arabic", "Geeza Pro", "Segoe UI", sans-serif` |
| `font.family.mono` | `"Noto Sans Mono", "Courier New", monospace` |
| `font.size.h1` | `30px` |
| `font.size.h2` | `23px` |
| `font.size.h3` | `18px` |
| `font.size.body` | `16px` |
| `font.size.caption` | `13px` |
| `font.weight.regular` | `400` |
| `font.weight.semibold` | `600` |

### Spacing & shape

| Token | Value |
|---|---|
| `shadow.card` | `0 1px 3px rgba(16,32,30,0.10)` |

### Logo

| Token | Value |
|---|---|
| `logo.wordmark` | `DEMO` rendered in `font.family.sans` / `font.weight.semibold` / `color.brand.primary` |

## 2. Voice & tone

- **Plain, institutional, unhurried.** Same register as any brand here; the direction changes,
  the honesty rules do not.
- Same hard rules as any brand: tokens only, DEMO banner, zero PII, synthetic data.

## 3. Layout in this direction

- Mirroring comes from the renderers' logical CSS (`border-inline-start`, `inset-inline-end`,
  `text-align: start`). This file adds no direction-specific rule, and it must not need to — a
  brand that had to ship its own `[dir=rtl]` overrides would mean the seam had leaked.
- Latin identifiers (gate ids, token names, paths) stay Latin and belong in their own cell or
  block rather than mid-sentence; see the RTL media rules in `discovery/brand/design.md`. The
  renderers isolate nothing, and no gate detects a badly-placed one.

## 4. Accessibility minimums

- Text contrast ≥ 4.5:1; never colour-only meaning; logical heading order.
