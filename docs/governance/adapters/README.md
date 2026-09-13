# Enterprise adapters — the neutral contract (Loom 2.0 §16)

> **Identifiers.** Gate ids (`D1`–`D9`, `Q1`–`Q5`) and run-level ids (`S-001` signal,
> `T-1` theme, `H1` hypothesis) are expanded in `discovery/GLOSSARY.md`.

The Loom integrates with, but does not own, a bank's platforms: source-control branch
protection, CI/CD, IAM/PAM, secrets vaults, GRC/control registers, model inventories,
incident management, observability, and the evidence/WORM store. Adapters keep the **core
vendor-neutral**: every adapter maps an external system's state into the Loom's own
currency — a **signed evidence envelope** tied to a control in the catalog — so the gates
never learn a vendor's API, only read envelopes.

## The contract

An adapter is a JSON declaration, mounted at `docs/governance/adapters/<adapter-id>.json`,
with these fields (validated by `scripts/adapter-check.mjs`):

| Field | Meaning |
|---|---|
| `adapter_id` | Stable id, unique across adapters |
| `system` | The external system (`github`, `servicenow-grc`, `hashicorp-vault`, …) |
| `satisfies_control` | The **catalog `control_id`** this adapter provides evidence for — must exist |
| `capability` | One line: what the system does that the control needs |
| `evidence.kind` | The envelope kind it emits (`branch-protection`, `control-register`, `vault-attestation`, …) |
| `evidence.envelope_fields` | The fields the emitted signed envelope carries |
| `activation_evidence` | Proof the integration is live (a fetch timestamp + a probe result), or absent |

The one honesty rule the gate enforces: an adapter that names a control the catalog does not
have, or that declares no evidence kind, **fails** — a mapping to nothing is not integration.
An adapter present but with no `activation_evidence` is reported as **declared, not active**:
it is a wired seam awaiting its first real fetch, never a green control on its own.

## Why the core stays neutral

The gates read **envelopes**, not vendor payloads. Swap GitHub for GitLab, ServiceNow for
Archer, and the control catalog and gates do not change — only the adapter mapping does. That
is the whole point of the seam: the same Loom runs on a different platform stack because the
adapter, not the core, speaks the vendor's dialect.

## Two directories, and the difference matters

**`reference/`** holds mappings where the Loom ships **one worked example** of a system it expects
most adopters to have in some form. Copy one, point it at your system, and mount it.

| Reference mapping | System | Control | Closes |
|---|---|---|---|
| `github-branch-protection.json` | GitHub | `HG-0001` | Four-eyes is enforced by the forge, not by the agent |
| `grc-control-register.json` | ServiceNow GRC | `OPS-READINESS` | The Loom's readiness declarations and the enterprise register do not drift |

**`providers/`** holds roles where the institution genuinely **chooses**, and the alternatives sit
side by side. This directory exists because `reference/` structurally could not hold a choice: it
can carry at most **one** adapter per control (`AD-R05` refuses two on the same control, and CI
mounts the whole directory), so a role with three plausible providers had nowhere to put the second
and third. The layout encoded *the one true instance* while the canon claimed to name roles, not
vendors — `HG-0008` honoured in the prose and broken in the filesystem.

```
providers/roles.json                          the roles, each naming its control + capability
providers/sca/{snyk,trivy}.json               fills Q4-SUPPLY
providers/hardened-runtime/{chainguard,internal-golden-images}.json   fills HG-0011
providers/shariah-governance/{internal-issc-register,grc-shariah-workflow}.json   fills SHARIAH-GOV
providers/runtime-guardrails/{gateway,sidecar}-policy-enforcement.json            fills AI-INCIDENT
providers/real-data-controls/{kms-field-encryption,vault-tokenisation}.json       fills REAL-PII-SURFACE
```

`runtime-guardrails` and `real-data-controls` ship a `README.md` beside their alternatives — read it
before choosing. Both are roles whose name promises more than the harness delivers, and each README
says which half is which (see also the reconciliation table below).

Nothing under `providers/` is mounted by default — **a catalog is an offer, not an installation.**
The institution records its choice in `docs/governance/provider-selection.json` and copies the
chosen file into `docs/governance/adapters/`. `scripts/provider-selection-check.mjs` enforces the
join, including `PS-R06`: once a compiled plan requires a role's capability, having made *no*
choice is a finding rather than a default.

**Which role arms, and from where, differs per role — and the difference is the point.** The base
`regulated-bank` profile declares `sca`, `hardened_runtime` and `real_data_controls` at **high tier**,
so on a high-tier change those three choices are mandatory whatever the change is about — the
D6-register pattern, where the requirement comes from the profile and a pipeline edit cannot weaken
it. The other two arm only from a profile an institution opts into: `shariah_governance` from an
Islamic product or institution profile, `runtime_guardrails` from an AI-serving product profile. So a
conventional adopter is never asked for a Shari'ah provider, and an adopter with no model in a serving
path is never asked for an enforcement point. `PS-R06` demands a recorded *decision*, not a live
integration: an institution can honestly be mid-onboarding with a provider chosen and its probes not
yet run, which is the `selected, not active` state.

**What a chosen provider is reconciled BY, which is not the same question and is answered honestly per
role.** Every provider declares `reconciliation.gate_artifact` — the file its fetch writes — and
`reconciliation.gate_mechanism`, the gate that reads that file. Three roles have one. Two do not, and
say so with `gate_mechanism: null` rather than naming a script, because a gate id that does not resolve
reads as coverage and is worse than the gap it papers over:

| Role | Control | Reconciled by |
|---|---|---|
| `sca` | `Q4-SUPPLY` | `scripts/supply-chain-check.mjs` reads the audit artifact |
| `hardened-runtime` | `HG-0011` | `scripts/platform-activation-check.mjs` reads the activation record |
| `shariah-governance` | `SHARIAH-GOV` | `scripts/shariah-governance-check.mjs` reads the ISSC register |
| `runtime-guardrails` | `AI-INCIDENT` | **nothing** — the control is catalogued `defined` (a runbook, not a mechanism) |
| `real-data-controls` | `REAL-PII-SURFACE` | **nothing** — the control is catalogued `absent`; the harness ships nothing for the real-data case |

For the bottom two, `match_on` is a specification for the adopter's own fetch, not a comparison CI
performs, and each declaration states what a gate would take. Selecting a provider does not change
either control's grade — the catalog says so too.

Adding a provider is the intended way to extend this: drop a file under `providers/<role>/`, keep
the adapter contract, and state its `role_fit` honestly — every provider ships one line on what it
is good at and one on where it is weak, so the choice is made with open eyes rather than sold.

## One adapter, one control

The supply-chain providers name `Q4-SUPPLY` and `HG-0011`, never both. That is `AD-R05`: two
adapters sharing a control make their evidence interchangeable, so a probe of one mechanism appears
to satisfy a claim it was never tested against. If two sources are genuinely needed for one control,
make them one adapter with both negatives required. `PS-R03` is the same rule at selection time.

Every supply-chain provider carries a **negative probe** (`tamper_probe`, `unsigned_image_probe`,
`staleness_probe`). Fill it: an adapter whose activation evidence proves only that the API answered
has not shown that the reconciliation bites. See `../loom/references/supply-chain-security.md` §1.
