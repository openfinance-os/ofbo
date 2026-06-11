# M0 — Repo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo scaffold with CI gates Q1–Q3 green on empty implementations: OpenAPI types/client + 57 contract stubs (red-by-design via `it.fails`), 10-table Postgres schema with RLS + INSERT-only audit, deterministic synthetic seed data, and port interfaces P1–P9 with simulator stubs.

**Architecture:** pnpm workspace with four packages (`contracts`, `db`, `ports`, `synthetic-data`) and one service (`bff`). Everything contract-derived is *generated* from `specs/backoffice-openapi.yaml` (DRY — never hand-copy the 57 paths). The BFF is a Hono app with a custom route matcher (OpenAPI `:action` suffixes break framework path syntax) returning the binding 501 error envelope for every path; per-path behavior tests use Vitest `it.fails` so CI is green while every unimplemented path demonstrably fails — flipping a route to implemented breaks `it.fails`, forcing the story to write real assertions.

**Tech Stack (within CLAUDE.md defaults, no ADR needed):** pnpm workspaces · TypeScript strict · Vitest · Hono (BFF HTTP layer, Workers-compatible) · openapi-typescript + openapi-fetch (generated client) · node-postgres + plain SQL migrations · GitHub Actions (Q1 build+unit, Q2 eslint+tsc+semgrep, Q3 integration vs real Postgres).

**Exit criteria mapping (PRD §9 M0):** CI green on empty implementations → Tasks 1–8. Schema applied to free-tier DB → local/CI Postgres in Task 5; **Supabase application is blocked on user-provided credentials (M1)**. Zero real PII → Task 6 conventions + pii-guard hook + tests.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `eslint.config.mjs`, `vitest.workspace.ts`
- Modify: `.gitignore`

- [ ] **Step 1:** Root `package.json`:

```json
{
  "name": "ofbo",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "gen": "pnpm --filter @ofbo/contracts gen",
    "build": "pnpm -r build",
    "lint": "eslint .",
    "typecheck": "tsc -b",
    "test": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "db:apply": "pnpm --filter @ofbo/db apply",
    "db:seed": "pnpm --filter @ofbo/db seed"
  },
  "devDependencies": {
    "@eslint/js": "^9", "eslint": "^9", "typescript": "^5.5", "typescript-eslint": "^8", "vitest": "^2"
  }
}
```

- [ ] **Step 2:** `pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - services/*
```

- [ ] **Step 3:** `tsconfig.base.json` (strict, NodeNext, composite project refs); root `tsconfig.json` referencing all packages. `.nvmrc` = `22`.

- [ ] **Step 4:** `eslint.config.mjs` — typescript-eslint recommended; ignore `**/dist`, `**/*.generated.ts`.

- [ ] **Step 5:** `vitest.workspace.ts` with two projects: `unit` (`**/*.spec.ts`, excludes integration) and `integration` (`**/*.int.spec.ts`).

- [ ] **Step 6:** `.gitignore` += `node_modules/`, `dist/`, `*.tsbuildinfo`, `.env*`.

- [ ] **Step 7:** `pnpm install` → lockfile. Commit: `M0: workspace scaffold (pnpm + tsc strict + vitest + eslint)`.

---

### Task 2: `packages/contracts` — spec loader, route table, generated types/client

**Files:**
- Create: `packages/contracts/package.json`, `src/spec.ts`, `src/match.ts`, `scripts/gen.ts`, `src/api-types.generated.ts` (generated), `src/routes.generated.ts` (generated), `src/index.ts`
- Test: `packages/contracts/test/spec.spec.ts`, `test/match.spec.ts`

- [ ] **Step 1: Failing tests first** — `spec.spec.ts`:

```ts
import { loadSpec, listRoutes } from '../src/spec'
it('contract has exactly 57 paths and 9 tags', () => {
  const spec = loadSpec()
  expect(Object.keys(spec.paths)).toHaveLength(57)
  expect(spec.tags).toHaveLength(9)
})
it('every mutating route requires Idempotency-Key', () => {
  for (const r of listRoutes().filter(r => ['post','put','patch','delete'].includes(r.method)))
    expect(r.parameters, `${r.method} ${r.path}`).toContain('Idempotency-Key')
})
it('every route requires x-fapi-interaction-id', () => {
  for (const r of listRoutes()) expect(r.parameters).toContain('x-fapi-interaction-id')
})
```

