# OFBO Standards-Conformance Review — August 2026

**Date:** 2026-08-18 · **Baseline:** UAE Open Finance Standards **v2.1-final + errata3** (doc-level 30 Jun 2026 / spec register 8 Jul 2026), **API Hub v8** (releases 2026.19.0, 2026.22.0), **Nebras Interaction Guide v5.0** (Jun 2026), Limitation of Liability Model v2.1, Commercial & Pricing Model v1.0, and the Ozone Connect availability / response-time / data-quality policies (all updated 21–22 Apr 2026). **Subject:** `main` @ `c5ba31b`.

**Method:** every claim below was produced by one pass, re-verified by a second adversarial pass that opened each file and read the lines, and then the finished document was itself re-reviewed by five independent critics against the tree. 45 first-pass claims were tested (**33 confirmed, 11 corrected, 1 refuted**) and the critique pass corrected a further nine, including three findings in §2 whose *mechanism* was wrong. Corrections are folded in; the refuted claim is recorded in §9 because the negative is the finding.

**On line numbers:** citations into source files are as at `c5ba31b` and are unaffected by this changeset. Citations into the four documents this changeset itself edits (`docs/backlog.yaml`, `docs/adrs/0010-*`, the PRD, `CLAUDE.md`) will have shifted by the time you read this — where a finding is repaired here, the text says so rather than leaving a present-tense claim that the merge falsifies. Claims sourced to the scheme documents rather than to the tree — the errata level, the Ozone Connect policy figures, the AED 15,000 limit, the API Hub 2026.22.0 behaviour change — are cited in the appendix and were **not** verifiable from this repo; they carry the appendix's re-confirmation caveat.

**How to read this:** §1 answers the question that was asked. §2 is the only section that should pre-empt everything else — it is not standards drift, it is code that is wrong today, found while verifying. §3–§7 are the conformance drift proper, in priority order. §8 records what is *clean*, because a review that lists only faults misrepresents the codebase. §9 is the human decision queue. §10 sequences the work.

---

## 1. The answer: architecturally conformant, operationally drifting

**The load-bearing architecture is right, and that is the hard part.** OFBO has not imported UK/EU Open Banking assumptions into a centralised scheme — the failure mode that sinks most UAE implementations. Specifically, and verified:

- **Consent source-of-truth is correct.** The PRD states the centralised invariant explicitly (`docs/PRD_Open_Finance_Back_Office.md:131`) and the code honours it: admin revocations execute via the Hub's Consent Manager through P6, and the local record is a synchronised mirror, never an authority. There is a machine-enforced reviewer hard-stop for it (`.claude/agents/hard-stop-reviewer.md:18`).
- **The seven-state consent lifecycle is byte-exact** against the current standard — `AwaitingAuthorization, Authorized, Rejected, Suspended, Consumed, Expired, Revoked`, in that order, with American spelling, in the contract (`specs/backoffice-openapi.yaml:3161-3164`), the fixtures (`packages/synthetic-data/src/index.ts:95`) and the generated types.
- **Terminology is right.** The LFI backend is called Ozone Connect, never "the LFI's resource server" — the mistake the scheme's own guidance calls out.
- **The AML GO guard holds.** There is no AML GO client anywhere; the only path is the P10 handoff (`packages/ports/src/interfaces.ts:180`).
- **The liability matrix matches the published schedule exactly** — all nine per-incident amounts and the tiered 350/250/200 SLA band (`services/bff/src/risk/liability.ts:23-36`).
- **The rate card matches the Commercial & Pricing Model**, and is the best-governed artefact in the repo (§3).
- **PSU-level PII posture is enforced by tests, not by promises** — 999-prefixed Emirates IDs (never 784), `000` bank codes, with assertions that fail if a real-format identifier ever appears.

**What has drifted is operational, and it has drifted in one recognisable way: the repo has no mechanism that notices when the scheme moves.** The rate card has a versioned constant, per-rate citations, a content-hash watcher and a mandatory human review on change. Nothing else does — not the Standards version, not the errata level, not the Interaction Guide, not the liability model. So when Interaction Guide v5.0 landed on 2026-08-17 it was *read*, *recorded in the PRD*, and then *not applied*, and nothing in CI can tell that the code is running v4 figures. That single missing control explains most of §3–§7.

The most consequential single sentence in this review is in §3: **the mechanism that would close the gap already exists and is simply not pointed at the standards source.**

---

## 2. Priority 1 — defects found while verifying (these are wrong now, not merely stale)

These surfaced during evidence-gathering. They outrank the conformance drift because each is a live incorrectness, and three of them are the same failure class the repo has already named twice: *a control that is absent looks exactly like a control that passed.*

### 2.1 The Operations Console serves fabricated numbers under `DEPLOY_PROFILE=enterprise`
`OperationsConsoleService` is constructed with only `{ certifications, outages, connectivity, pipeline, handover }` (`services/bff/src/app.ts:609-615`). The optional `slo`, `certChain` and `ozone` dependencies are **never supplied, in any profile**, so the console always falls through to `DemoSloReader`, `DemoCertChainSource` and `DemoOzoneHealthSource` (`services/bff/src/analytics/operations-console.ts:83,90,92`). No enterprise `SloReader` or `OzoneHealthSource` implementation exists anywhere in the repo. The docstrings claim otherwise — `ozone-health.ts:5-6` says "the enterprise adapter polls the real /health via P6".

The result: an adopting bank running the enterprise profile is shown a hardcoded `uptime_pct_30d: 99.8` (`services/bff/src/ops/ozone-health.ts:30`) and a green SLO panel, presented as operational truth. CLAUDE.md's fail-closed rule is explicit — an unconfigured enterprise adapter must throw, "rather than silently falling back to a fake."

The console is the most visible breach but **not the only one**. The scheduled worker constructs six more demo sources unconditionally, in any profile, with no `DEPLOY_PROFILE` selection and no enterprise counterpart: `DemoLiabilityEventSource` (`services/bff/src/worker.ts:389`), `DemoTppActivitySource` (`:398`), `DemoConsentDriftSource` (`:402`), `DemoCertChainSource` (`:405`), `DemoCaapEventSource` (`:408`) and `DemoLiabilityTelemetrySource` (`:416`), plus one more in the request path (`services/bff/src/app.ts:637`). All of these `Demo*` classes live in `services/bff/src`, not `packages/ports` — so none of them is profile-selected at all, which is why the fail-closed registry never sees them.

