# Discovery harness — canon

The **discovery** half of a two-harness system. Where the *delivery* harness (this repo's
build loop: `next-story`, the Q1–Q5 gates, the hard-stops) answers **"build the thing
right,"** the discovery harness answers **"build the right thing."** It runs the front of
the **Double Diamond** — *Discover* and *Define* — and hands a validated, evidenced problem
(plus a tangible prototype of the direction) across a contract to delivery.

> **Solution-agnostic by construction.** This harness is a *method*, not an OFBO feature.
> Everything domain-specific is mounted through a **seam**: the **data-risk register**
> (`docs/governance/data-risk-register/`) for data-governance feasibility, and the
> **brand profile** (`discovery/brand/design.md`) for how artifacts look. Swap the seams
> and the same machinery runs discovery for a different organisation. Nothing in the gate
> validator, skills, or agents hard-codes OFBO, CBUAE, or Nebras.

---

## 1. The Double Diamond, and where this harness sits

```
   DISCOVER          DEFINE                 │   DEVELOP        DELIVER
   (diverge)         (converge)             │   (diverge)      (converge)
   ───────────       ───────────            │   ───────────    ───────────
   explore the       frame the ONE          │   build it       ship it
   problem space     problem worth solving  │
                     + make it tangible      │
        ◇──────────────◇                    │      ◇──────────────◇
        this harness  ─┘                    │   develop skill   next-story loop
                          └── hand-off contract ──┘   (HG-0009)    (existing)
```

This harness owns the **left diamond**. The right diamond is now a diamond too: its *diverge*
half is the **`develop` skill** (HG-0009) — it consumes a green hand-off, explores several
solution directions, and converges on one before the **`next-story`** delivery loop builds it.
The waist between them is enforced (HG-0007): a feature can't enter delivery without a green
hand-off. It deliberately stops at the hand-off: it produces
a problem worth solving and a low-fidelity prototype that makes the direction tangible — it
does **not** design the production solution, write delivery stories, or touch
`specs/backoffice-openapi.yaml`. That is the right diamond's job, and crossing the line is a
gate failure (D4).

### Stages and their artifacts

| # | Stage | Mode | Activity | Primary artifact(s) |
|---|---|---|---|---|
| 1 | **Discover** | diverge | Explore the problem space; gather signals, pains, stakeholders, existing evidence | `research-log.md`, `evidence/` |
| 2 | **Discover** | converge | Synthesise signals into themes; size and prioritise | `synthesis.md` |
| 3 | **Define** | converge | Frame the single problem worth solving, with success measures and constraints | `problem-statement.md` |
| 4 | **Define** | converge | **Data-governance feasibility** — classify the data the direction would touch, map to the register, assert acceptable residual risk | `data-governance.md` |
| 5 | **Define** | *make tangible* | **Prototype** — a disposable low-fidelity wireframe that visualises how the solution *could* look, to test the framing before committing to delivery | `prototype.md` + wireframe asset |
| 5b | **Define** | *validate* | **Stakeholder reaction** — show the prototype to the named roles; record their reaction per framing hypothesis as fresh signals. This *closes* the make-tangible loop (D9) | `stakeholder-reaction.md` |
| 6 | **Hand-off** | converge | Package the validated problem + prototype as a delivery-ready brief | `handoff.md` |

The **Prototype** stage (5) is new relative to a textbook Define: it satisfies the
*visualise & make-it-tangible* guardrail (§3) explicitly, by producing an artifact a
stakeholder can look at and react to. Crucially it is **problem-validation fidelity, not
delivery fidelity** — see §4.

---

## 2. The gate model (D1–D8)

A discovery run is **valid** only when all applicable gates pass. Gates are checked by a
pure-Node validator (`discovery/gates/`) so CI stays dependency-free and deterministic.
Gates are *mechanical* — they check structure, references, and presence, not taste.

