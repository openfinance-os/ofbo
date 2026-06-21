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

## 2026-06-15 — BACKOFFICE-03 (PR #35, loop iteration 31)

- Break investigation workflow (claim): POST /back-office/reconciliation/breaks/{break_id}/claim — claim a flagged break → assigned, record the claimant (assigned_to), start the resolution SLA clock (p50 ≤2 / p90 ≤5 business days), remove it from every other claimant's queue. finance:reconciliation:write at BFF + service; consent-record breaks may alternatively be claimed with platform:operations:write (service rule).
- PgReconciliationBreakStore.claim: atomic flagged→assigned UPDATE — the status='flagged' guard makes a concurrent second claim a 0-row no-op (→ 409); plus get(id). RLS-bound (reconciliation_break is a mutable workflow table) + reconciliation_break lineage. service.claimBreak: 404 unknown / 409 not-claimable, reconciliation_break_claimed High-class audit, Idempotency-Key (24h, scoped by break_id + subject).
- Out of scope (stay stubs): -04 resolve, -05 escalate-nebras, reopen, -11 diff view, -12 thresholds. No spec change.
- Reviewer advisory (not a defect, both PASS/CONFORMANT): the prose "consent-record breaks may alternatively be claimed with platform:operations:write" is unreachable over HTTP because the contract's static x-required-scope is finance:reconciliation:write — the BFF middleware gates on it, so an ops-only principal is 403'd before the service rule runs (the rule is correct + unit-tested, and works for super-admin). Enabling the ops path over HTTP needs the route scope expressed as dynamic/either-scope via the spec-change workflow — deferred (human-approved).
- Evidence: 307 unit green (8 new: claim flagged→assigned + claimant + SLA clock + audit; second claim 409; idempotency replay; 404/400; 403 wrong persona; service-layer scope rule); integration proves claim transitions under RLS with lineage and the flagged guard makes a second claim a no-op. Full integration 55/55 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% service-stmts / 93% routes / 100% breaks.
- Process note: this iteration's first commit landed on local main by mistake (no feature branch created); corrected by relocating the commit onto feature/BACKOFFICE-03-break-claim and resetting local main to origin before any push — no bad state reached the remote.
- Next eligible: BACKOFFICE-04 (resolution outcomes + immutable audit + four-eyes reopen; deps 03 done) — M3.

## 2026-06-15 — BACKOFFICE-04 (PR #37, loop iteration 32)

- Break resolution outcomes + four-eyes reopen — the terminal end of the break lifecycle:
  - POST /back-office/reconciliation/breaks/{break_id}/resolve (finance:reconciliation:write): terminal transition → resolved_matched / resolved_internal_correction / escalated_fintech_billing with a mandatory note (≥20 chars); re-resolving a terminal break → 409; reconciliation_break_resolved immutable High-class audit. (escalated_nebras_dispute is the separate escalate-nebras flow, BACKOFFICE-05.)
  - POST /back-office/reconciliation/breaks/{break_id}/reopen (audit:read / Compliance, FOUR-EYES): 202 + approval_request; a DIFFERENT audit:read principal approves before the registered reconciliation.break_reopen operation reopens the break → flagged, clears assignment/resolution, reopened_count++. Justification (≥20 chars) required.
