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
| HG-0006 | The agent is an ungoverned model | AI/model-risk governance (CBUAE Responsible-AI + NIST AI RMF / GenAI Profile + ISO 42001-aligned) for the harness |
| HG-0007 | Delivery built the wrong thing / no problem trace | Discovery precedes delivery — a gated left-diamond (D1–D9) feeds delivery via a hand-off; a waist gate makes a green hand-off the entry condition for a feature item |
| HG-0008 | Domain content hard-coded into the harness | Solution-agnostic seams: the data-risk register (D6) and the `design.md` brand profile (D7) are mounted, not embedded |
| HG-0009 | Right diamond was a straight line (no solution exploration) | Develop diverges before delivery converges — explore N solution directions, judge, converge to an SDR + the discovery-linked backlog item |
| HG-0010 | No mandatory cease-use capability | Immediate cease-use kill-switch + a named Autonomous Systems Officer (CBUAE-mandatory; DIFC Reg 10) |
| HG-0011 | Coding-agent LLM traffic + execution not residency-controlled | Onshore model gateway + pre-egress DLP + attested sandbox execution (UAE residency / Outsourcing C 14/2021) |

Status: **HG-0001, HG-0002, HG-0007, HG-0009 Accepted** (harness-owner direction — the
mechanism is wired in-repo; production branch-protection + CODEOWNERS remain the bank's config
step). **HG-0003–HG-0006, HG-0008, HG-0010, HG-0011 Proposed** for the bank's change/risk
governance to decide. HG-0010 and HG-0011 were added 2026-06-27 from the UAE regulated-banking
harness assessment (CBUAE Responsible-AI Guidance 2026, DIFC Reg 10, Outsourcing C 14/2021);
HG-0006 was re-anchored the same day (SR 11-7 was revised April 2026 to exclude GenAI). Spec
PRs / ADRs / production merges are human-approved; never auto-merged.
