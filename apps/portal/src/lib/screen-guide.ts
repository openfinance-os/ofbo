/**
 * UX — the "why am I looking at this?" content layer. Most operators who open OFBO
 * are bank staff who are NOT steeped in Open Finance: they know their job (care,
 * finance, risk…) but not why the UAE scheme (CBUAE · Al Tareq · Nebras) obliges
 * the bank to run a back office at all. This module is the single source of truth
 * for the introductory guide page (/guide) AND the per-screen "About this screen"
 * overlay, so the in-app explanation and the page never drift.
 *
 * Presentation-only — NOT contract data, NOT PII. Every `why` ties the screen back
 * to a concrete obligation in the UAE Open Finance ecosystem so the operator
 * understands the regulatory reason the screen exists, not just its buttons. Keep the
 * keys aligned with lib/nav.ts (the actual scope-gated modules); the README mirrors
 * this same narrative for readers who land on the GitHub repo first.
 */

/** The UAE Open Finance ecosystem in three actors — referenced throughout the guide. */
export interface EcosystemActor {
  name: string
  detail: string
}

export const ECOSYSTEM: EcosystemActor[] = [
  {
    name: 'CBUAE',
    detail:
      'The Central Bank of the UAE — the regulator. It mandates Open Finance, licenses participants, and sets the obligations the bank must be able to evidence on demand.'
  },
  {
    name: 'Al Tareq',
    detail:
      'The trust framework: the rulebook, the FAPI 2.0 security profile (mTLS · PAR · PKCE), the consent model, and the certificate chain that lets the bank and a fintech trust each other.'
  },
  {
    name: 'Nebras (the API Hub)',
    detail:
      'The central platform every participant connects through — consent management, the TPP register, billing/settlement reports, and case & dispute management. OFBO consumes Nebras surfaces; it never talks to fintechs directly.'
  }
]

/**
 * The bank wears two hats in the scheme — and most newcomers only picture the first.
 * OFBO is built so a single back office runs both.
 */
export interface BankRole {
  role: string
  plain: string
}

export const BANK_ROLES: BankRole[] = [
  {
    role: 'LFI (account-holder)',
    plain:
      'A Licensed Financial Institution that holds the customer’s (PSU’s) accounts. When a fintech asks — with the customer’s consent — to read data or initiate a payment, the bank serves that request. Inbound traffic.'
  },
  {
    role: 'TPP-of-record (TPP-as-a-Service)',
    plain:
      'The bank also acts as a Third-Party Provider for its own products, consuming other banks’ data on the customer’s behalf. That makes the bank a counterparty that gets billed and reconciled. Outbound traffic.'
  }
]

/**
 * The control fabric that runs underneath every screen. These are the guardrails the
 * scheme (and CBUAE supervision) require the bank to be able to prove — the demo leads
 * with "watch the guardrails, not the CRUD".
 */
export interface Guardrail {
  icon: string // Material Symbols
  title: string
  detail: string
}

export const GUARDRAILS: Guardrail[] = [
  {
    icon: 'how_to_reg',
    title: 'Four-eyes on consequential actions',
    detail:
      'Refunds, revocations, invoice runs and regulator reports never execute on one click — they return an approval request that a second, different person must approve. An initiator can never approve their own request.'
  },
  {
    icon: 'shield',
    title: 'Separation of duties (scope hygiene)',
    detail:
      'Customer Care ≠ Finance ≠ Risk. Each role sees only the screens its mandate covers; the sidebar changes per persona and the same rule is enforced again at the service layer, not just hidden in the UI.'
  },
  {
    icon: 'fact_check',
    title: 'Insert-only audit + BCBS 239 lineage',
    detail:
      'Every privileged action is written to an append-only audit trail (nothing is editable or deletable), and every regulated figure carries column-level lineage — where the number came from, end to end.'
  },
  {
    icon: 'lock',
    title: 'Zero PII · secure egress · FAPI 2.0',
    detail:
      'No real customer data ever lives here (the demo is synthetic-only and permanently non-prod). All scheme-bound traffic leaves through one secure egress gateway under the Al Tareq FAPI 2.0 posture — never a direct call.'
  }
]

