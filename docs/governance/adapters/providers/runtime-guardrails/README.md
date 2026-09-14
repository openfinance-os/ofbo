# Role: `runtime-guardrails` (control `AI-INCIDENT`)

**Not the same guardrails as `guardrails/guardrail-policy.json`.** That policy covers the agent that
**writes the code**, at build time — pre-write hooks, CI backstops, the things that stop a bad commit.
This role covers the agent that **serves the customer**, at request time: the policy-enforcement point
that sits between a request and a model, applies input/output filters, tool-use allowlists, and
terminology or PII screens, and records what it allowed and what it denied.

Left unnamed, "we have guardrails" is an assumption that survives every review because nobody can say
which component holds it. This role makes it a component with a name, an owner and a decision log.

## What the harness can and cannot see

**It cannot verify that a runtime guardrail fires.** The harness reads JSON records; it does not watch
production. A filter that is deployed but misconfigured, or disabled at 03:00 by a feature flag,
looks exactly like one that works — until an incident says otherwise.

What it *can* do is refuse to let a change ship that never chose an enforcement point, and read the
denial the platform recorded when the negative probe was run. That is a smaller claim than "guardrails
enforced", and it is the true one. Coverage between probes is `uncovered`, not assumed clean.

Two properties are therefore non-negotiable for any provider here:

1. **The decision log is asserted by the serving platform, not by the agent being constrained.** An
   agent that writes its own "I was not permitted to do that" record is the defect, not the control.
2. **A negative probe.** A policy-violating action must be *denied* and the denial must be
   *observable* in that log. An allow-only log proves traffic, never enforcement.

## The two shapes

| | `gateway-policy-enforcement` | `sidecar-policy-enforcement` |
|---|---|---|
| Where it sits | in front of the model and tool endpoints, on the network path | beside the workload, in the request path inside the pod/process |
| Bypass risk | a caller that reaches the model directly is unenforced | a workload deployed without the sidecar is unenforced |
| Evidence origin | the gateway's own decision log, outside every workload | the mesh/admission control plane, outside the workload it constrains |
| Trade | one chokepoint to secure, one chokepoint to route around | enforcement travels with the workload, at the cost of injection coverage being the real control |

Neither is safer in the abstract. Each one's bypass is the thing its `role_fit.limitation` names, and
that is the sentence to read before choosing.

## To adopt

Record the choice in `docs/governance/provider-selection.json`, copy the chosen declaration to
`docs/governance/adapters/`, point it at your enforcement point, and wire the fetch that fills
`activation_evidence`. Selecting is not installing, and installing is not activating — an adapter with
placeholder `activation_evidence` is reported as *selected, not active*, which is the honest resting
state, never a green control.

**Dormant until required.** `runtime_guardrails` compiles only from a profile that requires it (an
AI-serving product), so an adopter running no agent in a serving path never meets this role. `PS-R06`
arms it the moment a plan names the capability, and not before.
