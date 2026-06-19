# ADR 0001 — Care-surface token minting exposure surface (BACKOFFICE-25)

- Status: **Proposed** — awaiting human decision (auth-path; CLAUDE.md rule 6)
- Date: 2026-06-15
- Story: BACKOFFICE-25 — Care-surface token minting with `act` + `sub` claims

## Context

BACKOFFICE-25 requires that **console-originated API calls carry agent identity
(`act`) and PSU (`sub`)**, via short-lived (**≤15 min**), request-scoped tokens
(PRD §7).

The mechanism is already defined by the canon:
- The **P1 `CareSurfacePort.mintCareToken({ agent_id, psu_id }, trace)`** returns
  `{ token, act, sub, expires_at }` (the demo sim adapter mints a 15-min token).
- `specs/backoffice-openapi.yaml` `securitySchemes.adminOAuth` documents care-surface
  tokens as **Platform Auth Service `client_credentials` with act/sub claims**
  (`tokenUrl: https://auth.bank.example/oauth2/token`).

What is **not** covered by the canon: **how the console obtains the care token.**
The OpenAPI contract has no path for it, and per CLAUDE.md rule 6 a new **auth path**
is a humans-decide decision, not something the build loop should invent. Hence this
ADR (the loop has parked BACKOFFICE-25 `blocked` on it).

## Options

1. **Add a Back Office contract endpoint** (e.g. `POST /care-surface:mint-token`,
   scope `consents:admin`/`disputes:admin`, body `{ psu_identifier }`, returns
   `{ token, act, sub, expires_at }`). Requires a human-approved **spec-change** first
   (contract is ground truth). Pros: auditable through the existing Hono BFF + RBAC +
   High-class audit; one enforcement path. Cons: adds a token endpoint to the public
   admin contract.

2. **Portal-server (Next.js) route**, outside the OpenAPI contract — the same pattern
   M1-PORTAL-SHELL used for the persona session (the portal is the demo BFF first
   layer). Pros: no contract change; the care surface is portal-resident (BD default).
   Cons: a second auth surface alongside the Hono BFF; must still emit High-class audit.

3. **Transparent BFF middleware** — mint+attach `act`/`sub` automatically on
   console-originated, PSU-scoped calls that target the care surface (no explicit
   endpoint). Pros: enforces act/sub uniformly, no client step to forget. Cons: needs
   a consuming care-surface call to exist first (none is built yet); request-scoping
   semantics need definition.

## Recommendation (for the human to confirm)

**Option 1** — a contract `:mint-token` endpoint behind the existing Hono BFF — keeps
care-token issuance on the single audited/RBAC-enforced path and matches "the contract
is ground truth". It requires a spec-change PR first. If the bank prefers to keep token
issuance entirely in the auth service (no Back Office endpoint), **Option 3** as the
console integration lands (with the care-surface consumer) is the fallback.

## Decision

_Pending._ Once chosen: if Option 1, open the spec-change PR (human-approved), then
implement; if Option 2/3, record the auth-path decision here and unblock BACKOFFICE-25.

## Consequences

- BACKOFFICE-25 is `blocked` on this ADR. **As of 2026-06-20 the eligible build queue
  is drained (M0–M5 complete), and BACKOFFICE-25 is the only unbuilt _Must_-priority
  requirement** — so this decision is now the highest-value unblock. The remaining
  blocked items are BACKOFFICE-33 (BD-13 governance), BACKOFFICE-64 (ADR 0003), and
  M6 port-swaps (per-bank).
- Whichever surface is chosen, the mint path MUST: enforce the caller's scope, emit a
  High-class audit event (agent `act` + PSU `sub`, PII redacted), and cap token life at
  ≤15 min, request-scoped — all composing existing primitives (P1 port + audit), never
  a new approval/gateway primitive.
