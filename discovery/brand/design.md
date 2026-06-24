---
profile_id: design.md
profile_version: 1
entity: "OFBO (DEMO instance)"
status: demo
banner: "DEMO — synthetic data, non-production"
---

# Brand profile — the single source of visual truth

This file is the **brand seam** for the discovery harness (canon §5.2). **Every** artifact a
human looks at — markdown rendered to HTML, generated documents, slide decks, spreadsheets,
and prototype wireframes — is produced **against this file**, using its **tokens**, never
raw literals. Gate **D7** fails any visual artifact that omits the conformance marker or
hard-codes a colour/size/font.

> **How to swap brands.** Replace the token values and rules below with another entity's
> brand and re-run. Nothing downstream references OFBO directly — it reads tokens by name
> (`color.brand.primary`, not `#1F4DB8`). This is the OFBO DEMO instance.

## Conformance marker (required on every visual artifact)

Each generated visual artifact must embed, in a comment or front-matter, the exact line:

```
brand-profile: discovery/brand/design.md@v1
```

HTML/wireframes: `<!-- brand-profile: discovery/brand/design.md@v1 -->` in `<head>`.
Markdown/docs: `design_profile: discovery/brand/design.md` in YAML front-matter.
The D7 validator greps for this marker and then scans for raw-value violations.

---

## 1. Design tokens

Reference tokens by **name** in every artifact. The renderer substitutes values from here;
artifacts must not inline the right-hand column.

### Colour

| Token | Value | Use |
|---|---|---|
| `color.brand.primary` | `#1F4DB8` | Primary actions, headers, links |
| `color.brand.primary-ink` | `#FFFFFF` | Text on primary |
| `color.brand.accent` | `#0E9F6E` | Positive / success / "within tolerance" |
| `color.status.warn` | `#B8860B` | Caution / nearing threshold |
| `color.status.danger` | `#B42318` | Breach / liability crossing |
| `color.surface.bg` | `#F7F8FA` | Page background |
| `color.surface.card` | `#FFFFFF` | Card / panel |
| `color.ink.strong` | `#0B1221` | Primary text |
| `color.ink.muted` | `#5A6473` | Secondary text |
| `color.border.subtle` | `#E2E6EC` | Dividers, table rules |

### Typography

| Token | Value |
|---|---|
| `font.family.sans` | `"Inter", "Helvetica Neue", Arial, sans-serif` |
| `font.family.mono` | `"IBM Plex Mono", "SFMono-Regular", monospace` |
| `font.size.h1` | `28px` |
| `font.size.h2` | `22px` |
| `font.size.h3` | `18px` |
| `font.size.body` | `15px` |
| `font.size.caption` | `13px` |
| `font.weight.regular` | `400` |
| `font.weight.semibold` | `600` |

### Spacing & shape

| Token | Value |
|---|---|
| `space.xs` / `space.sm` / `space.md` / `space.lg` / `space.xl` | `4px` / `8px` / `16px` / `24px` / `40px` |
| `radius.sm` / `radius.md` | `4px` / `8px` |
| `shadow.card` | `0 1px 2px rgba(11,18,33,0.08)` |

### Logo

| Token | Value |
|---|---|
| `logo.wordmark` | `OFBO` rendered in `font.family.sans` / `font.weight.semibold` / `color.brand.primary` |
| `logo.clearspace` | `space.md` minimum on all sides |

---

## 2. Voice & tone

- **Precise, regulated, calm.** Institutional reader (risk, compliance, operations). No hype,
  no exclamation marks. State facts and their evidence.
- **Active and specific.** "Consent revoke acknowledged in 4.2s" not "fast revocation."
- **Show provenance.** Numbers cite their source; claims cite their signal.
- **Accessible plain language** for problem framing; precise terminology for governance.

---

## 3. Layout rules per medium

A renderer for each medium must apply these. (The harness ships an HTML/wireframe renderer;
doc/deck/sheet renderers follow the same token contract.)

### Web / wireframe (HTML)

- Persistent **DEMO banner** (`banner` front-matter value) fixed at top, `color.status.warn`
  background, full width. Non-dismissable.
- Max content width `960px`, centred, `color.surface.bg` page, `color.surface.card` panels
  with `radius.md` + `shadow.card`.
- Wireframes are **low-fidelity**: greyscale fills permitted via `color.ink.muted` at reduced
  opacity, brand colour only on primary actions and status. Label every region.

### Document (HTML→PDF / .docx)

- Cover: `logo.wordmark`, title in `font.size.h1`, DEMO banner, date, author.
- Body: `font.family.sans`, `font.size.body`, `color.ink.strong`; headings step h1→h3.
- Tables: `color.border.subtle` rules, header row `color.brand.primary` / `primary-ink`.

### Slide deck (.pptx)

- Title slide: `logo.wordmark` top-left, DEMO banner footer.
- One idea per slide; `font.size.h2` titles; body bullets `font.size.body`.
- Status uses `color.status.*`; never raw colour.

### Spreadsheet (.xlsx)

- Header row `color.brand.primary` fill / `primary-ink` text, frozen.
- Money cells: integer minor units + ISO 4217 column, right-aligned, `font.family.mono`.
- Conditional formatting maps to `color.status.warn` / `danger` / `brand.accent` only.

---

## 4. Accessibility minimums

- Text contrast ≥ **4.5:1** against its background (verify `ink.muted` on `surface.card`).
- Never encode meaning by colour alone — pair status colour with a label or icon.
- Wireframes include a logical heading order and labelled landmarks.

---

## 5. Hard stops (inherited from delivery)

- **DEMO banner on every screen/artifact** — non-negotiable, non-dismissable.
- **Zero PII** — synthetic names/values only.
- **Token-only** — no raw hex/px/font in any artifact (this is also D7).
