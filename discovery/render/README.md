# Branded renderers — zero dependency

Two renderers turn structured JSON specs into on-brand artifacts, using **only** the design
tokens in a mounted brand profile (`discovery/brand/design.md`). No external service, no
design tool, no libraries — pure Node (`node:fs`, and a hand-rolled ZIP; not even `node:zlib`).
Every artifact carries the D7 brand marker and uses token colours/fonts by construction.

## 1. Web artifacts — `render.mjs`

Self-contained **HTML**: a print-to-PDF `document`, a full-screen `deck`, and a low-fi
`prototype` wireframe.

```sh
node discovery/render/render.mjs <document|deck|prototype> <spec.json> <out.html> [--brand <design.md>]
```

## 2. Office binaries — `render-office.mjs`

Real **Office Open XML**: `.xlsx` (spreadsheet), `.docx` (document), `.pptx` (deck). These are
genuine binary Office files (valid ZIP packages of well-formed OOXML), not HTML.

```sh
node discovery/render/render-office.mjs <xlsx|docx|pptx> <spec.json> <out> [--brand <design.md>]
```

- **xlsx** — header row in `color.brand.primary`; status cells map to
  `accent`/`status.warn`/`status.danger` (cell spec: `{ "v": "...", "status": "ok|warn|danger" }`).
- **docx** — brand-coloured headings, branded table headers, token body text.
- **pptx** — title + content slides, a DEMO band in `status.warn`, token text colours.

### How it stays dependency-free

`office/zip.mjs` writes a minimal ZIP with **STORED** (uncompressed) entries, so the XML stays
plaintext inside the package — which lets gate **D7** (`checkVisualOoxml`) verify the marker and
that every colour in the *content* parts is a design.md token, without a decompression
dependency. Output is deterministic (fixed timestamps): identical input → byte-identical file.

`office/ooxml.mjs` builds the parts. Brand swap works exactly as for HTML — pass `--brand` and
the same spec re-skins; see `discovery/brand/examples/` for OFBO-vs-Meridian outputs in every
format.
