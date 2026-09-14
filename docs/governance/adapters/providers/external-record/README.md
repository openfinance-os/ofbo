# Role: `external-record` (control `HG-0003`)

Every trust root the Loom holds — the control catalog, the identity and issuer registries, the
evidence chain — lives in the repository the coding agent writes to. A sealed hash chain proves
the evidence is *consistent*; it cannot prove *custody*, because the agent that can edit the
artifacts can recompute the chain. The one thing that separates a control from a self-attestation
is a record the agent cannot rewrite, and that record has to live outside the tree.

This role names where it lives. **Kosli is the first provider, not the dependency** (decision K9,
`kosli-seam.md`): a WORM store with RFC 3161 timestamps, a transparency log, or an evidence
platform the bank already runs fill the same role through the same seam.

## The seam

`core/external-record.mjs` is the only module the rest of the harness calls: `status()`,
`post(envelope)`, `resolve(ref)`, `trailStatus(subject)`. It reads the selection in
`docs/governance/provider-selection.json`, loads `core/providers/<provider>.mjs`, and hands the
signed envelope over. **Unmounted, every call is a named no-op**: the gate runner's run record
says `external_record: not mounted`, `scripts/record-trail-status.mjs` says so, and nothing is
queued. A required capability with no selection is `PS-R06`'s finding, and nobody else's.

A call that reaches the provider and fails (network, auth, a CLI exit ≠ 0) queues the envelope
to `.loom/record-outbox/`; `scripts/record-flush-outbox.mjs` retries. A rejected envelope — one
the provenance gate refuses (`core/provenance.mjs`, rules PR1–PR6) — is never queued and never
posted; the fake's empty call log is the proof.

## What the harness can and cannot see

It can post a record and read it back by id. It **cannot** verify that the platform is immutable,
onshore, or backed up: those are the platform's properties, evidenced in `activation_evidence` by
an integration run and a tamper probe, and graded in `bank-grade-gap.md` like every other row. A
record is not a control — Kosli holding a gate result proves the gate ran and what it said, not
that the gate was right.

## Reading the record, and the demo

Agents read the record through `core/record-mcp.mjs`, a read-only MCP server the plugin mounts as
`loom-record` (adopters add `{"command":"node","args":["core/record-mcp.mjs"]}` to their
`.mcp.json`). `scripts/record-audit.mjs <CHG>` renders one audit page per change from the record
joined to the sealed bundle. The source bundle's demo is not copied into an adopted repository.
Here, the selected provider's live integration and tamper-probe results belong in the mounted
adapter declaration's `activation_evidence`, with the corresponding references tracked by the
activation plan.

## Providers here

| | `kosli` |
|---|---|
| Record unit | one trail per change envelope; one attestation per gate result, decision or seal anchor |
| Id | the `attestation_id` Kosli assigns, read back with `get trail --output json` |
| Transport | the official CLI only (`core/kosli-cli.mjs`); auth via `KOSLI_API_TOKEN` in the runner, never on argv |
| Verified surface | `core/providers/kosli.mjs` and `core/kosli-cli.mjs` — the mounted adapter and its CLI boundary |

## To adopt

Record the choice in `docs/governance/provider-selection.json`, copy the chosen declaration to
`docs/governance/adapters/`, fill its `config`, and run the first integration run to fill
`activation_evidence`. Selecting is not installing; installing is not activating; an adapter with
placeholder `activation_evidence` is reported as *selected, not active*.

**Required at high tier.** The shipped `regulated-bank` profile requires `external_record` at the
high tier and above, beside `sca` and `hardened_runtime`: a change that reaches the tier where
the evidence bundle must be anchored outside the tree is a change that must have named where.
Below high, and under the `standard` profile, the role stays dormant.