| Gate | Name | Fails when… |
|---|---|---|
| **D1** | Problem framing | `problem-statement.md` lacks a falsifiable problem, target user, or success measure |
| **D2** | Evidence | Claims in synthesis/problem aren't traceable to a logged signal in `evidence/`; assertion-without-source |
| **D3** | Scope & stakeholders | No named stakeholders, or scope boundaries (in/out) absent |
| **D4** | No-solutioning boundary | Discovery artifacts specify a build (endpoints, schemas, tech choices, delivery stories) — the left diamond is leaking into the right |
| **D5** | Synthesis integrity | Themes don't trace to signals; prioritisation lacks a stated method |
| **D6** | Data-governance feasibility | `data-governance.md` doesn't cite ≥1 `DR-*` risk category **and** ≥1 regulatory driver; any cited `DR-*`/`CTRL-*` id fails to resolve against the register; no residual-risk verdict |
| **D7** | Brand conformance | Any **visual** artifact (HTML, docs, PPT, Excel, wireframe) doesn't reference `discovery/brand/design.md`, or contains raw hex/px/font literals instead of design tokens |
| **D8** | Tangibility | The Prototype stage didn't produce `prototype.md` **and** a brand-conformant wireframe asset, or the prototype claims delivery fidelity (over-specifies) |
| **D9** | Validation loop | A prototype exists but `stakeholder-reaction.md` doesn't close the make-tangible loop — no recorded reaction/verdict per framing hypothesis, or reactions not logged as signals (→ D2) |

