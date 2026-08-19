# ADR 0030 — Standards-baseline registry and errata watch (pin the scheme, notice when it moves)

- Status: **Accepted** — chosen by the user (2026-08-18). Adopts Option 1 with two amendments:
  the watch must fail LOUDLY (see Consequences), and the egress question below is ruled **(a)**,
  narrowed and conditioned as recorded there.
- Date: 2026-08-18
- Scope: a **governance mechanism**, not a product feature — it introduces a new named constant set and
  points an existing scheduled watcher at a new source. CLAUDE.md rule 6 says a new platform mechanism is
  invented only via an ADR a human accepts, and rule 6 is the reason this record exists rather than a story.
- Related: `docs/reviews/standards-conformance-2026-08.md` (the review that raised it, §3), backlog
  **STD-01** (realises this ADR; unblocked on acceptance) and **STD-15** (the fail-loud prerequisite);
  **STD-02/03/04** (the drift it would have caught); **ADR 0007**
  (rate-card provenance, whose pattern this copies); **ADR 0020** (the doc-drift gate, the nearest precedent
  for a governance-only control); `packages/billing/src/rate-card.ts`,
  `services/bff/src/billing/rate-card-watch.ts`.

## Context

OFBO is built against the UAE Open Finance Standards, the Nebras Interaction Guide, the Limitation of
Liability Model and the Commercial & Pricing Model. Four external documents, each versioned independently,
each revised without warning, and each supplying numbers the code enforces.

**Exactly one of the four is governed.** `packages/billing/src/rate-card.ts` pins the Commercial & Pricing
Model as a deep-frozen constant carrying `version`, `label`, `effectiveFrom` and `source`; makes a `cite`
string structurally mandatory on every rate (`RateBase`); supports effective-dating and per-tenant overlay;
diffs two cards; and routes any change through `prepareRateCardChangeReview`, which returns
`classification: 'High'`, `requiresApproval: true`, `autoApply: false`. A weekly job
(`services/bff/src/billing/rate-card-watch.ts`, cron `0 2 * * 1`) fetches the upstream pages, hashes the
normalised text, and opens a `RATE_CARD_UPSTREAM_REVIEW` task when the hash moves. It even records unresolved
scheme inputs honestly, with an explicit `ASSUMED` marker on the year-step anchor.

The other three have nothing. The Standards version appears in the repo as **free text in one OpenAPI
description** (`specs/backoffice-openapi.yaml:3164`, mirrored into `packages/contracts/src/api-types.generated.ts:4768`),
never as a named constant. The current errata level is absent entirely — the word "errata" occurs three
times in the whole repo, all on one line of a research document, all inside a source list. There is no
`standards_version`, no `STANDARDS_BASELINE`, and no errata-resolution step anywhere in code, specs or tests.

The cost of that gap is already realised and documented. **Nebras Interaction Guide v5.0 arrived on
2026-08-17.** It was read, and its deltas were written into `docs/PRD_Open_Finance_Back_Office.md:373`
(BD-16) — 30/5/10/15 calendar-day dispute-stage clocks in §8, 15-day maintenance and 30-day version-release
notices in §11. Then nothing happened. The code still runs v4 figures in
`services/bff/src/respondent-disputes/service.ts`, `services/bff/src/service-desk/service.ts` and
`services/bff/src/scheme-notifications/service.ts`; the promised follow-up story was never written into the
backlog; the runtime adoption catalogue still advertises "Interaction Guide v4 figures" to users
(`services/bff/src/readiness/catalog.ts:195`); and **no gate anywhere can tell.** A guide version can be
superseded, recorded, and silently ignored, and CI stays green.

The decisive observation is that the fix is nearly free: `rate-card-watch.ts:18-31` already watches three
scheme URLs. No errata source is among them. **The mechanism that would have caught the v5.0 drift exists
and is pointed at the wrong pages.**

