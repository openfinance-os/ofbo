---
artifact: synthesis
stage: discover
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Synthesis — consent-lifecycle-hygiene

> Discover (converge). Themes trace to logged signals; prioritisation method stated.

## Themes

| Theme id | Theme | Traces to signals | So-what |
|---|---|---|---|
| T-1 | Revoke acknowledgement silently breaches the SLA | S-001, S-002 | A withdrawal obligation is missed without anyone noticing |
| T-2 | Lifecycle state drifts between the LFI and the Hub | S-003, S-005 | Operators act on stale "active" state; no early signal |
| T-3 | No audit-ready evidence that withdrawals are honoured in time | S-004 | Compliance cannot prove SLA adherence on demand |

## Prioritisation

- **Method:** impact (regulatory + trust) × reach (all revokes) ÷ effort to make observable.
- **Result:**

| Theme | Impact | Reach | Effort | Score | Rank |
|---|---|---|---|---|---|
| T-1 | 5 | 5 | 2 | 12.5 | 1 |
| T-2 | 4 | 4 | 3 | 5.3 | 2 |
| T-3 | 4 | 3 | 2 | 6.0 | 2 |

## Candidate problem (leading theme)

T-1 leads: the bank is already obligated to acknowledge withdrawals within the 5s default,
the breach touches every revoke, and it is currently invisible. T-2 and T-3 are facets of the
same root — consent lifecycle state and its timeliness are not observable to operators or
auditors. The single problem worth solving is **making consent-lifecycle hygiene observable
and provably within SLA**, with T-1 as the sharpest entry point.
