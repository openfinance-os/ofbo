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

## 2026-06-11 — BACKOFFICE-45 (PR #5, loop iteration 3)

- DB-backed High-class audit emitter: runs as ofbo_app in tenancy-scoped transactions (RLS + INSERT-only bind the emitter; proved by denial test), PII redacted at emission (separator/case/dot-tolerant; 100% line coverage), BFF sink swap via structural typing, dev-server wiring on DATABASE_URL.
- Evidence: 179 unit / 14 integration green ×2; CI Q1–Q3 pass; hard-stop PASS; conformance CONFORMANT.
- Review findings fixed in-branch: removed dangerousRawQuery escape hatch from the production emitter; widened redactor to dot-separated IDs + lowercase IBANs (reviewer found the gap empirically).
- Iteration lesson recorded: INSERT-only tables make test cleanup impossible BY DESIGN → audit tests must use unique per-run trace ids (a fixed trace id failed on re-run; fixed before merge — the premature "green" commit message was corrected by a follow-up commit with 2× consecutive green runs).
- Numeric-identifier redaction noted as a BACKOFFICE-51 consideration (redactor inspects strings only).
- Next eligible: BACKOFFICE-51 (shared PII redaction library).

## 2026-06-11 — BACKOFFICE-51 (PR #6, loop iteration 4)

- @ofbo/redaction extracted as the shared masking path (audit, logs, telemetry); numeric 15-digit Emirates-shaped values now redact; redactText helper added for log emission; db rewired + re-exports.
- Evidence: 180 unit / 14 integration green; redaction 100% coverage; CI Q1–Q3 pass.
- Review cycle worked as designed: hard-stop FAIL (real-shaped grouped-IBAN literal carried over in fixture source) → fixed (runtime-assembled), tree swept, scoped re-review PASS. Conformance CONFORMANT.
- ACTION FOR THE USER (repeat): the PII-guard hook is still not loaded in the interactive session — run /hooks once or restart; review caught what the hook should have.
- Next eligible: BACKOFFICE-44 (four-eyes approval primitive).

## 2026-06-11 — BACKOFFICE-44 (PR #7, loop iteration 5)

- Four-eyes primitive live: gated-operation registry (never inline), 2-business-hour expiry (weekends paused), initiator≠approver at the service incl. super-admin, full lifecycle audited. First 5 real contract routes (/approvals family) — the contract-pending it.fails flip exercised for the first time via IMPLEMENTED_ROUTES.
- Review cycle (heaviest yet, all fixed in-branch): FAIL(2)/DRIFT(4) — unprotected GET /approvals/{id}, unenforced '(initiator scope)', missing Idempotency-Key handling, ignored cursor/limit, unaudited timed_out transition, silent unregistered-op approve. Scoped re-review then caught one missing test (409 OPERATION_UNREGISTERED) — added. Final: all findings ✓.
- Evidence: 187 unit / 14 integration green; approvals+idempotency 95.4% coverage; CI Q1–Q3 pass.
- Known follow-ups noted by review (non-blocking): idempotency cache should fingerprint the request body (conflict vs replay) and needs a durable store for sleep-tolerant hosting — both land with M1-DEMO-DEPLOY.
- Next eligible: BACKOFFICE-80 (super-admin guardrails; deps 43+44 now done).

## 2026-06-12 — BACKOFFICE-80 (PRs #8 + #9, loop iteration 6 — PARKED awaiting human)

- Guardrails implemented and fully gated: session auto-raise (1 ITSM ticket + 1 Risk signal per session, hashed token key), ≥20-char justification on super-admin mutations (High-class audited), service-account rejection at sign-in, superadmin_marker as a first-class audit column + monthly Compliance review view (security_invoker), PgRiskSignalEmitter.
- Evidence: 193 unit / 17 integration green; superadmin module 100% lines; hard-stop PASS (3 advisories, all fixed in-branch).
- Conformance DRIFT (correctly): x-superadmin-justification is client-observable but was absent from the contract → spec PR #9 opened per contract-first (27 mutating ops gain the optional param; AuditEvent.superadmin_marker added; artifacts regenerated). HUMAN DECISION: approve/merge PR #9, then PR #8 merges.
- Iteration interrupted overnight by the monthly spend limit; resumed cleanly from the committed branch.
- Loop continues with the next eligible item: BACKOFFICE-48 (OTel emission).

## 2026-06-12 — BACKOFFICE-48 (PR #10, loop iteration 7)

- OTel emission via the P5 bridge: one span per request, trace_id = x-fapi-interaction-id verbatim (NFR-26), route TEMPLATES only (zero identifiers in telemetry), UNMATCHED collapse for bounded cardinality, redactText over the client-controlled header value, redactingLog with key+shape masking. OtelSpan now a rich P5 port type; port suite binds both adapters.
- Evidence: 193 unit / 14 integration green; CI Q1–Q3 pass; hard-stop PASS, conformance CONFORMANT; both advisories fixed in-branch pre-PR.
- Next eligible: BACKOFFICE-49 (BCBS 239 lineage emission via P7).

## 2026-06-12 — BACKOFFICE-49 (PR #11, loop iteration 8)

- Lineage at write time via the P7 demo adapter: lineage_events (evidence-grade, INSERT-only), PgLineageEmitter wired into the audit emitter, best-effort isolation tested, Q4.5 validateLineageCoverage names real gaps (pinned: tpp_counterparty seed gap).
- Story rescoped mid-flight to main's reality: the risk-signal emitter lives in the parked BACKOFFICE-80 branch, so its lineage wiring is queued as M1-LINEAGE-RISK-SIGNAL (deps 49+80) instead of silently stacking on an unmerged branch.
- Evidence: 193 unit / 17 integration green; CI Q1–Q3 pass; hard-stop PASS; conformance CONFORMANT.
- Next eligible: BACKOFFICE-50 (retention lifecycle).

