# @ofbo/mcp-gateway — agent-first interface spike

> **EXPERIMENTAL SPIKE (ADR 0017).** Not in the deploy pipeline. Read-only by default.
> Gated on **BACKOFFICE-60** (agent identity via DCR) and **BACKOFFICE-53** (spend-control).

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
  `tools/call`). Binding it to a real stdio transport (`@modelcontextprotocol/sdk`) is
  boilerplate, intentionally left out of the spike.

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

## Tests

`pnpm test` (unit project) covers catalogue generation, scope filtering, the
superadmin-non-wildcard rule, spend-control, idempotency on mutations, and the four-eyes
no-self-approve invariant.
