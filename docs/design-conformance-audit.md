# Design-conformance audit — portal screens vs Stitch

Audit of the built portal screens against their **Stitch** appearance references
(project `8050269076066130289`, "Regulated Institutional Interface"). Division of truth
per CLAUDE.md: **Stitch = layout + design tokens; OpenAPI = behaviour + data.** Verdicts
below judge *appearance/layout only* — data binding and behaviour are out of scope.

- **Original audit:** 2026-06-21 (per screen, the Stitch reference screenshot was viewed and
  the React implementation read; layout/section/hierarchy + token usage compared).
- **Re-audit (this revision):** 2026-06-22 — **UIF-10 gate.** Every screen component was
  re-read on `main` after the UI-FIDELITY track (UIF-01…09) merged; verdicts reconciled
  against the original Stitch findings. The Stitch references are unchanged; the React side
  is what moved. **Result: no MAJOR-DRIFT remains.**

## Headline (re-audit, 2026-06-22)

- **Token discipline remains clean on all screens** — no raw hex/px anywhere; the
  `design-conformance.spec` gate holds. All residual drift is structural/compositional.
- The three original root causes are now closed or reduced:
  1. **Generic analytics renderer** (Analytics, Risk, Operations) — **RESOLVED** by bespoke
     typed-section panels (UIF-03/-04/-05; **ADR 0016 supersedes ADR 0012**). No longer drift.
  2. **Genuine omissions** (Reconciliation, TPP Billing) — **reduced to MINOR**; the
     first-class panels landed (UIF-07/-08/-08b/-08c), the remainder is backlog-gated (UIF-07b).
  3. **Reference problems** (Investigation has no Stitch screen) — **still open**, gated on
     generating the screen in Stitch first (UIF-09b). Four-Eyes was never true drift.

## Canonical reference map + verdicts

One canonical Stitch screen id is pinned per route here (CLAUDE.md convention).

| Route / component | Canonical Stitch screen | Verdict (2026-06-22) | Note |
|---|---|---|---|
| `/care` · care-console.tsx | `03c038c9…` Customer Care Console (Hardened) | **MINOR-DRIFT** | UIF-09 landed the connected 24-month event timeline. Bulk-Revocation header btn + per-row Investigate are behaviourally-gated and tracked in **UIF-09b** (blocked). Investigation Module (one-click dispute) present |
| `/reconciliation` · recon-console.tsx | `46e55863…` Reconciliation Console (Refined) | **MINOR-DRIFT** | UIF-07 added the bespoke outcome panel (pass-rate gauge + contribution bar). The three-source comparison table + finance/margin KPIs + Margin-by-Fintech are tracked in **UIF-07b** (blocked). Break Queue conforms |
| `/reconciliation/breaks/[id]` · investigation-detail.tsx | **NONE EXISTS** | **MISSING REF** | The 3 Stitch "Investigation Detail View" screens are Risk/TPP forensics, not the finance three-source diff. Generate a finance investigation screen in Stitch first — **UIF-09b** (blocked) |
| `/approvals` · approvals-portal.tsx | `a6eb7f25…` Mobile Approval Queue (only queue design) | **MINOR-DRIFT** | React desktop queue is a fair adaptation of the mobile queue; dual initiator/approver block + inline actions are additive & behaviourally correct. (Desktop "Four-Eyes Approval Portal" variants are single-request detail, not queues) |
| `/analytics` · analytics-dashboard.tsx | `93e9aaa9…` Analytics & Insights (Refined) | **CONFORMANT** | **RESOLVED (UIF-03).** The BFF emits typed `data.sections`; `AnalyticsSection` renders bespoke panels (pass-rate Gauge, Commercial-Metrics KPI strip, Margin-by-Product-Family ContributionBars) via the shared typed-section renderer. Generic grid only as a free-form fallback |
| `/risk` · risk-dashboard.tsx | `4f04802a…` Risk Management & Anomaly Detection | **CONFORMANT** | **RESOLVED (UIF-04).** Risk-Signals KPI strip + Open-Signals-by-Severity ContributionBars; the liability monitor renders Liability-by-Severity bars + an Approaching-Triggers table. (Optional risk-posture gauge + live anomaly stream are future enhancements, not drift) |
| `/operations` · operations-console.tsx | `cd4aaffd…` Operations Console (Refined) | **CONFORMANT** | **RESOLVED (UIF-05).** Platform-Health KPI strip + TPP-Onboarding-Pipeline ContributionBars + Active-Outages table. (Four-Eyes audit-trail feed is an optional read-only add, not drift) |
| `/tpp-billing` · tpp-billing.tsx | `3d6d14a3…` TPP Billing & Registry (Refined) | **MINOR-DRIFT** | UIF-08 added the KPI overview row; UIF-08b the registry search/filter; UIF-08c the columnar registry table. Billing Action Center + billing-cycle stepper + audit-trail feed were dropped as low-value cosmetics |
| `/` · dashboard-command.tsx | (command dashboard) | **CONFORMANT** | UIF-06 — System-Health panel + Four-Eyes queue panel via UIF-01 primitives |

