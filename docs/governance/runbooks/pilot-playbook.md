# Supervised production pilot — playbook (Loom 2.0 §14, 2.0-rc)

The Loom's own limits say it plainly: proven on synthetic data, never in production. The
release-candidate bar is a **supervised pilot** on a real, bounded scope — the one piece of
2.0 a plugin bundle cannot ship for you. This playbook is what the bundle *can* ship: the
shape of the pilot, the staged cohorts, and an adversarial checklist that says, for each
attack, **which gate already rejects it in CI** versus **what you must exercise live**.

Running the pilot, and standing up the second line and audit function that supervise it, is
the adopter's work. Nothing here turns that into a green check — that is the honest edge of
what a harness can do.

## Pilot characteristics

Choose a change that is meaningful but bounded:

- Customer-facing enough to exercise conduct controls; **not** autonomous core posting on day one.
- Capped customer and transaction exposure; reversible; observable.
- A tested manual fallback (the kill-switch route from the R-gates).
- Dual-run or shadow comparison where possible.
- Embedded second-line oversight — Risk/Compliance observe directly, not via a post-hoc report.
- A pre-agreed customer-remediation process.

## Stages (advance only on the prior stage's exit criteria)

1. **Synthetic rehearsal** — the full change through every gate on synthetic data (what the bundle already proves).
2. **Controlled internal users** — real identities, real approvals, no external customers.
3. **Staff / customer beta** — real users, **no financial execution**.
4. **Capped production cohort** — small, bounded blast radius; second line watching.
5. **Expanded cohort** — after a second-line review of the capped cohort's evidence.
6. **Normal operation** — only after the exit criteria and an independent pilot report.

## Adversarial checklist — attack → the control that catches it

Each row names the mechanism that rejects the attack and its status. **CI-proven** means a
negative bypass test in `.github/workflows/validate.yml` demonstrates the rejection on every
commit; **live** means the bundle enforces the repo-side half and the adopter must exercise
the platform/organisational half in the pilot.

**The `live` rows are the pilot's actual work, and they are counted rather than remembered**
(2.0.0). Each row carries a stable `AX-nn` id, and `docs/governance/pilot-record.json` records
which have been exercised, when, and against what evidence. `scripts/pilot-record-check.mjs`
reads *this table* — not a hand-maintained copy of it — so a row added here becomes an
outstanding obligation on the running pilot the moment it is written, and the pilot cannot
declare its exit while any `live` row is unexercised. That is the same discipline
`discovery-sync.json` applies to the shared discovery tree: a debt nobody wrote down is a debt
nobody pays.

Cite rows by id. A row's prose may be reworded without invalidating the record; changing an
id, or deleting a row that has been exercised, is a deliberate act the gate reports.

