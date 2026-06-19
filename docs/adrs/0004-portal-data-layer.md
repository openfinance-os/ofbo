# ADR 0004 — Portal data layer: server-first fetch + generated contract types

- **Status:** Accepted
- **Date:** 2026-06-20
- **Context tags:** frontend, stack, contract-first
- **Relates to:** CLAUDE.md "Stack" (names TanStack Query + OpenAPI-generated client as frontend defaults) + "API conventions"; the codebase-vs-PRD review (2026-06-20) flagged the portal as bypassing both defaults.

## Context

CLAUDE.md's frontend defaults name **TanStack Query** and an **OpenAPI-generated client**. The portal (`apps/portal`) is Next.js 15 App Router, **server-first**: data is read in Server Components and mutated through Server Actions, with the BFF bearer token held in an **httpOnly cookie that never reaches the browser**. The review found:

1. **TanStack Query is absent** — and largely unnecessary in a server-first design, where caching/revalidation is handled by the framework (RSC + `revalidate`/server actions), not a client cache. Pulling the token to the client to drive a client-side query cache would also weaken the no-token-in-browser posture.
2. **The portal hand-rolls `lib/*` fetch wrappers with inline types** rather than consuming the generated client — so the portal's request/response types can silently **drift from `specs/backoffice-openapi.yaml`**, sitting outside the contract-drift protection (`pnpm gen` + CI no-drift diff + contract tests) that guards the BFF.

(1) is a deliberate, defensible deviation. (2) is a real risk worth closing.

## Decision

1. **Keep the server-first data layer; do NOT adopt TanStack Query.** Server Components + Server Actions are the data-access mechanism. Rationale: the security posture (no token in the browser) and the framework's own caching make a client query cache redundant. This is an accepted deviation from the named default.
2. **Close the drift exposure: the portal consumes the generated contract types** from `@ofbo/contracts` (the same `api-types.generated.ts` the BFF uses). The `lib/*` wrappers type their request/response shapes against the generated types instead of re-declaring them inline, so a spec change that breaks the portal fails `typecheck`/CI rather than drifting silently.

## Consequences

- **+** No token in the browser; simpler mental model; framework-native caching.
- **+** Portal request/response shapes are bound to the contract — drift becomes a build failure, matching the BFF's protection.
- **−** Two named defaults (TanStack Query, the *generated client*) remain unmet; (1) is intentional, (2) is satisfied at the **types** layer rather than a full generated fetch client (the server-first wrappers stay, now contract-typed).
- Implemented by the portal-contract-types change tracked alongside this ADR.
