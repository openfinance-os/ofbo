# ADR 0023 — First enterprise port adapter: P2 Microsoft Entra ID (the reference template)

- Status: **Accepted** — chosen by the user (2026-06-25): build a reference enterprise adapter for
  P2 Entra ID as the template the remaining ports follow.
- Date: 2026-06-25
- Scope: the first `enterprise`-profile port adapter. Composes an existing interface
  (`IdentityProviderPort`) — not a new platform primitive — so it is an extension, not an invention
  (CLAUDE.md rule 6). The ADR records how the port-swap contract applies to P2, because P2 is the
  one port whose human-login leg cannot be identical between demo and enterprise.
- Relates to: PRD §3 / §3.1 (ports + profiles), §9 (M6), ADR 0018 (agent identity).

## Context

Until now every enterprise adapter threw `EnterpriseAdapterNotImplementedError` — M6 was entirely
ahead of us. The readiness wizard honestly tells a prospect *"9 enterprise adapters remain."* The
highest-leverage way to shrink that is to **pre-build reference adapters for the vendors most likely
in the first deals**, so the line becomes *"reference adapter available — configure it."* This ADR
establishes the pattern with the cleanest, most universal port: **P2, the enterprise IdP**, against
**Microsoft Entra ID** (Azure AD) — standard OIDC, so it is near-config-only.

## Decision

Add `packages/ports/src/adapters/enterprise/p2-entra.ts` — `EntraIdentityProviderAdapter`
implementing `IdentityProviderPort` — and wire it into the registry: `getAdapter('p2-identity-
provider', 'enterprise')` now resolves (lazily, memoized; a config error is never cached) instead of
throwing. The registry keeps a `Partial` map of enterprise factories that grows port-by-port.

**What lives in the adapter (OFBO-specific, fully unit-tested):**
- **Entra claim → OFBO persona mapping** (configurable claim, default `roles`; value → persona).
- **Mandatory MFA** — a token whose `amr` does not assert `mfa` is **rejected** (a P2 hard stop), not
  downgraded.
- **Subject** from `oid` (preferred, non-reassignable) falling back to `sub`.
- **Agent session** (ADR 0018): `mint`/`verify` round-trip with forgery rejection.

**What is an injected seam (the integration point a bank wires):**
- **Cryptographic JWT verification** (signature/issuer/audience/expiry against Entra's JWKS). The
  `entraIdpFromEnv` factory builds a JWKS-backed RS256 verifier with `jose`, **imported lazily** so
  the demo profile (which never constructs this adapter) carries no extra weight. Tests inject a fake
  verifier, so the suite never touches the network.
- **Agent-token issuance** — ADR 0018 Option 1 says the bank's token service (DCR client-credentials
  / mTLS) issues it. The shipped reference uses an HMAC service (`hmacAgentTokenService`) with the
  same `agent-session.<payload>.<sig>` shape the simulator uses, so the BFF treats both identically
  and the security property (a tampered token must not verify) is provable without a live token
  service. A bank swaps this for its token service.

Config surface (env): `P2_OIDC_ISSUER`, `P2_OIDC_CLIENT_ID`, `P2_PERSONA_MAPPING` (JSON) required;
`P2_PERSONA_CLAIM` (default `roles`), `P2_AGENT_SIGNING_KEY` optional. Missing/invalid config throws
a clear `EntraIdpConfigError` — never a silent fall-through to the simulator.

## How the port-swap contract applies to P2 (the nuance)

The rule is "an enterprise adapter passes EXACTLY the contract suite its simulator passes." That holds
verbatim for the **interface shape** and for the **agent-session security** (round-trip + forgery
rejection are identical, so the same assertions run in `p2-entra.spec.ts`). It **cannot** hold
literally for the **human-login leg**, because that leg is intrinsically different:
- the **demo** exposes a 9-persona picker with `demo-token:<persona>` strings (a demo affordance);
- **enterprise** has no picker — login is a real OIDC redirect, and `verifyToken` validates an
  Entra-issued JWT, deriving the persona from a role/group claim.

So the enterprise P2 suite asserts the **same behavioural contract** (`verifyToken` returns
`{subject, persona, mfa}`, MFA enforced, persona mapped) exercised with **enterprise-appropriate
fixtures** (a verified Entra JWT + a configured mapping) rather than demo tokens. `personaLogins()`
returns the configured mapping for documentation only, with an empty `demo_token` (never a
credential). This is the one place the demo/enterprise contracts diverge by necessity; every other
port's two adapters are behaviourally identical and share the suite unchanged.

## Consequences

- The maturity dashboard can truthfully move **P2 from "to write" to enterprise-**`ready`** (a
  reference adapter ships and passes the contract). The remaining-adapter count drops accordingly.
- `jose` is added to `@ofbo/ports` (Web-Crypto-based, Workers-compatible) but loaded only via dynamic
  import inside the enterprise verifier — the demo bundle is unaffected.
- The pattern is set for the next reference adapters (P3 ServiceNow, P5 OTLP, …): a vendor adapter
  behind the interface, OFBO logic concrete + unit-tested, the vendor's crypto/transport an injected
  seam, config-from-env via a factory, registry wired port-by-port.
- A bank still configures its tenant/client/mapping and swaps the agent-token service for its own —
  a reference adapter is a *head start + config surface*, not a finished, instance-specific
  integration.
