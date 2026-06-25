---
name: develop
description: Run the Develop phase — the diverge half of the right diamond. Takes a gate-green discovery hand-off, explores several solution DIRECTIONS in parallel (AI fan-out), judges them against the success measures + inherited data-governance conditions, converges on one, and appends the discovery-linked backlog item(s) for the delivery loop. Use AFTER a discovery hand-off and BEFORE next-story. It does NOT write code or touch specs/backoffice-openapi.yaml.
---

# Develop — the diverge half of the right diamond

Canon: `discovery/DISCOVERY.md` (the Double Diamond) and `docs/governance/HG-0009-develop-diverge.md`.

The delivery loop (`next-story`) is the *converge* half of the right diamond — it builds ONE
thing. Before it, the right diamond should **diverge**: explore several ways to solve the framed
problem and pick the best, instead of implementing the first idea. That exploration is this skill.

```
discovery hand-off  ──►  DEVELOP (this skill: diverge → choose)  ──►  next-story (deliver)
(the right problem)      explore N directions, judge, converge        (build it right)
```

You are the **solution architect**, not the implementer. Develop legitimately reasons about
*mechanisms* (that is its job — the no-solutioning boundary D4 belongs to the LEFT diamond, not
here). But it stops at a chosen **direction** + the backlog item(s) that carry it. It does **not**
write code, author tests, or edit `specs/backoffice-openapi.yaml` — those are the delivery loop's,
under its own controls and four-eyes.

## 0. Precondition — a green hand-off

Input is a discovery run slug. Verify the hand-off is gate-green before spending any fan-out:

```
node discovery/gates/validate.mjs discovery/runs/<slug>    # must exit 0 (D1–D9)
```

Read `discovery/runs/<slug>/handoff.md` in full — the **problem**, **success measures**,
**explicit out-of-scope**, the **data-governance verdict + inherited conditions** (D6), the
**prototype direction**, and the **Open questions for Develop** (what the stakeholder reaction,
D9, left unresolved). Those open questions are the heart of what you must resolve here.

## 1. Diverge — N solution directions in parallel (AI fan-out)

Spawn **3–4 independent `Agent` subagents in ONE message** (so they run concurrently and blind to
each other), each generating a *different* solution direction under a distinct lens:

- **Reuse-first / minimal-change** — compose existing platform primitives (ports, the approvals
  primitive, the audit + lineage path, the BFF+service scope layers). Introduce nothing new.
- **Greenfield / ideal** — the best answer if cost were no object; names the ideal mechanism.
- **Buy-vs-integrate** — lean on an existing port/adapter or external capability over building.
- **Risk-first / regulatory-minimal** — the smallest surface that satisfies the success measures
  AND the inherited data-governance conditions with the least new residual risk.

Give every subagent the same brief: the hand-off problem + success measures + inherited D6
conditions + the OFBO hard-stops (`CLAUDE.md`). Require each to return, as structured text:
approach; how it meets **each** success measure; how it honours **each** inherited data-governance
condition and every hard-stop (scope matrix, INSERT-only audit, four-eyes, P6 egress, no profile
branching, zero PII); what it **reuses vs introduces** (composition over invention — a new
platform primitive is a flag, not a free choice); rough delivery cost; and the top risk.

## 2. Judge — score the directions

Spawn a judge subagent (or a small panel) that scores each direction, NOT on elegance, on:

1. **Success-measure fit** — does it move every measure from baseline to target?
2. **Inherited-condition fit** — does it stay inside the D6 residual-risk envelope and every
   hard-stop? A direction that breaks a hard-stop is disqualified, not down-weighted.
3. **Composition** — reuses primitives vs invents them. New primitives require an ADR (and so are
   costlier and riskier), per `CLAUDE.md`.
4. **Delivery cost / story count** — fewer, smaller, independently-shippable stories win.

The judge returns a ranking with one-line rationale per direction and a recommended winner.

## 3. Converge — the Solution Direction Record (SDR)

Write `docs/develop/<slug>.md` (see `docs/develop/README.md` for the template). It records: the
chosen direction; **why** (judge rationale); the runner-up ideas grafted in; how it satisfies each
success measure + each inherited D6 condition + the hard-stops; what it reuses vs introduces; the
resolution of the hand-off's open questions; and the **backlog item(s)** it spawns. The SDR is the
right-diamond analogue of the hand-off: a traceable record of *why this approach*, for the audit.

**If the chosen direction needs a new platform primitive or a contract change:** do NOT smuggle it
in. Write the ADR (`docs/adrs/`) and/or run the `spec-change` skill for the spec-only PR — both are
**human-approved, never self-merged**. The backlog item then `depends_on` that decision (or is
`blocked` with the ADR/spec-PR reference) until a human ratifies it.

## 4. Emit — the discovery-linked backlog item(s)

Append the spawned item(s) to `docs/backlog.yaml` under the right milestone, each carrying:

```yaml
- { id: BACKOFFICE-NN, title: ..., status: pending, discovery: <slug>, sdr: docs/develop/<slug>.md, depends_on: [...] }
```

The `discovery: <slug>` field is what satisfies the **waist gate** (HG-0007) — the item now traces
to a green hand-off, so `scripts/discovery-link-check.mjs` and the `next-story` Pick step accept
it. Keep stories small and independently shippable; respect the hand-off's explicit out-of-scope.

## Definition of done

- The hand-off was gate-green before fan-out; ≥3 directions were explored in parallel and judged.
- `docs/develop/<slug>.md` (SDR) records the choice, the rationale, and how it meets every success
  measure + inherited D6 condition + hard-stop.
- The spawned backlog item(s) carry `discovery: <slug>` and `sdr:`; `pnpm discovery:link` passes.
- New primitives / contract changes are raised as ADR / `spec-change` (human-approved), never
  self-merged, never implemented here.
- No code written, no test authored, `specs/backoffice-openapi.yaml` untouched — Develop chooses
  the direction; `next-story` builds it.