**Source authority — get this right before wiring anything.** The Release Notes & Errata register at
`nebras-open-finance.com` is filed in this repo's own research at `docs/research/lfi-billing-system-tier2.md:387`
under the heading "Scheme (community, unofficial)". It is a **community mirror**. The official records are
the CBUAE/OF Confluence pages at `:385` — including the consolidated errata page. Two of the three URLs the
rate-card watcher already trusts sit on that same community host, so this ADR is not introducing the issue,
but it must not compound it: pinning a *regulatory conformance baseline* to an unofficial mirror while
calling it "the scheme's register" would be exactly the kind of unexamined provenance this record exists to
end. **The official Confluence page is the primary pin; the community mirror is a secondary, early-warning
source** — it is often faster, which is worth having, but it is not authority.

## Decision drivers

- **Notice, not compliance.** The goal is to make an upstream move *visible and owned*, not to auto-adopt it.
  Auto-applying a scheme change to regulated behaviour is precisely what must not happen.
- **Compose, don't invent** (CLAUDE.md rule 6). The change-review envelope, the High-classification review
  task, the ITSM and risk-signal sinks, and the weekly scheduled principal all already exist.
- **No new regulated substrate unless it earns its place.** A new table inherits RLS, INSERT-only audit,
  24/60-month retention, classification and write-time lineage. A pin does not need any of that.
- **Cite everything.** The rate card's mandatory `cite` field is the single practice most worth copying:
  it makes an uncited number impossible to add rather than merely discouraged.
- **Say what is unknown.** The `ASSUMED` marker on the year anchor is the pattern for a baseline fact the
  scheme has not settled — an honest marker beats a confident wrong value.

## The model

One named, deep-frozen baseline naming every scheme document the code depends on, each with its version,
effective date, source and verification date:

```
STANDARDS_BASELINE
  standards      v2.1-final + errata3   (doc-level 30 Jun 2026 / spec register 8 Jul 2026)
  apiHub         v8                     (releases 2026.19.0, 2026.22.0)
  interactionGuide v5.0                 (Jun 2026)
  liabilityModel v2.1
  pricingModel   v1.0                   (4 Oct 2024, page state 2 Jun 2026)  → already pinned by the rate card
  ozonePolicies  availability / response-time / data-quality (21–22 Apr 2026)
```

Three properties, all borrowed rather than invented:

1. **Every consumer cites a baseline key.** The clock, liability and SLA constants that today sit as bare
   module numbers carry a `cite` referring to a baseline entry — the same structural obligation `RateBase`
   already imposes on every rate. This is what turns "3 business days" into "3 business days, per
   Interaction Guide v5.0 §8, verified 2026-08-18".
2. **Errata resolve per file, and the pin says so.** The scheme's rule is that the highest errata folder
   containing a file wins; a baseline that records only "v2.1-final" is not precise enough to act on.
3. **A move opens a review, never a change.** The existing watcher gains the errata sources — official
   Confluence page as primary, community mirror as secondary — and emits the same High-classification,
   `autoApply: false` review task, notifying Compliance and Operations. A human decides what the move means.

Scope note: the baseline should also absorb `CBUAE_RELEASE_CALENDAR` (`services/bff/src/analytics/programme.ts:20-24`),
three hardcoded scheme deadlines feeding a board-facing view with no source, no version and no watch. It is
the repo's only enumerated compliance-deadline register and is precisely the kind of fact this ADR governs.

Home: `@ofbo/contracts` — the package that already owns generated contract canon and is depended on by both
the BFF and the portal. A bare `standards-baseline.ts` beside the generated types, no new workspace package.

## The egress ruling (settled 2026-08-18)

The review found (§2.7) that `services/bff/src/worker.ts:336-344` wires the rate-card watcher **without** a
fetcher, so the default `HttpRateCardSourceFetcher` performs direct outbound HTTPS from the Worker to
`nebras-open-finance.com` and to the CBUAE Confluence page, with no P6 port in the path. CLAUDE.md states P6
covers "ALL Nebras-bound traffic; no direct egress — non-negotiable."

