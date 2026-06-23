# ADR 0017 — Agent-first interface via an MCP gateway over the BFF contract (BACKOFFICE-60 / BACKOFFICE-53)

- Status: **Proposed** — awaiting human decision (raised 2026-06-23)
- Date: 2026-06-23
- Stories: BACKOFFICE-60 (Programmatic admin-scope access — DCR automations) · BACKOFFICE-53 (Agentic spend-control for admin-scope MCP tools)
- Spike: `services/mcp-gateway` (experimental, NOT in the deploy pipeline)

## Context

The Internal Portal (`apps/portal`) is a thin Next.js client over the OpenAPI
contract: every operator action is an authenticated, scope-gated, High-class-audited
call to the Hono BFF (`services/bff`). The question on the table is whether the
**human at the glass** can be replaced — or augmented — by an **agent-first
interface**, where a model reasons over the same operations a Customer Care agent,
Finance analyst, or Compliance officer performs today and drives them through tools
instead of screens.

The substrate is already agent-ready, by construction rather than by accident:

- **The contract is the product.** `@ofbo/contracts` exposes `ROUTES` — every path
  with its `{ method, path, tag, scope, fourEyes }` — plus a typed `createApiClient`.
  That is exactly the metadata an MCP tool catalogue needs: one tool per operation,
  each carrying its required scope and a four-eyes flag.
- **Non-human principals are first-class.** Auth (`services/bff/src/auth.ts`) mints
  scopes from a persona; the High-class audit event records `acting_principal` +
  `scope_used` + `request_trace_id` regardless of whether the principal is a person.
  ADR 0001 already established short-lived `act`/`sub` delegation for console-originated
  calls.
- **The dangerous paths are already gated.** Four-eyes operations return `202` +
  `approval_request` and are executed only by a *second, different* principal
  (`services/bff/src/approvals/service.ts`); self-approval is rejected at the service
  layer even for super-admin.
- **The backlog already anticipates this.** `BACKOFFICE-60` (DCR automations) and
  `BACKOFFICE-53` (agentic spend-control for MCP tools) sit in `deferred:` (Phase 2).

What is **not** covered by the canon, and is therefore a humans-decide decision under
CLAUDE.md rule 6 (no new auth paths / approval mechanisms invented by the build loop):
**how an agent obtains identity and scopes, and what bounds its autonomy.** Hence this
ADR. The build loop has parked BACKOFFICE-60 in `deferred:` pending it.

## Requirements & regulatory basis

An agent-first interface touches consent, money movement, and regulated reporting, so
the same hard stops that govern human operators govern agents — only more strictly,
because an agent acts faster and at scale:

- **Least privilege / scope hygiene (PRD §2).** The persona scope matrix is
  load-bearing for audit defensibility; granting beyond it is an automatic review FAIL.
  An agent persona must be a *subset* of a human persona's scopes, never a superset, and
  never the `platform:superadmin` union.
- **No automation holds super-admin (BACKOFFICE-80).** Sign-in already rejects
  service-account subjects for `platform-super-admin`. An agent identity is, by
  definition, a service account — so the union-of-all-scopes role stays human-only and
  the agent error message already points at "register under BACKOFFICE-60".
- **Four-eyes is never closed by the actor (BACKOFFICE-44).** An agent may *initiate* a
  high-blast-radius operation (bulk revoke, fraud revoke, refund, monthly sign-off,
  CBUAE report, invoice run) but the `202` approval must be ratified by a different —
  and, per policy, **human** — principal. An agent that both initiates and approves is
  an automatic FAIL.
- **Consent is never bypassed (CBUAE).** Any agent action requiring PSU authority
  initiates the normal Al Tareq flow and carries the `act`/`sub` delegation chain
  (ADR 0001) — an agent cannot manufacture consent.
- **Attributable audit (CBUAE / Nebras).** Every agent tool call emits a High-class
  audit event with the agent identity as `acting_principal`, the `scope_used`, and the
  propagated `x-fapi-interaction-id` — no PII, redacted at emission.
