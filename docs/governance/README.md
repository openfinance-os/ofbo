# Harness governance ADRs (HG-*)

Decision records for **how the AI-driven build/deploy harness itself is governed** —
the AI-SDLC, not the OFBO product. Kept separate from product architecture ADRs
(`docs/adrs/`) because the audience and concern are different: change management, model
risk, separation of duties, and the controls a CBUAE-regulated bank needs before an
autonomous build loop is allowed near its SDLC.

These were prompted by the 2026-06-20 harness bank-readiness review. The unifying
principle: **AI proposes; humans and a protected control plane dispose.** Today the agent
can author, AI-self-review, self-merge, deploy, *and edit its own guardrails* — these
ADRs replace that with enforced human accountability and an immutable control plane.

| ADR | Gap | One-line decision |
|---|---|---|
| HG-0001 | Self-merge / no human four-eyes | Human-approved merges + prod gate via enforced branch protection |
| HG-0002 | Agent can edit its own guardrails | Immutable control plane (CODEOWNERS + managed settings + protected CI), incl. supply-chain integrity |
| HG-0003 | Self-attested change records | Externally-anchored traceability + tamper-evident evidence |
| HG-0004 | Broad agent credentials / secrets on disk | Least-privilege service identity + vaulted secrets |
| HG-0005 | Auto-deploy, no promotion/rollback | dev→staging→prod promotion with a human prod gate + rollback |
| HG-0006 | The agent is an ungoverned model | AI/model-risk governance (SR 11-7-equivalent) for the harness |
| HG-0007 | Delivery built the wrong thing / no problem trace | Discovery precedes delivery — a gated left-diamond (D1–D9) feeds delivery via a hand-off; a waist gate makes a green hand-off the entry condition for a feature item |
| HG-0008 | Domain content hard-coded into the harness | Solution-agnostic seams: the data-risk register (D6) and the `design.md` brand profile (D7) are mounted, not embedded |
| HG-0009 | Right diamond was a straight line (no solution exploration) | Develop diverges before delivery converges — explore N solution directions, judge, converge to an SDR + the discovery-linked backlog item |

Status: **HG-0001, HG-0007, HG-0009 Accepted** (harness-owner direction, 2026-06-25 — the
mechanism is wired in-repo; production branch-protection + CODEOWNERS remain the bank's config
step). HG-0002–HG-0006, HG-0008 remain **Proposed** for the bank's change/risk governance to
decide. Spec PRs / ADRs / production merges are human-approved; never auto-merged.