The defensible reading is that these are **scheme documentation mirrors, not the Nebras API Hub**, and so
fall outside P6's remit — P6 exists to carry FAPI-profiled, mTLS, certificate-bearing API traffic, which a
public documentation page is not. But that reading is nowhere recorded, and this ADR would *extend* the same
watcher, making the question load-bearing rather than academic.

**Ruled (a) — documentation fetches are outside P6**, narrowly and with conditions. The carve-out is:

> Unauthenticated GETs of **public scheme documentation**, carrying no credentials and no PSU or bank data,
> whose response is used only for change detection, are outside P6. P6 governs the scheme **API data plane** —
> the authenticated, certificate-bearing traffic its mTLS/PAR/PKCE posture exists to carry (CLAUDE.md line 57).

Three facts decided it. **P6 cannot carry this as it stands**: `NebrasEgressPort` is seven purpose-built typed
methods with no generic fetch, so routing documentation through it means adding a method to a regulated port
interface, implementing it in both adapters and extending the contract bench — real cost for poor conceptual
fit. **The rule's purpose points away from P6**: one of the three watched URLs is CBUAE Confluence, not a
Nebras host at all, so a "P6 for Nebras-domain traffic" reading would still leave direct egress and achieve
nothing. And **it will be mediated anyway**: no bank grants a regulated workload unmediated outbound HTTPS, so
in an enterprise estate this call goes through the bank's forward proxy whatever this ADR says.

Two conditions make (a) defensible rather than merely convenient, and both are binding on STD-01:

1. **No uncontrolled redirect.** The fetcher currently sets `redirect: 'follow'` on an unauthenticated GET —
   SSRF-adjacent. Low blast radius (no credentials travel) but it is an uncontrolled outbound path from a
   regulated workload. Pin `redirect: 'manual'` or allowlist permitted final hosts.
2. **The fetcher stays injectable and is configured at enterprise adoption**, so a bank points it at its own
   forward proxy without a code change. Not P6 — but not unmediated either.

The carve-out is deliberately narrow. It licenses *public documentation change-detection*, not "docs are
exempt", and it does not extend to anything carrying a credential, a scheme certificate, or bank data.

## Options considered

1. **In-code baseline registry in `@ofbo/contracts`, plus the existing watcher extended to the errata
   register (recommended).** A deep-frozen `STANDARDS_BASELINE` with per-entry version, effective date,
   source and verified-on; consumers cite baseline keys; the weekly watcher gains the Release Notes & Errata
   register and emits the existing High-class review task on a hash move. *Pros:* reuses the whole change-review
   envelope, the scheduler, the notification sinks and a proven pattern; no migration, no RLS/retention/lineage
   obligations; testable as a pure function; the diff of a baseline change is legible in git. *Cons:* the pin
   is only as good as the human who updates it after a review fires — the watcher detects movement, it does
   not interpret it; and a content-hash watcher on a documentation page is noisy (any editorial edit trips it).
2. **A regulated `standards_baseline` table with versioned snapshots and an audit trail.** *Pros:* history is
   queryable, and the evidence bundle could seal a point-in-time baseline. *Cons:* inherits every regulated-table
   obligation (RLS, INSERT-only, 24/60 retention, classification, write-time lineage) to store what is
   already versioned in git; a schema migration and store for a handful of constants; the git history of a
   frozen constant is the same evidence with none of the cost. **Rejected** unless the evidence bundle later
   needs a queryable baseline, at which point this becomes an extension rather than a replacement.
3. **Keep manual re-verification, and add only a recurring human task.** *Pros:* zero code. *Cons:* this is
   the status quo, and the status quo demonstrably failed on 2026-08-17 — the guide was re-verified by a
   human, recorded in the PRD, and still not applied, because nothing connected the reading to the code or
   to the backlog. Adding a calendar reminder does not close a loop that broke after the reading.

## Recommendation

**Option 1**, with the egress question settled as **(a)** — documentation fetches are outside P6, recorded
here and commented at the call site.

