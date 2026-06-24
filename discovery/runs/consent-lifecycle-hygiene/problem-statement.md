---
artifact: problem-statement
stage: define
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Problem statement — consent-lifecycle-hygiene

> Define (converge). The single problem worth solving. Names the problem, not the build.

## The problem (falsifiable)

For a **consent operations analyst (synthetic persona)** who **must ensure every PSU
withdrawal is honoured and acknowledged within the bank's 5s default**, today **revoke
acknowledgement latency and lifecycle-state drift are invisible until a customer complains**,
which causes **silent SLA breaches, stale-state errors in care handling, and no audit-ready
proof of timely withdrawal**. We know this from S-001, S-002, S-003, S-004, S-005.

## Target user

- Persona (synthetic): consent operations analyst; secondary: care team lead, compliance officer.
- Context / trigger: a PSU withdraws consent; the analyst is accountable for it being honoured
  within SLA and evidenced.

## Success measures

| Measure | Baseline (today) | Target | How measured |
|---|---|---|---|
| Revoke acknowledgements within SLA, visible | unmeasured (p50 9.4s, unobserved) | within the 5s default and observable in real time | timeliness signal over revoke events |
| Time-to-detect lifecycle drift | only on customer complaint | before the customer notices | drift-window signal |
| Audit evidence of timely withdrawal | reconstructed manually | available on demand | evidence completeness check |

## Constraints (boundaries, not solutions)

- Regulatory / governance: PDPL withdrawal rights; adopting-bank 5s revoke acknowledgement
  default; four-eyes on fraud-related revoke; zero real PII.
- Operational: the back office never bypasses PSU consent; all Hub-bound traffic via P6 egress.
- Out of scope (explicit): changing the consent-withdrawal flow itself; anything in the PSU's
  banking app; bulk consent migration tooling.

## Stakeholders & scope (D3)

| Stakeholder | In/out of scope | Why |
|---|---|---|
| Consent operations analyst | in | Primary owner of lifecycle hygiene |
| Care team lead | in | Consumes the state to handle cases |
| Compliance officer | in | Needs the audit evidence |
| PSU banking-app team | out | Not a back-office surface |

> **Not here (D4):** no endpoints, schemas, tech choices, or delivery stories. Solution ideas
> are parked for the prototype as a *direction* and for delivery to author.