## 2026-06-12 — BACKOFFICE-50 (PR #12, loop iteration 9)

- Retention lifecycle: retention_policy (24/60 months, deletion_allowed=false by CHECK, read-only), withDenialLogging (denied mutations → High-class audit, unconditional rethrow), retentionStatus for the Compliance View. Identifier guard added per review.
- Evidence: 193 unit / 21 integration green; CI Q1–Q3 pass; hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-54 (data-classification metadata).

## 2026-06-12 — BACKOFFICE-54 (PR #13, loop iteration 10)

- Classification on every record: ofbo_classification domain (PRD §7.4 vocabulary), NOT NULL columns across all 10 tables (audit defaults restricted), read-only classification_policy floors, validateClassificationFloors as the Compliance-review trigger source.
- Evidence: 193 unit / 26 integration green; CI Q1–Q3 pass; hard-stop PASS, conformance CONFORMANT.
- Iteration interrupted twice by the monthly spend limit (reviewers); resumed on user instruction after a workflow-orchestration discussion (decision: stay serial through M1; revisit bounded fan-out at M4).
- Spec note for BACKOFFICE-35: ComplianceReport schema lacks the classification field the PRD lists — spec-change when the report endpoints land.
- Next eligible: M1-NEBRAS-SIM (Nebras simulator v1 service).

## 2026-06-12 — M1-NEBRAS-SIM (PR #14, loop iteration 11)

- Nebras simulator v1 live: consent revoke ack <5s, deterministic per-period TPP reports/datasets, fault injection (revoke_delay → visible SLA breach; fee_variance → exactly one perturbed line for M3 to find; consent_drift → mirror disagreement), resettable for repeatable demos.
- Evidence: 203 unit / 26 integration green; CI Q1–Q3 pass; hard-stop PASS, conformance CONFORMANT; both review nits fixed in-branch.
- Deployment note: /admin/faults must stay off public ingress at M1-DEMO-DEPLOY. Dispute surface (v2) needed before M3.
- Next eligible: M1-PORTAL-SHELL (deps 47/43/45 all done).

## 2026-06-12 — M1-DEMO-DEPLOY (PRs #15 + #16, loop iteration 12)

