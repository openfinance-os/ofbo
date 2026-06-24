# ADR 0018 — Agent identity at the BFF: DCR client-credential issuance for automations (BACKOFFICE-53 / BACKOFFICE-60)

- Status: **Accepted** — Option 2 chosen and built end-to-end in the demo (2026-06-24)
- Date: 2026-06-24
- Stories: BACKOFFICE-53 (Agentic spend-control — BFF-side re-assertion) · BACKOFFICE-60 (Programmatic admin-scope access — DCR automations)
- Builds on: ADR 0017 (agent-first MCP gateway, Accepted) · ADR 0001 (care-surface `act`/`sub` token minting, Accepted)

## Context

The agent-first interface is built end-to-end behind ADR 0017: the MCP gateway exposes
the contract as scope-filtered tools, the registry (`/back-office/agents`) holds
four-eyes-approved agents with their bound `scopes` / `allow_mutations` / `spend_budget`,
the portal administers them, and the gateway enforces a per-session spend budget
(`SpendGuard`) that raises a real `agent_anomaly` Risk signal + ITSM ticket on exhaustion.

One acceptance criterion of BACKOFFICE-53 is **not** met, and it is the load-bearing one:
> spend-control is enforced at the MCP gateway as a pre-flight check **AND re-asserted by
> the BFF** (defence in depth) — the gateway is never the sole guard.

It cannot be met today because **the BFF cannot tell an agent from a human.** In the demo
an agent calls the BFF with its *human persona's* token (`demo-token:customer-care-agent`,
chosen from the registration's `derived_from`). So the BFF sees a `customer-care-agent`
session — not "agent X, session Y, budget Z" — and therefore cannot:
- enforce a per-agent / per-session budget (it has no agent session to key on),
- attribute audit to the *agent* distinctly (only the gateway-supplied trace says so),
- bind the registry's `allow_mutations` / `spend_budget` to the actual caller.

The same gap blocks the *production* half of BACKOFFICE-60: a real automation needs a
credential of its own, not a borrowed human token. This is a **new auth path**, which
CLAUDE.md rule 6 reserves for a humans-decide ADR — hence this one. Per the rule, the
build loop has **stopped** at the gateway-side guard and raised this rather than inventing
a client-trusted budget (a regulated control must never trust client-supplied session ids).

## Requirements & regulatory basis

An agent credential touches consent, money movement, and regulated reporting, so it must
satisfy the same posture as a human operator's session — plus be attributable to the
*automation*:

- **FAPI 2.0 posture is untouched (hard stop).** mTLS, PAR, PKCE; the scheme certificate
  chain stays with the egress gateway (P6). An agent credential is a `client_credentials`
  grant (no PSU at the keyboard), sender-constrained (mTLS / DPoP) so a leaked bearer is
  not replayable.
- **Verifiable agent identity.** The credential must carry a server-verifiable `agent_id`
  (the registry id) — not a client-asserted header — so the BFF can key enforcement and
  audit on the *agent*, and so a confused/adversarial agent cannot reset its own budget by
  forging a session id.
- **Least privilege / scope hygiene (PRD §2).** The token's scopes are exactly the
  registration's bound scopes (a strict subset of a human persona); **never**
  `platform:superadmin` — BACKOFFICE-80 already rejects service-account subjects for the
  super-admin persona, and that rejection must extend to any agent credential.
- **Four-eyes-gated issuance.** A credential is issued only for an `active` registration,
  and registration is already four-eyes (BACKOFFICE-60). Re-issuance / rotation must not
  bypass that.
- **Attributable audit (CBUAE / Nebras).** Every agent call's High-class audit carries
  `acting_principal = agent_id` and the propagated `x-fapi-interaction-id`; PII redacted.
- **Delegated authority where PSU consent is involved.** Any agent action reaching into a
  PSU's consent still carries the `act`/`sub` actor chain (ADR 0001, RFC 8693) — agent X
  acting for PSU Y — and initiates the normal Al Tareq flow. The agent credential is the
  `act` (actor); it never manufactures consent.
- **Revocation is immediate.** Revoking an agent in the registry (single-actor kill
  switch, BACKOFFICE-60) must invalidate its credential fast (short-lived tokens +
  introspection/denylist) — the same urgency as the <5s consent-revoke posture.
- **No PII** in the token, the session store, or any log.

## Options

1. **DCR client-credential issuance at the enterprise auth/egress service (full RFC 7591 +
   FAPI 2.0).** On four-eyes-approved registration, the bank's auth service registers the
   agent as an OAuth client (mTLS-bound) and issues short-lived `client_credentials` tokens
   whose claims carry `agent_id` + the registration's bound scopes + a `session_id`. The
   BFF verifies the token and enforces per-(`agent_id`, `session_id`) budget; audit stamps
   `agent_id`. Pros: the real, FAPI-aligned production answer; sender-constrained; identity
   is fully server-verified. Cons: heaviest; depends on the bank's auth service (enterprise
   adapter, M6); not runnable in the free-tier demo as-is.

