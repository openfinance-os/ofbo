# OFBO Improvement Plan — August 2026

**Date:** 2026-08-04 · **Method:** full codebase audit (state as of `main` @ `6419995`) + market research across comparable products (open-finance consoles, ecosystem operators, reconciliation platforms, regulated back-office tooling). Sources cited inline; full source list in the appendix.

**How to read this:** §1 is the honest baseline. §2–§4 are internal improvements ordered by priority — §2 is the only section that should pre-empt everything else. §5 is the market-informed product roadmap. §6 sequences it all through the repo's own mechanisms (HARNESS items for gates, discovery→develop→backlog for features per HG-0007). §7 is what *not* to do.

---

## 1. Where the codebase stands

The honest headline: **this is a mature, disciplined codebase whose biggest remaining risks are in its own control plane, not its features.**

- 98 of 99 contract routes implemented with real business logic (one 501 remains: `GET /back-office/analytics/onboarding-handover-health`, `specs/backoffice-openapi.yaml:934`). M0–M5 complete; 139/145 backlog items done.
- The load-bearing controls are real, not performative: RLS is enabled *and forced* at the schema (`packages/db/migrations/0003_rls.sql`), audit is INSERT-only with privileges revoked belt-and-braces, redaction happens **before** the audit INSERT (`packages/db/src/audit.ts:81`), four-eyes is a genuine registry of gated operations with self-approval rejected at the service layer, and the profile-branch rule is machine-enforced by ESLint (`eslint.config.mjs:16-22`).
- Test posture is strong on volume (≈1,209 unit + 136 integration + 17 e2e + 9 smoke) and unusually strong on integrity (red-by-design stub suite, anti-vacuous-pass guards, test-tripwire, Q1b).
- The project's self-knowledge is excellent — `docs/build-log.md`, the tier-2 review, and the backlog notes are candid. Most of what follows was *partially* known; this plan's contribution is verification, prioritisation, and the external comparison.

The pattern in the top-priority findings below is the exact failure class the project already named twice (HARNESS-07, the 4-day absent-secrets-scan): **a control that is absent looks exactly like a control that passed.** There are four more instances of that class live today.

---

## 2. Priority 1 — Close the control-integrity gaps (the product's promise is provable controls)

These are cheap relative to their weight. Each is a stated guarantee that is not currently enforced by any gate. For a product whose pitch is "regulated control surface, evidenced on demand," these come before any new feature.

### 2.1 Coverage is a stated gate that no CI job runs
`vitest.config.ts` sets 80% thresholds (statements/branches/functions/lines, scoped to `services/bff/src/**`), and CLAUDE.md says "Coverage ≥80%". But `grep -rn coverage .github/workflows/` returns nothing — Q1 runs `pnpm test` (no `--coverage`). Coverage is currently a local convention, invisible to merge.
**Action:** add `--coverage` to the Q1 unit step (or a dedicated job), fail on threshold breach, and record the number in the job summary. If the current baseline is below 80% anywhere, ratchet (start at measured, raise per-PR) rather than weakening the threshold.

### 2.2 The port-swap acceptance gate is inert
CLAUDE.md: "an enterprise adapter must pass exactly the tests the simulator passes (that is the port-swap acceptance gate, M6)." In `packages/ports/test/port-contracts.spec.ts:11` the signature is literally typed `profile: 'demo'` and only `describePortContract('demo')` is ever invoked. All ten enterprise adapters exist (ADR 0023/0024, fail-closed — good), but they are proved only by per-adapter specs with injected fakes. The acceptance gate M6 depends on does not exist yet as executable code.
**Action:** widen the signature to `'demo' | 'enterprise'` and add a config-driven `describePortContract('enterprise')` run that executes per-port against injected fakes today (skipping ports whose enterprise config is absent, *visibly*, with a job-summary line per skipped port), so the harness itself is proven before M6 and a bank engagement can run it against real systems unchanged.

