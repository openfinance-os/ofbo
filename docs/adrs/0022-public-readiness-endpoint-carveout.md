# ADR 0022 — Public pre-login `/public/*` carve-out for the Integration Readiness Wizard

- Status: **Accepted** — chosen by the user (2026-06-25): public BFF endpoints (over the
  client-side fallback) and green-lit to build.
- Date: 2026-06-25
- Scope: a **product feature** that introduces a new *auth path* (an unauthenticated route class),
  which CLAUDE.md rule 6 says may be invented only via an ADR a human accepts.
- Relates to: `docs/proposals/integration-readiness-wizard.md`; PRD §3 (ports), §10 (BD-01..16).

## Context

The Integration Readiness Wizard (see the proposal) is a sales-enablement surface: a prospect's
solution architect maps their estate to ports P1–P9, confirms/overrides the 16 adopting-bank
decisions (BD-01..16), and gets a readiness digest + a generated Bank Profile. To do its job —
reach a *cold* prospect who has no account — it must be **public and pre-login**.

Every existing BFF route is admin-scoped and enforced twice (gateway + service layer, defence in
depth). There is **no unauthenticated route today**: a global middleware chain on `*` requires
`x-fapi-interaction-id`, a bearer token (auth), and a scope (RBAC) on every request. A public
endpoint is therefore a genuinely new auth path, not an extension of an existing one — exactly the
kind of platform primitive CLAUDE.md rule 6 forbids inventing silently.

## Decision

Introduce a single, narrowly-scoped **`/public/*` route class** that the auth/scope/FAPI/
justification/agent-spend middlewares skip, governed by these non-negotiable terms:

1. **No PII, ever.** Inputs are bank *system metadata* ("we use Okta"), never PSU data. The
   pii-guard hook and Q4 review apply as everywhere.
2. **Read-mostly, no regulated tables.** The only write is an upsert into a new, non-regulated
   `readiness_profiles` table (named, shareable self-assessments). It is **never**
   `audit_high_sensitivity`, never a regulated record, and carries no consent/payment/PSU data.
3. **No admin scope is reachable.** `/public/*` handlers never call `c.get('principal')`, never
   touch an admin-scoped service, and the dispatcher's service-layer scope check is a no-op for
   them (their `ROUTES` scope is `null`). The carve-out is one-directional: public in, never
   admin-out.
4. **Rate-limited at the edge.** Per the codebase's existing model (Workers forbid long-lived
   state; rate limits are Kong/Cloudflare-enforced via `x-rate-limit-per-min` in the spec), the
   public paths declare conservative limits. Abuse is edge-bounded, not worker-bounded.
5. **Demo profile only.** Not deployed in the enterprise profile — a bank would not expose a
   public marketing endpoint inside its regulated estate. Profile selection is config, never an
   app-code branch (PRD §3.1).
6. **Telemetry still applies.** The telemetry middleware is *not* skipped — public requests are
   spanned like everything else (BACKOFFICE-48).

Mechanically: the auth-class middlewares are wrapped with a `skipPublic` helper that returns
`next()` when `pathname` starts with `/public/`; the FAPI-interaction-id guard early-returns the
same way. Public handlers join the existing `handlers` map and `ROUTES` table (scope `null`), so
they reuse `matchRoute`, the `{data, meta}`/error envelopes, and the dispatcher unchanged.

## Alternatives considered

- **Fully client-side wizard** (catalog + scoring shipped as static data in the portal bundle;
  profiles in a URL hash or public KV). No BFF auth change at all. Rejected as the primary because
  it makes the catalog/scoring non-authoritative and harder to contract-test, and a shared
  persisted profile wants a server store. Retained as the fallback if the carve-out is ever
  judged too risky — the scoring module is pure and portable either way.
- **Post-login under a `readiness:read` scope.** Rejected by the user: it defeats the cold-prospect
  reach that is the whole point.

## Consequences

- A new, auditable boundary in `app.ts`: exactly one route prefix is unauthenticated, by an
  explicit wrapper, easy to review and test ("a non-`/public/` path with no token still 401s; a
  `/public/` path needs no token").
- The hard-stop-reviewer must treat `/public/*` as the *sole* sanctioned unauthenticated prefix;
  any second one needs its own ADR.
- `readiness_profile` is the first non-tenanted Back Office table. It still has RLS enabled and
  forced (CLAUDE.md "RLS from day one"), but with a documented public policy (`USING (true)`)
  because there is no tenant pre-sale — justified by its non-regulated, no-PII, public-by-design
  nature.
- Even so, it is **fully enrolled in the governance registries** like every writable table
  (BACKOFFICE-50/-54): a NOT NULL `classification` column at the lowest available floor
  (`internal-confidential` — "which bank evaluates OFBO on which vendors" is commercially
  sensitive) and a `retention_policy` row (24/60/no-deletion). No table escapes the
  registry-coverage gate; the carve-out is from *auth*, not from *governance*. It is deliberately
  absent from the BCBS 239 lineage scan (`validateLineageCoverage`) — it carries no regulated
  figure whose provenance must be traced.