Two are materially worse than a green panel. The CAAP recorder (`worker.ts:408` → `services/bff/src/risk/caap-audit.ts:57-65`) writes fabricated registration events into `audit_high_sensitivity` — an INSERT-only table with no deletion path and five-year immutable retention — and its synthetic registration spike then drives the >10-per-device-per-hour rule (`services/bff/src/risk/consent-anomaly.ts:134-136`) into raising a real security signal from fake data. The certificate monitor (`worker.ts:405` → `services/bff/src/ops/cert-expiry.ts:124-133`) always reports the Al Tareq intermediate at +25 days and the bank end-entity at +5 days, so an enterprise bank gets a permanent fabricated *critical* certificate alarm — ITSM ticket and High-class audit every run — while the **real** scheme-certificate expiry is never observed at all. **Fix: fail closed across every demo-only source, not just the console (STD-11).**

### 2.2 The service-desk SLA clock does not pause at weekends
`services/bff/src/service-desk/service.ts:98` computes the due date as raw elapsed milliseconds: `new Date(now.getTime() + (SLA_MS_BY_PRIORITY[input.priority] ?? SLA_MS_BY_PRIORITY.P3!))`. PRD §10 makes weekend pausing a *binding* adopting-bank default, and `services/bff/src/business-hours.ts:2` records it as such. Every other SLA clock in the BFF honours it — disputes (`:118`, `:360`), approvals (`:126`), trust-framework (`:92`), respondent-disputes (`:157-158`, `:253`, `:260`). Service-desk is **the only SLA module in `services/bff/src` that does not import `business-hours`**. A P2 case opened Friday 16:00 shows as breached by Saturday 16:00. **Fix: folded into STD-03, which is already re-baselining these clocks.**

### 2.3 The liability monitor fails open on any unmodelled class
`services/bff/src/risk/liability.ts:47` returns `LIABILITY_MATRIX[event.issue] ?? 0`, and the threshold is derived from the *same* lookup (`:109-111`). So for an issue absent from the matrix both the accrued amount and the threshold are 0, and `accrued >= threshold` is `0 >= 0` — **true**. The monitor does not go quiet; it emits a `nebras_liability_approach` signal and two P3 ITSM tickets (`:119-122`) reporting the exposure as **AED 0 at `low` severity**, with the ref `<issue>|<party>|0`. The signal is not suppressed, it is silently worthless — which is harder to notice than silence, because the queue looks like it is working.

This matters because the matrix is genuinely incomplete: the scheme's **international-payment new-beneficiary breach** (AED 15,000 cap for 48 hours after beneficiary creation — per customer, per TPP, per bank; redress AED 1,000 plus direct losses) has no row, and the AED 15,000 figure appears nowhere in the repo. A real breach of that limit would monitor as AED 0. **Fix: add the row and make an unknown class throw rather than return 0 (STD-09).**

### 2.4 The highest-risk revoke path is the only one with no SLA verdict
`revoke.ts:92` and `bulk-revoke.ts:88` both compute `sla_met` against the 5-second scheme SLA. `services/bff/src/consents/fraud-revoke.ts:89,97` records `nebras_propagation_ms` but never compares it and emits no `sla_met` — it does not even import the constant. A <5s breach on a **fraud** revocation is invisible in the audit record. Related: `NEBRAS_SLA_MS = 5000` is declared independently in two modules (`revoke.ts:21`, `bulk-revoke.ts:26`) and the same NFR-18 threshold is restated a third time, in a different unit, as an SLO row (`slo.ts:56`). Three uncoordinated definitions of one regulatory SLA. **Fix: STD-09.**

### 2.5 The four-eyes bulk-revoke count can exceed what is actually revoked
The count shown to the **initiator** is computed with `REVOCABLE`, which includes `AwaitingAuthorization` (`apps/portal/src/components/care-console.tsx:44`, used at `:205,209`), while the approved sweep uses `ACTIVE_STATUSES = {Authorized, Suspended}` (`services/bff/src/consents/bulk-revoke.ts:34`). The operator-facing number can therefore exceed what the system will actually revoke, with nothing reconciling the two.

To be precise about the blast radius, because it is narrower than it first looks: the **approval record itself is not inflated**. The four-eyes wire projection allow-lists fields through `summariseOperation`, and `services/bff/src/approvals/operation-summary.ts:62-67` emits only a descriptor for `consents.bulk_revoke` — no count and no consent ids — so the second approver is never shown a number at all. This is an initiator-side display defect, not a corrupted four-eyes record. It still wants fixing, and the scheme-correct reading resolves it: `AwaitingAuthorization` is not yet granting access and is not revocable, so the portal set should shrink to match the sweep. **Fix: STD-05.**

### 2.6 Two collection-rail vocabularies that do not line up
`TenantCollectionRail` admits four values including `scheme_net_settlement`, and that is the shipped default preferred rail in both code (`packages/db/src/tenant-configuration.ts:46`) and DDL (`packages/db/migrations/0038_tenant_billing_service.sql:15`). But `billing_collection_invoice.selected_rail` CHECKs membership in only the other three (`packages/db/migrations/0035_billing_collections.sql:71`) — so **the shipped default preferred rail is not a persistable `selected_rail` value.**

This is a modelling divergence rather than a live write failure, and the distinction matters because the naive fix is wrong. Nothing today routes a collection on the tenant preferred rail: the write path is typed `DirectCollectionRail` (`packages/billing/src/collections.ts:130`), `eligibleCollectionRails` (`:133-143`) can never return `scheme_net_settlement`, and `services/bff/src/billing/collections.ts:171` throws before any database write if the selected rail is ineligible. The tenant policy value is only read back for display. The CHECK is therefore plausibly **correct by design** — scheme net settlement is not a direct-collection rail — and widening it would be the wrong repair. What is missing is an explicit relationship between the two vocabularies, before someone wires them together. BILLING-domain, with four PRs in flight — flagged here so it is not lost (STD-13, reassignable to BILL).