`match.spec.ts` (the colon-action gotcha is the point of this module):

```ts
import { matchRoute } from '../src/match'
it('matches plain, parameterised, and colon-action paths', () => {
  expect(matchRoute('get', '/back-office/reconciliation/runs')?.path).toBe('/back-office/reconciliation/runs')
  expect(matchRoute('get', '/back-office/reconciliation/runs/abc-123')?.path).toBe('/back-office/reconciliation/runs/{run_id}')
  expect(matchRoute('post', '/consents/0b0e.../X:revoke-admin')).toBeNull() // param must not swallow ':action'
  expect(matchRoute('post', '/consents/3f8a-uuid:revoke-admin')?.path).toBe('/consents/{consent_id}:revoke-admin')
  expect(matchRoute('post', '/consents:revoke-bulk')?.path).toBe('/consents:revoke-bulk')
  expect(matchRoute('get', '/nope')).toBeNull()
})
```

- [ ] **Step 2:** Run → fail (modules missing).

- [ ] **Step 3:** Implement `spec.ts` (yaml parse of `specs/backoffice-openapi.yaml`, resolve `$ref` parameters to names, expose `listRoutes(): {method,path,tag,scope,fourEyes,parameters[]}[]`) and `match.ts` (compile `{param}` → `([^/:]+)` regex, full-string match, method-aware).

- [ ] **Step 4:** `scripts/gen.ts` — runs `openapi-typescript` → `api-types.generated.ts`; emits `routes.generated.ts` from `listRoutes()` (static array, so the Workers-bound BFF never parses YAML at runtime). `index.ts` exports routes, types, `createApiClient` (openapi-fetch). Wire `"gen"` + `"build"` scripts.

- [ ] **Step 5:** Tests green. Commit: `M0: contracts package — spec loader, route matcher, generated types/routes (57 paths)`.

---

### Task 3: `services/bff` — 57 stub routes, binding envelopes

**Files:**
- Create: `services/bff/package.json`, `src/app.ts`, `src/envelope.ts`
- Test: `services/bff/test/contract-stubs.spec.ts`, `test/envelope.spec.ts`

- [ ] **Step 1: Failing tests first** — `envelope.spec.ts`: every stubbed route returns 501 with the binding error envelope (`error.{code,message,remediation,docs_url}` + `meta.{request_id,timestamp}`); unknown path → 404 envelope; missing `x-fapi-interaction-id` → 400 envelope `BACKOFFICE.MISSING_FAPI_INTERACTION_ID`.

```ts
import { createApp } from '../src/app'
import { ROUTES } from '@ofbo/contracts'
const app = createApp()
const hdrs = { 'x-fapi-interaction-id': '4d2c2e2a-0000-4000-8000-000000000000' }
it.each(ROUTES.map(r => [r.method, r.path]))('%s %s → 501 binding envelope', async (method, path) => {
  const res = await app.request(toConcrete(path), { method: method.toUpperCase(), headers: hdrs })
  expect(res.status).toBe(501)
  const body = await res.json()
  expect(body.error).toMatchObject({ code: 'BACKOFFICE.NOT_IMPLEMENTED' })
  for (const k of ['code','message','remediation','docs_url']) expect(body.error[k]).toBeTruthy()
  expect(body.meta.request_id).toBeTruthy(); expect(body.meta.timestamp).toBeTruthy()
})
```

(`toConcrete` substitutes `{param}` → a fixed UUID.)

`contract-stubs.spec.ts` — **the red-by-design layer**:

```ts
it.fails.each(ROUTES.map(r => [`${r.method} ${r.path}`, r]))('[contract-pending] %s is implemented', async (_n, r) => {
  const res = await app.request(toConcrete(r.path), { method: r.method.toUpperCase(), headers: hdrs })
  expect(res.status).not.toBe(501) // flips when the story implements the route — forcing real tests then
})
```

- [ ] **Step 2:** Run → fail. **Step 3:** Implement `envelope.ts` (errorEnvelope/dataEnvelope helpers, crypto.randomUUID request_id) and `app.ts` (Hono, fapi-header middleware, catch-all using `matchRoute` → 501/404). **Step 4:** green (envelope suite passes; `it.fails` suite green-because-red). **Step 5:** Commit: `M0: BFF stub service — 57 contract-pending routes behind binding envelopes`.

