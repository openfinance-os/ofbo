# HG-0011 — Onshore model gateway + pre-egress DLP + attested sandbox execution (UAE residency)

- Status: **Proposed** — awaiting bank infra / data-governance decision
- Date: 2026-06-27
- Scope: harness / AI-SDLC governance · enterprise-profile (M6) infra
- Related: HG-0004 (least-privilege identity + vaulted secrets), HG-0010 (cessation lives at this gateway), PRD §3 P6 (the product egress gateway pattern this extends), CLAUDE.md residency hard-stop; the 2026-06-27 UAE regulated-banking harness assessment

## Context

CBUAE *Outsourcing Regulation C 14/2021* (Art. 6.1/6.3) requires the Master System of Record
for Confidential Data to be held **onshore in the UAE**, with no cross-border sharing without
prior CBUAE approval **and** explicit customer consent; the CBUAE Responsible-AI Guidance
(2026) additionally bars use of models the institution lacks **complete operational control and
monitoring** over. The OFBO *product* already encodes this for runtime traffic (P6 single egress
gateway, no direct egress, residency as an IaC parameter). The **build harness itself does
not**: the coding agent's prompts (which can contain source and, at adoption, confidential
context) and the **model inference** go to the provider across the border, through a
pre-configured proxy that is a control *point* but is not necessarily onshore, DLP-scanned, or
bank-operated.

## Requirements & regulatory basis

- **Onshore residency of agent traffic + inference (C 14/2021).** The coding agent's LLM
  requests, and the model serving them, must run within UAE borders for any real/confidential
  context (synthetic-only demo is exempt — see below).
- **Complete operational control over the model (CBUAE 2026).** The bank, not a third party,
  governs which model serves, with monitoring and the cease-use hook (HG-0010).
- **Pre-egress DLP.** Regex + named-entity redaction on every outbound prompt before it leaves
  the onshore boundary — distinct from the write-time `pii-guard` hook.
- **Single-tenant key governance.** No provider API keys on clients; mTLS + corporate SSO at the
  gateway; upstream keys injected from HSM/Vault (HG-0004).

## Options

1. **Onshore enterprise model gateway (recommended).**
   A bank-hosted gateway (e.g. LiteLLM/Kong-class) in-region: clients hold no provider keys and
   open an mTLS session; the gateway authenticates via SSO, injects the upstream key from
   HSM/Vault, runs **pre-egress DLP**, routes by data-sensitivity tier (sensitive context → an
   onshore/self-hosted model; non-sensitive → permitted upstream), streams all interactions to
   the WORM/SOC sink (HG-0003), and hosts the HG-0010 cessation flag. This is the P6 pattern
   applied to the *agent's own* LLM traffic. **Pros:** one onshore chokepoint that satisfies
   residency, control, DLP, key governance, telemetry, and cessation together. **Cons:**
   enterprise infra; an onshore-served model is the hard part (residency of *inference*).
2. **DLP-and-residency proxy only** (no model routing): redact + log at an onshore proxy but
   keep a single upstream model. **Pros:** lighter. **Cons:** doesn't deliver "complete control
   over the model" or sensitivity routing.
3. **Status quo (provider proxy).** **Rejected for real data** — acceptable only while the
   environment is synthetic-only and non-prod.

## Recommendation

**Option 1** at the M6 enterprise swap; **Option 2** as an interim once any non-synthetic
context could touch the agent.

## Sandboxed-execution note (what running as cloud agents already buys)

Running the harness **only as isolated, ephemeral cloud agents — no developer laptop or
devbox** — already closes a large part of this surface and is the right baseline:

- **No host/exfiltration target.** A fresh clone in a throwaway container has no `~/.ssh`,
  `~/.aws`, browser cookies, or other repos to read or leak (the spec's Layer-2/`.claudeignore`
  exfiltration risk and ASI03 privilege blast-radius largely vanish).
- **Disposable execution boundary.** Builds/tests/dependencies run in the sandbox, not on a
  workstation (the spec's Layer-3 / ASI05 / AST06 host-isolation requirement — "protect the
  laptop" is moot when there is no laptop).
- **One egress chokepoint.** All outbound traffic funnels through a single proxy — exactly where
  the gateway + DLP belong, turning a per-laptop problem into a one-place problem.

What it does **not** close, and why this record still stands: the sandbox's **region** and the
**model-inference destination** still determine residency (a non-UAE sandbox or cross-border
model still breaches C 14/2021), and DLP + model-control + key-governance must still be built at
that chokepoint. **Sandbox-only execution makes residency *enforceable at one point*; it does
not make it *true* by itself.** The remaining work: pin the sandbox to an onshore region,
attest its isolation grade (microVM/gVisor-class, egress allowlist), and stand up the gateway.

## Decision

_Pending (bank)._ Once accepted: stand up the onshore gateway with mTLS/SSO + HSM/Vault key
injection + pre-egress DLP + sensitivity routing + WORM/SOC streaming + the HG-0010 cessation
flag; pin agent sandboxes to an onshore region with an attested isolation grade and egress
allowlist; keep the synthetic-only demo profile on the provider proxy.

## Consequences

- The coding agent's own traffic comes under the same residency/egress discipline as product
  traffic (P6), satisfying C 14/2021 and the CBUAE "complete control" expectation.
- Co-locates residency, DLP, key governance, agent telemetry, and the kill-switch at one
  onshore enforcement point.
- Enterprise-infra cost; an onshore-served model is the gating dependency for full compliance.
