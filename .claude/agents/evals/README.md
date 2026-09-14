# Agent evals — fixtures for the reviewer and assurance agents (2.1.0, plan row 5.4)

Each case is `<agent>/<case>/` with:

- `case.json` — what the fixture is: whether the register is mounted, the verdict the case exists
  to produce, and one line on why.
- `input/` — the files the agent is pointed at (a change, a register, a manifest, a pins file).
- `expected.json` — the output the agent must produce, in `loom.agent-output/v1`
  (`../agent-output.schema.json`).

`scripts/agent-output-check.mjs` validates every `expected.json` against the schema and its
invariants on every PR: a register-less case expects `INSUFFICIENT_EVIDENCE`, every evidence ref is
a file in `input/`, a pass carries no high or critical finding. **That is a specification of
behaviour, not a measurement of it.** Running the model is the adopter's eval rig: invoke the agent
on `input/`, compare the JSON block to `expected.json` on `verdict`, `register_state` and the set
of finding `subject`s, and record the run in `docs/governance/evidence/` the way the delivery
loop's evals are recorded. Until that runs, the manifest row for the agent carries no eval and the
provenance gate says so at the tiers that require one.

Adding a case: copy the nearest one, change `input/`, and write the `expected.json` a second-line
reader would sign. A case whose expected output you could not defend to the second line is not a
fixture.