### 2.3 The Q4.5 lineage gate checks 17 hardcoded tables; the schema has 29
`packages/db/src/lineage.ts:112` enumerates 17 tables. Migrations create 29. Regulated write-path tables *not* asserted by the BCBS 239 gate include `respondent_dispute`, `fraud_incident`, `scheme_notification`, `service_desk_case`, `str_draft`, `trust_framework_participant`, `readiness_profile` — even though their stores claim column-level lineage in backlog notes. Every table added since the list was written is invisible to Q4.5. The repo already has the right pattern in-house: `packages/db/test/registry-coverage.int.spec.ts:37-44` derives its table set dynamically from `information_schema.role_table_grants`.
**Action:** derive the lineage-gate table set the same way (every table `ofbo_app` can INSERT into, minus the documented `idempotency_key` exemption), and let `KNOWN_LINEAGE_GAPS` absorb any genuinely-exempt table with a story reference. This turns Q4.5 from a snapshot into a self-maintaining control.

### 2.4 Release evidence has never been produced
`releases/` contains only a README; `git tag` is empty. `.github/workflows/release-evidence.yml` is complete but has never fired. The Q5 story (BACKOFFICE-57) is "done" as machinery, but zero evidence bundles exist — the one artifact an adopting bank's auditor would ask for first.
**Action:** cut `v0.1.0` from current `main` and let the workflow produce the first bundle. This also exercises `parseProvenance` and the sealed-trailer path (ADR 0019) end-to-end for the first time, and gives the tier-2 review's `EVID-01` its baseline.

### 2.5 Eleven stories were merged on locally-run gates — re-verify them in CI
The string "Merged on local gates" appears 11× in `docs/backlog.yaml` (the GitHub Actions billing outage, `docs/build-log.md:1763`). Local runs also could not execute the semgrep secrets scan (egress-blocked, `build-log.md:1778`). Main is green now, which retroactively covers most of it — but nothing has explicitly confirmed the full Q1–Q4.5 matrix over those stories' surface.
**Action:** one deliberate full-matrix CI run (workflow_dispatch on main, all suites + coverage from 2.1) and a one-line build-log entry closing the episode. Cheap, and it converts "probably fine" into "evidenced."

### 2.6 Dependency currency is manual, and that already burned four days
Main was red 22–26 Jul partly from 5 HIGH advisories in shipped deps; there is no `dependabot.yml`/`renovate.json`. Version skew exists across the workspace (`@hono/node-server` ^2.0.4 in bff vs ^1.13.7 in nebras-sim; vitest ^2 vs current v3 line; tailwindcss ^3; jsdom ^25; playwright ^1.49). Three advisories are pinned via `pnpm.overrides` rather than fixed parents.
**Action:** add Renovate (grouped weekly PRs, automerge patch-level for devDeps), align duplicate deps to one version per package, and schedule the vitest 2→3 and tailwind 3→4 majors as explicit chores rather than letting the delta grow.

### 2.7 Ratchet the mutation-testing floor
Baseline 70.3%, 101 surviving mutants on the six auth/approval-critical files, with `break: 65` set *below* baseline — so the weekly run can decay 5 points before failing. **Action:** set `break` to (baseline − 1) and raise it as survivors are killed; treat the 101 survivors as the hardening backlog the build-log already calls them.

---

## 3. Priority 2 — Truth and governance hygiene

The repo's docs are its regulatory posture. Three classes of drift:

1. **Stale ground-truth claims.** `README.md` says "76 paths, 10 tags" (actual: 89/12) and "127 of 135 backlog items" (actual: 139/~145). CLAUDE.md and `docs/architecture-overview.md` describe P1–P9; the code has ten ports (`p10-str-workflow`, `packages/ports/src/interfaces.ts:159`), and the architecture doc still labels enterprise adapters "M6 stub" though all ten are rung ③. Q2b (`scripts/doc-link-check.mjs`) checks path existence only, so numeric drift is CI-invisible — consider deriving the README's counts at check time (the generator already knows them) rather than hand-maintaining.
2. **ADR/code inconsistency at the tenancy seam.** ADR 0028 is *Proposed* while its migration (`0030_tenant_group.sql`), seeds, worker flag and portal switcher are merged. Same for the COMMERCIAL backlog block (VAL/HOST/INS items carry **no `status:` field at all**) while HOST-01/HOST-02 scaffold code has landed. Under the repo's own rule 6 ("raise an ADR and stop — humans decide") this is the sharpest inconsistency in the repo. **Action:** decide ADR 0028 (accept or amend), and give every COMMERCIAL item an explicit status.
3. **A decision queue is silently accumulating.** 9 product ADRs Proposed (0006–0011, 0027, 0028) and 8 of 12 governance HGs Proposed. Several Proposed ADRs block real capability (0007 payables/net-settlement is the missing money-movement leg of reconciliation; 0006 is the dual-role data wall the tier-2 review calls "labeled, not enforced"). **Action:** a single human decision session over the nine, each ending Accepted / Rejected / explicitly-parked-with-date. Also refresh or annotate the two stale point-in-time reviews (`ui-ux-review.md`, `design-conformance-audit.md`) whose "remaining" sections describe work since completed.

