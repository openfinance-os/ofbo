---
name: run-ofbo
description: Build, run, and drive the OFBO demo-profile services locally — the BFF (port 8787) and the Nebras simulator (port 8788). Use when asked to run or start the app, smoke-test it, hit its API, inject simulator faults, or confirm a change works in the running services.
---

OFBO is two locally runnable HTTP services (no frontend yet — the portal lands with M1-PORTAL-SHELL): the **BFF** (Hono, all 57 contract paths, auth + scope middleware) and the **Nebras simulator** (deterministic synthetic UAE OF data with injectable faults). Drive both via `.claude/skills/run-ofbo/smoke.sh`, which launches them, runs 9 verified checks, and reports PASS/FAIL.

All paths are relative to the repo root.

## Prerequisites

Node ≥22 and pnpm 9 (`packageManager` pin). Deps installed via:

```bash
pnpm install
```

Optional but recommended: a repo-root `.env` (exists in this checkout, never committed) with `DATABASE_URL` (Supabase — must be the IPv4 session pooler host, not the direct host) and `SIM_ADMIN_TOKEN`. With `DATABASE_URL` the BFF runs exactly like the deployed worker (durable Postgres audit/approvals/idempotency); without it, stores are in-memory and the sim's admin endpoint is unguarded — everything still runs.

## Run (agent path)

```bash
.claude/skills/run-ofbo/smoke.sh          # launch both, run checks, shut down
.claude/skills/run-ofbo/smoke.sh --keep   # launch both, run checks, LEAVE RUNNING
```

Expect `RESULT: all checks passed` and 9 `PASS` lines. Server logs land in `$TMPDIR/ofbo-run/{bff,sim}.log`. Stop a `--keep` run with `lsof -ti :8787 -ti :8788 | xargs kill`.

To hit the running BFF yourself, every request needs **two** headers:

```bash
curl http://localhost:8787/approvals/pending \
  -H "x-fapi-interaction-id: $(uuidgen)" \
  -H "Authorization: Bearer demo-token:customer-care-agent"
```

Demo tokens are `demo-token:<persona>`; personas: `operations-analyst`, `customer-care-agent`, `compliance-officer`, `finance-analyst`, `risk-analyst`, `commercial-desk-head`, `programme-manager`, `platform-super-admin`. Implemented routes are listed in `IMPLEMENTED_ROUTES` in `services/bff/src/app.ts` (the approvals suite); every other contract path returns the binding 501 envelope.

Simulator fault injection (admin-guarded when `SIM_ADMIN_TOKEN` is set):

```bash
source .env
curl -X POST http://localhost:8788/admin/faults -H "x-admin-token: $SIM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fault":"fee_variance","period":"2026-05","variance_minor_units":999}'
curl http://localhost:8788/tpp-reports/2026-05          # one line's fee is now +999
curl -X DELETE http://localhost:8788/admin/faults -H "x-admin-token: $SIM_ADMIN_TOKEN"
```

Fault types: `revoke_delay` (`delay_ms`), `fee_variance` (`period`, `variance_minor_units`), `consent_drift` (`consent_id`).

## Run (human path)

Start servers individually (the smoke script does this for you):

```bash
cd services/nebras-sim && PORT=8788 ADMIN_TOKEN=$SIM_ADMIN_TOKEN pnpm exec tsx scripts/serve.ts
cd services/bff && PORT=8787 pnpm exec tsx scripts/serve.ts   # reads DATABASE_URL from env
```

Note the BFF has **no `start`/`dev` script** in its package.json — `pnpm exec tsx scripts/serve.ts` is the local entry point (`wrangler deploy` is for the deployed worker only).

## Test

```bash
pnpm test               # unit (208 passing at time of writing, ~1s)
pnpm test:integration   # needs DATABASE_URL (real Postgres)
pnpm test:smoke         # acceptance suite against the LIVE demo URLs, not localhost
```

## Verify contract conformance (agent self-correction loop)

When implementing or changing an endpoint, run this each iteration to catch live response
drift from the OpenAPI **before** you open a PR — don't wait for CI or the contract-conformance
reviewer to bounce it. It validates real BFF responses against `specs/backoffice-openapi.yaml`
(spec is ground truth), auto-probing every implemented parameter-less GET plus the 400/401
error envelopes. Deterministic CONFORMANT/DRIFT, exit 0/1 (exit 2 = BFF down).

```bash
.claude/skills/run-ofbo/smoke.sh --keep   # bring the stack up and leave it running
pnpm verify:contract                       # validate localhost:8787 against the spec
pnpm verify:contract --against-demo        # validate the deployed demo BFF instead
```

`smoke.sh` already runs this as its final check. If you see `✗ DRIFT`, fix the implementation
to match the contract; if the *spec* is the defect, stop and use the spec-change skill first.

## Gotchas

- **Every BFF request needs `x-fapi-interaction-id`** (any UUID) or you get 400 before auth even runs — easy to mistake for a routing problem.
- **Auth is `Bearer demo-token:<persona>`** — the sim IdP adapter (`packages/ports/src/adapters/sim.ts`) just strips the `demo-token:` prefix and checks the persona. Real JWTs don't work in demo profile.
- **Fault-injection body key is `fault`, not `type`** — sending `{"type": ...}` gets the misleading error `fault must be one of: revoke_delay, fee_variance, consent_drift` even when your value is one of those.
- **`POST /approvals` returns 400 `BACKOFFICE.UNKNOWN_OPERATION` for every operation_type** — expected: no story has registered a four-eyes-gated operation yet (`deps.operations` defaults to `{}` in `services/bff/scripts/serve.ts`). Not a bug.
- **Sim `GET /` is 404** — there's no root/health route; probe readiness with `/tpp-reports/<period>`.
- **BFF routes use a colon-action-safe matcher, not Hono path syntax** — paths like `/approvals/{id}:approve` resolve through `matchRoute` from `@ofbo/contracts`; grepping for `app.get(...)` finds nothing.

## Troubleshooting

- **`FATAL: port 8787/8788 already in use`**: a previous `--keep` run is still up. `lsof -ti :8787 -ti :8788 | xargs kill`.
- **BFF says `stores: in-memory` but you expected Postgres**: `DATABASE_URL` wasn't in the environment — the script sources repo-root `.env`; if running serve.ts by hand, `set -a; source .env; set +a` first.
- **Connection errors to Supabase**: you're on the direct DB host. Use the IPv4 session-pooler connection string (the one already in `.env`).
