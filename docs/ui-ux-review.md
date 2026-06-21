# OFBO Portal — Full UI/UX Review (2026-06-21)

Holistic UX review of the built portal (`apps/portal`) across six dimensions:
information architecture & navigation, accessibility (WCAG 2.1 AA), interaction & state
design, visual consistency & responsive, regulated-context UX & content, and
core-workflow usability. Findings are code-grounded. (Stitch appearance fidelity is
covered separately in `docs/design-conformance-audit.md` and not repeated here.)

## Verdict

The portal is **functionally complete and architecturally disciplined, but built
screen-by-screen rather than as a system** — so quality that exists in one place (the
reconciliation console's accessibility; the freshness system; the token layer) did not
propagate. It is **demo-solid but not yet operator- or AA-ready** for a regulated
roll-out. None of the findings are regulatory hard-stop violations; the highest-severity
items are operator-safety, accessibility, and trust gaps.

## What's genuinely strong (preserve this)

- **Token infrastructure** — one canonical `design/tokens.ts` feeding Tailwind; zero raw
  hex, zero arbitrary px across all components. Rare discipline.
- **Scope-gated IA** — `lib/nav.ts` + `lib/scopes.ts` single source of truth; hide-not-disable
  for out-of-scope modules; defence-in-depth with per-page redirects matching nav gates.
- **DEMO banner** — rendered once in the root layout, sticky, `role="alert"`, on every
  route incl. sign-in; copy is unambiguous. Bulletproof.
- **PII-zero discipline** — every rendering path traced is synthetic/internal-id only; the
  care timeline deliberately projects away `psu_identifier`/`event_data`.
- **Four-eyes data flow** — genuinely never executes inline (invoice run returns an
  `ApprovalRequest`); no-self-approval enforced in `canActOn` with clear lockout copy.
- **Freshness system** — `FreshnessBadge` Fresh/Stale+cause, degraded responses correctly
  badged stale; reused uniformly across analytics/risk/ops. Best-executed interaction detail.
- **Empty states** — comprehensive, stable testids, scope-aware ("No pending approvals for your scope").
- **Reconciliation console accessibility** — `role=status`/`alert`, `aria-labelledby`
  regions, `sr-only` counts, `focus-visible` rings, test-backed. The gold standard.

## Cross-cutting themes (the review's real signal)

1. **"Per-screen, not per-system."** The status badge, KPI card, and panel are
   independently re-implemented in 4–5 consoles and have *drifted* (e.g. `suspended` is
   red on analytics but amber on care; KPI numbers are `text-3xl`/`2xl`/`xl` across
   screens). The recon a11y rigor never became a shared pattern or gate, so the other 7
   screens regress on the same criteria its tests prove are achievable.
2. **Static-render architecture costs in-the-moment feedback.** All-server-render +
   redirect-per-mutation yields: no loading/skeleton/submitting states (double-submit
   risk), per-call idempotency keys that defeat their own purpose, scroll/context loss on
   every action, no optimistic UI.
3. **Consequential external actions lack confirmation.** Revoke consent, escalate-to-Nebras,
   and approve-gated-op all fire irreversible, externally-visible effects on a single
   click; silent enum defaults (revoke reason, resolve outcome) get recorded on audited actions.
4. **Broken handoffs & dead affordances.** Global search is inert on every screen; the
   four-eyes initiator→approver loop has no link and no pending-count badge; approval cards
   show no operation payload (approving "a label"); cursor pagination is fetched then
   discarded so long lists silently truncate.
5. **Responsive/mobile is effectively unbuilt** despite mobile Stitch references.
6. **The API error envelope is underused** — `remediation`/`docs_url` parsed nowhere;
   write-path errors collapsed to generic strings.

## Prioritized findings

### Tier 1 — fix before an operator pilot or regulator walkthrough
| Sev | Finding | Where |
|---|---|---|
| CRITICAL | **Accessibility regressions outside recon**: status banners not announced (`role=status`/`alert` missing — 4.1.3), no visible focus indicator (2.4.7), missing landmark/heading association (1.3.1) on care/approvals/analytics/risk/ops/tpp/compliance/app-shell. **Not AA-ready outside recon.** | `care-console.tsx`, `approvals-portal.tsx`, `analytics-dashboard.tsx`, `tpp-billing.tsx`, `app-shell.tsx`, … |
| HIGH | **No confirmation on irreversible external actions** — revoke consent, escalate-to-Nebras, approve-gated-op are single-click | `care-console.tsx:133`, `investigation-detail.tsx:109`, `approvals-portal.tsx:80` |
| HIGH | **Silent enum defaults on audited actions** — revoke `reason_code` / resolve `resolution_outcome` default to first value, recorded as-is | `care-console.tsx:138`, `recon-console.tsx:106` |
| HIGH | **Cursor pagination fetched but discarded** — long lists silently truncate, no "more available" signal | `app/reconciliation/page.tsx`, `app/tpp-billing/page.tsx`, `app/approvals/page.tsx`, `lib/care.ts` |
| HIGH | **Four-eyes handoff broken** — initiator gets no approval-id/link; no pending-count badge on Approvals nav; approval card shows no operation payload (amount/target) | `app/tpp-billing/page.tsx:23`, `approvals-portal.tsx:57`, `lib/nav.ts` |

### Tier 2 — operator quality & maintainability
| Sev | Finding | Where |
|---|---|---|
| HIGH | **No loading/submitting states** — no skeletons, no disabled/"Working…" on submit; cold BFF = frozen unfeedbacked screen + double-submit risk | all `app/**/page.tsx`, mutating forms |
| HIGH | **Per-call idempotency keys** — fresh UUID per click gives zero double-submit protection | `app/**/actions.ts` |
| HIGH | **Dead global search** — `<input type=search>` on every screen with no handler/target | `app-shell.tsx:71` |
| HIGH | **Primitive duplication** — extract one `StatusBadge` + `KpiCard` + `Panel` into `components/ui/` (resolves several HIGH/MEDIUM at once) | analytics/care/recon/tpp/approvals |
| MEDIUM | **Silent scope-denied redirect** — out-of-scope deep link dumps user on dashboard with no explanation | `care/page.tsx:39` (+ pattern) |
| MEDIUM | **Error envelope `remediation`/`docs_url` unused**; write errors collapsed to fixed strings | `lib/*.ts`, `app/**/actions.ts` |
| MEDIUM | **Context loss on mutation** — redirect resets scroll/selection on high-throughput queues; form inputs dropped on failure | care/recon/approvals |
| MEDIUM | **Break queue is per-run, not a cross-run work queue**; claim doesn't lead into investigation | `app/reconciliation/page.tsx`, `actions.ts` |

### Tier 3 — polish & robustness
| Sev | Finding | Where |
|---|---|---|
| HIGH(visual) | **Density toggle is a dead control** — sets `data-density` nothing consumes | `app-shell.tsx:22` |
| HIGH(visual) | **Responsive/mobile unbuilt** — sidebar never becomes a drawer; tables lack overflow guard; top bar can't wrap | `app-shell.tsx`, globals.css |
| MEDIUM | **Token-pairing contrast bug** — `bg-primary-container` + `text-on-primary` (should be `-container`) on the always-visible persona badge + billing buttons | `app-shell.tsx:79`, `tpp-billing.tsx` |
| MEDIUM | **"Actions are logged" not shown at point of mutation** (only on dashboard/lookup) | mutating forms |
| MEDIUM | Inconsistent KPI grid breakpoints; two section-header type styles used interchangeably | analytics/recon/dashboard |
| LOW | Emoji (🎉) in recon empty state; "High-class audited" wording; raw snake_case enum labels in selects | `recon-console.tsx:186`, `care-console.tsx:54`, selects |
| LOW | No breadcrumbs on deep-linked detail; no `not-found.tsx`/`error.tsx`; collapsed-nav has no tooltips; no skip-link; no `prefers-reduced-motion` | app-shell, layout, globals.css |

## Recommended remediation sequence

1. **Generalize the recon a11y pattern into a shared spec + Q-gate** (jest-axe/shared a11y
   test over every screen) and fix the `role=status`/`focus-visible`/landmark regressions.
   Highest leverage, mechanical (reference implementation already exists).
2. **Add confirmation + forced-choice enums** to revoke / escalate / approve (operator safety).
3. **Close the four-eyes loop**: approval-id in the initiator notice + deep-link, pending-count
   nav badge, operation payload on approval cards.
4. **Expose pagination** ("Load more"/cursor pages) wherever `next_cursor` is non-null.
5. **Extract `components/ui/` primitives** (StatusBadge/KpiCard/Panel) — unifies visual drift.
6. **Add loading/submitting states + stable idempotency keys.**
7. **Decide on responsive scope** — if mobile is in scope, it needs a dedicated story
   (drawer shell + table overflow + density wiring); the manual toggle is not a substitute.
8. **Polish**: scope-denied page, error-envelope remediation rendering, contrast token fix,
   emoji/wording, breadcrumbs, not-found/error boundaries.

Several of these (the generic-renderer panels, responsive scope, error-envelope contract
usage) are decisions, not just fixes — surface as backlog items / a UX-hardening milestone.
