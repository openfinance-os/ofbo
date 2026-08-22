# OFBO build log

Append-only journal of autonomous build-loop iterations (`/loop /next-story`).
Each entry: what was built, the evidence, and anything parked for a human decision.

---

## 2026-08-22 — ADR 0032: deleting an accepted ADR requires a record (supersedes ADR 0031)

User decision, closing the question ADR 0031 left open. The build agent deliberately did NOT
recommend on this one when ADR 0031 shipped - it recorded the question as an open control-plane
matter under HG-0002 and stopped, which is the rule for a governance call. Asked for a
recommendation later, the agent gave one (close the exemption) and the owner agreed.

THE EXEMPTION WAS RESTING ON A CONTROL THAT DOES NOT EXIST. ADR 0031 carved outright deletion out
of scope on two grounds. One holds: the delete-plus-re-add pairing catches a "deletion" that is
really a rewrite, renumbered or not. The other was false, and the hard-stop AI reviewer found it by
CHECKING rather than accepting: doc-link-check resolves FILE-PATH references, and no ADR is
referenced by path anywhere in the set it scans - ADRs are cited by NUMBER, which it cannot
resolve. Every real docs/adrs/NNNN-*.md path reference lives outside that set (backlog.yaml,
docs/research/, docs/reviews/, mcp-gateway, ai-review.yml). So deleting an accepted ADR was green
on both gates and silent, which is exactly what the exemption claimed was impossible.

BOTH HALVES OF ADR 0031'S OWN RULE WERE EXERCISED BY ONE FINDING, which is the neatest thing about
this change. The false claim was a statement of FACT, so it was corrected IN PLACE with a dated
amendment row. Bringing deletion into scope changes the DECISION's scope, so it required a
SUPERSEDING ADR - the convention applying to itself, in both directions, on the same defect.

THE RULE: an accepted ADR may not be removed from the tree. There is deliberately NO satisfying
route for a deletion - not a row, not a status flip - because neither can be written to a file that
no longer exists. The remedy is to not delete it: supersede it and leave the document in place.
ADR 0012 was superseded on 2026-06-21 and is still in the tree, still readable, still explaining
why the generic analytics renderer was chosen and then reversed. That is the value at stake. A
deleted record takes its reasoning with it, and git log is not a substitute for the same reason
ADR 0031 gave about amendments in the first place: NOBODY READS GIT LOG BEFORE RELYING ON A
DECISION. ADR 0031 itself is now Superseded and kept in place, which is the rule demonstrating
itself on the first document it applies to.

