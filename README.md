# Open Finance Back Office (OFBO) — Repo Seed

A bank-neutral, build-ready specification for the internal back office a UAE bank needs to operate Open Finance as a regulated business — covering **both roles**: LFI (inbound TPP traffic) and TPP-of-record (outbound TPP-as-a-Service traffic).

## Contents

| File | Purpose |
|---|---|
| `docs/PRD_Open_Finance_Back_Office.md` | Complete PRD: personas, ports model, architecture, all 79 requirements (BACKOFFICE-01..79), data model, NFRs, build sequence (M0–M6), adopting-bank decision checklist (BD-01..16) |
| `specs/backoffice-openapi.yaml` | API contract — 57 paths, 9 tags, admin-scoped. Ground truth for the build |
| `CLAUDE.md` | Build conventions for AI-assisted delivery (Claude Code): stack defaults, API conventions, per-story workflow, hard stops |

## Seeding a new repo

```bash
mkdir of-backoffice && cd of-backoffice && git init
# copy this seed's contents to the repo root, then:
git add -A && git commit -m "Seed: OFBO PRD v1.0, API contract, build conventions"
claude   # start Claude Code at the repo root
```

## Building with Claude Code — gradual steps

Work milestone by milestone (PRD §9), one story per session, one PR per story. **Deploy early:** the demo environment goes live at M1 and auto-deploys on every merge — the demo is the showcase of the gradual build.

1. **Session 1 — canon read-back.** Ask Claude Code to read `CLAUDE.md`, the PRD, and the OpenAPI spec, and summarize scope + conventions. Correct any misreading before code exists.
2. **M0 — foundation.** Monorepo scaffold; CI with gates Q1–Q3; generate the API client from `specs/backoffice-openapi.yaml`; failing contract stubs for all 57 paths; the 10-table relational schema with RLS and the INSERT-only audit policy; port interfaces + simulator stubs; seeded synthetic demo dataset.
3. **M1 — substrate + demo live.** IdP (simulator) federation + admin-scope minting, scope middleware, audit write path + PII redaction, four-eyes primitive, Nebras simulator v1, auto-deploy pipeline. Exit: working demo URL with persona logins and a DEMO banner.
4. **M2 — Customer Care (E2), the first feature.** PSU search → revocations → audit timeline → dispute + four-eyes refund. Demo walkthrough is the acceptance test.
5. **M3–M4 — Reconciliation (E1), then Analytics (E3).** Fault injection in the Nebras simulator makes breaks and liability signals demonstrable on demand.
6. **M5 — hardening.** Should-items, accessibility, SLO surfacing.
7. **M6 — enterprise adoption (per bank).** Swap simulators for enterprise adapters port-by-port; each swap must pass the same contract tests the simulator passed.

## Demo deployment (free / low-cost)

The demo profile (PRD §3.1) runs everything on free tiers with synthetic data only. Default stack — **three services**:

| Service | Covers | Notes |
|---|---|---|
| **Cloudflare** | Portal + BFF (Next.js on Workers via the OpenNext adapter), cron triggers, DNS | Auto-deploy on merge. Cloudflare D1 is SQLite — NOT suitable for our schema (Postgres RLS required); the database lives in Supabase (Hyperdrive optional for pooled connections) |
| **Supabase** | Postgres with RLS (the schema's native requirement) · Auth as the IdP simulator (P2: MFA enabled, one pre-provisioned login per persona) · storage for the integrity-hashed report/Parquet archive | One service replaces separate DB + IdP + object-storage vendors |
| **Railway** | Nebras simulator + reconciliation/analytics scheduled jobs (containers) | No Worker CPU-time limits; jobs are resumable/idempotent; Cloudflare cron can trigger them |

Observability: OTel console exporter (alt: Grafana Cloud free tier) — the APM port (P5) stays simulated.

Rules that keep the demo honest: persistent DEMO banner, deterministic seeded data (repeatable walkthroughs), fault-injection endpoint on the Nebras simulator (trigger a fee-variance break or liability signal live during a demo), and zero real PII — the demo is permanently non-production.

Per-story prompt pattern:

```
Implement BACKOFFICE-<NN> from docs/PRD_Open_Finance_Back_Office.md §7.
1. Read the requirement and the matching paths in specs/backoffice-openapi.yaml; list files you'll touch and your plan.
2. Write the contract + acceptance tests first; show me them failing.
3. Implement to green. CLAUDE.md rules apply. Branch feature/BACKOFFICE-<NN>-<slug>.
```

## Before M1: complete the Bank Profile

PRD §3 (ports P1–P9) and §10 (decisions BD-01..16). BD-01 (IdP) blocks M1; most others have safe defaults the build proceeds on.
