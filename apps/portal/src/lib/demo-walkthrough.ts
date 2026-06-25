// Guided demo walkthrough — the interactive, presenter-facing version of docs/demo-script.md.
// The spine is ONE incident, INC-2026-0042 (an unauthorised payment), traced across every console
// as a single linked thread. Public, editorial content (no PII, no backend) — a presenter or
// prospect reads it while navigating the live demo. Keep it faithful to docs/demo-script.md.

export const INCIDENT = 'INC-2026-0042'

export const OPENING =
  'This is a bank-neutral back office for UAE Open Finance — the LFI and TPP-of-record roles in one regulated console. Watch the guardrails, not the CRUD. And watch one incident, INC-2026-0042, move across every screen.'

export const CLOSING =
  'Every screen is bound to the OpenAPI contract, token-gated by the persona matrix, four-eyes-gated where it matters, PII-free, and lineage-tracked — and all of it port-abstracted, so the same application core runs against the bank’s real systems by swapping a config flag, not a line of code. One incident, INC-2026-0042, walked through all of it as a single thread.'

export interface WalkthroughStep {
  id: string
  title: string
  persona: string
  /** Deep link into the console for this step; null for presenter-CLI-only steps. */
  console: { label: string; href: string } | null
  actions: string[]
  /** The regulatory control / point this step demonstrates. */
  proves: string
  /** A line the presenter can say out loud. */
  say: string
}

export const WALKTHROUGH: WalkthroughStep[] = [
  {
    id: 'care',
    title: 'Customer Care — the incident begins',
    persona: 'Customer Care Agent',
    console: { label: 'Customer Care', href: '/care' },
    actions: [
      'Look up PSU cust-0001 — the profile resolves with its consent inventory and 24-month event history.',
      `Open the in-progress unauthorised_payment dispute (${INCIDENT}) — note the copy: refund is four-eyes-gated downstream, Care cannot refund alone.`,
      'Admin-revoke a Suspended consent (reason TPP_REQUEST) — it propagates to the Nebras Consent Manager via the P6 egress port with a sub-5s acknowledgment.'
    ],
    proves: 'PSU-centric consent view · sub-5s revoke SLA to Nebras · zero PSU PII (audit redacted at emission).',
    say: 'Remember INC-2026-0042 — we’ll see this same payment in Finance, Risk, Approvals, and Ops.'
  },
  {
    id: 'approvals',
    title: 'Four-eyes approval — the load-bearing control',
    persona: 'Customer Care Agent (then switch)',
    console: { label: 'Approvals', href: '/approvals' },
    actions: [
      `Open the pending disputes.refund for ${INCIDENT} — it shows dual Initiator / Approver cards.`,
      'Approve it — the refund executes only now, by a second principal.',
      'Switch persona to see other pending items: a Finance invoice run, a Compliance CBUAE report.'
    ],
    proves: 'Every consequential action returns 202 + approval_request and never executes inline. An initiator is locked out of approving their own — even super-admin, enforced at the BFF, not just the UI.',
    say: 'No single operator — or compromised account — can both initiate and approve.'
  },
  {
    id: 'separation',
    title: 'Separation of duties — the scope matrix is load-bearing',
    persona: 'Finance Analyst',
    console: { label: 'Reconciliation', href: '/reconciliation' },
    actions: [
      'Look at the sidebar: Finance, Analytics, TPP Billing — but no Risk, no Customer Care.',
      'Try navigating to /risk directly → you’re bounced to the dashboard.'
    ],
    proves: 'Customer Care ≠ Finance ≠ Risk scopes; granting beyond the matrix is an automatic review failure. Same enforcement at the BFF, not just the UI.',
    say: 'The separation you see in the nav is itself a control — and it’s enforced twice.'
  },
  {
    id: 'reconciliation',
    title: 'Reconciliation — the same payment, now a break',
    persona: 'Finance Analyst',
    console: { label: 'Reconciliation', href: '/reconciliation' },
    actions: [
      'Scan the KPI row (Total / Matched / Unmatched / Disputed) over a 30-day run history.',
      `In the break queue, find the break carrying the ${INCIDENT} refs — the same unauthorised payment, seen from the money side.`,
      'Claim it (→ assigned, SLA clock), open the three-source diff (Nebras billing vs bank meter vs fintech billing), resolve or escalate to Nebras.'
    ],
    proves: 'Three-way reconciliation across both roles, with a break workflow and an SLA clock — the bank must reconcile and evidence the money.',
    say: 'Care saw a dispute; Finance sees the very same payment as a reconciliation break.'
  },
  {
    id: 'risk',
    title: 'Risk — the same payment, now a signal',
    persona: 'Risk Analyst',
    console: { label: 'Risk', href: '/risk' },
    actions: [
      `Among the seeded signals, open the tpp_behaviour signal that is the ${INCIDENT} thread — the unauthorised-payment pattern flagged for Fictional Fintech 01.`,
      'Show the predictive liability forecast — a deterministic, explainable, drift-monitored AI artefact (advance warning, never an automated control).',
      'Triage a signal (acknowledge → investigate → close) — every transition is audited.'
    ],
    proves: 'Anomaly detection + liability-threshold monitoring; fraud revoke is four-eyes-gated. Exposure is caught before it crosses a liability threshold.',
    say: 'Same incident again — Risk sees the behavioural pattern the moment it forms.'
  },
  {
    id: 'ops',
    title: 'Ops, audit & lineage — one incident, end to end',
    persona: 'Compliance Officer / Super Admin',
    console: { label: 'Operations', href: '/operations' },
    actions: [
      `In Ops, the Nebras service-desk case for ${INCIDENT} links the recon break, the PSU dispute, and the risk signal — plus a fraud incident that paused the customer’s payments.`,
      'In the Audit Log, filter Event type → consent_revoked: the revoke from step 1 appears, attributed to the care agent, now visible to a different persona (Compliance). The read itself is logged.',
      'Trace a figure: GET /back-office/lineage/risk_signal returns the column-level BCBS 239 lineage tree.'
    ],
    proves: 'INSERT-only immutable audit (who acted) + BCBS 239 column-level lineage (where the data came from) = full end-to-end traceability. The Q4.5 CI gate fails the build if any table with rows lacks lineage.',
    say: 'One unauthorised payment — a dispute, a break, a signal, a case, a fraud report, and a two-person refund. One incident, five consoles, fully linked and audited.'
  },
  {
    id: 'live-triggers',
    title: 'Trigger a break + a signal, live',
    persona: 'Presenter (CLI)',
    console: null,
    actions: [
      'pnpm demo:break — runs the real three-way engine with injected variance → a genuinely new flagged break appears in the queue.',
      'pnpm demo:fault fee-variance "$PERIOD" 50000 && pnpm demo:ingest "$PERIOD" — a Nebras fee variance flows in via P6 and shifts the Finance View.',
      'pnpm demo:fault consent-drift <id> && pnpm demo:ingest — the Hub disagrees with the mirror → a consent_anomaly Risk signal.'
    ],
    proves: 'Breaks and signals on demand — the simulator injects faults at the Hub; the headless ingestion/risk pass reflects them, exactly as the scheduled job would.',
    say: 'Nothing here is staged — these are the real engines reacting to real injected faults.'
  }
]