- **Blast-radius / spend control (BACKOFFICE-53).** An agent can fan out; a per-session
  budget on consequential operations (count of revokes/refunds/etc. before mandatory
  human escalation) bounds the damage from a confused or adversarially-prompted agent,
  mirroring the BACKOFFICE-80 per-session guardrail pattern.
- **No PII in the agent's working context.** The hard stop on PII in browser storage
  extends to any prompt/transcript/context store the agent uses. The tool layer returns
  the same redacted payloads the portal renders.

## Options

1. **MCP gateway over the existing contract (recommended).** A new service
   (`services/mcp-gateway`) generates one MCP tool per `ROUTES` entry from
   `@ofbo/contracts`, filters the catalogue to the agent's minted scopes (least
   privilege), calls the BFF through `createApiClient` with the agent's bearer token +
   `x-fapi-interaction-id` + `Idempotency-Key`, and treats a `202` as a *pending
   approval* tool result (never auto-approves). Pros: zero new enforcement path — auth,
   RBAC, four-eyes, audit, and lineage all stay BFF-side and untouched; the agent is
   just another contract client; the catalogue regenerates with the spec. Cons: a new
   network surface to operate; needs the agent-identity/DCR model (BACKOFFICE-60) and
   spend-control (BACKOFFICE-53) to land before any *mutating* tools are enabled.

2. **Embed an agent in the portal (chat-in-app).** Keep the portal; add a copilot pane
   that calls the same BFF on the operator's session. Pros: reuses the human's
   identity/MFA, no new principal model, fastest to value. Cons: not truly "agent-first"
   — still human-session-bound; the agent inherits the *full* human persona scope rather
   than a least-privilege subset; harder to run headless.

3. **Bespoke agent endpoints on the BFF.** Add purpose-built coarse-grained operations
   for agents. Pros: can shape ergonomics for a model. Cons: a second contract surface to
   keep conformant, duplicates enforcement, and violates "compose, don't invent" — the
   existing fine-grained contract already covers the operations.

## Recommendation (for the human to confirm)

**Option 1**, rolled out in safety order:

1. **Read-only agent first.** Enable only `fourEyes:false`, read-scope tools
   (`*:read`, `audit:read`) — executive dashboard, break detail, PSU search, audit
   trails. Zero blast radius; immediate value as an investigative copilot. No new
   mutating authority.
2. **Initiate-only agent.** Allow mutating tools, but every consequential one routes
   through the existing `202` approval queue to a **human** approver. The agent drives;
   a person ratifies.
3. **Bounded autonomy.** Only for low-risk, non-four-eyes mutations (claim a break, set
   a risk-signal status), under per-session spend caps (BACKOFFICE-53) with an
   auto-raised Risk signal on anomaly.

Gate the whole thing behind **BACKOFFICE-60** (agent identity via DCR + four-eyes-approved
registration) and **BACKOFFICE-53** (spend-control) — neither is invented here; both are
existing deferred stories this ADR scopes.

## Decision

_Pending._ This ADR is **Proposed**. The `services/mcp-gateway` spike demonstrates the
governed tool-mapping core (catalogue generation from `ROUTES`, scope filtering,
four-eyes interception, audit/idempotency propagation) against the in-process BFF, with
no transport wired and nothing in the deploy pipeline. It exists to make the decision
concrete, not to ship an agent.

## Consequences

- BACKOFFICE-60 and BACKOFFICE-53 move from one-line `deferred:` placeholders to
  fully-specified stories (acceptance criteria added to `docs/backlog.yaml`), blocked on
  this ADR's acceptance.
- **No mutating agent tool is enabled** until BACKOFFICE-60 (identity) and BACKOFFICE-53
  (spend-control) are built and human-approved. The spike ships read-only by default.
- The MCP gateway is a **pure contract client** — it adds no auth, RBAC, approval, or
  audit primitive. If it is ever caught enforcing scope itself rather than delegating to
  the BFF, that is the bug. Defence in depth still holds: BFF middleware + service layer
  remain the enforcement points.
- The catalogue is **generated from the spec** (`ROUTES`), so contract drift surfaces as
  a tool-catalogue diff — the spec stays ground truth for the agent surface too.
- Agent identities are service accounts and therefore can **never** hold
  `platform:superadmin` (BACKOFFICE-80 already enforces this at sign-in).