2. **Agent session token via token-exchange (RFC 8693), generalising ADR 0001.** Reuse the
   established `act`/`sub` minting: a contract endpoint (e.g. `POST /agents/{agent_id}:mint-session`,
   scope `platform:agents:read`) returns a short-lived agent **session token** whose `act`
   = `agent_id`, scopes = the registration's bound scopes, plus a `session_id` + `budget`
   claim — issued only for an `active` registration. The gateway presents this token; the
   BFF verifies it (it minted it), keys spend-control on (`agent_id`, `session_id`), and
   stamps audit. Pros: reuses the audited, RBAC-enforced minting path (ADR 0001) and the
   existing Hono BFF; runnable in the demo (the sim IdP/auth mints it); server-verified
   identity (no client-trusted header); a clean seam the enterprise swaps for Option 1 at
   M6. Cons: adds a token-mint endpoint to the admin contract (spec-change first); the
   demo's session store is in-memory (fine for demo, durable in enterprise).

3. **Gateway-signed session assertion the BFF verifies.** The gateway holds a signing key
   and emits a per-session JWT (agent_id + budget) the BFF verifies. Pros: no auth-service
   change. Cons: introduces a **new trust anchor** (the gateway key) and effectively makes
   the gateway an issuer — exactly the "gateway is the sole guard" smell BACKOFFICE-53
   warns against; key management is a new primitive. Rejected on principle (compose, don't
   invent a second auth authority).

## Recommendation (for the human to confirm)

**Option 2 now, Option 1 at M6.** Generalise the ADR 0001 `act`/`sub` minting into an
**agent session token** minted by the existing audited path: it gives the BFF a
*server-verified* `agent_id` + `session_id` + bound scopes, which is the minimum needed to
(a) re-assert spend-control BFF-side (closing BACKOFFICE-53's last criterion), (b) attribute
audit to the agent, and (c) bind the registry's `allow_mutations`/`spend_budget` to the real
caller — all on the existing Hono BFF, runnable in the demo, with a clean seam the
enterprise swaps for full DCR client-credentials + mTLS (Option 1) at the M6 port-swap.

Sequence (each its own PR, spec-first where the contract changes):
1. **Spec-change** — add `POST /agents/{agent_id}:mint-session` (scope `platform:agents:read`,
   `Idempotency-Key`, returns a short-lived agent session token) to `specs/backoffice-openapi.yaml`.
   Humans approve the contract.
2. **BFF** — mint via the P2 IdP/auth port (sim in demo), keyed to an `active` registration;
   verify the token in auth middleware → a first-class agent `Principal` carrying `agent_id`
   + `session_id` + bound scopes (never `platform:superadmin`).
3. **BFF spend-control middleware** — per-(`agent_id`, `session_id`) consequential-op budget
   (budget from the registration), 429/`202`-escalation on exhaustion, and the `agent_anomaly`
   Risk signal + ITSM raised **BFF-side** (move the auto-raise authority off the gateway).
4. **Gateway** — present the minted session token as `agentToken` (one line; the gateway
   already carries an opaque `agentToken`). The gateway guard stays as the pre-flight layer.
5. **Revocation** — short token TTL + registry revoke denylists the session.

## Decision

**Accepted — Option 2, built end-to-end in the demo.** The agent session token is minted by
the P2 IdP port (`mintAgentSession` / `verifyAgentSession`; the demo sim signs an HMAC-bound,
server-verifiable bearer — format `agent-session.<payload>.<sig>` — so even in the demo no
client can forge an `agent_id`). The contract gained `POST /back-office/agents/{agent_id}:mint-session`
(scope `platform:agents:read`, `Idempotency-Key`). The BFF auth middleware verifies the token
into a first-class agent `Principal` (`subject = agent_id`, scopes = the registration's bound
set, `agent: { agent_id, session_id }`; MFA skipped — there is no PSU at the keyboard — and
`platform:superadmin` stripped defensively). A BFF spend-control middleware re-asserts the
registration's `allow_mutations` and per-(`agent_id`, `session_id`) `spend_budget`, returning
`403` (read-only) / `429` (exhausted) and raising the `agent_anomaly` Risk signal + ITSM
ticket **BFF-side** on first exhaustion — closing BACKOFFICE-53's defence-in-depth criterion.
The MCP gateway now presents the minted session token as its bearer; a registry revoke
(single-actor kill switch) denylists the session immediately, ahead of the short token TTL.

Option 1 (full DCR client-credentials + mTLS via the bank auth service) remains the M6
enterprise port-swap behind the same `IdentityProviderPort` seam. Until then, agents stay
**read-only by default** (the persona catalogue ships `allow_mutations:false`,
`spend_budget:0`); enabling mutations is a deliberate four-eyes registration change.

## Consequences

- **BACKOFFICE-53** moves from `in-progress` to unblockable: its last criterion (BFF-side
  re-assertion) becomes implementable once an agent session token carries a verified
  `agent_id` + `session_id`. The gateway-side guard + auto-raise already shipped (#251)
  stay as the defence-in-depth *outer* layer.
- **BACKOFFICE-60** gains its production identity story: the demo's `derived_from` human
  token is replaced by a minted agent session token (Option 2), and by full DCR
  client-credentials + mTLS at M6 (Option 1) — the enterprise port-swap.
- **No new auth authority is invented.** Option 2 reuses the ADR 0001 / P2 minting path and
  the existing RBAC + High-class audit; Option 3 (a gateway-as-issuer) is explicitly
  rejected. The agent credential composes the existing primitives.
- Agent credentials are service accounts → can **never** hold `platform:superadmin`
  (BACKOFFICE-80, already enforced at sign-in; extended to credential issuance).
- The token-mint endpoint is a contract change → **spec-first** (a spec-only PR, humans
  approve) before any BFF code, per CLAUDE.md.