D6 depends on the **data-risk register** seam; D7 depends on the **brand profile** seam. A
run that mounts neither seam still runs D1–D5, D8 and D9 (D8/D9's brand check defers to D7).
D9 applies only when a prototype exists (same trigger as D8): the prototype is built to be
*reacted to*, so the run isn't done until the reaction is captured as evidence.

---

## 3. Guardrails (the *why*, enforced by the *what*)

- **No-solutioning boundary (→ D4).** Discovery names the problem; delivery owns the
  solution. Wireframes are the *one* sanctioned exception, and only at validation fidelity
  (§4). If something feels genuinely uncovered, raise it in the hand-off — don't design it.
- **Evidence over opinion (→ D2/D5).** Every theme and claim traces to a logged signal.
  Synthetic/illustrative evidence is allowed in demo runs but must be labelled as such.
- **Visualise & make it tangible (→ D8/D9).** A discovery isn't done until someone can *see*
  the direction (D8) **and has reacted to it** (D9). The Prototype stage produces the artifact;
  the Stakeholder-reaction stage closes the loop by capturing the reaction as evidence — a
  prototype no one reacted to tested nothing.
- **Brand conformance (→ D7).** Everything an entity's stakeholders see must look like it
  belongs to that entity. All visual output renders against `design.md`; tokens only, never
  raw values. This holds for HTML, generated docs, slides, and spreadsheets alike.
- **Data-governance feasibility is a first-class question (→ D6).** "Can we responsibly
  hold/process this data?" is asked in *discovery*, against the register — not retrofitted
  in delivery. Mirrors the delivery hard-stop that lineage/PII controls are Definition-of-Done,
  never bolt-on.
- **Zero real PII, ever.** Same hard-stop as delivery. Evidence, personas, and prototypes
  use synthetic data only.

---

## 4. The prototype boundary (discovery fidelity ≠ delivery fidelity)

The Prototype stage is where this harness is most at risk of becoming solutioning, so the
boundary is explicit and gated (D8 + D4):

| A discovery prototype **is** | A discovery prototype is **not** |
|---|---|
| Low-fidelity wireframe (boxes, labels, flow) | Pixel-perfect production UI |
| Disposable — thrown away after it tests the framing | A reusable component / design system |
| About *the problem & direction* | About *the implementation* |
| Rendered against `design.md` for brand realism | Bound to `specs/backoffice-openapi.yaml` data/behaviour |
| One or a few screens that make the pain tangible | A full screen inventory |

It exists to answer *"is this the right problem, and is this roughly the right shape of
answer?"* — a stakeholder reacts to it, and that reaction is evidence (D2). It is brand-real
(so reactions aren't distorted by ugliness) but behaviour-hollow (no real data, no API).
When delivery picks it up, it re-builds against the OpenAPI contract from scratch; the
wireframe informs, it does not bind.

---

## 5. The seams (what makes it solution-agnostic)

### 5.1 Data-risk register — data-governance feasibility (D6)

`docs/governance/data-risk-register/` (see its README). A regulation → risk → control →
residual-risk chain. Discovery's `data-governance.md` classifies the data the direction
touches, cites the `DR-*` categories and regulatory drivers, names mitigating `CTRL-*`
controls, and records a residual-risk verdict. The `data-governance-reviewer` agent checks
coverage (do cited controls actually cover cited risks?) and flags uncovered High/Critical
inherent risks. Another organisation mounts its own register behind the same JSON shape.

### 5.2 Brand profile — `discovery/brand/design.md` (D7)

A single, vendor-neutral markdown file holding the entity's **design tokens** (colour,
typography, spacing, logo), **voice & tone**, and **layout rules** for each output medium
(document, slide deck, spreadsheet, web/wireframe), plus accessibility minimums. It is the
*only* source of visual truth. Any harness step that emits something a human looks at:

1. reads `design.md`,
2. renders using its **tokens** (never literal hex/px/font), and
3. embeds a conformance marker referencing the profile so D7 can verify it.

This is the generic equivalent of OFBO's binding "Stitch = layout + design tokens" rule, but
expressed as a portable file so any entity drops in their own brand and gets on-brand
documents, decks, sheets, and wireframes for free. The OFBO instance of `design.md` carries
the DEMO brand and remains token-only and DEMO-bannered.

**Rendering is self-contained (zero external tooling).** `discovery/render/` is a pure-Node,
zero-dependency renderer that turns **structured content** (JSON the facilitator authors) into
brand-tokened output — there is **no dependency on Stitch, Magic Patterns, Gamma, or any
external service**. Content is data; presentation comes only from `design.md` tokens; every
output carries the D7 marker (so D7 verifies it automatically). Two surfaces:

- **HTML** (`render.mjs`): `document` (print-to-PDF), `deck` (full-screen), `prototype` (wireframe).
- **Office binaries** (`render-office.mjs`): real `.xlsx`, `.docx`, `.pptx` — valid OOXML
  packages, not HTML — built by a hand-rolled ZIP + OOXML writer (no `node:zlib` even). D7
  inspects the package (`checkVisualOoxml`): marker present, and every colour in the *content*
  parts is a design.md token. See `discovery/render/README.md`.

The renderer owns all styling, so a stray hex/font can't slip into authored content, and a brand
swap is just `--brand <other>/design.md` — see `discovery/brand/examples/` for the same run in a
second brand across every format.

---

## 6. Hand-off contract (left diamond → right diamond)

`handoff.md` is the boundary object. It is delivery-ready iff:

- all applicable gates D1–D8 are green;
- it states the **problem**, **target user**, **success measures**, and **explicit
  out-of-scope**;
- it links the **data-governance verdict** (D6) so delivery inherits the residual-risk
  position rather than rediscovering it;
- it links the **prototype** as *direction, not specification* (§4);
- it contains **no** delivery design — no endpoints, schemas, story breakdowns, or tech
  choices (those are the right diamond's to create).

The **Develop** phase (the `develop` skill, HG-0009) consumes this brief first: it explores
several solution directions, converges on one, records a Solution Direction Record
(`docs/develop/<slug>.md`), and appends the `discovery: <slug>`-linked backlog item the
**delivery** loop then builds. The waist gate (HG-0007, `scripts/discovery-link-check.mjs`)
makes a green hand-off the entry condition for that item. The harnesses share governance
(zero PII, audit, brand) but never share authorship of the solution.

---

## 7. Layout

```
discovery/
  DISCOVERY.md            ← this canon
  brand/
    design.md             ← brand-profile seam (D7)
  render/                 ← zero-dep branded renderer: document · deck · prototype (+ tests)
  templates/              ← one template per artifact (carry design_profile front-matter)
  gates/                  ← pure-Node D1–D9 validator + tests
  runs/<slug>/            ← a discovery run's artifacts (problem-statement, prototype, reaction, …)
    specs/                ← structured content (JSON) the renderer turns into branded HTML
scripts/
  discovery-link-check.mjs ← the waist gate (HG-0007): backlog feature item ↔ green hand-off
docs/
  develop/                ← Develop-phase Solution Direction Records (right-diamond diverge, HG-0009)
  governance/
    data-risk-register/   ← data-governance seam (D6)
    HG-0007 (waist), HG-0008 (seams), HG-0009 (Develop)  ← governance for this harness
.claude/skills/develop/   ← the Develop phase skill (consumes a hand-off, emits the backlog item)
```