- PgReconciliationBreakStore.resolve/reopen: guarded UPDATEs (resolve only from flagged/assigned; reopen only from a terminal status) — atomic + idempotent-safe; RLS-bound with reconciliation_break lineage. Reopen rides the shared four-eyes approvals primitive (initiator≠approver incl. super-admin self-approval → 409); the break store is shared so the operation closes over it. Idempotency-Key on both routes.
- reconciliation_break is "immutable on resolution" (PRD) — reopen is the sanctioned four-eyes path that increments reopened_count (intended design, confirmed by the hard-stop reviewer).
- Out of scope (stay stubs): -05 escalate-nebras, -11 diff view, -12 thresholds. No spec change.
- Evidence: 308 unit green (13 new: resolve terminal+note+audit, short-note/invalid-outcome/double-resolve 409, 403; reopen four-eyes 202 + self-approval 409 + second-principal approval reopens, short-justification 400, reopen-non-resolved 409, 403 without audit:read); integration proves resolve→reopen RLS transitions + lineage + both guards. Full integration 56/56 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% service-stmts / 90% routes. Reviewers: hard-stop PASS (four-eyes verified), conformance CONFORMANT.
- Ops note: after merge, a stale leftover git worktree (.claude/worktrees/fix-smoke-501-check, from the already-merged PR #36) had `main` checked out and blocked the post-merge checkout; it was clean and fully merged, so removed via `git worktree remove` before syncing main. No data loss.
- Next eligible: BACKOFFICE-05 (one-click Nebras dispute case from a break / escalate-nebras; deps 03 done) — M3.

## 2026-06-15 — BACKOFFICE-05 (PR #38, loop iteration 33) — E1 break lifecycle complete

- One-click Nebras dispute from a break: POST /back-office/reconciliation/breaks/{break_id}/escalate-nebras (finance:disputes:write) opens a Nebras Case & Dispute Management case through the P6 egress gateway (FAPI 2.0 mTLS + evidence bundle = the gateway's responsibility, no direct egress), persists the returned nebras_dispute_case_id, transitions the break → escalated_nebras_dispute. Returns 200 + { break_id, status, nebras_dispute_case_id } (narrow inline object per the spec, NOT the full break).
- Evidence bundle = the break's three source refs + variance + run/line (no PSU PII). PgReconciliationBreakStore.escalateNebras: guarded flagged/assigned → escalated_nebras_dispute UPDATE (second escalate = 0-row no-op → 409), RLS + reconciliation_break lineage. service.escalateToNebras: 404/409, reconciliation_break_escalated_nebras audit, Idempotency-Key (24h) so a replay opens NO duplicate Nebras case (cached 2xx replays before the handler → createDisputeCase not re-called).
- The E1 break lifecycle is now complete end-to-end: detect → claim → resolve / escalate-nebras / four-eyes reopen.
- Out of scope (stay stubs): -11 break diff view, -12 thresholds. No spec change.
- Evidence: 310 unit green (8 new: escalate opens P6 case + persists id + audits; idempotency replay opens no duplicate; re-escalate 409; 404/400; 403 wrong persona); integration proves escalate persists Nebras id + status under RLS with lineage, second escalate a no-op. Full integration 57/57 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% service-stmts / 90% routes. Reviewers: hard-stop PASS (egress via P6, no duplicate cases), conformance CONFORMANT.
- Next eligible: BACKOFFICE-11 (three-source side-by-side diff view per break — GET breaks/{break_id}; deps 02 done) — M3.

## 2026-06-15 — BACKOFFICE-11 (PR #39, loop iteration 34)

- Three-source side-by-side break diff view: GET /back-office/reconciliation/breaks/{break_id} (reconciliation:read) returns the full ReconciliationBreak — Nebras (source_a) / platform log (source_b) / fintech billing (source_c) refs + the variance to highlight; the originating FAPI transaction links via the propagated x-fapi-interaction-id. 404 unknown.
- service.getBreak: reconciliation:read at BFF + service; reuses the existing RLS-bound store.get + breakToWire. Read-only — no DB write, no schema change.
- Out of scope (stays stub): -12 thresholds GET/PUT. No spec change.
- Evidence: 311 unit green (3 new: three source refs + highlighted variance, 404, 403); integration 57/57 on a local Postgres mirroring CI Q3 (store.get already exercised by claim/resolve/escalate); gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT (route matcher confirmed not to collide with the list/sub-routes).
- Process note: iteration 33's deploy-watch background task reported exit 1, but the deploy actually succeeded (completed success) — the failure was a transient HTTP 404 on a trailing gh run view call after the watch finished, not a deploy failure.
- Next eligible: BACKOFFICE-13 (OTel traces per run, per line; deps 01 done) — M3.

## 2026-06-15 — BACKOFFICE-13 (PR #40, loop iteration 35)

- OTel traces per reconciliation run, per line: the daily run emits a parent reconciliation.run span + one reconciliation.line child per reconciled line through the P5 APM bridge (OTel is the canonical stream, never a second instrumentation path). Line spans carry the acceptance attributes — run_id, line_type, the three source refs (source_a Nebras / source_b platform / source_c fintech), variance, decision (matched/unmatched/disputed) — and link to the run span via parent_span_id; trace_id is the run's x-fapi-interaction-id passed through redactText.
- Spans only on an actually-executed run (idempotent re-runs emit none). Fire-and-forget export: a P5 outage never fails the run, and the run's own engine/store/audit errors still propagate (only the span export is caught). Wired into the BFF app + worker scheduled() via getAdapter('p5-apm'). No DB write, no schema, no OpenAPI path (instrumentation of the existing run).
- Evidence: 315 unit green (4 new: run span + per-line spans with all attributes; children of the run span; fee-variance line records decision+variance; disputed count matches; trace id not leaked; idempotent re-run emits none; P5 outage never fails the run); gen no drift; lint + typecheck green; Q1–Q4.5 all pass. The lone local integration failure remained the pre-existing tpp_counterparty seed race (lineage.int.spec, parallel scheduling) — unrelated; Q3 green in CI. Reviewers: hard-stop PASS (no telemetry PII, APM-bridge posture, failure-isolated), conformance CONFORMANT.
- Next eligible: BACKOFFICE-06 (monthly reconciliation summary + Finance sign-off; deps 04 done) — M3; unblocks -08 (CBUAE export).

## 2026-06-15 — BACKOFFICE-06 (PR #41, loop iteration 36)

- Monthly reconciliation summary + Finance sign-off: POST /back-office/reconciliation/monthly-signoff (finance:reconciliation:write) aggregates the period's runs + break dispositions (total/open/resolved/escalated, by_status) + open Nebras disputes into a summary, computes a SHA-256 integrity hash, and persists a compliance_report with the Finance Analyst's IdP-attested digital sign-off (status approved, approved_by = requested_by = the authenticated principal, classification restricted). The compliance_report is the locked, 5-yr-archived signed artifact; PDF/XLSX rendering is a downstream concern off it. TPP-aaS margin carried as pending_backoffice_07 (-06 does not depend on -07).
- @ofbo/db: ComplianceReportCreateInput gains approved_by; PgReconciliationLogStore.countForPrefix + PgReconciliationBreakStore.summarizeByStatus aggregate a month by the recon-YYYY-MM- run_id prefix. Period-scoped Idempotency-Key (reused key can't replay a different month). reconciliation_monthly_signoff High-class audit; compliance_report lineage; content redacted at rest.
- Out of scope (stay stubs): -12 thresholds, -08 exports:cbuae (now unblocked). No spec change.
- Evidence: 316 unit green (6 new: signed report incl. approved_by=requested_by + integrity hash; summary aggregates; margin pending -07; idempotency replay + cross-period not shadowed; 400 invalid period/missing key; 403); integration proves the locked report persists under RLS with summary + integrity hash + compliance_report lineage + sign-off audit, aggregating the month's 8 breaks. Full integration 58/58 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 99.8% service-stmts / 90% routes. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Process note: this iteration's first commit again landed on local main (no branch created); recovered onto feature/BACKOFFICE-06-monthly-signoff + reset main to origin before any push (second occurrence; saved a loop-branch-before-edit memory to prevent recurrence).
- Next eligible: BACKOFFICE-08 (CBUAE reconciliation export with per-line integrity hashes; deps 06 done) — M3.

## 2026-06-15 — BACKOFFICE-08 (PR #42, loop iteration 37)

- CBUAE-format reconciliation export: GET /back-office/reconciliation/exports:cbuae?period_start&period_end (compliance:reports:generate) → 202 + Report. Aggregates every reconciliation run + break in the date range into a CBUAE-format audit-trail export — each line gets a per-line SHA-256 integrity hash + an overall integrity hash — persisted as a compliance_report (report_type cbuae_reconciliation_export, status awaiting_approval; CBUAE submission is four-eyes, -35). XLSX + PDF cover render downstream off this signed record.
- redact-then-hash (redactPii idempotent) so a verifier re-hashing the persisted (redacted) export reproduces the line hashes — same evidence-grade pattern as the inquiry bundle (-23). compliance_report content redacted at rest + lineage; cbuae_reconciliation_export_generated High-class audit. @ofbo/db: PgReconciliationLogStore.listForRange + PgReconciliationBreakStore.listForRange (RLS-bound, created_at in [start, end+1d), capped).
- Out of scope (stays stub): -12 thresholds. No spec change.
- Evidence: 317 unit green (9 new: 202 export with per-line + overall hashes; counts; re-hash verifiability; 400 missing/malformed/inverted period; 403 wrong persona); integration proves the export persists under RLS with hashes + compliance_report lineage + audit, line hashes re-verify. Caught + fixed a test-isolation bug: the wide-range export picked up breaks other parallel int specs wrote at the same wall-clock time (export is by created_at), so the int spec now asserts the seeded run's 8 breaks are present rather than an exact shared-DB total (the unit suite holds the exact-count contract in isolation). Full integration 59/59 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% service-stmts / 91% routes. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Process: branch created before any edit this iteration (loop-branch-before-edit memory held).
- Next eligible: BACKOFFICE-07 (TPP-aaS pass-through billing + margin tracking; deps 01 done) — M3.

## 2026-06-15 — BACKOFFICE-07 (PR #43, loop iteration 38)

- TPP-aaS pass-through billing + margin tracking: correlates each Nebras per-call fee (bank as TPP-of-record) with the downstream fintech billing entry (by line_ref), margin = fintech charge − Nebras fee, bucketed per fintech (client_id) + product family (SIP=payment / AISP=data-sharing / CoP=consent). No contract path — surfaced via the daily run (reconciliation_run_completed audit + OTel run span recon.tpp_aas_margin + the run result) and the monthly sign-off (-06), whose prior pending_backoffice_07 field is now the real per-fintech/per-family breakdown, re-derived from each run's deterministic sources (listForPrefix).
- reconciliation/margin.ts: pure computeTppAasMargin + mergeMargin + productFamily. Sim fintech billing now re-bills the Nebras fee + a deterministic 2–4 fil markup (the margin); the engine matches pass-through by presence not amount, so matched/unmatched counts are unaffected. @ofbo/db: PgReconciliationLogStore.listForPrefix.
- Out of scope: -31 Finance View / -27 Exec dashboard endpoints. No spec change.
- Evidence: 323 unit green (6 new: margin correlation + per-fintech/per-family; orphan ignored; mergeMargin; sim margin > 0; run result carries margin; monthly sign-off now asserts a real positive margin); full integration 59/59 on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% margin.ts / 99.7% service / 100% sources. Reviewers: hard-stop PASS (matching invariant preserved, integer money, no PII), conformance CONFORMANT (no contract surface; margin is internal report content).
- Next eligible: BACKOFFICE-14 (reconciliation data retention lifecycle — 24-mo hot → warm → 5-yr immutable, deletion forbidden by RLS; deps 01 done) — M3.

## 2026-06-15 — BACKOFFICE-14 (PR #44, loop iteration 39) — M3 / E1 reconciliation epic complete

- Reconciliation data retention lifecycle: reconciliation_log + reconciliation_break carry the binding 24-mo hot → columnar warm → 5-yr immutable lifecycle, deletion forbidden by RLS. The mechanism (retention_policy 24/60, RLS no-DELETE, denial logging) shipped with BACKOFFICE-50; this story makes the full lifecycle explicit + proves it for the reconciliation tables.
- retention.ts: retentionStatus now reports the full tier breakdown — hot_tier_count / warm_tier_count / past_immutable_count (plus the back-compat due_for_warm_tier) — for the Compliance View (-29). past_immutable_count surfaces overdue rows the deletion-forbidden policy never purges. Additive fields; the -50 retention spec still passes. The warm-tier MOVER (Parquet) stays deferred to the analytics service.
- No contract path, no spec change, no DB schema change.
- Evidence: integration proves both reconciliation tables deny DELETE under RLS + High-class log it (withDenialLogging), and retentionStatus classifies a 25-month-old row into the warm tier (row_count = hot + warm + past_immutable; past_immutable 0). 323 unit green; full integration 63/63 on a local Postgres mirroring CI Q3; gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers: hard-stop PASS (no deletion path introduced; deletion denied + logged), conformance CONFORMANT.
- Milestone: M3 (E1 Reconciliation Console) is now functionally complete — BACKOFFICE-01,-02,-03,-04,-05,-06,-07,-08,-11,-13,-14 all done.
- Next eligible: BACKOFFICE-71 (consuming-TPP registry with Trust Framework Directory sync; the tpp_counterparty lineage-gap owner) — M3a.

## 2026-06-15 — BACKOFFICE-71 (PR #45, loop iteration 40) — M3a; LAST Q4.5 lineage gap closed

- Consuming-TPP registry + Trust Framework Directory sync (bank-side master list of TPPs consuming the bank's LFI APIs). GET /back-office/tpp-counterparties (list; billing:read; filters production_status/registration_state/unbilled_traffic; cursor) + GET …/{organisation_id} (detail) + POST …:sync-directory (platform:operations:write → 202: pull participants via P6 syncDirectory, upsert the registry, flag new/changed/decommissioned, tpp_directory_synced audit).
- PgTppCounterpartyStore (@ofbo/db): RLS-bound syncDirectory (read-then-write change classification; decommissions orgs absent from the directory; reinstates reappearing ones) / get / list + BCBS 239 lineage on write. Idempotency-Key on sync.
- LINEAGE GAP CLOSURE: the registry write path AND the M0 seed now emit tpp_counterparty lineage → a freshly-seeded DB has it covered. KNOWN_LINEAGE_GAPS is now EMPTY (Q4.5 gate is now stricter — any table-with-rows lacking lineage fails). lineage.int.spec self-seeds the lineage event, making its coverage assertion deterministic regardless of seed-spec ordering — this PERMANENTLY FIXED the intermittent tpp_counterparty integration flake seen throughout the session (full integration ran 64/64 TWICE with no flake). lineage-gate unit tests rewritten to explicit allowlists.
- Out of scope (stay stubs): -72 register-financial-system, -73 billing-records. No spec change.
- Evidence: 322 unit green (5 new: sync added/changed/decommissioned + audit; idempotency replay; 400/403 both directions; list+filter+detail+404+billing:read); integration proves RLS upsert + change classification + tpp_counterparty lineage, list/get tenant-bound. Full integration 64/64 ×2 (no flake); Q4.5 PASSED with zero allowed gaps; gen no drift; lint + typecheck green; coverage 100% service / 86% routes. Reviewers: hard-stop PASS (P6 egress; genuine gap closure, gate stricter), conformance CONFORMANT.
- Next eligible: BACKOFFICE-72 (TPP financial-system onboarding workflow + unbilled-traffic alert; deps 71 done) — M3a.

## 2026-06-15 — BACKOFFICE-72 (PR #47, loop iteration 41)

- TPP financial-system onboarding + unbilled-traffic alert. POST /back-office/tpp-counterparties/{organisation_id}:register-financial-system (billing:write, idempotency) → 202: registers the TPP as invoiceable in the financial management system (P9 registerCounterparty), tracks registration_state on tpp_counterparty (→ registered + financial_system_ref), clears the unbilled-traffic alert; tpp_financial_system_registered audit. Unbilled-traffic alert: TppRegistryService.recordTraffic observes traffic per TPP (store.observeTraffic → active_traffic + first_traffic_at + unbilled_traffic = not-registered); an unregistered TPP with observed traffic raises a high-severity P3 ITSM ticket + a tpp_unbilled_traffic_alert High-class audit (the Finance View signal, read by -31).
- PgTppCounterpartyStore.registerFinancialSystem + observeTraffic (RLS + lineage). TppRegistryService gains the P9 registerCounterparty port + P3 ITSM (wired via getAdapter).
- Out of scope (stays stub): -73 billing-records. No spec change.
- Test-determinism hardening: validateLineageCoverage only counts tables WITH ROWS, so -71's bare lineage-event self-seed in lineage.int.spec was non-deterministic; now it inserts a real tpp_counterparty row via the store (which emits lineage through the production write path). Full integration ran 65/65 on THREE consecutive fresh DBs (no flake); Q4.5 PASSED with zero gaps.
- Evidence: 324 unit green (4 new: register 202 + state + clears unbilled + audit; 404/400/403 incl. operations-analyst lacks billing:write; recordTraffic raises ITSM+signal for unregistered, none for registered); integration proves observe-before-register flags unbilled, register clears it + sets the P9 ref, post-registration traffic doesn't re-raise. gen no drift; lint + typecheck green; Q1–Q4.5 all pass; coverage 100% service / 91% routes. Reviewers: hard-stop PASS, conformance CONFORMANT.
- Next eligible: BACKOFFICE-73 (monthly TPP invoicing — reconcile before invoice, four-eyes invoice runs; deps 72 done) — M3a.

## 2026-06-15 — BACKOFFICE-73 (PR #48, loop iteration 42)

- Monthly TPP invoicing — the binding reconcile-BEFORE-invoice pipeline (the largest M3a story). POST /back-office/billing-records (billing:write, multipart, idempotency) → ingest a Nebras billing file: sha256 integrity hash over the file bytes, line_count derived from the deterministic sim Nebras source, status `ingested`; billing_record_set persisted under RLS + lineage. POST /back-office/billing-records/{id}:reconcile (billing:write) → 202: re-runs the three-way match (reuses runThreeWayReconciliation + buildSimReconSources) against the bank metering; fee variances open reconciliation_break rows (one nebras_billing_query_ref per break) and transition the set to `reconciled_with_breaks` (or `reconciled_clean`). POST /back-office/invoice-runs (billing:write, four-eyes) → 202 + approval_request; on approval the GatedOperation dispatches per-TPP invoice instructions to P9. GET /back-office/invoice-runs + …/{id} (billing:read).
- reconcile-before-invoice is enforced as two 409 guards: BACKOFFICE.NOT_RECONCILED (set never reconciled) and BACKOFFICE.UNRESOLVED_BREAKS (open breaks remain). Four-eyes: initiator≠approver (self-approval 409, incl. super-admin); INVOICE_RUN_OPERATION registered in the approvals registry; op.execute() runs P9 issueInvoiceInstructions on approve → status dispatched_to_p9.
- @ofbo/db: PgBillingRecordStore (create/markReconciled/get/list) + PgInvoiceRunStore (create/markStatus/get/list), RLS-bound (ofbo_app + app.bank_id), money as bigint minor units, BCBS 239 lineage at write. Migration 0011_tpp_invoicing.sql: billing_record_set + invoice_run with ENABLE+FORCE RLS, tenancy_select/insert/update + internal_view_select, no DELETE; retention_policy (24/60) + classification_policy rows. worker.ts constructs + closes both stores.
- Refinement parked (non-blocking, flagged in the PR body): invoice_run.invoices[] are currently summary-shaped ({summary, invoiceable_line_count}) rather than full per-TPP InvoiceInstruction objects — the binding acceptance (reconcile-gate + four-eyes + P9 dispatch) is met; richer invoice payloads can follow when the Finance View (-31) consumes them. No spec change.
- Evidence: unit suite green incl. new tpp-invoicing.spec (ingest integrity hash + status; 409 before reconcile; reconcile opens breaks + 409 unresolved-breaks; 403 wrong persona / 400 missing Idempotency-Key / 404 unknown reconcile / billing:read list; clean set → four-eyes 202, self-approval rejected, different principal approves → dispatched_to_p9 + P9 instructed once). Integration (tpp-invoicing.int.spec) proves ingest→reconcile(breaks)→invoice-run all persist under RLS with lineage on a local Postgres mirroring CI Q3. gen no drift; lint + typecheck green; Q1–Q4.5 all pass. Reviewers: hard-stop PASS (P9 dispatch via port, four-eyes intact, integer money, no PII, no DELETE path), conformance CONFORMANT (invoices[] summary-shape noted as non-blocking refinement).
- Deploy: run 27545713011 green (BFF→Cloudflare, portal→Cloudflare, sim→Railway, smoke suite passed).
- Next eligible: BACKOFFICE-75 (respondent-side Nebras dispute scheme clocks) — M3a.

## 2026-06-15 — BACKOFFICE-75 BLOCKED (spec PR #49, loop iteration 43)

- Picked up BACKOFFICE-75 (respondent-side Nebras dispute scheme clocks, M3a Must). Canon read surfaced a spec GAP: the baseline OpenAPI contract has no surface for the bank as RESPONDENT in a Nebras-RAISED dispute — only the Customer-Care /disputes surface (initiator, disputes:admin) and the break escalate-nebras flow (bank initiating). Reusing /disputes would breach scope hygiene (respondent/Nebras disputes are finance:disputes:write / Compliance, not disputes:admin).
- Per the spec-change skill + workflow (contract changes are human-approved, never folded into a feature PR), opened spec-only PR #49: POST/GET /back-office/disputes/respondent + GET/:advance on {id} (finance:disputes:write, Idempotency-Key), RespondentDispute/RespondentDisputeCreate/RespondentDisputeState/SchemeClockStatus schemas, respondentDisputeId param. Clock figures (response 3 bd / resolution 15 bd / appeal 3 bd of verdict / implementation 3 bd of final verdict) are Interaction Guide v4 defaults per BD-16. Composes existing scope (no new primitive). pnpm gen → 65 routes; @ofbo/contracts typecheck clean. PR #49 NOT merged — queued for human approval.
- BACKOFFICE-75 set blocked (reason: awaiting spec PR #49). The feature implementation (store + RLS/lineage, business-day clock service, routes, tests, Compliance View breach surfacing) follows once #49 merges.
- Next eligible: BACKOFFICE-32 (Nebras TPP Reports + Dataset ingestion) — M4.

## 2026-06-15 — BACKOFFICE-32 (PR #50, loop iteration 44) — M4 (Analytics) opens

- Nebras TPP Reports + Dataset ingestion: a headless scheduled job (no public ingress, like the reconciliation engine -01). Polls the Hub surfaces via the P6 egress adapter (all Nebras-bound traffic via P6) with EXPONENTIAL BACK-OFF on rate-limit/transient errors, lands each snapshot to nebras_ingest_snapshot, writes the columnar warm copy through the warm-tier exporter, and refreshes nebras_report_aggregate (the materialized aggregates the M4 views read) per channel×line_type. On exhausted back-off the prior aggregates are retained + flagged stale (amber freshness) — last-good fallback.
- P6 sim adapter fetchTppReports/fetchDataset now call the Nebras sim (NEBRAS_SIM_URL); throw NebrasEgressError on non-2xx (incl. 429) → drives back-off. NebrasEgressPort interface gains published_at (freshness source). Nebras sim: report_rate_limit fault (429 + Retry-After, self-clearing) + deterministic published_at on reports/datasets.
- migration 0012: nebras_ingest_snapshot + nebras_report_aggregate with full RLS (ENABLE+FORCE, tenancy + internal-view, no DELETE), retention 24/60, classification internal-confidential, money as bigint minor units, BCBS 239 lineage at write. worker scheduled() runs the daily ingestion alongside reconciliation (idempotent run_id per period+source).
- Out of scope (named): -31 Finance View (reads these aggregates), -40 freshness indicator on views, -33 (blocked), -67 manual LFI ingest. The real enterprise Parquet→R2 warm write is the M6 warm-tier adapter (stub now per §3.1 — no object storage provisioned in the demo, BD-14); the demo warm sink stands in and exercises the seam. No spec change (no public path; the Freshness schema already exists).
- Evidence: 6 new unit (exponential back-off delays [100,200]; aggregate math; stale fallback; warm export; audit 200/207) + 2 integration (RLS + lineage persistence, idempotent re-run, amber fallback). 323 unit green; full integration 68/68 on local Postgres mirroring CI Q3; Q4.5 PASSED (both new tables covered); gen no drift; lint + typecheck clean; ingestion service 100% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27547759063 green (smoke live).
- Next eligible: BACKOFFICE-31 (Finance View) — M4; its only dependency (-32) is now done and it precedes -28 in file order.

## 2026-06-15 — BACKOFFICE-31 (PR #51, loop iteration 45) — M4 Finance View

- Finance View: read-only analytics view (GET /back-office/analytics/finance-view, reconciliation:read at the BFF middleware AND re-checked in the service). Composes already-persisted data under one scope — MTD Nebras fee accrual (rolled up from the BACKOFFICE-32 materialized aggregates), TPP-aaS margin by fintech + product family (BACKOFFICE-07, re-derived per period), the open Nebras dispute queue, the unbilled-traffic signal (BACKOFFICE-72 aggregate count), a Reconciliation Console deep-link, and the mandatory freshness envelope (BACKOFFICE-40): fresh, or amber when the period has no ingested aggregates / the last ingest failed. Always month-to-date (current month).
- @ofbo/db: PgNebrasAggregateStore.feeAccrualForPeriod + pure rollUpFeeAccrual. ReconciliationService: marginForPeriod + openNebrasDisputeCount (read-only, reconciliation:read). analytics/finance-view.ts: FinanceViewService + route; wired in app.ts (IMPLEMENTED_ROUTES) + worker fetch() (Pg aggregate reader).
- No spec change (the path + AnalyticsView/Freshness schemas already exist; contract-pending it.fails auto-flips via IMPLEMENTED_ROUTES; gen no drift). Out of scope (named): -27 Executive Dashboard (depends on -31), -28 Operations Console, -29 Compliance View, -30 Risk View, -40 the cross-view freshness indicator.
- Reviewer fix: the contract reviewer flagged an undeclared ?period query param (drift vs the spec, which declares only x-fapi-interaction-id). Fixed by removing the param — the view is always MTD. Re-reviewed CONFORMANT.
- Evidence: 9 new unit (composition; fresh/amber/no-aggregates freshness; MTD default; malformed-period guard; scope denial; HTTP 200/403; undeclared-param ignored) + 1 integration (fee accrual over real aggregates under RLS, fresh→amber). 330 unit; full integration 69/69 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 96.7% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27549549527 green.
- Next eligible: BACKOFFICE-28 (Operations Console) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-28 (PR #52, loop iteration 46) — M4 Operations Console

- Operations Console: read-only platform-health view (GET /back-office/analytics/operations-console, platform:operations:read at the BFF middleware AND re-checked in the service). Composes Nebras connectivity + SLA targets (connected/degraded/unknown from the latest BACKOFFICE-32 ingestion snapshot; 500ms e2e / 250ms LFI-internal defaults), certification status PER ROLE (LFI + TPP scheme tracks), the TPP onboarding pipeline (BACKOFFICE-71/-72 registration-state counts), onboarding-handover health (P8), and active outages — with the freshness envelope (BACKOFFICE-40).
- migration 0013: platform_certification + platform_outage with full RLS (ENABLE+FORCE, tenancy + internal-view, no DELETE), retention 24/60, classification internal-confidential. The M0 seed inserts the scheme certification tracks + a resolved historical outage and emits BCBS 239 lineage for both (mirrors the tpp_counterparty seed). @ofbo/db: PgCertificationStore + PgOutageStore (read); PgNebrasSnapshotStore.latest(). analytics/operations-console.ts: OperationsConsoleService + route; wired in app.ts (IMPLEMENTED_ROUTES) + worker fetch(). auth.spec 501-stub probe moved off operations-console (now implemented) to the still-stubbed onboarding-handover-health route.
- No spec change (path + AnalyticsView/Freshness already exist; contract-pending auto-flips via IMPLEMENTED_ROUTES; gen no drift). No undeclared query params (the Finance View ?period drift was not repeated). Out of scope (named): -58 SLO budget-burn, -66 cert-expiry, -70 Ozone Connect health-check (later Ops Console enrichments), outage-management write endpoints.
- Evidence: 6 unit (composition; connectivity connected/degraded/unknown; scope denial; HTTP 200/403) + 1 integration (seeded certs/outages/pipeline under RLS + connectivity from a real snapshot). 334 unit; full integration 70/70 on local Postgres mirroring CI Q3; Q4.5 PASSED (both new tables covered); gen no drift; lint + typecheck clean; service 95.5% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27550908440 green.
- Next eligible: BACKOFFICE-29 (Compliance View) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-29 (PR #53, loop iteration 47) — M4 Compliance View

- Compliance View: read-only regulatory-posture view (GET /back-office/analytics/compliance-view, compliance:reports:read at the BFF middleware AND re-checked in the service). Aggregates over existing regulated tables (aggregate counts only, no PSU PII): consent volumes (by event type, from audit_high_sensitivity — the RLS-bound base table, not the bank_internal_view-only MV), retention posture (full hot/warm/immutable lifecycle + overdue-immutable flag, deletion_allowed=false), dispute backlog, open risk-signal backlog, report library (by status/type) + inquiry history (recent CBUAE inquiry reports — id/period/status only), residency posture (UAE/PDPL), one-click periodic-report-generation deep-link — with the freshness envelope (BACKOFFICE-40).
- @ofbo/db: PgComplianceMetricsStore — RLS-bound GROUP BY aggregates over audit_high_sensitivity / dispute_case / risk_signal / compliance_report. analytics/compliance-view.ts: ComplianceViewService + route; wired in app.ts (IMPLEMENTED_ROUTES) + worker fetch().
- No new tables / no migration (reads existing tables) — Q4.5 unaffected. No spec change (path + AnalyticsView/Freshness exist; contract-pending auto-flips; gen no drift). No undeclared query params. Out of scope (named): formal STR draft backlog → BACKOFFICE-37 (risk investigations), delivery-vs-CBUAE-release-calendar gap → BACKOFFICE-39 (no calendar substrate).
- PROCESS: this iteration committed -29 directly to local main by mistake (skipped the branch step despite the loop-branch-before-edit memory — reading canon created distance between the main-sync and the first edit). The reviewers caught it (branch absent); recovered with git branch <feat> at HEAD + git reset --hard origin/main + checkout (commit was unpushed). Memory reinforced: create the branch in the SAME step that picks the item, before reading canon.
- Evidence: 4 unit (composition; retention overdue flag; scope denial; HTTP 200/403) + 1 integration (consent volumes + retention posture over real seeded tables under RLS; fixed a permission-denied on the consent_admin_event MV by reading the RLS-bound base table). 336 unit; full integration 71/71 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 94.3% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27552121595 green.
- Next eligible: BACKOFFICE-30 (Risk View) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-30 (PR #54, loop iteration 48) — M4 Risk View

- Risk View: read-only analytics view (GET /back-office/analytics/risk-view, risk:read at the BFF middleware AND re-checked in the service) over risk_signal. Surfaces signal summary (active by type/severity/status), consent anomalies (consent_anomaly + cop_mismatch_spike — frequency, platform↔Nebras drift), TPP behavioural anomalies (tpp_behaviour + agent_anomaly), the proactive Nebras-liability monitor (open nebras_liability_approach signals keyed by issue × liable party × AED, via nebras_liability_event_ref), and recent signal headers — with the freshness envelope. PII-safe: typed headers + counts only, never the raw signal_data blob.
- @ofbo/db: PgRiskMetricsStore — RLS-bound aggregates over risk_signal (summary / liabilityMonitor / recentActive). analytics/risk-view.ts: RiskViewService + route; wired in app.ts (IMPLEMENTED_ROUTES) + worker fetch().
- No new tables / no migration (reads existing risk_signal) — Q4.5 unaffected. No spec change (path + AnalyticsView/Freshness exist; contract-pending auto-flips; gen no drift). No undeclared query params. Out of scope (named): threshold-based liability-event engine (BACKOFFICE-36), streaming consent-anomaly detection (BACKOFFICE-37) — they feed this view later.
- PROCESS: branch created FIRST this iteration (memory held — the -29 main-commit mistake did not recur).
- Evidence: 5 unit (composition; PII-safety header keys; scope denial; HTTP 200/403) + 1 integration (aggregates over real seeded risk_signal rows under RLS incl. a liability signal). 339 unit; full integration 72/72 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 93.3% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27553045841 green.
- Next eligible: BACKOFFICE-27 (Executive Dashboard) — M4; depends on BACKOFFICE-31 (done) and is next in file order.

## 2026-06-15 — BACKOFFICE-27 (PR #55, loop iteration 49) — M4 Executive Dashboard

- Executive Dashboard: one canonical read-only view (GET /back-office/analytics/executive-dashboard, base platform:analytics:read at the BFF middleware AND re-checked in the service) with two PERSONA-AWARE, scope-gated pivot angles. Shared headline (consent volumes, onboarding funnel, reconciliation throughput / payment-success proxy) for any platform:analytics:read holder. Commercial angle (commercial:read): revenue by product family, TPP-aaS margin totals, integration pipeline. Programme angle (programme:read): certification per role, TPP adoption. available_angles reflects scopes; super-admin (marker) sees both; a programme-only persona cannot see commercial revenue (scope hygiene). Freshness envelope. Aggregate figures only, no PSU PII. Release-calendar alignment deferred → BACKOFFICE-39 (named).
- reconciliation/service.ts: computeMarginForPeriod — non-asserting margin compute so the dashboard shows revenue/margin under its OWN commercial:read gate (the public marginForPeriod still asserts reconciliation:read for the Finance View); not bound to any route. analytics/executive-dashboard.ts: ExecutiveDashboardService + route. Composes EXISTING readers only (compliance consent volumes, recon margin, tpp pipeline, certification, P8 handover, recon latest-run) — no new store/table/migration. Shared analytics readers factored in app.ts; wired in app.ts (IMPLEMENTED_ROUTES); reuses worker-wired Pg deps.
- No new tables — Q4.5 unaffected. No spec change (path + AnalyticsView/Freshness exist; contract-pending auto-flips; gen no drift). Angle is scope-derived, not a query param (no undeclared params).
- PROCESS: branch created first (held). A reviewer subagent left the working tree on main after its git diff; caught it (the mark-done commit no-op'd on main with nothing staged), re-checked out the feature branch, and did the done-flip there — local main stayed clean at origin/main throughout. Going forward: re-assert the feature branch after dispatching reviewer subagents.
- Evidence: 8 unit (angle gating per persona incl. no-revenue-leak; super-admin both; headline-only; revenue-by-family aggregation; scope denial; HTTP 200×2/403) + 1 integration (real margin from a reconciliation run + seeded certs + consent volumes, super-admin both angles, under RLS). 345 unit; full integration 73/73 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 96.5% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27554157420 green.
- Next eligible: BACKOFFICE-34 (Onboarding funnel metrics, entry-path dimension) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-34 (PR #56, loop iteration 50) — M4 Onboarding funnel metrics

- Onboarding funnel: read-only analytics view (GET /back-office/analytics/onboarding-funnel, pipeline:read at the BFF middleware AND re-checked in the service) over the P8 onboarding-case journeys. The five canonical metrics, each with drill-down by entry path (DIRECT_SIGNUP vs ONBOARDING_HANDOVER): cycle time (avg/p50/p90 hours over activated cases, nearest-rank percentiles), handover count, stage abandonment (by funnel stage initiated→kyc→consent_grant→activated), cross-sell conversion (rate over activated), entry-path mix. Freshness envelope. Aggregate figures only, no PSU PII.
- P8 port: added getOnboardingCases + OnboardingCase/OnboardingEntryPath types — additive (getFunnelEvents untouched, so the -27/-28 consumers are unaffected). Sim adapter returns a deterministic 8-case set (5 DIRECT_SIGNUP / 3 ONBOARDING_HANDOVER; 3 abandonments; 2 cross-sells) with started_at/activated_at for cycle time. analytics/onboarding-funnel.ts: OnboardingFunnelService (pure metric computation) + route; wired in app.ts (IMPLEMENTED_ROUTES), defaults to the P8 adapter.
- No DB surface (pure P8 port + computation) — no new tables/migration, Q4.5 unaffected. No spec change (path + AnalyticsView/Freshness exist; contract-pending auto-flips; gen no drift). No undeclared query params (window derived from now()). Out of scope (named): /onboarding-handover-health (P8 health, separate path/owner), analytics exports (-41).
- Note: a user mid-session asked whether the Stitch UI/UX is implemented — answered no (the UI track UI-00..09 is deliberately post-M5, all pending; portal has only the M1 shell). The loop continued on the backend per the user's /loop trigger; the UI-promote offer stands.
- Evidence: 5 unit (five-metric computation; per-path drill-down; scope denial; HTTP 200 over the real sim adapter asserting the deterministic 8-case metrics; 403). 348 unit; full integration 73/73 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 96.2% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27555540106 green.
- Next eligible: BACKOFFICE-35 (Self-service CBUAE periodic report generation, four-eyes when CBUAE-bound) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-35 (PR #57, loop iteration 51) — M4 Report Generator

- Self-service CBUAE periodic report generation — 6 endpoints (reports tag). POST /back-office/reports:generate (compliance:reports:generate) parameterises ENGINEERING-defined pre-registered templates (cbuae_monthly, cbuae_quarterly, internal_consent_volume); builds deterministic content + a SHA-256 integrity hash; persists a compliance_report (5-yr archived, RLS + lineage). CBUAE-bound templates are four-eyes-gated → land awaiting_approval + an approval; POST {id}:approve (programme:read) resolves via the approvals service (initiator≠approver, enforced even for super-admin); non-CBUAE → approved immediately. POST {id}:submit (compliance:reports:generate) → submitted after manual upload (409 unless approved). GET /reports (list, cursor, report_type/status filters) + /{id} + /{id}/download?format=pdf|xlsx (binary + X-Content-SHA256). compliance:reports:read on the reads. Idempotency-Key on all mutations.
- migration 0014: additive compliance_report.approval_id (four-eyes link). @ofbo/db PgComplianceReportStore: + list / markStatus / getContent (+ approval_id on create/select); content PII-redacted at rest; lineage on the write paths. reports/generation.ts: ReportGenerationService + REPORT_TEMPLATES + makeReportGenerationOperation (registered in the approvals registry) + routes; worker wires reportStore = the shared Pg compliance_report store. Real PDF/XLSX rendering is the downstream/enterprise concern (same posture as -06/-23); the demo serves a deterministic canonical serialization per format with its sha256.
- No spec change (paths + Report/ComplianceReport/ReportStatus exist; contract-pending auto-flips; gen no drift). Conformance reviewer informational note: integrity_hash is computed at generation (spec description says "set once approved") — contract permits it (nullable free-text field); left as-is. Out of scope: real binary rendering.
- Evidence: 5 unit (non-CBUAE ready; CBUAE awaiting_approval→approve→submit; super-admin self-approval → 409; 400/403/409 guards; list + download + hash) + 1 integration (persist awaiting_approval + approval_id + lineage under RLS, four-eyes approve → approved → submitted). 341 unit; full integration 74/74 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 95.6% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27559060353 green.
- Next eligible: BACKOFFICE-36 (Proactive Nebras-liability monitor — issue × liable party × AED; dep BACKOFFICE-30 done) — M4.

## 2026-06-15 — BACKOFFICE-36 (PR #58, loop iteration 52) — M4 Proactive Nebras-liability monitor

- The Limitation of Liability Model v2.1 amounts (AED) keyed issue × liable party (LFI/TPP). Monitor engine (LiabilityMonitorService.evaluate): ingests liability events, accrues per issue × party, and when accrual crosses the configurable per-class threshold raises a nebras_liability_approach risk signal (ref = issue|party|AED, severity by amount) + a P3 ITSM ticket to Risk AND Ops — deduped against the currently-open liability signals (idempotent across scheduled runs). Wired into the worker scheduled() job. Read view GET /back-office/analytics/nebras-liability-monitor (risk:read): the matrix + approaching triggers (parsed from the open signals' refs) + freshness envelope.
- @ofbo/db PgRiskSignalEmitter now persists nebras_liability_event_ref + client_id (additive; columns pre-exist from 0002; existing callers unaffected). risk/liability.ts: LIABILITY_MATRIX + SLA_TIERS, LiabilityMonitorService + LiabilityViewService + DemoLiabilityEventSource + route. worker scheduled() runs the monitor alongside reconciliation + ingestion.
- No new tables (reuses risk_signal) — Q4.5 unaffected. No spec change (path + AnalyticsView/Freshness exist; contract-pending auto-flips; gen no drift). No undeclared query params. Informational signals + ITSM only (not four-eyes-gated — correct). Out of scope (named): streaming consent-anomaly detection (-37); the Risk View liability widget (-30, shipped).
- Evidence: 8 unit (matrix/tiers; threshold-crossing → signal + ITSM Risk+Ops; dedup; below-threshold; view composition; scope 403; HTTP 200/403) + 1 integration (emit under RLS + ref + lineage; dedup on re-run; view surfaces it). 347 unit; full integration 75/75 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 88.4% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27560316122 green.
- Next eligible: BACKOFFICE-37 (Consent-pattern anomaly detection, streaming; dep BACKOFFICE-30 done) — M4.

## 2026-06-15 — BACKOFFICE-37 (PR #59, loop iteration 53) — M4 Streaming consent-pattern anomaly detection

- A windowed scan over audit_high_sensitivity flagging two patterns → Risk signals (session flagged), deduped across runs by a key in signal_data: (a) consent revoke+re-grant >5×/24h per PSU → consent_anomaly (PSU referenced by a SHA-256 hash, never the raw id; severity scales); (b) >100 PSU lookups (consent_search)/agent/hour → agent_anomaly (agent subject = internal id, not a PSU). Thresholds configurable per class. Signal-producer only — no new endpoint; the signals surface in the Risk View (-30) + risk-signals endpoints. ITSM routing is BACKOFFICE-46.
- @ofbo/db: PgAnomalyDetectionStore (RLS-bound windowed aggregates: consentChurnByPsu, lookupCountByAgent, openAnomalyDedupKeys). PgRiskSignalEmitter now carries optional dedup_key + context merged into signal_data (additive; existing callers byte-identical when unused). risk/consent-anomaly.ts: ConsentAnomalyDetector. worker scheduled() runs it alongside reconciliation / ingestion / liability, deduping against open anomaly signals.
- No new tables (reuses audit_high_sensitivity + risk_signal) — Q4.5 unaffected. No spec change (no endpoint; signal_type/severity/status within the RiskSignal enums; gen no drift). PII-clean: the persisted churn signal carries a hashed ref + counts only (asserted in unit + integration). Out of scope (named): -46 ITSM ticket-raising for anomalous audit patterns (depends on -37).
- Evidence: 5 unit (churn/agent thresholds; severity; dedup; configurable thresholds; no raw PSU id in the signal) + 1 integration (real audit rows → signals under RLS with session flag + hashed ref; re-run dedups). 352 unit; full integration 76/76 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; detector 100% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27561284557 green.
- Next eligible: BACKOFFICE-39 (Programme-level reporting view) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-39 (PR #60, loop iteration 54) — M4 Programme-level reporting view

- Enriches the Executive Dashboard Programme angle (BACKOFFICE-27, the Programme Manager's surface per PRD §2) with: certification status per role, TPP onboarding readiness (ready/in-progress from the registration pipeline), CBUAE mandatory-release-calendar alignment (delivery-vs-deadline gap per release: delivered/on_track/at_risk/overdue + overdue/at-risk counts), and multi-entity group visibility (per licensed entity's LFI certification). Replaces the release_calendar stub -27 deferred to -39. No dedicated programme endpoint exists in the contract — the Programme angle lives on the existing executive-dashboard path.
- analytics/programme.ts: ProgrammeReportService (pure builder) + CBUAE_RELEASE_CALENDAR + GROUP_ENTITIES (engineering/programme-maintained reference data, like report templates + the liability matrix). ExecutiveDashboardService delegates its Programme angle to the injected builder.
- No new tables/migration (config + composition over certs + pipeline) — Q4.5 unaffected. No spec change (data is free-form in AnalyticsView; gen no drift). The -27 commercial/programme scope separation is intact (a commercial-only persona does not get the programme angle). Aggregate figures only, no PSU PII. Out of scope (named): a standalone programme endpoint (none in the contract).
- Evidence: 4 unit (certification/readiness/multi-entity; release-calendar gap delivered/on_track/at_risk/overdue) + the enriched -27 dashboard unit + integration (programme angle asserts release_calendar + multi_entity over real seeded stores). 356 unit; full integration 76/76 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; programme.ts 100% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27562105848 green.
- Next eligible: BACKOFFICE-40 (Data-freshness indicator on every aggregated view) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-40 (PR #61, loop iteration 55) — M4 Data-freshness indicator standard

- A single shared freshness helper (BO-OQ-23): source-publish + view-refresh timestamps + amber (stale) when the source is older than 2× its refresh cadence + cause; a domain staleness signal (extraStale) wins over the age check. Every aggregated view now routes its Freshness through it, so the contract is uniform.
- analytics/freshness.ts: liveFreshness (live-computed views → always fresh) + computeFreshness (2×-cadence age threshold + missing-source + extraStale precedence) + FRESHNESS_CADENCE. source_published_at omitted (never null) when no source. Live views (executive-dashboard, risk-view, compliance-view, onboarding-funnel, liability monitor) → liveFreshness (behaviour preserved). Source-backed: finance-view (monthly roll-up cadence; accrual.stale wins) + operations-console (Nebras connectivity = last poll ingested_at vs 2× daily; degraded signal wins). Existing per-view causes preserved.
- No spec change (Freshness schema unchanged; AnalyticsView data free-form; gen no drift). No new tables/endpoints. Reviewer caught a pre-existing nullability gap (source_published_at: null vs the non-nullable contract field, latent since -31/-28); fixed by omitting the optional key — re-reviewed CONFORMANT.
- Evidence: 6 unit (helper: fresh/amber at the 2× boundary incl. strict >; missing-source omits the key; extraStale precedence; liveFreshness) + all 7 view suites green. 362 unit; full integration 76/76 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; freshness.ts 100% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT (after the nullability fix). Deploy 27563216006 green.
- Next eligible: BACKOFFICE-42 (Audit-trail drill-down from Compliance and Risk Views) — M4; pending, no unmet deps, next in file order.

## 2026-06-15 — BACKOFFICE-42 (PR #62, loop iteration 56) — M4 Audit-trail drill-down

- Audit-trail drill-down from the Compliance and Risk Views: GET /audit/events (audit:read; filter acting_principal / target_psu_identifier / event_type / from / to; cursor) + GET /audit/events/{event_id} (audit:read; single record). Returns the FULL High-class audit record (target ids + redacted body — PII redacted at emission). The drill-down access is itself logged (an audit_trail_accessed High-class event, INSERT-only). Scope double-enforced.
- @ofbo/db PgAuditReader: + query(filters, cursor) + get(id) returning the full StoredAuditEvent, RLS-bound, SELECT-only (INSERT-only audit guarantees untouched), keyset cursor on (created_at, id). audit/events.ts: AuditEventsService (query/get, each logs the access) + routes + InMemoryAuditEventReader. Wired in app.ts (IMPLEMENTED_ROUTES) + worker fetch() (PgAuditReader).
- No new tables/migration (reads audit_high_sensitivity) — Q4.5 unaffected. No spec change (paths + AuditEvent schema exist; contract-pending auto-flips; gen no drift). All query params declared in the contract (no undeclared-param drift).
- Evidence: 6 unit (query + filter + full record + access-logged; get 200/404; 403 for a non-audit:read persona) + 1 integration (real trail under RLS; drill-down access persisted, INSERT-only). 364 unit; full integration 77/77 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean; service 96.1% stmts. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27564172211 green.
- Next eligible: BACKOFFICE-46 (ITSM ticket-raising for anomalous audit patterns; dep BACKOFFICE-37 done) — M4.

## 2026-06-15 — BACKOFFICE-46 (PR #63, loop iteration 57) — M4 ITSM ticket-raising for anomalous audit patterns

- Builds on the BACKOFFICE-37 anomaly detector: threshold-crossed anomalies now raise a P3 ITSM ticket with team routing (Risk for consent-churn/lookup-volume, Security for 403s/off-hours) + a parallel page (audit_anomaly_page → on_call) for severity-critical (>3× threshold). Two new patterns detected: repeated authorization denials (>10 scope_denied/agent/1h) and off-hours admin activity (>15 admin-scope actions/agent/24h outside 06:00–18:00 UTC, excluding system principals). Severity scales by threshold multiple (1×→base, 2×→high, 3×→critical). Tickets fire only on emitted/deduped anomalies (no re-ticket spam).
- ConsentAnomalyDetector gains an optional itsm dep (omit → signals only, the -37 posture). @ofbo/db PgAnomalyDetectionStore: + scopeDenialsByAgent + offHoursAdminByAgent (RLS-bound windowed SELECTs over audit_high_sensitivity). worker scheduled() passes the P3 adapter to the detector.
- No new tables (reads audit_high_sensitivity) — Q4.5 unaffected. No spec change (no endpoint; gen no drift; signal_type/severity within RiskSignal enums; ITSM calls match the P3 port). No raw PSU PII (agent subjects internal ids; churn ref hashed). Reviewer non-findings (not blocking): off-hours window is UTC-based (UAE is UTC+4) + on_call team hardcoded — demo-config details.
- Evidence: 4 unit (team routing Risk/Security; the 2 new rules; critical parallel paging; no-itsm signal-only posture) + 1 integration (403s + off-hours over real audit rows → agent_anomaly under RLS + Security ITSM). 368 unit; full integration 78/78 on local Postgres mirroring CI Q3; Q4.5 PASSED; gen no drift; lint + typecheck clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27564961244 green.
- Next eligible: BACKOFFICE-67 (Manual cadence ingest of the 16 login-only Nebras LFI reports) — M4; the LAST remaining M4 item (-33 blocked on BD-13).

## 2026-06-15 — BACKOFFICE-67/-77/-78 spec gaps (PRs #64/#65/#66, loop iteration 58) — M4/M4a contract-first

- Spec-gap iteration: the next three eligible items (BACKOFFICE-67 last M4, then M4a -77/-78) all require contract surfaces the baseline OpenAPI never specced. Per the spec-change discipline (spec → tests → code; contract changes are human-approved, never self-merged), each was opened spec-first and parked `blocked`. No feature code merged this iteration — these are queued human decisions.
- **BACKOFFICE-67** (PR #64): manual verified ingest of the 16 login-only Nebras LFI reports. The contract *references* -67 (billing-record ingest "same pattern", PRD §3 limitation) but had no path. Added POST/GET /back-office/lfi-reports (multipart verified upload → compliance_report + integrity hash + lineage; cadence-health listing) + LfiReportCadence/LfiReportCadenceStatus. Reuses ComplianceReport; scopes compliance:reports:generate/read (held by compliance-officer).
- **BACKOFFICE-77** (PR #65): Nebras fraud-incident reporting + scheme-imposed holds. Extends the BACKOFFICE-22 fraud workflow (which only revokes + drafts an STR — confirmed no incident/pause/hold concept anywhere). Added POST/GET /back-office/fraud-incidents + :resolve (Nebras-helpdesk case capture, P1–P4→ITSM priority map, operational-pause) + NebrasSeverity/FraudIncident. Scheme holds surfaced in existing Ops/Risk view data (free-form) + headless ingest — no path. Scopes risk:read/risk:investigations:write (held by risk-analyst).
- **BACKOFFICE-78** (PR #66): outbound downtime/change notifications. Added POST/GET /back-office/scheme-notifications + :acknowledge (10-day / 30-day breaking-change notice clocks, dual-running checklist, downstream-TPP propagation, ack tracking) + SchemeNotificationType/SchemeNotification. Trust Framework status ingest is headless. Scopes platform:operations:read/write (held by operations-analyst).
- Each spec PR: minimal scoped edit + regenerated client committed alongside (spec-PR convention from #49); no scope-matrix widening; no new primitive. Not merged — flagged HUMAN-APPROVED.
- M4 is now functionally complete (all built items merged; -33 blocked on BD-13, -67 awaiting spec #64). M4a both blocked on spec (#65/#66).
- Next eligible (next firing): BACKOFFICE-09 (Reconciliation Console SLO dashboard) — M5; pending. Likely also needs a new aggregated SLO read surface (no /reconciliation/slo path exists) — assess spec-first on pickup.

## 2026-06-15 — BACKOFFICE-09 spec gap + BACKOFFICE-10 (PRs #67 spec / #68, loop iteration 59) — M5

- M5 entered. BACKOFFICE-09 (Reconciliation SLO dashboard) needed a read surface the baseline never specced → spec PR #67 (GET /back-office/analytics/reconciliation-slo → AnalyticsView, reconciliation:read; no new schema, AnalyticsView data is free-form). Parked blocked pending human approval. BACKOFFICE-10's contract (POST /reconciliation/runs:replay) already existed, so it was built and merged this iteration.
- **BACKOFFICE-10 (PR #68, merged)** — reconciliation replay over a date range from buffered (sim, deterministic) source data, for a missed/failed daily run. ReconciliationService.replay(): platform:operations:write (double-enforced BFF middleware + service assertScope); validates the window (400 non-ISO / end<=start); window-derived run_id (recon-replay-<start>_<end>) makes a repeat replay of an unchanged window an idempotent no-op (store ON CONFLICT → existing run; break detection + run-completion audit only on an actually-executed run). Human initiator High-class audited (reconciliation_replay_requested); BCBS 239 lineage rides reconciliation_log. runDaily gained an optional runId override. Route: Idempotency-Key required (400 if absent); 24h verbatim replay keyed by window. 202 + ReconciliationRun. Added to IMPLEMENTED_ROUTES (flips the contract-pending sweep to real tests).
- Evidence: 4 unit (202 + run_type=replay + initiator audit; window idempotency/created-once; key replay no re-exec; 403 finance-analyst + 400 missing-key + 400 invalid-window) + 1 integration (real Postgres under RLS: replay run persisted, lineage emitted, initiator audited, idempotent no-op writes no second run / no second run-completion audit). 370 unit + 79 integration green; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27567246314 green.
- Human-gated spec PRs now queued: #49 (-75), #64 (-67), #65 (-77), #66 (-78), #67 (-09). ADR-0001 (-25) + BD-13 (-33) still open.
- Next eligible: BACKOFFICE-12 (Configurable break thresholds per fee class) — M5; contract /reconciliation/thresholds already exists (buildable).

## 2026-06-15 — BACKOFFICE-12 (PR #69, loop iteration 60) — M5 Configurable break thresholds per fee class

- Configurable per-fee-class break thresholds, persisted so the reconciliation engine reads the current set at run time → edits take effect on the NEXT run, never retroactively (a prior run's breaks are immutable). GET /back-office/reconciliation/thresholds (reconciliation:read) returns the effective set (stored overrides overlaid on engine defaults, all 5 classes resolve); PUT (platform:operations:write, double-enforced) validates fee_class/unit/non-negative-integer, upserts per class, High-class audits old/new (effect: next_run_only), notifies Finance + Compliance via P3 ITSM, Idempotency-Key required.
- packages/db: migration 0015 reconciliation_threshold (full RLS enabled+forced, retention 24/60, classification, no DELETE) + PgReconciliationThresholdStore (upsert + list + BCBS 239 lineage at write time); added to the Q4.5 validateLineageCoverage table list (lineage not retrofitted). ReconciliationService gained a thresholdStore dep + effectiveThresholds() read at detection time + getThresholds/updateThresholds; worker fetch()/scheduled() wire the Pg store so production runs honour configured thresholds.
- No spec change (GET/PUT /reconciliation/thresholds + Threshold schema already existed; gen no drift). Three pre-existing tests (rbac/superadmin/telemetry) that used /reconciliation/thresholds as a "501 stub" example repointed to the still-unimplemented /back-office/lineage/{table_name} — non-regressive.
- Evidence: 6 unit (GET defaults; PUT update + old/new audit + Finance/Compliance notify; idempotency replay; 403 scope ×2 + 400 validation ×4; thresholds drive detection on identical data; edits non-retroactive) + 1 integration (Pg under RLS: persist + lineage + audit + upsert-in-place). 372 unit + 80 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27568732841 green.
- Noted (spec-faithful, not blocking): GET requires reconciliation:read which operations-analyst (PUT persona) does not hold — the spec assigns the scopes that way; changing it would be a spec change.
- Next eligible: BACKOFFICE-15 (Reconciliation console WCAG 2.1 AA) — M5; a frontend a11y story over the reconciliation console UI, which lives in the deferred UI track (UI-03, gated on the UI-00 Tailwind ADR). Likely blocks pending the UI track; assess on pickup.

## 2026-06-15 — BACKOFFICE-15 blocked + BACKOFFICE-24 (PR #70, loop iteration 61) — M5

- BACKOFFICE-15 (Reconciliation console WCAG 2.1 AA) blocked on main: it is a11y over the break list + detail VIEWS, which require the reconciliation console UI (UI-03) — that screen lives in the deferred UI track, gated on the UI-00 Tailwind ADR (human-approved). Confirmed the portal is only the M1 shell (login + dashboard + shell components); no recon console exists, so there is nothing to make accessible yet. depends_on: [UI-03-RECON-CONSOLE].
- **BACKOFFICE-24 (PR #70, merged)** — complaint/dispute case-management lifecycle. Complaints are dispute_type (consent_complaint/data_misuse_complaint); implemented the stub PATCH /disputes/{dispute_id} (the §6.3.1 state machine): open → in_progress → escalated → resolved → closed. DisputeService.updateState (disputes:admin, double-enforced) validates transitions (409 illegal; refund_initiated reserved for the BACKOFFICE-21 four-eyes refund flow → 409, never bypassed; 400 unknown state; 404 unknown case), records escalated_to/resolution_note, computes the resolution SLA deadline from the complaint SLA matrix (adopting-bank default per PRD §10 until BD-11) + flags sla_breached, writes one High-class dispute_state_changed audit. Idempotency-Key required.
- packages/db: migration 0016 (additive dispute_case columns escalated_to/resolution_note/state_changed_at — RLS/retention/classification already bind the table; ofbo_app already holds UPDATE) + PgDisputeStore.updateState (write-only metadata; BCBS 239 lineage). business-hours: endOfNthBusinessDay (weekend-pausing). from_state captured before the update (stores may mutate in place).
- No spec change (PATCH /disputes/{dispute_id} + DisputeState already existed; gen no drift). DisputeCase wire response unchanged — the new columns are write-only (not in the schema; surfacing them would be a separate spec change), confirmed by the conformance reviewer's field-by-field no-leak check.
- Evidence: 5 unit (full open→closed walk + per-transition audit + SLA deadline + escalated_to/resolution_note captured; illegal 409 + refund_initiated 409 + bad state 400; 403 scope + 400 missing-key + 404; idempotency replay; service-level SLA-breach flag) + 1 integration (Pg under RLS: transition persists metadata + lineage + audit; illegal transition rejected). 375 unit + 81 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27569941679 green.
- Next eligible: BACKOFFICE-26 (Console design-system + Al Tareq brand conformance) — M5; a UI/design-system story that overlaps the UI-00 design-system work (Tailwind ADR, human-gated). Assess on pickup (likely blocks on the UI track / ADR).

## 2026-06-15 — BACKOFFICE-26/-61/-64 disposed + BACKOFFICE-38 (PR #72, loop iteration 62) — M5

- Disposed three gated M5 items, delivered one feature:
  - BACKOFFICE-26 (console design-system + Al Tareq brand) → blocked on UI-00 (Tailwind ADR, human-approved) + the deferred UI track; no console UI beyond the M1 shell to apply brand conformance to.
  - BACKOFFICE-61 (multi-auth payment-consent visibility) → spec PR #71 (multi_auth lacks the M-of-N pending threshold the PRD requires; threshold/received/pending + per-authoriser authorised_at queued for human approval), blocked. Also needs synthetic-data multi-auth consents + the :admin detail endpoint once merged.
  - BACKOFFICE-64 (call/transcript linkage) → blocked: originating_call_id is already captured + surfaced on disputes (BACKOFFICE-20, nullable for non-voice, disputes:admin), but resolving it to a contact-centre recording needs a new CareSurfacePort (P1) method + a recording-link surface — a platform-primitive + contract decision (human-gated).
- **BACKOFFICE-38 (PR #72, merged)** — TPP behavioural profiling. Headless profiler comparing each consuming TPP's current behaviour to its own rolling baseline (mean+stddev) across volume / hour-of-day concentration / CoP mismatch; a metric beyond the configurable sigma band (default 3σ) emits one tpp_behaviour Risk signal per TPP (severity by worst z), surfaced by the existing Risk View. Deduped across runs (signal_data.dedup_key = tpp_behaviour|<client_id>). Subject is the TPP org/client id — never PSU PII. tpp-profiling.ts (TppBehaviourProfiler + DemoTppActivitySource, mirrors the -36 liability monitor); worker scheduled() runs it reusing PgRiskSignalEmitter (sink, lineage) + PgAnomalyDetectionStore (dedup); @ofbo/db openAnomalyDedupKeys also returns open tpp_behaviour keys (additive, disjoint namespaces).
- No spec change (tpp_behaviour already in the risk_signal enum + Risk View; no endpoint; gen no drift). No new table — Q4.5 unaffected (risk_signal lineage-covered).
- Evidence: 5 unit (>3σ spike → signal w/ deviation context + client_id + dedup_key + critical severity; within-band + zero-stddev never flag; one signal per TPP across metrics; dedup; configurable sigma) + 1 integration (Pg under RLS: 2 demo outliers persist tpp_behaviour w/ client_id + dedup_key; second run dedups). 380 unit + 82 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27571703636 green.
- Next eligible: BACKOFFICE-41 (Analytics exports PDF/XLSX/CSV) — M5; contract POST /back-office/analytics/exports already exists (buildable). Then -58 (SLO observability in Ops Console).

## 2026-06-15 — BACKOFFICE-41 (PR #73, loop iteration 63) — M5 Analytics exports (PDF/XLSX/CSV)

- POST /back-office/analytics/exports: export an aggregate analytics view to a downloadable artifact, SHA-256 integrity hash, requester identity High-class audited (analytics_export), synchronous (well under <30s p95). Aggregate/synthetic data only — views carry no PSU PII.
- AnalyticsExportService: the route's x-required-scope is the dynamic "(scope of the exported view)" — the BFF middleware defers it; the per-view scope is enforced in the service (assertScope, EXPORT_VIEW_SCOPE mirrors the analytics route table) AND again when the view service is invoked (defence in depth). Validates view (400) + format (400). 202 returns a ComplianceReport-shaped receipt — format encoded in report_type (analytics_export:<view>:<format>) + the audit, so the wire stays ComplianceReport-conformant (no extra fields). Idempotency-Key required.
- ExportRenderer/DemoExportRenderer: CSV is a real key/value sheet; pdf/xlsx are deterministic export documents (labelled header + canonical JSON) — viewer-grade binaries are an enterprise-adapter concern (M6); all three are stable bytes for the hash. app.ts: a ViewDataSource delegates to the 7 implemented view services (each re-asserts its own scope) so an export carries the live view data.
- No spec change (path + Report response already existed; gen no drift). No new table — Q4.5 unaffected.
- Evidence: 5 unit (202 + ComplianceReport receipt + integrity hash + requester audit; per-view scope 403/202; view+format+key validation; idempotency replay; hash differs by format) + 1 integration (Pg under RLS: analytics_export audit persists with requester + view/format/integrity_hash). 383 unit + 83 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27572789424 green.
- Next eligible: BACKOFFICE-58 (SLO observability in the Operations Console) — M5; extends the operations-console view (free-form data) with budget burn rate / error budget / SLO target. Likely buildable (no spec change). Then -66 (cert expiry monitoring), -68, -69, -74, -76, -79, -70.

## 2026-06-16 — BACKOFFICE-58 (PR #74, loop iteration 64) — M5 SLO observability in the Operations Console

- SLO panel added to the operations-console view: per SLO the target, observed attainment, error-budget remaining, and burn rate, plus a status summary — surfaced in the console with no separate APM login (data rides the platform's own OTel/APM stream; enterprise adapters feed real observed attainment).
- analytics/slo.ts: computeSlo (error budget = 100−target, consumed = 100−observed, remaining = (allowed−consumed)/allowed, burn = consumed/allowed; target 100% → no div-by-zero) + summarizeSlos + DemoSloReader (deterministic healthy/at-risk/breach mix, 30-day window). operations-console view gains an optional slo reader (default DemoSloReader, injectable for the enterprise feed) and emits data.slo = { window_days, summary, slos[] }. Additive to the free-form AnalyticsView data; freshness envelope unchanged.
- No spec change (AnalyticsView data free-form; no endpoint; gen no drift). No new table — read-only/computed; Q4.5 unaffected. platform:operations:read unchanged.
- Evidence: 7 unit (computeSlo healthy/breach/at_risk/target-100 edge + summarizeSlos; ops-console slo section present + summary; injected-reader enterprise swap). 390 unit + 83 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT. Deploy 27573498486 green.
- Next eligible: BACKOFFICE-66 (Scheme certificate expiry monitoring 60/30/7-day) — M5; headless monitor over the Root CA → Al Tareq Intermediate → bank end-entity chain (amber 60d / red+ITSM 30d / critical+ITSM+audit 7d), surfaced in the Ops Console. Buildable (no spec change).

## 2026-06-16 — BACKOFFICE-66 (PR #75, loop iteration 65) — M5 Scheme certificate expiry monitoring

- Monitors the FAPI 2.0 chain (Root CA → Al Tareq Intermediate → bank end-entity; the chain itself is handled by the egress gateway P6). Classifies each cert by days-to-expiry — amber ≤60d, red ≤30d, critical ≤7d — surfaces the classified chain in the Operations Console, and a scheduled monitor escalates: red → P3 ITSM ticket (Security), critical → ITSM ticket + a High-class cert_expiry_critical audit entry.
- ops/cert-expiry.ts: classifyCert + worstStatus + classifyChain (read surface) + CertExpiryMonitor.check (red→ticket, critical→ticket+audit; re-raises each scheduled run — an expiring cert is a persistent condition until renewed) + DemoCertChainSource (deterministic root(ok)→intermediate(red)→end-entity(critical), injectable for the enterprise feed). operations-console view emits data.scheme_certificates = { chain[], worst_status }; worker scheduled() runs the monitor with P3 ITSM + the audit sink.
- No spec change (AnalyticsView data free-form; monitor headless — no endpoint; gen no drift). No new table — Q4.5 unaffected. platform:operations:read unchanged.
- Evidence: 6 unit (classify ok/amber/red/critical incl. boundaries + worstStatus; monitor red→ticket-only / critical→ticket+audit / ok-amber→neither; no-itsm posture; DemoCertChainSource chain; ops-console scheme_certificates surface) + 1 integration (Pg under RLS: critical cert writes cert_expiry_critical audit, red does not; both ticket Security). 396 unit + 84 integration green on a clean local Postgres mirroring CI Q3; gen no drift; lint + tsc clean. Q1–Q4.5 all pass. Reviewers: hard-stop PASS, conformance CONFORMANT (non-blocking note: no dedup — re-raises each run, intentional for a persistent expiry condition). Deploy 27574226833 green.
- Next eligible: BACKOFFICE-68 (Dynamic Account Opening reconciliation coverage) — M5. Then -69, -74, -76, -79, -70.

## 2026-06-16 — BACKOFFICE-68/-69 (loop iteration 66) — PAUSED on GitHub Actions billing block

- BACKOFFICE-68 (DAO reconciliation coverage): spec PR #76 opened (dao_api_call added to the LineType enum), item blocked pending human approval.
- BACKOFFICE-69 (CAAP registration/deregistration audit + >10/device/hour anomaly watch): CODE COMPLETE on feature/BACKOFFICE-69-caap-registration-audit, PR #77 open. Local gates green (401 unit + 85 integration on a clean local Postgres; gen no drift; lint + tsc clean); reviewers hard-stop PASS + conformance CONFORMANT. NOT merged — see below.
- **LOOP PAUSED — CI infrastructure blocked.** All five CI gates on PR #77 failed to start (zero steps, ~2–10s) across the initial run AND a re-run. Root cause is account-level, not code: the GitHub check-run annotation reads "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings." No code change or re-run can clear this.
- Required human action: restore GitHub Actions billing (Settings → Billing & plans / raise the spending limit). Once CI can run: re-run PR #77's checks; on green, merge #77 (BACKOFFICE-69) + verify deploy + log; then resume the loop. No third CI re-run will be attempted until billing is fixed (avoid thrashing).
- Human-gated queue unchanged: spec PRs #49, #64, #65, #66, #67, #71, #76; ADR-0001 (-25); BD-13 (-33); UI track (-15, -26); -64 port decision. Session merged so far: BACKOFFICE-10, -12, -24, -38, -41, -58, -66.

## 2026-06-16 — BACKOFFICE-70 (PR #78, loop iteration 67) — M5 Ozone Connect health (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI billing block, see iteration 66): code built + locally verified + reviewed + PR opened, but NOT merged until GitHub Actions billing is restored.
- BACKOFFICE-70 (LFI Ozone Connect health-check surfacing): ops/ozone-health.ts (OzoneHealth + OzoneHealthSource + DemoOzoneHealthSource; enterprise adapter polls real /health via P6) + operations-console view emits data.ozone_connect = { status, checked_at, uptime_pct_30d, last_failure_at }. Additive to the free-form AnalyticsView data; platform:operations:read. No spec change, no new table (Q4.5 unaffected). 3 unit; 399 unit + 84 integration green on a clean local Postgres; gen no drift; lint + tsc clean. Reviewers: hard-stop PASS, conformance CONFORMANT. PR #78 open — NOT merged (CI cannot run). Touches files disjoint from PR #77 (-69) → both merge cleanly off main in any order.
- BACKOFFICE-74/-76/-79 blocked as contract gaps (new resource / new dispute fields / new service-desk resource); spec PRs deferred during the billing outage to keep build-ahead focused on code-buildable items.
- **M5 buildable code is now drained.** Outstanding M5 = human-gated only: PRs awaiting CI (#77 -69, #78 -70); spec PRs to merge (#49/-75, #64/-67, #65/-77, #66/-78, #67/-09, #71/-61, #76/-68) + 3 to author (-74/-76/-79); ADR-0001 (-25); BD-13 (-33); UI track (-15/-26 + UI-00..09). Session merged: BACKOFFICE-10, -12, -24, -38, -41, -58, -66.
- Resume on CI/billing restore: re-run #77 + #78 checks → merge both → verify deploys → flip -69/-70 done → then the human-gated queue.

## 2026-06-17 — UI-00 + UI-01 (PRs #79 / #80, build-ahead) — UI track kickoff (Stitch + Tailwind)

- Stitch MCP restored (after /reload-plugins) + pnpm installed (npm i -g pnpm 9.15.0) — unblocked the design-system foundation. UI build-ahead (CI/merge still gated on Actions billing).
- UI-00 (DONE, PR #79): adopt-Tailwind ADR (0002) + repo-canonical design tokens reconciled VERBATIM against the live Stitch "Open Finance Back Office" Material 3 system (color roles, radii, 4px spacing/density, Inter/JetBrains/Material-Symbols). Tailwind preset (tailwind.config.ts from tokens) + postcss; globals.css migrated off the --ofbo-* palette onto token utilities (DEMO banner → bg-demo = #b54708, verified); no-raw-style lint test (CI lint fails on raw hex/px in components). tailwindcss@^3 added (pnpm-lock updated). Tailwind compiles clean.
- UI-01 (DONE, PR #80, stacked on #79): design-system app shell translated from the Stitch "OFBO Portal" screen — 240px (w-60) collapsible sidebar + 64px (h-16) top bar (verbatim Stitch token classes), scope-aware nav (lib/nav.ts visibleModules hides modules outside the §2 matrix; super-admin sees all), persona badge (absorbs the M1 scope-echo), global search slot, density toggle, all React-state (no browser storage). Dashboard renders inside AppShell; root layout keeps the DEMO banner above the shell; login stays centred + token-styled.
- Stitch screen inventory pulled (project 8050269076066130289): consoles for Customer Care / Reconciliation / Investigation / Four-Eyes / Analytics / Risk / TPP Billing / Operations (+ Refined/Hardened iterations) + cert-expiry, SLO, shadow-TPP, bulk-revoke, CBUAE inquiry, consent manager, mobile screens. Next UI: UI-02 (Customer Care Console).
- Evidence: 414 unit green (incl. 8 token + 3 no-raw-style + 7 app-shell/nav); portal tsc clean; eslint clean; gen no drift; Tailwind compiles all shell utilities. Reviewers: hard-stop PASS (UI-00 + UI-01); conformance N/A (no API/spec change). Build-ahead — not merged (Actions billing); UI-01 base = UI-00 branch (stacked).
- CLAUDE.md gained the binding UI/UX convention: build every portal screen against the Stitch project as the appearance reference.

## 2026-06-17 — UI-02-CARE-CONSOLE (PR #81, UI track) — M2 Customer Care Console (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block, see iteration 66): code built + locally verified + both reviewers clean + PR #81 stacked on UI-01 (feature/UI-01-app-shell), NOT merged until GitHub Actions billing is restored. UI track branches: UI-00a/b (Tailwind ADR-0002 + Stitch design tokens + preset), UI-01 (app shell), UI-02 (this) — merge in stack order UI-00 → UI-01 → UI-02.
- **First full-pipeline proof**: tokens → component → OpenAPI client → tests. The Customer Care Console (apps/portal/src/app/care) translates the Stitch "OFBO - Customer Care Console (Hardened)" screen (project 8050269076066130289) into React inside the UI-01 AppShell, wired to four shipped backends over the OpenAPI contract.
- lib/care.ts — typed BFF HTTP client, called SERVER-SIDE only (httpOnly session cookie → Bearer, never reaches the browser): searchConsents (BACKOFFICE-16, GET /consents:search-psu), getPsuAuditTrail (-19, GET /psu/{id}/audit-trail, data array + meta.next_cursor), revokeConsent (-17, POST :revoke-admin, reason_code, Idempotency-Key, P6→Nebras), createDispute (-20, POST /disputes, Idempotency-Key). x-fapi-interaction-id on every call; {data}/{error} envelope; injectable fetch/baseUrl.
- components/care-console.tsx — presentational server component: PSU Identity Lookup (native GET), Customer Profile (internal id + account_count ONLY — no fabricated PII; the Stitch masked name/accounts are appearance-only), consent inventory with the OFBO status triad + per-consent admin revoke (revocable states only), 24-month event history, investigation module (one-click dispute). Token-only (no raw hex/px). app/care/page.tsx (session verify + consents:admin gate + data fetch) + app/care/actions.ts ('use server' revoke/dispute, fresh Idempotency-Key, scope re-checked).
- Scope hygiene (§2): consents:admin gates the screen; audit:read the timeline; disputes:admin the dispute — all within the customer-care-agent row; BFF re-enforces (defence in depth).
- Evidence: care.spec 8 + care-console.spec 7 = 15 new; 429 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all new token utilities (incl. bg-reconciled/10, border-l-breach). Reviewers: hard-stop PASS; conformance — first pass NON-CONFORMANT (dispute_type enum American spelling/invented values, DisputeRecord keyed dispute_id not id, RevocationResult modelled sla_met not psu_notified) → fixed to the contract (DISPUTE_TYPES = [unauthorised_payment, unrecognised_tpp, consent_complaint, data_misuse_complaint, other]; DisputeCase.id; {consent_id,status,nebras_propagation_ms,psu_notified}) → re-review CONFORMANT.
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-02 done-flip rides PR #81 (not on main until merge).
- Next eligible UI: UI-03 (Reconciliation Console). Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-03-RECON-CONSOLE (PR #82, UI track) — M3/E1 Reconciliation Console (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #82 stacked on UI-02 (feature/UI-02-care-console), NOT merged until GitHub Actions billing is restored. Merge the UI stack in order UI-00 → UI-01 → UI-02 → UI-03.
- Translates the Stitch "OFBO - Reconciliation Console (Refined)" screen (project 8050269076066130289) into React under apps/portal/src/app/reconciliation, inside the UI-01 AppShell. Finance scope; server-side only (httpOnly token never in the browser).
- lib/reconciliation.ts — typed BFF client over the OpenAPI contract: listRuns (BACKOFFICE-01, GET /back-office/reconciliation/runs), listBreaks (-02, GET /breaks), claimBreak (-03, POST /breaks/{id}/claim, Idempotency-Key, starts SLA clock), resolveBreak (-04/-06, POST /breaks/{id}/resolve, resolution_outcome + note≥20, Idempotency-Key). x-fapi-interaction-id on every call; {data}/meta.next_cursor envelope; Money as integer minor units (formatMoney /100 for display only); injectable fetch/baseUrl.
- components/recon-console.tsx — presentational server component: KPI cards (matched/unmatched/disputed + success rate derived from the run line counts), recent-run list (selectable via ?run_id), Break Queue (three-way A/B/C source refs, variance money, SLA clock). Contract BreakStatus state machine flagged→assigned→resolved_*/escalated_* drives the affordances (claim on flagged, resolve on assigned). Token-only (no raw hex/px). app/reconciliation/page.tsx (reconciliation:read gate + fetch) + actions.ts ('use server' claim/resolve, finance:reconciliation:write, fresh Idempotency-Key, NO silent outcome coercion — invalid outcomes surface as resolve_failed).
- Scope hygiene (§2): reconciliation:read gates the screen; finance:reconciliation:write gates claim/resolve; BFF re-enforces.
- Evidence: reconciliation.spec 8 + recon-console.spec 7 = 15 new; 443 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all new token utilities (incl. border-l-break). Reviewers: hard-stop PASS; conformance — first pass NON-CONFORMANT (component invented break statuses open/claimed/reopened + run status succeeded; actions silently coerced unknown resolution_outcome → resolved_matched) → fixed to the contract enums (BreakStatus [flagged, assigned, resolved_matched, resolved_internal_correction, escalated_nebras_dispute, escalated_fintech_billing]; run [running, completed, failed, partial]; CLAIMABLE={flagged}, RESOLVABLE={assigned}; outcome validated, no coercion) → re-review CONFORMANT.
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-03 done-flip rides PR #82 (not on main until merge).
- Next eligible UI: UI-04 (Investigation Detail View, depends UI-03) — also build-ahead. Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81/#82 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-04-INVESTIGATION (PR #83, UI track) — M3/E1 Investigation Detail View (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #83 stacked on UI-03 (feature/UI-03-recon-console), NOT merged until GitHub Actions billing is restored. Merge order: UI-00 → UI-01 → UI-02 → UI-03 → UI-04.
- Translates the Stitch "OFBO - Investigation Detail View" screen into React under apps/portal/src/app/reconciliation/breaks/[break_id], inside the UI-01 AppShell. Reached via the new "Investigate →" link on the recon-console break card. Finance scope; server-side only (httpOnly token never in the browser).
- lib/reconciliation.ts adds getBreak (BACKOFFICE-11, GET /breaks/{id} — the three-source side-by-side diff detail) + escalateToNebras (-05, POST /breaks/{id}/escalate-nebras, Idempotency-Key; escalatable only when flagged|assigned) + NebrasEscalationResult + ESCALATABLE_STATES.
- components/investigation-detail.tsx — presentational server component: the three-source diff (A=Nebras billing, B=bank platform metering-of-record, C=downstream fintech billing, missing-source highlight), break summary (variance as money, line type, assignee, SLA clock), and the Nebras escalation panel (shows the case id once escalated). Token-only. page.tsx (reconciliation:read gate + getBreak) + actions.ts ('use server' escalate, finance:disputes:write, fresh Idempotency-Key).
- Scope hygiene (§2): reconciliation:read gates the screen; finance:disputes:write gates escalation; BFF re-enforces. Reopen (compliance scope + four-eyes, 202+approval) correctly NOT exposed on this finance screen.
- Evidence: reconciliation.spec +3 (getBreak, escalateToNebras, ESCALATABLE_STATES) + investigation-detail.spec 5 = 8 new; 451 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all new token utilities. Reviewers: hard-stop PASS, conformance CONFORMANT (escalate-nebras is a plain 200 inline — not four-eyes; the four-eyes reopen 202+approval correctly omitted). No re-review needed (clean first pass).
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-04 done-flip rides PR #83 (not on main until merge).
- Next eligible UI: UI-05 (Four-Eyes Approval Portal, depends UI-01) — also build-ahead. Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81/#82/#83 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-05-FOUR-EYES (PR #84, UI track) — Four-Eyes Approval Portal (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #84 stacked on UI-04 (feature/UI-04-investigation), NOT merged until GitHub Actions billing is restored. Merge order: UI-00 → UI-01 → UI-02 → UI-03 → UI-04 → UI-05.
- Translates the Stitch "OFBO - Four-Eyes Approval Portal" screen into React under apps/portal/src/app/approvals, inside the UI-01 AppShell. Cross-cutting over the BACKOFFICE-44 approvals primitive; server-side only (httpOnly token never in the browser). The portal NEVER executes a gated operation inline — the BFF runs it on approval by a second, differently-authorised principal.
- lib/approvals.ts — typed BFF client: listPendingApprovals (GET /approvals/pending), getApproval (GET /approvals/{id}), approveRequest (POST :approve, Idempotency-Key), rejectRequest (POST :reject, reject_reason>=10, Idempotency-Key) + canActOn four-eyes rule (pending AND initiator!=subject [no self-approval, incl. superadmin] AND holds approver_required_scope [superadmin marker satisfies scope]). {data}/meta envelope; x-fapi-interaction-id on every call.
- components/approvals-portal.tsx — pending queue, each request as dual initiator/approver cards with permission lockouts (initiator → "you initiated this"; unscoped → "requires the <scope> scope"). operation_payload (PII-redacted) never rendered. Token-only. lib/nav.ts adds an always-visible (scope:null) 'approvals' module; the queue self-filters by approver scope server-side. page.tsx (list pending) + actions.ts ('use server' approve/reject, fresh Idempotency-Key).
- Four-eyes integrity: no inline execution; self-approval locked in the UI AND re-enforced by the BFF (incl. superadmin); approve/reject are 200 (the 202 belongs to the original gated operation, not the approve action).
- Evidence: approvals.spec 10 + approvals-portal.spec 6 + app-shell nav-test update = 16 new; 467 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all new token utilities. Reviewers: hard-stop PASS, conformance CONFORMANT (clean first pass — no re-review needed).
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-05 done-flip rides PR #84 (not on main until merge).
- Next eligible UI: UI-06 (Analytics & Insights Dashboard) — depends on UI-01 + BACKOFFICE-27 + BACKOFFICE-31. Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81/#82/#83/#84 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-06-ANALYTICS (PR #85, UI track) — M4/E3 Analytics & Insights Dashboard (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #85 stacked on UI-05 (feature/UI-05-four-eyes), NOT merged until GitHub Actions billing is restored. Merge order: UI-00 → … → UI-05 → UI-06.
- Translates the Stitch "OFBO - Analytics & Insights Dashboard" screen into React under apps/portal/src/app/analytics, inside the UI-01 AppShell. Read-only; server-side only (httpOnly token never in the browser).
- lib/analytics.ts — typed BFF client over the OpenAPI contract: getExecutiveDashboard (BACKOFFICE-27, GET /back-office/analytics/executive-dashboard) + getFinanceView (-31, GET /back-office/analytics/finance-view, NO query params — the contract declares none). Parses the non-standard { data, meta, freshness } envelope where freshness is a top-level sibling of data (BACKOFFICE-40); FreshnessEnvelope {source_published_at?, view_refreshed_at, stale, stale_cause}. isMoney/formatMoney for the renderer.
- components/analytics-dashboard.tsx — a GENERIC, contract-first renderer (analytics data is free-form by contract): a labelled metric grid formatting money (integer minor units→major), scalars, arrays (capped at 8), and nested objects (depth-capped at 2), plus the mandatory data-freshness indicator (fresh/stale + cause). Token-only. app/analytics/page.tsx fetches each view per entitlement (Executive needs platform:analytics:read, Finance needs reconciliation:read; bounce if neither; one failing view never blanks the other).
- lib/nav.ts — NavModule.scope extended to any-of (string|string[]|null); visibleModules updated; the 'analytics' module shows to either audience.
- Scope hygiene (§2): Executive=platform:analytics:read, Finance=reconciliation:read; the page renders only entitled sections; BFF re-enforces.
- Evidence: analytics.spec 8 + analytics-dashboard.spec 5 + an app-shell any-of nav test = 14 new; 478 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all new token utilities. Reviewers: hard-stop PASS; conformance — first pass DRIFT (getFinanceView sent a non-contract ?period= query param; the spec/BFF declare none) → fixed by dropping period from the client → re-review CONFORMANT.
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-06 done-flip rides PR #85 (not on main until merge).
- Next eligible UI: UI-07 (Risk Management & Anomaly Detection) — depends on UI-01 + BACKOFFICE-30 (done). Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81-#85 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-07-RISK (PR #86, UI track) — M4/E3 Risk Management & Anomaly Detection (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #86 stacked on UI-06 (feature/UI-06-analytics), NOT merged until GitHub Actions billing is restored. Merge order: UI-00 → … → UI-06 → UI-07.
- Translates the Stitch "OFBO - Risk Management & Anomaly Detection" screen into React under apps/portal/src/app/risk, inside the UI-01 AppShell. Read-only; narrow risk:read scope; server-side only (httpOnly token never in the browser).
- lib/risk.ts — getRiskView (BACKOFFICE-30, GET /back-office/analytics/risk-view — typed risk signals + the -37 consent-pattern anomaly feed; anomalies surface AS Risk signals in the view data) + getLiabilityMonitor (-36, GET /back-office/analytics/nebras-liability-monitor). Both are the same {data,meta,freshness} free-form analytics envelope, so lib/risk reuses a getAnalyticsView getter EXTRACTED from lib/analytics (behaviour-preserving — getExecutiveDashboard/getFinanceView now delegate to it, paths unchanged).
- components/risk-dashboard.tsx — reuses the UI-06 generic renderer (AnalyticsSection) for both views (Risk Signals & Anomalies / Nebras Liability Monitor) + the data-freshness indicator (-40). Token-only. app/risk/page.tsx gates risk:read (BFF re-enforces); fetches both views independently (one failing never blanks the other).
- Scope hygiene (§2): the screen and both views require the narrow risk:read scope (risk-analyst persona). The pre-existing 'risk' nav module (scope risk:read) routes here.
- Evidence: risk.spec 3 + risk-dashboard.spec 3 = 6 new; 484 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all token utilities. Reviewers: hard-stop PASS, conformance CONFORMANT (clean first pass — the analytics refactor confirmed behaviour-preserving, no scope/PII regression).
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-07 done-flip rides PR #86 (not on main until merge).
- Next eligible UI: UI-08 (TPP Billing & Registry) — depends on UI-01 + BACKOFFICE-71 (done). Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81-#86 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-08-TPP-BILLING (PR #87, UI track) — M5 TPP Billing & Registry (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #87 stacked on UI-07 (feature/UI-07-risk), NOT merged until GitHub Actions billing is restored. Merge order: UI-00 → … → UI-07 → UI-08.
- Translates the Stitch "OFBO - TPP Billing & Registry" screen into React under apps/portal/src/app/tpp-billing, inside the UI-01 AppShell. Finance scope; server-side only (httpOnly token never in the browser).
- lib/tpp-billing.ts — typed BFF client over the OpenAPI contract: listCounterparties (BACKOFFICE-71, GET /back-office/tpp-counterparties, billing:read), listInvoiceRuns (-73, GET /back-office/invoice-runs, billing:read), syncDirectory (-71, POST :sync-directory, platform:operations:write, 202), registerFinancialSystem (-72, POST /tpp-counterparties/{id}:register-financial-system, billing:write, 202), createInvoiceRun (-73, POST /invoice-runs, billing:write, FOUR-EYES 202+approval_request). Idempotency-Key on all mutations; x-fapi-interaction-id; {data}/meta envelope; Money minor units.
- components/tpp-billing.tsx — consuming-TPP registry table (production/registration pills, unbilled-traffic flag, MTD fee accrual) + invoice-runs table. Per-row Register P9 action shows only for a not-yet-registered TPP (registration_state ∈ {unregistered, onboarding}) with billing:write; Sync directory shows only with platform:operations:write (hidden for finance); Run monthly invoicing form shows only with billing:write. Token-only. app/tpp-billing/page.tsx (billing:read gate) + actions.ts. lib/nav.ts adds a 'billing' module (billing:read).
- Scope segregation & four-eyes: reads=billing:read, register+invoice=billing:write, sync=platform:operations:write (finance persona cannot sync). Create invoice run is four-eyes — 202 + approval_request submitted to the approvals queue (UI-05), never dispatched inline. BFF re-enforces every scope.
- Evidence: tpp-billing.spec 8 + tpp-billing-dashboard.spec 4 = 12 new; 496 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all token utilities. Reviewers: hard-stop PASS; conformance — first pass NON-CONFORMANT (REGISTERABLE_STATES used non-enum values pending_registration/directory_only; directory_synced_at typed nullable vs the non-nullable spec field) → fixed (REGISTERABLE_STATES = [unregistered, onboarding] from the contract registration_state enum; directory_synced_at: string) → re-review CONFORMANT.
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-08 done-flip rides PR #87 (not on main until merge).
- Next eligible UI: UI-09 (Operations Console) — depends on UI-01 + BACKOFFICE-28. Human-gated queue unchanged: restore GitHub Actions billing to merge the stacked UI PRs (#81-#87 + UI-00/UI-01) + PRs #77/#78 + the spec-PR queue.

## 2026-06-17 — UI-09-OPS-CONSOLE (PR #88, UI track) — M5 Operations Console + UI-00..09 TRACK COMPLETE (BUILD-AHEAD, awaiting CI/billing)

- Build-ahead mode (CI/Actions billing block): code built + locally verified + both reviewers clean + PR #88 stacked on UI-08 (feature/UI-08-tpp-billing), NOT merged until GitHub Actions billing is restored. Merge the whole UI stack in order UI-00 → UI-01 → … → UI-09.
- Translates the Stitch "OFBO - Operations Console" screen into React under apps/portal/src/app/operations, inside the UI-01 AppShell. Read-only; platform:operations:read; server-side only (httpOnly token never in the browser).
- lib/operations.ts — getOperationsConsole (BACKOFFICE-28, GET /back-office/analytics/operations-console), a thin wrapper over the shared getAnalyticsView getter. The ops view folds in SLO observations (-58), scheme-certificate expiry (-66), Ozone connectivity, and active outages — one {data,meta,freshness} free-form analytics envelope. components/operations-console.tsx reuses the UI-06 generic renderer (AnalyticsSection) + the data-freshness indicator (-40). app/operations/page.tsx gates platform:operations:read (BFF re-enforces); the pre-existing 'operations' nav module routes here.
- Evidence: operations.spec 3 + operations-console.spec 3 = 6 new; 502 unit tests green; pnpm lint + typecheck clean repo-wide; Tailwind preset compiles all token utilities. Reviewers: hard-stop PASS, conformance CONFORMANT (clean first pass).
- No spec change (pure consumer of existing endpoints); no new table (Q4.5 unaffected). Backlog UI-09 done-flip rides PR #88 (not on main until merge).

### 🎉 UI-00..09 CONSOLE TRACK COMPLETE (all build-ahead, stacked, unmerged)
Ten console screens, all translated from the Stitch "Open Finance Back Office" project (8050269076066130289) and wired to shipped backends over the OpenAPI contract (server-side; httpOnly token never in the browser; token-only styling; per-screen reviewer PASS + CONFORMANT):
- UI-00 design tokens + Tailwind preset (ADR-0002) · UI-01 app shell (scope-aware nav) · UI-02 Customer Care Console (PR #81) · UI-03 Reconciliation Console (#82) · UI-04 Investigation Detail (#83) · UI-05 Four-Eyes Approval Portal (#84) · UI-06 Analytics & Insights (#85) · UI-07 Risk & Anomaly Detection (#86) · UI-08 TPP Billing & Registry (#87) · UI-09 Operations Console (#88).
- The stack is 10 PRs deep (UI-00/UI-01 branches + #81–#88), all gated on the GitHub Actions billing block. On billing restore: merge UI-00 → UI-09 in order (each retargets to main as the lower one lands), verify the demo deploy, then flip all UI done-flips to main via the merges.
- **The eligible build queue is now DRAINED.** Everything remaining is human-gated: restore GitHub Actions billing (unblocks merging all UI PRs + code PRs #77/#78 + running CI); merge the spec-PR queue (#49/#64/#65/#66/#67/#71/#76) + author -74/-76/-79; decide ADR-0001 (-25) + BD-13 (-33); the -64 port decision.

## 2026-06-17 — UI-00..09 CONSOLE TRACK MERGED TO MAIN (merge a50ee89) — build-ahead stack landed

- The owner asked to make the console testable on main without waiting on the GitHub Actions billing block. Billing only stops CI from RUNNING; it does not gate landing code (direct pushes to main were never blocked — the repo has no protected-branch checks: free repo, protection requires Pro/public).
- Landed the whole UI stack in ONE --no-ff merge of feature/UI-09-ops-console (the top of the linear stack, which carried all 12 commits UI-00a..UI-09) into main. Clean automatic merge, no conflicts.
- CI never ran (org billing). SUBSTITUTE gate, run on the merged tree before pushing: pnpm gen (no contract drift) + lint clean + typecheck clean + 502 unit tests green; plus the per-screen reviewer passes already recorded above (every UI screen: hard-stop PASS + contract-conformance CONFORMANT). Done on the owner's explicit instruction in lieu of CI.
- Backlog UI-00..09 now all `done` on main. Closed the redundant build-ahead PRs #80–#88 (#79 already closed) with a pointer to a50ee89; deleted the merged feature branches (remote + local).
- Demo data: applied the 6 missing migrations (0011–0016) to the Supabase demo DB, then seeded the synthetic dataset (zero PII). Live-computed views (Analytics/Risk/Operations/Dashboard) show data immediately; Reconciliation runs + the TPP registry are still empty until a recon replay / directory sync is triggered.
- Known UI gaps on main: the 'Compliance' nav item routes to /compliance, which has no page (there was never a compliance-console story in the UI-00..09 track) → 404. The Stitch screens are token-faithful STRUCTURAL translations, not pixel reproductions; intentional regulatory deviations remain (UI-02 renders no PSU name/balances — internal id + account count only; UI-06/07/09 use a generic metric grid, not the Stitch charts).
- STILL human-gated (NOT on main, NOT built): code PRs #77 (BACKOFFICE-69) / #78 (BACKOFFICE-70) — build-ahead, reviewer-passed, could be merged the same way on request; spec PRs #49/#64/#65/#66/#67/#71/#76 (+ author -74/-76/-79); ADR-0001 (-25); BD-13 (-33); the -64 P1 port decision; M6 enterprise port-swaps (not started).

## 2026-06-17 — BACKOFFICE-69 (#77) + BACKOFFICE-70 (#78) MERGED TO MAIN — build-ahead backend stories landed

- Owner asked to land the two remaining build-ahead backend PRs alongside the UI. Both reviewer-passed (hard-stop PASS, conformance CONFORMANT); no schema migration in either.
- #77 BACKOFFICE-69 (CAAP registration/deregistration audit + >10/device/hour anomaly watch) — merged with a backlog.yaml conflict resolved: -69 → done; kept main's blocked reasons for -74/-76/-79.
- #78 BACKOFFICE-70 (LFI Ozone Connect health surfacing → operations-console data.ozone_connect) — clean merge; GitHub auto-marked the PR merged once the commits landed on main.
- CI never ran (org billing). Substitute gate on the merged tree before push: gen no-drift + lint + typecheck + 510 unit tests green (502 UI + 8 new BFF: ozone-health + CAAP audit). Merged on owner instruction in lieu of CI.
- Backlog -69/-70 now done on main. Open PRs reduced to the 7 human-gated spec PRs only (#49/#64/#65/#66/#67/#71/#76).
- OPERATIONAL NOTE: the locally-running BFF (tsx, started before #78 landed on disk) must be RESTARTED to serve the new ozone_connect block on the Operations Console — restart: `lsof -ti :8787 | xargs kill` then re-run the run-ofbo serve, or re-run smoke.sh --keep.

## 2026-06-17 — Portal E2E (Playwright) suite + CI Q3-e2e job (merge 2d9d2c8)

- Closes the automated-coverage gap surfaced by the full test cycle: the Next server pages (page.tsx) + server actions (actions.ts) sit at 0% in vitest because they need cookies()/redirect()/the IdP port/a live BFF. Vitest can't reach them; Playwright can.
- apps/portal/e2e/portal.e2e.ts (17 tests) drives the real stack (portal → BFF → Nebras sim → seeded Postgres): persona sign-in + unauthenticated-redirect + switch-persona logout; scope-aware nav + out-of-scope page redirect (§2 matrix); every console screen renders (each page.tsx) + the no-PSU-PII assertion on care; both mutating server actions (consent admin-revoke, reconciliation claim). All 17 green locally against the running stack.
- playwright.config.ts: baseURL :3000, reuse an already-running portal; generous timeouts (a dev server action's first hit compiles the route + round-trips the BFF + P6→Nebras, 10–15s — the only thing that bit the first run; CI uses a production `next start` build so it's far faster).
- CI: new q3-e2e job (postgres service → db:apply+seed → install Chromium → start sim+BFF → build+start portal → pnpm e2e → upload HTML report). Wired into .github/workflows/ci.yml; will run once GitHub Actions billing is restored. Playwright run artifacts gitignored.
- Verification done this turn: full local gate cycle GREEN on a throwaway postgres:16-alpine (CI-faithful) — gen no-drift, lint, typecheck, 515 unit, 85 integration/contract (46 files), Q4.5 lineage PASS, Q4 audit 0 high/critical. Stitch design-token adherence = exact (46/46 colours + radii + spacing match the live design system). Two fidelity fixes also landed earlier: web-font loading (Inter/JetBrains/Material Symbols) + the Compliance screen (was a 404 nav dead-link).

## 2026-06-18 — 7 approved spec PRs merged to main + portal E2E re-run green (owner request)

- Owner asked to merge the 7 human-approved spec PRs and keep everything local (not fix the GitHub Actions billing block). Merged #76/#71/#67/#66/#65/#64/#49 into main as 7 `--no-ff` merge commits (one genuine 3-way conflict, #65 fraud-incidents vs #66 scheme-notifications interleaved in the OpenAPI YAML — resolved by taking HEAD + surgically re-inserting #65's path block + NebrasSeverity/FraudIncident schemas, then regenerating the contract `.ts` from the merged spec rather than hand-merging). Contract now 66 paths / 74 routes; bumped the `spec.spec.ts` canon assertion 57→66 (the spec branches predated CI so it was stale). All 7 PRs auto-closed MERGED on push.
- Local gates (CI billing-blocked, substitute): gen-drift 0, typecheck 9/9 projects, unit 541/541, lint clean. DB-backed Q3/Q4.5 not re-run for the spec-only merge (no new handlers/migrations).
- Portal E2E (Playwright) re-run against the full local stack (portal :3000 + BFF :8787 + Nebras sim :8788 + reseeded Supabase): **17/17 green** (2.7m). Confirmed merge introduced no regressions; a newly-merged path (/back-office/fraud-incidents) correctly serves the binding 501 stub.
- Backlog: -75/-67/-77/-78/-09/-61/-68 flipped blocked→pending (specs merged), committed to main (77bf9f9). Set `.claude/settings.local.json` worktree.bgIsolation=none so edits land in this checkout (gitignored, local-only).

## 2026-06-18 — BACKOFFICE-75 respondent-side Nebras dispute scheme clocks (PR #89, merge 80e5466)

- First story off the unblocked queue. The bank is the RESPONDENT in a Nebras-raised dispute (distinct from PSU-raised dispute_case), bound to scheme clocks (BD-16): response 3bd + resolution 15bd from raised_at; appeal 3bd from verdict; implementation 3bd from final verdict. Endpoints (finance:disputes:write): POST/GET /back-office/disputes/respondent, GET /{id}, POST /{id}:advance (respond/record_verdict/appeal/record_final_verdict/implement; 409 illegal transition; note≥20; verdict_outcome required for verdict actions).
- Derived per-clock + overall on_track/amber/red status computed at read time (pure `clockStatus`/`overallStatus`); `breach_status` list filter surfaces supervisory-action exposure to Compliance. migration 0017_respondent_dispute (RLS day-one + retention 24/60 + classification); PgRespondentDisputeStore (+ in-memory default) with column-level BCBS 239 lineage; Idempotency-Key on mutations; one High-class audit per register/advance (PII redacted, trace propagated); double scope enforcement (BFF middleware + service); wired into worker.ts (durable).
- TDD: respondent-disputes.spec.ts 16 tests shown RED first (7 pure-fn pass, 9 endpoints 501) → green after wiring. Integration respondent-disputes.int.spec.ts (persistence + audit + lineage + advance, RLS exercised against real Postgres; generous timeouts for the remote pooler).
- Gates: gen-drift 0, typecheck, lint, **unit 549/549**, integration green, **Q4.5 lineage gate PASSED**. Reviewers: **hard-stop PASS**, **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot (CI Q1–Q3 still billing-blocked); PR #89 MERGED, branch deleted.
- Eligible queue remaining (pending, specs merged): -67, -77, -78, -09, -61, -68.

## 2026-06-19 — BACKOFFICE-67 BLOCKED on spec PR #90 (RiskSignal enum gap)

- Picked -67 (first eligible). Canon read surfaced a genuine contract gap: the "missed cadence raises ITSM ticket + **Risk signal**" acceptance criterion has no valid `RiskSignal.signal_type` value — the contract enum is `[consent_anomaly, tpp_behaviour, cop_mismatch_spike, nebras_liability_approach, agent_anomaly, predictive_liability_forecast]` and the `risk_signal` DB CHECK (migrations/0002) enumerates the same set. Forcing it into an existing type would be semantically wrong + pollute the Risk View.
- Per spec-change skill + CLAUDE.md rule 6 (contract changes are human-approved, never self-merged): opened spec-only **PR #90** adding `lfi_report_cadence_missed` to `RiskSignal.signal_type` (2-line diff: spec + regenerated api-types). NOT merged. Set -67 `blocked` on main (351f44a) with reason. After #90 merges: impl PR adds GET/POST ingest + cadence dashboard + matching risk_signal CHECK migration + the headless cadence monitor.

## 2026-06-19 — BACKOFFICE-77 Nebras fraud-incident reporting + scheme-imposed holds (PR #91, merge 6e82fd4)

- Next eligible after -67. Endpoints: POST report (risk:investigations:write) maps Nebras P1–P4 → ITSM priority (P1 critical/P2 high/P3 medium/P4 low), raises a P3 ticket via the P3 ITSM port, opens the customer operational-pause, flags `scheme_imposed_hold` for systemic P1; GET list (risk:read, filters status+severity) for the Ops + Risk Views; POST :resolve lifts the pause.
- migration 0018_fraud_incident (RLS day-one + retention 24/60 + classification `restricted`); PgFraudIncidentStore (+ in-memory default) with column-level BCBS 239 lineage; Idempotency-Key on mutations; double scope enforcement (BFF middleware + service); one High-class audit per report/resolve (PII redacted, trace propagated); wired into worker.ts. No risk_signal emission (the ITSM ticket + fraud_incident record are the mechanisms) — so no enum gap (unlike -67).
- TDD: fraud-incidents.spec.ts 11 shown RED first (8 endpoint 501 + 3 mapping/pure pass) → green after wiring. Integration fraud-incidents.int.spec.ts (P1 hold persistence + audit + lineage + resolve, RLS).
- Gates: gen-drift 0, typecheck, lint, **unit 554/554**, integration green, **Q4.5 lineage gate PASSED**. Reviewers: **hard-stop PASS**, **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot; PR #91 MERGED, branch deleted.
- Eligible queue remaining (pending): -78, -09, -61, -68. Blocked: -67 (spec PR #90).

## 2026-06-19 — BACKOFFICE-78 outbound downtime/change notifications (PR #92, merge 6c9aa42)

- Endpoints: POST raise (platform:operations:write) starts the notice clock — 10d planned_maintenance/version_release, 30d + dual_running_required for breaking_change; notice_deadline = scheduled_start − notice_days; notice_compliant = notified_at ≤ deadline; propagate_to_tpp flag. GET list (platform:operations:read, filters status+type) for the Ops Console. POST :acknowledge records the Nebras ack.
- migration 0019_scheme_notification (RLS day-one + retention 24/60 + classification internal-confidential); PgSchemeNotificationStore (+ in-memory) with column-level lineage; Idempotency-Key on mutations; one High-class audit per raise/acknowledge; double scope enforcement; wired into worker.ts. No risk_signal / ITSM / egress — no enum gap.
- TDD: scheme-notifications.spec.ts 12 RED first (8 endpoint 501 + 4 pure/passing) → green. Integration scheme-notifications.int.spec.ts (30d breaking-change clock persistence + audit + lineage + acknowledge, RLS).
- Gates: gen-drift 0, typecheck, lint, **unit 560/560**, integration green, **Q4.5 lineage gate PASSED**. Reviewers: **hard-stop PASS**, **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot; PR #92 MERGED, branch deleted.
- Deferred (noted, not built): Trust Framework status-page ingest into the Ops Console — a -28 concern, no -78 contract surface.
- Eligible queue remaining (pending): -09, -61, -68. Blocked: -67 (spec PR #90).

## 2026-06-19 — BACKOFFICE-09 Reconciliation Console SLO dashboard (PR #93, merge 4637e8d)

- Read-only AnalyticsView GET /back-office/analytics/reconciliation-slo (reconciliation:read): open_breaks by age bucket, resolution_time_30d p50/p90 (rolling), dispute_pipeline (open Nebras/fintech escalations), last_run + next_run_estimated_at (daily cadence), pass_rate_30d; liveFreshness (BACKOFFICE-40). ReconciliationSloService aggregates the existing reconciliation_log + reconciliation_break stores server-side; pure percentile()/ageBucket() helpers; double scope enforcement.
- migration 0020_break_resolved_at: additive resolved_at on reconciliation_break (set on resolve, cleared on reopen) so resolution-duration metrics are computable — purely additive, existing RLS/retention/classification cover it, no change to BACKOFFICE-04 semantics. Touched the shared break store (Pg + in-memory) + service; full recon suite stayed green.
- TDD: reconciliation-slo.spec.ts 7 (pure helpers + aggregation + empty-set + scope). Integration reconciliation-slo.int.spec.ts (resolved_at persistence + 30-day sample over real Postgres, RLS). Caught a CHECK-constraint mismatch in the int fixture (line_type) and fixed to a valid value.
- Gates: gen-drift 0, typecheck, lint, **unit 565/565** (88 files), integration green, **Q4.5 lineage gate PASSED**. Reviewers: **hard-stop PASS**, **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot; PR #93 MERGED, branch deleted.
- Eligible queue remaining (pending): -61, -68. Blocked: -67 (spec PR #90).

## 2026-06-19 — BACKOFFICE-61 multi-authorisation payment-consent visibility (PR #94, merge 367eae6)

- GET /consents/{consent_id}:admin (consents:admin) → ConsentAdminView incl. the multi_auth M-of-N block (threshold/received/pending + full per-authoriser list) on payment consents; null otherwise. One High-class consent_admin_view audit per call.
- synthetic-data: deterministic multi_auth on SIP_PAYMENT consents (derived from the consent id, no RNG draws — dataset stays byte-repeatable; AwaitingAuthorization is short one authoriser → pending). DemoConsentDirectory.getByConsentId added to the ConsentDirectory port (M6 adapter implements same iface). PII-free: authoriser_ref is synthetic, audit body logs consent_id + a multi_auth boolean only. Revocation unchanged (single propagation, BACKOFFICE-17) — visibility-only.
- TDD: consent-admin-view.spec.ts 4 (multi-auth block / null-for-non-payment / 404 / 403). Integration consent-admin-view.int.spec.ts (consent_admin_view audit persistence, RLS). Updated rbac.spec (the previously-stubbed :admin route now reaches its handler → 404, still proving care passes the scope middleware).
- Gates: gen-drift 0, typecheck, lint, **unit 567/567** (89 files), integration green (no new table → Q4.5 surface unchanged). Reviewers: **hard-stop PASS** (PII axis clean), **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot; PR #94 MERGED, branch deleted.
- Eligible queue remaining (pending): -68. Blocked: -67 (spec PR #90).

## 2026-06-19 — BACKOFFICE-68 DAO reconciliation coverage (PR #95, merge 61c8c80)

- dao_api_call joins the daily three-way reconciliation match as a data-sharing line class: fee-schedule 25 milli-fils/line, DEFAULT_THRESHOLDS 1 fil aed (data-sharing fee-variance default), margin productFamily → AISP, sources MATCHED_TYPES includes it. migration 0021_dao_line_type extends the reconciliation_break line_type CHECK to the contract's six LineType values (additive).
- TDD: reconciliation-dao.spec.ts (fee/threshold/family + engine three-way match + break detection) + .int.spec.ts (DAO break persistence over real Postgres, RLS). Updated reconciliation-thresholds.spec count 5→6.
- Gates: gen-drift 0, typecheck, lint, **unit 571/571** (91 files), integration green, **Q4.5 lineage gate PASSED**. Reviewers: **hard-stop PASS**, **contract-conformance CONFORMANT** (both first-pass clean). Merged on the local-gate build-ahead pivot; PR #95 MERGED, branch deleted.

## 2026-06-19 — LOOP SESSION COMPLETE: eligible code queue DRAINED

- This /next-story session shipped 6 stories to main on the local-gate build-ahead pivot (CI Q1–Q3 still billing-blocked): **-75** (#89), **-77** (#91), **-78** (#92), **-09** (#93), **-61** (#94), **-68** (#95). Each: TDD red-first, unit + integration green, Q4.5 lineage PASS, both reviewers clean (hard-stop PASS + conformance CONFORMANT). Unit suite 549→571.
- **-67** hit a genuine contract gap (missed-cadence Risk signal needs a RiskSignal.signal_type value absent from both the contract enum and the risk_signal DB CHECK) → spec-only **PR #90** opened (human-approved, NOT merged); -67 parked `blocked`.
- **No eligible (pending, deps-done) items remain.** Everything left is human-gated:
  - **Spec PR awaiting human merge:** #90 (unblocks -67 implementation).
  - **Contract-gap spec PRs to be authored:** -74 (Trust Framework participant admin), -76 (cross-scheme dispute guard / Aani), -79 (Nebras service-desk case tracking).
  - **Human decisions / ADRs:** -25 (care-token exposure — ADR-0001), -33 (BD-13 cross-fintech aggregation governance sign-off), -64 (new P1 CareSurfacePort method + contract for call-recording linkage).
  - **Deferred UI track (gated on the human-approved UI-00 Tailwind ADR):** -15 (recon console WCAG AA), -26 (console design-system/brand) — though the UI-00..09 screens already merged; these are polish items on that track.
  - **Per-bank engagement:** M6 enterprise port-swaps.

## 2026-06-19 — Authored the 3 deferred contract-gap spec PRs (#96/#97/#98, human-approval-gated)

- On request, authored spec-only PRs for the three contract-gap stories (one per story, never self-merged per CLAUDE.md rule 6). Each: spec edit + regenerated api-types/routes; canon path-count test reconciles at implementation time (matches the prior spec-PR pattern). Backlog reasons updated blocked→"awaiting spec PR #N".
  - **#96 — BACKOFFICE-74** Trust Framework participant administration: /back-office/trust-framework/participants (GET/POST), /{id} detail, /{id}:nominate-replacement (turnover); TrustFrameworkParticipant/TrustFrameworkRole(org_admin/pbc/ptc/stc)/TncStatus; named holders are internal role-holders (not PSU PII); onboarding-stage SLA. platform:operations r/w.
  - **#97 — BACKOFFICE-76** Cross-scheme dispute guard (Aani/Al Tareq): DisputeCreate.aani_case_id + DisputeCase.cross_scheme (CrossSchemeContext: 2h Aani recall window, settled_in_other_scheme + compensation_blocked double-compensation guard, Sanadak escalation) + POST /disputes/{id}:record-cross-scheme (disputes:admin). Guard → :initiate-refund 409 for the same direct loss.
  - **#98 — BACKOFFICE-79** Nebras service-desk case tracking: /back-office/service-desk-cases (GET/POST), /{case_id} detail, /{case_id}:update; ServiceDeskCase (type incident/billing_query/onboarding/general, priority P1–P4, Interaction-Guide SLA, links to break/dispute/signal). platform:operations r/w.
- **Open human-gated spec PRs now: #90 (-67), #96 (-74), #97 (-76), #98 (-79).** Merge any → its story becomes implementable by the next /next-story run. No code authored in these PRs.

## 2026-06-19 — Merged the 4 contract-gap spec PRs + implemented all 4 stories (BACKOFFICE-67/-74/-76/-79)

- Merged the four human-approval-gated spec PRs to main (#90 -67, #96 -74, #97 -76, #98 -79; spec now 73 paths / 9 tags), then implemented every newly-unblocked story end-to-end on local gates (GitHub Actions Q1–Q3 still billing-blocked → gen-drift + typecheck + lint + unit + integration[remote Supabase] + Q4.5 lineage substitute for CI; both reviewer subagents per story).
  - **#99 — BACKOFFICE-67** Manual cadence ingest of the 16 login-only Nebras LFI reports: GET /back-office/lfi-reports (compliance:reports:read) cadence dashboard; POST (compliance:reports:generate) verified multipart upload → sha256 integrity hash + compliance_report (lfi_report:<type>, archived) + lineage + High-class audit; headless LfiCadenceMonitor → P3 ITSM + lfi_report_cadence_missed Risk signal per overdue type. migration 0022 (risk_signal CHECK). unit 6 + int 1.
  - **#100 — BACKOFFICE-74** Trust Framework participant administration: GET (+/{id}) read / POST register + /{id}:nominate-replacement write (platform:operations:*). org_admin/pbc/ptc/stc; T&C status; onboarding-stage SLA (due_at + computed overdue); turnover (departing + nominated replacement). migration 0023 (new table, RLS day-one); PgTrustFrameworkParticipantStore. unit 8 + int 1.
  - **#101 — BACKOFFICE-76** Cross-scheme dispute guard (Aani/Al Tareq): POST /back-office/disputes/{id}:record-cross-scheme (disputes:admin); DisputeCreate.aani_case_id + DisputeCase.cross_scheme; double-compensation guard → :initiate-refund 409 once settled in the other scheme. migration 0024 (additive dispute_case columns); PgDisputeStore.recordCrossScheme. unit 4 + int 1; updated dispute-lifecycle fixture.
  - **#102 — BACKOFFICE-79** Nebras service-desk case tracking: GET (+/{id}) read / POST track + /{id}:update write (platform:operations:*). incident/billing_query/onboarding/general; P1–P4; Interaction-Guide SLA (due_at by priority + computed overdue); links to break/dispute/signal; resolve stamps resolved_at. migration 0025 (new table, RLS day-one); PgServiceDeskCaseStore. unit 8 + int 1.
- **Gates per story:** gen-drift 0, lint ok, full unit green (591→593, 94 files), all integration green (RLS + audit + lineage over real Postgres), Q4.5 lineage PASS, 0 PII. **Reviewers:** hard-stop PASS + conformance CONFORMANT on all four. Migrations 0022–0025 applied to the demo DB. Backlog: -67/-74/-76/-79 → done.

## 2026-06-19 — /next-story: eligible queue empty (no pending items; remaining work human-gated)

- Ran one /next-story iteration. Backlog state: **85 done, 0 pending, 6 blocked, 5 deferred** (96 items total). No `status: pending` item exists, so nothing to implement this iteration. No story started, nothing merged.
- **Blocked — all require a human decision (ADR / BD sign-off / new port primitive / per-bank engagement), none auto-unblockable:**
  - **BACKOFFICE-25** Care-surface token minting (act+sub claims) — uncovered auth path (CLAUDE.md rule 6); no contract endpoint; care token is a P1 Platform-Auth client_credentials token → **ADR-0001 + care-token exposure decision**.
  - **BACKOFFICE-33** Cross-fintech aggregation via bank_internal_view — **BD-13 governance sign-off** required before cross-fintech aggregation (PRD default sequences single-fintech views first).
  - **BACKOFFICE-64** Call/transcript linkage on dispute cases — `originating_call_id` already captured/surfaced (-20), but resolving it to a contact-centre recording needs a **new P1 CareSurfacePort method + recording-link contract surface** → ADR/spec decision.
  - **BACKOFFICE-15** Reconciliation console WCAG 2.1 AA — gated on the **UI-00 Tailwind ADR (human-approved)** UI-hardening track.
  - **BACKOFFICE-26** Console design-system + Al Tareq brand conformance — gated on the same **UI-00 Tailwind ADR (human-approved)**.
  - **M6-PORT-SWAPS** Enterprise adapter swaps per port — **per-bank engagement** (enterprise systems + credentials required).
- **Deferred (Could / Phase 2 — promote to build by setting `status: pending`):** -53 (agentic spend-control for admin MCP tools), -59 (Care training environment), -60 (programmatic admin-scope DCR automations), -63 (AML GO portal STR submission), -65 (predictive liability forecasting — regulated AI artefact).
- **To unblock the loop, the user must:** approve one of the gated ADRs/decisions above, or promote a deferred item to `pending`. Notification attempted (suppressed — terminal focused).

## 2026-06-19 — BACKOFFICE-65 predictive liability forecasting (promoted from deferred; PR #103)

- User promoted -65 from the deferred (Ph2) block and asked to implement it. Built end-to-end on local gates (CI Q1–Q3 still billing-blocked). **No spec change, no migration** — the `predictive_liability_forecast` signal_type + the `nebras-liability-monitor` endpoint already exist in the contract + `risk_signal` CHECK (migration 0002).
- **What shipped:** a 24h-ahead liability crossing probability per (issue × liable party) from ≥90d telemetry, via a **deterministic, explainable** model (EWMA incident rate → Poisson crossing probability; no RNG, no ML infra, fully reproducible — `services/bff/src/risk/liability-forecast.ts`). Surfaces as a `forecast` block on the existing `GET /back-office/analytics/nebras-liability-monitor` AnalyticsView (risk:read); headless `LiabilityForecastMonitor` emits `predictive_liability_forecast` risk signals per high-probability class (deduped vs open liability refs), wired into worker.scheduled().
- **Regulated-AI governance (PRD §7):** model card (`docs/model-cards/predictive-liability-forecast.md`) + inline model block (version/method/trained_through/recertify_by); rolling-backtest **drift monitoring** (status/score, breach → ITSM); **recertification** (overdue → `fallback_active`, predictive signals suppressed, recert ITSM ticket) with the deterministic **BACKOFFICE-36** monitor remaining the authority + fallback. Decision-support only — never initiates a payment/refund/consent/four-eyes op. No PSU PII (class+party telemetry only). Money as integer minor units (fils).
- **Gates:** gen-drift 0, lint ok, **unit 602/602 (95 files)** incl. liability-forecast.spec (9), **integration** (signal persistence + lineage over real Postgres, RLS), Q4.5 lineage PASS, 0 PII. **Reviewers:** hard-stop PASS + conformance CONFORMANT. Backlog: -65 → done (moved deferred → M5). main HEAD = 64ecd26.

## 2026-06-19 — In-depth regression + test-harness stabilization (PR #104)

Ran the full regression battery and stabilized the gates that were unreliable.

**Regression results (all green after fixes):** gen-drift 0 · lint · typecheck · **unit 602/602 (95 files)** · **integration 57/57 files** (post-fix) · **coverage gate 95.26%** (enforced ≥80 on services/bff/src) · **Playwright portal E2E 17/17** (portal→BFF→seeded Postgres: auth/session, §2 scope-nav, all 9 console screens, PSU search no-PII, admin-revoke + claim-break server actions) · **local smoke 9/9** · Q4.5 lineage PASS.

**Root cause found + fixed (the only real instability — test harness, not product):** the full integration suite "failed" 42/57 files purely on vitest's **5s default timeout** vs the remote Supabase session-pooler latency (multi-step write+lineage flows round-trip 6–14s; reconciliation.int alone 13.7s). Backend logic was green throughout. Fixes (PR #104 + the pre-existing integration `testTimeout`):
1. `integration` project `testTimeout`/`hookTimeout` = 60s (already on main) → 42 false timeouts → green.
2. `schema.int` `bank_internal_view` test: `GRANT … TO CURRENT_USER` in `beforeAll` + rollback-in-`finally` so a denied `SET ROLE` on managed Postgres can't poison the pooled connection (it had cascaded into the money-columns test); logged-skip fallback. Assertion still runs fully in CI's superuser Postgres.
3. New root `vitest.config.ts` — enforced v8 coverage gate scoped to `services/bff/src` (the unit-covered regulated logic) at ≥80% all metrics; `packages/db` (integration-covered), `apps/portal` (E2E-covered), `worker.ts` (deploy entry) excluded as they're gated by their own suites. Verified passes at 95.26% and bites when unmet. Reviewer: hard-stop PASS.

**Still open (not code — escalations):**
- **P1 CI billing block** — every recent story merged on local gates + reviewer subagents only; GitHub Actions Q1–Q3 never ran on a PR. Highest standing stability risk; needs the billing fix or an alternative runner.
- **Coverage breadth** — the gate covers unit-exercised logic only; `packages/db` (Pg stores) + portal are covered by their own suites but not merged into one coverage number. A merged unit+integration+E2E coverage report would close the measurement gap.
- **DB hygiene** — a `db:reset`/truncate helper before full local integration runs (a few count-based asserts are run-scoped but the demo DB accumulates rows).
- **Repo hygiene** — observed concurrent history movement (a `worktree-ui-stitch-backlog` worktree / parallel activity advanced main mid-session); worth confirming no two agents write main at once.

## 2026-06-19 — BACKOFFICE-15 reconciliation console WCAG 2.1 AA (PR #105)

**Merged** PR #105 to main (CI green, both reviewers clean). First story to merge with **GitHub Actions actually running** — the billing block was resolved this session by making the repo public (public repos = unlimited free Actions). Also fixed the deployed portal (BFF service binding) so the console screens this story makes accessible actually load live.

**What merged:** keyboard-only + screen-reader traversal of the break list (UI-03 `recon-console.tsx`) and investigation detail (UI-04 `investigation-detail.tsx`), plus tests-first `recon-a11y.spec.tsx`. WCAG 2.1 AA criteria: 1.3.1 named landmark regions (run-list / break-queue / three-way-comparison via `aria-labelledby`) + `sr-only` "N open breaks" count (badge `aria-hidden`, not colour-only); 4.1.2 per-break Investigate link disambiguated by client (`aria-label`); 4.1.3 error banners `role=alert` / notices `role=status`; 2.1.1 + 2.4.7 `focus-visible` ring on every interactive control. Frontend-only — no contract/port/audit/lineage surface (none apply).

**Verification:** tests-first (8 a11y cases shown red before the fix) · full unit **610/610** · gen-drift 0 · lint + typecheck clean · **CI Q1–Q4.5 all green on PR #105** · reviewers hard-stop **PASS**, conformance **CONFORMANT**.

**Backlog:** BACKOFFICE-15 → done. Next eligible: BACKOFFICE-26 (console design-system + Al Tareq brand conformance).

**Noted (not this story):** uncommitted working-tree leftovers from the PR #104 theme remain (a `db:reset` script + `test:coverage` scripts in package.json + `packages/db/src/reset.ts`) — deliberately kept out of this PR; they belong to the DB-hygiene / coverage-breadth follow-ups already listed above.

## 2026-06-19/20 — Stitch design-token verification + radii re-reconcile (#106), test-infra follow-ups (#107), CI restored, live browser validation

- **CI billing block RESOLVED.** All six gates (Q1 build+unit, Q2 SAST, Q3 integration+contract, Q3 portal E2E, Q4 security+deps, Q4.5 lineage) now run and pass on every push — the local-gate workaround used earlier in the session is no longer needed. #106 and #107 both merged on green CI.
- **Design-token verification + radii re-reconcile (PR #106, merged).** Verified the portal design pipeline against the live Stitch project `8050269076066130289` ("Open Finance Back Office") via the Stitch MCP `designMd`. Colours (all Material 3 roles), fonts (Inter / JetBrains Mono / Material Symbols), and spacing matched **verbatim**; `tokens.ts` is genuinely consumed by `tailwind.config.ts` → every component. **Border-radius had drifted**: the 2026-06-17 codification was shifted one step too small and `full` was `0.75rem` instead of the Stitch pill — so `rounded-full` status badges rendered as 12px rects, and inputs/cards were under-rounded (the Stitch project was edited 2026-06-18, after the first reconcile). Re-reconciled `apps/portal/design/tokens.ts` `borderRadius` to the Stitch `rounded` scale verbatim (`sm .125 / DEFAULT .25 / md .375 / lg .5 / xl .75 rem / full 9999px`), updated the `design.md` mirror, and fixed `design-tokens.spec` (it had pinned the old values — CI's Q1 caught this on the first push).
- **Test-infra follow-ups (PR #107, merged).** `db:reset` (`packages/db/src/reset.ts` + `pnpm db:reset`) — truncates the demo dataset for clean integration runs, preserves the migration ledger + retention/classification config, refreshes matviews, **non-prod-guarded** (refuses under enterprise/production); validated against the demo DB (23 tables truncated, re-seed restored, int green). `test:coverage` (the fast enforced unit gate) + `test:coverage:full` (report-only merged unit+integration). Note: the merged full-coverage run is impractical locally over the remote Supabase pooler (30 min+); it belongs in CI's local Postgres.
- **Live browser validation (Chromium, super-admin).** Drove the rebuilt portal (Nebras sim + BFF + portal, seeded Postgres). **Runtime computed styles confirmed the radii fix**: `.rounded-full` = `9999px` (true pills), `.rounded-xl` = `12px`, `.rounded` = `4px`. Full admin flow validated: login (DEMO banner) → dashboard (9-module scope-aware shell, 21 scopes, audit panel) → Customer Care PSU lookup (`cust-0001`, **6 live TPP consents** with Consumed/Suspended/Revoked states, scope-gated revoke, four-eyes dispute module, 24-month history) — **zero PSU PII**. Server actions run ~5–8s over the remote Supabase pooler (sub-second in CI's local PG) — the same latency behind the integration-timeout fix.

## 2026-06-20 — BACKOFFICE-26 console design-system + Al Tareq brand conformance (PR #108) — M5 queue DRAINED

**Merged** PR #108 to main (CI Q1–Q4.5 green, both reviewers clean). The portal screens were already token-bound, but the binding UI-00b rule ("token-only: no raw hex/px — CI enforces") and the acceptance "no critical design findings" had **no actual enforcement**. This adds the enforcing gate.

**What merged:** `apps/portal/test/design-conformance.spec.ts` — scans all 26 portal component+page screens and fails on raw hex, Tailwind arbitrary `[..px/rem/em]`/`[#hex]` values, inline `style` props, or the retired M1 `--ofbo-*` palette, keeping every console on the Stitch Material 3 / Al Tareq token system. Self-tested detector (proven to bite: shown red against an injected app-shell violation, then green). Runs in Q1 = CI-enforced. Brand token VALUES stay guarded by `design-tokens.spec.ts`. Test-only — no production/component change; frontend-only (no contract/port/audit/lineage).

**Verification:** red-first (gate failed on injected violation → green) · conformance gate 29/29 · **full unit 639/639** · gen-drift 0 · lint+typecheck clean · CI Q1–Q4.5 green on PR #108 · reviewers hard-stop **PASS**, conformance **CONFORMANT**.

**Backlog:** BACKOFFICE-26 → done. **Eligible queue now DRAINED** — 88 done, 0 pending, 4 blocked (all human-gated, no code action):
- **BACKOFFICE-25** — care-surface token minting: uncovered auth-path, needs the exposure-surface decision (ADR docs/adrs/0001).
- **BACKOFFICE-33** — cross-fintech aggregation: BD-13 governance sign-off.
- **BACKOFFICE-64** — call/transcript linkage: new P1 CareSurfacePort primitive + contract decision.
- **M6-PORT-SWAPS** — enterprise adapter swaps: per-bank engagement (real systems + credentials).

M0–M5 functionally complete. Remaining work is human decisions (ADRs/governance) and M6 per-bank adoption.

## 2026-06-20 — Codebase-vs-PRD/architecture review + all follow-ups shipped (PRs #110–#113)

Ran a 4-dimension review (functional coverage, architecture/ports, data/regulatory posture, API-contract/stack-ADR) via parallel reviewers. **Verdict: regulated core conformant** — all hard-stops enforced (RLS day-one, INSERT-only audit, retention no-delete, Q4.5 lineage, money minor-units, scope matrix, P6-only egress, four-eyes structurally unbypassable, no profile branching). Gaps were read-side stubs, tracking/doc hygiene, and one missing sim surface. Fixed all of them:

- **#110** — logged **BACKOFFICE-52** (service-to-service mTLS — the one PRD §7 item with no backlog entry; scoped to the bank gateway + P6, demo uses bearer tokens) + **ADR-0005** (Cloudflare Workers/OpenNext hosting — renumbered from 0003, which collided with the call-transcript-linkage ADR) + **ADR-0004** (portal server-first data layer).
- **#111** — filled the stubbed read/triage surfaces: **GET /risk-signals** + **PATCH /risk-signals/{id}** (list + triage lifecycle) and **GET /lineage/{table_name}** (BCBS 239 lineage now *readable*, not just emitted — BACKOFFICE-49 AC). No migration (risk_signal.status pre-existed). Reviewers PASS/CONFORMANT.
- **#112** — added the **Case & Dispute Management** surface to the Nebras simulator + wired P6 createDisputeCase to call it via NEBRAS_SIM_URL (dispute-case creation now rides the egress path end-to-end). Hard-stop PASS.
- **#113** — bound the portal data layer to the generated **@ofbo/contracts** types (ADR-0004): key-conformance drift guards on CareConsent/ApprovalRequest/Reconciliation{Run,Break}/TppCounterparty/InvoiceRun — a spec rename/removal now fails portal typecheck. The guard caught a real benign divergence (ApprovalRequest.execution_result is a portal-side post-approval augmentation; documented + excluded).

All four PRs merged on **green CI** (Q1–Q4.5) + reviewers. Net: every gap from the review is closed or consciously tracked; the read-side stubs that made the backlog overstate completeness now have real handlers + tests; CI is enforcing on every push.

## 2026-06-20 — BACKOFFICE-25 care-surface token minting (spec PR #115 + feat PR #117)

**Merged** the only unbuilt *Must*-priority requirement. ADR 0001 Option 1 (user-approved): `POST /care-surface:mint-token` behind the BFF. Spec PR #115 (human-approved) added the endpoint + `CareToken` schema (path count 73→74, Idempotency-Key per convention); feat PR #117 implemented it.

**Implementation:** `CareSurfaceService.mintToken` — consents:admin at both layers (assertScope + BFF middleware), resolves PSU→internal id (sub=resolved, never the raw identifier), mints via P1 `CareSurfacePort.mintCareToken` (act=authenticated caller, never the body), one High-class `care_token_minted` audit (no raw psu_identifier). Idempotency-Key required (replay returns the original token). No new table/migration; audit on the existing lineage-covered path. Tests: care-surface.spec 5 + .int.spec 1 (audit under RLS, no raw PII). CI Q1–Q4.5 green; reviewers hard-stop **PASS**, conformance **CONFORMANT**.

**Recovery note:** a concurrent session reset the original feature branch's shared checkout mid-work, so the implementation commit (77945f5) landed on the wrong branch and the files vanished from the working tree. The commit was intact in the object store and was cherry-picked cleanly onto current main (parent already merged via PR #116), re-pushed, and re-reviewed before merge. **Repo hygiene: concurrent agents sharing one working directory caused a near-loss — isolate sessions (separate worktrees) or run one at a time.**

**Backlog:** BACKOFFICE-25 → done. Remaining blocked (human-gated): BACKOFFICE-33 (BD-13 governance), BACKOFFICE-64 (ADR 0003 decision), M6 port-swaps (per-bank). M0–M5 now complete incl. all Must-priority items.

## 2026-06-20 — Stitch-benchmarked interface improvements (PRs #116, #119, #121)

Used the frontend-design skill's rigor within OFBO's binding constraints (Stitch "Regulated
Institutional Interface" Material 3, mandated Inter/JetBrains Mono, token-only, zero-PII, DEMO
banner) to benchmark the running portal against the Stitch design intent and close the gaps —
all concentrated in the data-dense analytics family (Analytics / Risk / Operations / Reconciliation).
Each token-only, no contract/spec change, browser-verified, hard-stop-reviewed, green on all six CI gates.

- **#116 — generic renderer: tables + status-triad badges (P0).** The shared `AnalyticsSection`
  renderer printed literal `{…}`/`(…)` placeholders for nested data and rendered every status as
  flat text. Now: arrays-of-objects → compact high-density tables (the Stitch data-table); nested
  objects render to depth 3 (the `{…}` placeholder is gone); operational status strings →
  status-triad badges (breach=red, break=amber, reconciled=green, neutral) via the existing
  `ext.status` tokens, curated vocabulary so ids/labels are never mislabelled. (NB: the `{…}` bug
  affected three production consoles, not just the demo.)
- **#119 — derived-data seed + local BFF store parity (P1, the biggest perceived-quality win).**
  The consoles rendered EMPTY locally for two reasons: (a) the derived tables (reconciliation_log/
  break, nebras_report_aggregate, risk_signal) are produced by the headless worker jobs a seed-only
  DB never runs — now seeded deterministically + idempotently with BCBS 239 lineage per table
  (Q4.5 green; periods/channel chosen to not collide with the 2026-09/2026-10 integration fixtures);
  and (b) `services/bff/scripts/serve.ts` wired only 5 of ~25 stores while the deployed `worker.ts`
  wires the full set — brought serve.ts to **full parity** (a real local-dev / run-ofbo correctness
  fix, not just demo polish). Reconciliation Console went from empty → KPIs + Break Queue.
- **#121 — KPI hierarchy + path references (P1/P2).** Top-level scalar/Money metrics now render as
  prominent KPI figures (text-3xl, JetBrains-Mono `tabular-nums` per the Stitch financial-numerals
  principle) — e.g. MTD Nebras Fee Accrual reads as a large AED figure; objects/arrays keep the
  structured render. API/route-path strings render as muted `<code>` references, not body text.

Net: the data-dense screens went from broken-looking (placeholders, flat text, empty states) to
on-Stitch-intent — high-density tables, status badges, prominent KPIs, FRESH indicators, styled
path refs. Tests: analytics-dashboard.spec 4→10; full unit 641→654. Stitch ref: project 8050269076066130289.

## 2026-06-20 — BACKOFFICE-64 call/transcript linkage (spec PR #120 + feat PR #122)

**Merged.** ADR 0003 Option 1 (user-approved): a dedicated, audited, on-demand `GET /disputes/{dispute_id}/call-recording`. Spec PR #120 (human-approved) added the endpoint + `CallRecording` schema (path count 74→75); feat PR #122 implemented it.

**Implementation:** new **P1 `CareSurfacePort.resolveCallRecording`** (sim adapter returns a short-lived locator into the simulated contact-centre system; enterprise adapter = M6). `CallRecordingService` — disputes:admin both layers, reads the dispute's `originating_call_id`, resolves via the P1 port → `CallRecording { recording_ref, recording_url?, expires_at }`, one High-class `call_recording_accessed` audit per access (`target_dispute_id`). **Link-never-copy** (recording content stays in the bank's system); 404 for unknown dispute / non-voice (null call id) / unavailable; read-only GET (no Idempotency-Key). No new table/migration; audit on the existing lineage-covered path. CI Q1–Q4.5 green; reviewers hard-stop **PASS**, conformance **CONFORMANT**.

**Process note:** authored in an **isolated git worktree** (`.claude/worktrees/backoffice-64`) after BACKOFFICE-25 was nearly lost to a concurrent session resetting the shared checkout. The worktree fully isolated this story — zero clobbering. Two test gates earned their keep: typecheck caught the -25 stub after widening the `careSurface` port dep; the int test caught that `target_dispute_id` is a UUID column (fixture fixed to a real UUID).

**Backlog:** BACKOFFICE-64 → done. Remaining: BACKOFFICE-33 (BD-13 governance sign-off) and M6 enterprise port-swaps (per-bank) — both genuinely human/bank-gated, not code.

---

## 2026-06-21 — UX-01 shared UI primitives + recon a11y propagation + a11y gate (UX-hardening)

First story off the UI/UX review (`docs/ui-ux-review.md`). Closed the CRITICAL accessibility regressions outside the recon console and introduced the enforcement to keep them closed.

- **Shared primitives** (`apps/portal/src/components/ui/`): `Notice` (role=status) + `ErrorBanner` (role=alert) — the WCAG 4.1.3 status-message contract the recon console proved; `StatusBadge` + one canonical `statusTone` map (kills the cross-screen colour drift the review found, e.g. `suspended` was red on analytics, amber on care → now amber everywhere); `Panel` (labelled `<section aria-labelledby>` region with aria-hidden count + sr-only phrase).
- **Global a11y safety net** (`globals.css`): a `:focus-visible` ring on every interactive element (2.4.7 — many non-recon controls had none), a `.skip-link` (2.4.1), and `prefers-reduced-motion`.
- **Propagated** role=status/alert banners across care/approvals/tpp-billing/analytics/risk/operations/compliance (was bare `<p>`); app-shell gained the skip-link + `<main id>`; fixed the `text-on-primary`→`text-on-primary-container` contrast bug on the persona badge + care avatar + tpp button.
- **A11y gate**: `test/a11y.spec.tsx` (vitest-axe over every screen, WCAG 2.0/2.1 A+AA; colour-contrast deferred to the token tests as jsdom can't compute layout) + `test/ui-primitives.spec.tsx`. Added `vitest-axe` + `axe-core` dev deps.

Frontend-only — no contract/port/audit/lineage/spec change. Tests: portal unit 203 pass (incl. design-conformance 34, design-tokens 8, no-raw-style 3 — token discipline held); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Authored in an isolated worktree.

**Backlog:** UX-01 → done. Remaining UX: UX-02..09 pending; UX-10/UX-11 blocked on ADRs 0013/0012.

---

## 2026-06-21 — UX-02 confirmation + forced-choice on irreversible actions (UX-hardening)

Operator-safety story from the UI/UX review: the three single-click, externally-visible, irreversible actions now require an explicit confirm, and two audited enum selects can no longer record a silent default.

- **`components/ui/confirm-submit.tsx`** — an accessible two-step `ConfirmSubmit` (client island): the action button is `type=button` until armed; arming reveals a plain-language summary + a real `type=submit` "Confirm" + "Cancel". Real buttons + a labelled group (no native `confirm()`), and because Confirm submits the enclosing form, native validation (the required selects) still runs.
- **Applied** to: consent **revoke** (care-console), **escalate-to-Nebras** (investigation-detail), **approve-gated-op** (approvals-portal). Each summary names the substance (TPP / break + variance / operation type).
- **Forced-choice** — revoke `reason_code` + resolve `resolution_outcome` selects gain `required` + a disabled placeholder (`defaultValue=""`), so an audited action can't record an unintended first-enum default.

Frontend-only — no contract/port/audit/lineage/spec change; the four-eyes server flow is unchanged (Confirm submits the same server action; nothing executes inline). Tests: portal unit 208 pass (new confirm-submit.spec 4; design-conformance 35 / tokens 8 / no-raw-style 3 held); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Authored in an isolated worktree.

**Backlog:** UX-02 → done. Remaining UX: UX-03..09 pending; UX-10/UX-11 blocked on ADRs 0013/0012.

---

## 2026-06-20/21 — Demo-ability sprint + hosted performance + region relocation

A run of demo-quality, performance, and infra work (driven interactively, outside the per-story loop). All merged to main, each browser-verified + hard-stop-reviewed where code; CI green.

**Demo-ability (PRs #131, #132, #135, #139, #140):**
- #131 — rich "operating back office" scenario seed (`pnpm db:seed:demo`, separate from the CI base seed): 30-day reconciliation history, ~11 open breaks, 16 risk signals, 3 pending four-eyes, 6 disputes incl. the cross-scheme 409 case. Idempotent + BCBS 239 lineage (Q4.5 green); also closed a latent gap — base seed now emits `audit_high_sensitivity` lineage.
- #132 — presenter golden-path guide (`docs/demo-script.md`) + `pnpm demo:fault` helper wrapping the Nebras sim's injectable faults.
- #135 — `pnpm demo:break` (live recon run with injected fee variance → fresh flagged break on demand) + the executive landing dashboard (scope-aware KPI row: pending approvals / pass-rate / open breaks / risk signals, tone-coded + deep-linked).
- #139 — dashboard charts (30-day recon-trend area+line + risk-severity bars), token-only hand-rolled SVG.
- #140 — charted numeric distributions in the shared generic renderer (`MiniBars`) → Analytics/Risk/Operations/Compliance all get bars at once.
- Plus a coherent linked incident (INC-2026-0042) traceable across Care→Finance→Risk→Approvals, and #133 (compact ISO timestamps + nowrap table cells — fixed a char-stacking render bug).

**Hosted performance (PRs #143, #144):**
- #143 — bound Cloudflare **Hyperdrive** (config `ofbo-db`) to the BFF worker; worker.ts prefers `env.HYPERDRIVE.connectionString` over `DATABASE_URL` (clean fallback). Eliminated the per-request cold connect+TLS handshake.
- #144 — batched the RLS transaction preamble (`BEGIN; SET LOCAL ROLE; set_config`) into one simple-query round-trip via shared `beginAppTx()` (UUID-validated interpolation), across all 22 stores. RLS semantics unchanged (integration 101/101).
- Net hosted latency (measured from a non-UAE vantage): ~12s → ~5s (Hyperdrive) → ~3s (batched). The Worker→DB distance is the remaining floor.
- Also: local dev switched to a Dockerised Postgres (`:5433`) — ~12s→sub-10ms per click; `.env` keeps the remote as `DATABASE_URL_SUPABASE`.

**Demo DB region relocation (infra, no code):** moved the Supabase demo DB Seoul → Singapore → **Mumbai (`ap-south-1`)** for UAE proximity (nearest Supabase region to the UAE; Cloudflare Dubai edge → Mumbai ≈ 1,900 km). Each move: re-`db:apply`+`db:seed:demo`, repoint the Hyperdrive config + worker secret + GitHub Actions `DATABASE_URL` secret + `.env`, redeploy. Synthetic data only — re-seed *is* the migration (nothing to preserve).
- **Caveat (unchanged):** this is the synthetic, non-prod demo. Production UAE **data residency** still requires a UAE-region Postgres (AWS `me-central-1` Dubai) provisioned via Terraform — region as an IaC parameter, a separate track. Supabase has no UAE/Middle-East region.

---

## 2026-06-21 — UX-03 four-eyes initiator feedback (UX-hardening; scoped)

From the UI/UX review's four-eyes gap. The user chose to ship the **unblocked frontend parts** only; the operation-payload-on-cards item is blocked (the ApprovalRequest contract is PII-redacted by design) and split to UX-03c (ADR).

- **Initiator gets the request id + a way to track it**: the invoice-run server action (tpp-billing) now captures the returned `approval_request_id` and appends `?ar=`; the page renders a richer notice (text + a deep-link to `/approvals`). `TppBilling.notice` widened `string → ReactNode`.
- **Expiry urgency**: approval cards show relative expiry ("Expires in 1h 45m") via a pure `formatExpiry(expiresAt, now)` helper (now injected for determinism), with a `text-breach` + "expiring soon" tone in the last 30 minutes (2h default expiry, PRD §10).

Frontend-only — no contract/port/audit/lineage/spec change; four-eyes execution flow unchanged (the surfaced `approval_request_id` is a UUID, not PII). Tests: portal unit 215 pass (new ux03-foureyes-feedback.spec 7; design-conformance/tokens/no-raw-style held); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-03 → done. Split: **UX-03b** (pending-count nav badge — needs per-page count or shared-shell refactor) pending; **UX-03c** (operation context on cards) blocked → ADR. Remaining UX: UX-04..09 pending; UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-04 cursor pagination, recon + TPP lists (UX-hardening; scoped)

From the UI/UX review: list getters returned next_cursor but the pages discarded it, so long lists silently truncated — a trust/correctness gap in a regulated console.

- **`components/ui/load-more.tsx`** — a reusable server-rendered control: a "N {noun} shown · more available / all loaded" indicator + a forward **"Next page →"** link (the page builds the href, preserving its other params + setting this list's cursor). Forward cursor navigation (replace) — the honest server-rendered cursor pattern.
- **Wired the four lists whose getters already accept `cursor`**: recon **runs** (`runs_cursor`) + **break queue** (`breaks_cursor`) — preserving the selected `run_id`; TPP **registry** (`reg_cursor`) + **invoice runs** (`inv_cursor`). Each page reads its per-list cursor param, passes it to the getter, captures `next_cursor`, and renders LoadMore.

Cursor-based only (no offset); cursors are opaque tokens (no PSU data in URLs). Split **UX-04b** for the approvals queue + care 24-month timeline (their getters need a cursor param + lib-test updates). Frontend-only — no contract/port/audit/lineage/spec change. Tests: portal unit 221 pass (new load-more.spec 5; design-conformance/tokens/no-raw-style held); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-04 → done; **UX-04b** (approvals + timeline pagination) pending. Remaining UX: UX-03b, UX-05..09 pending; UX-03c/UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-05 submitting states + stable idempotency keys (UX-hardening; scoped)

From the UI/UX review: all-server-render + redirect-per-mutation gave no in-the-moment feedback, and per-call random Idempotency-Keys defeated their own purpose (every click looked new, so the 24h window never protected against a double-submit).

- **`components/ui/submit-button.tsx`** — a client `SubmitButton` (useFormStatus): disabled + a pending label ("Working…"/"Claiming…"/…) + aria-busy while its enclosing form's server action is in flight. Visible feedback + a double-submit guard.
- **`components/ui/idempotency-field.tsx`** + **`lib/idempotency.ts`** — a hidden `idempotency_key` minted once per form render; the actions read it (fallback to a fresh uuid) instead of minting per call. A double-click of the same rendered form now carries the SAME key (the BFF collapses it within the 24h window) while a fresh page load mints a new key and can legitimately retry.
- **Wired into every mutating form** (care revoke/dispute, recon claim/resolve, tpp register/sync/invoice, approvals approve/reject) and all 9 server actions; tpp syncDirectoryAction gained a formData param.

Frontend-only — no contract/port/audit/lineage/spec change; the Idempotency-Key header shape + 24h semantics are unchanged (only the value source). Split **UX-05b** for per-route loading.tsx skeletons. Tests: portal unit 228 pass (new ux05-submit-idempotency.spec 7); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-05 → done; **UX-05b** (loading skeletons) pending. Remaining UX: UX-03b, UX-04b, UX-05b, UX-06..09 pending; UX-03c/UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-07 explicit scope-denied page (UX-hardening)

From the UI/UX review: out-of-scope deep links / bookmarks bounced silently to /dashboard with no explanation — disorienting for a portal whose §2 scope matrix is load-bearing.

- **`/access-denied` route + `AccessDenied` component**: the 7 scope-gated pages (care, reconciliation, tpp-billing, analytics, risk, operations, compliance) now redirect an out-of-scope access to `/access-denied?module=…&required=…`, which renders inside the shell and states "Your persona `X` does not hold the `scope` scope required for `module`." with a back-to-dashboard link.
- **Enforcement is unchanged** — the same `!superadmin && !scopes.includes(...)` gate still blocks; only the *destination* of the bounce changed (informative instead of silent). The required-scope string is disclosed to the already-authenticated user about their own denial (not a leak). Denial is now legible, not audited (a client-side informational page — no audit emission).

Frontend-only — no contract/port/audit/lineage/spec change. Tests: portal unit 232 pass (new access-denied.spec 4; design-conformance/tokens/no-raw-style held); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-07 → done. Remaining UX: UX-06(a/b/c), UX-08, UX-09 + splits UX-03b/04b/05b pending; UX-03c/UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-08 wire the global search (scope-aware PSU quick-lookup)

From the UI/UX review: the app-shell rendered a search input on every screen with no form/handler/target — a dead control on the natural cross-console entry point.

- **Decided: wire, not remove.** The header search is now a scope-aware **PSU quick-lookup** — a GET `<form action="/care">` with `name="identifier"` + hidden `identifier_type=bank_customer_id` — shown **only to `consents:admin` (or superadmin) personas** and hidden for everyone else (no inert control for personas without a universal lookup). Submitting runs the existing Care PSU search.
- **Scope-safe**: the target `/care` page is itself `consents:admin`-gated + BFF-enforced; a non-care persona who forces `/care` still hits the UX-07 access-denied gate. `role="search"` + aria-label + focus-visible.
- A *true* cross-console search (breaks/TPPs/consents) needs a search backend — out of scope; noted.

Frontend-only (app-shell) — no contract/port/audit/lineage/spec change. Tests: portal unit 237 pass (app-shell.spec +2; design-conformance/tokens/no-raw-style held); typecheck + lint clean; e2e untouched. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-08 → done. Remaining UX: UX-06(a/b/c), UX-09 + splits UX-03b/04b/05b pending; UX-03c/UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-09 polish cluster (copy, wayfinding, boundaries)

The bounded polish items from the UI/UX review (low-severity, high-credibility for a regulator walkthrough):

- Removed the 🎉 emoji in the recon Break Queue empty state → "No open breaks. Queue clear."
- Reworded the care PSU-lookup chip "High-class audited" → "Audited (high-sensitivity)".
- Humanized snake_case option **labels** in the revoke-reason / dispute-type / resolve-outcome selects (`value` stays the exact contract enum; display only).
- Collapsed-nav tooltips (`title=label` on nav links + switch-persona when the sidebar is collapsed).
- Breadcrumb `nav` (Reconciliation / Break …) on the deep-linked break-detail page.
- New `app/not-found.tsx` (calm token-styled 404 with a back-to-dashboard link).

Already done elsewhere (verified): the contrast token-pairing fix (`text-on-primary`→`-container`, landed in UX-01/03) and `error.tsx`/`global-error.tsx` (a prior DEMO-01 boundary). Split **UX-09b** for the two heavier items (point-of-action audit affordance + clearing the `?status=` notice param — needs a client `history.replaceState`).

Frontend-only — no contract/port/audit/lineage/spec change; option **values** unchanged (enum integrity preserved). Tests: portal unit 240 pass (new not-found.spec + investigation breadcrumb + recon option-label update); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-09 → done; **UX-09b** pending. Remaining UX: UX-06(a/b/c) + splits UX-03b/04b/05b/09b pending; UX-03c/UX-10/UX-11 blocked on ADRs.

---

## 2026-06-21 — UX-05b (already covered) + UX-09b audit affordance + notice-param clearing

- **UX-05b** — already satisfied: a root `app/loading.tsx` (DEMO-01) renders a token-styled animate-pulse skeleton as the Suspense fallback for any route navigation. One file covers all routes; verified, marked done.
- **UX-09b** —
  - `AuditNote` ("Actions here are recorded to the immutable audit trail") — display-only (the INSERT-only High-class audit is emitted server-side, unchanged) — placed near the mutating regions in care / recon / approvals / investigation consoles, so operator accountability is visible at the point of action.
  - `ClearStatusParam` (client, mounted in the root layout) — after hydration, `history.replaceState()`s away the one-shot notice params (`status`, `ar`) so a refresh / re-share no longer re-shows a stale banner; pagination cursors are preserved.

Frontend-only — no contract/port/audit/lineage/spec change. Tests: portal unit 245 pass (new ux09b-audit-notice.spec 3); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-05b → done (pre-covered); UX-09b → done. Remaining UX: UX-06(a/b/c), UX-03b, UX-04b, UX-10 pending; UX-03c/UX-11 ADR-gated.

---

## 2026-06-21 — UX-04b: cursor pagination for the approvals queue + care 24-month timeline

The last two truncating lists now page. The lib getters `listPendingApprovals` and `getPsuAuditTrail` gained an optional `query: { cursor?, limit? }` (inserted before the existing `deps` arg; internal callers in `dashboard.ts` + the lib specs updated) that emits the spec's existing `cursor` query param. The approvals page reads `?cursor`, the care page reads `?timeline_cursor` (remapped to `cursor`, preserving the active PSU identifier in the next-page href); both capture `meta.next_cursor` and render the shared `LoadMore` (approvals queue + care `TimelinePanel`). Cursor-based only (no offset).

Frontend-only — no contract/port/audit/lineage/spec change; both endpoints already returned `next_cursor`. Tests: portal unit 247 pass (new ux04b-pagination.spec 2; lib spec call sites updated for the new arg position); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-04b → done. Remaining UX: UX-06(a/b/c), UX-03b pending; UX-10/UX-11 ADR-gated; UX-03c PII-blocked.