### 2.7 The watcher's direct-egress path — ruled 2026-08-18, and the ruling is narrow
`services/bff/src/billing/rate-card-watch.ts:171-183` defines `HttpRateCardSourceFetcher` calling `fetch` directly, and `services/bff/src/worker.ts:336-344` wires the watcher **without** a `fetcher`, so the default takes effect: direct outbound HTTPS from the Worker to two `nebras-open-finance.com` pricing pages and to the CBUAE Confluence page, with no P6 port in the path. CLAUDE.md declares P6 covers "ALL Nebras-bound traffic; no direct egress — non-negotiable."

**Ruled (a) — public documentation change-detection is outside P6** (ADR 0030, accepted 2026-08-18). Three facts decided it. P6 **cannot carry this as it stands**: `NebrasEgressPort` is seven purpose-built typed methods with no generic fetch, so routing documentation through it means adding a method to a regulated port interface, both adapters and the contract bench — real cost for poor fit. The rule's *purpose* points away from it: CLAUDE.md line 57 scopes P6 to the scheme certificate chain, i.e. authenticated mTLS API traffic, and one of the three watched URLs is CBUAE Confluence rather than a Nebras host at all — so a "P6 for Nebras-domain traffic" reading would leave direct egress anyway. And it will be **mediated regardless**: no bank grants a regulated workload unmediated outbound HTTPS, so in an enterprise estate this call traverses the bank's forward proxy whatever the ADR says.

The carve-out is narrow and conditional, not "docs are exempt": it covers unauthenticated GETs of public scheme documentation carrying no credentials and no PSU or bank data, used only for change detection — and it requires pinning the redirect behaviour (the fetcher currently sets `redirect: 'follow'` on an unauthenticated GET, which is SSRF-adjacent even with no credentials travelling) and keeping the fetcher injectable so a bank can point it at its own proxy without a code change. Net effect: **less** unmanaged egress than before the ruling.

### 2.8 The watcher's failures are invisible — its result is thrown away
Found while grounding that ruling, and the more consequential half of it. `rate-card-watch.ts:399` returns `{checkedSources, changedSources, failedSources, notificationFailures}` — and `services/bff/src/worker.ts:336` calls `runBillingRateCardWatch` inside `Promise.allSettled` and **discards the resolved value**. `failedSources` is never read anywhere. On a fetch failure the watcher emits one `billing_rate_card_watch_failed` audit row with `response_status: 502` (`:385-395`) and raises nothing else — no ITSM ticket, no risk signal.

So if a bank's forward proxy blocks the watched URLs, or a page moves, or DNS breaks, the watch is **dead and looks alive**: weekly audit rows nobody reads, and a queue that appears to be working. That is precisely the failure class this review is about, turned on the repo's own tooling — and ADR 0030 would have inherited it, pinning the regulatory baseline to a watcher whose silence is indistinguishable from "nothing changed". Hence the ADR's second binding amendment. **Fix: STD-15, which STD-01 now depends on.**

---

## 3. Priority 2 — there is no standards baseline, and no mechanism to notice one moving

**Confirmed negatives.** No file anywhere states the baseline as "v2.1-final + errata3". The string `errata` occurs three times in the whole repo, all on one line of a research document (`docs/research/lfi-billing-system-tier2.md:387`), all inside a source list, always plural, never as a pin. There is no errata number, no errata-resolution step, and no `standards_version` / `STANDARDS_BASELINE` constant — a repo-wide search returns only unrelated CloudEvents `specversion` hits.

The contract asserts a standards version in exactly **one** place: the `ConsentStatus` description at `specs/backoffice-openapi.yaml:3164` ("Full CBUAE v2.1-final lifecycle…"), mirrored into generated code at `packages/contracts/src/api-types.generated.ts:4768`. A version string living only in a description field, duplicated into a generated file, with no named constant, is not a pin.

**The pattern to copy is already in this repo and is excellent.** `packages/billing/src/rate-card.ts` has every element a baseline registry needs:

| element | location |
|---|---|
| versioned, deep-frozen constant with `version` / `label` / `effectiveFrom` / `source` | `:253-257` |
| a **structurally mandatory** `cite` string on every rate (`interface RateBase`) | `:5-8`, populated `:276-313` |
| effective-dating and per-tenant overlay | `rateCardAt` `:357`, `rateCardForTenant` `:370` |
| structural diffing | `diffRateCards` `:391` |
| mandatory High-class human review on change, `autoApply: false` | `prepareRateCardChangeReview` `:414-424` |
| content-hash upstream watcher emitting an OPEN review task | `detectUpstreamChange` `:433-449` |
| a weekly scheduled runner with a named principal | `rate-card-watch.ts:10-11` (`'0 2 * * 1'`) |
| explicit `ASSUMED` / `UNCONFIRMED` markers on unresolved scheme inputs | `:259-263` (`yearAnchor`), `:40-48` (free tier) |

**And the watcher already fetches three scheme URLs** — the Commercial & Pricing Model page and two Nebras pricing pages (`rate-card-watch.ts:18-31`). No errata source is **among them**. The mechanism that would close this entire gap exists and is simply not pointed at the standards source.

One precision that matters for what gets pinned, because the repo's own research file already draws the line and the ADR must not blur it. The Release Notes & Errata register at `nebras-open-finance.com` is filed at `docs/research/lfi-billing-system-tier2.md:387` under the heading **"Scheme (community, unofficial)"** — it is a community mirror. The official records are the CBUAE/OF Confluence pages listed at `:385`, including the consolidated errata page. Two of the three URLs the rate-card watcher already trusts are on the same community host, which slightly qualifies §1's praise of it as the best-governed artefact in the repo. **The official page should be the primary pin and the mirror a secondary early-warning source** — ADR 0030 states it that way rather than calling the mirror "the scheme's register".

**Two smaller notes on the pattern before it is copied:** `rate-card.ts:253` types the constant as plain `RateCard`, not `Readonly<RateCard>`, so immutability rests entirely on the runtime `deepFreeze` — a type-level mutation compiles. And the freshness qualifier "checked 12 Aug 2026" appears only on the chargeable-endpoint mirror (`:111`); the 26-entry non-chargeable mirror (`:165`) carries **no recorded verification date at all**.

