---
profile_id: design.md
profile_version: 1
entity: "Meridian Trust (DEMO instance)"
status: demo
banner: "DEMO — Meridian Trust · synthetic, non-production"
---

# Brand profile — Meridian Trust (a second, mounted brand)

This is **not OFBO**. It is a deliberately contrasting brand mounted behind the *same seam*
to prove the discovery harness is solution-agnostic: identical token **names**, different
**values** (royal-purple + serif here vs OFBO's blue + Inter). The renderer and gate D7 read
this file the same way they read `discovery/brand/design.md` — no code changes to swap.

> Render any run's specs against this brand with `--brand`:
> `node discovery/render/render.mjs deck <spec.json> <out.html> --brand discovery/brand/examples/meridian-trust.design.md`

## Conformance marker

Same contract as the OFBO instance — every rendered artifact carries
`<!-- discovery/brand/design.md@v1 -->` and uses token values only.

## 1. Design tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `color.brand.primary` | `#5B2A86` | Primary actions, headers, links |
| `color.brand.primary-ink` | `#FFFFFF` | Text on primary |
| `color.brand.accent` | `#1B998B` | Positive / success / "within tolerance" |
| `color.status.warn` | `#C77800` | Caution / nearing threshold |
| `color.status.danger` | `#B3261E` | Breach / liability crossing |
| `color.surface.bg` | `#FAF7FB` | Page background |
| `color.surface.card` | `#FFFFFF` | Card / panel |
| `color.ink.strong` | `#1E1320` | Primary text |
| `color.ink.muted` | `#6B5E70` | Secondary text |
| `color.border.subtle` | `#E7DEEC` | Dividers, table rules |

### Typography

| Token | Value |
|---|---|
| `font.family.sans` | `Georgia, "Times New Roman", serif` |
| `font.family.mono` | `"Courier New", monospace` |
| `font.size.h1` | `30px` |
| `font.size.h2` | `23px` |
| `font.size.h3` | `18px` |
| `font.size.body` | `16px` |
| `font.size.caption` | `13px` |
| `font.weight.regular` | `400` |
| `font.weight.semibold` | `700` |

### Spacing & shape

| Token | Value |
|---|---|
| `shadow.card` | `0 2px 6px rgba(30,19,32,0.12)` |

### Logo

| Token | Value |
|---|---|
| `logo.wordmark` | `MERIDIAN` rendered in `font.family.sans` / `font.weight.semibold` / `color.brand.primary` |

## 2. Voice & tone

- **Considered, formal, trust-forward.** Long-standing-institution register; full sentences.
- Same hard rules as any brand: tokens only, DEMO banner, zero PII, synthetic data.

## 3. Accessibility minimums

- Text contrast ≥ 4.5:1; never colour-only meaning; logical heading order.