COST MEASURED BEFORE ADOPTING, not assumed: no ADR has ever been deleted in this repository -
0001..0032 with no gaps, and no deletion in the history of docs/adrs/*.md. The rule constrains
something that has never happened, at the price of one status line if it ever does. That asymmetry
is what made closing the exemption cheap, and it is why the agent recommended closing it.

ONE TEST ASSERTION INVERTED, and its own comment had predicted this: it asserted a lone deletion
was "still the documented carve-out, still exempt", because banning it "would be a decision change
this script may not make". The owner has since made that decision, so the script may now make it.
Strictly stronger - a case that was silently exempt is now surfaced. Recorded because a test edit
accompanying a green run must always justify its direction.

Two self-inflicted breakages en route, both caught before commit and both the same shape: text
inserted into a delimited context without checking the delimiters. Double quotes inside a
double-quoted YAML scalar broke backlog.yaml; backticks inside a JS template literal broke the
gate script twice. Parse checks caught all three.

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

---

## 2026-06-21 — UX-03b: pending-approvals count badge on the Approvals nav item

An approver now sees pending four-eyes work from any screen. A cached `shellBadges(token)` helper (React `cache()`) derives the count from the existing `listPendingApprovals` and returns **only the integer length** (no approval records/PII cross to the client). `AppShell` gained an optional `badges` prop and renders a count chip (capped `9+`, `aria-label="N pending"`) on the matching nav item — a small dot when the sidebar is collapsed. Threaded into all 11 AppShell pages (token-guarded; tolerant of a cold BFF → no badge).

Approach chosen: per-page fetch (each page renders its own shell; +1 cached BFF GET per navigation — acceptable for the demo profile, noted in `shell.ts` for a future cached/edge source). No shared-layout refactor.

Frontend-only — no contract/port/audit/lineage/spec change (reuses an existing getter). Tests: portal unit 249 pass (app-shell.spec +2); typecheck + lint clean. Reviewers: hard-stop **PASS** (only a count crosses to the client), contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-03b → done. Remaining UX: UX-06(a/b/c) pending; UX-10/UX-11 ADR-gated; UX-03c PII-blocked.

---

## 2026-06-21 — UX-06 (part 1): parse + render error-envelope remediation/docs_url

The spec's `ErrorEnvelope` has always *required* `remediation` + `docs_url`, but the portal parsed neither — they were dropped. Now:

- The 4 portal lib error classes (`CareApiError`/`ApprovalApiError`/`ReconApiError`/`TppBillingApiError`) carry optional `remediation` + `docsUrl`, and each `envelope()` parser reads `error.remediation` + `error.docs_url`.
- `ErrorBanner` renders the remediation line + a `docs_url` link (opens in a new tab, `rel=noopener`; **http(s)-scheme-guarded** as defence-in-depth even though the URL is BFF-supplied).
- The **care** + **reconciliation** read paths (search/load failures) forward the typed error's remediation/docsUrl to the banner; `recon-error` now uses the shared `ErrorBanner` instead of an inline `<p>`.

**Split UX-06b** for parts 2+3 (the write path): surfacing the real BFF error code AND preserving form inputs on failure both need a `useActionState` refactor of the mutating forms, so they ship together. (Form inputs can contain PSU PII — preserving them via the URL is unsafe; `useActionState` keeps them client-side without a redirect.)

Frontend-only — no contract/port/audit/lineage/spec change (aligns the client to existing contract fields). Tests: portal unit 253 pass (new ux06-error-envelope.spec 4); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-06 → done (part 1); **UX-06b** pending (write-path useActionState). Remaining UX: UX-10/UX-11 ADR-gated; UX-03c PII-blocked.

---

## 2026-06-21 — UX-06b: write-path useActionState (Care slice)

Established the typed-error + input-preservation pattern on the **Care write path** (revoke + dispute). The two care server actions changed from `(formData) → redirect('?status=*_failed')` (which swallowed the typed error into a binary string and dropped inputs on the redirect) to React `useActionState` `(prevState, formData) → Promise<CareWriteResult>`:

- On a typed `CareApiError` the action **returns** `{ ok:false, error, remediation, docsUrl, values }` (no redirect) → the form shows the **real BFF error + remediation in place** (UX-06's ErrorBanner) and **keeps the operator's inputs**; success still `redirect()`s for the notice.
- The revoke + dispute forms became `'use client'` islands (`RevokeForm`/`DisputeForm`) using `useActionState`; inputs are re-seeded from the returned `values` via `key`+`defaultValue` (deterministic in both the browser and jsdom — React 19 resets the form on submit).
- `CareWriteResult` lives in `lib/care` (a `'use server'` file may only export async functions).

PII posture **improves**: the failure path no longer redirects with identifiers in the URL — `values` (reason/dispute-type enums + payment id) stay client-side. Idempotency-Key, `principalOrBounce` scope re-check, and the httpOnly token boundary are all unchanged.

**Split UX-06c** for the remaining consoles (recon/approvals/investigation/tpp) — a mechanical application of this proven pattern, kept separate so each PR stays reviewable.

Frontend-only — no contract/port/audit/lineage/spec change (wire payloads unchanged). Tests: portal unit 257 pass (new ux06b-write-path.spec 2; care-console.spec noop typed to the action signature); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-06b → done (Care slice); **UX-06c** pending. Remaining UX: UX-10/UX-11 ADR-gated (ADRs 0012/0013 Proposed — human decision); UX-03c PII-blocked.

---

## 2026-06-21 — UX-06c: write-path useActionState (recon + approvals)

Applied the merged UX-06b pattern to two more consoles:

- **Recon** (claim, resolve) and **approvals** (approve, reject) actions changed from `(formData)→redirect('?status=*_failed')` to `useActionState` `(prevState, formData)→Promise<{Recon|Approval}WriteResult>`: on a typed `XApiError` they **return** the error (message + remediation + docs_url) so the form shows the real reason **in place**, and the operator's inputs survive — the **free-text** resolution note + reject reason (strongest preservation case) and the resolution outcome, re-seeded via `key`+`defaultValue`. Success still `redirect()`s.
- Forms extracted to `'use client'` islands: `reconciliation/{claim,resolve}-form`, `approvals/{approve,reject}-form`. `Recon/ApprovalWriteResult` live in their lib modules (a `'use server'` file may only export async functions).

**Safety:** four-eyes intact (ApproveForm just submits `approval_id`; the BFF executes the gated op — no inline execution); the resolve **enum guard** is preserved (now returns the error in place instead of redirecting); PII posture **improves** (free-text stays client-side, not in the URL). Idempotency-Key + scope re-checks + httpOnly token boundary unchanged.

**Split UX-06d** for the last forms (investigation escalate + tpp register/invoice).

Frontend-only — no contract/port/audit/lineage/spec change (wire payloads, enums, headers unchanged). Tests: portal unit 263 pass (new ux06c-write-path.spec 2; 3 spec noops retyped to the action signature, +voidNoop for the still-redirect escalate action); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-06c → done; **UX-06d** pending (investigation + tpp). Remaining UX: UX-10/UX-11 ADR-gated; UX-03c PII-blocked.

---

## 2026-06-21 — architect decisions recorded (ADRs 0012/0013 accepted; ADR 0014 drafted)

The user resolved the three human-gated UX items:

- **ADR 0013 → Accepted, Option 1** (responsive-safe). UX-10 unblocked (responsive-safe shell + table overflow + density wiring + one KPI breakpoint ladder); added **UI-MOBILE-APPROVALS** (the one mobile journey — Mobile Approval Queue/Detail, time-sensitive four-eyes).
- **ADR 0012 → Accepted, Option 1** (keep the generic analytics renderer). The Analytics/Risk/Operations MAJOR-DRIFT is recorded **by-design (accepted)** in `docs/design-conformance-audit.md`; **UX-11 closed won't-do** (typed panels are the post-demo Option-2 target).
- **UX-03c → ADR 0014 drafted** (`0014-approval-card-operation-context.md`, status **Proposed**): recommends a minimal, schema-constrained, **non-PII** `operation_summary` on `ApprovalRequest` (amount + masked institutional counterparty + count/scope — never PSU ids/free-text), BFF-composed + redaction-tested. Awaiting compliance sign-off; if accepted it needs a human-approved spec-change first.

Docs-only change to main (ADR statuses + audit + backlog + this log), per the worktree-isolation convention. No code change. ADR 0014 is a draft for human approval — not self-accepted.

**Eligible next (code):** UX-10 (responsive-safe shell) → UI-MOBILE-APPROVALS; UX-06d (investigation + tpp useActionState, the last write-path forms). **Still human-gated:** UX-03c (ADR 0014 compliance sign-off).

---

## 2026-06-21 — UX-06d: write-path useActionState (investigation + tpp) — refactor complete

The last mutating forms, applying the merged UX-06b/c pattern:

- **Investigation** escalate-to-Nebras (reuses `ReconWriteResult`) and **tpp** register / invoice-run / sync-directory (new `TppWriteResult` in `lib/tpp-billing`) converted from `(formData)→redirect('?status=*_failed')` to `useActionState` `(prevState, formData)→Promise<result>`: the typed BFF error renders **in place** on failure (no redirect); the invoice-run form preserves `billing_period`+`record_set_id` via `key`+`defaultValue`.
- Forms extracted to `'use client'` islands: `reconciliation/escalate-form`, `tpp-billing/{register,invoice-run,sync}-form`.

**Safety (reviewer-confirmed):** escalate still creates the external Nebras case **via the BFF→P6 egress gateway** (no direct egress); invoice-run remains **four-eyes** (202 + `approval_request`; success still redirects `?ar=<approval id>` for UX-03 tracking — no inline execution); PII posture improves (inputs stay client-side, not in the URL); Idempotency-Key + scope re-checks + httpOnly token boundary unchanged.

**This completes the write-path refactor** — every mutating portal form is now `useActionState` with typed-error-in-place + input preservation: care (UX-06b), recon + approvals (UX-06c), investigation + tpp (UX-06d).

Frontend-only — no contract/port/audit/lineage/spec change (wire payloads, the 202 flow, headers unchanged). Tests: portal unit 278 pass (new ux06d-write-path.spec 2; 4 spec noops retyped to the action signature); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-06d → done. **Every implementable UX item is now complete.** Remaining: UX-03c (awaiting compliance sign-off on ADR 0014); UX-10 + UI-MOBILE-APPROVALS (eligible — layout work, not yet built); optional read-path remediation wiring for tpp/analytics/risk.

---

## 2026-06-21 — UX-10: responsive-safe shell (ADR 0013 Option 1)

Made the existing portal shell responsive-safe so nothing breaks on a small screen:

- **Off-canvas drawer below `lg`**: the sidebar is `fixed` + `-translate-x-full` with a scrim backdrop and a mobile hamburger (`open-drawer`/`close-drawer`); on `lg+` it stays the sticky collapsible rail. The desktop collapse is now `lg:`-scoped, so the mobile drawer always shows full labels; a nav-tap / backdrop / close button dismisses it.
- **Top bar wraps** (`flex-wrap`) instead of overflowing on narrow widths.
- **Density toggle wired** (was inert): `globals.css [data-density='compact']` now tightens content padding + data-table rows.
- **One KPI breakpoint ladder**: dashboard standardized to `grid-cols-2 lg:grid-cols-4` (matches recon + investigation).
- **Table overflow guards**: `overflow-x-auto` on the tpp registry + invoice-runs row containers.

Token/utility-only (no raw hex/px); no contract/lib change. Tests: portal unit 279 pass (app-shell.spec +1 — drawer open/backdrop/close/nav-dismiss); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UX-10 → done. Eligible next: **UI-MOBILE-APPROVALS** (the mobile approval journey). Remaining human-gated: UX-03c (ADR 0014 compliance sign-off).

---

## 2026-06-21 — UI-MOBILE-APPROVALS: focused Mobile Approval Detail journey (ADR 0013 Option 1)

The approval **queue** was already responsive (cards stack) and made mobile-safe by UX-10's shell (it's the Stitch Mobile Approval Queue ref). This adds the focused **Mobile Approval Detail** journey:

- New route **`/approvals/[approval_request_id]`** + **`ApprovalDetail`** component — single-column, large-touch-target view of one four-eyes request, reusing the queue's `canActOn`/`formatExpiry` + the UX-06c approve/reject `useActionState` islands. It fetches via the existing `getApproval` (GET /approvals/{id}); a missing/▾unauthorised request shows a calm not-found notice.
- It's the natural **deep-link target** for the UX-03 four-eyes initiator link — the tpp invoice-run notice now links to `/approvals/{ar}` ("Open this approval →") when the id is known.
- Queue cards gained an `open_in_new` link to the detail.

**Safety (reviewer-confirmed):** four-eyes intact — no inline execution; the initiator sees a lockout, not the buttons; the BFF executes the gated op. PII-safe — only the redacted `ApprovalRequest` fields + a UUID in the URL (richer operation context remains gated on **ADR 0014**).

Frontend-only — no contract/lib/spec change (reuses GET /approvals/{id} + the approve/reject flow). Tests: portal unit 283 pass (new approval-detail.spec 2); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Backlog:** UI-MOBILE-APPROVALS → done. **Every implementable UX item is now complete.** The only open item is UX-03c, blocked on your compliance sign-off of ADR 0014.

---

## 2026-06-21 — DEMO-01..09: demo-ability hardening sprint

A sweep to make the demo robust in front of a bank, following an in-depth demo-ability review. Nine PRs (#151–#169), each gated + hard-stop reviewed, all on isolated worktrees:

- **DEMO-01 (#151):** BFF keep-warm cron (`[triggers]` */5 → cheap `SELECT 1`) so a presenter's first click never hits a cold Supabase/Hyperdrive — also fixed a latent gap where the daily recon cron was never registered. Seed depth: `service_desk_case` + `fraud_incident` woven into the `INC-2026-0042` cross-console thread. Portal `error.tsx`/`global-error.tsx` boundaries. Demo-script rewritten around the incident thread; corrected counts.
- **DEMO-02 (#159):** Audit visibility — admin consent-revoke now stamps `target_psu_identifier` (so it shows in the per-PSU Care timeline), plus a global, `audit:read`-gated **`/audit`** screen (cross-operator "who did what", event-type filter) over `GET /audit/events`.
- **DEMO-03 (#161):** Dashboard audit panel drops `signin_success`/`scope_denied`/`audit_trail_accessed` noise (optional `excludeEventTypes` on `PgAuditReader.recent`) so operational events stay visible; full trail unchanged in `/audit`.
- **DEMO-04 (#162):** Demo-script documents the audit screen + the revoke-in-timeline.
- **DEMO-05 (#164):** **`pnpm demo:ingest`** — runs the headless ingestion + risk-monitor pass on demand (CLI, no public ingress), so injected Nebras faults (`fee_variance`/`rate_limit`) surface in the Finance View and risk signals refresh. Verified: +50000 fault → aggregate +50000 exactly.
- **DEMO-06 (#167):** Caught + fixed a regression — DEMO-01's root `loading.tsx` made Next stream a 200 (resolving `redirect()` mid-stream), so unauth `/dashboard` returned 200 not 307, **silently failing the deploy smoke gate on every merge since #151** (~16 deploys, mine + teammates'). Removed `loading.tsx`; cold-start already covered by the warm cron. Pipeline green again.
- **DEMO-08 (#168):** Wired `consent_drift` — new `getConsentStatus` on the P6 egress port (sim adapter + contract test binding both profiles), sim consent-manager made dataset-consistent (no false positives), and a `ConsentDriftMonitor` emitting a deduped, PII-free `consent_anomaly` signal. New `demo:fault consent-drift <id>` lever. Verified live (0-drift baseline; inject → 1 signal).
- **DEMO-09 (#169):** Consent-drift monitor added to the daily `scheduled()` pass for continuous detection (parity with the other monitors), not just the demo lever.
- *(DEMO-07: the decorative global-search footgun turned out already fixed by UX-08 — a scope-gated PSU quick-lookup — so no change shipped.)*

**Outcome:** all four Nebras sim faults now have on-demand demo effects (`demo:ingest` for fee/rate, audit for revoke-delay, Risk signal for consent-drift) plus `demo:break`; hosted demo verified live (smoke 9/9, `/audit` renders, dashboard noise filtered); deploy pipeline green. Synthetic + non-prod throughout; no contract/regulatory posture change. The dropped `originating_payment_id` dispute link stays out (no `payment` table exists).

---

## 2026-06-21 — ADR 0014 accepted (Option 2); spec PR #171 opened (operation_summary)

User accepted **ADR 0014 Option 2**: surface a minimal, non-PII operation summary to the second four-eyes approver. Per the `spec-change` workflow (spec → tests → code):

- **Spec PR #171 opened — awaiting human approval (NOT self-merged).** Adds an optional, nullable `operation_summary` to `ApprovalRequest` + a new `ApprovalOperationSummary` component (`amount` via the shared `Money` $ref; masked institutional `counterparty_label`; non-PII `descriptor`; **`additionalProperties: false`** as the anti-PII-smuggling guard) and the regenerated `api-types.generated.ts`. Additive + optional + nullable (backward-compatible); gen-drift clean; 782 unit tests + typecheck + lint green. Reviewers: hard-stop **PASS** (PII-safe by construction), contract-conformance **CONFORMANT**.
- ADR 0014 status → **Accepted (Option 2)**; UX-03c remains blocked on the merge of #171.

**After you merge #171** (the prerequisite): (a) a BFF story composes `operation_summary` per gated-operation type with a **per-type PII-redaction contract test**; (b) UX-03c renders it on the approval card + mobile detail. Both as separate PRs linking #171.

This is the only remaining UX item. Everything else implementable is shipped; the rest of the backlog (BACKOFFICE-33, BACKOFFICE-52, M6-PORT-SWAPS) is enterprise/BD-gated.

---

## 2026-06-21 — UX-03c BFF: compose non-PII operation_summary on the four-eyes view (ADR 0014)

Spec PR #171 merged (operation_summary + ApprovalOperationSummary on ApprovalRequest). This is the BFF step:

- **`summariseOperation(operation_type, operation_payload)`** — an **allowlist** composer; `toWire` now emits a non-PII `operation_summary` per gated-operation type. Surfaces only: `billing_period` (invoice-run), the `reason_code` enum (bulk-revoke), the refund `Money` amount, and static labels. **Never** copies `psu_identifier`, free-text `case_context`/`justification`, internal ids, or account/IBAN/Emirates-ID; unknown type → `null` (fail-safe).
- **Format-validation at the summary boundary** (security-review hardening): the echoed values are validated, not just type-checked — `reason_code` must be in `{CLIENT_INSTRUCTION}`, `billing_period` must match `^\d{4}-(0[1-9]|1[0-2])$`, `Money.amount` must be an integer — so a caller hitting the generic `POST /approvals` with PSU free-text in those fields can't smuggle it onto the four-eyes surface.
- **Per-type PII-redaction contract test** (12 cases): stuffs every operation payload with PII sentinels + asserts none leak; covers the free-text-dropped + malformed-period-dropped + unknown-type-null cases.

Reviewers: hard-stop **PASS** (redaction control sound), contract-conformance **CONFORMANT** (matches the merged schema; gen-drift clean). Spec→tests→code order honored: the BFF code landed only after #171 merged + a rebase onto main.

**Backlog:** UX-03c → in-progress (BFF done); **UX-03c-portal** pending — render the summary on the approval card + mobile detail (display-only; the BFF already redacted). That's the last UX step.

---

## 2026-06-21 — UX-03c portal: render operation_summary on the four-eyes surface (ADR 0014) — UX-03c COMPLETE

The final UX-03c step. The contract (#171) + BFF (#172) now serve a NON-PII `operation_summary`; the portal renders it:

- Portal `ApprovalRequest` type gains `operation_summary` (+ `ApprovalOperationSummary`); a new `OperationSummary` component renders the descriptor, the formatted `Money` amount, and the masked institutional counterparty — placed on the **ApprovalCard** (queue) and **ApprovalDetail** (mobile). Degrades to nothing when absent (older requests / unmodelled types).
- Display-only: the BFF already redacted to non-PII facts; the portal adds no payload fetch, no `operation_payload` access, no browser storage. The compile-time `ApprovalRequestContractGuard` binds the new field to the generated contract.

Reviewers: hard-stop **PASS** (no new PII), contract-conformance **CONFORMANT** (drift-guard verified). Portal unit 287 pass (new operation-summary.spec 4); typecheck + lint clean.

**UX-03c is now COMPLETE** (ADR 0014 → spec #171 → BFF #172 → portal). The second four-eyes approver now sees real, PII-safe operation context. With this, **every UX/UI backlog item is done** (UX-11 won't-do by decision); the only open backlog items are enterprise/BD-gated (BACKOFFICE-33, BACKOFFICE-52, M6-PORT-SWAPS).

---

## 2026-06-21 — UX-06e: finish read-path remediation wiring (approvals/tpp/analytics/risk)

UX-06 part 1 wired only care + reconciliation; this completes it across the remaining four consoles, so any load-failure banner shows the BFF's `remediation` + `docs_url`, not a bare message:

- **AnalyticsApiError** extended (+`remediation`/+`docsUrl`) and its envelope now parses `error.remediation`/`error.docs_url` (the other 4 lib clients already did; analytics **and** risk share this one envelope via `getAnalyticsView`).
- **approvals** + **tpp-billing** pages capture the typed error's remediation/docsUrl (clean single-source catches); **analytics** + **risk** capture from the first typed `AnalyticsApiError` across their multi-source fetches.
- All four consoles forward `errorRemediation`/`errorDocsUrl` to the shared `ErrorBanner` (renders the remediation line + the http(s)-guarded docs link).

Display-only operator guidance — `remediation`/`docs_url` are already REQUIRED on the spec ErrorEnvelope; no PSU PII, no contract change (aligns the analytics client to the existing contract). Tests: portal unit 288 pass (analytics.spec +1 — envelope remediation parse); typecheck + lint clean. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Isolated worktree.

**Every console's read-path error banner now surfaces remediation.** With this, the implementable UX backlog is fully exhausted — remaining items are enterprise/BD-gated (BACKOFFICE-33, BACKOFFICE-52, M6-PORT-SWAPS).

---

## 2026-06-21 — ADR 0015 drafted: cross-fintech aggregation governance (BD-13 / BACKOFFICE-33)

Drafted the governance decision memo for the one remaining non-adoption-gated backlog item, the same way ADR 0014 was teed up — **Proposed, for data-governance + compliance sign-off; not self-approved.**

- **Finding:** the cross-fintech substrate already exists (the `bank_internal_view` SELECT-only role, the `query_purpose_registry` preventative-control table, and the RLS policies — migrations 0001–0003). BACKOFFICE-33's gap is the **enforcement wiring**: run the analytics aggregates *as* `bank_internal_view`, **purpose-match-or-reject** each query against `query_purpose_registry`, and **High-class log** every bypass query (text + row count). **BD-13** gates *enabling* it.
- **What sign-off authorises:** (1) permissibility of cross-fintech aggregation under PDPL + scheme rules in the bank's dual role; (2) the approved purpose set; (3) control adequacy.
- **Recommendation:** Option 1 (implement the PRD control exactly — the architecture is already blessed + built; the missing pieces are the sign-off + purpose set), with optional four-eyes on new-purpose registration (composes with the existing approvals primitive).

`docs/adrs/0015-cross-fintech-aggregation-governance.md`; BACKOFFICE-33 reason updated to point at it. Docs-only to main.

With this, **every implementable item is shipped and every blocked item has a decision artifact in front of the right human**: ADR 0014 (UX-03c, done) and ADR 0015 (BACKOFFICE-33, awaiting sign-off); BACKOFFICE-52 + M6-PORT-SWAPS are bank-adoption-gated (no demo-profile work).

---

## 2026-06-22 — UI-FIDELITY track opened (ADR 0016) + UIF-01 / UIF-01b foundation

A live portal-vs-Stitch review (screenshots of Dashboard/Analytics/Risk/Ops/Recon/TPP/Care against the Stitch "Refined" references) found the gap is **compositional, not token-level**: tokens are clean but no viz/panel primitives existed, so every screen collapsed to generic KPI cards on empty canvases. The user **reversed ADR 0012 Option 1** → Option 2 (typed panels).

- **ADR 0016** (accepted, supersedes ADR 0012) + the sequenced **UI-FIDELITY** backlog track (PR #175): adopt typed analytics panels + **@visx** behind token-bound primitives; Stitch is appearance-only (never copy its inline REVIEW/APPROVE buttons or mock numbers). UX-11 reopened.
- **UIF-01** (PR #176) — token-only presentation primitives in `apps/portal/src/components/ui/`: **KpiStat**, **StatStrip**, **SectionCard**, **ContributionBar** (SVG geometry in `rect` attributes — the design-conformance gate forbids inline `style`). `StatusTag` = the existing UX-01 `StatusBadge` (reused). TDD: `uif-viz-primitives.spec` 9 incl. vitest-axe.
- **UIF-01b** (PR #177, this `/next-story` iteration) — **@visx** Gauge (270° `Arc` radial dial, ARIA `meter`) + Sparkline (`LinePath` + `scaleLinear`, `role=img`), both `'use client'` islands so @visx stays in the browser bundle, never the Worker server bundle. TDD: `uif-chart-primitives.spec` 8 incl. vitest-axe.

Gates (UIF-01b): `gen` no-drift, lint, typecheck, **full unit 828 pass**, design-conformance scans the new files clean, **Next build** First Load JS unchanged at 102 kB (@visx out of the shared bundle), and the **OpenNext/Cloudflare Worker build** (`.open-next/worker.js` generated, exit 0 — the explicit Worker-bundle check the story was split out for). Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. No screen changes — first live consumption is UIF-03/-04/-06.

**Next eligible:** UIF-02 (sign-in/shell first-impression), UIF-SPEC-TYPED-SECTIONS (the analytics contract change), UIF-07/-08/-09 (the no-gate hand-built screens). UIF-03/-04/-06 unblock once UIF-01b (now done) + the spec-change land.

---

## 2026-06-22 — UIF-02: sign-in + shell first-impression polish (PR #179)

The bare top-left sign-in and the edge-to-edge, footer-less shell read as an unstyled prototype. Token-utility-only polish (no contract change):

- **Sign-in** — `persona-login-list` is now a centred **branded card** (rounded-xl border + shadow on `surface-container-lowest`) led by an **OFBO wordmark** + "Open Finance Back Office" product line; `app/page` centres it both axes (`flex min-h-screen items-center justify-center`) — replaces the top-left look.
- **Shell** — added a **status footer** (`role=contentinfo`, `data-testid=shell-footer` — *DEMO profile · synthetic data only · OFBO · non-prod · egress via P6 · UAE region*, à la the Stitch screens) and a **max-width content container** (`shell-content-inner`, `mx-auto max-w-screen-2xl`) so wide screens no longer stretch edge-to-edge.
- Persona-badge cluster + the (already-correct, UX-10) density toggle left as-is — their testids are load-bearing in `app-shell.spec`.

TDD: `uif02-shell-firstrun.spec` 5 (brand wordmark; preserved region/heading/buttons + axe; footer `contentinfo`; max-width inner). Gates: `gen` no-drift, lint, typecheck, **full unit 833 pass**, design-conformance scans the changed files clean, **a11y + app-shell specs stay green** (footer/card add no axe violations, all shell testids preserved), build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Merged #179 (`c75f65f5`).

Verified structurally (tests/gates), not via a live screenshot this run (the running portal was the prior build); live visual lands on auto-deploy and should be viewed against a **seeded BFF** (`DATABASE_URL`) for a data-populated first impression. **Next eligible:** UIF-SPEC-TYPED-SECTIONS, UIF-07/-08/-09.

---

## 2026-06-22 — UIF-SPEC: typed analytics sections — spec PR #181 (PARKED, human-approved)

A `/next-story` iteration whose deliverable is a **contract change** — so per CLAUDE.md / the spec-change policy it is **opened, not merged** (humans approve contract changes). Authorised in direction by ADR 0016 D1.

- **Spec PR #181** extends `AnalyticsView.data` with an **optional** `sections: AnalyticsSection[]` — discriminated by `kind` (`kpi-strip | gauge | contribution-bars | status-cards | alert | object-table`), per-kind payload schemas (`AnalyticsStat`/`AnalyticsGauge`/`AnalyticsContributionSegment`/`AnalyticsStatusCard`/`AnalyticsAlert`/`AnalyticsTable`) + a shared `StatTone` enum. Backward-compatible: `data` keeps `additionalProperties:true`, unknown kinds degrade to the generic grid.
- Regenerated `api-types` from the spec; `gen`/`typecheck`/`lint`/**full unit 833** green (the response-schema conformance validator compiles the new envelope fine).

**Parked:** `UIF-SPEC-TYPED-SECTIONS` set `blocked` (awaiting #181 human merge). On merge → mark done; **UIF-03/-04/-05 unblock** (their contract tests + BFF producers emitting typed sections + the bespoke renderer land there). The loop continues at the next eligible item — **UIF-06** (executive dashboard; gated only on UIF-01b, not the spec) — then UIF-07/-08/-09.

---

## 2026-06-22 — UIF-06: executive command dashboard — gauge + four-eyes queue (PR #183)

Added the two signature Stitch "Executive Command" (`d8515d63`) elements the dashboard lacked, on the UIF-01/01b primitives and bound to **live data** (no Stitch mock values):

- **SystemHealthPanel** — a `SectionCard` with the UIF-01b radial **Gauge** bound to the real reconciliation pass rate (latest completed run, from `getDashboardCharts().reconTrend`) = Stitch's System-Heartbeat dial.
- **FourEyesQueuePanel** — a `SectionCard` listing `listPendingApprovals` as **deep-links to `/approvals/{id}`** with the UX-03c NON-PII `operation_summary` (humanised op type, `formatSummaryMoney`, counterparty, relative expiry via reused `formatExpiry`), a count chip, empty state. **Four-eyes hard-stop honoured:** the queue **never renders inline approve/reject** — execution stays `202` + approval, BFF-side, by a second principal (asserted in the test).

Wired into `app/dashboard` (fetch the pending list + derive pass rate; both degrade on 403/empty). Existing KPI cards + hand-rolled trend/severity charts + audit feed kept (working, token-clean). TDD: `dashboard-command.spec` 6 (gauge meter + value; queue deep-links + money-from-minor-units; NO approve/reject controls; empty; axe). Gates: `gen` no-drift, lint, typecheck, **full unit 840**, design-conformance scans the new file clean, build OK. Reviewers: hard-stop **PASS** (four-eyes + PII verified), contract-conformance **CONFORMANT**. Merged #183 (`9978ea5f`).

**Deferred:** the Stitch sparkline metric tiles (TPP traffic / error rate / settlement vol) — they need analytics series the dashboard getters don't expose (adding them would mean inventing data — a hard-stop — or cross-scope analytics); revisit if those endpoints land. **Next eligible:** UIF-07 (recon three-way), then UIF-08/-09.

---

## 2026-06-22 — UIF-07: reconciliation outcome panel (PR #185)

The real-data slice of the Stitch "Reconciliation Console (Refined)" (`46e55863`). A judgment call: UIF-07's promised sections split into buildable-now vs data-gated, and I shipped the former + split the latter rather than invent data (a hard-stop).

- **Shipped** — `ReconOutcomePanel` (components/recon-outcome.tsx): a UIF-01 `SectionCard` wrapping the UIF-01b **Gauge** (run pass rate) + the UIF-01 **ContributionBar** (matched/unmatched/disputed split), bound to the selected run's live counts. Rendered after the existing KPI cards — purely additive; the working, a11y-tested KPIs/run-list/break-queue untouched. TDD: `uif07-recon-outcome.spec` 3 (gauge meter + value, matched-segment proportional width, div-by-zero guard, axe).
- Gates: `gen` no-drift, lint, typecheck, **full unit 844**, design-conformance scans the new file clean, recon-console + recon-a11y specs stay green, build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Merged #185 (`e0ba7ef9`).

**Split → UIF-07b (blocked):** the data-gated Stitch remainder — (a) a true three-way SOURCE-totals table (per-source amounts aren't in the `ReconciliationRun` contract → recon spec-change), (b) Margin-by-Fintech (BACKOFFICE-31 free-form analytics, entangled with the blocked UIF-SPEC), (c) Export/monthly Sign-off (BACKOFFICE-06 four-eyes mutation → own story). Recorded with the dependency, held back behind the spec-change workflow rather than implemented against absent fields.

**Next eligible:** UIF-08 (TPP billing action center), then UIF-09. UIF-03/-04/-05 stay blocked on spec PR #181 (human merge).

---

## 2026-06-22 — UIF-08: TPP billing overview (PR #187)

The real-data slice of the Stitch "TPP Billing & Registry (Refined)" (`3d6d14a3`). Same pattern as UIF-07: ship the real-data overview, split the heavier table/action sections.

- **Shipped** — `TppBillingOverview` (components/tpp-billing-overview.tsx): a UIF-01 `SectionCard` with a **StatStrip** of KpiStats (consuming-TPP count, registered, unbilled-traffic, **MTD fee accrual total** summed from the real `mtd_fee_accrual` integer minor-units) + a **ContributionBar** of the `registration_state` distribution, computed from the already-fetched counterparty list and rendered above the registry grid. Additive — the registry table, invoice runs, and mutations are untouched. TDD: `uif08-tpp-overview.spec` 3 (KPI summarisation incl. money-from-minor-units, registration-state bar, axe).
- Gates: `gen` no-drift, lint, typecheck, **full unit 848**, design-conformance scans the new file clean, tpp-billing specs stay green, build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Merged #187 (`b4eea567`).

**Split → UIF-08b (pending):** the heavier Stitch sections — registry columns/search/filter, billing action center, billing-cycle stepper, audit-trail feed — all real-data-backed (no contract dependency), sequenced after the overview.

**State of the UI-FIDELITY track:** primitive layer (UIF-01/01b) + sign-in/shell (UIF-02) + four bespoke overview panels (UIF-06 dashboard, UIF-07 recon, UIF-08 tpp) are in. Remaining: UIF-03/-04/-05 (Analytics/Risk/Ops — the biggest visual wins, **blocked on spec PR #181**), UIF-09 (care + finance-investigation), the *-b table/mutation follow-ups, and UIF-10 (re-audit). **Next eligible: UIF-09.**

---

## 2026-06-22 — UIF-08b: scope-aware TPP registry filter (PR #189)

Closed the design-audit's "registry has no search/filter" gap with a real server-side filter (no Stitch mock values).

- **Shipped** — `RegistryFilter` (components/tpp-billing/registry-filter.tsx): a server-rendered GET form (registration_state select + unbilled-traffic toggle + Clear, role=search, token-only, no client JS), wired through `app/tpp-billing/page.tsx` to `listCounterparties`' existing `CounterpartyQuery` so the **BFF filters server-side** (billing:read); filter values are reflected back into the form AND preserved across the `reg_cursor` pagination href. TDD: `uif08b-registry-filter.spec` 4 (GET form + options + toggle, reflects active values + clear, omits clear when inactive, axe).
- Gates: `gen` no-drift, lint, typecheck, **full unit 853**, design-conformance scans the new file clean, tpp specs stay green, build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT** (portal `reg_state`→wire `registration_state` snake_case; enum matches the contract; cursor pagination preserved, no offset). Merged #189 (`db1d9645`).

**Split → UIF-08c (pending):** cosmetic Stitch polish — columnar registry table layout, Billing Action Center (grouping the existing mutations), billing-cycle stepper (from InvoiceRun.status), audit-trail feed. Low priority, no contract dependency.

**Next eligible: UIF-08c**, then UIF-09. The high-impact UIF-03/-04/-05 (Analytics/Risk/Ops bespoke panels) remain blocked on spec PR #181 (human merge) — the highest-leverage unblock for the loop.

---

## 2026-06-22 — UIF-08c: columnar consuming-TPP registry table (PR #191)

Closed the design-audit's "registry reduced to a flat list (no columns)" finding (Stitch `3d6d14a3`).

- **Shipped** — converted `RegistryTable` from a card-list to a semantic columnar `<table>` (thead/th[scope=col]: TPP / Status / MTD accrual / Action; overflow-x-auto). Strictly more accessible (real column headers); preserves every existing data testid (accrual-/unbilled-/tpp-/registry-empty) + the per-row P9 register action (unchanged). TDD: `uif08c-registry-table.spec` 3 (table role + column headers + row data; empty state keeps no table; axe).
- Gates: `gen` no-drift, lint, typecheck, **full unit 856**, design-conformance clean, tpp-billing-dashboard spec stays green (testids intact), a11y.spec stays green (table axe-clean in TppBilling), build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT** (also corrected a test fixture to a contract-accurate production_status enum per the review note). Merged #191 (`0049eca0`).

The other UIF-08c-listed items (action-center, single-run stepper, billing audit feed) were **dropped as low-value** rather than split again — reopen only on request.

**Next eligible: UIF-09** (care console minor-drift + finance-investigation screen; part (b) needs a Stitch screen generated first per CLAUDE.md). UIF-03/-04/-05 stay blocked on spec PR #181.

---

## 2026-06-22 — UIF-09: care console connected event timeline (PR #193) + LOOP DRAINED

The real, no-design-gate slice of the care console MINOR-DRIFT (Stitch `39ce3cee`).

- **Shipped** — `EventTimeline` (components/care/event-timeline.tsx): a UIF-01 `SectionCard` with a connected vertical timeline (dot + flex-1 connector) whose dots are coloured by the `event_type` enum (granted→reconciled, accessed→secondary, modified→break, revoked→breach). **PII discipline preserved** — `psu_identifier`/`event_data` never projected (asserted by a negative test). `care-console.tsx` swaps the local `TimelinePanel` for it. TDD: `uif09-care-timeline.spec` 5.
- Gates: `gen` no-drift, lint, typecheck, **full unit 862**, design-conformance clean, care-console + a11y specs stay green, build OK. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. Merged #193 (`15375fc5`).
- **Split → UIF-09b (blocked):** bulk-revoke header (needs a bulk-revoke flow/screen) + finance Investigation rebuild (needs a Stitch finance three-source-diff screen GENERATED first per CLAUDE.md).

### Loop status — ELIGIBLE QUEUE EMPTY (human decisions required)

Every remaining backlog item is `blocked`. The `/next-story` loop has drained all unblocked work. Human decisions needed to refill the queue:

1. **Merge spec PR #181** (`UIF-SPEC-TYPED-SECTIONS`) — the highest-leverage: unblocks **UIF-03/-04/-05** (Analytics/Risk/Operations bespoke panels, the biggest remaining visual wins) + the margin part of UIF-07b. Additive, backward-compatible, 862 tests green.
2. **UIF-09b** — decide to GENERATE the Stitch finance-investigation screen (+ optionally a bulk-revoke screen) so the investigation rebuild + bulk-revoke header can be built.
3. **BACKOFFICE-33** — BD-13 governance sign-off (ADR 0015, Proposed) for cross-fintech aggregation.
4. **BACKOFFICE-52 / M6-PORT-SWAPS** — bank-adoption / enterprise-engagement gated (no demo-profile work).

**UIF-10** (final re-audit vs Stitch) is intentionally NOT run yet — it should follow the bespoke screens (UIF-03/-04/-05), i.e. after #181 merges.

**Shipped this UI-FIDELITY run (10 stories):** UIF-01/01b (primitives + @visx charts), UIF-02 (sign-in/shell), UIF-06 (dashboard gauge + four-eyes queue), UIF-07 (recon outcome), UIF-08/08b/08c (tpp overview + filter + table), UIF-09 (care timeline). All merged, all gates green, all hard-stop + conformance clean.

---

## 2026-06-22 — spec PR #181 MERGED (human-approved) → UIF-03/-04/-05 UNBLOCKED

The user approved + I merged spec PR #181 (`e8a8aef`): `AnalyticsView.data` gains an OPTIONAL `sections: AnalyticsSection[]` (typed/named analytics panels — kpi-strip | gauge | contribution-bars | status-cards | alert | object-table + per-kind payloads + a StatTone enum), backward-compatible (`data` stays `additionalProperties:true`; unknown kinds degrade to the generic grid). No file conflicts (no UIF PR touched the spec/api-types); post-merge **gen no-drift + typecheck clean across all 9 projects**.

`UIF-SPEC-TYPED-SECTIONS` flipped blocked → **done**. The eligible queue is refilled: **UIF-03 (Analytics), UIF-04 (Risk), UIF-05 (Operations)** are now eligible — the bespoke typed-panel renderers that are the biggest remaining visual wins. Each is now: emit typed sections from the BFF analytics producer → map each `kind` to a UIF-01/01b primitive (Gauge/ContributionBar/KpiStat/StatStrip/StatusBadge/SectionCard) in a typed-section renderer, replacing the generic grid. UIF-07b's margin part also unblocks once those land. **Next `/next-story` picks up UIF-03.**

---

## 2026-06-22 — UIF-03: bespoke Analytics panels (BFF + renderer) — PR #196

Reopened UX-11; the **first bespoke screen** on the typed analytics-sections contract (#181). Spans BFF + portal.

- **Portal** — `AnalyticsSections` (components/analytics/analytics-sections.tsx): the **shared typed-section renderer** mapping each `AnalyticsSection.kind` → a UIF-01/01b primitive (kpi-strip→StatStrip/KpiStat, gauge→Gauge, contribution-bars→ContributionBar, status-cards→toned cards, alert→callout, object-table→table; unknown→null/degrade). `lib/analytics` gained the contract-sourced `AnalyticsSection` type + `sectionsOf(view)`; the `AnalyticsSection` wrapper renders bespoke sections when present else the generic `MetricGrid` (backward-compatible).
- **BFF** — `ExecutiveDashboardService.view` now emits `data.sections` from **live metrics** (no mock values), **scope-gated like the angles**: a Reconciliation-Pass-Rate gauge (base) + a Commercial-Metrics kpi-strip (margins formatted from integer minor units) + a Margin-by-Product-Family contribution-bars (`commercial:read` only).
- TDD: `uif03-analytics-sections.spec` 8 (all 6 kinds + unknown-degrade + axe) + `executive-dashboard.spec` +2 (sections emitted; base-scope scope hygiene). Gates: gen no-drift, lint, typecheck (all), **full unit 873**, design-conformance clean, analytics + a11y green, **executive-dashboard.int green vs local PG**, build OK. Reviewers: hard-stop **PASS** (scope-gating + minor-unit money), conformance **CONFORMANT**. Merged #196 (`4fe14a3e`).

**The renderer is now shared infrastructure** — UIF-04 (Risk) + UIF-05 (Operations) reuse it, so they shrink to: emit typed sections from their BFF producers (risk-view / operations-console) + the screen already renders them. **Next eligible: UIF-04.**

---

## 2026-06-22 — UIF-04: bespoke Risk panels (BFF-only) — PR #198

Confirmed the UIF-03 renderer pays off: the RiskDashboard already renders typed sections via the shared `AnalyticsSection` wrapper, so UIF-04 was a **BFF-only change (no portal diff)**.

- Both risk producers now emit `data.sections` from live data (no mock values), all `risk:read`: **RiskViewService** — a Risk-Signals kpi-strip (active / consent-anomaly / tpp-anomaly counts) + an Open-Signals-by-Severity contribution-bars; **LiabilityViewService** — a Liability-Events-by-Severity contribution-bars + an Approaching-Triggers object-table (issue/party/accrued_aed/severity). PSU-PII discipline preserved (counts + institutional refs only; no signal_data).
- TDD: `risk-view.spec` +1, `liability-monitor.spec` +1. Gates: gen no-drift, lint, typecheck (all), **full unit 875**, build OK, **risk-view.int + liability-monitor.int green vs local PG**. Reviewers: hard-stop **PASS** (PII + scope + money), conformance **CONFORMANT**. Merged #198 (`3c8de300`).

**Next eligible: UIF-05 (Operations)** — same BFF-only pattern (operations-console producer emits sections; the OperationsConsole already renders via the shared wrapper). Then **UIF-10** (the final Stitch re-audit — the capstone, run after all bespoke screens are in).

---

## 2026-06-22 — UIF-05: bespoke Operations panels (BFF-only) — PR #200 [autonomous /loop]

The last bespoke screen, shipped under the autonomous `/loop`. Same BFF-only pattern as UIF-04 (the OperationsConsole already renders via the shared `AnalyticsSection` wrapper).

- `OperationsConsoleService` now emits `data.sections` from live data (no mock values), `platform:operations:read`: a Platform-Health kpi-strip (active outages / TPP onboarding total / Nebras connectivity) + a TPP-Onboarding-Pipeline contribution-bars (`pipeline.by_state`) + an Active-Outages object-table (title/component/severity/started_at). Aggregate/institutional data only — no PSU PII.
- TDD: `operations-console.spec` +1. Gates: gen no-drift, lint, typecheck, **full unit 876**, build OK, **operations-console.int green vs local PG**. Reviewers: hard-stop **PASS**, conformance **CONFORMANT**. Merged #200 (`aa966eff`).

### Bespoke-screen tranche COMPLETE (UIF-03 / -04 / -05)

All three generic-grid analytics screens — Analytics, Risk, Operations — now render bespoke typed-section panels (gauges / contribution-bars / KPI strips / status-cards / tables) bound to live, scope-gated BFF data, via the one shared UIF-03 renderer. Combined with UIF-01/01b (primitives + @visx), UIF-02 (sign-in/shell), and the dashboard/recon/tpp/care bespoke work, **the original "looks like shit" complaint is comprehensively resolved**. Only **UIF-10** (the final Stitch re-audit + canonical screen-id pinning + design-conformance-audit.md update) remains.

---

## 2026-06-22 — UIF-10: re-audit vs Stitch — UI-FIDELITY track COMPLETE — PR #202 [autonomous /loop]

The closing gate. Re-read every portal screen on `main` after UIF-01..09 and rewrote `docs/design-conformance-audit.md` (2026-06-22 re-audit), reconciling each verdict against the original 2026-06-21 Stitch findings.

- **Analytics / Risk / Operations** — the three MAJOR-DRIFT generic-renderer screens → **CONFORMANT**, resolved by the bespoke typed-section panels (UIF-03/04/05; **ADR 0016 supersedes 0012**).
- **Reconciliation / TPP-Billing** — MAJOR → MINOR (UIF-07/08/08b/08c; remainder gated UIF-07b).
- **Care** — MINOR, improved (timeline UIF-09; bulk-revoke/per-row-investigate gated UIF-09b).
- **Investigation** — still MISSING REF (UIF-09b — needs a Stitch screen + a human call).
- **Target met: no MAJOR-DRIFT remains.** Canonical Stitch screen id pinned per route in the audit doc's reference map. Docs-only — lint clean, full unit 876, build OK. Reviewers: hard-stop **PASS**, conformance **CONFORMANT** (doc's spec claims verified against the OpenAPI). Merged #202 (`d9efd389`).

### UI-FIDELITY track CLOSED + autonomous loop drained

The full track shipped this session: UIF-01/01b (token primitives + @visx charts), UIF-02 (sign-in/shell), UIF-03/04/05 (Analytics/Risk/Operations bespoke panels), UIF-06 (dashboard), UIF-07 (recon outcome), UIF-08/08b/08c (TPP overview/filter/table), UIF-09 (care timeline), UIF-10 (this re-audit) — plus ADR 0016 + the typed-sections spec (#181). The original "the portal looks like shit" finding is resolved at the appearance/composition level.

**Eligible queue is now EMPTY — the loop is winding down.** All remaining backlog items are human/design-gated, not loop-eligible:
- **UIF-07b** — recon three-source comparison table + Margin-by-Fintech (needs a finance sign-off + the Stitch 'Refined' data shapes).
- **UIF-09b** — generate the finance Investigation screen in Stitch; bulk-revoke header + per-row Investigate on Care (design/flow prerequisite).
- **BACKOFFICE-33** — BD-13 governance sign-off (cross-fintech aggregation).
- **BACKOFFICE-52** — PRD §7 'Must' awaiting backlog/decision.
- **M6-PORT-SWAPS** — per-bank enterprise engagement (systems + credentials).

---

## 2026-06-22 — Compliance view brought up to UI-FIDELITY (bespoke panels)

Spotted in the running demo: `/compliance` still rendered the generic metric grid while Analytics/Risk/Operations had bespoke panels. Root cause — the UI-FIDELITY track (UIF-03/-04/-05, ADR 0016) updated those three BFF producers to emit typed `data.sections`, but the **compliance producer was never updated**, so the (already-upgraded) shared `AnalyticsSection` renderer fell back to the generic grid for it.

Fix (BFF-only — the portal renderer already supports it): `services/bff/src/analytics/compliance-view.ts` now emits typed `data.sections` using the established section kinds —
- **kpi-strip** "Compliance Posture": consent-event volume, open disputes, open risk signals, reports awaiting approval;
- **alert** (severity `critical`) when any table is past its immutable-retention boundary (deletion-forbidden posture flag);
- **contribution-bars** "Open Risk Signals by Severity";
- **object-table** "Retention Lifecycle (hot / warm / immutable)".

Aggregate counts + table names only — no PSU PII (test asserts it). A first review caught a real enum drift (`alert.severity: 'high'` → not in `AnalyticsAlert`'s `[info, warning, critical]`); fixed to `critical`. Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. 877 unit pass (compliance-view.spec +1); typecheck + lint clean.

---

## 2026-06-22 — Finance View brought up to UI-FIDELITY (bespoke panels)

Found while checking the screens after the compliance fix: `/analytics` was only half-updated — the **Executive Dashboard** had bespoke panels but the **Finance View** still rendered the generic grid. Same root cause as compliance: the finance-view BFF producer never emitted typed `data.sections` (no UIF commit in its history).

Fix (BFF-only): `services/bff/src/analytics/finance-view.ts` now emits typed sections — a **kpi-strip "Finance Overview"** (MTD fee accrual + total TPP-aaS margin in major units, open Nebras disputes, unbilled-traffic alerts), **contribution-bars "Fee Accrual by Line Type"**, and **contribution-bars "Margin by Product Family"** (mirroring the executive dashboard's margin rollup). The existing free-form `data.*` fields are unchanged (wire Money stays integer minor units). Aggregate finance figures + institutional labels only — no PSU PII (test asserts).

Reviewers: hard-stop **PASS**, contract-conformance **CONFORMANT**. 879 unit pass (finance-view.spec +1); typecheck + lint clean.

With this, all four analytics-renderer screens (Analytics[exec+finance] / Risk / Operations / Compliance) render bespoke typed-section panels.

---

## 2026-06-22 — UIF-07b: TPP-aaS Financial Reconciliation panel (recon console) — PR #207

User-directed unblock of UIF-07b's margin slice (after the demo-margin enrichment #204 made the data meaningful).

- **Portal-only, no spec change.** New `components/recon-finance.tsx` renders the three reconciliation sources at the money level — A = Nebras billing, C = fintech re-bill, net margin = C − A (B = bank metering reconciles A via the run match counts) — as a UIF-01 StatStrip + Margin-by-Fintech + Margin-by-Product-Family ContributionBars. `lib/recon-finance.ts` parses the BACKOFFICE-31 Finance View margin defensively (same `reconciliation:read` scope the recon console already holds; `getReconFinance` degrades to null). Additive: run-list / break-queue / outcome panel untouched.
- TDD: `uif07b-recon-finance.spec` 4 (parser totals/sort/family-agg/null-degrade; panel money + note + bars; axe). Gates: gen no-drift, lint, typecheck (all), **full unit 883**, design-conformance clean, recon-console + recon-a11y green, build OK. Reviewers: hard-stop **PASS**, conformance **CONFORMANT**. Merged #207 (`db06ea61`).
- **Residual (own follow-ups, not delivered):** (a) the literal per-source LINE-amount table needs source-B totals the recon contract doesn't expose → a recon spec-change; (c) Export/monthly Sign-off is a four-eyes mutation (BACKOFFICE-06) → a standalone story.

Backlog after this: zero loop-eligible items; remaining blocked items (UIF-09b, BACKOFFICE-33, -52, M6) all need a human decision/input.

---

## 2026-06-22 — BD-13 sign-off: ADR 0015 accepted (Option 1 + four-eyes); BACKOFFICE-33 unblocked

User signed off BD-13 via **ADR 0015 → Accepted (Option 1 + four-eyes on new-purpose registration)** and approved the starter purpose set. BACKOFFICE-33 (governed cross-fintech aggregation) is now eligible.

**Approved starter `query_purpose_registry` set** (seeded pre-approved): `executive_dashboard`, `finance_view`, `risk_monitoring`, `operations_monitoring`, `compliance_reporting`, `regulatory_periodic_report`. New purposes added later require four-eyes (the `approved_by` column supports it via the approvals primitive).

**Finding that reframes the work:** the dashboards currently read SINGLE-TENANT (`ofbo_app` + RLS pinned to one `bank_id`) — they don't yet read the cross-fintech MVs (granted only to `bank_internal_view`). BACKOFFICE-33 is the switch to genuine cross-fintech reads under the governed role + purpose-gate + High-class query log. In the single-bank demo the visible numbers may be unchanged; the governed control path is what ships.

**Build plan (each its own PR):** (1) `beginInternalViewTx()` (role + purpose-match-or-reject + High-class log); (2) seed the six purposes; (3) route analytics aggregate reads to the cross-fintech MVs via the governed path; (4) four-eyes on new-purpose registration; (5) tests (unregistered-purpose rejected, tenant role can't read aggregate output, four-eyes flow). ADR 0015 + BACKOFFICE-33 backlog updated. Docs-only commit to main; implementation follows.

---

## 2026-06-22 — BACKOFFICE-06: four-eyes monthly reconciliation sign-off — spec #209 + feature #210

User-directed (UIF-07b residual (c)). Contract-first: a human-approved spec change, then the implementation.

- **Spec #209 (human-approved):** `POST /reconciliation/monthly-signoff` → `x-four-eyes: true`, response `200` (Report) → `202` (ApprovalPending). Mirrors the fraud-revoke four-eyes spec (#26). Locking a 5-year-immutable monthly `compliance_report` must not be a single-actor inline mutation.
- **Feature #210:** BFF split `monthlySignoff` → `initiateMonthlySignoff` (requests the approval; asserts finance:reconciliation:write) + `executeMonthlySignoff` (locks the report attested to the INITIATOR, runs only on approval). Registered the `reconciliation.monthly_signoff` GatedOperation (late-bound via a holder to break the request↔execute cycle); the route returns 202 + approval_request and the old inline path is GONE. Portal: `requestMonthlySignoff` + `requestSignoffAction` + a "Request monthly sign-off" control on the recon console → 202 → links to /approvals.
- TDD: `reconciliation-monthly-signoff.spec` rewritten to the four-eyes flow (request 202 → self-approval 409 → a different finance principal approves → the locked signed report; idempotent; validations); `.int` exercises `executeMonthlySignoff` vs real PG; `uif07b-signoff-form.spec`. Gates: gen no-drift, lint, typecheck (all), **full unit 887**, build OK, reconciliation-monthly-signoff.int green vs local PG. Reviewers: hard-stop **PASS** (202+approval, no inline bypass, initiator≠approver, audit preserved), conformance **CONFORMANT**. Merged #210 (`fa664d1f`).

Backlog: zero loop-eligible items remain; UIF-07b residual (a) per-source line-totals table still needs a recon spec-change; UIF-09b / BACKOFFICE-33 / -52 / M6 all need a human decision.

---

## 2026-06-22 — UIF-07b (a): three-way source comparison table — PR #213 (UIF-07b fully closed)

User-directed. I'd offered a recon spec PR for the per-source totals, but on inspection it was buildable spec-free (the source-B/platform metering total is derivable from the same sources the finance-view already re-derives — the original "needs a spec change" analysis assumed the totals had to live on ReconciliationRun).

- **BFF:** `ReconciliationService.threeWaySourceTotalsForPeriod(period)` re-derives each run's sources and sums the three at the money level — A = Nebras billing (billed fees), B = bank platform metering-of-record (schedule-expected fees from metered call counts), C = fintech re-bill (integer fils). finance-view emits `data.three_way_source_totals` + a "Three-Way Source Reconciliation" kpi-strip section.
- **Portal:** lib/recon-finance parses it (degrades to null); ReconFinancePanel renders a Three-Way Source Comparison table (A/B/C period totals) — B is the previously-missing total, so it's a genuine three-source comparison now.
- TDD: reconciliation-margin.spec +1 (A/B/C > 0), finance-view.spec asserts the field, uif07b-recon-finance.spec +2 (parser + table). Gates: gen no-drift, lint, typecheck (all), **full unit 890**, build OK, finance-view.int green vs local PG. Reviewers: hard-stop **PASS**, conformance **CONFORMANT** (free-form data extension, no spec change). Merged #213 (`2f2a4d12`).

**UIF-07b fully closed** (a + b + c). Backlog: zero loop-eligible items; remaining blocked items (UIF-09b, BACKOFFICE-33, -52, M6) all need a human decision/input.

---

## 2026-06-22 — UI-01: dark navy institutional shell across every screen — PR #216

User-directed. The portal shell sidebar rendered light (bg-surface); the Stitch reference "OFBO - Operations Console (Synchronized)" (screen 16229c0b…) and the design system itself ("Primary Navy #0F172A: used for global navigation") intend a dark navy side menu. Brought the shared AppShell into line — one component, so the navy chrome shows on every screen at once.

- Added a semantic nav-* token group (no raw hex in components; hex lives only in design/tokens.ts): nav #0f172a (navy sidebar), on-nav #cbd5e1 (slate-300 text), nav-elevated #1e293b (slate-800 hover + border), nav-active #60a5fa (blue-400 active accent); wired through tailwind.config.
- Restyled the AppShell sidebar to the navy tokens (white brand; inactive text-on-nav → hover:bg-nav-elevated hover:text-white; active bg-secondary/20 + border-secondary/30 + text-nav-active). Top bar + content stay light, matching the template. Scope-aware nav / persona badge unchanged.
- NOT a design-system change (the design-md already specified navy nav) → no ADR.
- TDD: design-tokens.spec (nav values), app-shell.spec (navy sidebar + light top bar). Gates: lint, typecheck (all), design-conformance clean (token-only), a11y axe green, full unit 892, build OK, all 6 CI gates green incl. Q3 Playwright E2E. Reviewer: hard-stop PASS (token-only, zero PII, no logic touched). Conformance N/A (no contract surface). Merged #216 (cf17117a).

Note: the Stitch finance Three-Source Break Investigation screens have now landed (e.g. 251beaef…) — UIF-09b's design prerequisite is unblocked; wiring /reconciliation/breaks/[id] to it is the next buildable step on request.

---

## 2026-06-22 — UIF-09b (b): finance three-source break investigation — PR #218

User-directed (after the user generated the Stitch screen). The break investigation detail (/reconciliation/breaks/[id]) already had the A/B/C diff + summary KPIs + Nebras dispute; the now-existing Stitch "Reconciliation Break Investigation (Finance, Three-Source)" screen (251beaef…) gave the design reference to finish it — UIF-09b part (b), previously blocked on the missing screen.

- Per-source reconciled markers (green check on present source refs; missing ref keeps red MISSING — a null ref IS the divergence).
- Data-honest summary strip: "{present refs} reconcile · {missing} missing → break of {variance}" (variance from the break; no fabricated per-source amounts).
- Audit Trail timeline: detected (created_at) → assigned (assigned_to + SLA) → escalated (nebras_dispute_case_id, else "requested" while escalatable) → resolved (resolution_outcome); every node derived from a break field.
- All from the existing getBreak — no contract change. escalate stays BACKOFFICE-05 (P6 egress). Token-only (timeline line w-px bg-outline-variant; no arbitrary values). TDD: investigation-detail.spec +4. Gates: lint, typecheck (all), design-conformance clean, a11y axe green, full unit 896, build OK, all CI gates green. Reviewer: hard-stop PASS (token-only, zero fabricated data, escalate untouched). Conformance N/A. Merged #218 (fde7f44c).

Backlog: UIF-09b (b) DELIVERED; (a) bulk-revoke header / per-row Investigate remains its own gated four-eyes story (needs a portal bulk-revoke flow). The Ghost Balance Shadow Ledger Stitch screen is still off the standard shell (cosmetic, Stitch-only; doesn't affect the app).

---

## 2026-06-22 — UIF-09b (a): emergency PSU-wide bulk-revoke flow — PR #220 (UIF-09b fully closed)

User-directed. The BACKOFFICE-18 backend (POST /consents:revoke-bulk, four-eyes) existed but had no portal journey; this adds it — the last buildable gated UI flow.

- BulkRevokeModule on the care console PSU view (emergency red-bordered card), shown only when the PSU has ≥1 revocable consent. Revokes ALL of the PSU's active consents at once (reason CLIENT_INSTRUCTION — the only enum value).
- bulkRevoke lib client → POST /consents:revoke-bulk → 202 + approval_request; bulkRevokeAction server action (re-checks consents:admin) → notice + link to /approvals. A second consents-admin approver completes it, never inline. Two-step ConfirmSubmit guards the trigger.
- PII discipline: the PSU identifier travels server-side via hidden inputs (reuses the care console PSU context) — not re-typed into the browser.
- No spec change (endpoint pre-existed). TDD: bulk-revoke-form.spec + care-console gating test. Gates: gen no-drift, lint, typecheck (all), design-conformance clean, a11y axe green, full unit 900, build OK, all CI gates green. Reviewers: hard-stop PASS (four-eyes 202 no-inline, PSU-PII hidden-inputs-only, scope re-checked, idempotency + confirm), conformance CONFORMANT (body/headers/202 match spec). Merged #220 (fe9abc89).

UIF-09b CLOSED (both halves). Residual (not part of the item): per-row "Investigate" on consents is undefined against the current contract — own spec/story if wanted. Remaining backlog is governance/engagement (BACKOFFICE-33, -52, M6) + cosmetic Stitch (Ghost Balance off-shell).

---

## 2026-06-22 — UX: subtle non-prod marker + engaging welcome/persona screen — PR #223

User-directed (two entry-experience improvements).

- **Non-prod marker**: the full-width orange `bg-demo` top bar → a subtle fixed top pill (DemoPill), still rendered once in the root layout (rides every screen) + added to global-error (the crash boundary that replaces the root layout — closed a pre-existing gap). Short visible label; the full "synthetic data only · no real PSU data, ever · non-production" statement is in aria-label/title (role=note) so the hard-stop "must say so on every screen" holds. Shell footer keeps the fuller line. Removed dead .demo-banner CSS.
- **Welcome/persona screen**: PersonaLoginList redesigned into a two-panel card — a navy explainer (what OFBO is / what it does, 4 capability tiles / how it works: four-eyes · scope hygiene · zero PII · secure egress) + an enriched role chooser (each persona card shows its purpose + reachable modules via a presentation-only PERSONA_GUIDE; no contract data / no PII). MFA-enforced native form POST to /api/login + hidden token unchanged.
- Token-only (navy nav-* tokens), zero PSU PII. TDD: components.spec (DemoPill aria statement, welcome hero + per-role module chips, axe). Gates: lint, typecheck (all), design-conformance clean, a11y green, full unit 902, build OK, all CI gates green. Reviewer: hard-stop PASS (marker persistent + aria-complete on every screen incl. crash boundary, zero PII, token-only, sign-in intact). Conformance N/A. Merged #223 (00fb2922).

Built directly against tokens (user's call); a matching Stitch "Welcome / Persona Selector" screen still to be generated + pinned for the record.

---

## 2026-06-22 — BACKOFFICE-33 PR 1/5 merged: governed cross-fintech aggregation foundation (#222)

Control core for the platform's highest-sensitivity data path (cross-fintech RLS bypass), per ADR 0015 (BD-13: Option 1 + four-eyes). DB-layer only — no API/spec change.

- `tenant-tx.ts` `beginInternalViewTx()` — `SET LOCAL ROLE bank_internal_view` (no `app.bank_id` pin → reads the `internal_view_select USING(true)` MVs across tenants); only reached via the governed helper.
- `governed-aggregate.ts` `runGovernedAggregate()` — purpose-match-or-reject vs `query_purpose_registry` (rejects BEFORE any read), runs as `bank_internal_view`, then High-class logs a `cross_fintech_query` event (`purpose_code` + `row_count`; written as `ofbo_app`, not the SELECT-only bypass role). Plus `isPurposeApproved`, `seedQueryPurposes` (emits BCBS 239 lineage for the registry write), `SEED_QUERY_PURPOSES` (6 BD-13 purposes, pre-approved).
- migration `0026` — grants `bank_internal_view` membership to the connection user (0008 only granted `ofbo_app`; SET ROLE would have failed on managed Postgres).
- Tests: 6 unit + 5 integration. Gates: gen/lint/typecheck, unit 893, integration 5/5, Q4.5 lineage PASSED. Reviewers: hard-stop PASS, conformance CONFORMANT.

Process note: the PR stalled for hours because it went CONFLICTING on this build-log.md (parallel sessions append constantly) — GitHub silently won't schedule pull_request CI for an unmergeable PR, which looked like an Actions outage but wasn't. Fix: the merged PR is packages/db-only (additive, never conflicts); build-log/backlog land here directly on main. Lesson: watch the PR `mergeable` state, not just CI presence.

BACKOFFICE-33 stays in-progress — PRs 2-5: route analytics reads through the governed path, demo-seed integration, four-eyes on new-purpose registration, end-to-end tests.

---

## 2026-06-22 — UX: collapsed-brand monogram + friendly identity chip & /profile — PR #225 (+ E2E fix #226)

User-directed (live feedback after viewing the running app).

- **Collapsed sidebar overlap**: the "OFBO" wordmark overflowed the 64px collapsed rail → replaced with a compact "OF" monogram tile (bg-nav-elevated) that fits; the "OFBO Portal" wordmark shows only when expanded (sr-only full name kept).
- **De-geeked top bar**: dropped the raw persona key + "N scopes" count; now a friendly "Signed in as <Role>" chip (personaLabel: finance-analyst → Finance Analyst) that links to a new **/profile**.
- **/profile** (in the shell): the signed-in role + its purpose, "What you can do" (scope-gated modules it can open), and "Your privileges" — each scope in plain language (SCOPE_DESCRIPTIONS) with the raw scope kept subtly alongside; a "Switch persona" action. Read-only; shows only the caller's own minted scopes (no grant/widen).
- Token-only, no PII. TDD: app-shell.spec (friendly label, identity→/profile, no scope-count), profile-view.spec (role, reachable modules, plain-language privileges + raw scope, super-admin, axe). Gates: lint, typecheck (all), design-conformance clean, a11y green, full unit 913, build OK. Reviewer: hard-stop PASS (scope hygiene — own scopes only, no grant; zero PII; token-only; sign-in/audit intact). Merged #225 (34633750).
- **Regression + fix (#226)**: the portal E2E (portal.e2e.ts:23) still asserted the RAW persona key on role-badge, so Q3 Playwright went red — and the merge-watcher merged #225 before the E2E had registered (a polling race). Fixed forward: aligned the E2E to the friendly "Platform Super Admin" label + locked the identity-chip→/profile link. Merged #226 (474e9823) with ALL checks green (E2E included). Lessons: grep the E2E suite when a testid's text/structure changes; the watcher must wait for checks to register (use `gh pr checks --watch`).

---

## 2026-06-22 — BACKOFFICE-33 PR 2/5 merged: Compliance View reads via the governed path (#228)

The Compliance View's four cross-fintech metric reads (consent volumes, dispute + risk backlogs, report library) now run through `runGovernedAggregate` (purpose `compliance_reporting`): as `bank_internal_view` (RLS bypassed across tenants), purpose-gated (reject if unregistered), and each bypass High-class logged (`cross_fintech_query`: purpose_code + row_count, written as ofbo_app). `PgComplianceMetricsStore.read(ctx, fn)` falls back to the single-tenant `ofbo_app` read when no ctx is supplied, so non-migrated callers (executive dashboard) are unchanged. Trace id threaded through the service + analytics-export `getViewData` path.

Internal read-path refactor — compliance-view response shape unchanged, no spec change. typecheck/lint, unit 908, integration 7/7 (compliance int asserts the cross-tenant read + exactly 4 cross_fintech_query bypass logs). Reviewers: hard-stop PASS, conformance CONFORMANT. Code-only PR (docs here on main to avoid the build-log merge-race).

BACKOFFICE-33 stays in-progress — PRs 3-5: route the other analytics views (executive/finance/risk/operations) through the governed path, demo-seed the purposes, four-eyes on new-purpose registration.

---

## 2026-06-22 — BACKOFFICE-33 PR 3/5 merged: seed the BD-13 query purposes (#229)

`seedDemoDataset` now seeds the 6 BD-13 cross-fintech query purposes into query_purpose_registry (pre-approved, idempotent) + a BCBS 239 lineage row. Fixes a latent regression from PR 2: the governed Compliance read rejects unregistered purposes, but the demo seed didn't seed them — so a freshly-seeded DB (incl. the auto-deployed hosted demo, whose deploy runs db:seed:demo → seedDemoScenario → seedDemoDataset) would 've failed /compliance with UNREGISTERED_QUERY_PURPOSE. seed.int asserts 6 purposes approved + lineage. unit 913, seed.int 5/5, Q4.5 PASSED. Reviewers: hard-stop PASS, conformance CONFORMANT.

BACKOFFICE-33 remaining: PR 4 (route executive/finance/risk/operations through the governed path — note executive/finance pull from shared stores, higher blast radius) + PR 5 (four-eyes on new-purpose registration).

---

## 2026-06-22 — UX: OFBO brand mark + demo-framed persona switch + remove density toggle — PR #230

User-directed (live feedback).

- **Brand logo**: replaced the "OF" text monogram with OfboMark — a layered "ledger" glyph (white open-ledger card + ledger lines + a navy record card stacked behind for depth). Token-driven fills only (fill-white/fill-nav/fill-nav-active) → design-conformance clean; aria-hidden decorative (paired with the wordmark). Shown in the sidebar tile + the sign-in brand.
- **Persona switch — demo-framed + engaging**: on /profile, a demo-tinted "Demo · explore the other roles" card explains role-switching is a demo convenience (production signs in once via the bank IdP, no role-swapping) with a "Switch to another role" action; the sidebar button now reads "Switch role · demo". Same /api/logout flow + testids (switch-persona / profile-switch-persona) — behaviour unchanged.
- **Removed the comfortable/compact density toggle**: it only tightened content/table padding (marginal in a demo) + cluttered the top bar we'd just decluttered. Dropped the toggle, compact state, data-density attr, and [data-density] CSS; row-height tokens kept (explained the value to the user; one-liner to restore).
- Token-only, no PII. TDD: app-shell.spec (toggle gone, collapse intact), profile-view.spec (demo-framed switch + logout). Gates: lint, typecheck (all), design-conformance clean, a11y green, full unit 915, build OK, all CI green (E2E included via --watch). Reviewer: hard-stop PASS. Merged #230 (fd7d8e8a).

Process note: kept watching ALL checks via `gh pr checks --watch` (after the #225 race where a UI testid change broke the E2E and merged before it registered). Grepped the E2E suite for changed testids/text before pushing — switch-persona testid preserved, so E2E unaffected.

---

## 2026-06-22 — BACKOFFICE-33 PR 4/5 merged: Risk View reads via the governed path (#232)

The Risk View's two cross-fintech aggregate reads (summary, liabilityMonitor) now run through `runGovernedAggregate` (purpose `risk_monitoring`): bank_internal_view, purpose-gated, each bypass High-class logged (cross_fintech_query). `PgRiskMetricsStore.readGoverned(ctx, fn)` falls back to single-tenant ofbo_app when no ctx — the liability service + scheduled liability-monitor cron stay single-tenant; the operational risk-signals methods (recentActive/listSignals/getSignal/updateSignalStatus) are unchanged. Trace threaded through service + getViewData.

Internal read-path refactor — risk-view response shape unchanged, no spec change. unit 913, risk-view int asserts the governed reads + 2 cross_fintech_query bypass logs. Reviewers: hard-stop PASS, conformance CONFORMANT.

BACKOFFICE-33 remaining: route operations + executive/finance (executive/finance pull from shared stores — higher blast radius; may warrant their own design pass), and PR 5 (four-eyes on registering a NEW query purpose via the approvals primitive).

## 2026-06-22 — fix: DEMO non-prod pill → bottom-right corner — PR #233

Follow-up to #223/#230: the fixed top-center DEMO pill overlapped the top bar (hamburger + persona chip), worst on narrow/mobile widths. Moved to a bottom-right corner badge + pointer-events-none (can't intercept a tap). Still rendered once in the root layout (every screen), role=note with the full synthetic-data statement in aria-label; visible label trimmed to "DEMO · non-prod". Hard-stop unchanged (present + announced everywhere). Token-only; gates green, all CI green. Merged #233 (b95f2007).

---

## 2026-06-23 — BACKOFFICE-33 COMPLETE: four-eyes purpose registration (#237) + Executive Dashboard governed (#242)

Closes BACKOFFICE-33 (governed cross-fintech aggregation via `bank_internal_view` + `query_purpose_registry`, ADR 0015 / BD-13).

**PR 5/5 — four-eyes new-purpose registration (#237, merged f95ec32).** `POST /back-office/governance/query-purposes` registers a NEW cross-fintech query purpose. Four-eyes-gated: 202 + approval_request, becomes active (`approved_by` set) only on a DIFFERENT principal's approval, never inline. New scope `compliance:query-purposes:write` on compliance-officer (user-approved scope-matrix change, #236 spec). `GatedOperation.execute` now receives the approving principal (optional ctx) so the registrar records `approved_by`; `registerQueryPurpose()` (packages/db) inserts with lineage + rejects duplicates; in-memory registrar for demo, `PgQueryPurposeRegistrar` for the worker. Approval summary echoes only the format-validated `purpose_code`, never the free-text description. Reviewers: hard-stop PASS, conformance CONFORMANT.

**Executive Dashboard governed routing (#242).** The dashboard's platform-wide consent volumes — the one genuine cross-fintech aggregate — now read through `runGovernedAggregate` under purpose `executive_dashboard` (bank_internal_view, RLS bypassed, bypass High-class logged). `GovernedReadContext` gained an optional `purposeCode` so a SHARED aggregate reads under the caller's approved purpose (compliance store keeps `compliance_reporting` default; risk store hard-pinned to `risk_monitoring` so a caller can't relabel its provenance). Fixed a pre-existing serve.ts gap (audit sink not passed to the compliance/risk stores → local dev silently fell back to single-tenant). Response shape unchanged, no spec change. unit 938, integration 118 (exec int asserts the bypass logs under executive_dashboard), Q4.5 PASSED. Reviewers: hard-stop PASS, conformance CONFORMANT.

**Scope decision (user-directed, "you decide" / "mark completed").** The high-value cross-fintech set is done: **Compliance + Risk + Executive**. Two views are intentionally left off the governed path:
- **Operations Console — NOT routed (by design).** Its data (Nebras connectivity, scheme certificate chain, SLOs, outages) is platform-**singleton**, not tenant-partitioned — there is nothing cross-fintech to aggregate, so the RLS-bypass path would be ceremony.
- **Finance View accrual/margin — deferred.** A real partial roll-up, but the rest of finance is naturally per-counterparty; pursue only when a bank needs the cross-fintech finance aggregate.

Milestone state: the backlog is now drained — every item is `done` or correctly `blocked` for bank adoption (BACKOFFICE-52 gateway mTLS, M6 enterprise port-swaps). BACKOFFICE-33 marked `done`.

---

## 2026-06-24 — HARNESS-01..03: build-harness hardening (anti-reward-hacking, contract self-correction, agent provenance) — ADR 0019

Researched 2025-26 agentic-coding practice (Anthropic Claude Code guidance, Spec Kit/Specmatic, SWE-bench-style verification, the reward-hacking literature, EU AI Act traceability) against the existing harness and implemented the three gaps the user selected. Not product features — the loop's own machinery. ADR 0019 ACCEPTED.

**HARNESS-01 — anti-reward-hacking (test integrity).** Closes the loop's one cheat path: making a RED test green by weakening it instead of fixing the code. Two layers: `.claude/hooks/test-tripwire.sh` (PreToolUse advisory — denies `it.skip/.only/.todo/.fails`, `xit`, commented-out `expect`/`assert` on feature/claude branches; narrow, never blocks adding cases) and `scripts/test-integrity.mjs` + CI gate **Q1b** (deterministic, merge-blocking control of record — diffs the PR vs merge base, fails on added disabler markers or net assertion loss alongside an implementation change). Both exempt `*-testfix-*`/`*-spec-*`. Validated end-to-end (disabler + assertion-loss scenarios both fail correctly).

**HARNESS-02 — contract self-correction (`pnpm verify:contract`).** Specmatic self-correcting-loop pattern: `services/bff/scripts/verify-contract.ts` validates live BFF responses against `specs/backoffice-openapi.yaml` (reusing `buildResponseValidator`), auto-probing every implemented parameter-less GET + the 400/401 error envelopes. CONFORMANT/DRIFT, exit 0/1/2. Run locally: **28 conformant, 0 drift**. Wired into `run-ofbo/smoke.sh` as its final check + documented in the run-ofbo skill. The loop now catches live drift before PR, not at review.

**HARNESS-03 — agent provenance.** Recovers `{commit, model, session, story}` deterministically from the `Co-Authored-By`/`Claude-Session`/`Build-Model` git trailers the loop already stamps, and folds it into the **same** sha256-sealed release evidence bundle as the quality gates — tamper-evident agent attribution (EU AI Act Art. 12/17). `parseProvenance` unit-tested (human co-authors NOT attributed as build agents; explicit Build-Model wins; story id from subject). New control-mapping row; `collect-provenance.ts` + release-evidence.yml wired (fetch-depth: 0, prev-tag..commit range).

**Follow-up parked:** HARNESS-04 (StrykerJS mutation testing on rbac/approvals) — catches hollow-green tests Q1b's assertion-count can't; deferred until a real CI run calibrates the score threshold + runtime so it isn't a flaky gate. Backlog HARNESS-04 (pending).

Evidence: full unit suite **968 passing** (148 files), repo typecheck clean, eslint clean on changed files, release-evidence 21 tests (incl. provenance sealing + parser). Reviewers: pending PR (hard-stop + conformance run on the diff). Commits e5f9d8e, dd5f0d4, 608ee81 + docs.

---

## 2026-06-24 — HARNESS-05: documentation-drift gate (Q2b) — ADR 0020

Follow-up to the HARNESS-01..03 set (ADR 0019, PR #250), raised when the user asked whether the harness could keep docs from drifting from the code. Prose docs (CLAUDE.md, PRD, ADRs, governance, the run-ofbo skill, control-mappings) duplicate facts that live in code and rot silently when files move — and the harness had no guard for it.

`scripts/doc-link-check.mjs` + CI gate **Q2b** (`pnpm docs:check`) — the deterministic doc analogue of Q1's generated-artifact diff-check. Two checks: (1) every repo-relative file path cited in a current-state doc must exist; (2) no two ADRs share a number. Anchored to unambiguous repo-root dirs with a trailing extension boundary so prose slashes and cwd-relative command examples don't false-positive; **excludes docs/build-log.md** (historical journal — would punish accurate history). Validated: dry-run surfaced + fixed two checker bugs (ext-boundary `settings.js`, `**`-glob not expanding in git ls-files), then clean on main (35 docs, 18 ADRs); negative test confirms it catches a broken ref and a duplicate ADR number.

The duplicate-ADR-number check directly closes the hole that bit PR #250: while it was open, `main` took ADR 0018 (agent-identity DCR, #252) and #250 also numbered its ADR 0018 — a collision git can't see (different filenames). #250's ADR was renumbered to 0019; this gate would have caught it mechanically. Also: `implement-story` DoD gains a line requiring cited docs to be updated when a file moves.

Reviewers: pending PR. node --check clean; docs:check green on this branch.

---

## 2026-06-24 — HARNESS-04: mutation testing of the security-critical BFF core — ADR 0021

Realises the HARNESS-04 follow-up parked in ADR 0019. Q1b proves tests aren't *weakened*; this proves they aren't *hollow* — a surviving mutant is a behaviour change no test caught.

StrykerJS (`@stryker-mutator/vitest-runner`) scoped to the security core — `rbac.ts` (scope enforcement), `auth.ts` (persona→scope minting), `approvals/service.ts` + `approvals/operation-summary.ts` (four-eyes) — driven by a DB-free `vitest.mutation.config.ts` (BFF unit specs only; the integration project needs live Postgres and must never be in the mutation loop). `coverageAnalysis: perTest`.

**Calibrated against a real run, not guessed** (the reason it was parked): first full run measured **70.3% mutation score** (rbac 78.9 / auth 69.9 / approvals 68.8) over ~390 mutants in **8m34s** at concurrency 2. Two decisions fell out of that measurement: (1) **not a universal per-PR gate** — 8.5 min would tax every PR, so `.github/workflows/mutation.yml` runs weekly + `workflow_dispatch` + on PRs that touch the security-core paths; (2) **`break=65`, below the 70.3 baseline** — a real regression fails CI without flaking on the score's noise floor; the floor is meant to ratchet upward. HTML/JSON report uploaded as a 14-day CI artifact.

Honest baseline, not a vanity number. The 101 survivors are the hardening backlog — `StringLiteral` (audit/error text), `Regex` (code-format validation), and the highest-value `ConditionalExpression` flips in the four-eyes guards. Killing those + raising `break` is the intended ongoing ratchet.

Adds two devDeps (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`); `test:mutation` script; `.stryker-tmp/` + `reports/mutation/` gitignored. Reviewers: pending PR. ADR 0021; backlog HARNESS-04 → done.

---

## 2026-07-26 — REPO HEALTH: main red since 22 Jul — duplicate ADR number (Q2b) + high advisories in shipped deps (Q4)

Not a story. `main` had been failing CI since the 22 Jul merge burst (`e276091`); both failures were merge-blocking, so nothing could land on top of them. Two independent gates, two independent causes.

**Q2b — documentation integrity: duplicate ADR 0027.** PRs **#294** (multi-tenant tenancy model) and **#295** (Ozone-as-channel + SI-delivery) were open concurrently and each numbered its ADR 0027 — a collision git cannot see, because the filenames differ. #295 merged first (07:54:51), #294 46s later (07:55:37), so #294's record is the one that took an occupied number: `0027-multi-tenant-tenancy-model.md` → **`0028-multi-tenant-tenancy-model.md`**, with a `Numbering:` line in the header recording why. This is the exact collision class ADR 0020's duplicate-number check was written for, and the second time it has fired (ADR 0018 → 0019 while PR #250 was open) — the gate worked, it just fired post-merge because both PRs were green when they were each last built.

Reference split verified before and after: the three prose "ADR 0027" citations in `docs/proposals/ozone-*` all point at the **Ozone** record and are untouched; all 15 code/spec citations (`packages/db` tenant-tx, governed-aggregate, seed-tenants, migration `0030_tenant_group.sql`, `services/bff/src/worker.ts`, the portal tenant scaffold) point at the **tenancy** record and moved to 0028. Migration comment edits are inert — there is no migration checksum mechanism. Also corrected `architecture-overview.md`'s stale migration range (0001 → 0027) to 0030, drift the path-existence check cannot catch.

**Q4 — dependency scan: 5 HIGH advisories in production deps.** `next` was one minor behind the DoS fix; `sharp`, `postcss` and `fast-uri` were each pinned *by a parent* below their patched version, so `pnpm update` alone could not lift them.

- `next` 15.5.19 → **15.5.22** (GHSA App-Router Server Actions DoS, patched 15.5.21). The declared range hardened `^15.1.6` → `^15.5.22` so a lockfile rebuild cannot resolve back below the floor.
- New **`pnpm.overrides`** floors for the three parent-pinned transitives: `sharp` ^0.35.0 (libvips CVE-2026-33327/33328/35590/35591; next pins `^0.34.3`), `postcss` ^8.5.18 (two sourceMappingURL path-traversal/disclosure advisories; next pins an exact 8.4.31), `fast-uri` ^3.1.4 (host confusion via literal backslash authority delimiter; reached through `ajv` under `@modelcontextprotocol/sdk` in `services/mcp-gateway`). Resolved: sharp 0.35.3, postcss 8.5.23, fast-uri 3.1.4. An `overridesNote` next to the block states the rule — overrides are for parent-pinned deps only, a direct dependency is bumped in its own manifest, and an entry is dropped once the parent ships the fix.

`pnpm audit --prod --audit-level=high` now exits 0 (1 low / 4 moderate remain, below the gate's threshold and unchanged in kind).

**Evidence.** doc-link-check 58 docs / 28 ADRs clean · audit exit 0 · lint clean · typecheck clean across all 7 projects · full build incl. the Next portal (the real test of the sharp/postcss bumps — both sit in its build pipeline) · unit **1209 passing** (182 files) · integration **136 passing** (68 files, real Postgres 16) · Q4.5 lineage PASSED, no gaps · discovery waist gate OK · gen-drift none · Q1b clean. **Not verified locally: Q4's semgrep secrets scan** — `semgrep.dev` is blocked by this environment's egress policy, so the ruleset cannot be fetched. It runs in CI, and note it has *not* run on current `main` either: it is sequenced after the dependency scan in the same job and was skipped when that step failed. This diff introduces no secrets (manifest, lockfile, ADR rename, comment text).

---

## 2026-07-26 — HARNESS-07: un-shadow independent CI checks — a skipped security scan must not look like a passing one

Second follow-up to the red-main fix. Found while confirming what had actually run on `main`: Q4's semgrep **secrets scan had not executed at all** between 22 and 26 Jul. Not because it was broken — because it never got the chance.

**The defect.** Steps in a job are sequential under `bash -e`, so a failing step skips every step after it. Q4 runs `pnpm audit` then the secrets scan; while the audit was red, the secrets scan was skipped on every single run. The checks tab showed one red Q4 — indistinguishable from "the dependency scan is red and the secrets scan is fine". A security control that is *absent* looked exactly like one that *passed*, for four days, and nothing in the system said otherwise. Q2 has the identical shape: a lint error skips both `typecheck` and the semgrep **SAST**.

The two scans are independent — a vulnerable transitive dependency tells you nothing about whether a credential was committed. Sequencing them was an artefact of sharing a runner, not a real dependency.

**The fix.** Independent checks carry `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`, so an earlier *check* failing no longer suppresses them (the job still goes red — nothing is being downgraded). Applied to Q4's secrets scan, Q2's typecheck + SAST, and the Discovery job's run-validation + waist gate.

Two deliberate choices:

- **Gated on setup, not a bare `!cancelled()`.** If `pnpm install` itself fails there is no `node_modules`, and running the scans anyway would produce a screenful of noise failures that obscure the one real cause. `steps.install.outcome == 'success'` draws the line where it belongs: a failed *check* must not suppress its peers; a failed *prerequisite* legitimately does. The Discovery job is dependency-free, so plain `!cancelled()` is correct there.
- **In-job guards, not new jobs.** Splitting Q4 into two jobs gives each its own check-run, which is nicer to read — but it retires the name `Q4 — security review + dependency scan`, and any branch-protection rule pinned to that name would then wait forever on a check that never reports. The guard achieves the substance (neither scan can be silently skipped) with no rename. Splitting is still available later if the required-check names are updated in the same change.

**Honest limit on the evidence.** The guard only *changes* behaviour on a run where something fails, so a green CI run cannot demonstrate it. Verified statically instead: the workflow parses, and the conditions attach to exactly the five intended steps and nothing else (the pre-existing `if: always()` on the Playwright artifact upload is untouched). Proving it live would mean deliberately failing a step in a throwaway PR — worth doing on request, not worth the noise unprompted.

---

## 2026-07-26 — HARNESS-06: ADR number reservation — the cross-PR half of the numbering gate (Q2c)

Follow-up to the red-main fix earlier today. That PR renumbered the colliding ADR; this one stops the collision being *creatable*.

**The hole.** HARNESS-05's duplicate-number check (ADR 0020, Q2b) is **intra-tree** — it fails when the checked-out tree holds two ADRs sharing a `NNNN` prefix. A collision, though, is made by two branches that are each individually clean: #294 adds `0027-multi-tenant-tenancy-model.md`, #295 adds `0027-ozone-channel-si-distribution.md`, both trees hold exactly one 0027, both go green, both merge, and `main` is red after the fact. The number is contended *across* branches, so the check has to look across branches too. This is the second occurrence of the shape (ADR 0018 while PR #250 was open), which is what makes it structural rather than bad luck — concurrent build loops each pick "the next free number" against a snapshot that is already stale.

**`scripts/adr-number-check.mjs` + CI gate Q2c.** Two checks, increasing reach:

1. **BASE** (offline, no token) — a number this branch *adds* must not already exist on the base ref. Catches the stale-branch case: `main` took your number while your PR sat open. This alone would have failed #294 on any rebuild after #295 merged, which is the cheap 90% of the fix.
2. **PEER** (GitHub API) — that number must also not be claimed by an **open** PR opened *earlier*. Catches the collision while both are still in flight, the only point at which renumbering is nearly free.

Tie-break is **first-opened-keeps-it** (lower PR number holds the claim), so exactly **one** side of a collision fails — deterministic, and it matches how both real collisions were actually resolved. Both-fail would have been a worse design: two red PRs racing to renumber.

**Failure posture, chosen deliberately.** A real collision is a hard, merge-blocking fail. An API that is unreachable, rate-limited or unauthorized is a **soft skip** with a printed reason — a merge gate that flakes on GitHub availability trains people to ignore it, and check (1) still runs offline regardless. `GITHUB_TOKEN` is read-only here (list open PRs + their changed files).

**Own job, not a Q2b step.** Deliberate, and the same reasoning as HARNESS-07: a step appended to Q2b would be silently skipped whenever `doc-link-check` failed first — a gate you cannot trust to be red when it matters is not a gate. `fetch-depth: 0` on that job's checkout, since the base diff needs real history.

**Evidence.** 11 unit tests (`scripts/test/adr-number-check.test.mjs`, `node --test`). Seven cover the pure collision rule — the real 2026-07-22 case, the free-number pass, the same-file-both-sides non-collision (a rename must not self-trip), and multi-holder reporting. Four cover the **peer plumbing** against an injected fake GitHub: URL construction, the earlier-PR filter (a newer PR's files are never even fetched), removed-file and wrong-directory exclusions, and error propagation. That second group was added after the gate's first CI run reported `no ADR added — peer check SKIPPED`: correct behaviour for a PR that amends an ADR rather than adding one, but it meant the API path would have shipped never having executed. Since that path **soft-skips** on error, a bug in it degrades to "never catches anything" rather than anything visible — precisely the failure mode HARNESS-07 is about, so it should not be the one path taken on trust. Negative test against the live repo: adding a `0027-*.md` while `main` still holds two 0027s fails with both holders named and exit 1; removing it returns exit 0. The harness-test step now also globs `scripts/test/*.test.mjs`, so these run in CI alongside the discovery gate tests. ADR 0020 amended in place (decision unchanged, reach extended); backlog HARNESS-06 → done.

---

## 2026-07-26 — HARNESS-08: ESLint ignores nested worktree checkouts

Found during the post-merge smoke test of the #296/#297/#298 stack: `pnpm lint` from the repo root reported **32 errors, every one of them inside `.claude/worktrees/`** — the isolated checkout CLAUDE.md rule 0 requires build work to happen in.

**Why it happens.** A worktree under `.claude/worktrees/` is a full second checkout nested inside the first. `.gitignore` covers it (added in `89104f8`), but **ESLint flat config does not read `.gitignore`** — `ignores` is its own list. So a root lint walks into every parallel branch's checkout and reports that branch's findings against paths in the current tree.

**Why it mattered more than cosmetics.** The loudest phantom was the `no-restricted-syntax` rule on `DEPLOY_PROFILE` — the guard that makes profile-branching outside `packages/ports` a lint error precisely because PRD §3.1 makes it a review FAIL. Seeing it fire against a file that is not in your tree is the wrong kind of alarm in a repo where that rule is load-bearing: it trains you to dismiss the one error you must never dismiss.

**Why nobody noticed.** CI checks out fresh and has no `.claude/worktrees/`, so Q2 was green on every PR while local lint was noisy. The gate and the developer's terminal disagreed, and only the terminal was wrong — the failure mode a build loop is least likely to report, because the loop reads CI.

**Fix.** `'.claude/worktrees/**'` added to the `ignores` list in `eslint.config.mjs`, alongside the existing `.remember/**` scratch-dir precedent. Each worktree still lints itself — the isolation is what makes that correct.

**Evidence.** Reproduced first, not assumed: a probe checkout at `.claude/worktrees/probe-checkout/` containing a `DEPLOY_PROFILE` read made a root lint fail with exactly the misleading §3.1 error. After the fix, the same probe still on disk, lint exits 0. Negative control run alongside it — a deliberate `no-explicit-any` in `packages/db/src` — still fails, confirming the ignore did not over-broaden and silence real code. Probe removed after verification.

## 2026-08-06 — HARNESS-09: the coverage gate becomes a gate

**The gap.** `vitest.config.ts` has carried 80% thresholds (statements/branches/functions/lines, scoped to `services/bff/src`) since the substrate landed — and no CI job ever ran them. Q1 executed bare `pnpm test`; `grep -rn coverage .github/workflows/` returned nothing. CLAUDE.md's "coverage ≥80%" was a local convention wearing a gate's clothes: the same absent-control-looks-like-a-passing-one class as HARNESS-07, found by the 2026-08 improvement-plan audit (`docs/reviews/improvement-plan-2026-08.md` §2.1, priority 1 of 7).

**The fix.** Q1's unit step is now `pnpm test:coverage` — one line, because the machinery already existed end to end; only the invocation was missing. Verified before flipping: 1209/1209 unit tests green with coverage at **95.5% statements / 81.7% branches / 97.5% functions / 95.5% lines**, comfortably above the floor, so the gate went live with no ratchet, no threshold edits, no test changes.

**Self-guarding.** `scripts/test/coverage-gate-check.test.mjs` (picked up by the discovery-gates job's `scripts/test/*.test.mjs` glob) asserts both halves of the control: the Q1 job text invokes `test:coverage` (and does NOT run the unit suite bare), and the config's four thresholds remain ≥80. A quiet workflow revert or threshold lowering now reds CI instead of silently reopening the gap — the lesson HARNESS-06/07 keep teaching: a control that isn't asserted somewhere CI runs is one edit away from being a story we tell ourselves.

## 2026-08-06 — HARNESS-11: the Q4.5 lineage gate learns its own scope

**The gap.** `validateLineageCoverage` walked a **hardcoded 17-table literal** (`packages/db/src/lineage.ts`). The `ofbo_app` role can INSERT into **26** tables. Every table added since that literal was written — `str_draft`, `service_desk_case`, `trust_framework_participant`, `respondent_dispute`, `fraud_incident`, `scheme_notification` — was outside the BCBS 239 gate entirely, and the gate printed `Q4.5 PASSED` the whole time. Not a wrong answer: an answer to a smaller question than the one we thought we were asking. Found by the 2026-08 improvement-plan audit (§2.3).

**The fix.** The surface is now **derived** from `information_schema.role_table_grants` — the identical pattern `registry-coverage.int.spec.ts` already uses to enrol tables in retention/classification, so the repo now derives its regulated surface the same way twice instead of hand-maintaining it once. A migration that adds a regulated table is covered by Q4.5 the moment its store can write to it, with no list to remember.

**Exclusions are typed differently from gaps — deliberately.** `KNOWN_LINEAGE_GAPS` means "a real gap, mapped to the story that closes it" and stays **empty**. The three tables that legitimately carry no lineage go in a new `NON_REGULATED_TABLES` with a standing reason each: `lineage_events` (the sink itself — lineage about lineage is not a figure), `idempotency_key` (the schema's sole deletion path, already retention-exempt), `readiness_profile` (ADR 0022's public wizard — system metadata, explicitly non-regulated and PII-free, as its store has always documented). Collapsing those two ideas into one allowlist would have quietly converted "permanently out of scope" into "we owe a story", and vice versa.

**Measured, not asserted.** One CI-equivalent run against a fresh Postgres (`db:apply` → `db:seed` → `test:integration` → gate): **covered 9 → 23 tables, allowed gaps none, unexpected none, Q4.5 PASSED.** The widening cost nothing because the write paths were already emitting lineage — the gate simply had not been looking at them.

**Proving the wider gate can still fail.** A widened gate that can no longer go red would be the same bug in a better costume. The new anti-vacuous-pass test grants `ofbo_app` INSERT on a synthetic table, writes one row, and asserts the derivation picks it up, `validateLineageCoverage` reports it as a gap, and `evaluateLineageGate(...).ok` is `false` — then drops it. Plus set-equality against the live privilege catalogue, a justified-reason check per exclusion, and a strict-superset assertion against the retired literal so no previously-checked table can be silently dropped.

## 2026-08-06 — DOCS-01: the ground-truth docs stop lying, and one of them starts parsing

**What was wrong.** The README sized the project for a reader with two numbers, both stale: the spec had **89 paths / 12 tags**, not "76 paths, 10 tags"; the backlog was **140 of 150** done, not "127 of the 135". `CLAUDE.md` listed ports **P1–P9** while `packages/ports/src/interfaces.ts` has carried a tenth (`p10-str-workflow`, ADR 0022) since BACKOFFICE-63, and described an adapter layout — `adapters/<port>/sim/`, `adapters/<port>/enterprise/` — that has never existed on disk. `docs/architecture-overview.md` still labelled the enterprise adapters "M6 stub" though all ten are ADR-0024 rung ③ and fail-closed. None of this was visible to Q2b, which checks that references *resolve*, not that claims are *true*.

**The backlog did not parse.** `docs/backlog.yaml` is described in the README as the "machine-readable work queue (drives the autonomous build loop)". It has not been loadable YAML: one acceptance line in BACKOFFICE-59 begins `- Training actions NEVER write to the production audit (audit_high_sensitivity): the …`, and an unquoted `: ` inside a plain sequence item makes YAML read the whole thing as a mapping key. Pre-existing, not introduced here — every tool that touches the file works by regex, so nothing ever complained. Fixed by quoting the scalar, text unchanged. **The file now parses**, and the counts above are derived from it rather than from a grep that also matched a `BACKOFFICE-NN` placeholder inside a comment.

**Six items had no status at all.** The entire COMMERCIAL milestone (`VAL-01`, `HOST-01/02/03`, `INS-01/02`) carried no `status:` field while HOST scaffold code was merged. Each now carries a status *and the evidence for it*: **HOST-02 → done** (migration `0030_tenant_group.sql` plus four tests in `tenant-isolation.int.spec.ts` covering all four of its acceptance criteria); **HOST-01 → in-progress**, because `seed-tenants.ts` says in its own header that it "deliberately does NOT re-parameterise the rich single-tenant seed (that is HOST-01 proper)" and the PRD §10 per-tenant config criterion is unmet (`approvals/service.ts` still takes `expiryBusinessHours ?? 2`); **VAL-01 → pending** (no liability-schedule constants exist anywhere); **HOST-03/INS-01/INS-02 → blocked**, all three being ADR- or spec-first decisions that CLAUDE.md rule 6 reserves for a human. The waist gate only matches `BACKOFFICE-\d+`, so none of these trip HG-0007.

**ADR 0028 is flagged, not resolved.** Its tenancy scaffold is merged on `main` while the record is still **Proposed** — rule 6 says raise an ADR *and stop*, which did not happen. The honest move is not to quietly stamp it Accepted to make the tree consistent: a header warning now states that implementation landed ahead of acceptance and that a human must Accept, amend, or reject, noting that rejection means unwinding merged code. The status is left untouched.

**Made durable.** Correcting numbers once just resets the clock. `scripts/doc-link-check.mjs` (Q2b) gains a third check: derive the spec's path/tag counts and the backlog's done-count from the artefacts and compare them to the README's prose. Verified by reintroducing the exact original drift — the gate names both errors and exits 1, then passes again once restored. Two stale point-in-time reviews (`ui-ux-review.md`, `design-conformance-audit.md`) got dated "superseded in part" banners rather than edits, since rewriting a review to match today destroys the record of what it found — the UX one now says outright that its DEMO-banner description (`sticky`, `role="alert"`) no longer matches the component (a bottom-right pill, `role="note"`).

## 2026-08-06 — HARNESS-10: the port-swap acceptance gate becomes executable

**The gap.** CLAUDE.md states the M6 rule plainly: "an enterprise adapter must pass exactly the tests the simulator passes (that is the port-swap acceptance gate, M6)". The gate did not exist. `describePortContract` was literally typed `profile: 'demo'`, was only ever invoked as `describePortContract('demo')`, and closed with a comment inviting a future reader to "re-enable per port by calling `describePortContract('enterprise')`" — which would not have worked: the enterprise adapters need configuration and a transport, and three of the assertions are demo-profile facts. All ten enterprise adapters existed and were fail-closed, but were proved only by their own specs. The acceptance criterion M6 depends on was carried by prose.

**What it is now.** `describePortContract(profile, get)` takes an adapter **resolver**, so one set of assertions drives both profiles. `test/fixtures/enterprise-harness.ts` constructs all ten enterprise adapters from Bank-Profile-shaped config with a routed fake vendor transport. The canned vendor payloads are lifted from each adapter's own spec, so the bench cannot drift into asserting a shape the adapter does not actually parse. **44 passing / 1 skipped**, with 16 contract assertions now binding the enterprise adapters through their real request-build → transport → response-parse → map path.

**The boundary is stated, not blurred.** This is ADR 0024 rung ②: no live tenant. Auth, residency, rate limits and real payload drift remain the rung-④ M6 mile, and the fixture says so in its header. A bench that quietly implied more than it tests would be the same failure class this work exists to close.

**The demo-only expectation is skipped, then replaced.** One assertion — P2 exposing nine seeded personas with demo tokens — is a fact about the demo profile, not about the port. A real Entra tenant does not expose them, and faking it would be a fake gate. It is skipped under enterprise **and** replaced by an explicit enterprise-side assertion: personas derive from the configured Bank-Profile mapping, and `demo_token` is empty for every one. The difference between the profiles is now auditable rather than implied.

**Two guards on the gate itself.** First, the bench must cover every entry in `PORT_NAMES` — add a P11 without a bench entry and this fails, so a new port cannot silently escape the gate. Second, the anti-vacuous-pass check: injecting a 6000 ms revoke acknowledgement (against the scheme's 5 s SLA) and a bogus `ipp_status` turns the enterprise run **red on exactly those two tests**, then green again when reverted. A gate that cannot fail is not a gate.

One incidental finding worth recording: writing the bench immediately caught a route-ordering bug in my own fake (`/invoice-runs` shadowing `/invoice-runs/{ref}/status`). That is the bench doing its job on day one — the mapping paths are genuinely being executed, not stubbed past.

## 2026-08-06 — HARNESS-13: the mutation floor stops leaving five points of slack, and CI can be asked to run in full

**Ratchet.** `stryker.config.json` carried `break: 65` against a baseline recorded as 70.3%. That is five points of slack: the security core (rbac / auth / approvals / high-class audit / idempotency) could lose real coverage and the weekly gate would still be green. Re-measured over 493 mutants: **71.20%** (351 killed / 116 survived) on vitest 2, and **70.99%** (350 / 117) on vitest 3 after the HARNESS-12 bump — a **one-mutant** difference across a major test-runner version, which makes ~0.2pp the observed run-to-run noise floor. `break` is now **70**: roughly one point, about five mutants, of headroom. Enough to absorb the noise, not enough to hide decay. Confirmed by a full local run that the gate exits 0 at the new floor rather than assuming it.

**Dispatch.** The audit asked for one deliberate full-matrix run to close out the eleven stories that carry "Merged on local gates" from the July Actions billing outage. That could not be done: `ci.yml` had `push` and `pull_request` triggers and no `workflow_dispatch`. Added.

**The interesting part is the gate that cannot run.** Q1b (test-integrity) diffs a PR against its merge base; a manual dispatch has no merge base. Its `if:` was `github.event_name == 'pull_request'`, so on a dispatch the job would simply not appear — and a "full matrix" run missing a gate, with nothing to show for it, is precisely the bug HARNESS-07 was about. The job now **runs** on a dispatch and reports itself: a `::notice`, a step-summary block, and the words "This is not a pass." The check-run exists and tells the truth about what it did.

**Guarded.** `scripts/test/mutation-ratchet-check.test.mjs` (picked up by the discovery-gates harness glob) asserts the floor stays within 1.5pp of the measured baseline *and* never above it (a floor above the baseline would red a clean tree), that `workflow_dispatch` survives, and that Q1b both still executes on pull requests and still announces itself on a dispatch. Verified it bites: dropping `break` to 60 fails the test with the baseline quoted back — because lowering the floor to turn a red mutation run green is the one move ADR 0019 exists to prevent, and nothing else in CI would have noticed.

## 2026-08-06 — CODE-01: one keyset implementation, and the bug that made it worth doing carefully

**The premise was wrong in an interesting way.** The audit called this "~25 copies of security-and-correctness-sensitive code" to deduplicate. Reading all sixteen showed they were not copies of one thing. Three genuine divergences:

1. **Direction** — nine stores page ascending (`>`), seven descending (`<` with `ORDER BY … DESC`).
2. **Tie-break column** — `tpp_counterparty` keys on `organisation_id`, which is **TEXT**, and must *not* take the `::uuid` cast every other store applies. A helper that hardcoded the cast would have broken that store at runtime.
3. **Parameter indexing** — fifteen stores push the two binds first and reference `$${params.length - 1}` / `$${params.length}`. `consent-events.ts` builds its clause *before* pushing, over a variable-length prefix of event-type placeholders, and references `$${params.length + 1}` / `$${params.length + 2}`.

The third is the whole story. Both conventions are correct where they stand, and **neither survives being pasted into the other**. A mechanical dedup that picked one and applied it everywhere would emit SQL that still parses, still runs, and silently binds the wrong parameters — in a regulated read path, which is about the worst place for a bug that does not announce itself.

**So the helper exposes no convention.** `keysetClause(params, after, opts)` takes the array the caller will hand to `query()`, appends the two binds itself, and derives the placeholder numbers from the push it just made. Callers cannot get the arithmetic wrong because callers no longer do arithmetic. `keysetOrderBy` lives beside it so a store cannot page one way and sort the other — an error that returns rows in an order the cursor does not follow, skipping or repeating at page edges. Net **−141 lines** across 16 files; zero hand-rolled keyset arithmetic left in `packages/db`.

**The coverage was the actual risk.** Before this, exactly two integration specs so much as mentioned a cursor, and none walked a multi-page sequence. Sixteen hand-rolled implementations of a silent-failure read path, under a net that thin, is the finding — more than the duplication was. Added 15 unit tests (both parameter conventions, the text-key no-cast path, DESC applied to *both* key parts) and 4 live integration tests that page `consent-events` ascending over its variable-length prefix and `tpp_counterparty` over its TEXT key, asserting every row is served exactly once and that paging terminates.

**Proved the net catches what it is for.** Injecting an off-by-one into the shared parameter index — precisely the bug a naive dedup would have introduced — turns both paging tests red, and green again on revert. A refactor of a silent read path verified only by "the suite still passes" would have been faith, not evidence.

Verified: integration **140/140** on a pristine database (69 files), unit **1224/1224** (coverage 95.5%), `lint` + `typecheck` clean, Q4.5 lineage gate **PASSED**.

## 2026-08-06 — HARNESS-12: dependencies stop being watched by nobody

**The gap.** Twice now, `main` has gone red without a commit doing anything: 22–26 Jul (five HIGH advisories, the four-day outage recorded above) and again on 2026-08-04, when a docs-only PR failed Q4 because `fast-uri` and `ip-address` advisories had been published in the interim. Both times the code was fine and the world moved. There was no Renovate or Dependabot config — dependency currency was a thing someone noticed, which is not a control.

**Half one — clear the backlog.** GitHub reported **41 advisories on the default branch (1 critical, 17 high)**. Now **11 (3 low, 8 moderate) — zero high, zero critical.**

- **vitest 2.1.9 → 3.2.7** clears the critical (GHSA-5xrq-8626-4rwp — the UI server can read and execute arbitrary files). Stryker's vitest-runner declares `vitest: >=2.0.0`, so the mutation harness rides along unchanged. **3.2.7, not 4.x**: the minimum that closes the vulnerability, since 4 removes workspace files and changes more surface than a security fix should.
- **jsdom ^25 → ^30 in BOTH `package.json` and `apps/portal/package.json`.** The portal carried its own pin, which is why `ws` survived the first pass and still showed `apps/portal > jsdom@25.0.1 > ws@8.20.1` after the root bump. A workspace-wide claim about a dependency is worth exactly as much as the number of `package.json` files you actually checked.
- **Dev-tree override floors** for `brace-expansion`, `js-yaml`, `undici`, `vite`, `ws` — all advisories whose parent pins below the patch, so `pnpm update` cannot lift them. `brace-expansion` is **ranged per major** (`@1`/`@2`/`@5`) because minimatch 3, 9 and 10 put three mutually incompatible lines in one tree; a single floor would have forced one of them and broken the others.
- `overridesNote` now separates **production** floors (what Q4's `--prod` audit actually gates) from **dev-tree** floors (not gated — but these tools run in CI holding a token, so the risk is real, and pretending otherwise because the gate is silent would be the same self-deception HARNESS-07 was about).
- Aligned the `@hono/node-server` skew: `nebras-sim` `^1.13.7` → `^2.0.4`, matching the BFF.
- Since vitest 3.2 deprecates workspace files (removed in 4), projects moved from `vitest.workspace.ts` into `test.projects` in `vitest.config.ts` — which also retires the split that forced the coverage gate to live in a different file from the projects it gates.

**Half two — stop doing this by hand.** `renovate.json`: weekly window; security PRs immediate and exempt from the major-approval gate (an advisory is not a scheduled chore); majors and the gate-running toolchain (pnpm/node/typescript/stryker) behind `dependencyDashboardApproval`; `pnpm.overrides` explicitly unmanaged, because those are justified floors to be *removed by hand* once upstream ships a patched range, not churned.

**No automerge, anywhere — deliberately.** The obvious convenience is letting Renovate self-merge green patch bumps. HG-0001 makes non-self-merge a governance control, and a bot merging its own PR is precisely the hole that control exists to close. Renovate opens, CI judges, a human merges.

**Verified, not assumed** — jsdom 25→30 and vite 5→6 are large jumps under 70 portal component tests: unit **1209/1209** (coverage 95.6%), integration **136/136** on a fresh database, `lint`, `typecheck` and `pnpm build` all clean, `pnpm audit --prod --audit-level=high` exit 0. vitest 3→4 left as a future chore, now trackable on the dashboard.

## 2026-08-07 — HARNESS-14: the deploy gate was red for twelve days, and the reason it stayed red is the finding

**Found while verifying something else.** After merging the eight-PR improvement-plan stack I checked that `main` was actually green rather than asserting it. CI was. The **deploy** workflow was not — and had not been since **2026-07-26**. Four of its five jobs (BFF, DB migrate+seed, Nebras simulator, portal) succeeded every time; the fifth, `Smoke — demo URL live`, failed every time on one assertion.

**First question: did I break it?** No — and the way to know was cheap. The same failure, same test, same message, appears on the deploy for PR #300, which was **docs-only**, and on #297 twelve days earlier. A markdown file cannot change portal auth. That settled attribution before any diagnosis.

**Second question — the one that mattered: is the demo leaking the dashboard to unauthenticated visitors?** The assertion was `expect(status).toBeGreaterThanOrEqual(300)` on `GET /dashboard` with no session, and the observed status was **200**. On a regulated console that reads like an access-control hole, and it could not be left as "probably fine". Egress to the demo URL is blocked from the build container (403 at the proxy), so the demo could not be probed directly — instead the portal was built and served locally on plain `next start`:

- Status is **200 there too**, so this is *not* an OpenNext/Cloudflare adapter difference.
- The body contains **zero** shell — no `app-shell`, no `sidebar`, no audit panel, no KPIs.
- The only thing in it is `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/">`.

So `requireSession()` → `redirect('/')` is working exactly as written. Next expresses `redirect()` **two** ways depending on whether the response has begun streaming: a 3xx with a `Location` header, or — once the `<head>` has flushed on a `dynamic = 'force-dynamic'` page, which `/dashboard` is — a 200 carrying a meta-refresh. Both are the same redirect. The test pinned one form and called the other a failure. No leak.

**The real defect is what that cost.** The old test asserted nothing whatsoever about the response body. It checked the *transport* and not the *property*. Which means a genuine leak — a 200 that **does** carry the shell — would have produced the same red X as twelve days of correct behaviour, in a job everyone had already learned to scroll past. The control had no signal left in it. That is the HARNESS-07 class again: an absent control that looks like a present one. The variation is that this check was *visibly* red rather than silently skipped, and got ignored just as effectively — arguably more so, because a red X that never changes teaches you to stop reading it.

**Fixed by asserting the security property first and directly.** The response must not contain `data-testid="app-shell"` (nor `sidebar` / `persona-badge` / `audit-panel`), and *then* it must bounce to sign-in by **either** redirect form. This is strictly stronger than what it replaces — the old assertion made no body claim at all — which matters, because "the gate went green after I edited the test" is the shape of reward hacking and the difference has to be demonstrable, not asserted.

**Proved it discriminates.** A stub server serving the three response shapes, so the proof touches no production auth code (an earlier attempt to prove it by disabling `requireSession` and rebuilding was correctly refused, and was the wrong instrument anyway):

| Response shape | Expected | Result |
|---|---|---|
| 200 + meta-refresh, no shell (what the portal really does) | pass | **passes** |
| 200 **with** `app-shell` — the leak the gate exists to catch | fail | **fails on `app-shell`** |
| 307 to `/somewhere-else` — bounced, wrong target | fail | **fails on the bounce check** |

Then run green against a real locally-built portal on `next start`: 2/2.

**Left alone deliberately:** the `/dashboard` page still redirects post-flush rather than pre-flush. Making it emit a clean 3xx means moving the session check ahead of the streamed render, which is a portal-architecture change, not a test fix — and the security property holds either way. Worth an ADR if the 3xx form is ever wanted for its own sake.

## 2026-08-07 — HARNESS-15: rehearsing the first release found a gate that could not fail

The improvement plan's §2.4 asked for the first-ever release evidence bundle: `releases/` held only a README, `git tag` was empty, and `.github/workflows/release-evidence.yml` had never fired. Rather than cut `v0.1.0` and find out in public, the pipeline was dry-run locally against `main` — real postgres, all 30 migrations, seeded, `--out` pointed at a scratch dir so nothing tracked moved.

**The pipeline works.** `collect-provenance.ts` (HARNESS-03, never executed until now) ran clean on the first-release path — no prior tag, so no `--prev`, so the bounded-window branch nobody had exercised. 167 commits walked, 98 carrying a model trailer, 5 distinct build agents. The bundle assembled and sealed: 14 control mappings, 6 gates, 23 lineage-covered tables, sha256. Q1 1241/1241, Q3 144/144, `pnpm audit --audit-level=high` clean at 11 advisories with zero high or critical — HARNESS-12's fix holding.

**Then the interesting part.** `collect-gates.mjs` wrote Q4.5's status as a hardcoded `'pass'` — and wrote it *before* the proof existed, since the CLI collects live coverage from `DATABASE_URL` afterwards. `buildEvidenceBundle` copied `lineage_proof` through verbatim and checked only that all six gates were **present**, never that Q4.5 agreed with the evidence printed beneath it. Injecting three gaps produced this, in one sealed document:

| Gate | Status | …and thirty lines below |
| --- | --- | --- |
| Q4.5 BCBS 239 lineage validation | **pass** | `Gaps: audit_high_sensitivity, str_draft, fraud_incident` |

Today's real gap count is zero, so the first bundle would have been truthful. That is exactly what makes it worth fixing now: the guard was inert, so it would have gone on being truthful right up until a migration added an uncovered regulated table — the one event Q4.5 exists to detect. HARNESS-11 made the *gate* derive its own surface; the evidence bundle was still hardcoding the *verdict*. Third instance of the HARNESS-07 class in this plan, and the first one where the untrue statement would have been **sealed, committed, and handed to an auditor**.

The proof is the only thing that knows the answer, so the proof decides. `deriveLineageGateStatus()`: gaps → `fail`, covered-with-no-gaps → `pass`, empty-with-no-gaps → `skipped`. That last case is not pedantry — `cli.ts` records `{ covered: [], gaps: [] }` when `DATABASE_URL` is unset, and "no proof was collected" must not render as "the gate passed". Every other gate is passed through untouched; CI step outcomes are the only witness those have.

**A second, quieter finding.** `verifyEvidenceBundle` was exported, unit-tested, and called by nothing. The digest was computed at write time and never checked again — a tamper-evident seal with no one reading it. `scripts/verify-bundle.ts` is now the reader, and the workflow runs it *between* assembling and committing, so a bundle whose digest does not recompute never reaches git. Ordering is the load-bearing part, and it is asserted: a verification after the commit cannot stop a corrupt bundle. Being handed no bundles exits non-zero, because "verified nothing" must not look like "verified everything".

**Guards, and proof they bite.** The 4 derivation tests were red before the fix. Moving the verify step after the commit reds the ordering assertion. The verifier is driven through its real exit codes rather than as a function, so the CI step cannot decay into something that always exits 0. Re-running the whole pipeline afterwards: Q4.5 reads `pass | 23 regulated tables covered, no gaps`, the same gap injection reads `fail | lineage gaps (3): …`, and the verifier confirms the seal. Unit 1251/1251, `node --test scripts/test` 19/19, lint + typecheck clean.

**Deliberately not done:** cutting `v0.1.0`. Publishing a release fires the workflow and commits `releases/` to `main` — outward-facing and effectively irreversible, so it stays a human call. What this story bought is that when someone does cut it, the bundle's own claims are checked rather than asserted.

**Also observed, not acted on:** `committed_at` is inside the sealed content, so re-running for the same tag+commit yields a different digest — a bundle can be verified in place but never independently re-derived. And only 20 of 167 commits carry a story trailer, so the provenance table's Story column is mostly `—`; many of those are human merge commits, so it reads as trailer coverage rather than a pipeline defect. Both are worth a decision, neither is worth blocking a release.

**Postscript — Q4 went red on the PR, and not because of this story.** GHSA-2v37-7h3g-55p8 (`nanoid` <3.3.17, infinite loop on zero size) was published against a tree nothing in this branch touches: `apps/portal > next@15.5.22 > postcss@8.5.23 > nanoid@3.3.16`, with `git diff origin/main -- pnpm-lock.yaml package.json` empty. Same shape as the 22–26 Jul and 2026-08-04 episodes — an advisory lands, no commit changes, main goes red. Renovate (HARNESS-12) opens security PRs immediately but cannot fix a floor the parent pins, which is what `pnpm.overrides` is for. Added `nanoid: ^3.3.17` as a PRODUCTION floor (only the 3.x line is in the tree, so no per-major ranging needed, unlike brace-expansion). Lifted 3.3.16 → 3.3.18; `pnpm audit --prod --audit-level=high` back to exit 0 with 9 advisories and zero high. Portal build and 1251/1251 unit green after the bump. Worth noting the local/CI asymmetry that hid this during the dry-run: Q4 runs `--prod`, and a bare `pnpm audit` reports a different tree — the dry-run's "zero high" was true of the dev tree and not of the gated one.

## 2026-08-09 — CODE-02: the in-memory stores leave production source, and the measurement that nearly went the other way

The improvement plan's §4 asks for the 27 `InMemory*` stores to move out of production source: they sat interleaved with the service logic they back (`reconciliation/service.ts` carried three in its last 150 lines, on top of a 900-line service) and they counted against the Q1 coverage denominator, which HARNESS-09 scopes to `services/bff/src/**`.

**The measurement came first, and the obvious assumption was backwards.** The expectation was that pulling well-tested store code out of the denominator would *lower* coverage. It mattered which way: branches had only **1.71pp** of headroom (2502/3062 = 81.71% against an 80% floor), and the arithmetic on `(2502−C)/(3062−B)` said at most ~262 fully-covered branches could leave before the gate went red. So the stores' own coverage was computed before anything moved — per-class line spans crossed against the v8 report:

| | statements | branches | functions |
| --- | --- | --- | --- |
| the InMemory classes | 806/838 (96.2%) | **286/358 (79.9%)** | 117/121 |

They are the **worst branch-covered code in the BFF** — below both the 80% floor and the 81.71% file-wide average. Removing them *raises* branches. Predicted 81.95%; actual after the move **82.00%** (headroom 1.71pp → 2.00pp), statements 95.61 → 95.65, functions 97.48 → 97.90, gate exit 0.

**Not `testing/`, not `fixtures/`.** The plan offered both names; both would misdescribe the code. `app.ts` falls back to these stores whenever a durable store is not injected — which is whenever `DATABASE_URL` is absent, i.e. the demo profile in production. They ship and they serve real demo traffic. They live in `services/bff/memory/` with a README that says so, because in a regulated codebase a directory named for tests is a claim about what the code is for.

**Zero test churn, by design.** Imports in this repo are mixed — `import { ReconciliationService, InMemoryReconciliationBreakStore } from '../src/reconciliation/service.js'` — so relocating the classes would have meant splitting import statements across ~55 test files, which is exactly where a mechanical sweep goes wrong. Instead each store is re-exported from the module declaring its interface: the public surface is unchanged and every existing import still resolves. Q1b confirms it: *no test files changed*.

**No runtime cycle.** `memory/ → src/` imports are strictly type-only and erase at compile time; the only runtime edge is `src/ → memory/` at the construction sites. Five store-only *values* stood in the way (`encodeAgentCursor`, `decodeAgentCursor`, str's `encodeCursor`, `newSlug`, `QueryPurposeRegistrarError`) — each was checked across `src/`, `test/`, `apps/`, `packages/` and `scripts/`, found to have no user but its own store, and moved with it rather than exported to create a back-edge.

Net: 24 production files, **−893/+146** lines; `reconciliation/service.ts` 1068 → 929; zero `InMemory` classes left under `src/`. Verified unit 1241/1241, integration 144/144, lint + typecheck + build clean.

**Aside, found while verifying:** `pnpm db:seed` is not idempotent. Re-seeding an already-seeded database inflates row counts and reds five assertions in `packages/db/test/seed-demo.int.spec.ts` (7 vs 5 cases, 5 vs 3 invoice runs, 4 vs 2 consoles). It cost a diagnosis here — the failures looked like the refactor until the diff was checked against `packages/`, which it never touches, and a pristine database went 144/144. CI never sees it because every run starts fresh. Left alone; worth a story if anyone ever seeds twice deliberately.

---

## 2026-08-13 — BILL-09/BILL-10: profitability and hosted tenant billing completion

Completed the approved non-insurance billing plan. BILL-09 adds deterministic per-TPP and
per-product-family profitability from persisted receivables/payables evidence, side-effect-free
fee and overage simulations, a sha256-sealed CBUAE annual-review export, and a Finance View
profitability block. Liability and TPP-aaS margin inputs remain explicit evidence seams; the
implementation does not invent insurance commissions or an insurance commercial model.

BILL-10 adds the billing-specific HOST-01 substrate accepted in ADR 0028: idempotent tenant
provisioning, verified P2 tenant claims, per-tenant approval/rating/invoice/ASP/collection policy,
multi-tenant scheduled projections, tenant-scoped assurance, aggregate-only k>=3 benchmarking
behind `query_purpose_registry` with High-class audit, and a sha256-sealed portable export of the
complete tenant billing dataset. Migration 0038 keeps tenant application reads RLS-pinned while
reserving provisioning and aggregate computation for the operator control plane. The broader
HOST-01 work outside billing remains separately scoped.

Evidence: monorepo typecheck and ESLint clean; full unit suite 1,305/1,305 green; dedicated
Postgres integration test added for migrations, billing-table RLS, tenant-only export, and governed
three-tenant benchmark. The local environment did not expose a database connection, so the real-
Postgres suite remains a CI gate.

---

## 2026-08-15 — HARNESS-16: the two OFBO reviewers now run independently in CI

AI review was already part of every story — but only pre-PR, inside the build agent's own
session. `next-story/SKILL.md:35` dispatches `hard-stop-reviewer` and
`contract-conformance-reviewer`, HG-0001 counts their verdicts toward the merge criteria,
and this log records them per story. Nothing in GitHub ever verified that the review ran, or
that the verdict written here matched what the reviewer actually said. That is
self-attestation, and it was the one control not enforced outside the agent's write scope.
Before this change CI had no model-based review at all: Q4 is named "security review" but is
`pnpm audit` + `semgrep p/secrets`, and PRs #313 and #311 carried zero reviews and zero
comments.

`.github/workflows/ai-review.yml` runs both reviewers on every code-touching PR as two
independent check runs, in a fresh session, and posts each verdict to the PR as a sticky
comment. The prompt reads `.claude/agents/*.md` rather than restating the checklists — those
files are CODEOWNERS-protected, and a copy inlined into the workflow would be a second,
unprotected version of the canon free to drift from the one the pre-PR reviewers use.

The load-bearing case is not a wrong verdict but a **missing** one. A missing review file, a
missing `VERDICT:` line, or a malformed one all report DID NOT COMPLETE and go red: a review
that never ran must never be indistinguishable from a passing one. The parse was verified
against 12 cases before being wired in — a review with no verdict, `VERDICT: MAYBE`, and
`VERDICT: PASS` appearing mid-prose all land on red; two verdict lines take the last.

Advisory by design: red on FAIL/DRIFT so a finding is visible, but deliberately not a required
status check, per HG-0001's "AI reviewers remain as *advisory* PR checks". This is explicitly
**not** separation of duties — same model family reviewing the same agent's output, and
HG-0001:58 already says "AI reviewing AI is not four-eyes". Human merge is untouched.

**The first live run found a real defect — in the reporting, not the design.**
`claude-code-action` withholds its GitHub App token from any run whose own workflow file
differs from the default branch (anti-exfiltration: a PR must not be able to rewrite the
workflow *and* get the token). On the PR that introduces this workflow that condition always
holds, so the action skipped. The design behaved correctly under it — no review file, so the
three-way parse refused green and reported DID NOT COMPLETE, which is the intended failure
mode observed live rather than argued for. But the message named the *symptom* ("produced no
review file") rather than the cause, leaving a future control-plane PR to debug it blind.
Preflight now detects the condition by diffing this workflow against the default branch and
says so, including that it self-resolves on merge. Verified: the guard fires on this branch
and stays silent for an unrelated workflow file (negative control). The same pass also closed
a second gap — structural non-runs previously left no PR comment at all, so a fork PR would
have shown a bare green check with nothing to explain it.

Consequence worth knowing: **a PR that edits `ai-review.yml` cannot exercise the reviewers on
itself.** The first real review will be on the PR after this one merges.

Evidence: workflow YAML parses and its structure verified (2 matrix legs, `fail-fast: false`,
7 steps, guarded permissions); verdict parse 12/12 against the edge cases above;
workflow-validation guard verified with a negative control. ADR 0029 was filed as **Proposed**
— a control-plane change needs `control-plane-owners`, not the agent's own say-so — and was
**Accepted by the user on 2026-08-16**. Still owed and recorded in ADR 0029: the
injected-violation self-test proving the check goes red against a real finding, which cannot
run until the workflow is on the default branch.

Residency: this is HG-0011 Option 3 (provider proxy), permitted only while the environment is
synthetic-only and non-prod (HG-0011:48). The M6 swap is `use_bedrock`/`use_vertex` or
`ANTHROPIC_BASE_URL` — but the OAuth token pins the job to the first-party API, so that swap
is two changes, not one. ADR 0029 records both.

---

## 2026-08-16 — HARNESS-16 (cont.): the review engine becomes a swappable port

Follow-up to the entry above, on request: make the reviewing model swappable rather than
hardcoded — Claude now, other engines later.

PRD §3 already says institution-specific systems are ports — code against the interface, keep
the mapping in configuration, never hardcode a vendor. That rule applies to the model
reviewing the bank's code at least as much as to the bank's ITSM, so the engine is now a port
rather than a vendor baked into a workflow step.

The contract is fixed and engine-agnostic: read a CODEOWNERS-protected reviewer definition,
diff the PR against its base, write a review to `$REVIEW_FILE` whose last line is the
`VERDICT:` line. **The verdict parse is the port's contract test** — the same acceptance rule
ADR 0024 sets for the enterprise adapters (an adapter must pass exactly the tests the
simulator passes). Which engines run is `.github/ai-review.config.json`; one enabled engine is
a swap, two is a cross-check at twice the cost.

The failure mode worth engineering against is a HALF-ADDED engine: a registry entry with no
adapter step would produce a matrix leg that runs, executes nothing, writes no review, and
surfaces as the generic DID NOT COMPLETE — a real non-review wearing the costume of a
transient failure. `scripts/ai-review-matrix.mjs` refuses to build such a matrix, so the new
`config` job fails loudly and specifically before a single token is spent.

Two engine-specific facts were moved OUT of the core into the registry, because leaving them
in would have made "swap the engine" untrue: the comment attribution (attributing a Codex
review to Claude Code would misstate which model produced the verdict) and
`requires_workflow_parity` (the anti-exfiltration rule from the entry above belongs to one
engine's tooling, not to the port — the Codex CLI adapter uses a plain secret and has no such
constraint, so it could review workflow-editing PRs that the Claude engine cannot).

No repository-variable override, deliberately: HG-0006 makes the reviewer prompts and the
model serving them model configuration, and HG-0002 puts that under control-plane-owners. An
admin-settable override would move part of that decision outside CODEOWNERS. Changing which
model reviews the agent's work is a control-plane PR.

Evidence: 10 new guard tests (30/30 total in `scripts/test`), covering enabled-without-adapter
rejected, disabled-without-adapter allowed, no-enabled-engine rejected, missing agent
definition rejected, duplicate keys, all problems reported at once, and an assertion that the
engine-agnostic core names no provider. Proved the CLI FAILS CLOSED end to end on a scratch
tree: enabled-with-adapter exit 0, enabled-without-adapter exit 1 with an `::error`, two
enabled engines produce the cross product. Workflow YAML re-parsed (2 jobs, dynamic matrix,
`fail-fast: false`, 8 steps). Claude-only output is unchanged at 2 check runs.

NOT PROVEN: the Codex adapter has never executed. It is real rather than a stub — written
against the `@openai/codex` CLI surface verified against v0.147.0 (`codex exec` with
`--model`/`--sandbox`/`-o`) rather than an action reference that could not be confirmed to
exist — but it ships `enabled: false` with no `CODEX_API_KEY`, and its first run must be
treated as unproven. It fails loudly if wrong: no review file written, so the core reports
DID NOT COMPLETE.

---

## 2026-08-16 — ADR 0029 accepted (control-plane approval)

The user approved ADR 0029 (AI review as an advisory CI check, incl. the swappable engine
port). Status flipped **Proposed → Accepted**.

Recording the authority rather than just the outcome: this is a control-plane change under
HG-0002, which requires approval from a human control-plane owner who is not the build agent.
`@michartmann` is the resolvable CODEOWNER on `/docs/adrs/` and `/.github/` under the interim
arrangement documented in `.github/CODEOWNERS`, so the approval came from the right authority.

**This is not a merge.** HG-0001 keeps merge as a separate human act and the agent never
self-merges; PR #314 stays open for the user. Accepting the ADR settles the decision record,
not the code review of the change that implements it.

Still owed, unchanged by the acceptance: the injected-violation self-test proving the check
goes red against a real finding, which cannot run until the workflow is on the default branch;
and the Codex adapter's first real execution, which has never happened.

---

## 2026-08-16 — HARNESS-16 (cont.): one active engine, three registered, swap by one string

Requirement clarified by the user: one model reviews (cost minimum), and it must be swappable
among several as better review models appear. That is a different shape from what shipped in
the previous entry, which allowed N enabled engines crossed with reviewers.

Replaced the per-engine `enabled` booleans with a single `active` key. **Exactly one engine
reviews, by construction rather than by convention** — `active` is one string, so no
combination of registry entries can produce a second review leg and double the recurring
bill. A test asserts the invariant holds with four engines registered. Swapping the reviewing
model is now that one string, and a test drives claude→codex end to end asserting the secret
and model swap with it.

Cross-checking two engines was dropped deliberately, not lost: it doubles cost for a check
that is advisory anyway. Re-adding it is a change to the matrix builder, not a config flag —
the right friction for a decision that doubles a recurring bill.

THREE ENGINES REGISTERED, EVERY SURFACE PROBED RATHER THAN ASSUMED. A fabricated action
reference or wrong auth variable produces a silently broken CI job, so none of this came from
documentation or a research summary alone:
- claude — anthropics/claude-code-action@v1; CLAUDE_CODE_OAUTH_TOKEN. Proven in CI.
- codex — @openai/codex v0.147.0, `codex exec --model --sandbox --color`; CODEX_API_KEY
  confirmed read (a dummy key reached the API rather than a "not logged in" error); exits 1 on
  failure. An `openai/codex-action` was reported by a research pass but could NOT be verified
  from this environment, so the adapter uses the npm CLI — which also means a `run:` step that
  cannot break job setup the way an unresolvable `uses:` would.
- gemini — @google/gemini-cli v0.55.1, `gemini -p --model --approval-mode yolo --skip-trust`;
  GEMINI_API_KEY confirmed read.

THE GEMINI PROBE RETIRED AN ASSUMPTION. Without `--skip-trust` the CLI reports it is "not
running in a trusted directory", silently downgrades `--approval-mode yolo` back to `default`,
does nothing — AND EXITS 0. It also exits 0 on a critical API error. A `set -e` adapter step
sails past both. Only the missing review file catches it. The rule that an adapter is never
trusted to set the job's status started as a principle in the previous entry and is now an
observed necessity, with a named CLI behind it.

Evidence: registry tests 13 (33/33 in scripts/test); eslint clean; workflow parses with 9
steps and three adapters; CLI swap probe run against all three engines — each yields exactly 2
check runs, never 4 — and the config restored to `active: claude` afterwards.

UNCHANGED AND STILL OWED: neither CLI adapter has produced a real review. Swapping to codex or
gemini needs its secret added first; without it preflight reports NOT RUN — explicitly not a
pass — rather than silently reviewing nothing. And the injected-violation self-test still
cannot run until the workflow is on the default branch.

---

## 2026-08-16 — HARNESS-16 (cont.): first real review — active flipped to codex

Discovered while inspecting job logs: the Claude review legs on PR #314 have NEVER produced
a review. Every push reports NOT RUN, with the reason

    this PR modifies .github/workflows/ai-review.yml, which differs from origin/main —
    this engine withholds its token from a run that changes its own workflow
    (anti-exfiltration). This resolves once the PR merges

That is the workflow-parity rule working exactly as designed, and it is a chicken-and-egg:
the PR that introduces the review workflow can never be reviewed by an engine that demands
parity with the default branch. The 7-second green check runs were preflight short-circuits,
not reviews — which is precisely why NOT RUN is reported loudly on the check and the PR
rather than being allowed to read as a pass.

Codex and Gemini carry `requires_workflow_parity: false` — they authenticate with a plain
repository secret rather than a GitHub App token, so the anti-exfiltration rule is not theirs
to apply. Flipping `active` to codex therefore produces the FIRST real review this harness has
ever emitted, on this PR, and simultaneously exercises the codex adapter end to end for the
first time. Both keys were added by the maintainer this session.

Whatever `active` holds at merge time becomes the steady state — that is a maintainer decision,
not this session's, and it is called out on the PR.

---

## 2026-08-16 — HARNESS-16 (cont.): codex adapter fixed — the runner is the sandbox

The first real codex run FAILED, and the harness caught it exactly as designed: two
DID NOT COMPLETE checks, red, with "This is not a pass." on the PR. No silent green.

Root cause, from the job log rather than a guess:

    warning: Codex could not find bubblewrap on PATH ... using the bundled bubblewrap
    The execution sandbox is failing before process startup
    (`bwrap: loopback: Failed RTM_NEWADDR`), including for a plain `pwd`
    Failed to write file .../hard-stop-codex-review.md

Auth was never the problem — codex authenticated, selected gpt-5.6-sol and spent 14,443
tokens. Its OWN sandbox is bubblewrap, which cannot create a network namespace inside the
Actions runner. The failure is at sandbox SETUP, so it takes out every mode equally,
read-only included: reads, writes and a plain `pwd` all failed.

Candidate fix IDENTIFIED BUT DELIBERATELY NOT APPLIED: selecting the CLI's no-OS-sandbox
mode. It is the only mode that runs, since bubblewrap cannot initialise at all — so the
real choice is "codex runs" vs "codex does not run", not "sandboxed" vs "unsandboxed".

It was not committed, because it is a security decision belonging to a human rather than to
this session. Two things weigh against it, and the second is the larger:

1. The containment layer is real. The reviewer's job is reading a PR diff — semi-untrusted
   input — so prompt injection is the live threat. With the sandbox, an injected command is
   confined to a workspace with no network. Without it, CODEX_API_KEY and the job's
   GITHUB_TOKEN are reachable. Blast radius is still bounded (contents: read,
   pull-requests: write — it can comment, it cannot push), but it is not nil.
2. CODEX LACKS THE WORKFLOW-PARITY PROTECTION, AND THAT IS THE BIGGER HOLE. `on:
   pull_request` hands secrets to same-repo PRs while running the workflow file FROM THE PR
   HEAD. Claude's parity rule refuses exactly that. Codex carries
   requires_workflow_parity: false, so a PR that edits ai-review.yml still runs it with the
   key — sandbox or no sandbox. In a repo where autonomous agents push branches, "requires
   write access" is a low bar.

CORRECTION TO THE PREVIOUS ENTRY. It framed codex's ability to review this PR — the one
that modifies ai-review.yml — as the reason to flip `active` to it. That was backwards:
that ability IS the hole described above, not a feature. Parity ought to be enforced by
this harness for EVERY engine rather than left to whichever vendor happens to implement it,
and the correct consequence of doing so is that no engine can review the PR that changes
its own workflow.

`active` is therefore restored to claude — the last known-good state, not a verdict on the
open question. Flipping it back is one string whenever the maintainer decides.

TWO DESIGN RULES EARNED THEIR KEEP THIS RUN:
- `Parse verdict` runs on `!cancelled()`, so the adapter's exit code was never load-bearing.
  Whether codex exited 0 or 1 is still unknown and did not matter — the missing review file
  is what produced the red.
- Reporting DID NOT COMPLETE distinctly from PASS is the only reason this was visible at
  all. A harness that treated "no findings file" as "no findings" would have shown two
  green checks over a reviewer that read nothing.

Also corrected: the Claude legs on this PR have never reviewed either. They report NOT RUN
(workflow-parity anti-exfiltration) because the PR modifies ai-review.yml. The 7-second
green checks earlier in this branch's history were preflight short-circuits, not reviews.
That resolves only on merge, and is why codex — which carries requires_workflow_parity:
false — is the only engine that can review this particular PR.

---

## 2026-08-16 — HARNESS-16 (cont.): parity enforced by the harness, for every engine

Maintainer decision: stay on claude, and make workflow parity universal rather than
per-engine. Both done.

THE DEFECT. Parity was a per-engine flag, true only for claude because claude-code-action
enforces an equivalent rule itself. `on: pull_request` hands repository secrets to SAME-REPO
PRs while running the workflow file FROM THE PR HEAD. claude-code-action refuses that; the
CLI adapters authenticate with a plain repository secret and have no such rule. So pointing
`active` at a CLI engine removed a security control silently — a PR could have rewritten the
reviewer and collected its credential in the same run. Swapping a model is meant to be a
one-string change; it must not also swap a guard in or out.

Not spotted by reasoning. Spotted because the previous entry justified flipping `active` to
codex on the grounds that codex COULD review the workflow-modifying PR when claude could not.
That ability was the hole, written up as a feature.

THE FIX. Preflight gates on the diff alone, for every engine, over the whole review control
plane — each of these can decide what the reviewer executes or which secret it is handed:
  .github/workflows/ai-review.yml   arbitrary `run:` steps with the secret in scope
  .github/ai-review.config.json     names the secret; secrets[matrix.engine.secret] indexes
                                    by it, so editing it redirects which secret is exposed
  scripts/ai-review-matrix.mjs      produces that registry value, so it can do the same
`requires_workflow_parity` is deleted from the registry, the validator, the matrix output and
the workflow. Two tests hold the line: no per-engine flag survives anywhere in the workflow
and all three paths are guarded; neither the registry nor the built matrix reintroduces one.

VERIFIED BEFORE COMMITTING, not after. The preflight decision block was simulated across all
seven paths with a stubbed git — fork, missing credential, each control-plane file alone, two
files together, and the clean case that must RUN. All correct, no `set -u` unbound failures.
That simulation also caught a cosmetic bug: `paste -sd', '` treats a multi-char delimiter as a
CYCLING list, so three changed files rendered as "a,b c". Now `paste -sd',' | sed 's/,/, /g'`.

A second latent bug surfaced writing the test: `indexOf('# ADAPTERS START')` matches the
header prose "ADAPTERS START/END markers" at offset 2196, not the real marker at 13972,
yielding an empty slice and a test that asserts nothing. Anchored to the newline. The existing
ADAPTERS END test was checked and is unambiguous either way.

DELIBERATE CONSEQUENCE, stated plainly: no engine reviews the PR that changes how reviews run,
this harness included. It cannot review its own control-plane changes. That is correct and
self-resolves on merge, but it means THIS PR gets NOT RUN on both reviewers — as will any
future PR touching those three paths, which are then reviewed by humans only.

Evidence: 15 registry tests, 35/35 across scripts/test; eslint clean; preflight simulation
7/7. Still owed, unchanged: claude has never produced a review — it cannot until this merges.

---

## 2026-08-16 — HARNESS-16 (cont.): a missing credential now fails the job

Maintainer decision, implemented: missing credential goes RED, structural non-runs stay GREEN.

The distinction is about which failures are worth a colour. A fork PR cannot have secrets and
a control-plane PR must not be reviewed by the reviewer it edits — neither is the author's
fault, neither is fixable in the PR, and a check that is permanently red on them is a check
people learn to scroll past. That is the failure mode where a real finding gets missed because
the reviewer cried wolf. A missing credential is not that: it is a repository misconfiguration
that silently disables review on EVERY PR, and green is exactly how nobody notices reviews
stopped happening.

Implementation: preflight emits a `fatal` output, set only in the credential branch, and a new
`Enforce preflight` step is gated on it. It sits AFTER the comment step so the PR gets the
full explanation before the job dies, and the step summary tells the reader how to fix it
(set the secret, or point `active` at an engine whose credential exists).

ORDERING IS LOAD-BEARING, and the simulation is what made that concrete. The case worth
naming: a fork PR that also has no credential. Because the fork test runs FIRST, it reports as
a fork and stays green — correct, since a fork legitimately has no secret and calling that a
misconfiguration would be wrong. Reverse the two branches and every fork PR turns red with a
misleading reason. A test now pins the ordering rather than trusting it.

Evidence: preflight simulation extended to assert the `fatal` output, 8/8 including the
fork-without-credential case; 16 registry tests, 36/36 across scripts/test; eslint clean;
workflow parses with 10 steps in the intended order (comment before enforcement).

---

## 2026-08-17 — BILL-11: TPP Cost Management decisions ratified (ADR 0006 + 0007 accepted)

Docs-only decision story landing the pre-execution review of the TPP Cost Management plan
(payable side of the billing control plane). The plan was verified two ways before acceptance:
every reuse claim checked against main (both alleged rating defects confirmed real — outbound
corporate data rated as retail overage in `metering.ts:316-325`; profitability counting only Hub
cost in `profitability.ts:88`), and the scheme-facing assumptions checked against UAE OF sources
(C&P Pricing Model v1.0, per-endpoint chargeability, per-LFI directory rates), which corrected
three of them: per-LFI `OverLimitFees` overage rates are directory-published required work (with
a per-call vs per-page unit check), Nebras centrally collects BOTH fee streams (so the Nebras
settlement statement is the primary actuals document), and the 30-day query window is a house
convention, not a published scheme rule.

- **ADR 0007 → Accepted** under the product name **TPP Cost Management**, recording the full
  decision set: OFBO/P9 boundary with an explicit P9 port extension (AP dispatch + status, both
  adapters, port contract tests); gross ledgers with netting only at settlement; fee-schedule
  source = versioned C&P model + per-LFI directory snapshots; VAT accrued net with an input-VAT
  leg on acceptance (Hub posture → BD-20); Nebras-primary document taxonomy; configurable query
  window (BD-21); cost-period close composing the BACKOFFICE-06 monthly sign-off; closed-period
  re-rating; insurance consumption in scope / commissions deferred; PostgreSQL; CAAP reserved as
  a future stream; no PSU identifiers in cost tables.
- **ADR 0006 → Accepted** (Option 1, role_domain LFI|TPP|shared) with the billing-family
  taxonomy decided now (payable family TPP-domain from day one); platform-wide taxonomy is
  BD-22, enforcement build is SEG-01 (blocked on BD-22).
- **PRD:** §2 Finance Analyst scopes aligned to the spec's `x-required-scope` ground truth —
  resolves the 2026-06-11 BACKOFFICE-47 advisory (`finance:reconciliation:*`/`billing:read`
  drift); role-domain note added; §6 reconciliation module row corrected the same way; §7.6
  gains the payable-side product definition; BD-20..BD-22 added to §10.
- **Backlog:** BILL-12..BILL-17 seeded pending with acceptance criteria (statement domain +
  rate corrections → ledger + re-rating → document ingest → three-way recon → accounting/AP/
  settlement → console/demo/smoke), plus SEG-01 blocked on BD-22.
- **OpenAPI intentionally untouched** — the contract lands spec-first per story with failing
  contract tests, per the workflow; PR 1 is the decision record only.

Evidence: docs gates green (docs:check link check, ADR number check, discovery waist gate —
BILL/SEG ids are not waist-gated feature items); backlog YAML parses; no source, spec, or test
files changed.

## 2026-08-17 — BILL-11 addendum: verified against Nebras Interaction Guide v5.0 (same PR)

The user supplied IG v5.0 (§10 Billing and Invoicing, 74 pp) after the decision commit; the
plan and the just-landed ADR text were re-verified against it. Two decisions confirmed, three
corrected — all folded into ADR 0007 / PRD / backlog in this same PR before merge:

- **Confirmed — Nebras-primary documents (D9/D5):** §10.2 has the TPP tax invoice carrying
  API Hub fees AND LFI charges; §10.3.4/10.18 add summarized supporting data (more on
  request). The §10.9 sample shows Hub sections only, so BILL-14 ingests both layouts, and
  the invoice's own line-category taxonomy (Service Initiation / Data Sharing categories)
  becomes the reconciliation grain via a category→fee-class mapping.
- **Confirmed — dual-role netting (D2):** §10.16 verbatim: amounts payable to LFIs are netted
  against fees owed to Nebras where the LFI also operates as a TPP. Settlement calendar
  30th–5th.
- **Corrected — query window (was "house convention"):** §10.13 publishes it — submit within
  30 CALENDAR days of occurrence, first response 10 min, final response 10 days, respondent
  review & escalation 15 days. BD-21 narrowed to anchor semantics; BILL-15 now also tracks
  the Nebras response clocks and mirrors the §10.11.3 billing-query field list.
- **Corrected — Hub-fee VAT (BD-20 default flipped):** the §10.9 sample tax invoice prices
  lines at net scheme rates with Taxable / VAT 5% / VAT Amount / Gross columns — Hub fees are
  VAT-EXCLUSIVE +5%, not inclusive. LFI-side amounts stay inclusive (the §10.10 collection
  memo shows no VAT columns). BD-20 now only confirms on the first real invoice (the sample
  carries a CoP-discounted unit anomaly, 0.25 vs 0.005, noted in the ADR).
- **Corrected — payment mechanics (D1/D5):** §10.14 requires TPPs to pay by DIRECT DEBIT —
  DDA presented on the 10th, collection to the 30th, §10.17 late-payment penalty fees. P9's
  execution role is DD mandate management + debit matching, not push payment; penalties are a
  distinct recon charge class (BILL-15/16 notes updated).
- Also absorbed: billing calendar §10.12.3 (3rd/5th/10th/30th/30th–5th) anchors the BILL-14
  absence alarm, which §10.12.2 makes a participant OBLIGATION; the §10.10 collection memo
  confirms per-LFI-set retail overage ("Customer Data" at the issuing LFI's own rate) and
  corporate data at 0.4 AED/page.
- **Out-of-scope observation for BD-16 (noted in its row, no change here):** IG v5.0 §8
  publishes 30/5/10/15 calendar-day dispute-stage clocks and §11 gives 15-day maintenance /
  30-day version-release notices — to be reconciled with the BACKOFFICE-75/-78 configured
  clocks in a follow-up story.

Evidence: docs gates re-run green (docs:check, discovery waist gate, adr-number-check);
backlog YAML parses. Still docs-only.

---

## 2026-08-17 — HARNESS-16 VERIFIED: both reviewers ran end to end (PR #318)

The thing every prior entry listed as owed. HARNESS-16 merged (PR #314, d37c791), and PR #318
was opened for the single purpose of exercising the reviewing path — which had never once
executed, because every run on #314 reported NOT RUN under the control-plane parity guard.

The test change had to satisfy two constraints or it would have proven nothing: touch NONE of
the three parity paths (or NOT RUN again), and not be markdown or under docs/ (or paths-ignore
skips the workflow entirely). A comment fix in scripts/test/ai-review-matrix.test.mjs
satisfied both while being a real correction — the header cited "an enabled engine ..." for a
test since renamed to "the ACTIVE engine ...", against a field that no longer exists.

RESULT — both legs ran, with verdicts:
  AI review — contract conformance · Claude   VERDICT: CONFORMANT
  AI review — hard-stop · Claude              VERDICT: PASS

The verdicts matter less than the substance, and the substance was real:
- Each reviewer walked its full checklist recording WHY each item was unreachable by a
  comment-only diff, rather than asserting a pass.
- contract-conformance ran its own `git diff` against specs/ services/ apps/ packages/ to
  verify emptiness, and distinguished the PORT contract from the OpenAPI contract it owns.
- hard-stop independently observed that a comment-only change to a TEST file is the shape a
  Q1b test-integrity evasion would take, verified no assertion or matcher was weakened, and
  checked the comment's factual claims against source instead of trusting the prose.
- contract-conformance found a genuine flaw in the diff — "a registry entry here" pointing at
  the test file rather than .github/ai-review.config.json — declined to file it as a finding
  (style is out of its scope) but recorded the omission so the judgement was stated, not
  silent. Fixed in e47e7f9, which the reviewer then confirmed on re-run.

INFRASTRUCTURE, NOT THE DIFF. Midway through, GitHub stopped assigning runners: jobs failed in
~2s with runner_id 0, no steps recorded, logs 404, and 0ms billable — including jobs unrelated
to the change (Q2c, Q2b, Q4, Discovery). Diagnosed as runner starvation rather than a workflow
defect and recorded on the PR rather than thrashed at with commits; a rerun once capacity
returned dispatched all ten jobs of the `ci` workflow run. (Units differ deliberately through
this entry: the PR carries 13 CHECK RUNS across two workflows — `ci` and `ai-review` — while the
`ci` run itself contains 10 JOBS. A check run is not one-to-one with a job.) Billing could not be
checked from this session — the GitHub
MCP surface exposes no billing tools and those endpoints need org-admin scope — so whether it
was a minutes quota or an Actions incident remains for a human to confirm.

That accident tested the design's central claim harder than any deliberate test: undispatched
jobs went RED, never green. Four distinct failure modes now — workflow-validation skip, codex's
broken sandbox, parity non-runs, runner starvation — and a review that never ran has not once
been mistaken for a review that found nothing.

ADR 0029 updated: engine table corrected (claude proven end to end; codex ran and does NOT work
as written), the codex bubblewrap finding recorded in the decision record for the first time,
and a verification-record section added.

STILL OWED, unchanged: the injected-violation self-test. A comment-only diff cannot show a
reviewer CATCHES a violation, only that the path runs and the reviewers reason about scope. The
green verdicts here are weak evidence by construction, and now that the workflow is on main
that test is finally possible.

Evidence: all 13 checks green on e47e7f9; 36/36 scripts/test; eslint clean.

---

## 2026-08-17 — BILL-12: expected TPP cost statement + payable rate-model corrections

First implementation slice of TPP Cost Management (ADR 0007, accepted in BILL-11). Tests first: the
three new specs were staged and run RED (26 failing, 3 passing as regression guards) before any
source change; they now stand at 34 tests green.

**Shipped.** `resolveLfiOverageRate` over a `DirectoryOverageSnapshot` whose `unit` is a REQUIRED
field — the directory publishes `OverLimitFees` per call while the house model prices per page, and
that is unconfirmed, so it is never defaulted. Effective-dated with latest-window-wins; absent,
expired, or explicitly-zero all resolve to "this LFI charges nothing"; snapshot id + digest travel
with every resolution. `rateUsage` gained an optional 5th options param and now prices payable
retail overage from the snapshot, **failing closed** when a chargeable line has no snapshot or no
serving LFI — mirror-pricing off the bank's own receivable card is retained only for scheme-uniform
fees (payment fees, corporate pages). `buildExpectedTppCostStatement` projects a rating run into
Hub / LFI-payment / LFI-data streams, net of VAT with the two scheme treatments kept apart (Hub
exclusive +5%, TPP→LFI inclusive 5/105 — ADR 0007 D4), carrying meter-run, event, FAPI, rate-card,
snapshot and pricing-date evidence, and no PSU identifier (asserted). Both confirmed defects fixed:
outbound corporate data now rates as `data.corporate_page` (40 fils/page, no free tier) instead of
retail overage, and profitability carries `lfiCostMilliFils` as its own external cost, subtracted
from profit, exposed as `lfi_cost_milli_fils` on the wire and as an "Underlying-LFI costs" stat in
the Finance View.

**Two hazards found by adversarial review and fixed in-branch — both would have passed CI silently:**

1. **The corporate fix would have been a no-op on real data.** Meter runs dedupe on
   `(bank_id, period, rate_card_version, input_hash)` and the input hash covers only the raw
   CloudEvents, so a changed projection produces different lines from byte-identical inputs, hits
   `ON CONFLICT DO NOTHING`, and never writes them. `METERING_PROJECTION_VERSION` is now bound into
   the hash pre-image, so a rules change yields a NEW immutable run. Existing runs are deliberately
   not rewritten (append-only); they carry their original projection until re-ingested.
2. **The new fail-closed throw would have bricked three receivable-only projections.** Revenue
   assurance, the expected collection memo and closed-period re-rating all call `rateUsage` with no
   snapshot and consume only `side === 'receivable'`, so one chargeable payable line would have
   failed a regulated receivable report permanently. They now rate via `receivableMeteredLines`,
   with a regression test pinning that the payable throw survives while the receivable projection
   does not.

**One unauthorised semantic change caught and made explicit.** An earlier iteration keyed the
outbound free-tier bucket per serving LFI, which contradicted the rate card's own declared
`freeTier.per: 'psu_per_day'` (a value that reaches the wire and the portal) and granted MORE free
pages — understating the payable, the exact defect class this story exists to close. The granularity
is now rate-card data (`RetailFreeTierGranularity`) defaulting to the conservative `psu_per_day`,
with the per-serving-LFI reading available, both tested, and the question recorded on ADR 0007.

**Not closed / deferred, with reasons.** The blocking OverLimitFees unit pre-task could not be run:
the egress policy denies `data.directory.openfinance.ae` (proxy `connect_rejected`), so no live
snapshot was observed — hence the required-`unit` design and the fail-closed rating. No P6 directory
producer, no seeded demo snapshot and no synthetic outbound data events, because all three would
encode the unconfirmed unit; the statement is therefore domain-tested but not yet demonstrable at
the demo URL, and BILL-13 (which persists statements) seeds them once the unit is known. Also
recorded rather than changed: `tenant_billing_service` persists only `hub_cost_milli_fils`, so a
stored benchmark row no longer reconciles from its own columns once profit is net of LFI cost — it
is always 0 pre-BILL-16 and `publishBenchmark` has no production caller, so BILL-16 owns the column.

Evidence: unit suite 1413/1413 green (34 new); monorepo typecheck clean; ESLint clean; coverage gate
exit 0. Q1b test-integrity checked post-commit. Existing-test edits were additive only — required
new fields on fixtures plus one `toEqual` totals literal gaining `lfiCostMilliFils: 0`; BILL-09's
own scenario keeps `lfiCosts: []` so every figure it asserts is unchanged, and the new dimension is
covered by its own tests rather than by renumbering BILL-09's.

### BILL-12 addendum — advisory AI review (ADR 0029) outcome

`hard-stop` reviewer: **PASS**, no violations. It raised one item worth recording: binding
`METERING_PROJECTION_VERSION` into the run identity means a re-ingested period stores a second copy
of the same metering evidence blob — which carries `psuId` on inbound free-tier rows (pre-existing,
`metering.ts`) — in a store with no deletion path. This diff neither adds nor touches that emission,
but it does multiply an existing PII footprint, so whether the evidence blob should redact `psuId`
is a human call to take before BILL-13 persists more.

`contract-conformance` reviewer: **DRIFT (6)**. Four were in-scope and fixed here, all on types this
story introduces: the statement and the directory snapshot now carry an explicit `currency: 'AED'`
(the snapshot refuses to assume it, exactly as it already refuses to assume `unit`); the statement
validates `period` against the contract's `^\d{4}-(0[1-9]|1[0-2])$` — the one field the OpenAPI
contract constrains and the one the builder had not checked; and its date validation now
calendar-checks rather than shape-checks, matching what the sibling module already did.

Two findings were deliberately NOT patched, agreeing with the reviewer's own reasoning. The new
`lfi_cost_milli_fils` wire field is sub-minor-unit and currency-less — but so are the five
pre-existing amounts beside it, and making one field inconsistent with its neighbours would be worse
than the deviation. That, plus the absent response schemas for the billing read surfaces, is
spec-level (the reviewer's SPEC DEFECT 1 and 2): the profitability and rate-card payloads ride
`AnalyticsView`'s `additionalProperties: true`, so money and enum conventions are unenforceable
there by construction. Both predate BILL-12 and belong in a spec-change story, not a serialiser
patch. The same gap is why the widened `free_tier.per` enum has no schema to widen; the default is
unchanged, so no client sees a new value today.

Also moved rather than dropped: BILL-12's unmet acceptance criterion (confirm the OverLimitFees unit
from a live snapshot) is now an explicit acceptance criterion on BILL-13, the story that persists
statements — so it blocks where it is actionable instead of lapsing with a `done` status.

## 2026-08-17 — BILL-13: durable payable ledger + closed-period re-rating

Second slice of TPP Cost Management. Unlike BILL-12, this ran against a **local PostgreSQL 16.13
matching CI's `postgres:16-alpine`**, so the RLS grants, CHECK constraints and lineage coverage are
proven rather than discovered downstream — which matters for a story that is almost entirely
database controls.

**Migration 0039 — eight tables, controls mirroring 0032/0033.** RLS ENABLED and FORCED,
SELECT+INSERT only for `ofbo_app` (no UPDATE or DELETE grant at all), group-scoped internal-view
reads, 24/60 retention and confidential-restricted floors registered for all eight. TPP-domain data
under ADR 0006: its own table family rather than shared with the LFI receivables, which is what makes
the dual-role wall enforceable rather than nominal. **No PSU identifier in any table** — drill-down
runs through `event_ids` into `billing_event`, where `psu_id` is already governed.

The schema is **self-reconciling**, so unstorable states are actually unstorable: a statement's three
streams must sum to its net total; gross must equal net + VAT on both statements and lines; every
line must carry at least one event id; a re-rating's delta must equal corrected − previous and cannot
reference the same statement twice; AP dispatch is unique per idempotency key so P9 cannot be
double-paid; and a document line's `fee_class` is null exactly when `mapped` is false, so an unmapped
provider category cannot masquerade as mapped.

> **Correction (addendum 5, same PR).** The AP-dispatch clause above is wrong and is left in place only
> because this log is append-only. The constraint that shipped is `UNIQUE (bank_id, idempotency_key,
> dispatch_state)` — unique per (key, **state**), not per key. It bounds each state to one row per
> instruction, so an instruction cannot be recorded as `dispatched` twice; it does **not** by itself make
> double payment impossible, and it constrains no transition order. See addendum 5 below.

**Store.** `PgBillingTppCostStore` writes the three tables this story owns and never attempts an
update — immutability is a grant, not a convention. Idempotent on (meter run, rate card version, rate
snapshot hash), so re-projecting unchanged inputs re-reads the existing statement while a *corrected*
directory rate becomes a NEW immutable statement. A re-rating is refused unless both statements
project the same meter run: a meter run is immutable, so sharing one is the proof that a correction
re-priced unchanged facts; re-pricing a different run is a re-meter and is rejected rather than
recorded as a rate correction. `tppCostLineRef` derives line identity from cost dimensions rather
than generating one, which is what BILL-15 will match provider document lines against.

**Generation rides the existing monthly trigger** beside the receivable expected-memo projection —
no new scheduler, per the story note. It **skips with an audited reason rather than throwing** when a
chargeable overage line cannot be priced: the fail-closed pricing refusal inherited from BILL-12 is
correct, but letting it escape would take the regulated receivable projections down with the payable
one, which is exactly the availability trap the BILL-12 review caught. A genuine defect (an
unreachable database, say) still propagates — only the pricing refusal is a skip, and the tests pin
both halves of that distinction. The payable dataset also now travels with the tenant portable
export, so a tenant exit carries its payable evidence as well as its receivable evidence.

**Five tables are created but unwritten** until BILL-14/15/16 own them. They stay empty, which the
Q4.5 gate skips (it requires lineage only for tables holding rows) — so the migration header states
the constraint explicitly: nothing may seed them ahead of their story, or they become lineage gaps
immediately. I checked this before designing rather than assuming it; the alternative reading would
have forced the story down to three tables.

**Still not closed:** the OverLimitFees unit criterion. The egress policy still denies
`data.directory.openfinance.ae`, so no live snapshot has been observed. It is enforced structurally
rather than procedurally — rating fails closed, so a statement carrying chargeable overage cannot be
produced without a snapshot that states its unit — and the criterion carries forward to BILL-14.
Consequently no directory snapshot source is wired into the worker yet: a demo period with overage
traffic will report `skipped` with an audited reason, which is the honest state rather than a
statement priced on a guess.

Evidence: unit 1421/1421 (14 new); integration **162/162 across 77 files on a pristine database**;
Q4.5 lineage gate PASSED with `billing_tpp_cost_statement`, `_statement_line` and `_rerating` covered,
allowed gaps none, unexpected none; typecheck, ESLint and the coverage gate clean. Note the
integration suite fails on a *re-seeded* database for the pre-existing non-idempotent-seed reason
recorded under CODE-02 — verified by re-running on a fresh database, which is how CI runs it.

### BILL-13 addendum — advisory AI review (ADR 0029) outcome

`hard-stop` reviewer: **FAIL (6 findings)** — the first non-PASS on this track, and it was right about
several. Four were fixed in-branch, all defects in this story's own work:

1. **Four-eyes asserted in prose, enforced nowhere.** `billing_tpp_cost_ap_dispatch` carried a comment
   promising "never self-approved" while the table had no initiator column and no CHECK. It now carries
   `initiated_by` and `CHECK (approved_by <> initiated_by)`, mirroring `approval_request`
   (0002_tables.sql). Fixing it surfaced a second defect the reviewer had not: `approval_request_id`
   was typed `uuid`, but `approval_request.approval_request_id` is TEXT — BILL-16's foreign key would
   not have compiled. Corrected to text.
2. **A divergent regeneration was silently swallowed.** `saveStatement` used `ON CONFLICT DO NOTHING`
   and re-read the stored row without comparing the recomputed evidence hash, so regenerating a
   statement with *different* content under the same key returned the old one and reported
   `created: false`. Divergent evidence on an immutable regulated record is now raised as a conflict,
   matching the tenant-configuration precedent; `saveRerating` got the same treatment over its replay
   payload.
3. **The PSU claim over-reached.** The header said no PSU identifier appears in any of the eight tables
   "asserted by test", but the test covers the statement family only, and three provider-fed free-form
   columns (`parsed_payload`, `raw_document_ref`, `response_payload`) cannot be constrained by schema.
   The claim is now scoped to what is true and enforced, and redaction at parse time is written up as a
   **requirement on BILL-14 and BILL-16**, which own those write paths.
4. **A skip decided by regex over error text.** The generation service classified an unpriceable period
   by matching the error message, so any future error mentioning those words would have been downgraded
   to a skip. `UnpriceableOverageError` now carries that meaning as a type, and a test proves an
   impostor message still propagates as a defect.

Also fixed, from the reviewer's non-finding notes: the worker constructed `PgBillingTppCostStore` but
never closed it, leaking a `pg.Pool` per tenant per monthly run. And from the contract reviewer's
observations, `tppCostLineRef` omitted `productFamily` while the domain aggregates on it under a UNIQUE
constraint — unreachable today because `classify()` derives productFamily from feeStream+apiFamily, but
that is an invariant of `classify()`, not of the identity, so the ref now mirrors the aggregation key
exactly.

Deliberately **not** changed, with reasons: `scope_used: 'billing:rate'` is an undeclared scope token in
the audit trail, but it is exact precedent already on main (`memo-reconciliation.ts`) and fixing two of
four call sites would make the trail less consistent, not more — it wants one repo-wide pass. The
camelCase keys inside exported jsonb payloads are a ratified byte-stability exception for the portability
digest, pinned by an existing test on main; the reviewer's own recommendation is to write it into the
spec description, which is a spec-change story. The ADR 0006 role-domain dimension stays with SEG-01
(blocked on BD-22); the migration now states the family's domain explicitly so it is unambiguous when
SEG-01 threads it, and the portable export is recorded on SEG-01 as the first call site where one read
crosses the wall.

**Milli-fils vs the CLAUDE.md minor-unit money rule has now been flagged by two consecutive contract
reviews** (BILL-12 and BILL-13) with no ADR ratifying it. It needs a decision: either CLAUDE.md names
milli-fils as the billing-domain precision, or the spec's `*_milli_fils` fields go through spec-change.

Re-verified after the fixes: unit 1422/1422; integration 164/164 across 77 files on a pristine
database; Q4.5 PASSED, allowed gaps none; typecheck and ESLint clean.

### BILL-13 addendum 2 — contract review, second round

`contract-conformance` reviewer, re-run after the hard-stop fixes: **one finding, fixed in-branch.**

**A `sha256:`-prefixed string that was not a digest.** `services/bff/src/billing/tpp-cost.ts` composed the
statement's `rate_snapshot_hash` as `` `sha256:${rateCard.version}+${snapshot?.digest ?? '…'}` `` — a
concatenation of the two pricing sources wearing a hash's prefix. On an evidence-chain identifier that is
worse than an honest opaque string: an auditor reconstructing the pricing basis will try to recompute it,
and cannot. There is no precedent for the shape anywhere in the repo; every other `sha256:` value on main
is a real digest. Replaced with `rateSnapshotHash()`, an actual SHA-256 over a canonical, documented
pre-image (`ofbo.tpp-cost.rate-snapshot.v1` \ `rate-card:<version>` \ `directory:<digest|none>`), with a
unit test that recomputes the digest independently, asserts the `^sha256:[0-9a-f]{64}$` shape, and proves
differing sources do not collide.

Three structural fixes also landed in this round, ahead of the stories that depend on them:

1. **The approval link is now a foreign key.** `billing_tpp_cost_ap_dispatch.approval_request_id` was a
   free-text column; it now `REFERENCES approval_request(approval_request_id)`, so a dispatch cannot cite
   an approval that does not exist. The accompanying comment states plainly what the schema still cannot
   enforce — that the referenced approval is *for this dispatch* — rather than implying the FK covers it.
2. **`billing_tpp_cost_ap_dispatch` is an append-only state log.** The table was INSERT-only yet modelled
   a mutable lifecycle, so advancing a dispatch's state had no legal write path. `UNIQUE (bank_id,
   idempotency_key, dispatch_state)` makes each transition its own immutable row — one shape that is both
   INSERT-only and able to progress, which is what BILL-16 needs.
3. **`EXPORT_TABLES` narrowed to what this story writes.** The tenant portable export had been widened to
   all eight payable tables; five of them BILL-13 never writes, so the entry was a claim about future
   stories' data. It now lists only `billing_tpp_cost_statement`, `_statement_line` and `_rerating`.

Re-verified on a pristine database in CI's exact order (`db:apply` → `db:seed` → integration → gate):
unit 1423/1423 across 211 files; integration 164/164 across 77 files; Q4.5 PASSED with the three
row-bearing payable tables covered and allowed gaps none; typecheck 0 errors; ESLint clean; doc-link-check
59 docs / 29 ADRs clean.

Carried forward unresolved, both needing a human decision rather than more code:

- **Milli-fils vs the CLAUDE.md integer-minor-units money rule** — flagged by every contract review on
  this track that has looked at it (BILL-12, and both rounds of BILL-13) with no ADR ratifying it. Either
  CLAUDE.md names milli-fils as the billing-domain precision, or the spec's `*_milli_fils` fields go
  through spec-change.
- **BILL-13's first acceptance criterion** (persist statements priced from a live directory snapshot)
  remains unmet, because the directory host is unreachable from this environment. It is enforced
  structurally rather than procedurally — rating fails closed, so no statement can be written from a
  guessed rate or unit — but the criterion itself carries forward to whichever story first obtains a
  snapshot.

### BILL-13 addendum 3 — the advisory reviews caught a real availability defect I had just introduced

Both ADR 0029 advisory reviews came back non-PASS on `6f87bc6` — hard-stop **FAIL (3)**, contract
**DRIFT (5)**. Every one of those eight findings is either documented-and-deliberate or already
escalated, and both reviewers flagged all of theirs as uncertain (see the two rounds above and the
carried-forward items). But the hard-stop reviewer's *observations* section — the part that counts
towards no verdict — contained the only genuine defect in the round, and it was **mine, introduced by
addendum 2's own fix**:

**A resumed monthly run would have failed the entire billing projection.** Addendum 2 added
evidence-hash divergence detection to `saveStatement`, comparing `tppCostEvidenceHash(statement)` —
which spans `evidence.generatedAt` and `evidence.ratingRunAt`. The worker stamps both from
`billingRunAt`, its own run clock. So a resumed or replayed run re-derives an identical statement under
a later clock, gets a different hash, and the new conflict check throws — surfacing as an
`AggregateError` that takes the receivable projections down with it. `saveRerating` had the identical
bug over its `{ previous, corrected }` replay payload, which nests two statements and so two pairs of
clock readings.

This is the *same class of defect* as the one the BILL-12 review caught (a fail-closed throw bricking
projections that had nothing to do with the failure), reintroduced two rounds later by a fix aimed at a
different problem. CLAUDE.md requires scheduled jobs to be resumable and idempotent; the check I added
made them neither. The reviewer also identified precisely why the tests missed it: the BFF spec uses a
mock store, and the int spec replayed the *identical object* — neither exercised a moved clock.

Fixed by separating substance from provenance. `tppCostContentHash` digests everything except the two
clock readings, and divergence is compared on that, recomputed from the stored `statement_payload`
rather than read from `evidence_hash`; `tppCostReplayContentHash` does the same across a re-rating's two
nested statements. `evidence_hash` still stores the complete digest including timestamps — it is the
provenance record of what was written, and the first write's clock belongs in it. Different totals or
lines remain a hard conflict; a later run time no longer is. Both new tests were confirmed to FAIL
against the previous comparison, reproducing the exact production error, before the fix was restored.

Two further fixes this round:

1. **The four-eyes FK is now tenant-composite.** The hard-stop reviewer's FAIL 5 was right on its first
   limb: `REFERENCES approval_request(approval_request_id)` against a globally-unique text key let one
   bank cite another bank's approval. `approval_request` gains an additive
   `UNIQUE (bank_id, approval_request_id)` (guarded, since Postgres has no
   `ADD CONSTRAINT IF NOT EXISTS`) and the dispatch FK is now composite on `(bank_id,
   approval_request_id)` — the same idiom as this table's other two foreign keys. Proven by a test that
   a dispatch citing another bank's approval is refused. The reviewer's other two limbs — approved
   state and unexpired `expires_at` — are mutable state on the referenced row and cannot be expressed
   as a foreign key at all; they stay a stated write-time requirement on BILL-16, and the migration
   comment now says exactly that rather than implying the FK covers more than it does.
2. **Doc-vs-code drift corrected.** The generation service claimed an unpriceable period was "raised as
   an operational signal"; it emits a High-class audit event and nothing else. The comment now says so,
   and routing to P3/ITSM is named as BILL-14's, once a directory source exists that can fail.

Re-verified on a pristine database in CI's order: unit 1423/1423 across 211 files; integration
**167/167** across 77 files (three new tests); Q4.5 PASSED, allowed gaps none; typecheck 0; ESLint
clean; doc-link-check clean.

The lesson worth keeping: an advisory review's non-findings are worth as much as its verdict. Both
verdicts here were, on inspection, noise — and the one item that mattered was filed under
"observations outside the hard-stop list".

### BILL-13 addendum 4 — least privilege on the free-form payload tables, and owners for the deferrals

The hard-stop review re-ran on `1b7ca20` and confirmed addendum 3 landed: the tenant-composite FK
"correctly prevents one bank citing another bank's approval", audit immutability clean (it correctly
judged the new `ADD CONSTRAINT` additive and non-mutating), PII clean on the statement family, egress
clean, lineage clean. It then returned **FAIL (6)**, and named the pattern behind three of them exactly:
*the irreversible artefact lands in this PR while the control that bounds it lands in a later story, held
only by a SQL comment* — no schema constraint, no test, no gate. That criticism is right, and three of
the six were worth acting on.

1. **The cross-tenant grant is now withheld from the two provider-fed tables.** The controls loop granted
   `SELECT` to `bank_internal_view` on all eight tables, including `billing_tpp_cost_document`
   (`raw_document_ref`, `parsed_payload`) and `billing_tpp_cost_ap_dispatch` (`response_payload`) — the
   three columns this schema cannot constrain and which a Nebras invoice line or P9 response may fill
   with payment-level customer detail. Every *other* table under that policy is schema-constrained and
   PSU-free by construction, which is what makes the governed-aggregate seam an acceptable bypass for
   them; it is not established for unconstrained payloads. Those two are now excluded from both the
   policy and the grant, asserted by a test that reads the live privilege catalogue.
   `billing_tpp_cost_document_line` stays granted — checked, not assumed: it holds only structured
   dimensions with no jsonb column. Withholding costs nothing today because nothing reads either table,
   and whichever story needs the read must grant it deliberately, after redaction exists, rather than
   inherit it from a loop.
2. **The four-eyes CHECK now says only what it can prove, and proves a little more.** The reviewer was
   sharp here: the migration comment claimed self-approval "is refused by the CHECK rather than only by
   the approvals service", which is stronger than `approved_by <> initiated_by` supports — one human
   under two identifier forms satisfies string inequality. The CHECK is now normalised
   (`lower(btrim(...))`), so case and padding variants are refused and a test proves it; the comment
   states the guarantee precisely and names what it cannot see. Closing the rest is a write-time
   obligation, because it depends on what BILL-16 stamps into those columns.
3. **The deferrals have owners now, not comments.** A SQL comment is not a gate, so the obligations moved
   into the acceptance criteria of the stories that must satisfy them: BILL-14 gains a blocking criterion
   for redaction-at-parse-time (with the withheld grant named as its unlock); BILL-16 gains one covering
   all three of its inherited obligations — approved state and unexpired `expires_at` at write time, both
   principals from one normalised P2 claim, and `response_payload` redaction — plus the transition-order
   rule the append-only UNIQUE cannot express. **CODE-03** tickets the repo-wide `scope_used` pass; the
   reviewer's best line was that a repo-wide decision with no owner is how drift survives, and it was
   right that the earlier "wants one pass" reasoning had been recorded without a ticket.

Not changed, with reasons. The dual-domain export finding carries the reviewer's own nuance that
substantially weakens it: `billing_event`, `billing_meter_run` and `billing_metered_line` were **already**
in `EXPORT_TABLES` and carry `payable_hub`/`payable_lfi` rows, so TPP-side data was in that artifact
before this diff — this change labels the crossing rather than creating it, and SEG-01 already records the
call site. The `billing:rate` audit label stays as-is this round now that CODE-03 owns it. And the
free-form columns themselves stay created here: settling the ledger's shape in one reviewed migration was
the deliberate choice, the tables are empty, and the two controls that were missing (the withheld grant
and an owned acceptance criterion) are what this round added.

Re-verified on a pristine database in CI's order: unit 1423/1423 across 211 files; integration **169/169**
across 77 files; Q4.5 PASSED, allowed gaps none; typecheck 0; ESLint clean; doc-link-check clean; the live
privilege catalogue confirms six of eight tables granted to `bank_internal_view`.

### BILL-13 addendum 5 — corrections to my own claims, and the real size of the scope-label drift

Both reviews re-ran on `c578dbe`. Hard-stop went **FAIL (6) → FAIL (4)** and now cites each addendum-4
fix as the reason its earlier findings are mitigated: the withheld grant and its test, the BLOCKING
acceptance criteria on BILL-14/BILL-16, and CODE-03. The cross-tenant `internal_view_select` concern
dropped from a finding to an observation ("verbatim the ratified HOST-02 pattern … not new here, so not
raised"). Contract returned **DRIFT (4)** — two DRIFT, two SPEC DEFECTS — all pre-existing exceptions or
the escalated money-unit decision. The four remaining hard-stop findings are the same created-but-unwritten
deferrals, each flagged uncertain by the reviewer and each now owned by an acceptance criterion.

For the second round running, the genuinely actionable items were in the *observations*, and this time
both were **my own claims being wrong**:

1. **"P9 cannot be double-paid" overstated what the constraint carries.** When addendum 2 converted the
   dispatch table to an append-only state log, the comment kept its old retry-safety claim. But
   `UNIQUE (bank_id, idempotency_key, dispatch_state)` is unique per (key, **state**), not per key: it
   bounds each state to one row per instruction — an instruction cannot be recorded as `dispatched`
   twice — and that is all. It does not by itself make double payment impossible, and it constrains no
   transition order. The comment now says exactly that, and names where the actual guarantee lives
   (BILL-16 dispatching once under the key, plus P9's own idempotency).
2. **CODE-03 understated its own surface by more than half.** I recorded "four call sites, one token".
   Measured against the spec rather than estimated, it is **six undeclared tokens across fourteen
   `scope_used` emissions**: `billing:rate` ×4, `billing:post` ×3, `reconciliation:run` ×3,
   `billing:assure` ×2, `billing:reconcile` ×1, `billing:collect` ×1 — none of which appears anywhere in
   `specs/backoffice-openapi.yaml`, against `billing:read` (10), `billing:write` (4) and
   `platform:operations:read` (8) which do. The ticket now carries that inventory with file:line for each.
   It also carries a scoping fact I checked so the next agent need not: `BILLING_POST_SCOPE` and
   `BILLING_ASSURANCE_SCOPE` are exported constants, which looked like they might gate access — they do
   not. Neither is ever passed to `assertScope` or any middleware; all fourteen are audit values only. So
   no privilege is granted anywhere and this is an audit-trail resolvability defect, not an authorisation
   one. That distinction is what makes it a tidy one-pass fix rather than a security incident.

One further fix from the hard-stop findings themselves. Its third FAIL 5 observed that
`initiated_by`/`approved_by` are **denormalised copies** with nothing binding them to the
`approval_request` row they cite — so the recorded four-eyes evidence could name two people unconnected
to the referenced approval. The reviewer rated its own confidence low (the authoritative
`CHECK (approver IS NULL OR approver <> initiator)` on `approval_request` still blocks self-approval), but
the point about *evidence correspondence* is sound and cannot be expressed as a foreign key. BILL-16's
criterion (b) now requires both columns to equal the cited request's own `initiator`/`approver`.

Not changed: the camelCase-inside-jsonb export exception (pre-existing, ratified in code and build log,
and rewriting keys would break the digest the evidence chain depends on — the reviewer's own recommended
close is a CLAUDE.md carve-out or ADR, i.e. spec-change, not code). The contract reviewer also proposed a
concrete minimum envelope for `GET /back-office/billing/export` — `schema_version`, `bank_id`,
`generated_at`, `record_counts`, `sha256` declared, with `tables` left opaque — which would have made this
class of payload drift contract-detectable at all. That is a genuine spec gap and a good proposal; it is
recorded here rather than actioned, because it is a spec-change PR and not BILL-13's.

Re-verified on a pristine database in CI's order: unit 1423/1423; integration 169/169 across 77 files;
Q4.5 PASSED, allowed gaps none; typecheck 0; ESLint clean; doc-link-check clean.

### BILL-13 addendum 6 — the correction that was only half-applied

Hard-stop re-ran on `f37f323`: **FAIL (5)**, and its own summary is the fair reading — four of the five
are the created-but-unwritten deferrals, each now credited as "carried by a BLOCKING acceptance criterion
rather than prose alone, which is the strongest available mitigation short of not creating the tables
yet". It also confirmed test integrity explicitly, noting the `UnpriceableOverageError` change preserves
existing `rejects.toThrow` assertions and that the new BFF spec guards against the type-vs-message
shortcut.

The fifth finding was a real defect and it was mine, in a way worth recording: **addendum 5 corrected the
"P9 cannot be double-paid" overclaim in the migration comment and explained it at length here — and left
the original false claim standing in the two places a reader reaches first.** The reviewer put it
precisely: "the diff simultaneously ships the correction and leaves the incorrect claim standing in the
backlog outcome, which is the artifact a reader reaches first." Correcting the code comment while the
summary that gets read still asserts a payment-duplication control the schema does not carry is worse
than not having noticed at all.

Fixed in the two places, differently, because they are different kinds of document:

- `docs/backlog.yaml` is current-state metadata, so the claim is corrected outright — uniqueness is per
  (key, state), what that does and does not bound is stated, and the sentence notes that an earlier draft
  overstated it.
- `docs/build-log.md` is append-only history, so the original line stays and carries an inline correction
  block pointing at addendum 5. Silently rewriting a historical entry to make a past claim look right is
  not a fix; annotating it is.

Also closed the loop on the reviewer's final observation: `billing_tpp_cost_document.verified_by` /
`verified_at` are `NOT NULL` but bound to nothing — the same denormalised-evidence weakness as the
AP-dispatch principal columns, on a table BILL-14 owns. BILL-14 now carries a criterion requiring them to
correspond to the principal who actually performed the verified-manual-upload check, stamped from the P2
claim, with verifier ≠ uploader refused.

Re-verified: unit 1423/1423; integration 169/169 across 77 files on a pristine database; Q4.5 PASSED;
typecheck 0; ESLint clean; doc-link-check clean.

The generalisable lesson from rounds 3–6, since it recurred four times: **every actionable defect this
track produced was in a review's "observations" or non-finding notes, never in its verdict.** The verdicts
were dominated by documented deferrals the reviewers themselves rated uncertain. Reading only the
FAIL/PASS line would have missed a resumability bug that would have failed the whole billing projection,
a cross-tenant grant on unconstrained payload columns, and two false claims in the release record.

Contract review on the same head returned **DRIFT (6)** — the two pre-existing exceptions (camelCase
inside exported jsonb, `approval_request_id text` mirroring 0002), the two escalated items (`billing:rate`
now owned by CODE-03, milli-fils), the dual-domain export already routed to SEG-01, and one genuinely new
*forward* obligation worth acting on: nine state and reason vocabularies are hard-committed as CHECK
constraints in an INSERT-only family with no OpenAPI counterpart. The reviewer's framing is right — those
values are expensive to move once rows exist. **BILL-17**, which owns the endpoints that first expose them,
now carries a blocking criterion that its schemas mirror the sets exactly or the spec-change lands first,
never a widened CHECK.

### BILL-13 addendum 7 — first hard-stop PASS, and it found a test that could not fail

Hard-stop on `e582b7a`: **VERDICT PASS** — the first on this track. It recorded seven candidates and
scored none as a violation, six being forward obligations on schema no code writes, each now carried as a
BLOCKING acceptance criterion on the story that owns the write path. Its own summary of the two hard stops
this change could most plausibly have broken is the fair one: audit immutability and PII are "not merely
un-breached but affirmatively tested".

Its one genuine defect (C2) was a **test of mine that could not fail for the reason it claimed**, and it is
the sharpest finding of the whole track:

> the insert supplies `gen_random_uuid()` for both `statement_id` and `reconciliation_id`, neither of which
> exists — so it violates this table's statement and reconciliation foreign keys as well as the approval
> FK. The assertion `rejects.toThrow(/violates foreign key constraint/i)` matches **any** of the three. The
> test therefore passes identically whether or not the tenant-composite approval FK exists at all.

Exactly right. The control was real; the evidence for it was worthless. Worse, it was the test I cited in
addendum 4 as proving the cross-tenant fix.

The obvious repair — create real parents so only the approval FK can fail — turns out to be **wrong here**,
and the reason is worth recording: `billing_tpp_cost_reconciliation` requires a
`billing_tpp_cost_document` row, and writing that table would make the Q4.5 lineage gate demand lineage
BILL-13 does not emit for it, because the gate skips only *empty* tables. The behavioural route would fix
one gate by breaking another. So the assertion now reads the constraint's own definition out of
`pg_constraint`: that the FK is `(bank_id, approval_request_id) REFERENCES approval_request(bank_id,
approval_request_id)`, that **no** FK references the approval by its global id alone, and that
`approval_request` carries the matching `UNIQUE (bank_id, approval_request_id)` without which the composite
FK could not exist.

Proven to discriminate, not assumed: degrading the schema back to the pre-fix single-column FK turns the
new test RED (1 failed / 14 passed) and it passes again on restore. The old assertion would have stayed
green throughout.

The two four-eyes CHECK tests were left as they are, having checked why they are sound where C2 was not:
they assert `/violates check constraint/`, and Postgres evaluates CHECKs during the row insert but FKs as
AFTER-ROW triggers, so the CHECK error is what surfaces. Crucially they fail *safe* — if that order ever
changed, an FK error would not match the assertion and the tests would go red rather than silently pass.

Also this round, from the contract review, a correction to how the money question has been escalated. I had
been describing it as "CLAUDE.md and the spec disagree, pick one". Measured, that is wrong: the spec's own
`Money` schema (`specs/backoffice-openapi.yaml:3028`) states the rule verbatim and cites CLAUDE.md —
"integer minor units", "fils for AED" — so **the spec and CLAUDE.md agree**, and the outliers are two bare
`*_milli_fils` fields at spec:2926-2927 plus the columns migration 0039 adds. A second measured fact
sharpens it further: only `billing_tpp_cost_statement` and `_document` carry a `currency` column at all
(0039:69,156), so the line-level tables hold amounts with no currency and a conformant per-line `Money`
requires joining the parent. Both facts, and the two viable resolutions — convert at the wire boundary and
keep the finer precision in storage only, or ratify milli-fils by amending *both* CLAUDE.md and the `Money`
description — are now recorded on BILL-17, which is the story that cannot ship without the answer.

Re-verified: unit 1423/1423; integration 169/169 across 77 files on a pristine database; Q4.5 PASSED;
typecheck 0; ESLint clean; doc-link-check clean.

### BILL-13 addendum 8 — the same defect class, caught a second time

Contract review on `82956de`: **DRIFT (7)**. Six are previously assessed — the `billing:rate` sites now
owned by CODE-03, the camelCase jsonb exception, `approval_request_id text` mirroring 0002, the frozen
vocabularies owned by BILL-17, and the money-unit question. Its finding 7 was new, and it is the **same
class of defect the hard-stop review caught in C2, on the same PR**:

> `packages/db/test/tenant-billing-service-store.int.spec.ts:196` asserts only
> `recordCounts.billing_event >= 1` … Dropping any of the three new names from `EXPORT_TABLES` would not
> turn a test red.

Correct, and worth stating plainly: BILL-13 claimed a portability guarantee — "a tenant that cannot take
its payable evidence has not been exported" — added three tables to `EXPORT_TABLES` to deliver it, and
asserted it nowhere. Twice on this PR now I added a control, cited it in this log as proof, and left it
without a test that could fail. C2 was the tenant-composite FK; this is the export. The pattern is mine,
not the reviewers': **claiming a control and evidencing a control are separate steps, and I was treating
the first as if it discharged the second.**

Fixed with a behavioural test that persists a statement and asserts it actually appears in
`portableExport` — by `recordCounts` for the statement and line tables, and by finding the specific
statement id in the payload rather than trusting a count. It also asserts the two withheld provider-payload
tables stay *out* of the export, so the narrowing from addendum 4 is evidenced too. Proven to discriminate:
removing the payable tables from `EXPORT_TABLES` turns it red (1 failed / 15 passed), green on restore.

Also from this review, its finding 3, which it verified rather than assumed: `CHECK (currency = 'AED')` is
narrower than the contract's `Money.currency` (`^[A-Z]{3}$`), and 0039 is the **first** place in the schema
where a currency *value* is pinned — every earlier migration constrains only null-coupling. The reviewer's
ask was that the narrowing be "a decision rather than an inheritance", which is fair, so the migration now
records the reasoning: every UAE Open Finance fee is AED-denominated, a non-AED payable row would mean a
parsing or mapping defect, and in an INSERT-only family with no deletion path it is far better refused at
write time than stored unremovably. Relaxing the CHECK later is an additive migration; un-storing a
mis-denominated row is not.

Re-verified on a pristine database: unit 1423/1423; integration **170/170** across 77 files; Q4.5 PASSED,
allowed gaps none; typecheck 0; ESLint clean; doc-link-check clean.

### BILL-13 addendum 9 — two precise details, both handed to the story that will hit them

Contract review on `bad2946`: **DRIFT (7)**, confirming addendum 8's export test and the AED reasoning
landed. Five findings are previously assessed and unchanged in disposition. Two carried detail worth
recording, neither a code defect:

1. **On `_rerating`, "join the parent for currency" has no single answer.** Addendum 7 recorded that four
   tables hold amounts with no `currency` column, so a conformant per-line `Money` needs a parent join.
   The reviewer noticed what that recording missed: `billing_tpp_cost_rerating` carries **two** statement
   foreign keys (`previous_statement_id`, `corrected_statement_id`, 0039:371-372), so "the parent" is not
   singular there and BILL-17 must decide which denominates a delta rather than assume one exists. Added
   to its criterion.
2. **`response_status` is the same defect class as `scope_used`, and gets the same treatment.** The two
   emissions stamp `response_status: 200` from a scheduled monthly job that issues no HTTP response, and
   the reviewer is right that `:122` is wrong on its own terms — it stamps 200 on the path that reports a
   *skip*. Checked before deciding: 20 `response_status` occurrences exist across
   `services/bff/src/billing` with mixed values, so this is a repo-wide pattern, and
   `AuditEvent.response_status` is an unconstrained integer with no description — the contract does not
   say what a non-HTTP actor should record. Fixing only these two would recreate exactly the
   inconsistency that made half-fixing `billing:rate` the wrong call. So CODE-03 now owns both fields, to
   be settled in one pass with the options named (omit, sentinel, or an explicit outcome field).

Not changed, and stated once so it is not re-litigated: the nine frozen vocabularies, the camelCase jsonb
exception, the milli-fils unit, and the AED narrowing all keep the dispositions recorded in addenda 4–8.
The reviewer agrees with each framing and reports them, correctly, so the pre-commitment is on the record
at the point it happened rather than discovered at BILL-17.

Verified: unit 1423/1423; integration 170/170 across 77 files on a pristine database; Q4.5 PASSED;
typecheck 0; ESLint clean; doc-link-check clean.

### BILL-13 addendum 10 — the PII guard did not guard, which is the third of these

Hard-stop on `bad2946`: FAIL (6), five of them the documented deferrals with unchanged dispositions. The
sixth is the important one, and it is the **third vacuous-assertion defect this PR has produced**:

> The test carrying the "zero PSU data in the cost ledger" claim asserts it with
> `expect(serialised).not.toMatch(/psu/i)` against a fixture whose PSU identifier is literally
> `psu-<uuid>`, so the assertion passes on the substring the fixture was named with rather than on the
> property.

Right, and it is the worst-placed of the three: the PSU claim is a **regulatory hard stop**, and the
migration header (`:19-22`) leans on "asserted by test" as its mitigation. A production-shaped identifier —
an opaque uuid, an IBAN, an Emirates ID — would have satisfied `/psu/i` while sitting in
`statement_payload`. The reviewer also did the right thing before reporting: it verified the underlying
claim structurally (no PSU field on `ExpectedTppCostStatement`, `psuId` dropped rather than spread at
aggregation, no PSU column in any of the eight tables) and reported only the guard, not the property.

Fixed by making the fixture's identifier an **opaque uuid with no `psu` substring** and asserting the
absence of that specific VALUE, so the test depends on the property rather than on the naming. The
`/psu/i` check is kept alongside it — it still catches the distinct failure of leaking the field *name* —
and the assertion that event ids ARE present is kept too, so the absence is a real exclusion rather than
an empty payload. Proven to discriminate by injecting the exact regression it exists to catch (leaking the
identifier into the persisted payload): the PSU test turns red, and green again once reverted.

**Three for three, and the pattern is the finding.** C2 was the tenant-composite FK, addendum 8 was the
portable export, this is the PSU guard. In each case the control was real and the *evidence* was not, and
in each case I had cited the test in this log as proof the control worked. Writing a control and evidencing
a control are separate steps; on this story I repeatedly treated the first as discharging the second, and
only an adversarial reader caught it — three times, on three different controls. The lesson for the next
ledger story is procedural, not technical: for every control claimed in a build-log entry, break it
deliberately and watch the test fail before writing the claim down.

Two details from the contract review on the same head were also recorded (addendum 9): the `_rerating`
two-parent ambiguity for per-line currency, and `response_status` folded into CODE-03 as the same class of
HTTP-shaped-field-on-a-headless-emitter defect as `scope_used`.

Verified on a pristine database: unit 1423/1423; integration 170/170 across 77 files; Q4.5 PASSED, allowed
gaps none; typecheck 0; ESLint clean; doc-link-check clean.

### BILL-13 addendum 11 — the third home of the double-paid claim, and the most-read one

Gating CI is green on `9fb2db1` and on every prior head of this branch. Both advisory reviews report
failure, which is non-gating (ADR 0029); their check-runs endpoint returned 403 and issue comments 404 on
this attempt, so their bodies were not retrievable — not guessed at either.

While confirming the PR state, the **PR description** turned out to still assert "AP dispatch is unique per
idempotency key so P9 cannot be double-paid". Addendum 6 corrected that claim in `docs/backlog.yaml` and
annotated it in this log, because the review named those two locations. Nobody named the third, and it is
the one a reviewer reads first. Its evidence block was also stale — 1421 unit / 162 integration, from
before six rounds of fixes.

Fourth instance of the same pattern, and the cleanest illustration of it: a correction is not applied until
it is applied *everywhere the claim appears*, and searching for the claim beats waiting to be told where it
lives. The description now states what the constraint actually carries, records what the review rounds
changed and why, carries the current evidence (unit 1423/1423, integration 170/170, Q4.5 PASSED), and names
the two decisions that need a human rather than implying they are settled.

No code changed in this addendum.

### BILL-13 addendum 12 — one reviewer claim corrected, one gap the reviewer missed

Contract review on the docs-only head: **DRIFT (12)**. Ten are dispositioned in addenda 4–11. Two were
new, and checking them produced a correction in each direction.

**DRIFT 10, partly wrong, and the code says so.** It reported `fee_class`, `product_family` and
`api_family` as unconstrained `text` "while the domain types are closed unions". True for one of the
three. `TppCostProductFamily` is a closed six-value union — but `apiFamily` is typed plain `string`
(`apiFamilyForEndpoint` derives it from endpoint shape, not a fixed set), and `fee_class` is an open
vocabulary the contract itself declares as an unconstrained string. CHECK-constraining either would refuse
legitimate values the first time the scheme adds an endpoint family. So only `product_family` got a CHECK —
and it earns one, being part of line identity under a UNIQUE key in a ledger with no UPDATE path, where a
projection bug inventing a family would corrupt identity irrecoverably. The migration now states which of
the three are constrained and why the other two are not, so the asymmetry reads as a decision.

**DRIFT 7, right, and it led to something the reviewer did not see.** The payable diff line carries a
ten-value `break_type` and a `reconciliation_break_id`, with the migration claiming "the payable side
reuses that workflow" — while `GET /back-office/reconciliation/breaks` classifies by `LineType` (six
values) and declares no `break_type`. Nothing maps one onto the other. Following that up surfaced a gap the
review did not report: **`reconciliation_break_id` carries no foreign key at all**, so a payable diff line
could cite a break that does not exist.

I did not add the FK, and the reasoning matters because it differs from the `approval_request` case in
addendum 4 where I did. There, the FK already existed and the fix was to widen it to a tenant-composite key
against an existing global UNIQUE — a one-line tightening. Here there is no FK and no
`UNIQUE (bank_id, id)` on `reconciliation_break` to reference, so adding one means altering an E1 table and
deciding `ON DELETE` semantics for a regulated record, on a column BILL-15 writes and whose break-mapping
question BILL-15 must settle first. Doing that as a drive-by in a payable story would be inventing E1
design. So it is a BLOCKING criterion on BILL-15 — mapping, FK, and the `variance_amount` `Money`-vs-bare
`milli_fils` shape — and the migration says the column is unconstrained pending that and must not be
written. Explicit deferral, not an oversight.

Infrastructure note, since it affected this round's verification: PostgreSQL died mid-session for the second
time and the restarted cluster came up on a different data directory with password auth, so the scratch
databases were gone. Rebuilt on `postgres:postgres@localhost` — which matches CI's own connection string —
rather than editing `pg_hba.conf`, an action the harness correctly refused.

Verified after the change, on a database built from scratch: the CHECK is present in the applied schema;
unit 1423/1423; integration 170/170 across 77 files; Q4.5 PASSED, allowed gaps none; typecheck 0; ESLint
clean; doc-link-check clean.

### BILL-13 addendum 13 — the code was citing CLAUDE.md as authority for departing from CLAUDE.md

Contract review on `8df9cc0` confirms the `product_family` CHECK and the BILL-15 criterion landed;
its eleven findings are the dispositioned set. One aside was not, and it is a defect of mine:

> `packages/billing/src/tpp-cost.ts:80` documents the milli-fils unit as "(CLAUDE.md money convention)".
> CLAUDE.md does not state that convention; the comment mis-cites it.

Correct, and it is the mechanism behind something the same reviewer noted a round earlier — that the
milli-fils choice "looks sanctioned when it is not". The comment cited the very document that says the
opposite (integer minor units, "fils for AED") as the *source* of the deviation. I wrote that line in
BILL-12, and it has been sitting on `main` asserting a settled position on the question I have been
escalating as open in every report since.

Fixed here rather than deferred to "whenever the decision lands", because the mis-citation is a factual
error independent of the decision: the comment now states that milli-fils deviates and is unratified, why
it was chosen (ADR 0007 prices tariffs at 2.5 and 0.5 fils, which minor units cannot hold without rounding
the payable), that the earlier citation was wrong, and that BILL-17 owns the resolution. No behaviour
changes — it is a comment — and correcting it does not pre-judge the decision either way. Grepped for
other authority claims of the same shape: none.

This touches a file outside the story's diff, which is deliberate and worth justifying: leaving a false
claim of authority on `main` while asking a human to decide the same question would undermine the
escalation. One comment line, in the story that surfaced it.

Verified: typecheck 0; unit 1423/1423; ESLint clean.

### BILL-13 addendum 14 — a review reopened a cleared finding, and it was right to

Hard-stop on `7f70892`: FAIL (8). It confirms this branch's fixes landed — it now credits the PSU test
for asserting "both the absent identifier *value* and the absent `psu` key shape", and notes the diff
"only corrects a comment that had wrongly cited CLAUDE.md as the unit's source". Seven findings are the
dispositioned deferrals, each flagged uncertain.

The eighth is one **earlier rounds explicitly cleared**: the `internal_view_select` policy is fail-OPEN
when `app.tenant_group` is unset — a session holding `bank_internal_view` with nothing pinned reads every
tenant's rows. Round 6 dismissed it as "verbatim the ratified HOST-02 / ADR 0028 pattern … not new here,
so not raised". Both readings are factually right, and the later one is more useful: the idiom is
pre-existing AND this story widens what it covers.

Verified before acting, and it produced a correction in the reviewer's favour and one against it:

- **The fail-open branch is real.** `NULLIF(current_setting('app.tenant_group', true), '') IS NULL OR
  bank_id IN (…)` passes all rows when unset. It is deliberate single-tenant backward compatibility per
  ADR 0028, reachable only through `runGovernedAggregate` behind a registered, approved purpose with a
  High-class-logged bypass — a hardening item, not a live breach.
- **The blast radius is six tables, not the eight claimed.** 0039's loop excludes
  `billing_tpp_cost_document` and `billing_tpp_cost_ap_dispatch`. Those are exactly the two provider-fed
  payload tables the same review flags under FAIL 3 as potential PSU sinks — so the withheld grant from
  addendum 4 already puts the riskiest two outside the cross-tenant read. The review's own two findings
  intersect where the story had already closed the gap.

What I did *not* do is change the policy. Deviating in one migration would leave nine policies disagreeing
about what an unpinned session means, which is worse than a consistent known weakness. What was actually
missing is an owner: ADR 0028's Consequences records the fix verbatim as a "marked follow-up", its
prerequisite HOST-02 is `done`, and **no backlog item owned it**. So **HOST-04** now does, carrying the
measured surface (the idiom appears in nine migrations — 0030 defines it, 0031-0037 and 0039 use it), the
six-not-eight correction, the requirement that the fix be one pass over the shared idiom rather than
per-migration patches, and the open question it needs answered: whether unpinned should deny all rows or
resolve an explicit default group, since the demo profile currently depends on the fallback.

Its acceptance criteria include the anti-vacuous test this story learned to insist on the hard way — prove
fail-closed directly, and prove the test fails if the fallback clause is restored.

No code changed. Backlog and build log only.

## 2026-08-17 — BILL-14: provider-document ingestion (Nebras-primary taxonomy)

The payable actuals. `POST /back-office/billing/tpp-cost-documents` added **spec-first** (93 → 94 paths,
client regenerated), then failing tests, then code — the parser tests were confirmed red 14/14 before the
module existed.

**Parsing behind an adapter.** `TppCostDocumentParser` is the seam; the Nebras tax-invoice parser is the
one implementation, so a PDF/EDI/API transport can be added without touching the ingest service. VAT is
split by **stream**, not by document (ADR 0007 D4): Hub sections are VAT-exclusive so 5% is added to the
stated net, underlying-LFI sections are VAT-inclusive so 5/105 is carved out of the stated gross. Gross is
always computed as net + vat rather than net × 1.05, so the three reconcile exactly under half-up rounding
at every amount — asserted across a range, not one example. Document totals are **derived from the lines**
and then checked against the provider's own; a disagreement is refused, because "trust the header" and
"trust the lines" are both wrong when they conflict.

**A deliberately partial category map.** Five categories map to fee classes we already price. Four are
knowingly unmapped: `Balance (Discounted)` and `CoP (Discounted)` because the IG §10.9 sample carries a
unit anomaly (0.25 vs 0.005) that BD-20 must resolve on a real invoice, and `Payment Data` and
`Setup and Consent` because no current fee class corresponds without inventing scheme semantics. Mapping
them now would silently mis-state the payable; flagging them cannot. Unmapped lines persist with
`mapped: false` and `fee_class NULL`, which the schema CHECK ties together. The map is versioned data with
a cited source, so a correction is config, not a release.

### The redaction control, and two bugs the double-check caught

Criterion 5 was the load-bearing one: these tables are INSERT-only with no deletion path, so customer
detail must be removed **before** the first INSERT. Redaction keys on field NAMES and on identifier
SHAPES — and the shape choice matters more than it looks. The repo's PII guard refuses real-shaped
fixtures, forcing synthetic forms (national-identifier prefix 999, IBAN bank code 000). That pushed the
redactor to match `\d{3}-\d{4}-\d{7}-\d` and `AE` + 21 digits **structurally** rather than by prefix or
bank code — which is precisely what makes it catch a real value it has never been shown. A hook that
looked like an obstacle produced a better control.

The parser redacts and has no accessor for the raw payload; the store re-checks at the boundary that makes
a write permanent. That second check found two defects that no review had to:

1. **Redaction was not idempotent.** Replacing a PSU-named field keeps its key, so re-running the redactor
   flagged the same keys again — and the boundary check reads "reported something" as "never redacted". It
   rejected correct writes. Already-redacted values are now left alone and not re-reported, and idempotence
   is its own test, because a control depending on a property should assert that property.
2. **Two patterns were eating the invoice TRNs.** A generic long-digit-run rule and an unanchored phone
   pattern both matched a 15-digit UAE TRN (`100123456700003` contains `00` followed by twelve digits). TRNs
   are **required** header evidence under IG §10.9, so redaction was destroying a mandatory field and
   inflating the count an auditor reads. The digit-run rule is gone and the phone prefix is anchored so it
   cannot match inside a longer number. The residual risk — an account number under a key the list does not
   recognise — is now stated in the code with where the fix belongs, rather than papered over by a heuristic
   that destroys required evidence.

**Migration 0040 grants what BILL-13 withheld.** The cross-tenant internal-view read on
`billing_tpp_cost_document` was deliberately held back until redaction existed; it is now granted, and
BILL-13's own test was narrowed from a frozen table list to the *condition* (redaction proven), so it still
fails if `ap_dispatch` — whose `response_payload` is P9's, with no redaction until BILL-16 — ever inherits
a grant it has not earned.

**Second-person verification, claimed accurately.** `verified_by` is checked against the caller's verified
P2 subject claim and an upload nominating its own uploader is refused (409), normalised so one human under
two spellings cannot pass as two people. What that proves is **distinctness**, not that the verifier
authenticated — a request carries one credential — and the code says so, pointing at four-eyes (202 +
`approval_request`) as where the stronger control lives. Given how often this track has been caught
over-claiming a control, the comment matters as much as the check.

**The absence alarm** anchors on the 5th of the month following the period, moving off a weekend only —
public holidays are an institution calendar the Back Office does not own, so it errs late rather than
alarming on a day the Hub was never obliged to deliver. It fires only once the anchor has passed, and a
credit note does not count as an invoice. IG §10.12.2 makes reporting non-receipt the participant's own
obligation, which is what makes this a compliance control rather than a convenience.

**Gates:** unit 1455/1455; integration 179/179 across 78 files on a pristine PostgreSQL 16.13; Q4.5 PASSED
with `billing_tpp_cost_document` and `_document_line` now covered, allowed gaps none; typecheck 0; ESLint
clean; Q1b no weakening detected. `docs:check` earned its keep — the anti-drift gate caught the README's
stale "93 paths" the moment the spec grew.

**Still open, and inherited rather than introduced:** the directory `OverLimitFees` unit is still
unconfirmed because the egress policy continues to deny `data.directory.openfinance.ae` (rating stays
fail-closed), and BD-20 still needs the first real Nebras invoice — which is also what resolves the four
unmapped categories. Both now carry to BILL-15.

### BILL-14 addendum — the redactor covered the payload and not the columns beside it

Both advisory reviews ran on the first push. The hard-stop reviewer found the one that mattered, and it
is the **fourth** instance of this track's recurring pattern — a control claimed more broadly than it was
built:

> `redactProviderPayload` is applied to exactly one thing: the JSON blob. The per-line fields are read
> straight off the provider document and copied verbatim … The module header says "there is no code path
> that yields the raw one" — true of `payload`, not true of the columns beside it.

Exactly right, and worse than it first looks: `line_ref`, `source_category`, `cost_recipient_id`, the
document reference, the issuer/recipient ids and the TRNs all bypassed the redactor into structured
columns — and `billing_tpp_cost_document_line` was *already* cross-tenant readable from 0039's loop.

**Refused rather than redacted, and the distinction is the fix.** Redaction cannot apply to these fields:
`line_ref` is part of a UNIQUE key and `source_category` is the evidence a fee-class mapping derives
from, so a marker would destroy identity rather than protect anyone. `assertIdentifierFieldsClean` now
refuses the whole document when any of them carries a customer-detail shape — in a family with no
deletion path, rejecting an upload beats storing something unremovable. Tested per field, header and
line, plus a test that the refusal message does not itself echo the offending value (it crosses the API
boundary as a 422).

Also from the hard-stop review: **the archive ran before validation**, so a document later refused as a
conflict had already had its raw bytes retained. Archiving now happens only after every refusal has
passed, and the obligations the interface cannot enforce — tenant scoping, matching retention,
classification floor, no cross-tenant read — are written at the call site. Provider values were also
being interpolated into parse-error messages that cross the API boundary; those now name the field and
say the value is deliberately not echoed.

The contract review found six more real ones, three of them defects rather than drift:

1. **A reused `Idempotency-Key` raised a bare 23505 → 500.** The table carries `UNIQUE (bank_id,
   idempotency_key)` as well as the issuer/reference key, and `saveDocument` handled only the second —
   while its own doc comment claimed idempotency on the first. Same claim-without-evidence shape. Both
   keys are now honoured: same key + same document replays, same key + different document conflicts.
2. **The response omitted the four fields that ARE the verified-upload evidence** — `document_sha256`,
   `received_at`, `verified_by`, `verified_at`. All four were computed and then dropped, so the caller
   could not verify the integrity hash or the second-person record it had just supplied.
3. **`source_note` was accepted and silently discarded.** There is no column for it, so it is now
   recorded in the INSERT-only audit trail, which is where "email received 3 Jul, from …" provenance
   belongs anyway.
4. **`issued_at` was any non-empty string** while the contract declares `format: date-time`; Postgres
   would accept "3 July 2026" and the response would echo it. Now RFC 3339 or refused.
5. **Neither response schema declared `required`**, which is precisely why (2) was invisible to
   validation. Both now do — 18 fields on `TppCostDocument` — so that class of omission fails a
   validator instead of shipping.
6. **Five of six `document_type` values always 400** because only the Nebras invoice has a transport
   wired. The spec now says so on the field rather than advertising a taxonomy that half-rejects.

And the gap behind all of it: **no test exercised the HTTP route.** The service was tested directly, so
the envelope, the 201/200 selection, the error mapping and the wire shape were unasserted —
`verify:contract` cannot help, it probes only parameter-less GETs. Six route-level tests through
`createApp` now bind them, including that a same-document re-upload under a new key returns 200 rather
than 201, and that every response key is snake_case.

Re-verified on a pristine database: unit **1464/1464**; integration **180/180** across 78 files; Q4.5
PASSED, allowed gaps none; typecheck 0; ESLint clean; doc-link-check clean; Q1b **5 changed test files, no
weakening detected**.

Left as recorded rather than fixed: `x-rate-limit-per-min` is unenforced repo-wide (inherited, not this
story's), the 409 response declares no `content` (precedent runs both ways in the same file), and the
milli-fils unit question — now seven more fields deep — which is still the human decision BILL-17 blocks
on. PostgreSQL also died four times during this story; each time it was restarted and the run repeated
from a pristine database rather than reported around.

### BILL-14 addendum 2 — an unvalidated enum, and a replay reporting evidence that matched no row

Second contract review: **DRIFT (10)**. Six were real, four of those defects rather than drift.

**An unchecked cast on a contract-declared enum.** `cost_recipient_type` was
`section.cost_recipient_type as CostRecipientType` — a TypeScript cast over parsed provider JSON, with
no validation. Every other provider-supplied discriminator in the parser *is* checked (`vat_treatment`,
`currency`, `document_type` at the service), so this one was the outlier. A section saying
`"third_party"` either reached the wire in a closed-enum field, or hit the column CHECK as an unmapped
5xx instead of the 422 every other malformed field gets. Now validated, refused with the same 422.

**A replay reported evidence that matched no stored row — the subtle one.** On the `200`
already-ingested path the service returned *this request's* `document_sha256`, `received_at`,
`verified_by` and `verified_at`. That looks harmless until you notice what dedupe keys on:
`evidence_hash` is computed over commercial substance — reference, issuer, period, totals, lines — and
deliberately **not** over the raw bytes, because two byte-different files stating the same charges are
the same document. So a file differing only in JSON key order, whitespace or `due_at` takes the `200`
path, and the response then hands back an integrity hash matching nothing in the ledger, breaking
exactly the reconciliation the field exists for. The root cause was at the seam: the store interface
returned only `{ id, documentReference }`, discarding evidence `saveDocument` had already read back. It
now returns the stored values, and the service reports those on a replay.

**My own YAML bug, emitted into a published artifact.** The `409` description used a folded scalar whose
text began and ended with `'`. In a folded block those are not YAML quoting — they became part of the
string and were carried verbatim into the generated client. Fixed, and while there the `409` gained the
`ErrorEnvelope` `content` block it was missing (the implementation returns a body; the spec typed it
`content?: never`, so a generated client could not see the error it actually receives) and a description
naming the **third** cause the implementation added — idempotency-key reuse — which the contract had
never documented.

Recorded, not actioned: `x-rate-limit-per-min` is unenforced repo-wide (inherited); `source_note` is not
recorded on the `200` path, which is defensible since the contract promises it no durability; and the
path sits under the LFI-billing section banner while tagged `tpp-billing` — cosmetic, flagged twice now,
and worth a tidy when the spec is next reorganised.

Re-verified on a pristine database: unit **1464/1464**; integration **180/180**; Q4.5 PASSED; typecheck
0; ESLint clean. PostgreSQL died a fifth time mid-verification and was restarted before the run was
repeated — noted because five crashes in one story is an environment signal, not a code one.

## 2026-08-17 — BILL-15: three-way payable reconciliation + dispute-window management

Own metering ↔ expected statement ↔ provider document. The comparison itself is a pure function in
`packages/billing/src/tpp-cost-reconciliation.ts` — no clock, no store, no I/O, every timestamp
arriving on the input — so a reconciliation is reproducible from its inputs alone. That mattered
immediately: three of this story's defects were only findable because the function could be probed
directly.

**Matching.** At the `(costRecipientType, costRecipientId, feeClass)` grain under a configurable
tolerance defaulting to `fils(1)`. Expectations are milli-fils and documents state fils, so exact
equality is never the test and the tolerance is what makes a match mean anything. Variance class is
decided in a deliberate precedence — units, then net, then VAT. Units first because a volume
difference is settled against metering and a rate argument built on the wrong volume wastes the
§10.13 window; VAT last because it is the residual once net agrees, a treatment error rather than a
pricing dispute, and it goes to a different desk.

**One difference, one break.** An expectation and a document line disagreeing on the counterparty
produce a single `wrong_recipient`, not a missing charge plus an unexpected one — two half-truths
would open two queries against two counterparties for a single charge and neither would be
answerable. The pairing REFUSES when two document lines share the fee class: nothing in the evidence
says which one our expectation meant, and a guessed pairing names the wrong counterparty in the query.

`duplicate_charge` is detected across documents only. Within one document a provider may legitimately
split a category over several rows, so those aggregate; the same charge on the Nebras invoice and an
LFI self-invoice is a different claim, because the Nebras invoice reconciles both cost components
(IG §10.2).

`unmatched_expected_line` earns its place in the taxonomy by distinguishing our mapping gap from
their omission: a fee class the Hub could never name on an invoice is not a missing charge and must
not be queried with them. It is fixed by extending the category map, not by writing to Nebras.

**Three defects I found in my own first implementation**, each now pinned by a test proven to fail
without the fix:

- An **off-period document anchored the query deadline a month early**. A 2026-05 invoice issued in
  June dragged the 2026-06 deadline from 2026-08-02 back to 2026-07-03. My own comment had warned
  about overstating the time remaining; this understated it, which is just as wrong — abandoning a
  live query early loses the same right as missing a dead one.
- A **duplicated charge reported a net variance of zero**. `actualTotalNetMilliFils` was accumulated
  only on the matched, wrong-recipient and unexpected paths, so an invoice pair over-billing us by a
  full line showed no exposure on the one number BILL-16 decides what to pay from.
- The **wrong-recipient pairing guessed** via `.find()` among several candidates.

**Criterion 6(a) — `break_type` → `LineType`.** The line class follows the cost RECIPIENT, not the
break class: `line_type` names which stream a break belongs to, and a rate variance is the same kind
of line whether over- or under-rated. IG §10.2's two payable components map one-to-one — Hub fees to
`nebras_fees`, underlying-LFI API access to `lfi_access_log`. `payment_settlement` is deliberately
unused because it means money movement, not fee liability. That leaves `breakType` as a guard rather
than a routing input, and it is used as one: it validates against the frozen ten-value taxonomy and
throws, so an eleventh break class added without revisiting this mapping fails loudly instead of
being silently filed as a Hub fee.

**Criterion 6(b) — the deferred foreign key**, landed as migration `0041`. `UNIQUE (bank_id, id)` on
`reconciliation_break` (additive; `id` is already the primary key, so it constrains nothing new and
exists only to give the composite FK a target) plus the tenant-composite FK BILL-13 deferred.
`ON DELETE` is deliberately absent — NO ACTION, meaning a delete of a referenced break is refused.
For a table with a 5-year immutable retention obligation the alternatives are both wrong: CASCADE
would let one delete propagate into the payables ledger, and SET NULL would sever the link between a
payable variance and the break it was raised as while reporting success. `MATCH SIMPLE` is
load-bearing and easy to misread: the nullable break id keeps the reference optional, and the FK is
enforced in full only when it is set.

**Criterion 5 — the billing-query bundle** refuses three ways, and refusal is the point since the
bundle crosses the bank boundary through P6. A missing §10.11.3 field produces a query Nebras rejects
for incompleteness and the days it consumed do not come back. A closed window means asserting a claim
we no longer hold. Identifier-shaped `transactionDetail` would export PSU data to the scheme —
§10.11.3 asks for "payment/transaction detail" and the tempting reading is to attach the payment, so
the guard reuses BILL-14's `assertIdentifierFieldsClean` rather than adding a second redaction path.
A test pins that the refusal does not eat the invoice number and interaction id the query is useless
without.

**Not done, stated plainly.** Criterion 3 is half-built: `openPayableBreaks()` is the gate query and
is tested tenant-scoped over a real database, but the refusal it feeds lives in BILL-16, so the
end-to-end blocked path cannot be tested until BILL-16 lands. Criterion 6(c) remains BLOCKED on the
money-unit decision — `ReconciliationBreak.variance_amount` is a `Money` object while
`billing_tpp_cost_diff_line` stores `variance_milli_fils` bare, and reconciling those shapes needs
the answer BILL-17 owns. No Money-shaped variance is written in the meantime.

Contract: `POST /back-office/billing/tpp-cost-documents/{document_id}:reconcile` added spec-first
(94 → 95 paths) on `finance:reconciliation:write`, mirroring `billing-records:reconcile` because
judging a counterparty's figures against our own is one capability regardless of which way the money
flows. It runs synchronously rather than returning 202 like its receivable twin: it compares stored
evidence rather than fetching from the Hub, so there is nothing to wait on. A route test was written
alongside the service tests — a `:reconcile` suffix on a path parameter is exactly the shape a router
silently fails to match, and `pnpm verify:contract` probes only parameter-less GETs.

Verified on a pristine database: unit **1512/1512**; integration **187/187** across 79 files; Q4.5
**PASSED** with `billing_tpp_cost_reconciliation` and `billing_tpp_cost_diff_line` now covered;
typecheck 0; ESLint clean.

## 2026-08-17 — BILL-15 addendum: both reviewers, five fixes (same PR)

Hard-stop **PASS**, no violations. Contract review **DRIFT** with three findings. Every fix below came
from a reviewer's finding or non-blocking observation — none from the gates, which were green
throughout. That is now the consistent pattern across BILL-13, BILL-14 and BILL-15.

**The sharpest finding: this diff made the milli-fils deviation worse rather than inheriting it.**
`TppCostReconciliation` published eight money-valued fields with no ISO 4217 anywhere, while the
sibling `TppCostDocument` — my own BILL-14 schema — lists `currency` as *required* beside its
milli-fils amounts. Adjacent schemas in one story family, opposite treatment. The currency was in hand
at the wire function and simply not emitted, so this was not a case of storage lacking the data. And
the deferral recorded on BILL-15 covers what diff lines *store*; publishing a currency-less **wire
contract** went past what was deferred and would have made BILL-17's "convert to `Money` at the
boundary" option strictly more expensive. Currency now flows through the domain result and is required
on the schema. That decides nothing about the unit — it stops the amounts being bare integers.

Relatedly, the new fields lacked the `(see BILL-17 — the unit is unratified)` marker BILL-14 puts on
`unit_price_milli_fils`, and `tolerance_milli_fils` described milli-fils affirmatively as settled
convention — the reverse of the status the backlog records. Marker added throughout.

**One hardcoded remediation for every error.** The route returned "ingest the period's expected
statement (BILL-12)" for the 404 and the 401 as well as the 409. The contract defines `remediation` as
what the caller can do to *resolve* the error, and telling someone whose document id does not exist to
ingest a statement sends them to fix something that is not broken. The error now carries its own. My
route test had asserted only that the field was **present** — the claiming-vs-evidencing gap again —
so it now asserts the remediation fits its error, and that the 404's does *not* mention the statement.

**Two on the billing-query bundle**, from the hard-stop reviewer's non-blocking notes. This is the one
artefact in the story that crosses the bank boundary toward Nebras, so both were worth taking:

- Only `transactionDetail` was screened. `reasonCode` is the one that matters — an unmapped line's
  reason code embeds the provider's own `sourceCategory`, so provider-supplied text does reach the
  wire. BILL-14 already refuses an identifier-shaped category at ingest, which *is* the right boundary,
  but that left this artefact depending on an invariant established two stories away. Every text field
  is now screened at the point of departure.
- Non-string values were skipped, justified in my own comment as "a number cannot carry an identifier
  shape". True of today's four shapes, not of numbers — a future digit-only rule would be bypassed by
  the one type that carries digits. Values are coerced before screening.

The test for that last change is labelled for what it actually proves rather than what it suggests: no
shape in the current list can match a bare number, so nothing can demonstrate that screen firing. It is
a regression guard that widening the screen did not start refusing the amounts every bundle carries,
and it says so.

Re-verified on a pristine database: unit **1515/1515**; integration **187/187** across 79 files;
typecheck 0; ESLint clean; Q1b "6 changed test files — no weakening detected"; doc-link-check clean.

CI could not run on either #320 or #321: every job completes 3–6 seconds after starting with
`runner_id: 0`, an empty `runner_name` and no `steps` array. That is a GitHub Actions runner-allocation
failure, verified by fetching the job records rather than inferred from the failure count.

---

## 2026-08-18 — STD: UAE Open Finance standards-conformance review (docs-only; 14 stories filed)

A conformance diff of the repo against the current scheme baseline — Standards v2.1-final +
errata3, API Hub v8 (releases 2026.19.0 and 2026.22.0), Nebras Interaction Guide v5.0 (Jun 2026),
the Limitation of Liability Model v2.1, and the Ozone Connect availability/response-time/data-quality
policies. No source changed; the output is `docs/reviews/standards-conformance-2026-08.md`, ADR 0030,
a new STANDARDS block of STD-01..STD-14 in the backlog (laid out in EXECUTION order, not id order,
because next-story picks by file position), an as-built note on ADR 0010, the one-word P10 citation
fix in `CLAUDE.md` (ADR 0022 -> ADR 0010), and PRD repairs — the §6 API-surface table rebuilt with
verified per-tag counts and real scope strings, §7.6 re-attributed to IG v5.0, BD-16 updated, and the
BACKOFFICE-01 CoP bundling-window hedge retired.

METHOD. Every claim was produced by one pass and then re-verified by a second, adversarial pass that
opened the file and read the lines, with instructions to try to refute rather than confirm. 45 claims
were tested: 33 CONFIRMED, 11 CORRECTED, 1 REFUTED. The finished documents were then put through a
second, five-way critique against the tree, which returned FIX_FIRST from all five and corrected nine
further defects — three of them in the review's own §2, where the MECHANISM was wrong rather than the
citation: the liability lookup does not go silent (it emits an AED 0 signal), the fail-closed breach is
not confined to the console (eight sites), and the bulk-revoke count never reaches the second approver
at all. A tenth correction reordered the backlog block, because file position — not the comment
claiming an order — is what next-story actually obeys. The corrections were material and are the reason
the passes were run — the ADR-0022 mis-citation is in EIGHT sites, not the four first found; the
respondent-clock constants are at `respondent-disputes/service.ts:31-34`, not 30-36; the case-id
collision is conditional on an omitted optional field rather than unconditional; `slo.ts` has no
default-target constant at all. Line numbers in the review are as at c5ba31b.

THE HEADLINE IS NOT DRIFT. The architecture is conformant and that is the hard part: consent
source-of-truth stays in the Hub with the local record a mirror, P6 is the only egress for Nebras API
Hub traffic (the documentation-mirror fetches in the rate-card watcher sit outside it — that is the
open ruling below), the
LFI backend is called Ozone Connect and never a resource server, there is no AML GO client anywhere,
the 7-state consent enum is byte-exact, and the liability matrix and rate card match the published
schedules. What is missing is a mechanism that NOTICES when the scheme moves.

THE PROOF OF THAT, exactly. Interaction Guide v5.0 arrived 2026-08-17. It was read, and its deltas
were written into PRD BD-16. Then nothing: the code still runs v4 figures, the runtime adoption
catalogue still advertises "Interaction Guide v4 figures" to users (`readiness/catalog.ts:195`), and
the follow-up story the PRD and build-log both PROMISED was never written into `docs/backlog.yaml`.
That was the refuted claim — we tested the hypothesis that the story existed, under any id or status,
and it does not. The loop could never have picked it up. Filing STD-02/-03/-04 is the single
highest-value output here.

The fix for the general case is nearly free and is the substance of ADR 0030: `rate-card-watch.ts`
already fetches three scheme URLs on a weekly cron and opens a High-classification, `autoApply: false`
review task when a content hash moves. The scheme's Release Notes and Errata register — cited in this
repo at `docs/research/lfi-billing-system-tier2.md:387` — is simply not one of them. The mechanism
that would have caught the v5.0 drift exists and is pointed at the wrong pages.

SEVEN DEFECTS FOUND WHILE VERIFYING, which outrank the drift because they are wrong today:
- The Operations Console serves fabricated numbers under `DEPLOY_PROFILE=enterprise`. The `slo`,
  `certChain` and `ozone` deps are never injected in ANY profile (`app.ts:609-615`) and no enterprise
  implementation exists, so a bank sees a hardcoded 99.8% uptime as operational truth. CLAUDE.md's
  fail-closed rule is broken in the console and in seven more places besides — six demo sources wired
  unconditionally in the scheduled worker (`worker.ts:389,398,402,405,408,416`) and one in the request
  path. Two are worse than a green panel: the CAAP recorder writes FABRICATED registration events into
  the INSERT-only `audit_high_sensitivity` table, and the cert monitor watches a fake chain that is
  permanently "critical in 5 days", so a real scheme-certificate expiry would never be seen. (STD-11)
- The service-desk SLA clock does not pause at weekends (`service-desk/service.ts:98`, raw elapsed ms)
  though PRD §10 makes that a binding default and every other SLA module honours it. A P2 opened
  Friday 16:00 breaches Saturday 16:00. (STD-03)
- `liability.ts:47` returns 0 for any unmodelled issue, and the threshold derives from the same
  lookup — so both sides are 0, `0 >= 0` is true, and the class crosses trivially: it emits a signal
  and two P3 tickets reporting AED 0 at `low` severity. Not suppressed, silently worthless — harder to
  spot than silence. The scheme's AED 15,000 / 48-hour new-beneficiary class has no row at all. (STD-09)
- Fraud revoke is the only revoke path that records no `sla_met` verdict, so a <5s breach on the
  highest-risk revocation is invisible. `NEBRAS_SLA_MS` is defined twice and restated a third time in
  a different unit. (STD-09)
- The four-eyes bulk-revoke count can exceed what is revoked — the portal counts with `REVOCABLE`
  (including `AwaitingAuthorization`), the sweep uses `ACTIVE_STATUSES`. Approving "12" and revoking 9
  is an integrity defect, not a cosmetic one. (STD-05)
- `scheme_net_settlement` is the shipped DEFAULT collection rail but the `selected_rail` CHECK admits
  only three other values, so any collection on the default is rejected by Postgres at write time.
  BILLING-domain, flagged rather than fixed here. (STD-13)
- An undocumented direct-egress path: the rate-card watcher fetches scheme pages with plain `fetch`,
  no P6. Probably an intended carve-out (documentation mirrors, not the API Hub) but recorded nowhere
  — and ADR 0030 would extend that very watcher, so it needs a ruling before STD-01 builds on it.

CONFORMANCE GAPS PROPER, in brief: the simulator never echoes `x-fapi-interaction-id` (mandatory on
responses per the standard, and the correlation key Nebras support requires on every ticket), has no
consent state machine (any unknown id returns a fabricated `Authorized`; API Hub 2026.22.0 now returns
400 for revoke in a non-revocable state), and seeds its dataset and Consent Manager surfaces
incoherently — measured overlap zero for every 2026 period, so a cross-surface reconciliation reads
every consent as Authorized. Consent vocabulary is PSD2 (`AISP_DATA_SHARING`, `accounts:read`) rather
than UAE permission codes; consent types are absent entirely. UAEFTS appears nowhere, ACWP/ACWC
nowhere, and `ipp_status` has no enum in the contract — while V2.2 already makes `paymentRail`
mandatory with Tier 2 dates of 28 Feb 2027 / 31 May 2027. Two of the seven `NebrasEgressPort`
operations have no simulator route, so the M6 port-swap gate structurally cannot detect a defect in
those enterprise calls.

DELIBERATELY NOT DONE. No source file was touched — every code fix is a story, because comment-only
edits are still source edits under the worktree rule and because several of them need a spec-only PR
first. The respondent-dispute clock VALUES were left alone on purpose: 3/15/3/3 business days are
correct under v5.0, only the attribution is stale, and "fixing" the numbers would introduce a real
error while correcting a cosmetic one. errata3 was pinned but not scheduled — it touches international
payment creditors only, OFBO initiates no payments, and re-certification is change-triggered rather
than errata-triggered.

FOR A HUMAN (five, none decidable by the loop): ADR 0030 accept/reject; the P6 documentation-fetch
ruling; ADR 0010, still `Proposed` while BACKOFFICE-63 is `done` and diverges from its Option 1 in
three ways — the missing `acknowledged` state means the bank has no evidence an STR was ever filed;
ADR 0011, the same Proposed-but-implemented pattern; and STANDARDS block priority, since placing it
before COMMERCIAL means the loop takes conformance ahead of BILL-13..17, which have four PRs in
flight. An as-built note was appended to ADR 0010 recording the divergence; its `## Decision` section
is byte-identical to HEAD (the diff on that file is purely additive), so the human rules on the record
as it stood.

Evidence: docs gates green — `docs:check` 60 docs / 30 ADRs, no broken references or duplicate
numbers; `discovery:link` OK (STD- ids are outside the `^BACKOFFICE-\d+$` waist regex, so unaffected);
backlog YAML parses, 193 items (161 done), STD block field order matches the canonical sequence and
the simulated next-story pick is STD-09, the first dependency-free defect. Per-tag path
counts in the repaired PRD table were recomputed from the spec and sum to 93. Docs-only — no source,
no spec, no tests changed.

---

## 2026-08-18 — STD addendum: ADR 0030 accepted, P6 ruled, and the defect the ruling uncovered

Two of the five parked decisions came back the same day, and grounding one of them turned up a live
defect that no story owned.

ADR 0030 ACCEPTED (Option 1) with two binding amendments. The P6 question is RULED (a) — public
scheme-DOCUMENTATION change-detection sits outside P6, which governs the authenticated API data plane.
Three facts decided it, and none of them is "it seemed fine": `NebrasEgressPort` is seven purpose-built
typed methods with NO generic fetch, so routing docs through it means a new method on a regulated port
interface plus both adapters plus the contract bench — real cost, poor fit. CLAUDE.md:57 scopes P6 to
the scheme certificate chain, i.e. mTLS API traffic, and one of the three watched URLs is CBUAE
Confluence rather than a Nebras host at all, so a "P6 for Nebras-domain traffic" reading would leave
direct egress anyway and achieve nothing. And no bank grants a regulated workload unmediated outbound
HTTPS — at M6 this call traverses the bank's forward proxy whatever any ADR says.

The carve-out is deliberately narrow and CONDITIONAL: unauthenticated GETs of public scheme
documentation, no credentials, no PSU or bank data, response used only for change detection — and it
requires pinning the redirect behaviour (`redirect: 'follow'` on an unauthenticated GET is
SSRF-adjacent even with nothing to steal) and keeping the fetcher injectable so a bank points it at its
own proxy without a code change. Net effect is LESS unmanaged egress than before the ruling, not more.

THE DEFECT UNDERNEATH IT (new, STD-15). Checking what happens when that egress is blocked exposed a gap
bigger than the ruling. `rate-card-watch.ts:399` returns `failedSources`; `worker.ts:336` calls
`runBillingRateCardWatch` inside `Promise.allSettled` and DISCARDS the resolved value. It is never read.
A failed source writes one `billing_rate_card_watch_failed` audit row and raises nothing — no ITSM
ticket, no risk signal. So a proxy-blocked or moved page leaves the watch DEAD AND LOOKING ALIVE: weekly
audit rows nobody reads. That is this review's own thesis turned on the repo's tooling, and ADR 0030
would have inherited it — pinning a regulatory baseline to a watcher whose silence is indistinguishable
from "nothing changed" manufactures false assurance, which is worse than no registry. Hence amendment
(ii): fail loudly first. STD-15 filed, STD-01 depends on it.

Backlog consequences: STD-01 goes blocked -> pending (ADR 0030 accepted) with `depends_on: [STD-15]`,
and the block re-orders to STD-09..15 -> STD-01 -> STD-02..04 -> STD-05..08. 194 items, 8 blocked (was
9). Simulated next-story pick is unchanged at STD-09.

ADR 0010 (STR/AML) was PARKED by the owner, not resolved — recorded as such in the review's decision
queue so it cannot later read as settled. BACKOFFICE-63 stays `done` against a `Proposed` ADR and the
bank still has no evidence an STR was ever filed. ADR 0011 remains open.

Evidence: docs gates green — `docs:check` 60 docs / 30 ADRs, `discovery:link` OK, `adr-number-check` 1
ADR added no collision; backlog YAML parses, canonical field order holds, next-story pick simulated.
Still docs-only — no source, no spec, no tests changed.

---

## 2026-08-18 — ADR 0031: amending an accepted ADR (in-place for facts, supersession for decisions)

User decision (Option C of three). Prompted by ADR 0029's amendment table, which flagged the
question rather than assuming an answer after the hard-stop AI reviewer raised it twice on
PR #318, at explicitly stated low-to-moderate confidence, and declined to rule on it — correctly,
since it is a governance call for a control-plane owner rather than a reviewer.

THE INVESTIGATION CHANGED THE QUESTION. The practice already existed and was undocumented:
ADR 0007 was accepted on 2026-08-17 and substantively corrected THE SAME DAY — commit 0f0a79a,
"correct VAT, query-window, and collection mechanics", 65 insertions and 22 deletions against an
accepted decision record — by the BILL-11 work stream, with nothing on the document saying so.
Only `git log` knew. So the choice was never whether to start allowing in-place amendment; it was
keep doing it silently, stop entirely, or do it with a record. ADR 0029 was not the first case,
only the first FLAGGED case, and the only one carrying an amendment table.

Also established while checking: there is no written ADR process anywhere (no README in
docs/adrs/, one passing mention in DEVELOPMENT.md), and the sole supersession precedent
(ADR 0012 -> 0016) is a DECISION REVERSAL, not a factual correction — so it set no convention
for the case at hand. 29 ADRs before this PR: 23 Accepted, 5 Proposed, 1 Superseded (30 / 24 / 5 / 1
with ADR 0031 itself). An earlier revision of this line read "20 Accepted, 5 Proposed, 1 Superseded"
— a count that did not even sum to 29, and it is worth recording WHY it was wrong: it was measured
with the FIRST draft of the classifier, whose status regex silently missed the `- **Status:**` bold
form. The gate's own bug undercounted the population the gate applies to. Re-measured with the
fixed exports over the real corpus, enumerated rather than totalled.

THE RULE. Statement of fact changed (what was built, measured, or proved) -> edit in place and
add a dated row to an "Amendments after acceptance" table. DECISION changed (option chosen, or
its scope) -> supersede with a new ADR, the 0012 -> 0016 route. Proposed ADRs are exempt: the
rule attaches at acceptance, the point at which someone might be building against the document.

ENFORCED, NOT MERELY WRITTEN. scripts/adr-amendment-check.mjs fails a PR that modifies an ADR
whose BASE-BRANCH status is Accepted unless the diff adds a dated amendment row or flips the
status to Superseded. This repo's own history is the argument: an unenforced convention is "a
local convention wearing a gate's clothes" (HARNESS-09), and ADR 0007 is proof this particular
one would not have held. Discoverability is mechanical rather than documentary — nobody reads a
process doc before editing a file, so the failure message states the rule at the one moment
somebody wants it.

Placement follows HARNESS-07 doctrine: a separately guarded step in the EXISTING q2c job, not a
new job. Q2c already fetches the base ref this check needs, and adding a check-run name would
strand branch-protection rules pinned to the current ones. Guarded on `!cancelled()` so an
earlier step's failure cannot skip it — a skipped gate looks exactly like a passing one.

DELIBERATE COST, recorded in the ADR: a typo fix in an accepted ADR also costs a row. The check
cannot separate substantive from cosmetic without making a judgement call in CI, and a gate that
guesses is worse than one that is slightly heavy. If it proves noisy the proportionate relaxation
is to require a row only when the diff REMOVES lines, and that change must itself be an amendment
to ADR 0031 recorded in its own table.

ADR 0007 BACKFILLED in the same change — the one known case where document and history disagree
with nothing to say so. The backfill is itself an in-place amendment and carries its own row,
including a row recording that the table was added retrospectively.

THE HARNESS EARNED ITS KEEP ON THIS PR, TWICE, AGAINST A GATE I WROTE. HARNESS-16's advisory
hard-stop reviewer returned VERDICT: FAIL (7 findings) on the first draft of this check and
REPRODUCED three live bypasses rather than asserting them. Round two returned FAIL (3) and
reproduced two more — both the same root cause: the rename branch tested `isAdrPath` on the
DESTINATION path, so renaming an accepted ADR out of the matched shape while rewriting it walked
past the gate entirely (`0007-payables.md` -> `adr-0007-payables.md`, exit 0, "nothing to check"),
as did moving it out of `docs/adrs/` (a bare `D` under the old pathspec, read as the documented
deletion carve-out). Fixed by scoping on the ORIGIN path and dropping the pathspec: what puts a
change in scope is that the thing being edited WAS an accepted ADR on base — where the author
moves it to is exactly the freedom the bypass exploited.

Two findings were mine to own, not the reviewer's to catch. A commit claimed a rename fix and two
tests and shipped NEITHER: a live bypass probe ran `git add -A && git commit` (sweeping
uncommitted work) then `git reset --hard HEAD~1` (discarding it), and the commit message carried
the tell in its own test count. Both reviewers caught the empty commit. Process fix adopted and
held since: COMMIT FIRST, THEN PROBE. Separately the reviewer flagged, out of scope, a FALSE-RED
I had introduced while fixing finding 2 — `hasNewAmendmentRow` keyed its row set on the ISO date
alone, so a second genuine amendment on a day the ADR had already been amended read as "already
there". ADR 0007 carries two rows dated 2026-08-17, so it was days from biting. A false red on
compliant work is worse than most bypasses: a bypass lets one bad change through, a false red
blocks a good one and teaches people the gate is noise, which is how a control stops being read
at all. Now compared on whole normalised rows.

ROUND THREE: VERDICT: FAIL (4 findings), all four reproduced, three of them code defects I had
introduced while fixing rounds one and two. This is the entry worth reading twice, because the
pattern is that EVERY fix opened its own hole.

(1) Route 1 was satisfied by EDITING an existing amendment row rather than adding one. Comparing
whole rows had closed a false-RED (a same-day second amendment) and opened its exact mirror: an
edited row is absent from the base set, so it reads as "new". Appending ONE PERIOD to an old row
licensed an arbitrary rewrite - and the reviewer's reproduction changed the DECISION SCOPE, the
one case ADR 0031 routes to supersession rather than to a row. The gate green-lit the case the
convention most exists to catch. Neither end of that trade is safe alone; membership is now judged
in BOTH directions - a new row must appear AND every base row must survive unmodified.

(2) The D+A rewrite pairing keyed on the ADR NUMBER, so rewriting AND renumbering escaped
completely. Same evasion as renaming while rewriting, which this script already refused to honour;
the number is a label, not the record. Leftover deletions and additions now pair across numbers,
deterministically sorted. Accepted cost, stated: a PR that genuinely deletes one ADR and adds an
unrelated one will now be flagged. Checked before accepting it - 0001..0030 with no gaps, and NO
ADR HAS EVER BEEN DELETED in this repo's history, so the false-red is hypothetical while the
bypass was demonstrated. A lone deletion with nothing to pair against stays exempt.

(3) parseNameStatus enumerated M/R/C/D/A and silently dropped everything else, so a git TYPECHANGE
(T - replacing an accepted ADR with a symlink) reported "nothing to check". Closed as a CATEGORY
rather than a letter: any status git invents that touches an ADR path is treated as a
modification. The reviewer rated this exotic and was unsure it was worth closing; closing the
class rather than the instance is what made it worth doing once.

(4) NOT a code defect, and the most important of the four. The deletion carve-out was justified in
ADR 0031 by the claim that doc-link-check "already fails a PR that deletes an ADR still referenced
by a current-state doc". That is FALSE, and I verified it independently rather than taking the
finding on trust: doc-link-check resolves FILE-PATH references, and there are ZERO
docs/adrs/NNNN-*.md path references anywhere in the set it scans. ADRs are cited by NUMBER. Every
real path reference lives in docs/backlog.yaml, docs/research/, docs/reviews/, mcp-gateway, and
ai-review.yml - all outside the scanned set. So deleting an accepted ADR is green on both gates
and silent, which is precisely the outcome the ADR claimed was prevented. A decision record
asserting something its own history does not support is the exact failure mode ADR 0031 exists to
stop, and it was doing it in the paragraph justifying an exemption. Corrected in place; whether
deletion should require a record is now an OPEN CONTROL-PLANE QUESTION for the ADR's owner, not
something this script decides quietly.

TWO TEST ASSERTIONS WERE INVERTED, AND THE DISTINCTION MATTERS. Both had encoded a bypass as an
expectation ("an unrelated D and A ... both exempt"; "lone A and D exempt"). They were changed to
flag MORE, not less - strictly stronger, which is the opposite of the reward-hacking move the
tripwire and Q1b exist to block. Recorded explicitly because a test edit accompanying a green run
should always have to justify its direction.

ROUND FOUR: both reviewers PASS (hard-stop VERDICT: PASS, contract-conformance VERDICT: CONFORMANT)
and all ten deterministic gates green. Three non-blocking items were still worth fixing, and one of
them matters more than its size.

THE COMMENT WAS LYING ABOUT THE CODE, IN THE FILE THAT EXISTS TO STOP EXACTLY THAT. Round 3 closed
the status allow-list "as a CATEGORY, not a letter" - and the guard shipped as `!/^([MRCDA]\d*)$/`,
which excluded SCORED letters too. `M100` (git's break-rewrite form, emitted under -B) matched the
exclusion, fell past every specific branch and parsed to []. The reviewer reproduced it, then went
further and tried to reach it from real git: plain --name-status prints an unscored `M`, and
diff.breakRewrites is unset by default, so it is a latent gap rather than a live bypass. That is why
it survived two rounds. But the comment asserted a closure the code did not deliver - a document
asserting what its history does not support, which is ADR 0031's entire thesis, occurring inside
ADR 0031's own enforcement script. Fixed by listing the forms the specific branches actually handle
(`M\d*|[RC]\d*|D|A`) and accepting a scored `M` as a modification; pinned by a regression assertion
so the claim and the code cannot drift apart again.

Also fixed: the q2c step label still read "ADR amendment record (ADR 0030)" after the 0030 -> 0031
renumber, so the gate's user-visible name pointed at what is now a DIFFERENT ADR on main
(0030-standards-baseline-registry). Caught by contract-conformance and hard-stop independently. And
the test fixture stopped reusing `docs/adrs/0030-new.md` as a synthetic path, since that number is
now a real record. ADR_BASE_REF added to the recorded KNOWN LIMITS: a caller setting it to HEAD gets
an empty diff and a green gate - not defended against, because the workflow does not set it, so
setting it would be a visible line in the diff, the same posture as the route-2 status-line limit.

FOUR ROUNDS, AND THE PATTERN IS THE FINDING. FAIL(7) -> FAIL(3) -> FAIL(4) -> PASS. Every fix opened
its own hole: whole-row comparison closed a false-RED and opened a false-GREEN; the rename fix left
renumbering open; the category closure leaked scored letters. A gate this small needed four
adversarial passes to hold, which is the strongest available argument that HARNESS-16's reviewers are
doing work no deterministic gate was doing.

Evidence: 18 guard tests (59 across scripts/test after HARNESS-17 merged in its own five) incl. an ANTI-VACUOUS-PASS probe driving the exact ADR 0007 shape
(accepted, corrected, unrecorded) and asserting it FAILS, plus a regression guard that an
EXISTING amendment table does not license silent editing forever after — the defect that would
quietly gut this gate. doc-link-check 60 docs / 30 ADRs clean; adr-number-check no collision.

---

## 2026-08-18 — ADR 0031 addendum: the review harness caught a bypass in the gate, and a false fix

Two corrections to the entry above, both found by the AI reviewers on PR #324 and both worth
recording because of what they say about the harness rather than about the gate.

1. RENAME BYPASS IN THE GATE. hard-stop found that `modifiedAdrs` filtered `git diff
   --name-status` on status `M` exactly, so renaming an accepted ADR while editing it — git
   reports `R100`/`R087`, never `M` — walked straight past the check. The cheapest possible way
   around the rule the gate exists to enforce, in the PR that adds the gate. It did not infer
   this: it REPRODUCED the bypass in a scratch repository and confirmed the gate reports "no
   accepted ADR modified" and exits 0. Fixed by `parseNameStatus`, which handles `R*` and `C*`
   and reads base text from the OLD path.

2. A FIX THAT WAS NOT IN THE BRANCH. The first attempt at (1), commit 2e1eb40, claimed a code
   change and two tests and shipped neither — its stat was ADR prose only. Cause: the "live
   bypass test" ran `git add -A && git commit` to stage a throwaway probe, sweeping up the
   still-uncommitted fix and tests, then `git reset --hard HEAD~1` discarded the lot. The ADR
   prose survived only because it was written after the reset, which is exactly why the branch
   ended up asserting a behaviour it did not have. Both reviewers caught the discrepancy on the
   next run — contract-conformance by diffing HEAD against the commit the message described,
   hard-stop by noticing the stat and the unchanged test count.

   The commit message carried the tell: "11 in this file, 45 across scripts/test". 11 + 36 = 47.
   The arithmetic did not add up and was not checked.

   Process fix: COMMIT FIRST, THEN PROBE. A destructive probe must never be able to take
   uncommitted work with it. Applied here — the fix was committed before the rename probe ran,
   and verified present afterwards.

This is the strongest evidence to date for HARNESS-16, and it is not the green verdicts. The
harness caught a security-relevant bypass in a merge gate, then caught a false claim that the
bypass had been fixed. Both times a human reading the diff would have had to diff a commit
message against its own contents to notice.

## 2026-08-19 — HARNESS-17: the portal E2E install stops eating the job (PR #328)

The Q3 portal E2E job failed four times on 2026-08-19, every time on
`playwright install --with-deps chromium` and never on anything in this repo. Three of those runs
consumed the full 20-minute job cap and reported `cancelled`, which reads as neither pass nor fail —
the suite never started, so the gate produced no evidence either way.

MEASURED FIRST, AND THE MEASUREMENT KILLED THE OBVIOUS FIX. On the last healthy run (job
95996474055) the combined step cost 103s, split:

    apt, via --with-deps    07:50:15 -> 07:51:47    ~92s   (89%)
    browser downloads       07:51:47 -> 07:51:58    ~11s   (11%)

Caching the browsers — what I proposed to the user before looking — would have saved about eleven
seconds and fixed nothing. apt is both the cost and the hang risk. Recorded because the wrong answer
was already on the table when the numbers arrived.

WHAT apt WAS ACTUALLY INSTALLING, from that same run's output: fonts-freefont-ttf,
fonts-tlwg-loma-otf, fonts-unifont, fonts-wqy-zenhei, fonts-ipafont-gothic, xfonts-*. Nothing else
was unpacked — Chromium's own libraries are already on the ubuntu-latest image, so the browser
launches with or without the step. The last failure stalled at
`Ign:12 http://azure.archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages` and emitted
nothing for five and a half minutes.

Four changes:

1. Cache `~/.cache/ms-playwright`, keyed on the RESOLVED Playwright version rather than a lockfile
   hash — an unrelated dependency bump must not evict 290 MiB of browsers.
2. Split apt from the download into separate, individually capped steps (4m / 6m) so a slow mirror
   fails fast and names itself instead of silently consuming the job budget.
3. The apt step is now `continue-on-error: true`. It installs fonts an English-language portal suite
   does not exercise; blocking every PR on an external Ubuntu mirror to get them is the worse trade.
   *(SUPERSEDED — see "DECIDED" below. The step was made non-fatal first; once CI proved
   the suite runs with no packages installed at all, it was removed outright and q3-e2e now
   carries no `continue-on-error`.)*
4. The version resolution refuses an empty value. `echo "v=$(cmd)"` exits 0 even when cmd fails, and
   the pipe through `tr` swallows the status, so a `--filter` miss would have produced the key
   `ms-playwright-Linux-` shared by every Playwright version — one version's browsers served to
   another, with no signal at all.

THE PART THAT NEEDED THE MOST CARE was (3) — while it still existed — because "make the failing step non-fatal" is the shape
of reward-hacking even when it is correct here. So the guard pins the ASYMMETRY, not the change:
`continue-on-error` must appear EXACTLY ONCE in q3-e2e, and in the fonts step. The browser download,
the services, the portal build and the suite itself must all still be able to red the job.

Counting across the whole job rather than checking named steps is load-bearing, and the first draft
got it wrong. That draft guarded the suite via `if (suite) { ... }` keyed on its literal
`- run: pnpm --filter @ofbo/portal e2e` line — which goes vacuous the moment someone gives that step
a `name:`. Proved it rather than asserting it: rename the suite step AND mark it continue-on-error,
so a failing E2E test would no longer red CI, and the branch form reports green while the count form
catches it. Same defect class this session kept finding elsewhere — a control claimed more broadly
than it was built — this time in the guard written to prevent it.

Evidence: harness suite 82/82. Every new assertion mutation-checked and caught by its own guard
alone — remove `continue-on-error` from the fonts step; add it to the browser download; delete the
version-emptiness check — with `ci.yml` restored byte-for-byte after each. ci.yml parses and the
q3-e2e step table shows one `continue-on-error`, caps 4m/6m, job cap unchanged at 20m.

Not settled here, and left for a human: dropping `--with-deps` (and this step) entirely is the
larger lever — 89% of the install — but it is a behaviour change on CI shared by every PR.

**CI evidence, and it is stronger than a clean run would have been.** On the verifying run
([32237329042](https://github.com/openfinance-os/ofbo/actions/runs/32237329042)) the apt mirror was
**still hanging** — the log carries
`##[error]The action 'install Playwright system deps' has timed out after 4 minutes` — so the fonts
step was killed at its cap, `continue-on-error` absorbed it, and the browser download, the services,
the portal build and the E2E suite all ran and passed. That is the fifth mirror failure today, and
under the previous shape it would have been the fifth `cancelled` in a row. All ten gating jobs
green; q3-e2e finished in 410s against its 1200s cap, and the cache saved
(`Cache saved with key: ms-playwright-Linux-1.60.0`), which also settles the unverified
`actions/cache@v4` major.

One caveat worth naming rather than leaving for someone to trip over: the jobs API reports that step
as `conclusion: success`, because `continue-on-error` rewrites a failed step's conclusion. The
timeout is in the log and raised as a run annotation, but a reader scanning the step table sees
green. The step's cost while the mirror is down is four wasted minutes per run — which sharpens, but
does not decide, the question left to a human above.

**Warm-cache path proven on the next run** ([32238395327](https://github.com/openfinance-os/ofbo/actions/runs/32238395327)),
which was the one thing the cold run could not show: `Cache hit for: ms-playwright-Linux-1.60.0` →
`Cache restored from key: ms-playwright-Linux-1.60.0`, 259 MB in 7s, and `install Playwright
Chromium` fell from 12s to **1s** because the browser was already present. That also settles the
`actions/cache@v4` major, which the build session could not verify. On this run the mirror recovered
— the fonts step completed in 145s and the whole 967-line log carries zero `##[error]` lines, so it
succeeded rather than failing quietly. 10/10 gates green again, q3-e2e 331s.

So both paths are now exercised: the cold run proved the fix holds when the mirror is down, and the
warm run proved the cache restores. The measured cache saving is the ~11s predicted — the fix that
mattered was making the fonts step unable to take the job with it.

**DECIDED: the apt step is removed entirely** (handed back to me with "you decide", so the call and
its evidence are recorded here rather than left open).

The run above is the experiment that settles it. On 32237329042 the fonts step hung inside
`apt-get update` and was killed at its cap having logged **zero `Setting up` lines** — not one
package was installed — and the portal E2E suite then ran and passed in 25s. The suite has therefore
already been observed working with no fonts present. Supporting checks, all negative: no screenshot
or snapshot assertion anywhere in `apps/portal` (no `toHaveScreenshot`/`toMatchSnapshot`), no Arabic
or RTL content, no `font-family` or `next/font` declaration, and the spec's only non-ASCII characters
are `§ — →`, all in the base DejaVu set on the runner image.

Against that: the step failed the job four times in one day on an external Ubuntu mirror, and on the
two runs after that cost 253s (killed at the cap) and 145s, versus a ~92s healthy cost and an ~11s
browser download. It is 89% of the install and buys nothing this suite uses.

The consequence I care about most is that **`continue-on-error` is now gone from q3-e2e entirely** —
which is what both advisory reviewers singled out as the thing a human should look at. There is no
longer any step here whose failure is cosmetic, so the guard asserts the count is **zero**, not
"one, on the harmless step". Residual risk, unchanged and accepted: if a future runner image drops a
real Chromium library, the failure surfaces in the E2E step as a browser that will not launch —
fatal, legible and attributable — instead of being absorbed by a provisioning step.

The guard's comment-stripping is load-bearing and was proved, not assumed: the workflow's own
comment block now discusses both `continue-on-error` and `install-deps`, so a guard counting raw
text fails two assertions on an *unmodified* file. Verified by running the no-strip variant against
a clean `ci.yml` — 2 failures. Six mutations checked in all (reintroduce the apt step, restore
`--with-deps`, make the browser download non-fatal, delete the cache, drop the version-emptiness
check, raise the job cap below `steps:`), each caught by exactly its own assertion.

## 2026-08-21 — HARNESS-18: stop mutation + ai-review re-running on every push (Actions budget)

The GitHub Actions allowance was being exhausted in roughly four days of each month. Measured over
18–19 Aug 2026 from per-job timings — GitHub bills the **sum of every job**, each rounded up to the
whole minute, so a `ci` run that reads as 6 minutes on the Actions tab bills 22:

| workflow | jobs/run | billable min/run | runs / 2 days | ~billable min |
|---|---|---|---|---|
| `ci` | 10 | 22 | 60 | ~870 |
| `mutation` | 1 | 25 (10–14 cancelled) | 30 | ~380 |
| `ai-review` | 3 | 12 | 30 | ~220 |
| `deploy` | 5 | 9 | ~4 | ~36 |

~1,500 billable minutes in two days — ~750/day, ~16,000/month against a 3,000-minute allowance.

The recent spike was not drift. A `paths:` filter on `pull_request` is evaluated against the **whole
PR diff**, not the commits just pushed, so the moment a branch touched `services/bff/src/auth.ts`
once, every later push re-ran the 25-minute mutation job — doc-only pushes included. Both live
branches touch `auth.ts` and `approvals/service.ts`, which is why 30 of the 51 mutation runs this
workflow has ever had (created 24 Jun) landed in those two days. Fifteen of the thirty were cancelled
by the concurrency group after burning 10–14 minutes each: 215 runner-minutes that produced no
mutation score at all. Six of thirty completed. `ai-review` compounded it independently — created
15 Aug, 24 runs on 19 Aug alone at ~12 min each, because both reviewer legs spend ~5 minutes in a
model call re-reading the entire diff, re-paid per intermediate commit plus the tokens behind them.

Both now use `types: [opened, ready_for_review, reopened]`. This is a **cost** change, not a coverage
change: mutation still sees every security-core PR and ai-review still reviews every PR, at open
(drafts included — `opened` fires for them, preserving ai-review's deliberate no-skip-drafts rule)
and again at ready-for-review, the state a human is actually asked to merge. What is dropped is the
~20 intermediate re-runs per PR that re-proved the same thing. Safe because **neither is a required
status check** — the pinned contexts in `docs/governance/runbooks/main-branch-protection-activation.md`
are Q1, Q1b, Q2, Q2b, Q3 ×2, Q4, Q4.5 and Discovery only.

Escape hatches differ because the two workflows differ. `mutation` already has `workflow_dispatch`,
which accepts any ref, so it needs no label. `ai-review` deliberately has none (no merge base, nowhere
to post) and a Checks-tab re-run replays the *original* head SHA — so it gets `labeled`, narrowed on
the `config` job to the `ai-review` label. That is the only way to re-review the current head, and the
narrowing stops an unrelated label costing two model calls.

Guard: `scripts/test/ci-cost-guard.test.mjs`, 8 assertions in the dependency-free discovery-gates
glob. Verified non-hollow by putting `synchronize` back and watching exactly one assertion go red. It
asserts the coverage half too — `opened`, `ready_for_review` and `cancel-in-progress` must survive —
so a later edit cannot quietly turn the cost fix into a coverage cut.

**Deliberately not taken, both needing a human decision.** (1) Folding `q45-lineage` into
`q3-integration-contract`: q45 re-runs `pnpm test:integration` byte-identically to q3 and then a
one-second `lineage:gate` — ~2 billable minutes and a redundant Postgres container per `ci` run — but
`Q4.5 — BCBS 239 lineage validation` is a **pinned required-check context**, so merging it renames the
check and blocks every merge until an admin updates branch protection. (2) Path-filtering `ci.yml` so
docs-only PRs skip Q1/Q3/Q3-E2E/Q4.5 (~50 min/day): `ci.yml` has no paths filter at all, so an ADR-only
PR runs Playwright E2E and three Postgres containers — but conditionally skipping gates contradicts
this repo's own HARNESS-07 / q1b doctrine that an omitted gate must never be indistinguishable from a
passing one.

Also noted, not fixed: the mutation job has grown from the ~8 minutes its header claimed to ~25,
now flush against its own `timeout-minutes: 25` ceiling. A job pinned to its timeout is the job most
likely to start failing spuriously, and the 3× growth is unexplained. The stale header claim was
corrected rather than left to drift (Q2b). Playwright's 2m57s uncached browser install is not in scope
— HARNESS-17 / PR #328 already removes the 92-second `--with-deps` apt step and caches the browsers.

Expected saving ~270 min/day, ~36% of total spend, without weakening a merge gate.

Evidence: `scripts/test` 44/44, discovery harness 40/40, `docs:check` 60 docs / 30 ADRs, `discovery:link`
OK, backlog YAML parses, both workflows parse and their resolved triggers were inspected. No source,
spec, or product tests changed — CI configuration, one new guard test, and docs.

### Addendum, 2026-08-21 — the allowance is not "running low", it is EXHAUSTED

Found while watching PR #329's own checks. Every job on it failed 2-3 seconds after creation with
`runner_id: 0`, no runner name, **zero steps executed** and no log file (the logs endpoint 404s). That
is GitHub refusing to allocate a runner at dispatch, not a gate finding a defect.

Bisected against the run history:

| | run | created | outcome |
|---|---|---|---|
| last success | ci #959 (PR #328) | `2026-08-19T10:02:08Z` | success, 4m |
| first failure | ci #960 (PR #328) | `2026-08-19T10:08:30Z` | failure, 0m — now on `run_attempt: 8` |

So the cutover is between **10:02 and 10:08 UTC on 19 Aug 2026**, and CI has been down repo-wide for
~42 hours. It is not branch-specific: the same signature appears on `feature/HARNESS-17-…`,
`claude/adr-0030-amendment-convention` (retried 7 times) and `claude/github-actions-budget-jryfmy`,
across `ci`, `mutation` and `ai-review` alike. Nothing merges until the spending limit is raised or
the monthly allowance resets.

Two consequences worth recording. First, the burn measurements in the entry above were taken over
18-19 Aug — which is precisely the window that spent the allowance, so they describe the run rate that
caused this, not a quiet period. Second, HARNESS-18 could not be verified in CI: the gates it touches
were run locally instead (`scripts/test` 44/44 including the 8 new guards, discovery harness 40/40,
`doc-link-check` 60 docs / 30 ADRs, `discovery-link-check` OK, both workflows parsed and their resolved
triggers inspected). The change touches no source — CI configuration, one dependency-free guard test,
and docs — so the locally-runnable gates are the ones that cover it. It still needs a green CI run
before merge, once runners are available again.

The manual re-runs are worth calling out as a trap: a dispatch failure looks like a flake, so seven and
eight attempts were spent re-running runs that cannot start. They cost no minutes, but they cost time
and they obscure the real signal.
