# ADR 0003 — Cloudflare Workers + OpenNext hosting (demo profile)

- **Status:** Accepted
- **Date:** 2026-06-20
- **Context tags:** deployment, demo-profile, stack
- **Supersedes / relates to:** CLAUDE.md "Stack (defaults — change only via an ADR)"; PRD §3.1 (demo profile must be free-tier-friendly, serverless/sleep-tolerant, with resumable + idempotent scheduled jobs).

## Context

CLAUDE.md fixes the stack *defaults* (React/Next.js, Node/TypeScript services, PostgreSQL, Terraform IaC) but does not name a **hosting/runtime** for the demo profile, and states that stack choices change only via an ADR. The demo profile must be free-tier-friendly, serverless, sleep-tolerant, and its scheduled jobs (reconciliation, analytics, risk monitors) must be resumable and idempotent (PRD §3.1).

This ADR records the hosting decision that the codebase already embodies, so the convention and the code agree.

## Decision

Host **both** demo-profile services on **Cloudflare Workers**:

- **BFF** — Hono app on a Worker (`services/bff`, `wrangler.toml`). Headless work runs in the Worker `scheduled()` (cron) handler, not via public ingress; runs are idempotent (date-derived `run_id`, `ON CONFLICT` no-ops).
- **Portal** — Next.js 15 (App Router) built for Workers via **OpenNext** (`apps/portal`, `open-next.config.ts`, `cf:build`).
- Durable state stays in PostgreSQL (Supabase in demo) reached over the IPv4 session pooler; nothing regulated lives in the Worker.

Hosting is a **demo-profile** choice. It is not application-core behaviour: per the ports/profiles model, an adopting bank runs the same application core on its own infrastructure (the enterprise profile), selected by configuration — no code branches on the runtime.

## Consequences

- **+** Free-tier-friendly, serverless, sleep-tolerant, globally cheap to run for a permanently-on demo; cron triggers fit the headless-job model directly.
- **+** Auto-deploy on merge to `main` with a post-deploy smoke against the live demo (matches the M1 build-order requirement).
- **−** Workers runtime constraints (no long-lived processes; size/CPU limits) — mitigated by keeping jobs idempotent + resumable and all heavy state in Postgres.
- **Enterprise profile:** hosting is re-selected at bank adoption (the bank's own platform). This ADR governs the demo only; the M6 port-swap work does not inherit Workers.
