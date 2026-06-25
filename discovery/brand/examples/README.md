# Brand-swap demonstration — the seam is real

The discovery harness claims to be **solution-agnostic**: everything visual renders against a
mounted **brand profile** (`discovery/brand/design.md`), so a different organisation drops in
their own brand and gets on-brand documents, decks, and prototypes with **no code change**.
This folder proves it.

## What's here

- **`meridian-trust.design.md`** — a second brand, deliberately the opposite of OFBO
  (royal-purple + serif vs OFBO's blue + Inter), using the **same token names**, different
  values.
- **`rendered/`** — the **same** `consent-lifecycle-hygiene` run specs
  (`discovery/runs/consent-lifecycle-hygiene/specs/*.json`) rendered against Meridian:
  HTML (`handoff.document.html`, `summary.deck.html`, `wireframe.html`) **and** real Office
  binaries (`drift-register.xlsx`, `handoff.docx`, `summary.pptx`).

Open `rendered/summary.deck.html` next to the OFBO `discovery/runs/consent-lifecycle-hygiene/
summary.deck.html`: **identical content, different brand.**

## Reproduce

```sh
RUN=discovery/runs/consent-lifecycle-hygiene
BRAND=discovery/brand/examples/meridian-trust.design.md
node discovery/render/render.mjs document  $RUN/specs/handoff.document.json   discovery/brand/examples/rendered/handoff.document.html  --brand $BRAND
node discovery/render/render.mjs deck      $RUN/specs/summary.deck.json       discovery/brand/examples/rendered/summary.deck.html      --brand $BRAND
node discovery/render/render.mjs prototype $RUN/specs/wireframe.prototype.json discovery/brand/examples/rendered/wireframe.html         --brand $BRAND
node discovery/render/render-office.mjs xlsx $RUN/specs/summary.sheet.json     discovery/brand/examples/rendered/drift-register.xlsx   --brand $BRAND
node discovery/render/render-office.mjs docx $RUN/specs/handoff.document.json  discovery/brand/examples/rendered/handoff.docx          --brand $BRAND
node discovery/render/render-office.mjs pptx $RUN/specs/summary.deck.json      discovery/brand/examples/rendered/summary.pptx          --brand $BRAND
```

The only thing that changed between OFBO and Meridian is the `--brand` file. The renderer,
the specs, and gate **D7** are untouched.

## Why this matters

`render.test.mjs` asserts it mechanically: the same spec rendered against the two brands
produces different-but-conformant output, and each output **fails** D7 against the *other*
brand's token allow-list — so the brand check is genuinely enforcing, not cosmetic.