Scope it deliberately narrowly. The registry pins and watches; it does not adopt, and it must not gate
merges on a scheme document's contents. Two constraints worth binding into the story:

- **The watcher notifies; it never edits.** `autoApply: false` is not negotiable, and a fired review that
  nobody actions must remain visible rather than ageing out silently.
- **Ship the `cite` obligation incrementally.** Retrofitting a citation onto every SLA, clock and liability
  constant in one story would touch most of `services/bff/src`. The registry lands first; STD-02/03/04/09/10
  each cite baseline keys for the constants they are already rewriting. This is why STD-01 is a prerequisite
  in sequence but not a blocker for the others.

## Consequences

- **The v5.0 class of failure becomes visible.** A superseded guide is a stale `verifiedOn` and a fired review
  task, not a silent divergence. It does not become *impossible* — a human must still act on the review.
- **The false-negative risk moves, it does not vanish.** A watcher on a documentation page catches editorial
  churn as readily as substance, and a page that is *replaced* rather than edited may not trip a hash at all.
  The registry's honest claim is "we will notice a change to these pages", not "we are current".
- **The watch must fail LOUDLY — this is a binding amendment, not advice.** Today the watcher's result is
  discarded: `services/bff/src/worker.ts:336` calls `runBillingRateCardWatch` inside `Promise.allSettled` and
  never reads the returned `failedSources`. A failed source writes one `billing_rate_card_watch_failed` audit
  row and raises nothing — no ITSM ticket, no risk signal. So if a bank's forward proxy blocks these URLs, or
  a page moves, the watch is dead and looks alive. Pinning the regulatory baseline to a watcher whose silence
  is indistinguishable from "nothing changed" would manufacture false assurance, which is worse than no
  registry at all. **STD-15 fixes this and STD-01 depends on it.**
- **STD-01 is unblocked by this acceptance** but now depends on STD-15. STD-02/03/04 re-baseline the
  Interaction Guide clocks independently — they carry an inline scheme citation until the registry lands, and
  must not stand the registry up by the back door.
- **No schema change, no new table, no migration**, and therefore no new RLS, retention, classification or
  lineage surface. The Q4.5 lineage gate is unaffected.
- **Regulatory posture unchanged, and the egress surface is tightened rather than widened.** Ruling (a) adds
  URLs to an existing fetcher, but its two conditions remove an uncontrolled redirect and put the fetcher
  behind bank-configurable mediation — so the estate ends up with *less* unmanaged egress than before this
  record. UAE residency, INSERT-only audit, 5-year retention, consent-only-in-Hub, the scope matrix and
  202/four-eyes are all untouched. The registry stores public scheme metadata and no PII.
- **Certification is not implicated.** Re-certification is triggered by FAPI, functional or CX changes, not
  by an errata bump. Pinning errata3 records a fact; it does not create a certification obligation.
- **Accepted noise.** Content-hashing a rendered wiki page trips on any editorial edit; the watcher
  normalises whitespace but not structure. This is accepted knowingly — a dismissable review task is cheap
  relative to a missed erratum. Narrow the hash to an extracted region only if the noise proves annoying in
  practice, not pre-emptively.

## Decision

**Accepted by the user on 2026-08-18.** Implement Option 1: a deep-frozen `STANDARDS_BASELINE` in
`@ofbo/contracts` with per-entry version, effective date, source and verified-on; consumers cite baseline
keys incrementally as they are touched; the existing weekly watcher gains the errata sources with the
official Confluence page as the primary pin and the community mirror as secondary early warning.

Two amendments carry with the acceptance. **The egress question is ruled (a)** — public documentation
change-detection is outside P6 — narrowed to the wording above and conditional on pinning the redirect
behaviour and keeping the fetcher injectable for bank-side mediation; the ruling is to be commented at the
call site naming this ADR, so the next reader does not re-derive whether it was deliberate. **And the watch
must fail loudly before the baseline rides on it**: STD-15 makes a failed source raise, and STD-01 depends
on STD-15.
