---
name: brand-render
description: Produce on-brand documents, slide decks (ppt-equivalent), and static prototype wireframes from structured content — rendered entirely against discovery/brand/design.md, with zero dependency on any external design tool or service (no Stitch, Magic Patterns, or Gamma). Use whenever the discovery harness must emit something visual a human will read or present.
---

# Brand render — self-contained branded output

Wraps Claude's own authoring with a **pure-Node, zero-dependency** renderer
(`discovery/render/render.mjs`). You author the *content* as structured JSON; the renderer owns
the *presentation*, substituting **only** `discovery/brand/design.md` tokens. Output is one
self-contained HTML file that opens anywhere — **print a document to PDF, present a deck
full-screen** — needing nothing installed. Every output carries the D7 brand marker and is
checked by gate D7 automatically when it lands in a run directory.

> **Why structured content, not authored HTML.** If you wrote raw HTML you could inline a stray
> hex/font and break brand conformance. Instead you provide data; the renderer applies tokens.
> That is what makes "on-brand" enforceable rather than aspirational.

## Three modes

| Mode | Use | Print/present as |
|---|---|---|
| `document` | hand-off, problem brief, governance memo | print-to-PDF (A4-friendly, fixed DEMO banner) |
| `deck` | a discovery readout / stakeholder review | full-screen HTML slides (←/→/space/click) |
| `prototype` | a low-fidelity wireframe (the Define-stage tangible) | static screen |

## How to render

1. Write a spec JSON (see shapes below). Keep it under the run, e.g.
   `discovery/runs/<slug>/specs/<name>.<mode>.json`. **Synthetic content only; no raw hex/px/font
   in the content** — colours come from tokens, not from you.
2. Render (from the repo root):
   ```
   RUN=discovery/runs/<slug>
   node discovery/render/render.mjs document   "$RUN/specs/handoff.document.json"    "$RUN/handoff.document.html"
   node discovery/render/render.mjs deck       "$RUN/specs/summary.deck.json"        "$RUN/summary.deck.html"
   node discovery/render/render.mjs prototype  "$RUN/specs/wireframe.prototype.json" "$RUN/wireframe.html"
   ```
3. Validate: `node discovery/gates/validate.mjs discovery/runs/<slug>` — D7 must stay green
   (it scans every `.html` in the run). Never inline a colour to "fix" a layout; fix the token.

## Spec shapes (minimal)

```jsonc
// document
{ "title": "...", "subtitle": "...", "sections": [
  { "heading": "...", "blocks": [ {"p":"..."}, {"list":["..."]}, {"table":{"headers":[],"rows":[[]]}}, {"note":"..."} ] } ] }
// deck (a cover slide is added from title/subtitle)
{ "title": "...", "subtitle": "...", "slides": [ { "kicker":"...", "title":"...", "bullets":["..."], "note":"..." } ] }
// prototype (low-fi wireframe)
{ "title":"...", "context":"...", "intro":"...",
  "tiles":[ {"label":"...","value":"...","status":"ok|warn|danger","pill":"...","sub":"..."} ],
  "table":{"label":"...","headers":[],"rows":[[]]},
  "affordance":{"label":"...","text":"..."} }
```

## To change the look

Edit `discovery/brand/design.md` tokens — never the renderer or the output. To brand for a
different entity, mount that entity's `design.md`; the same specs render in their brand. `status`
values map to `accent`/`warn`/`danger` tokens, so semantics stay token-bound.

## Definition of done

- Output carries `<!-- discovery/brand/design.md@vN -->` and passes D7.
- Content is synthetic, zero PII; DEMO banner present.
- For a `prototype`: it stays low-fidelity (D8 / canon §4) — a tangible of the *problem*, not a
  delivery spec.
