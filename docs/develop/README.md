# Develop — Solution Direction Records (SDRs)

The **Develop** phase is the diverge half of the Double Diamond's right diamond: it takes a
gate-green discovery hand-off and explores several solution *directions* before the `next-story`
delivery loop builds one. It is run by the `develop` skill (`.claude/skills/develop/`) and
governed by `docs/governance/HG-0009-develop-diverge.md`.

A **Solution Direction Record (SDR)** — `docs/develop/<slug>.md` — is Develop's boundary object,
the right-diamond analogue of discovery's `handoff.md`. It records *why this approach* so the
choice is auditable, and it links the backlog item(s) the direction spawns.

> Develop reasons about mechanism (that is its job — the no-solutioning boundary D4 is the LEFT
> diamond's). It does **not** write code or edit `specs/backoffice-openapi.yaml`. New primitives /
> contract changes are raised as an ADR / `spec-change` PR (human-approved), never self-merged.

## SDR template

```markdown
# SDR — <slug>

- Hand-off: discovery/runs/<slug>/handoff.md (gate-green D1–D9)
- Date: <YYYY-MM-DD>

## Problem (inherited from the hand-off)
<one-line problem + the success measures, baseline → target>

## Directions explored (diverge)
| # | Lens | Approach (one line) | Judge verdict |
|---|---|---|---|
| 1 | reuse-first | … | chosen / runner-up / rejected — why |
| 2 | greenfield | … | … |
| 3 | risk-first | … | … |

## Chosen direction (converge)
<the approach, and the runner-up ideas grafted in>

## How it satisfies the constraints
- **Success measures:** <each measure → how this direction moves it>
- **Inherited data-governance conditions (D6):** <each condition → how it is honoured>
- **Hard-stops:** <scope matrix, INSERT-only audit, four-eyes, P6 egress, no profile branching, zero PII>
- **Composition:** <what it reuses vs introduces; any new primitive → ADR ref>

## Open questions resolved
<the hand-off's "Open questions for Develop" — answered here>

## Backlog item(s) spawned
- BACKOFFICE-NN — <title> (status: pending, discovery: <slug>, sdr: docs/develop/<slug>.md)
```

Once the SDR is written and the backlog item carries `discovery: <slug>` + `sdr:`, the waist gate
(`pnpm discovery:link`, HG-0007) accepts it and the delivery loop can pick it up.
