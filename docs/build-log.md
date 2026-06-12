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