**Re-certification nuance, so the plan does not overstate urgency:** the scheme's re-certification trigger is "any FAPI, Functional or CX changes" — it is change-triggered, not errata-triggered. Adopting errata3 does not by itself force re-certification. errata3's substance (international-payment creditor restructured into Individual/Organization variants for SWIFT SR2026, and the Creditor Agent address alignment) touches **international payments only** and OFBO initiates no payments — so the correct posture is *pin and watch*, not *scramble*.

### 3.1 Stale ground truth the doc gate cannot see
The PRD claimed **57 paths, 9 tags**; the spec has **93 paths, 12 tags** (independently counted; `paths:` spans `:37-2628`). Three PRD lines carried the stale count, and the per-tag table omitted three whole tags (`governance`, `agents`, `readiness`), had seven of its nine per-tag numbers wrong (only `approvals` and `audit`, both 5, were right), and already summed to 59 against its own stated 57. **This changeset repairs all of that by hand**; the stale figure still stands in a rendered diagram (`docs/diagrams/architecture.svg:119`), which STD-14 covers.

The correct numbers exist elsewhere and are machine-enforced: `README.md:69` says 93/12 and `packages/contracts/test/spec.spec.ts:10-13` asserts it. `scripts/doc-link-check.mjs` checks that claim **in the README only**. CLAUDE.md names the PRD as spec canon, yet the PRD is the one canonical surface CI cannot check — which is exactly why it rotted silently. Two adjacent README claims are also stale and currently unchecked: "BD-01..16" (`:68`, `:127`; §10 now runs to BD-22) and "159 backlog items are done" (`:5`; the real count is 161, and the gate's regex at `scripts/doc-link-check.mjs:126` does not match the README's phrasing, so **that check is dead** — a gate that is silently inert, which is this review's own thesis turned on the repo's tooling). Repairing the counts by hand, as this changeset does, is an interim; **STD-14** makes them machine-checked so they cannot rot again.

### 3.2 The one enumerated scheme-deadline register in the repo is itself ungoverned
`services/bff/src/analytics/programme.ts:20-24` hardcodes `CBUAE_RELEASE_CALENDAR` — `OF-2026-Q2` "Open Finance v2.1 conformance" (deadline 2026-06-30, marked delivered), `OF-2026-Q3` insurance data-sharing onboarding (2026-09-30), `OF-2026-Q4` CAAP migration (2026-12-31). It feeds a board-facing programme view, and it is uncited, unversioned, and unwatched: three dates that came from somewhere, with no source URL, no verified-on, and nothing that notices when the scheme's roadmap moves. It is the closest thing the repo has to a compliance-deadline register, and it is exactly the artefact this section says should be pinned. `STANDARDS_BASELINE` as proposed in ADR 0030 does not currently cover it — **it should**, and STD-01's scope says so.

---

## 4. Priority 3 — Interaction Guide v5.0 was received, recorded, and never applied

This is the sharpest governance failure in the review, and the repo already knows about it.

`docs/PRD_Open_Finance_Back_Office.md:373` (BD-16) records: **"IG v5.0 received 2026-08-17"**, that §8 publishes **30/5/10/15 calendar-day** dispute-stage clocks and §11 gives **15-day maintenance / 30-day version-release** notices, and that these must be *"reconcile[d] with the BACKOFFICE-75/-78 configured clocks in a follow-up story"*. `docs/build-log.md:2446-2449` promises the same follow-up.

**That story does not exist.** An exhaustive search of `docs/backlog.yaml` finds no item, under any id or status, for the IG v5.0 reconciliation. The promise was made in two documents and never written into the one file the build loop reads — so the loop cannot pick it up, and the code stays on v4 figures indefinitely. Creating it is the single highest-value output of this review.

**What is actually divergent:**

| surface | shipped | IG v5.0 | note |
|---|---|---|---|
| Respondent dispute clocks | 3 / 15 / 3 / 3 **business** days (`respondent-disputes/service.ts:31-34`) | inter-participant resolution timelines still 3 bd / 15 bd / 3 bd / 3 bd | **values are right**; only the *attribution* is stale |
| Dispute **stage** clocks | not modelled | 30 / 5 / 10 / 15 **calendar** days (§8) | genuinely missing |
| Service-desk SLA | single clock: P1 4h, P2 24h, P3 3d, P4 5d (`service-desk/service.ts:30`) | **respond + resolve pairs**: P1 2h/4h, P2 3h/6h, P3 10h/3bd, P4 3bd/11bd (§9.4) | shape is wrong, not just the numbers |
| Notice periods | 30d breaking, **10d** for both maintenance *and* version release (`scheme-notifications/service.ts:29-30,33-35`) | 48h downtime, **15d** release-schedule/patch, **30d** new version (§11) | 48h forces hours granularity |

Three second-order findings compound it:

- **The unit is wrong, not only the value.** A 15-*business*-day resolution clock is ~21 calendar days, and nothing reconciles the two. There is no *shared* calendar-day due-date helper alongside `business-hours.ts`; the calendar arithmetic that does exist is scattered and private — `noticeDeadline` (`services/bff/src/scheme-notifications/service.ts:38`), `addDays` (`services/bff/src/risk/liability-forecast.ts:176`), a local `plus` (`services/bff/src/ops/cert-expiry.ts:127`). STD-02 should **consolidate** these rather than add a fourth.
- **"Configurable" is asserted but not implemented.** BD-16's working assumption is "clocks configurable per class", and the runtime adoption catalogue repeats it to users: `services/bff/src/readiness/catalog.ts:195` still advertises *"Build on v4 figures (clocks configurable)"*. In fact every clock is a hardcoded, non-exported module constant with no env, config, tenant or deps override. An adopting bank cannot change any of them without a code change — and that same catalogue entry is a **user-facing surface still asserting a superseded baseline**.
- **Re-baselining cannot be applied to open cases.** `packages/db/src/service-desk-case-store.ts:12-27` persists one computed `sla_due_at` and no policy reference, so historical cases silently retain whatever constant was compiled in at creation. The same is true of the respondent-dispute due columns.

