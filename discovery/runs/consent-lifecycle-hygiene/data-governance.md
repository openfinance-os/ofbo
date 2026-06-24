---
artifact: data-governance
stage: define
design_profile: discovery/brand/design.md
run: consent-lifecycle-hygiene
---

# Data-governance feasibility — consent-lifecycle-hygiene

> Define (converge). Mapped against `docs/governance/data-risk-register/`. The reviewer checks
> that cited controls cover cited risks and flags uncovered High/Critical inherent risk.

## Data the direction would touch

| Data element (synthetic) | Classification | Subject | Purpose |
|---|---|---|---|
| Consent lifecycle state + timestamps | Sensitive (consent metadata) | PSU | Observe timeliness & drift |
| Revoke acknowledgement events | Sensitive (consent metadata) | PSU | Measure SLA adherence |
| No account/transaction content | — | — | Out of scope by design |

## Risk mapping (→ register)

| Data element | DR-* category | Inherent rating | Regulatory driver(s) | Mitigating CTRL-* |
|---|---|---|---|---|
| Revoke acknowledgement events | DR-2.1 (Consent Management Risk) | — | adopting-bank 5s default | CTRL-DP-002 |
| Lifecycle state / withdrawal | DR-2.1-002 | High | PDPL-15.2, PDPL-6.2 | CTRL-DP-002, CTRL-DP-003 |
| Consent validity at processing | DR-2.1-001 | Critical | PDPL, CPS-6.1.3.2 | CTRL-DP-001, CTRL-DP-002 |

Cited categories resolve in the register: **DR-2.1**, **DR-2.1-001**, **DR-2.1-002**.
Cited controls resolve: **CTRL-DP-001** (Consent Collection), **CTRL-DP-002** (Consent
Repository & Tracking), **CTRL-DP-003** (Consent Withdrawal Process).

## Residual-risk verdict (D6)

- **Residual rating after controls:** Low (DR-2.1-001 Critical→Low; DR-2.1-002 High→Very Low
  per the register's residual-risk computation).
- **Acceptable for delivery?** Conditional — acceptable provided the direction is
  *read-only observability over consent metadata* (it observes and evidences; it does not
  alter the consent-withdrawal flow). This keeps it within CTRL-DP-002's tracking remit and
  adds no new processing purpose.
- **Conditions / watch-items carried into hand-off:** no consent content beyond lifecycle
  state/timestamps; INSERT-only audit of evidence; all Hub-bound reads via P6 egress; PII
  redaction at emission.

## Uncovered risks

None left uncovered: the Critical (DR-2.1-001) and High (DR-2.1-002) inherent risks both have
mitigating controls cited above; this direction only *observes* their existing operation.