---

### Task 4: `packages/ports` — P1–P9 interfaces, sim + enterprise adapters, port contract harness

**Files:**
- Create: `packages/ports/src/types.ts` (Money, TraceContext), `src/p1-care-surface.ts` … `src/p9-financial-system.ts` (interface + `adapters/<port>/sim` impl + `adapters/<port>/enterprise` stub each), `src/registry.ts` (`getAdapter(port, profile)` — config-driven, **core code never branches on profile**)
- Test: `packages/ports/test/port-contracts.spec.ts`

Interfaces (M0-minimal, one method set each — full code in source, signatures here):

| Port | Interface | M0 methods |
|---|---|---|
| P1 | `CareSurfacePort` | `mintCareToken({agent_id, psu_id})` → `{token, act, sub, expires_at}` (≤15 min) |
| P2 | `IdentityProviderPort` | `verifyToken(t)` → `{subject, persona, mfa: true}` ; `personaLogins()` (sim: 8 demo personas) |
| P3 | `ItsmPort` | `createTicket({type, severity, team, summary})` → `{ticket_id}` |
| P4 | `CoreBankingPort` | `getBalance(account_ref)` → `{balance: Money, as_of}` ; `getTransactions(account_ref, window)` |
| P5 | `ApmPort` | `exportSpans(spans[])` (sim: console/file sink) |
| P6 | `NebrasEgressPort` | `revokeConsent(consent_id, reason)` → `{acknowledged_in_ms}` ; `fetchTppReports(period)` ; `fetchDataset(name, period)` ; `createDisputeCase(payload)` → `{nebras_case_id}` ; `syncDirectory()` → `{participants[]}` |
| P7 | `LineagePort` | `emitLineage({table, columns[], source, trace_id})` |
| P8 | `OnboardingHandoverPort` | `getFunnelEvents(window)` → `{entry_path, stage, at}[]` |
| P9 | `FinancialSystemPort` | `registerCounterparty(org)` → `{financial_system_ref}` ; `issueInvoiceInstructions(run)` ; `getSettlementStatus(ref)` |

- [ ] **Step 1: Failing harness test first** — `describePortContract(port, makeAdapter)` runs shape/behavior assertions **against the interface** (sim revoke acknowledges <5000ms; ITSM returns ticket id; P2 personas include all 8 incl. `platform-super-admin`; …). Suite is parameterised over adapters: sim adapters run; enterprise stubs run the *same* suite under `describe.skip` annotated `M6 port-swap gate — enabled when the enterprise adapter lands`.
- [ ] **Step 2:** fail → **Step 3:** implement interfaces, deterministic in-memory sims, enterprise stubs throwing `EnterpriseAdapterNotImplementedError`. **Step 4:** green. **Step 5:** Commit: `M0: ports P1–P9 — interfaces, sim adapters, enterprise stubs, shared port-contract harness`.

---

### Task 5: `packages/db` — schema, RLS, INSERT-only audit

**Files:**
- Create: `packages/db/migrations/0001_roles.sql`, `0002_tables.sql`, `0003_rls.sql`, `src/apply.ts`, `src/client.ts`
- Test: `packages/db/test/schema.int.spec.ts`

Tables (PRD §5; every table: `bank_id uuid not null`, `channel text not null check (channel in (…5 values…))`, money as paired `*_amount bigint` + `*_currency char(3)` per Money convention): `reconciliation_log`, `reconciliation_break`, `dispute_case`, `audit_high_sensitivity`, `compliance_report`, `risk_signal`, `approval_request`, `query_purpose_registry`, `tpp_counterparty`, plus `consent_admin_event` as a **materialized view** over `audit_high_sensitivity` (PRD: read-only mirror).

RLS (`0003_rls.sql`): `ENABLE` + `FORCE ROW LEVEL SECURITY` on all tables; tenancy policy `USING (bank_id = current_setting('app.bank_id')::uuid)` for role `ofbo_app`; `bank_internal_view` role gets SELECT-only cross-tenant policies (`USING (true)` FOR SELECT — never INSERT/UPDATE/DELETE); `audit_high_sensitivity`: INSERT + SELECT policies only, **no UPDATE/DELETE policy**, plus `REVOKE UPDATE, DELETE ON audit_high_sensitivity FROM PUBLIC, ofbo_app, bank_internal_view`.