(App shell + sign-in: UIF-02. Compliance-view audited separately / no dedicated bespoke Stitch screen.)

## Root cause #1 — the generic analytics renderer (Analytics, Risk, Operations) — RESOLVED

> **RESOLVED (ADR 0016, user decision 2026-06-21; shipped UIF-03/-04/-05).** ADR 0012 Option 1
> (keep the generic grid) is **superseded**. The analytics-sections contract (spec #181) lets
> each BFF analytics producer emit typed, named `data.sections`; one shared renderer
> (`components/analytics/analytics-sections.tsx`) maps each `kind` → a UIF-01/01b primitive
> (Gauge, ContributionBar, KpiStat/StatStrip, status-cards, object-table). The generic
> `MetricGrid` is now only a backward-compatible fallback for still-free-form views. UX-11 reopened and closed.

The three screens reuse the one shared `AnalyticsSection` wrapper, so they all gained bespoke
panels from the single renderer the moment their producers emitted typed sections — no per-screen
React. This is the leverage that turned three MAJOR-DRIFT screens into three CONFORMANT ones.

## Root cause #2 — genuine omissions (Reconciliation, TPP Billing) — REDUCED TO MINOR

Hand-built and token-clean. The first-class Stitch sections landed: the recon **outcome panel**
(UIF-07) and the TPP **KPI overview row + columnar registry + search/filter** (UIF-08/-08b/-08c).
The residual omissions are backlog-gated, not architecture: the recon three-source comparison
table + margin split (**UIF-07b**, blocked on a finance sign-off); the TPP billing-cycle stepper +
action center were dropped as low-value cosmetics.

## Root cause #3 — reference problems (Investigation, Four-Eyes) — INVESTIGATION STILL OPEN

- **Investigation** (`/reconciliation/breaks/[id]`): no finance-investigation screen exists in
  Stitch — the component is orphaned. Per CLAUDE.md ("if a needed screen isn't in Stitch,
  generate it there first"), generate a finance three-source-diff investigation screen, then
  re-audit. Tracked as **UIF-09b** (blocked — needs the Stitch generation + a human call). Not a defect.
- **Four-Eyes**: the desktop portal variants are single-request detail; the only queue design is
  the **Mobile Approval Queue**. The React desktop queue conforms to *that* (MINOR). Optionally
  generate a desktop queue variant in Stitch.

## Note on "missing" controls

Some Stitch controls are intentionally absent in React for **behavioural** reasons, not drift:
four-eyes actions must be `202`+approval (never inline), and bulk-revoke is approval-gated.
Stitch's inline action buttons are appearance references only.

## Re-audit conclusion (UIF-10)

**Target met: no MAJOR-DRIFT remains.** All three generic-renderer screens are CONFORMANT; the
two hand-built screens are MINOR with their remainders backlog-gated; Care is MINOR with the
behaviourally-gated controls tracked in UIF-09b. The only open *reference* gap is the finance
Investigation screen (UIF-09b), which is blocked on Stitch generation + a human decision — not a
build defect. The original "the portal looks like shit" finding is resolved at the
appearance/composition level.

### Remaining (all human/design-gated, not loop-eligible)

- **UIF-07b** — recon three-source comparison table + Margin-by-Fintech (finance sign-off).
- **UIF-09b** — generate the finance Investigation screen in Stitch; bulk-revoke header + per-row
  Investigate on Care.
- Optional: a desktop Four-Eyes queue variant in Stitch.
