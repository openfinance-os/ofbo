# OFBO Development Guide

How to extend the Open Finance Back Office without re-deriving the conventions each
time. `CLAUDE.md` is the binding source of truth (build conventions + regulatory hard
stops) and the PRD/OpenAPI spec are canon; this is the practical "where do I put it"
companion. When this guide and `CLAUDE.md` disagree, `CLAUDE.md` wins.

## Layout

```
specs/backoffice-openapi.yaml   # the contract — ground truth for behaviour + data
packages/contracts              # OpenAPI codegen (api-types + routes, checked in)
packages/ports                  # port interfaces + sim/enterprise adapters
packages/db                     # migrations, Pg stores, RLS, lineage, retention
packages/redaction              # the single PII-masking path
packages/synthetic-data         # deterministic, PII-safe demo dataset
packages/release-evidence       # sealed per-release control/gate evidence bundle
services/bff                    # the API (Hono) — routes → services → stores
services/nebras-sim             # the API Hub simulator (faults injectable)
apps/portal                     # Next.js portal (token-only UI, OpenAPI-bound)
```

Per-story workflow, milestone order, and the worktree-isolation rule live in
`CLAUDE.md` (§Workflow). The short version: one story per branch, spec-first
(contract tests fail before code), implement to green, coverage ≥80%, every commit
cites the BACKOFFICE-ID.

## Run it locally

`/run-ofbo` (or the skill of that name) builds and drives the demo stack: the BFF on
:8787 and the Nebras simulator on :8788. Integration tests need a real Postgres
(`DATABASE_URL`); `pnpm db:apply && pnpm db:seed` against it. Quick gates:

```
pnpm build         # compiles every workspace (Q1 also runs this)
pnpm typecheck     # tsc --noEmit across 9 projects
pnpm lint          # eslint .
pnpm test          # unit project
pnpm test:integration   # needs DATABASE_URL (real Pg)
```

## Add a BFF endpoint

The contract is ground truth, so go spec-first:

1. **Spec.** Add the path to `specs/backoffice-openapi.yaml` (kebab-case path,
   snake_case fields, `x-required-scope`). If the spec is wrong, change the spec via
   PR first (see the `/spec-change` skill) — then tests, then code.
2. **Generate.** `pnpm gen` regenerates `packages/contracts/src/*.generated.ts`
   (checked in; Q1 fails if you forget — `git diff --exit-code`).
3. **Contract test first.** It must exist and fail before implementation.
4. **Implement** under `services/bff/src/<feature>/`: a `routes.ts` (HTTP) over a
   `service.ts` (business logic) over a store/port. Reuse the shared primitives —
   do **not** re-roll them:
   - **Envelopes:** `dataEnvelope` / `errorEnvelope` from `envelope.js`.
   - **Errors:** in `fail(c, e)` use `scopeDenied(c, e)` (the universal
     `ScopeDeniedError → 403`) then `domainError(c, e, remediation)` from `errors.js`.
   - **Pagination:** `limitParam(c.req.query('limit'))` from `pagination.js`
     (cursor-based only; never `Number(...)` a limit by hand).
   - **Idempotency:** wrap mutating routes with `replayable(store, buildKey, handler)`;
     if the dedup key depends on the parsed body, validate first then
     `replayCached(c, store, cacheKey, produce)` (both in `idempotency.js`). Missing
     key → `missingIdempotencyKey()`.
   - **Four-eyes:** gated operations return `202` + `approval_request` via the
     approvals service — never execute inline.
5. **Scope** is enforced twice (defence in depth): BFF middleware + a `service`
   `assertScope`. Stay inside the PRD §2 persona matrix — granting beyond it is an
   automatic review FAIL.
6. **Audit + lineage** are Definition-of-Done, not retrofit: emit audit-relevant ops
   to `audit_high_sensitivity` (INSERT-only, PII redacted at emission, trace id
   propagated) and emit lineage at write time so Q4.5 passes.

## Add a database table / store

1. **Migration** `packages/db/migrations/00NN_<name>.sql` (sequential). Follow the
   `0003_rls.sql` pattern: `ENABLE` + `FORCE ROW LEVEL SECURITY`, tenancy
   SELECT/INSERT(/UPDATE) policies for `ofbo_app`, cross-bank SELECT for
   `bank_internal_view`. **Grant `ofbo_app` only `SELECT, INSERT, UPDATE` — never
   `DELETE`** on regulated records (the no-deletion hard-stop; the
   `retention-no-delete` integration test enforces it). `idempotency_key` is the only
   sanctioned deletion path.
2. **Classification + retention:** add the table to `classification_policy` and
   `retention_policy` and give it a `classification` column (BACKOFFICE-54/-50).
3. **Store** in `packages/db/src/`: a `Pg<Name>Store` matching the structural
   interface the BFF service expects, emitting lineage on the write path.
4. **Tests:** integration (`*.int.spec.ts`, real Pg — use `SET LOCAL ROLE ofbo_app`
   to test as the restricted role). The unit project excludes `*.int.spec.ts`.

## Add a port (institution integration)

Ports keep the bank's systems swappable (PRD §3). Never hardcode a vendor.

1. **Interface** in `packages/ports/src` (the port map). Code against this interface
   everywhere; selection is config.
2. **Two adapters** behind it: `adapters/<port>/sim/` (demo) and
   `adapters/<port>/enterprise/` (stub initially, written at bank adoption, M6).
   `getAdapter(port, profile)` is the **only** place profile is read — application
   core never branches on `DEPLOY_PROFILE` (an ESLint rule enforces this).
3. **Contract tests** run against the port *interface*, so both adapters must pass
   the same suite — that is the port-swap acceptance gate.
4. All Nebras-bound traffic goes through P6 egress — no direct egress, ever.

## Add / change a quality gate

Gates live in `.github/workflows/ci.yml` (Q1 build+unit, Q2 static+SAST, Q3
integration+contract+E2E, Q4 security+deps, Q4.5 BCBS 239 lineage; Q5 is manual at
release time). A failed gate blocks merge. If you add a gate, map it in
`packages/release-evidence` so the sealed bundle records it. `deploy.yml` and
`release-evidence.yml` set `concurrency`; `ci.yml` cancels superseded runs per ref.

## Portal screens

Every screen is built against the **Stitch** reference (layout + tokens) and bound to
the OpenAPI client (behaviour + data): token-only (no raw hex/px), DEMO-bannered,
persona scope-gated via `lib/scopes.ts` (the single source of truth for the §2
matrix — never inline a scope string), zero PII in browser storage, four-eyes via
`202` + `approval_request` (never inline). Cite the Stitch screen id in the PR.

## Hard stops (never negotiable — see CLAUDE.md)

No PII in browser storage, logs, fixtures, test names, or telemetry (synthetic data
only). INSERT-only audit; no deletion path for regulated records. FAPI 2.0 posture
(mTLS/PAR/PKCE) untouched. UAE data residency (region is an IaC parameter). The Back
Office never bypasses PSU consent. No new platform primitives — compose; if something
seems genuinely uncovered, raise an ADR in `docs/adrs/` and stop.