- [ ] **Step 1: Failing integration tests first** (`schema.int.spec.ts`, needs `DATABASE_URL`, runs against dockerised Postgres locally / service container in CI):

```ts
it('all 9 tables + 1 matview exist')                       // information_schema
it('audit_high_sensitivity rejects UPDATE as ofbo_app')     // expect /permission denied|policy/
it('audit_high_sensitivity rejects DELETE as ofbo_app')
it('rows are invisible across bank_id for ofbo_app')        // insert bank A, set app.bank_id=B, select → 0
it('bank_internal_view can SELECT across banks but cannot INSERT')
it('apply is idempotent')                                   // run apply twice, no error
```

- [ ] **Step 2:** fail → **Step 3:** write full DDL + `apply.ts` (migration runner: `_migrations` table, transactional, ordered). **Step 4:** `docker run -d -p 5432 postgres:16` → green. **Step 5:** Commit: `M0: relational schema — 10 regulated tables, RLS tenancy, INSERT-only audit`.

---

### Task 6: `packages/synthetic-data` — deterministic, PII-safe seed

**Files:**
- Create: `packages/synthetic-data/src/rng.ts` (mulberry32), `src/generators.ts`, `src/seed.ts` (inserts demo dataset via `@ofbo/db`)
- Test: `packages/synthetic-data/test/generators.spec.ts`

Conventions (enforced by the repo pii-guard hook AND asserted in tests): Emirates IDs `999-YYYY-NNNNNNN-N` (never 784), IBANs `AE` + 2 check digits + `000` + 16 digits, names from a fictional-only list, fixed default seed `20260611`.

- [ ] **Step 1: Failing tests first:** determinism (same seed → byte-identical dataset), PII-shape compliance (regex: no `784…` ids, all IBANs match `^AE\d{2}000\d{16}$`), volume (≥5 PSUs, ≥3 consents each, ≥1 month of billing lines, all 5 channels represented, 8 persona logins).
- [ ] **Step 2:** fail → **Step 3:** implement → **Step 4:** green → **Step 5:** Commit: `M0: deterministic synthetic demo dataset (PII-safe by construction)`.

---

### Task 7: CI — gates Q1–Q3

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1:** Workflow `ci` on push/PR: job **q1-build-unit** (pnpm install → `pnpm gen` → `pnpm build` → `pnpm test`), job **q2-static-sast** (`pnpm lint`, `pnpm typecheck`, semgrep container scan `p/typescript --error`), job **q3-integration-contract** (Postgres 16 service container → `pnpm db:apply` + `pnpm db:seed` → `pnpm test:integration`). All three required; any failure blocks merge.
- [ ] **Step 2:** Commit: `M0: CI quality gates Q1–Q3`. Push branch; verify all three jobs green on the PR.

---

### Task 8: Verification + PR

- [ ] Full local run from clean: `pnpm install && pnpm gen && pnpm build && pnpm lint && pnpm typecheck && pnpm test` + dockerised `pnpm db:apply && pnpm db:seed && pnpm test:integration` — all green, with the 57 `[contract-pending]` tests visibly red-by-design inside a green suite.
- [ ] Grep the diff for PII shapes (pii-guard also ran on every write).
- [ ] PR `M0: repo foundation` citing PRD §9 M0 exit criteria, noting the one blocked item: **applying the schema to the Supabase free-tier instance needs user credentials (lands with M1 demo deployment)**.

## Self-review
- Spec coverage: scaffold ✓(T1) · CI Q1–Q3 ✓(T7) · client gen ✓(T2) · 57 failing stubs ✓(T2/T3) · schema+RLS+audit ✓(T5) · synthetic+seeded ✓(T6) · port interfaces+sim stubs ✓(T4) · zero PII ✓(T6+hook).
- Type consistency: `ROUTES`/`matchRoute`/`createApp`/`describePortContract` names used consistently across tasks.
- Known judgment calls recorded: Hono + custom matcher (colon-action paths), `it.fails` as the red-by-design mechanism, `consent_admin_event` as matview, Supabase apply deferred to M1 (credentials).