| ID | Adversarial exercise | Control that catches it | Status |
|---|---|---|---|
| AX-01 | Agent attempts a direct push / self-merge | Branch protection (HG-0001) + protected control plane (HG-0002) | control-plane **CI-proven**; branch protection **live** (activation evidence) |
| AX-02 | Agent claims the routine lane for an out-of-envelope diff (control-plane path, oversized diff, expired or agent-owned envelope) | `routine-change-check` (HG-0013): absolute floor + second-line-owned expiring envelope; a non-fit re-evaluates to human merge | **CI-proven** (floor / expiry / agent-owner / oversize negative tests); auto-merge-only-on-green **live** (merge-queue activation evidence) |
| AX-03 | Agent modifies a gate | `control-plane-check` (control plane owned, non-builder CODEOWNERS) | **CI-proven** (placeholder-owner negative test) |
| AX-04 | Placeholder / fake control-function approval | `product-approval-check` + identity registry (approvals resolve to real humans) | **CI-proven** (agent-as-approver negative test) |
| AX-05 | Builder impersonates second line | Disjoint builders ∩ second-line; release hold is second-line-owned (`change-envelope-check`) | **CI-proven** (held-release negative test) |
| AX-06 | Stale model evaluation | `model-provenance-check` (eval pinned to the shipping model/prompt) | **CI-proven** (superseded-pin negative test) |
| AX-07 | Missing / fabricated evaluation artifact | `model-provenance-check` (report cited by ref + sha256, re-hashed) | **CI-proven** (altered-report negative test) |
| AX-08 | Tampered evidence bundle | `evidence-seal-check` (semantic + hash-chain) | **CI-proven** (tampered-tests negative test) |
| AX-09 | Fully recomputed evidence chain | External WORM anchor + ed25519 attestation over the anchor | anchor verification **CI-proven**; external WORM **live** |
| AX-10 | Forged assurance-cycle sign-off | `assurance-cycle-check` (ed25519 over the record, second-line confirmer) | **CI-proven** (tampered-cycle negative test) |
| AX-11 | Rewritten agent decision history | `decision-log-check` (append-only hash chain) | **CI-proven** (rewritten-entry negative test) |
| AX-12 | Malicious repository instruction / prompt injection | pii-guard + tripwires + protected control plane; A2 threat model | control plane **CI-proven**; runtime egress controls **live** |
| AX-13 | PII egress attempt | pii-guard hook + data-lifecycle; HG-0011 DLP | hook **live**; pre-egress DLP **live** |
| AX-14 | Vulnerable dependency | `supply-chain-check` (SCA policy) + Q4 | **CI-proven** (critical-CVE negative test); the scanner that PRODUCES the audit is the adopter's fill |
| AX-15 | Incorrect pricing / disclosure | PA2 sections (pricing-conduct, disclosures, KFS) | PA2 **CI-proven**; correctness of the values **live** (human review) |
| AX-16 | Duplicate core transaction | A5 financial integrity (idempotency, maker-checker) + Q3 integration | declared **CI-proven**; execution **live** |
| AX-17 | Failed reconciliation | R6 reconciliation + A5; operations-signal routing | declared **CI-proven**; live break handling **live** |
| AX-18 | Third-party outage | R5 third-party continuity + exit; readiness | declared **CI-proven**; live failover **live** |
| AX-19 | Rollback failure | R3 rollback drill (freshness-windowed) | freshness **CI-proven**; the drill itself **live** |
| AX-20 | Model-provider outage | HG-0006 runtime.fallback declaration | declared **CI-proven**; live failover **live** |
| AX-21 | Critical complaint / vulnerable-customer harm | PA2 vulnerable-customer + complaints readiness; operations-signal | declared **CI-proven**; live remediation **live** |
| AX-22 | Regulatory change mid-delivery | operations-signal regulatory route → discovery (`operations-signal-check`) | **CI-proven** (untriaged-signal negative test); live routing **live** |
| AX-23 | Feature hidden from the waist gate by backlog nesting | `discovery-link-check` (HG-0007): every item is its own block, whichever key its milestone uses | **CI-proven** (id-keyed-milestone negative test) |
| AX-24 | Waist gate quietly inert — a backlog it cannot parse, or an `ADOPT:` marker never set to the adopter's ids | `discovery-link-check` (HG-0007) coverage: it must have examined something before it may print OK, and it states how much | **CI-proven** (unparsed-backlog and unedited-marker negative tests) |
| AX-25 | A tool advertises a capability it does not have | `self-claims-check` C5: a flag documented in a CLI's own usage must appear in its code | **CI-proven** (undocumented-flag negative test) |

## Exit criteria

The pilot is done — and 2.0 can be called stable — when:

- an independent pilot report exists, authored outside the build team;
- every "live" row above has been exercised at least once and its evidence retained;
- all material findings are resolved or formally risk-accepted by the accountable executive;
- second line confirms the control set operated (not merely that templates exist);
- internal audit has independently re-performed the evidence assessment for at least one release.

Four of those five are now mechanical against `pilot-record.json` (PILOT-CONDUCT): the report
must exist and be authored outside `builders`, every `live` row must carry an exercise with
evidence, every material finding must be resolved or carry a named risk acceptance, and the
second-line confirmation must resolve to a human who is not a builder. **What stays entirely
human is whether any of it was done well** — an exercise record proves somebody wrote down that
they exercised a control, never that the control held. The gate governs the *record of* a pilot.
It cannot run one, cannot observe production, and its passing says nothing about whether the
harness is safe in your institution. `SUPERVISED-PILOT` therefore remains **Absent** in the
control catalog until a pilot has actually run — a green gate over an empty pilot is still an
empty pilot.

Until then, the honest status stands: **release candidate, not certified.** Adoption of the
Loom is not, and does not substitute for, regulatory approval.
