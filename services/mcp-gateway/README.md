# @ofbo/mcp-gateway — agent-first interface

> **EXPERIMENTAL (ADR 0017 — Accepted).** Not in the deploy pipeline. Read-only by
> default. Mutating tools remain gated on **BACKOFFICE-53** (spend-control) + a human
> raising a persona's budget; the **DCR registration endpoint** (BACKOFFICE-60) is a new
> auth path awaiting a human-approved spec-change PR.

This package demonstrates how the human-operated portal could be replaced — or
augmented — by an **agent-first interface**, by exposing the existing OFBO BFF contract
as MCP tools. The agent reasons over the same operations a Customer Care agent or Finance
analyst performs today and calls tools instead of clicking screens.

## What it is

A **pure contract client**. It maps the agent's tool calls onto BFF requests and adds
**no enforcement primitive** — auth, RBAC, four-eyes, audit, and lineage all stay
BFF-side (defence in depth). If this gateway is ever the only thing standing between an
agent and an operation, that's a bug.

- `catalog.ts` — generates one MCP tool per `@ofbo/contracts` `ROUTES` entry, **filtered
  to the agent's minted scopes** (least privilege) and **read-only by default**. The spec
  stays ground truth; contract drift surfaces as a catalogue diff.
- `governance.ts` — operation classification, the **SpendGuard** (BACKOFFICE-53
  per-session blast-radius budget), and four-eyes 202 → pending-approval shaping.
- `gateway.ts` — dynamic dispatch to the BFF carrying the agent bearer token,
  `x-fapi-interaction-id`, and `Idempotency-Key`; a four-eyes `202` becomes a **pending
  approval the agent can never self-ratify** (BACKOFFICE-44).
- `server.ts` — transport-agnostic MCP JSON-RPC dispatcher (`initialize`, `tools/list`,
  `tools/call`), useful for in-process tests.
- `stdio.ts` + `bin.ts` — a **runnable MCP stdio server** over `@modelcontextprotocol/sdk`
  (ADR 0017 step 1). The transport is a dumb pipe; all governance stays in the gateway.
- `agent-personas.ts` — **least-privilege agent personas** (BACKOFFICE-60). Each is a
  STRICT subset of a human persona (`@ofbo/bff` `SCOPE_MATRIX`), read-only today;
  `assertSubsetOf` enforces the invariant (tested against the real matrix so drift fails CI).
- `anomaly.ts` — the **agent_anomaly** event (Risk-signal/ITSM shape, no PII) emitted by
  the gateway when a session crosses its spend budget (BACKOFFICE-53).

## Run it (read-only, against the demo BFF)

```sh
BFF_URL=https://ofbo-bff.michartmann.workers.dev \
AGENT_TOKEN=<bearer the IdP (P2) minted for the agent persona> \
AGENT_PERSONA=care-readonly-agent \
node services/mcp-gateway/src/bin.ts
```

`AGENT_PERSONA` is one of `care-readonly-agent`, `reconciliation-readonly-agent`,
`compliance-readonly-agent`, `analytics-readonly-agent`. All ship read-only
(`allowMutations:false`, `spendBudget:0`).

## Safety posture (ADR 0017 rollout)

1. **Read-only agent first** — `allowMutations: false` (default). Only `*:read` /
   `audit:read` GET tools. Zero blast radius.
2. **Initiate-only** — mutating tools enabled, but four-eyes operations return a pending
   approval ratified by a **different human** principal.
3. **Bounded autonomy** — low-risk non-four-eyes mutations under a per-session
   `spendBudget`, with `onSpendExhausted` wired to a Risk signal + ITSM ticket.

Agent identities are service accounts and can **never** hold `platform:superadmin`
(BACKOFFICE-80 rejects them at sign-in).

## Usage (illustrative)

```ts
import { McpGateway } from '@ofbo/mcp-gateway'

const gateway = new McpGateway({
  baseUrl: process.env.BFF_URL!,
  session: { agentToken, scopes, sessionId },   // scopes = a STRICT SUBSET of a human persona
  allowMutations: false                         // read-only until BACKOFFICE-53 lands
})

gateway.listTools()                             // scope-filtered MCP catalogue
await gateway.callTool('get_consents_search_psu', { query: { iban: 'AE07...' } })
```

## Use it from Claude (cloud cowork) — the OFBO demo

`.mcp.json` at the repo root registers a **self-contained** MCP server (`ofbo-backoffice`)
that any Claude Code session — including Claude Code on the web — auto-discovers. It runs
the **demo-profile BFF in-process** (`createApp()`, seeded synthetic data, zero PII): the
gateway dispatches each tool call straight to it via `app.request`, so there is **no
separate service to start and no external network** (the deployed demo isn't reachable
from the cowork sandbox). Every call is still governed by the real BFF — auth, RBAC,
four-eyes, and High-class audit all apply.

**One-time prep in the session:** `pnpm install` (so `pnpm --filter @ofbo/mcp-gateway run
demo` can spawn). Then approve the `ofbo-backoffice` MCP server when Claude prompts.

**Look up Back Office info (read-only, default).** Six tools are exposed — consent search,
consent admin view, consent + PSU audit trails, audit events. Example asks:
- "Search the back office for consents belonging to customer `cust-0001`." (seeded demo
  PSUs are `cust-0001`, `cust-0002`, …)
- "Show the audit trail for that consent."

**Revoke a consent (later).** Flip the env in `.mcp.json` to enable mutating tools:
```json
"env": { "OFBO_DEMO_ALLOW_MUTATIONS": "true" }
```
Then the `post_consents_consent_id_revoke_admin` tool appears. Single-consent revoke is
`consents:admin` and **not** four-eyes, so it executes inline (High-class audited).
Emergency *bulk* revoke stays four-eyes — the agent can initiate it but only ever gets a
**pending approval** back; a human ratifies it in the portal. Keep this `false` until you
want the agent to make changes.

> DEMO ONLY — synthetic data. The agent authenticates with a demo IdP token
> (`demo-token:customer-care-agent`); the gateway restricts the catalogue to the
> least-privilege `care-readonly-agent` subset. Never point this at real data.

## Tests

`pnpm test` (unit project) covers catalogue generation, scope filtering, the
superadmin-non-wildcard rule, spend-control, idempotency on mutations, and the four-eyes
no-self-approve invariant.