Also worth noting: `docs/develop/` has zero SDRs and only two discovery runs exist — with zero pending feature items, **the HG-0007 waist currently has nothing flowing through it**. §5/§6 of this plan are deliberately shaped to feed it.

---

## 4. Priority 3 — Code health (real but non-urgent)

- **Deduplicate the pagination internals.** `encodeCursor`/`decodeCursor` is re-declared in ≥9 store files and the keyset predicate `(date_trunc('milliseconds', created_at), id) < (...)` in 16 (`packages/db/src/*`). One shared `keyset.ts` in `@ofbo/db` removes ~25 copies of security-and-correctness-sensitive code.
- **Split the two oversized modules.** `services/bff/src/reconciliation/service.ts` (1,068 LOC — includes ~250 LOC of InMemory stores) and `app.ts` (798 LOC, ~130 of which are the `IMPLEMENTED_ROUTES` literal — consider generating that set from a per-module registration pattern instead of a hand-kept list).
- **Move the 27 `InMemory*` stores out of production source** into a `testing/` export or `@ofbo/fixtures` package. They are load-bearing for the demo profile, so keep them shippable — but today they sit interleaved with production logic and count against its readability and coverage denominators.
- **Repo weight:** 565 KB of `live-*.png` at root, 700 KB rendered PDFs/PPTX in `docs/proposals/rendered/`, a 1.36 MB `regulations.json` + 313 KB `.xlsx`, and a byte-identical 145 KB HTML duplicated between `docs/` and `apps/portal/public/` (guarded by a sync test — better: single source, copy at build).
- **Finish the last 501** (`onboarding-handover-health`) or formally re-scope it — a 98/99 console reads as "done"; 99/99 *is* done.

---

## 5. Priority 4 — Market-informed roadmap (what comparable products do that OFBO doesn't yet)

Research covered: Ozone API's Admin Portal (which *is* the UAE API Hub LFI portal), Plaid, Tink, TrueLayer, Yapily, Salt Edge, Token.io; Raidiam Connect (the Al Tareq trust-framework operator) and Konsentus; UK OBIE Operational Guidelines / MI specs / Dispute Management System, Brazil Open Finance (PCM, mandatory Status/Outages APIs, public dashboard); Duco, SmartStream (Affinity), Gresham, ReconArt, AutoRek, FloQast, Osfin, Kani; Formance, Moov, Midaz; ServiceNow FSO, Pega Smart Dispute, Camunda; OpenLineage/Marquez, DataHub, immudb, OSCAL; Medusa admin, Appsmith, Windmill, Supabase Studio, Retool, Linear.

Grouped by where they land in OFBO. Each item names its donor pattern.

### 5.1 Reconciliation (E1) — from "breaks" to a break *lifecycle*