/** A screen the guide and overlay explain: what it is, how it helps, and why the scheme needs it. */
export interface ScreenGuide {
  /** nav module key (lib/nav.ts) — also the overlay lookup key. */
  key: string
  title: string
  icon: string // Material Symbols
  /** Plain-language "what you are looking at". */
  whatItIs: string
  /** "what it helps you do" — the operator's job on this screen. */
  helpsYou: string
  /** "why the Open Finance ecosystem requires it" — the regulatory reason it exists. */
  whyOpenFinance: string
}

/**
 * Ordered for the guide tour. Keys match lib/nav.ts so the overlay can look up the
 * active module directly. A given persona only ever sees the screens its scope allows;
 * this map describes them all for the full tour.
 */
export const SCREEN_GUIDE: ScreenGuide[] = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    icon: 'dashboard',
    whatItIs:
      'Your landing view: the system heartbeat (the latest reconciliation pass-rate), what is waiting for a second pair of eyes, headline KPIs, and your recent actions.',
    helpsYou:
      'See at a glance whether the Open Finance operation is healthy and whether anything needs you, before you dive into a specific console.',
    whyOpenFinance:
      'Running Open Finance is a live, supervised operation, not a back-office batch. The bank has to know — and be able to show — that the service is up, reconciled, and under control at any moment.'
  },
  {
    key: 'approvals',
    title: 'Approvals (four-eyes)',
    icon: 'how_to_reg',
    whatItIs:
      'The queue of actions that have been requested but not yet executed — each showing who initiated it and who must approve it.',
    helpsYou:
      'Approve or reject a colleague’s consequential action. You can never approve your own request, so accountability always sits with two people.',
    whyOpenFinance:
      'The scheme treats actions like refunds and fraud revocations as high-impact. Mandatory dual control (four-eyes) is how the bank prevents a single operator — or a compromised account — from causing or hiding harm.'
  },
  {
    key: 'customer-care',
    title: 'Customer Care',
    icon: 'support_agent',
    whatItIs:
      'The PSU (customer) consent surface: look up a customer, see every consent they have granted to fintechs and its lifecycle, revoke a consent, and manage unauthorised-payment disputes.',
    helpsYou:
      'Answer "who has access to my data and money, and how do I stop it?" — the question a worried customer actually calls about — and act on it safely.',
    whyOpenFinance:
      'Consent is the foundation of Open Finance: the customer is in control and can withdraw access at any time. The scheme requires the bank to honour a revocation fast (a sub-5-second acknowledgment to the Nebras Consent Manager) and to handle disputes — so a care surface is non-negotiable.'
  },
  {
    key: 'finance',
    title: 'Finance — Reconciliation',
    icon: 'account_balance',
    whatItIs:
      'The three-way reconciliation console: the bank’s own metering, the fintech’s billing, and the Nebras settlement report, matched line by line, with a queue of the breaks where they disagree.',
    helpsYou:
      'Find, claim, investigate and resolve the discrepancies — and escalate a genuine break to Nebras as a dispute — so the money the bank pays and is paid is provably correct.',
    whyOpenFinance:
      'Open Finance traffic is billed and settled between participants through Nebras. The bank must reconcile what it is charged against what it metered, catch variances, and have an evidenced trail — both as the LFI and as a TPP-of-record counterparty.'
  },
  {
    key: 'analytics',
    title: 'Analytics & Insights',
    icon: 'insights',
    whatItIs:
      'The executive and finance view of the operation: fee accrual and TPP-as-a-Service margin, data freshness, service levels and error budgets over time.',
    helpsYou:
      'Understand the commercial and operational shape of the Open Finance business — what it earns, what it costs, and whether it is meeting its service levels.',
    whyOpenFinance:
      'Open Finance is a regulated business line, not a compliance checkbox. The bank needs trustworthy, lineage-backed numbers to run it commercially and to demonstrate to the regulator that service levels are being met.'
  },
  {
    key: 'billing',
    title: 'TPP Billing & Registry',
    icon: 'receipt_long',
    whatItIs:
      'The register of TPP counterparties and the billing/invoicing surface for the bank’s TPP-as-a-Service role.',
    helpsYou:
      'Keep the counterparty register in step with Nebras and run the invoicing for outbound traffic — under four-eyes control.',
    whyOpenFinance:
      'As a TPP-of-record the bank is a billable participant. The scheme requires counterparties to be registered and traffic to be invoiced and settled accurately through the hub.'
  },
  {
    key: 'compliance',
    title: 'Compliance',
    icon: 'gavel',
    whatItIs:
      'The regulatory oversight surface: compliance reports and the data-lineage view that traces every regulated figure back to its source.',
    helpsYou:
      'Produce and approve the reports CBUAE expects, and answer "where did this number come from?" with column-level lineage.',
    whyOpenFinance:
      'CBUAE supervises participants and expects timely, accurate regulatory reporting plus the ability to prove data integrity (BCBS 239 lineage). Reporting on a cadence is itself a scheme obligation.'
  },
  {
    key: 'risk',
    title: 'Risk',
    icon: 'shield',
    whatItIs:
      'The anomaly and fraud surface: consent anomalies, unusual TPP behaviour, confirmation-of-payee mismatches, liability approaching scheme thresholds, and a predictive liability forecast.',
    helpsYou:
      'Spot and triage the signals that suggest fraud or a control breaking down, and respond — including raising a four-eyes fraud revocation.',
    whyOpenFinance:
      'Opening accounts to third parties widens the fraud surface, and the scheme allocates liability between participants. The bank must detect anomalies early and manage its liability exposure before it crosses a scheme threshold.'
  },
  {
    key: 'operations',
    title: 'Operations',
    icon: 'monitoring',
    whatItIs:
      'The platform-health surface: service levels, incidents, and the Nebras case & dispute desk that links an incident across every console.',
    helpsYou:
      'Keep the service inside its SLOs, manage incidents, and run the cases the bank raises with — or receives from — the Nebras helpdesk.',
    whyOpenFinance:
      'Availability and incident handling are scheme obligations: a participant that is down or slow degrades the whole ecosystem. Nebras provides the shared case & dispute channel the bank operates through.'
  },
  {
    key: 'agents',
    title: 'Agent Registry',
    icon: 'smart_toy',
    whatItIs:
      'The register of programmatic identities — service accounts, agents and MCP integrations — that hold admin scopes. You register one (four-eyes) and revoke its credential immediately when needed.',
    helpsYou:
      'Control which automated, non-human identities can act on the platform and with exactly what scope — under the same four-eyes issuance and audit trail that govern human operators.',
    whyOpenFinance:
      'Admin-scope access is powerful whether a person or a machine wields it. The scheme’s least-privilege, separation-of-duties and accountability rules apply to programmatic actors too: their credentials must be governed, four-eyes-issued, revocable, and fully audited.'
  },
  {
    key: 'audit',
    title: 'Audit Log',
    icon: 'fact_check',
    whatItIs:
      'The cross-operator "who did what" trail — every privileged action by every operator, append-only and PII-redacted. Reading it is itself logged.',
    helpsYou:
      'Answer "everything this operator touched" or "who revoked this consent" for an investigation or a regulator request — across all roles, not just your own.',
    whyOpenFinance:
      'Accountability and non-repudiation are core to a regulated scheme. The bank must retain an immutable record of privileged actions (no edits, no deletes) for supervision and disputes — distinct from data lineage, which traces the numbers.'
  }
]

/** Overlay lookup: the guide entry for the currently-active module, if any. */
export function screenGuideFor(key: string | undefined): ScreenGuide | undefined {
  if (!key) return undefined
  return SCREEN_GUIDE.find((s) => s.key === key)
}
