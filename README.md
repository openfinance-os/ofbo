# Open Finance Back Office (OFBO)

A bank-neutral back office for the internal operations a UAE bank needs to run Open Finance as a regulated business — covering **both roles**: LFI (inbound TPP traffic) and TPP-of-record (outbound TPP-as-a-Service traffic). Built against the CBUAE / Al Tareq / Nebras scheme.

> **Status:** M0–M5 delivered and demonstrable on the live demo. Milestones M0 (foundation) → M1 (substrate + demo live) → M2 (Customer Care) → M3 (Reconciliation) → M4 (Analytics) → M5 (hardening) are complete, including the full portal UI/UX-fidelity track (dark-navy institutional shell, real OFBO brand mark, demo-framed persona switch). **M6 (per-bank enterprise port-swaps) is the remaining milestone.** 127 of the 135 backlog items are done; the rest are human-gated decisions (ADRs / governance) or per-bank adoption work. The latest feature in flight is governed cross-fintech aggregation (BACKOFFICE-33 / ADR 0015 / BD-13).

## Live demo

Auto-deploys on every merge to `main` (`.github/workflows/deploy.yml`): BFF → Cloudflare, portal → Cloudflare (OpenNext), simulator → Railway, then the smoke acceptance suite runs against the live URLs — a broken demo fails the pipeline.

| Surface | URL |
|---|---|
| Portal (Cloudflare Workers / OpenNext) | https://ofbo-portal.michartmann.workers.dev |
| BFF (Cloudflare Worker) | https://ofbo-bff.michartmann.workers.dev |
| Nebras simulator (Railway) | https://nebras-sim-production.up.railway.app |

The demo profile (PRD §3.1) runs on free tiers with **synthetic data only** — persistent DEMO banner, deterministic seeded data, a fault-injection endpoint on the Nebras simulator (trigger a fee-variance break or liability signal live during a demo), and zero real PII. The demo is permanently non-production.

## Canon (ground truth)

| File | Purpose |
|---|---|
| `docs/PRD_Open_Finance_Back_Office.md` | Complete PRD: personas, ports model, architecture, all 80 requirements (BACKOFFICE-01..80), data model, NFRs, build sequence (M0–M6), adopting-bank decision checklist (BD-01..16) |
| `specs/backoffice-openapi.yaml` | API contract — **76 paths, 10 tags**, admin-scoped. The contract is ground truth: if the spec is wrong, change it via PR first, then tests, then code |
| `CLAUDE.md` | Build conventions: stack defaults, ports model, API conventions, per-story workflow, regulatory hard stops |
| `docs/architecture-overview.md` | Component architecture — system context, ports P1–P9, BFF feature modules, data layer, shared packages (+ `docs/diagrams/` SVGs) |
| `docs/backlog.yaml` | Machine-readable work queue (drives the autonomous build loop) |

## Architecture at a glance

pnpm monorepo. The Next.js **portal** (dark-navy institutional shell, persona scope-gated, DEMO-bannered) calls the **BFF** (Hono) over an OpenAPI-generated client; the BFF reaches every external system through **port interfaces (P1–P9)** — each with a `sim` adapter (demo) and an `enterprise` adapter (M6) selected by config, never by branching in app code. Headless scheduled jobs (reconciliation engine, liability/cert/cadence monitors) run with no public ingress. Data lives in **Postgres with row-level security from day one**, INSERT-only audit, and BCBS 239 lineage emitted at write time. Cross-fintech aggregate reads run through a **governed path** (the `bank_internal_view` role gated by a four-eyes `query_purpose_registry` — ADR 0015 / BD-13), never the single-tenant app role. See `docs/architecture-overview.md` for the full map.

```
apps/portal        Next.js portal (Stitch design system, persona scope-gated)
services/bff       Hono BFF — feature modules (E1/E2/E3) + headless worker
services/nebras-sim  Nebras API Hub simulator (+ fault injection)
packages/ports     P1–P9 port interfaces, registry, sim adapters
packages/db        Postgres stores, audit, lineage, retention, RLS (migrations 0001–0026)
packages/contracts OpenAPI-generated types + routes
packages/{redaction,synthetic-data,release-evidence}
```

## Run locally

```bash
pnpm install
pnpm gen                 # generate the OpenAPI client/types
pnpm test                # unit suite
pnpm test:integration    # integration suite (needs DATABASE_URL → a Postgres with the schema)
```

Driving the demo stack locally (BFF on :8787, Nebras sim on :8788) is covered by the `run-ofbo` workflow. Profile selection is config: `DEPLOY_PROFILE=demo|enterprise`.

## CI / quality gates

`.github/workflows/ci.yml` runs on every push/PR — a failed gate blocks merge:

| Gate | Checks |
|---|---|
| Q1 | build + unit + generated-artifact drift |
| Q2 | static analysis + SAST (lint, typecheck, semgrep) |
| Q3 | integration + contract tests, portal E2E (Playwright) |
| Q4 | security review + dependency scan |
| Q4.5 | BCBS 239 lineage validation (P7) |
| Q5 | manual prod approval — evidenced at release time via the release-evidence bundle |

## Build conventions

Work milestone by milestone (PRD §9), **one story per branch/PR**, each citing its `BACKOFFICE-NN`. Spec-first: contract + acceptance tests exist and fail before implementation; implement to green (coverage ≥80%). Compose, don't invent — no new platform primitives; genuinely-uncovered gaps raise an ADR (`docs/adrs/`) and stop for a human decision. Full rules in `CLAUDE.md`.

Per-story prompt pattern:

```
Implement BACKOFFICE-<NN> from docs/PRD_Open_Finance_Back_Office.md §7.
1. Read the requirement and the matching paths in specs/backoffice-openapi.yaml; list files you'll touch and your plan.
2. Write the contract + acceptance tests first; show me them failing.
3. Implement to green. CLAUDE.md rules apply. Branch feature/BACKOFFICE-<NN>-<slug>.
```

## Adopting bank: the path to production

M6 swaps each simulator for an enterprise adapter, port-by-port (P1–P9) — each swap must pass exactly the contract tests the simulator passed (the port-swap acceptance gate). Before M6, complete the Bank Profile: PRD §3 (ports) and §10 (decisions BD-01..16). UAE data residency, FAPI 2.0 posture (mTLS/PAR/PKCE via the egress gateway P6), and the retention/audit rules are non-negotiable hard stops.