Two smaller ones worth fixing while in the file: the OpenAPI notice-period text (`specs/backoffice-openapi.yaml:1516-1517`) states the 10d/30d figures with **no version attribution and no calendar/business unit** — unlike the respondent block at `:685-688`, which does say "Interaction Guide v4 defaults". And `AMBER_WINDOW_MS` is a calendar 24h applied to business-day due dates (`respondent-disputes/service.ts:37`, used `:52`), so a Monday deadline turns amber on **Sunday** — inside the weekend the same module treats as non-counting.

---

## 5. Priority 4 — consent, rail and simulator fidelity

### 5.1 The consent vocabulary is PSD2, not UAE Open Finance
`packages/synthetic-data/src/index.ts:179-184` defines purposes as `AISP_DATA_SHARING` / `SIP_PAYMENT` / `COP_CONFIRMATION` with OAuth-style scopes (`accounts:read`, `balances:read`, `transactions:read`, `payments:initiate`, `cop:confirm`), under a comment calling them "OF v2.1 data-scope sets". `AISP` is UK/EU terminology; the UAE roles are **BDSP / BSIP / ISP**, and the data vocabulary is the permission-code set (`ReadAccountsBasic`, `ReadBalances`, `ReadTransactionsDetail`, … plus errata2's `ReadStatements` and `ReadProductFinanceRates`, as a flat string array — errata2 flattened it from array-of-arrays). The contract does not constrain any of it: `purpose` is unconstrained free text with `AISP_DATA_SHARING` as its example (`specs/backoffice-openapi.yaml:3241`).

**Consent types are absent entirely.** No `consent_type`, no single-use / long-lived / combined distinction anywhere in code, schema, or contract — confirmed by exhaustive search. The only expiry logic is fixture behaviour: `expires_at` is `null` for `AwaitingAuthorization` and `Rejected`, and `granted_at + 12 months` for the other five (`index.ts:275`) — including `Expired` and `Revoked`, so an *expired* consent carries a *future* expiry. No max-validity rule, CHECK, or validation exists; the spec field is an unconstrained nullable date-time (`:3245`). Note ADR 0009 (VRP/FRP mandates, **Proposed**) already names this gap at its lines 16-18.

### 5.2 The simulator is a fixture server, not a Hub model
`services/nebras-sim/src/app.ts` is 199 lines serving nine handlers. Against the standard:

- **`x-fapi-interaction-id` is never echoed.** The only response header the simulator ever sets is `retry-after` (`:80`). The demo P6 adapter *sends* the header on every call (`packages/ports/src/adapters/sim.ts:225,243,265,288`) and the BFF echoes it on its own responses (`services/bff/src/app.ts:782`) — so CLAUDE.md's "propagated end-to-end" guarantee terminates at the Hub boundary. Per the standard this header is **mandatory on responses** and is the correlation key Nebras support requires on every ticket, so this is a genuine conformance gap, not cosmetics.
- **No consent state machine.** `GET /consent-manager/consents/:id` returns a fabricated `Authorized` for *any* unknown id via the `?? 'Authorized'` fallback at `:105`; there is no 404 branch. `POST …/revoke` always returns 200 with no state check, no idempotency key, and no authentication (only `/admin/*` is guarded, `:61-69`). API Hub release **2026.22.0** changed revocation in a non-revocable state to **HTTP 400** (was 204) — the simulator cannot model it.
- **The two report surfaces are incoherent with the Consent Manager.** The Consent Manager map is built once from `generateDemoDataset()` at `DEFAULT_SEED = 20260611` (`:49-50`), while `GET /datasets/consents/:period` regenerates from `periodSeed('consents:<period>')` (`:158`). Measured overlap is **zero ids for every 2026 period**, and no `YYYY-MM` period hashes to the default seed. Combined with the fallback above, a cross-surface reconciliation reads **every** dataset consent as `Authorized`. Consents for the other two demo tenants (`index.ts:79-81`) hit the same fabrication.
- **Only the first injected fault of each kind is reachable.** `activeFault` does `faults.find(...)` over an append-only array (`:71-72`, writer `:187`, only bulk clear `:194`). Re-injecting a fault of a kind already present is silently inert. Worse for `report_rate_limit`, which decrements the *first* fault's counter in place (`:77-80`) and is never spliced out, so an exhausted fault permanently shadows re-injection while `GET /admin/faults` still reports it active with `fail_times: 0`.
- **Two incompatible error envelopes** — `{error:{code,message}}` on hub routes (`:81`, `:127`) versus a bare string `{error: "…"}` on all five admin validation paths (`:172,175,179,182,185`).
- **Case-id collision, conditionally.** The case id seeds on `${dispute_type}|${originating_payment_id ?? psu_identifier ?? 'na'}` (`:116`). `originating_payment_id` is optional and nullable in the contract (`specs/backoffice-openapi.yaml:3289`) and is passed through verbatim (`disputes/service.ts:198`), so any dispute raised without it degrades to `dispute_type|psu_identifier` — and every later dispute of that type for that PSU returns the *pre-existing* case (`:117-120`) instead of opening a new one. Separately: a raw `psu_identifier` crosses the egress boundary and is hashed with djb2 (`:55-59`), a non-cryptographic 32-bit function over a low-entropy seed — worth checking against the zero-PII hard stop even though the demo data is synthetic.

### 5.3 Two of seven P6 operations are not exercised by the port-swap gate
`NebrasEgressPort` declares seven methods (`packages/ports/src/interfaces.ts:85-106`). The simulator serves HTTP routes for five. **`syncDirectory` and `dispatchRefund` have no simulator route at all** — the demo adapter answers them from in-process constants: a hardcoded three-row `DIRECTORY` (`packages/ports/src/adapters/sim.ts:193-197`) and a fixed `ipp_status: 'ACSP'` (`:276-279`). Meanwhile the enterprise adapter really calls `GET /directory` (`nebras-egress.ts:87`) and `POST /payment-consents/{id}/refund` (`:90-97`).

CLAUDE.md states the contract tests bind both adapters through the port interface — that is the M6 port-swap acceptance gate. For these two operations **the gate is structurally unable to detect a defect in the enterprise call.** Two knock-on effects: the fixed `'ACSP'` makes the negative IPP paths (notably `RJCT`) unreachable in the demo, so a rejected refund cannot be demonstrated and there is no fault kind for it; and the refund **transport disagrees with the scheme** — `specs/backoffice-openapi.yaml:657-660` describes the Ozone Connect flow as `GET /payment-consents/{consentId}/refund` (which is also how the scheme's chargeable-endpoint table lists it) while the adapter issues a `POST`.

### 5.4 Payment-rail vocabulary is missing, and V2.2 already has a date
`UAEFTS` appears **nowhere** in the repo (two independent exhaustive searches over 994 files). The domestic execution model is LFI-selected — intra-bank for same-LFI, **AANI as the primary inter-bank rail with automatic UAEFTS fallback** — and the terminal status differs by rail (**ACWP** on AANI, **ACCC** on UAEFTS/intra-bank). The repo models five IPP codes (`ACCC, ACSP, ACSC, RJCT, PDNG`, `index.ts:190`) and neither `ACWP` nor `ACWC` appears anywhere. No `rail` field exists on any payment object (the `rail` hits in migrations are BILLING *collection* rails, a different concept).

The contract does not constrain this either: `ipp_status` is declared as a bare string with a prose description and **no enum** (`specs/backoffice-openapi.yaml:3278`), with the five codes hardcoded in three independent places — contrast `LineType` at `:3147`, which *is* enumerated. A sixth code from a real hub would pass schema validation silently.

This is not a hypothetical: the repo already records that **Standards V2.2 makes `paymentRail` (AANI/FTS/LFI) mandatory** on terminal payment-log entries, with Tier 2 dates of 28 Feb 2027 release / 31 May 2027 go-live (`docs/research/lfi-billing-system-tier2.md:80,191`). A dated, in-repo forward obligation with no delivery hook.

Also in this cluster: `LINE_TYPES` in the generator (`index.ts:96`) has five members and lacks `dao_api_call`, which both the contract (`:3147`) and migration `0021_dao_line_type.sql:8` carry.

---

## 6. Priority 5 — attribution and provenance hygiene

### 6.1 A shipped feature traces to the wrong ADR, in eight places
At `c5ba31b` the P10 / STR workflow was attributed to **ADR 0022** in eight places: `CLAUDE.md:19` *(corrected to ADR 0010 by this changeset — seven remain)*; `packages/ports/src/interfaces.ts:178`; `packages/ports/test/str-workflow.spec.ts:5`; `services/bff/src/str/service.ts:9`; `services/bff/src/str/routes.ts:11`; `services/bff/test/str-drafts.spec.ts:10`; `apps/portal/src/components/str-draft-queue.tsx:6`; `apps/portal/test/str-draft-queue.spec.tsx:14`.

ADR 0022 is *"Public pre-login `/public/*` carve-out for the Integration Readiness Wizard"* — Accepted 2026-06-25, containing no mention of STR, AML or P10. The real record is **ADR 0010 — AML GO STR submission (close BACKOFFICE-63)**, whose status is still `**Proposed** — awaiting human decision` and whose Decision still reads `_Pending._`. Before this changeset ADR 0010 was cited **nowhere** in the codebase. A ninth site attributes the same feature to a *third* ADR: the enterprise adapter cites ADR 0024 (`packages/ports/src/adapters/enterprise/str-workflow.ts:5`).

The substance matters more than the numbering. **BACKOFFICE-63 is marked `done`** (`docs/backlog.yaml:1062`) against an ADR that was never accepted, and the as-built diverges from that ADR's recommended Option 1 in three ways:

1. ADR 0010 Option 1 proposed submitting to AML GO **via P6 egress**; what shipped is a one-way handoff to the bank's own STR system (P10) that never touches AML GO. *(This is arguably the better design and matches CLAUDE.md's P10 description — but it is a different decision, unrecorded.)*
2. Option 1 required tracking `drafted / submitted / **acknowledged**`. The shipped states are `draft | awaiting_handoff | handed_off` (`services/bff/src/str/service.ts:23`) — there is **no acknowledged state**, so once P10 returns a `workflow_ref` the Back Office has no evidence the report was actually filed. That is precisely the risk ADR 0010:14-15 was raised to close, and ADR 0010:62 still records the standing gap.
3. ADR 0010:27-28 required STR traffic "routed via the bank's egress, never direct"; the enterprise adapter uses `globalThis.fetch` directly (`str-workflow.ts:44,54`). Not a P6 violation — P6 is Nebras-scoped — but no ADR records the exemption for AML-sensitive traffic.

Under CLAUDE.md rule 6 a new port is a new platform primitive requiring an accepted ADR. **ADR 0011 (revoke-SLA enforcement) shows the identical pattern**: still `Proposed`, while the 5-second SLA it governs is live in three places.

### 6.2 Institution fixture provenance is asserted only in prose
`packages/db/src/seed-demo.ts:404-412` defines six TPP fixtures. Four use **real UAE company names** and are commented `// real` (YAP Digital, Sarwa Digital Wealth, Mamo Pay, Baraka Financial); two carrying adverse states are `// FICTIONAL`. The policy comment at `:397-399` — real names only for healthy states, fictional for anything adverse — is a sound and deliberate rule.

The gap is the **identifiers**: all six carry real-format `CN-xxxxxxx` UAE registration numbers, and the policy comment justifies only the *names*. Contrast the person-level convention, which is explicit and enforced: `packages/synthetic-data/src/index.ts:108-110` documents the 999-prefixed (never 784) Emirates IDs and `000` (never real) bank code "so the zero real PII guarantee holds". No equivalent never-real convention exists for institution registration numbers, and `packages/db/test/seed-demo.int.spec.ts:78,80` pins the live format (`registration_number LIKE 'CN-100%'`). The real-name rule is also enforced by two prose comments in two different packages with no shared constant, test, or lint check binding it.

### 6.3 A resolvable hedge, now resolved
`services/bff/src/reconciliation/fee-schedule.ts:12-13` declares the CoP-with-payment bundling window "flagged uncertain in the PRD", while `packages/billing/src/rate-card.ts:295` already encodes `windowHours: 2` with an unhedged citation — two modules contradicting each other on one scheme parameter, neither cross-referencing the other. The scheme is unambiguous: **2 hours, and one payment discounts exactly one balance call AND one CoP call**. This changeset retires the PRD half of the hedge; the `fee-schedule.ts` comment remains, and STD-09 closes it.

---

## 7. Priority 6 — the Ozone Connect operational policies are not encoded

`services/bff/src/analytics/operations-console.ts:26-28` declares `const SLA_TARGETS = { end_to_end_ms: 500, lfi_internal_ms: 250 }` (module-private, no config seam). The 500ms is right as a headline, but the **operative** rule since 22 Apr 2026 is finer:

- **Response time:** 500 ms **at p95, per Ozone Connect endpoint**, measured as **TTLB from the Hub issuing the request to the Hub receiving the final byte**. The published Benchmarks standard says 500ms *average*; the policy holds each endpoint to p95 and is the enforcement rule. Degradation severities: **P1** = payment-execution p95 >1000 ms for ≥15 min, or any family p95 >1500 ms for ≥15 min; **P2** = endpoint p95 >750 ms for ≥30 min. The 500ms target applies to the **acknowledgement only** — screening runs after the response, and the 3-second Aani end-to-end rule is a separate scheme rule.
- **Availability:** 99.5% per **calendar month** (≈3 h 39 m), with **planned maintenance counted** (no offline quota) and **partial outages counted**. P1 ack 15 min / updates ≤30 min; P2 ack 1 h / updates ≤2 h; **PIR within 5 business days** for every P1 and any P2 recurring within 30 days.

**None of the five items above exists in the repo** — verified by targeted search for p95/TTLB, 1500/750, calendar-month/error-budget, 15min/30min, and PIR/post-incident. The near-misses are all prose: `slo.ts:59` carries `'Back Office API p95 < 1.5s'` inside a *description string* with no latency field on `SloObservation` (`:9-17`), so nothing can evaluate or alert on it; `specs/backoffice-openapi.yaml:914` asserts a `<1.5s p95` target that `reconciliation-slo.ts` neither measures nor enforces.

Two more inconsistencies in the same response: `ozone-health.ts:30` reports `uptime_pct_30d: 99.8` while `slo.ts:58` declares a 99.5% connectivity-uptime target — both ride the same payload (`operations-console.ts:139,141`) computed by unrelated paths and never compared. And none of these numbers is under contract: the console returns the generic `AnalyticsView` whose `data` is free-form (`specs/backoffice-openapi.yaml:825-834`), so `sla_targets` appears nowhere in the spec and `pnpm verify:contract` cannot detect drift in them. They are pinned only by one unit test (`services/bff/test/operations-console.spec.ts:46`).

**Context the fix should respect:** `docs/reviews/improvement-plan-2026-08.md:102` already proposes the repo's only per-endpoint latency work (a "slowest 50 endpoints" delay-ratio report) and explicitly notes it needs *no* per-endpoint SLA config. The codebase has deliberately avoided per-endpoint targets. STD-10 should therefore encode the **policy** (targets, severities, budget, PIR clocks) as a cited constant set, and leave per-endpoint measurement to that separate story — and it supersedes that plan's §5.3-11 suggestion to import the UK OBIE downtime definition, because the UAE scheme now publishes its own operative one.

---

## 8. What is clean (verified, not assumed)

Recording this deliberately — several of these were tested specifically to try to *refute* them:

- **Architecture invariants.** No text or code anywhere implies a TPP calling the LFI directly, the bank issuing access tokens, a local consent authority, or an egress path bypassing P6 for Hub traffic. The internal token-minting surfaces (care-surface, agent session) are internal ops credentials with `act`/`sub` internal refs and ≤15-minute lifetimes — explicitly not scheme tokens, with FAPI posture restated as untouched in ADR 0018.
- **The consent enum**, exactly as in §1.
- **The liability matrix values** — all nine amounts and the tiered band verified against the Limitation of Liability Model v2.1, with no wrong values and no extra keys. (The gap is a *missing* row, §2.3, not a wrong one.)
- **The rate card** — bps schedule 38/35/32/29/25 with the AED 50 cap and AED 200/merchant/day free allowance, 25 fils P2P, stepped me-to-me, 25/250 fils bulk, AED 4 large-value above AED 5,000, 250 fils corporate, 40 fils/page corporate data, 15/5-page retail free tier, 2.5/0.5 fils Hub rates with the 2-hour pairing window, and 5/7.5/10/12.5 fils quote tiers — all match the published model.
- **Money handling** — integer minor units with ISO 4217 on the wire, milli-fils internally with half-up rounding and an explicit converter; the reconciliation loader throws on a non-whole-fils input rather than rounding silently.
- **PSU PII posture** — synthetic by construction and enforced by assertions in both the generator tests and the seeded-DB integration tests.
- **Determinism** — the synthetic dataset is byte-repeatable, with derived fields deliberately consuming no RNG draws to preserve the sequence.
- **Ecosystem coverage** — Aani, IPP, CoP, CAAP, AML GO, Ozone Connect, Raidiam/Trust Framework, Sanadak, UAEDDS and the 2-hour Aani fund-recall window are all present and correctly used.

---

## 9. Human decision queue

Five items needed a person. **Two are now decided** (2026-08-18) and are recorded here rather than removed, so the record shows what was settled and on what basis.

1. ~~**ADR 0030**~~ — **ACCEPTED 2026-08-18**, adopting Option 1 with two binding amendments: the egress ruling below, and *the watch must fail loudly* (§2.8) before a regulatory baseline rides on it. STD-01 is unblocked and now depends on STD-15.
2. ~~**The P6 egress ruling (§2.7)**~~ — **RULED (a), 2026-08-18**: public-documentation change-detection is outside P6, narrowed to unauthenticated GETs carrying no credentials and no PSU or bank data, and conditional on pinning the redirect behaviour and keeping the fetcher injectable for bank-side mediation. Recorded in ADR 0030 and to be commented at the call site.
3. **ADR 0010 (STR/AML)** — **parked by the owner, 2026-08-18** ("fine for now"). Recorded so it is not mistaken for resolved: BACKOFFICE-63 remains `done` against a `Proposed` ADR, and the missing `acknowledged` state means the bank still has **no evidence an STR was ever filed**. The as-built note added by this review documents the divergence; the decision stays open.
4. **ADR 0011 (revoke-SLA enforcement).** Same pattern — `Proposed`, already implemented. Still open.
5. **STANDARDS block priority.** The new block is placed after M6 and before COMMERCIAL, and ordered internally so `STD-09` is first — so `/next-story` will pick the dependency-free defects ahead of the pending VAL-01 and BILL-13..17. BILL-13 through BILL-16 already have draft PRs in flight (#319, #320, #321, #323). If BILL should finish first, move the whole block to sit beside HARNESS — file position is the only thing that decides this, so it is a placement decision rather than a code one.

**The refuted claim, recorded because the negative is the finding:** we tested the hypothesis that a backlog story already existed for the IG v5.0 reconciliation. It does not, under any id or status. The follow-up promised at `PRD:373` and `build-log.md:2446-2449` was never written into the file the loop reads.

---

## 10. Sequencing

Fifteen stories, `STD-01..STD-15`, filed in `docs/backlog.yaml`. Spec-first stories open a spec-only PR before implementation, per the repo's own workflow rule.

**The block is laid out in execution order, not id order**, because `/next-story` picks the first eligible `pending` item in file order (`.claude/skills/next-story/SKILL.md:12`) — so position, not intent, decides what gets built. The dependency-free defects are physically first.

**Now — no dependencies, no contract change:**
`STD-09` (liability completeness + fail-loud + single-source `NEBRAS_SLA_MS` + fraud-revoke SLA verdict) · `STD-10` (Ozone Connect policy constants) · `STD-11` (fail closed on every demo-only source under the enterprise profile) · `STD-12` (ADR attribution + fixture provenance) · `STD-13` (the two collection-rail vocabularies) · `STD-14` (make the PRD/README ground-truth claims machine-checked, and revive the dead backlog-count gate) · `STD-15` (§2.8 — make the rate-card watcher's failures visible).

**Then the registry, now that ADR 0030 is accepted:** `STD-01`, depending on `STD-15`.

**Next — the Interaction Guide re-baseline, each spec-first and independent of the others:**
`STD-02` (dispute clocks + the calendar-day helper) · `STD-03` (service-desk respond/resolve pairs, and the weekend-pause fix from §2.2) · `STD-04` (notice periods, hours granularity).

**Then — the fidelity chain, in order:**
`STD-05` (permission codes, consent types, validity, REVOCABLE/ACTIVE alignment) → `STD-06` (simulator state machine, FAPI echo, fault queue, envelopes, seeding coherence) → `STD-07` (P6 simulator surface parity + refund transport + `dao_api_call`). `STD-08` (rail vocabulary) also follows `STD-05` — same generator file.

**Nothing in the block is blocked on a human any more.** ADR 0030's acceptance unblocked the only such story.

Verification per story is recorded in its acceptance criteria. The pinned values that will legitimately change — and must be updated in-story rather than worked around — are `scheme-notifications.spec.ts:50-80`, `operations-console.spec.ts:46`, `port-contracts.spec.ts:153` with `nebras-egress.spec.ts:52`, the simulator's `sim.spec.ts:16-25` (which currently locks in "any id is revocable"), and the `seed-demo.int.spec.ts` TPP fixtures. `respondent-disputes.spec.ts:95-97` does **not** change — those values are correct under v5.0; only their attribution is stale.

---

## 11. What not to do

- **Don't rewrite the respondent-dispute clock values.** 3/15/3/3 business days match the v5.0 inter-participant timelines. The defect is the missing *stage* clocks and the stale v4 attribution — changing the numbers would introduce a real error while fixing a cosmetic one.
- **Don't treat errata3 as urgent delivery.** It touches international-payment creditor structures only, OFBO initiates no payments, and re-certification is change-triggered rather than errata-triggered. Pin it and watch it; do not schedule work against it.
- **Don't add a table for the standards baseline.** In-code constants reuse the existing risk-signal and ITSM sinks. A new regulated table inherits RLS, INSERT-only audit, 24/60-month retention, classification and write-time lineage for no benefit — ADR 0030 defaults to the pure option for exactly this reason.
- **Don't weaken `sim.spec.ts` to make the new state machine pass.** Tightening the simulator will read as a test change to the Q1b integrity gate; the assertions must be *strengthened* to track the new contract, on a normal story branch, with the reasoning in the PR.
- **Don't let the hand-repaired PRD table stand as the fix.** This changeset repaired it by hand because a wrong table is worse than a stale one, but the counts rotted precisely because nothing checks them — and the README's own backlog-count gate is currently dead. **STD-14** extends `scripts/doc-link-check.mjs` to the PRD and revives that check; until it lands, the counts will rot again.
- **Don't let STD-06/07 quietly change the demo.** `docs/demo-script.md` and the run-ofbo skill depend on the current fault-injection behaviour; the fault semantics must keep working through the rework.

---

## Appendix — baseline sources

Standards register and errata (v2.1-final, errata1–3) and the API Hub 2026.x release notes, via the community hub Release Notes & Erratas register and the OF Confluence "Standards V2.1 & API Hub V8 — Consolidated Errata" page · Nebras Interaction Guide for LFIs and TPPs v5.0 (Jun 2026), §8 disputes, §9.4 incident priorities, §10 billing cycle, §11 notifications · Limitation of Liability Model (doc v2.1) · Commercial and Pricing Model v1.0 (4 Oct 2024, page state 2 Jun 2026) · Ozone Connect Availability, Response Time and Data Quality policies (updated 21–22 Apr 2026) · LFI Major-Version Deprecation Policy · Secure Management of Keys and Credentials · UAE FAPI 2.0 profile and traceability rules for `x-fapi-interaction-id` · CBUAE Open Finance Regulation C 3/2025 (Articles 13, 21).

Time-sensitive figures — pricing, liability amounts, SLA numbers, errata level — should be re-confirmed against the scheme sources before being relied on commercially. That re-confirmation is exactly what STD-01 automates.
