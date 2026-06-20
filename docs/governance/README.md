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

Status: all **Proposed** — for the bank's change/risk governance to decide. Human-approved; never auto-merged.