1. **Workflow rules on breaks** *(Duco)*: declarative config that auto-assigns, auto-labels, and age-escalates exceptions (owner group by line class, escalate at N days) — ops tune triage without releases. OFBO has claim/resolve/escalate verbs; it lacks the rules layer that runs them automatically.
2. **Auto-supersede recurring breaks with context carry-over** *(Duco)*: when the same break re-emerges in the next ingest, supersede the old one and inherit its comments/labels/assignment. Without this, daily report recs drown operators in duplicates — the highest-value single E1 upgrade.
3. **Risk-based auto-signoff within tolerance** *(FloQast)*: auto-certify recs that tie within configured thresholds, recorded as evidence with preparer/reviewer identity; route human attention only to genuine variance. Fits the existing monthly-signoff four-eyes operation.
4. **Match-rule inference from sample files** *(Gresham CTC)*: onboarding a new Nebras report type = upload sample extracts → suggested field mappings + tolerances for human review. Directly reduces the M6 per-bank onboarding cost.
5. **The third leg: actual money movement** *(Kani; requires deciding ADR 0007)*: today's match is metering ↔ TPP billing ↔ Nebras report. Add settlement actuals from P4/P9 so the match extends to "did the money move" — and reuse the reconciled dataset to auto-generate the finance/regulatory reports (Kani's QMR/QOC trick).
6. **Later, governed ML match-suggestions** *(SmartStream Affinity)*: log operator match actions as training signal; surface ranked suggestions with confidence, human-confirmed. Only under the BACKOFFICE-65 regulated-AI pattern (model card, drift monitoring, deterministic fallback).

### 5.2 Customer care & disputes (E2)

7. **OBIE-grade consent rendering**: show the TPP's directory *trading name* (not registered name), data clusters expandable to individual permissions in researched consumer language, granted date + last re-auth date. Map clusters to UAE v2.1 permission groups.
8. **Revocation reason codes** *(WSO2 customer-care portal)*: every on-behalf-of revocation captures a structured reason — feeds the audit trail, the fraud-revoke four-eyes flow, and MI.
9. **Revocation propagation state in the UI**: "revoked here → Hub acknowledged in 3.2s" — the sim already models the <5s Nebras ack; surface it so care agents *see* the SLA being met (and see it fail under fault injection).
10. **Inter-participant dispute rail** *(UK DMS 2.0)*: structure disputes as case + secure member-to-member messages + evidence vault with the enquiry/complaint/dispute typology and the UAE escalation ladder (Nebras/CBUAE → Sanadak). OFBO has the case objects (disputes, respondent-disputes, service-desk); the missing piece is the evidence-exchange thread as a first-class, auditable object.

### 5.3 Analytics & MI (E3) — make the numbers scheme-defensible

