# OFBO build log

Append-only journal of autonomous build-loop iterations (`/loop /next-story`).
Each entry: what was built, the evidence, and anything parked for a human decision.

---

## 2026-06-11 — M0-FOUNDATION (PR #2, pre-loop)

- Workspace, `@ofbo/contracts` (57 paths / 61 routes generated), `@ofbo/bff` 501-stub service with red-by-design `[contract-pending]` suite, `@ofbo/ports` P1–P9 (sim + enterprise stubs + shared contract harness), `@ofbo/db` (9 tables + matview, RLS, INSERT-only audit), `@ofbo/synthetic-data`, CI gates Q1–Q3.
- Evidence: 161 unit / 11 integration tests green; CI Q1–Q3 pass on PR #2; PII grep clean.
- Parked: M1-DEMO-DEPLOY (needs BD-14 credentials: Supabase, Cloudflare, Railway) · BACKOFFICE-33 (needs BD-13 governance sign-off) · M6 (per-bank).
- Merged under the loop merge policy: CI Q1–Q3 green + hard-stop-reviewer `VERDICT: PASS` + contract-conformance-reviewer `VERDICT: CONFORMANT`.
- Reviewer-surfaced spec defects → queued as SPEC-FRAUD-REVOKE-FOUREYES (M2, human-approved merge): `:revoke-fraud` lacks x-four-eyes/202 vs binding BD-03 default; `reports:approve` four-eyes-annotated but returns 200; approval ids lack uuid format.
- Branch protection unavailable on this repo plan (private/free) — the loop verifies gates itself before merging.

## 2026-06-11 — BACKOFFICE-47 (PR #3, loop iteration 1)

- Mandatory MFA sign-in via the P2 IdP port on every BFF request; no MFA-skip path; sign-in failures audited with trace id (in-memory sink → DB-backed emitter at BACKOFFICE-45). Admin scopes minted from the §2 persona matrix — verified 1:1 against the spec's 21 securitySchemes scopes; super-admin = marker + union.
- Evidence: 168 unit / 11 integration green; coverage services/bff 97% stmts; CI Q1–Q3 pass; hard-stop-reviewer PASS; contract-conformance-reviewer CONFORMANT. Merged + branch deleted.
- Advisory (no action yet): PRD §2 table says `billing:read` / `finance:reconciliation:*` where the spec (ground truth) annotates `billing:write` / uses bare `reconciliation:read` — PRD doc amendment folded into SPEC-FRAUD-REVOKE-FOUREYES when it runs.
- Next eligible: BACKOFFICE-43 (RBAC scope enforcement, BFF + service layer).

## 2026-06-11 — BACKOFFICE-43 (PR #4, loop iteration 2)

- RBAC scope enforcement at both layers: middleware (403 SCOPE_DENIED + required_scope, audited with persona/attempted scope/reason) and an independent service-layer assertScope guard. Super-admin satisfies any check but stamps the marker. Dynamic '(…)' spec scopes defer to owning stories (watch item: BACKOFFICE-44).
- Evidence: 174 unit / 11 integration green; coverage services/bff 96.7%; CI Q1–Q3 pass; hard-stop PASS; conformance CONFORMANT. Merged + branch deleted.
- Iteration note: user checked out main mid-iteration (inspecting the app) — loop paused itself, resumed on instruction. Demo server entry added as a chore (services/bff/scripts/serve.ts).
- Spec defect surfaced by review: alternative scopes expressed only as YAML comments (# or audit:read ×3) — folded into SPEC-FRAUD-REVOKE-FOUREYES.
- Next eligible: BACKOFFICE-45 (High-class audit write path).