- **Demo is live and auto-deploys on merge** (BD-14 credentials provided by the user this session): BFF at https://ofbo-bff.michartmann.workers.dev (Cloudflare Worker, nodejs_compat, pg over cloudflare:sockets; DATABASE_URL as worker secret), Nebras simulator at https://nebras-sim-production.up.railway.app (Railway container, repo-root Dockerfile). deploy.yml: merge → wrangler deploy + railway up → smoke acceptance suite against the LIVE URLs (a broken demo fails the pipeline).
- Conformance round 1 caught real drift: per-request createApp on Workers destroyed the Idempotency-Key 24h window and made approvals unretrievable. Fix: contract state moved to Postgres — PgApprovalStore + PgIdempotencyStore (migration 0009: approval_request.execution_result, idempotency_key table; RLS-forced, classification row; its 24h prune is the schema's ONE deletion path — operational cache, deliberately outside retention_policy; cleared by hard-stop delta re-review). Migration 0008: GRANT ofbo_app TO the connection user (managed Postgres ≠ superuser; SET LOCAL ROLE needs membership — found live on Supabase, not locally/CI).
- PR #16 closed the parked M1-NEBRAS-SIM note PR #15 missed: /admin/faults was publicly reachable. createNebrasSim({ adminToken }) → x-admin-token guard on /admin/* (401 at the live URL asserted by smoke); token in Railway var + GH secret only.
- Evidence: 208 unit / 34 integration green; smoke 9 (8 run + 1 token-gated) against production incl. High-class audit persisted to Supabase verified by trace id; CI Q1–Q3 pass on both PRs; first two auto-deploy runs green. Reviewers: hard-stop PASS ×3 (incl. DELETE-path delta), conformance NONCONFORMANT → CONFORMANT (#15), CONFORMANT (#16).
- Parked: worker fail-fast when DATABASE_URL is unset in the demo profile (reviewer observation — M5 hardening candidate). The `jobs` Railway service is provisioned but empty until M3. Supabase region is ap-northeast-2 (demo only; residency is an IaC parameter for regulated profiles).
- Next eligible: M1-PORTAL-SHELL (deps 47/43/45 all done) — joins the deploy and completes the M1 exit criteria (DEMO banner, login screen, audit visible).

## 2026-06-13 — M1-LINEAGE-RISK-SIGNAL (PR #17, loop iteration 13)

- Closes the lineage gap the parked BACKOFFICE-80 branch left: the `risk_signal` write path now emits column-level BCBS 239 lineage at write time, mirroring the audit path (BACKOFFICE-49). `PgRiskSignalEmitter` gains an optional `LineageSink` (best-effort `try/catch` after the insert — the regulated write never depends on catalogue availability); `source: bff-risk-signal-emitter`. `validateLineageCoverage` already listed `risk_signal`, so without this the Q4.5 check flagged it as a gap the moment a super-admin session wrote a signal.
- Also fixed a live-demo gap found mid-story: the deployed worker (`worker.ts`) never constructed `PgRiskSignalEmitter` at all — super-admin Risk View signals fell back to the per-request in-memory sink and were silently dropped on Workers isolate recycle. Worker now wires the durable emitter (with lineage) into `createApp` + the `ctx.waitUntil` close loop, matching `serve.ts`.
- Evidence: 214 unit green; lint + typecheck green; `pnpm gen` no drift; integration (lineage + risk-signal + superadmin specs) 9 passed against Postgres. CI Q1–Q3 pass; auto-deploy green. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Local-only note: against the remote Supabase pooler the first int test trips the 5s vitest default (round-trip latency, not logic — proven green at 25s and in CI's local Postgres). Kept the repo's 5s convention rather than diverge one file.
- Next eligible: M1-PORTAL-SHELL (deps 47/43/45 all done) — completes the M1 exit criteria (DEMO banner, persona login, audit visible).

## 2026-06-14 — M1-PORTAL-SHELL (PR #18, loop iteration 14)

- **M1 substrate milestone is now feature-complete at the demo URL.** The Internal Portal (`apps/portal`, Next.js App Router on Cloudflare Workers via the OpenNext adapter — the stack the README already committed to) joins the auto-deploy and closes the M1 exit criteria (PRD §9): persona login (MFA) → portal shell → admin-scoped echo; High-class audit record emitted and visible; persistent DEMO banner on every screen.
- Architecture: the portal is the demo-profile **BFF first layer** (PRD §3.1) and invents **no auth path** — it composes the SAME primitives the Hono BFF uses: the P2 IdP port (`personaLogins`/`verifyToken`, MFA mandatory, no skip path), the canonical §2 scope matrix via `mintScopes` (newly exported from `@ofbo/bff/auth` — single source of truth), and the High-class audit write path. New read-only `PgAuditReader` (`@ofbo/db`) backs "audit visible": SELECT-only under `SET LOCAL ROLE ofbo_app` + RLS tenancy, INSERT-only guarantee untouched. Session is an httpOnly+secure cookie carrying a non-PII demo token — no bearer material in browser-accessible storage.
- No OpenAPI contract surface added: portal sign-in/sign-out are framework-internal Next route handlers (303 redirects), outside the Back Office contract (like the IdP flow) — so contract-conformance stays clean without a spec PR.
- Deploy wiring: `deploy.yml` gains a `deploy-portal` job (OpenNext build → deploy → `wrangler secret put DATABASE_URL`); smoke suite extended (`tests/smoke/portal.smoke.spec.ts`) for portal liveness (DEMO banner + sign-in screen served; unauthenticated /dashboard bounces to sign-in). `next build` + `opennextjs-cloudflare build` verified locally (`.open-next/worker.js` produced).
- Evidence: 234 unit (20 new: lib/components/route handlers) + 2 integration (sign-in audit emitted and read back against real Postgres under RLS) green; `pnpm gen` no drift; lint + typecheck (all 8 projects) green; CI Q1–Q3 pass. Coverage on the testable surface: lib 98% / components 100% / route handlers 100%; Next server entrypoints (layout/page/dashboard) are smoke-tested post-deploy. Reviewers: hard-stop PASS, conformance CONFORMANT.
- CI nit fixed mid-PR: Next regenerates `next-env.d.ts` with a `.next/types` triple-slash reference that ESLint rejects → the generated file is now ESLint-ignored (alongside `.next`/`.open-next`).
- Tooling: `apps/*` added to the pnpm + vitest workspaces; the unit project gains the React plugin (JSX) with per-file jsdom for component tests; react/react-dom/jsdom/@vitejs/plugin-react hoisted to the root for the runner. First-deploy note: the portal worker briefly runs without DATABASE_URL between deploy and secret-put (audit degrades to no-op) — acceptable, matches how the BFF secret was bootstrapped.
- Next eligible: BACKOFFICE-55 (region-parameterised Terraform skeleton) — remaining M1 items are infra (55/56/57), none blocking the milestone exit.

## 2026-06-14 — BACKOFFICE-55 (PR #19, loop iteration 15)

- Region-parameterised IaC, from day one (CLAUDE.md: "Terraform, region-parameterised"; PRD §3 residency = IaC parameter; §7: same module deploys to any approved region per the bank's residency assessment). New `infra/terraform/` skeleton.
- `region` is a REQUIRED input; nothing region-specific is hardcoded in the module body (region flows only from `var.region`). Residency (BD-06) is enforced twice — a cross-variable `validation` on `region` against `approved_residency_regions` (Terraform >= 1.9) AND a `check "data_residency"` block for the regulated (enterprise) profile; the variable-level guard is unconditional, so even a demo apply through this module stays in the approved set. Default approved set = UAE/GCC regions; UAE region for regulated production data. Region-aware naming prevents parallel regional-deploy collisions; outputs echo region + residency status. `bank_id` (UUID v4) supplied at apply time, never committed. Concrete cloud resources are written per-bank at adoption (M6) and must plug into this contract.
- No Terraform binary in CI (or locally): acceptance encoded as a pure-Node static test (`infra/terraform/test/skeleton.spec.ts`, 9 tests) asserting the parameterisation invariants — gates CI Q1. `infra/**/test/**` added to the vitest unit project.
- Evidence: 243 unit green (9 new); `pnpm gen` no drift; lint + typecheck green; CI Q1–Q3 pass (no integration/deploy impact — the skeleton isn't wired into the demo CLI pipeline). Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-57 (release evidence bundle per release tag).

## 2026-06-14 — BACKOFFICE-57 (PR #20, loop iteration 16)

- Release evidence bundle committed to git per release tag (CLAUDE.md; PRD §6): control mappings, test results, scan outputs, lineage proofs, git-anchored. New `@ofbo/release-evidence` package + `releases/` + `release-evidence.yml`.
- `buildEvidenceBundle` is pure: callers collect inputs (CI gate results, lineage report, git metadata); it validates completeness (throws if any of Q1–Q5/Q4.5 or the git anchor is missing) and seals the bundle with a sha256 digest over canonical (key-sorted) JSON; `verifyEvidenceBundle` re-checks integrity. `control-mappings` ties 13 regulatory/PRD controls → gate(s) → evidence artifact and covers every gate.
- CLI collects the git anchor + gate results and the LIVE BCBS 239 lineage proof (`validateLineageCoverage`, read-only) and writes `releases/<tag>/evidence-bundle.{json,md}`. `release-evidence.yml` (on release published) runs the gates via a Postgres service, assembles via `collect-gates.mjs` + CLI, and commits the bundle git-anchored under `releases/<tag>/` on the default branch; untrusted release tag passed via env (injection-safe), least-privilege `contents: write`. Q5 = the release being published through the protected flow.
- Evidence: 254 unit green (11 new; `bundle.ts` 100%, control mappings cover all gates); CLI smoke-verified end to end (JSON+MD, integrity digest, 6 gates/13 controls); `pnpm gen` no drift; lint + typecheck green; CI Q1–Q3 pass (no integration/deploy impact — `validateLineageCoverage` already integration-tested). Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-56 (CI gates Q4 security+deps and Q4.5 lineage validation; deps BACKOFFICE-49 done) — the last M1 infra item.

## 2026-06-14 — BACKOFFICE-56 (PR #21, loop iteration 17) — M1 COMPLETE

- Adds the remaining automated release gates to ci.yml (CLAUDE.md / PRD §6): **Q4** security review + dependency scan, **Q4.5** BCBS 239 lineage validation. A failed gate blocks merge; Q5 (manual prod approval) is evidenced at release time via the BACKOFFICE-57 bundle.
- Q4: `pnpm audit --prod --audit-level=high` (blocks on high/critical in SHIPPED deps; dev/build-tooling advisories — esbuild via vite/vitest — are tracked separately so upstream toolchain CVEs don't wrongly block every merge) + `semgrep p/secrets`.
- Q4.5: apply + seed + `test:integration` (warms the real write-path emitters, which emit lineage) then `@ofbo/db lineage:gate`. New pure `evaluateLineageGate` fails on ANY gap not in `KNOWN_LINEAGE_GAPS` (only `tpp_counterparty` → BACKOFFICE-71); a stale allowlist entry is surfaced.
- CI round 1 caught a real coverage gap: `approval_request` had rows but no lineage_events row, because its integration test recorded lineage only to an in-memory sink (audit/risk write through the real PgLineageEmitter elsewhere). Fix: the approval int test now forwards lineage to BOTH the in-memory recorder AND a real PgLineageEmitter — proving BCBS 239 lands in the catalogue end to end and giving Q4.5 real coverage. Round 2: all five gates green, Q4.5 self-validating on the PR.
- Evidence: 260 unit green (6 new); evaluateLineageGate unit-tested; `pnpm audit --prod --audit-level=high` clean; Q1–Q4.5 all pass on the PR. Reviewers (twice — re-reviewed after the test fix): hard-stop PASS, conformance CONFORMANT.
- **M1 milestone complete**: substrate live + demo deployed; portal shell, Nebras sim, region-parameterised IaC, release evidence bundle, and the full Q1–Q4.5 gate set all merged. Next: **M2 — Customer Care (E2)**, starting with BACKOFFICE-16 (PSU-centric consent search).

## 2026-06-15 — BACKOFFICE-16 (PR #22, loop iteration 18) — M2 begins

- M2's first feature. `GET /consents:search-psu` resolves a PSU by bank_customer_id | iban | emirates_id → PsuConsentSearchResult (ConsentAdminView: TPP identity, purpose, scope, full 7-state CBUAE lifecycle status, granted/expires/last-access). <500ms (in-memory demo directory).
- Compliance: scope `consents:admin` enforced at BOTH layers (BFF middleware via the spec-generated route table + service `assertScope`); a non-holder (finance-analyst) → 403. Exactly one High-class `consent_search` audit per call with the agent identity — the raw identifier (PII for emirates_id/iban) is redacted at emission, the durable `target_psu_identifier` is the resolved internal bank_customer_id, never raw PII; trace propagated; lineage emitted via the audit path.
- Architecture: enriched `@ofbo/synthetic-data` consents (scope, expires_at, last_access_at, tpp client_id + display_name) — derived deterministically, no RNG-sequence change — behind a `DemoConsentDirectory` implementing a `ConsentDirectory` interface the enterprise store swaps at M6. New `HighClassAuditSink` (BFF) satisfied by PgAuditEmitter in the worker (redaction + lineage), in-memory in tests. No Nebras egress; no DEPLOY_PROFILE branching in core.
- CI round 1 caught a real shared-DB order-dependence: `seed.int.spec` counted `event_type LIKE 'consent_%'` and compared to the consent_admin_event mirror (only the 4 lifecycle types) — the new consent_search rows inflated the broad count. Fixed by counting the exact event set the mirror materialises (order-independent). Q4.5 failure was a cascade of that integration failure. Round 2: all 5 gates green.
- Evidence: 265 unit green (consents 94% / bff src 92% / synthetic-data ~100%); integration proves the redacted consent_search row persists under RLS against real Postgres; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers (twice, re-reviewed after the test fix): hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-19 (24-month per-PSU consent audit-trail timeline; deps 16 done).

## 2026-06-15 — post-deploy smoke hotfix (PR #23)

- The BACKOFFICE-16 BFF redeploy enlarged the Worker bundle (@ofbo/synthetic-data), lengthening cold-start; the post-deploy audit-persistence smoke test fired its first fetch at a cold Worker and blew its 30s budget (two consecutive deploy failures). Diagnosed against the live env: audit persistence is CORRECT — the row is visible at poll attempt 0 once the request returns; `generateDemoDataset` is 0.38ms (not the latency source — Worker→Supabase + cold-start is). Not a lost write.
- Fix: warm the Worker before the timed smoke check + widen the persistence poll (20 attempts / 60s) — a liveness + eventual-persistence check, not the <500ms p95 SLA (demo profile is sleep-tolerant/free-tier per CLAUDE.md §3.1). Also build DemoConsentDirectory once per isolate (deterministic/immutable) instead of per request.
- Evidence: 265 unit green; gen no drift; lint + typecheck green; CI Q1–Q4.5 pass; post-merge deploy + smoke GREEN. Reviewers: hard-stop PASS (singleton is read-only immutable demo data, no cross-request leak), conformance CONFORMANT.

## 2026-06-15 — BACKOFFICE-19 (PR #24, loop iteration 19)

- 24-month per-PSU consent audit-trail timeline: GET /consents/{consent_id}/audit-trail + /psu/{psu_identifier}/audit-trail — chronological consent lifecycle events from the High-class store, cursor-paginated, audit:read enforced at BFF middleware + service. Each event's `id` is the drill-down anchor (→ /audit/events/{id}).
- PgConsentEventReader (@ofbo/db): read-only SELECT under ofbo_app + tenancy context (RLS binds; INSERT-only untouched). Keyset cursor on (created_at, id). Mid-story bug caught by the integration pagination test: pg returns ms-precision Dates vs µs-precision columns, so the raw keyset let the boundary row re-appear on the next page — fixed by truncating created_at to milliseconds on BOTH the ORDER BY and the comparison. BFF ConsentAuditTrailService depends on a ConsentEventSource interface (worker wires the reader; M6 swaps the enterprise store). Read-only: no new audit write, no new lineage.
- Evidence: unit green (audit-trail.ts 81% / consents dir 90%); integration proves RLS-scoped reads + overlap-free keyset pagination against real Postgres; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT (two non-blocking fidelity notes: event_subtype null until revoke reason codes land in -17/-22; consent_id never actually null since only consent_* events are selected).
- Next eligible: BACKOFFICE-17 (single-consent revocation + reason code, <5s p99 to the Nebras sim — first story exercising the P6 egress + the simulator's revoke ack).

## 2026-06-15 — BACKOFFICE-17 (PR #25, loop iteration 20)

- Single-consent revocation: POST /consents/{consent_id}:revoke-admin — reason_code TPP_REQUEST|CLIENT_INSTRUCTION|REGULATORY (FRAUD_SUSPECTED → 400, reserved for -22). consents:admin at BFF+service; Idempotency-Key (key scoped by consent_id so a reused key across consents doesn't skip a revoke — caught in review); exactly one High-class consent_revoked audit (reason_code + nebras_propagation_ms + sla_met).
- P6 egress: all Nebras-bound traffic routes through the P6 port. The demo sim adapter now HTTP-calls the Nebras simulator's Consent Manager when NEBRAS_SIM_URL is set (added to the BFF wrangler vars → live sim verified returns acknowledged_in_ms), deterministic fallback otherwise. nebras_propagation_ms + sla_met (<5000ms, NFR-18); revoke_delay fault → real SLA breach in the demo. Revocation succeeds on breach (SLA is a monitored p99 metric).
- First story exercising the P6 egress over HTTP and the simulator's revoke ack end to end.
- Evidence: 271 unit green (revoke.ts 96% / consents dir 92.5%) incl. injected-fault SLA-breach + idempotency-isolation tests; integration proves the consent_revoked row persists under RLS; live sim revoke shape verified; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers (twice — re-reviewed after the idempotency-key fix): hard-stop PASS, conformance CONFORMANT.
- Next eligible: SPEC-FRAUD-REVOKE-FOUREYES (spec-change: add x-four-eyes + 202 to revoke-fraud per BD-03; human-approved) — the loop will open the spec PR and park BACKOFFICE-22 blocked, then continue with BACKOFFICE-25.

## 2026-06-15 — SPEC-FRAUD-REVOKE-FOUREYES (spec PR #26, loop iteration 21) — PARKED awaiting human

- Spec-change item (contract-first; human-approved merge, NOT self-merged). Closes three contract defects against binding conventions:
  1. /consents/{consent_id}:revoke-fraud → x-four-eyes: true + 202 ApprovalPending (was 200 inline). "Four-eyes on fraud revoke" is a binding adopting-bank default (PRD §10 / CLAUDE.md); the old spec let fraud revoke execute inline — a latent control gap now closed. Matches /consents:revoke-bulk.
  2. /back-office/reports/{report_id}:approve → removed contradictory x-four-eyes: true (it's the four-eyes resolution step, returns 200; flagging it regresses into an infinite gate).
  3. approval id → format: uuid on ApprovalRequest.approval_request_id + the approval_id path param (matches crypto.randomUUID() + invoice_run.approval_id).
- Regenerated api-types + routes (revoke-fraud fourEyes:true; reports:approve fourEyes:false). No code change — both endpoints are still contract-pending stubs. 271 unit green; lint + typecheck green; pnpm gen committed (57 paths unchanged). Reviewers: contract-conformance CONFORMANT, hard-stop PASS (strengthens controls; no scope widened).
- HUMAN DECISION: approve/merge spec PR #26. SPEC-FRAUD-REVOKE-FOUREYES is blocked until then; BACKOFFICE-22 (deps on it) stays blocked.
- Loop continues with the next eligible item: BACKOFFICE-25 (care-surface token minting).

## 2026-06-15 — BACKOFFICE-25 (loop iteration 22) — PARKED on ADR (human decision)

- Care-surface token minting (act + sub claims, ≤15 min). The mechanism is already defined by the canon — P1 CareSurfacePort.mintCareToken returns { token, act, sub, expires_at }, and the spec's securityScheme documents care tokens as Platform Auth Service client_credentials with act/sub. What is NOT covered: HOW the console obtains the care token. The OpenAPI contract has no path, and a new auth path is a humans-decide decision (CLAUDE.md rule 6).
- Wrote docs/adrs/0001-care-surface-token-minting.md (Proposed) with three exposure options — (1) a Back Office contract `:mint-token` endpoint via the Hono BFF (needs a spec-change PR), (2) a portal-server route outside the contract (the M1-PORTAL-SHELL session pattern), (3) transparent BFF middleware on PSU-scoped care-surface calls — recommending Option 1. BACKOFFICE-25 is blocked on the ADR.
- HUMAN DECISION: choose the care-token exposure surface (ADR 0001). No code/PR this iteration.
- Loop continues with the next eligible item: BACKOFFICE-20 (unauthorized-payment investigation workflow; deps 16 done).

## 2026-06-15 — BACKOFFICE-20 (PR #27, loop iteration 23)

- Unauthorised-payment investigation slice: GET /payments/{id}:admin (IPP status + CoP outcome + Risk Info Block + consent-validity-at-time-of-payment), POST /disputes (one-click, Nebras-linked via P6, dispute_created High-class audit + dispute_case lineage, Idempotency-Key keyed by subject → no duplicate Nebras case), GET /disputes (list, cursor + state/psu filters). disputes:admin at BFF+service.
- Payments derived deterministically into @ofbo/synthetic-data (reused "existing LFI/TPP services"; M6 swaps the source) — no RNG-sequence disturbance; deterministicClientId generalised to deterministicUuid. PgDisputeStore (@ofbo/db): RLS-bound create/get/list with lineage. Payment view projects off the internal psu_identifier.
- Mid-iteration catch: I initially added a GET /disputes/{id} route, but the contract has no GET-by-id (only PATCH) — removed it; a dispute is viewed via the filtered list. DEFERRED to a dispute-lifecycle slice: PATCH /disputes/{id} state machine (§6.3.1, kept a 501 stub). initiate-refund is -21/-62. client_id list filter accepted-but-unsupported (no client_id column on dispute_case).
- Evidence: 273 unit green (disputes 95% / payments 97%); integration proves the dispute persists with audit + dispute_case lineage under RLS, round-tripping via the store + list API; gen no drift; lint + typecheck green; Q1–Q4.5 all pass (dispute_case now lineage-covered). Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-21 (next-business-day refund, four-eyes, SLA timer; deps 20 done).

## 2026-06-15 — BACKOFFICE-21 (PR #28, loop iteration 24)

- Next-business-day refund, four-eyes-gated: POST /disputes/{id}:initiate-refund → 202 + approval_request via the shared approvals primitive (never inline). On approval by a DIFFERENT disputes:admin principal, the registered disputes.initiate_refund operation moves the dispute → refund_initiated, records refund_required_by = endOfNextBusinessDay (weekends paused — the SLA timer), refund_amount (integer minor units), and a High-class refund_initiated audit + dispute_case lineage. Initiator≠approver enforced (super-admin self-approval → 409).
- PgDisputeStore.markRefundInitiated: RLS-bound UPDATE on the mutable dispute_case table + lineage. Idempotency-Key on initiation. Money rejects non-integer amounts. Ozone Connect dispatch is -62.
- Mid-review fix: refund_initiated audit now records the initiator's actual persona (from verified IdP claims) instead of a hardcoded value (hard-stop reviewer flag, non-blocking).
- Evidence: 275 unit green (disputes dir 95% / service 99%) incl. initiate→approve→refund_initiated + self-approval rejection; integration proves markRefundInitiated under RLS + lineage; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers (twice): hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-62 (refund dispatch via the formal Ozone Connect refund flow, P6, 5 IPP status codes; deps 21 done).

## 2026-06-15 — BACKOFFICE-62 (PR #29, loop iteration 25)

- Refund dispatch via the formal Ozone Connect flow through P6, completing the four-eyes refund (-21). On approval, the disputes.initiate_refund operation calls the P6 egress port's new dispatchRefund (keyed by the dispute's originating_consent_id) and tracks the returned IPP status (5 codes ACCC/ACSP/ACSC/RJCT/PDNG) in the approval execution_result + refund_initiated audit; refund_initiated_at is the RPSCS SLA-evidence timestamp.
- P6 NebrasEgressPort extended with dispatchRefund (sim returns ACSP deterministically; enterprise adapter unchanged — whole-port NotImplemented until M6); port-contract test binds it. No OpenAPI change — IPP rides the approval execution_result (spec declares it as an open object on the approve response). Dispatch only on approval; all egress via P6.
- Evidence: 276 unit green (port-contracts + initiate→approve→dispatch asserting the IPP status; disputes service 99%); gen no drift; lint + typecheck green; Q1–Q4.5 all pass. No DB-schema change. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-23 (CBUAE inquiry response bundle per PSU; deps 19 done) — the last eligible M2 item before the blocked ones (-22 on spec PR #26, -25 on ADR 0001).

## 2026-06-15 — spec PR #26 merged (human-approved) — BACKOFFICE-22 unblocked

- The user approved and the spec-change PR #26 (SPEC-FRAUD-REVOKE-FOUREYES) merged: revoke-fraud now x-four-eyes + 202 ApprovalPending (closes the latent inline-fraud-revoke gap, a binding adopting-bank default), reports:approve four-eyes flag removed (it's the resolution step), approval ids standardised to format:uuid. Generated artifacts current on main (no gen drift). SPEC-FRAUD-REVOKE-FOUREYES → done.
- BACKOFFICE-22 (fraud-suspected revocation + STR draft; deps 17 + SPEC-FRAUD-REVOKE-FOUREYES) is now eligible and is next in file order. Remaining blocked: BACKOFFICE-25 (ADR 0001 — care-token surface, awaiting human decision).

## 2026-06-15 — BACKOFFICE-22 (PR #30, loop iteration 26)

- Fraud-suspected revocation: POST /consents/{id}:revoke-fraud — narrow Risk scope (consents:admin:fraud-revoke), four-eyes (202 + approval, per merged spec #26). On approval the consents.fraud_revoke op P6-revokes with FRAUD_SUSPECTED (<5s), auto-creates an STR draft ref (submission is -63), notifies Compliance via the High-class consent_revoked audit, and defers PSU notification per fraud policy. case_context PII-redacted at emission.
- Reuses approvals + P6 + audit; no new table/port/contract. Initiator≠approver (super-admin self-approval → 409). Narrow scope enforced at BFF + service (Customer Care's consents:admin is rejected — only :fraud-revoke admits).
- Evidence: 278 unit green (fraud-revoke 92%) incl. the full four-eyes flow + narrow-scope 403; integration proves the FRAUD_SUSPECTED audit persists under RLS with case_context Emirates-ID redacted; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-23 (CBUAE inquiry response bundle per PSU; deps 19 done) — the last eligible M2 item. Remaining blocked: BACKOFFICE-25 (ADR 0001 — care-token surface, awaiting human decision).

## 2026-06-15 — BACKOFFICE-23 (PR #31, loop iteration 27)

- Per-PSU CBUAE inquiry response bundle: POST /back-office/inquiries/psu → 202 + Report (compliance:reports:generate at BFF + service). Aggregates the four M2 sections for a PSU resolved by bank_customer_id/iban/emirates_id — consents, payments + CoP outcomes, disputes, and the 24-month consent trail — computes a line-level sha256 per record plus an overall integrity_hash, and persists a compliance_report (status awaiting_approval, classification restricted) for the four-eyes CBUAE-submission step (-35).
- New compliance_report.content jsonb (migration 0010) + PgComplianceReportStore (@ofbo/db): RLS-bound create/get with content redacted at persistence + lineage. compliance_report now BCBS 239 lineage-covered (Q4.5). Idempotency-Key on generation, keyed by subject.
- Mid-review fix (hard-stop flag): the line-level + overall hashes were computed over unredacted data while the store persists redacted content, so a verifier re-hashing the stored bundle could never reproduce them. Fixed to redact-then-hash (redactPii is idempotent) so the persisted bundle is independently verifiable; added a re-hash verifiability test asserting createHash(persisted line) === stored hash.
- Evidence: 281 unit green (inquiries bundle covered incl. 202 + integrity hash, per-record hash counts, re-hash verifiability, identifier resolution, 400/404/403, missing-Idempotency-Key 400); integration (real Postgres) proves the report persists with content hashes + compliance_report lineage + inquiry_bundle_generated audit under RLS; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers (twice — re-run after the redact-then-hash fix): hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-18 (Emergency PSU-wide bulk revocation, four-eyes; deps 17 done) — still in M2. Remaining M2 blocked: BACKOFFICE-25 (ADR 0001 — care-token surface, awaiting human decision). M3 (Reconciliation, E1 — BACKOFFICE-01) follows once M2's eligible queue drains.

## 2026-06-15 — BACKOFFICE-18 (PR #32, loop iteration 28)

- Emergency PSU-wide bulk revocation, four-eyes-gated: POST /consents:revoke-bulk → 202 + approval_request (consents:admin at BFF + service; never inline). On a DIFFERENT principal's approval the registered consents.bulk_revoke operation resolves the PSU and revokes EVERY active consent (status Authorized/Suspended) in parallel through the P6 egress gateway (<5s total — NFR-18), emits ONE grouped consents_bulk_revoked High-class audit carrying all revocation ids + per-consent propagation ms + sla_met, and notifies the PSU once (consolidated). FRAUD_SUSPECTED stays reserved for :revoke-fraud.
- Reuses the shared approvals primitive + P6 + high-class audit + consent directory — no new table/port/contract, no spec change. PSU resolved to its internal bank_customer_id at initiation so the approval payload + audit never hold the raw Emirates ID/IBAN the operator searched by (no PII at rest); Idempotency-Key replay scoped by subject + a hash of the identifier + key (cross-PSU reuse cannot silently skip a sweep). Active = {Authorized, Suspended}; terminal + AwaitingAuthorization left untouched.
- Evidence: 286 unit green (7 new: four-eyes 202/no-inline, second-principal approval revokes all active in parallel + one grouped audit, self-approval 409, emirates_id resolution with no raw id on the wire, empty sweep → revoked_count 0, idempotency cross-PSU, 400/404/403); integration proves the grouped audit persists under RLS with all revocation ids + audit_high_sensitivity lineage. Verified the full integration suite 52/52 against a local Postgres mirroring CI Q3 (Q3 in CI passed in 44s). gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 93.95% on bulk-revoke.ts. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Observed (not caused by this change): running the integration suite against the remote Supabase pooler from a workstation is slow (Seoul region; full suite ~235s) and a latent cross-file seed race in lineage.int.spec (tpp_counterparty gap vs seed.int.spec) can flake under parallel scheduling — both reproduce/clear independent of this story (52/52 on a fresh local DB; green in CI). A future test-infra hardening could isolate the lineage gap check; out of scope here.
- M2 eligible queue now empty (only BACKOFFICE-25 remains, blocked on ADR 0001). Loop advances to M3 (Reconciliation, E1) — BACKOFFICE-01 next.

## 2026-06-15 — BACKOFFICE-01 (PR #33, loop iteration 29) — first M3 / Epic E1

- The reconciliation matching core: a headless daily three-way reconciliation matches Nebras billing (A) ↔ platform internal API logs (B) ↔ downstream fintech billing (C) for technically-successful calls only, applies the Commercial & Pricing Model v1.0 fee schedule (payment 2.5 fils, balance/CoP 0.5 fils, data sharing 2.5 fils/100 lines — computed in milli-fils so aggregated lines settle to integer fils), classifies every line matched/unmatched/disputed, and writes the counts to reconciliation_log. Read surface (reconciliation:read): GET /back-office/reconciliation/runs (list, cursor + run_type/status filters) + GET …/runs/{run_id} (by text run_id).
- reconciliation/{fee-schedule,engine,sources,service,routes}.ts: pure engine + deterministic synthetic sources behind the source interfaces (the M6 enterprise swap seam; no network egress) with injectable fee-variance/missing/dispute lines for the demo. PgReconciliationLogStore (@ofbo/db): RLS-bound create/get/list + BCBS 239 lineage; idempotent on run_id (ON CONFLICT) so a retried run writes no second log → reconciliation_log now in the Q4.5 covered set. reconciliation_run_completed High-class audit (only on an executed run). Worker scheduled() cron handler = the no-public-ingress daily job, resumable/idempotent via run_id.
- Out of scope (remain 501 stubs): -02 break detection, -10 replay, -11 diff view, -06 monthly close, -08 CBUAE export, -13 OTel-per-line. No spec change.
- Evidence: 295 unit green (13 new: fee schedule incl. whole-fils guard; engine matched/variance/technically-successful-only/missing/disputed/pass-through-needs-fintech; sim stable counts 110=100+8+2 with 4 failed excluded; read routes list/detail/filter/404/403); integration proves a run persists under RLS with counts + reconciliation_log lineage + audit, and the re-run is idempotent (no second row, no audit). Verified full integration 53/53 against a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 96.45% on the reconciliation module. Repointed 3 placeholder-stub tests (rbac/superadmin/telemetry) from /runs to the still-stubbed /breaks route. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-02 (break detection with configurable thresholds → reconciliation_break; deps 01 done) — M3.

## 2026-06-15 — BACKOFFICE-02 (PR #34, loop iteration 30)

- Reconciliation break detection: the daily run now turns the engine's unmatched lines into reconciliation_break records when the variance EXCEEDS the configured threshold (defaults >1 fils fee variance, >0 consent-count drift). Fee-class breaks notify Finance; consent-record drift notifies Operations — via the P3 ITSM port (one batched ticket per team per run). Every break carries all three source refs (A=Nebras, B=platform, C=fintech) + the SLA clock start. Read surface: GET /back-office/reconciliation/breaks (reconciliation:read; filters run_id/status/line_type/client_id).
- reconciliation/thresholds.ts (DEFAULT_THRESHOLDS per fee class; GET/PUT API is -12) + breaks.ts (pure detectBreaks; a missing line is a break by construction). engine.ts: ReconLineResult now carries client_id + per-source refs. PgReconciliationBreakStore (@ofbo/db): RLS-bound createMany/list/countForRun + BCBS 239 lineage → reconciliation_break now in the Q4.5 covered set; detection idempotent per run_id (countForRun guard). service.runDaily detects → persists → notifies the routed team → emits reconciliation_breaks_detected High-class audit (only on an executed run). Worker scheduled() wires the break store + P3 ITSM.
- Out of scope (stay stubs): -11 break diff view (GET breaks/{id}), -03/-04/-05 claim/resolve/escalate/reopen, -12 thresholds GET/PUT. No spec change.
- Evidence: 301 unit green (21 new: detectBreaks fee/consent/threshold-suppression/missing-line/matched-disputed-ignored; run→detect→notify Finance→audit→idempotent; GET breaks list+filter+403); integration proves breaks persist under RLS with source refs + SLA clock + reconciliation_break lineage, idempotent re-run adds none. Verified full integration 54/54 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% breaks.ts / 95.9% engine / 100% service-stmts. Repointed 3 placeholder-stub tests (rbac/superadmin/telemetry) from /breaks to the still-stubbed /thresholds route. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-03 (break investigation workflow / claim; deps 02 done) — M3.