11. **A mechanical downtime definition** *(OBIE)*: "down = 5 consecutive requests unanswered within 30s total," planned vs unplanned split, 99.5% quarterly benchmark. Adopting a scheme-grade definition makes availability MI defensible before CBUAE mandates one.
12. **"Slowest 50 endpoints" delay-ratio report** *(OBIE MI spec)*: TTLB ÷ non-core-hours median, ranked monthly — a self-normalizing outlier report needing no per-endpoint SLA config; cheap from existing telemetry.
13. **MI submission as an API contract** *(OBIE MI Reporting API + Brazil PCM)*: treat regulator/scheme reporting as a versioned OpenAPI surface, not an export. Brazil's PCM — both sides report every interaction, centrally reconciled — is OFBO's E1 pattern generalized; being contract-first here positions OFBO for the day Nebras mandates the same.
14. **Per-TPP funnel analytics with benchmarks** *(Tink/Plaid)*: consent-journey conversion per TPP and per step, error types broken out per counterparty, compared to a cross-tenant benchmark. OFBO's analytics count volumes; consoles that operators love explain *conversion*.
15. **Certification state as an ops object** *(UAE Certification Framework)*: track certification/re-certification state per environment with its triggers (new Standards version, material change, Nebras discretion) exactly like cert expiry is tracked today (BACKOFFICE-66's pattern, `platform_certification` already exists).

### 5.4 TPP registry & counterparty ops

16. **Directory-grade TPP lifecycle** *(Raidiam + Konsentus)*: cache the Al Tareq directory record per TPP, treat certificate rotation as a first-class ops event, and continuously re-verify regulatory status (Konsentus's 1-hour register-sync SLA is the bar), with allow/deny lists and an ops contact book per counterparty (Konsentus Transparency Directory).
17. **Per-counterparty health tiles with explicit thresholds + subscribable alerts** *(Plaid Institution Status)*: two-week health per TPP/Hub surface with a stated "healthy" line, and threshold-triggered alerts routed via P3 — a number is only operational when it has a stated threshold.

### 5.5 Platform, approvals & operator UX

18. **Maker-cancel and checker diff-view** *(maker-checker canon)*: the two commonly-missed four-eyes pieces — the initiator can withdraw a pending request, and the approver sees a structured before/after diff of exactly what will execute. OFBO's approval primitive is strong; this is the last mile.
19. **Persona impersonation** *(Supabase Studio)*: a demo/training-profile "view as persona" mode rendering screens under a chosen persona's scopes + RLS. Turns the load-bearing scope matrix into something visually verifiable in review — and doubles as a demo feature. (Also closes the portal/BFF scope-list hand-sync gap: derive `apps/portal/src/lib/scopes.ts` from `SCOPE_MATRIX` instead of mirroring 15 of ~21 scopes by hand.)
20. **Cmd+K palette, saved views, keyboard-first queues** *(Linear/Supabase)*: one palette for entity search + actions; break/approval queues as saved shareable filtered views; optimistic UI on the three highest-frequency triage actions.
21. **Entity-360 timeline** *(Backstage entity graph + Kustomer timeline)*: the README already sells "one audited, lineage-tracked thread" across dispute/break/signal/case/approval — build the screen that *shows* it: a TPP-360/consent-360 page interleaving every linked object chronologically.
22. **Audit viewer with filters + export, and read-auditing for sensitive queries** *(Plaid Audit Logs / Retool)*: the INSERT-only store exists; internal-audit teams need the filterable, exportable viewer. Retool's bar — log sensitive *reads* (who viewed which PSU's consents, when), not just writes — is above OFBO's current line and is exactly what a care-surface audit wants.
23. **Tasks-not-terminals runbooks** *(Airplane/Rundeck)*: every recurring manual ops intervention (re-ingest, cache clear, re-seed, fault clear) becomes a parameterized, permissioned, audited task with optional approval-before-run — the natural P3-adjacent surface, and it kills ad-hoc script access.
24. **Scenario library for the simulator** *(Plaid sandbox personas/magic errors)*: nebras-sim's 4 injectable faults are the right idea; grow it into JSON-defined scenario personas (a library of ready-made demo scripts: "TPP goes delinquent," "consent drift storm," "liability crossing") triggerable per-demo. Validates the existing design and makes demos repeatable by non-authors.

### 5.6 Evidence & lineage infrastructure

25. **OpenLineage events with facets; Marquez as the P7 sim adapter** *(OpenLineage/Marquez/DataHub)*: emit standard Job/Run/Dataset events with column-level-lineage facets from the recon engine and analytics jobs. The enterprise P7 adapter already speaks OpenLineage — adding Marquez as the *demo* sink makes lineage visually demonstrable (a demo screen showing "where this number came from" is a differentiator no comparable console has).
26. **Hash-chained audit with an independent verifier** *(immudb pattern; QLDB is EOL)*: add a hash chain over `audit_high_sensitivity` and a scheduled verifier job that continuously proves non-tampering — "evidence ready before the regulator asks," and a strong demo moment (tamper in the sim, watch the verifier scream).
27. **OSCAL-shaped evidence bundles** *(NIST OSCAL)*: structure release-evidence and control attestations as machine-readable observations/findings/risks/evidence rather than freeform — composable into supervisory responses, diffable in git.

---

## 6. Sequencing

Respecting the repo's own mechanisms: gate/harness work is not waist-gated; every §5 feature enters through discovery → develop (SDR) → backlog per HG-0007.

**Horizon 1 — now (order of days each): control integrity + truth.**
All of §2 as HARNESS/M-infra items (coverage gate; enterprise port-contract harness; dynamic lineage gate; `v0.1.0` + first evidence bundle; full-matrix re-verification run; Renovate; mutation ratchet), plus §3's doc-drift fixes and the ADR-0028/COMMERCIAL status reconciliation. One human decision session over the nine Proposed ADRs.

**Horizon 2 — next (weeks): the operator-experience compounders.**
Seed discovery runs for the four themes with the best value-to-effort in a demo-led product: (a) *break lifecycle automation* (§5.1 items 1–3 — recurrence supersede + workflow rules + tolerance auto-signoff), (b) *four-eyes last mile* (§5.5 item 18), (c) *entity-360 thread view* (item 21), (d) *audit viewer + read-auditing* (item 22). Add the OBIE downtime definition + slowest-50 report (items 11–12) as a compact E3 story, and the sim scenario library (item 24) as demo infrastructure. §4's code-health items ride along as refactors inside whichever stories touch those files.

**Horizon 3 — later (M6-adjacent and beyond):**
Money-movement leg + payables (item 5, unblocked by deciding ADR 0007) · directory-grade TPP lifecycle + Konsentus-style re-verification (item 16) · MI-as-API-contract (item 13) · Marquez P7 demo sink + hash-chained audit (items 25–26) · persona impersonation + Cmd+K/saved views (items 19–20) · DMS-style evidence rail (item 10) · governed ML match-suggestions (item 6, last — it needs the operator-action history the Horizon-2 work starts accumulating).

**Explicitly M6/bank-gated (unchanged):** BACKOFFICE-52 mTLS at the gateway, real Parquet warm tier, per-tenant PRD §10 config, Terraform beyond skeleton, FAPI posture proof — the tier-2 review's register already owns these.

---

## 7. What not to do

- **Don't add real authentication to the demo profile beyond its documented posture.** `demo-token:` personas on a synthetic-only, permanently-non-prod surface are a deliberate, documented trade; the enterprise P2 Entra adapter is the real path. (Do keep the sim's `ADMIN_TOKEN` warning honest — the smoke test asserting the 401 is `skipIf`-guarded, so consider making that secret mandatory in CI smoke.)
- **Don't adopt a workflow engine** (Camunda/Pega-class) for disputes/approvals. The research says the lightweight equivalent — state machine + two-level SLA timers + suspend/resume approvals — is exactly what OFBO already has the bones of; a BPM dependency would violate "compose, don't invent" and the serverless demo profile.
- **Don't chase framework majors as a project.** Vitest 3 / Tailwind 4 are scheduled chores (§2.6), not initiatives.
- **Don't build the public transparency dashboard yet** (Brazil's Dashboard do Cidadão pattern): pre-compute the numbers (Horizon 2's MI work does this), but publishing is a scheme-level decision that CBUAE hasn't made — keep it as a discovery candidate, not a story.
- **Don't let this plan bypass the waist.** Everything in §5 is a *candidate* until a discovery run evidences the problem and a develop-phase SDR picks the direction (HG-0007/HG-0009).

---

## Appendix — research sources

**Consoles/ecosystems:** Ozone API Admin Portal & UAE API Hub LFI guide (openfinanceuae.atlassian.net); Plaid docs (Logs, Institution Status, Audit Logs, sandbox custom users); Tink Console analytics; TrueLayer Console docs; Yapily API Insights; Salt Edge PSD2 suite; Token.io bank monitoring; Raidiam Connect docs (directory, PKI, delegated admin); Konsentus Verify/Transparency Directory.
**Scheme ops:** UK OBIE Operational Guidelines + MI Reporting specs (openbankinguk.github.io/mi-docs-pub) + DMS 2.0 / Code of Good Practice; Open Finance Brasil PCM spec (github.com/OpenBanking-Brasil/specs-pcm), availability rules, Dashboard do Cidadão; UAE Certification Framework.
**Reconciliation:** Duco exceptions-workflow KB; SmartStream Affinity; Gresham CTC; ReconArt; AutoRek CASS/ICMR; FloQast; Osfin; Kani Payments; Formance reconciliation module; Moov ach-test-harness; Midaz.
**Back-office patterns:** ServiceNow FSO dispute data model (transaction-level playbooks); Pega Smart Dispute; Camunda best practices; Airplane/Rundeck runbook automation; Retool audit logs; Backstage system model; Windmill suspend/resume approvals; Medusa admin (API-first); Appsmith; Supabase Studio (impersonation, Cmd+K); Linear UX canon.
**Evidence/lineage:** OpenLineage spec + Marquez; DataHub BCBS 239 guides; immudb (QLDB EOL migration path); NIST OSCAL assessment-results model.
